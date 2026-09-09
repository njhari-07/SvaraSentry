"""FastAPI application, session management, and realtime WebSocket transport."""

from __future__ import annotations

import asyncio
import json
import time
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Annotated
from uuid import uuid4

import numpy as np
from fastapi import (
    FastAPI,
    File,
    HTTPException,
    Request,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse

from backend.audio_io import decode_audio
from backend.config import Settings
from backend.explainer import build_explanation
from backend.inference import AttributionOptions, InferenceEngine, create_inference_engine
from backend.langchain_agent import create_groq_runnable, rewrite_with_langchain
from backend.pairing import pairing_manager
from backend.risk_engine import RiskEngine
from backend.spectrogram import SpectrogramConfig, SpectrogramRenderer, cosine_similarity
from backend.streaming import AudioChunk, PCMChunker

settings = Settings.from_env()
inference: InferenceEngine = create_inference_engine(
    settings.model_mode,
    settings.checkpoint_path,
    AttributionOptions(
        top_regions=settings.explanation_top_regions,
        time_occlusion=settings.explanation_occlusion,
        band_occlusion=settings.explanation_band_occlusion,
        integrated_gradients=settings.explanation_integrated_gradients,
    ),
)
spectrogram = SpectrogramRenderer(config=SpectrogramConfig(window_seconds=settings.window_seconds))
explanation_runnable = create_groq_runnable(
    enabled=settings.langchain_enabled,
    model=settings.groq_model,
    api_key_file=settings.groq_api_key_file,
    timeout_seconds=settings.groq_timeout_seconds,
)


@dataclass(slots=True)
class SessionState:
    session_id: str
    chunker: PCMChunker
    risk_engine: RiskEngine
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    chunk_count: int = 0
    audio_connected: bool = False
    enrollment: np.ndarray | None = None
    latest: dict[str, object] | None = None
    risk_sum: float = 0.0
    maximum_risk: float = 0.0
    high_risk_windows: int = 0
    caution_windows: int = 0
    final_summary: dict[str, object] | None = None
    stream_id: str = field(default_factory=lambda: uuid4().hex)
    audio_socket: WebSocket | None = field(default=None, repr=False)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    def reset_stream(self) -> None:
        self.chunker.reset()
        self.risk_engine.reset()
        self.chunk_count = 0
        self.latest = None
        self.risk_sum = 0.0
        self.maximum_risk = 0.0
        self.high_risk_windows = 0
        self.caution_windows = 0
        self.final_summary = None
        self.stream_id = uuid4().hex
        self.updated_at = time.time()

    def record_risk(self, score: float) -> None:
        """Accumulate fused per-window risk for the final whole-stream result."""
        self.risk_sum += score
        self.maximum_risk = max(self.maximum_risk, score)
        if score >= settings.high_threshold:
            self.high_risk_windows += 1
        elif score >= settings.caution_threshold:
            self.caution_windows += 1

    def finalize_stream(self, *, completed: bool = True) -> dict[str, object] | None:
        """Build an arithmetic all-window summary when an audio source stops."""
        if self.chunk_count == 0:
            self.final_summary = None
            return None

        average_risk = self.risk_sum / self.chunk_count
        if average_risk >= settings.high_threshold:
            alert_level = "high"
        elif average_risk >= settings.caution_threshold:
            alert_level = "caution"
        else:
            alert_level = "none"

        self.final_summary = {
            "type": "session_summary",
            "session_id": self.session_id,
            "stream_id": self.stream_id,
            "completed": completed,
            "window_count": self.chunk_count,
            "average_risk": round(average_risk, 4),
            "maximum_risk": round(self.maximum_risk, 4),
            "high_risk_windows": self.high_risk_windows,
            "caution_windows": self.caution_windows,
            "high_risk_fraction": round(self.high_risk_windows / self.chunk_count, 4),
            "alert_level": alert_level,
            "completed_at": time.time(),
        }
        return self.final_summary

    def summary(self) -> dict[str, object]:
        return {
            "session_id": self.session_id,
            "stream_id": self.stream_id,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "chunk_count": self.chunk_count,
            "audio_connected": self.audio_connected,
            "voice_enrolled": self.enrollment is not None,
            "latest": self.latest,
            "final_summary": self.final_summary,
        }


def new_session(session_id: str) -> SessionState:
    return SessionState(
        session_id=session_id,
        chunker=PCMChunker(
            sample_rate=settings.sample_rate,
            window_seconds=settings.window_seconds,
            stride_seconds=settings.stride_seconds,
        ),
        risk_engine=RiskEngine(
            alpha=settings.risk_alpha,
            caution_threshold=settings.caution_threshold,
            high_threshold=settings.high_threshold,
        ),
    )


sessions: dict[str, SessionState] = {}
dashboard_clients: dict[str, set[WebSocket]] = defaultdict(set)
app = FastAPI(
    title="SvaraSentry API",
    version="0.2.0",
    description="Realtime transport and inference boundary for voice-clone risk analysis.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.cors_origins),
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "same-origin"
    response.headers["Permissions-Policy"] = "microphone=(self), camera=()"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; img-src 'self' data:; script-src 'self'; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        "font-src 'self' https://fonts.gstatic.com; connect-src 'self' ws: wss:"
    )
    return response


@app.exception_handler(ValueError)
async def value_error_handler(_request: Request, exc: ValueError) -> JSONResponse:
    return JSONResponse(status_code=422, content={"detail": str(exc)})


def get_session(session_id: str) -> SessionState:
    if not session_id or len(session_id) > 80:
        raise ValueError("session_id must contain 1–80 characters")
    if session_id not in sessions:
        prune_sessions()
        if len(sessions) >= settings.max_sessions:
            raise ValueError("session capacity reached; retry later")
        sessions[session_id] = new_session(session_id)
    return sessions[session_id]


def prune_sessions() -> None:
    cutoff = time.time() - settings.session_ttl_seconds
    stale = [
        session_id
        for session_id, session in sessions.items()
        if session.updated_at < cutoff
        and not session.audio_connected
        and not dashboard_clients[session_id]
    ]
    for session_id in stale:
        sessions.pop(session_id, None)
        dashboard_clients.pop(session_id, None)


@app.get("/", include_in_schema=False)
async def dashboard() -> RedirectResponse:
    """Keep the API root useful while the Next.js app owns the dashboard."""
    return RedirectResponse(settings.frontend_origin)


@app.get("/phone", include_in_schema=False)
async def phone_relay() -> RedirectResponse:
    return RedirectResponse(f"{settings.frontend_origin}/phone")


@app.get("/app", include_in_schema=False)
async def app_dashboard() -> RedirectResponse:
    return RedirectResponse(f"{settings.frontend_origin}/app")


@app.get("/health")
async def health() -> dict[str, object]:
    result: dict[str, object] = {
        "status": "ok",
        "model": inference.model_kind,
        "mode": settings.model_mode,
        "checkpoint_loaded": settings.model_mode == "checkpoint",
        "explainability": {
            "time_occlusion": settings.explanation_occlusion,
            "band_occlusion": settings.explanation_band_occlusion,
            "integrated_gradients": settings.explanation_integrated_gradients,
        },
        "explanation_agent": {
            "enabled": explanation_runnable is not None,
            "provider": "groq" if explanation_runnable is not None else None,
            "model": settings.groq_model if explanation_runnable is not None else None,
            "fallback": "deterministic",
            "interval_chunks": settings.langchain_interval_chunks,
        },
    }
    checkpoint_metadata = getattr(inference, "checkpoint_metadata", None)
    if checkpoint_metadata is not None:
        result["checkpoint"] = checkpoint_metadata
    return result


@app.get("/api/config")
async def public_config() -> dict[str, object]:
    return {
        "sample_rate": settings.sample_rate,
        "window_seconds": settings.window_seconds,
        "stride_seconds": settings.stride_seconds,
        "caution_threshold": settings.caution_threshold,
        "high_threshold": settings.high_threshold,
        "model_kind": inference.model_kind,
        "model_mode": settings.model_mode,
        "baseline_disclaimer": settings.model_mode == "baseline",
        "explainability": {
            "time_occlusion": settings.explanation_occlusion,
            "band_occlusion": settings.explanation_band_occlusion,
            "integrated_gradients": settings.explanation_integrated_gradients,
        },
    }


@app.get("/api/sessions")
async def list_sessions() -> list[dict[str, object]]:
    return [session.summary() for session in sessions.values()]


@app.get("/api/sessions/{session_id}")
async def session_detail(session_id: str) -> dict[str, object]:
    return get_session(session_id).summary()


@app.post("/api/sessions/{session_id}/reset")
async def reset_session(session_id: str) -> dict[str, str]:
    session = get_session(session_id)
    if session.audio_connected:
        raise HTTPException(409, "Stop audio and wait for the final result before resetting")
    session.reset_stream()
    await broadcast(session_id, {"type": "reset", "session_id": session_id})
    # Also invalidate any pending pairing tokens when session resets
    pairing_manager.invalidate_session(session_id)
    return {"status": "reset"}


@app.post("/api/sessions/{session_id}/pairing-token")
async def create_pairing_token(session_id: str) -> dict[str, str]:
    get_session(session_id)  # Ensure session exists
    token = pairing_manager.generate(session_id)
    return {"token": token}


@app.post("/api/sessions/{session_id}/enrollment")
async def enroll_voice(session_id: str, audio: Annotated[UploadFile, File()]) -> dict[str, object]:
    if audio.size is not None and audio.size > 25 * 1024 * 1024:
        raise HTTPException(413, "Enrollment audio must be smaller than 25 MB")
    content = await audio.read()
    if len(content) > 25 * 1024 * 1024:
        raise HTTPException(413, "Enrollment audio must be smaller than 25 MB")
    try:
        samples = await asyncio.to_thread(decode_audio, content, settings.sample_rate)
    except Exception as exc:
        raise HTTPException(422, f"Could not decode enrollment audio: {exc}") from exc
    if samples.size < settings.sample_rate * 2:
        raise HTTPException(422, "Enrollment audio must contain at least 2 seconds")
    session = get_session(session_id)
    session.enrollment = await asyncio.to_thread(inference.embed, samples)
    session.updated_at = time.time()
    await broadcast(
        session_id,
        {"type": "enrollment", "session_id": session_id, "voice_enrolled": True},
    )
    return {"status": "enrolled", "duration_seconds": round(samples.size / settings.sample_rate, 2)}


@app.delete("/api/sessions/{session_id}/enrollment")
async def delete_enrollment(session_id: str) -> dict[str, str]:
    session = get_session(session_id)
    session.enrollment = None
    session.updated_at = time.time()
    await broadcast(
        session_id,
        {"type": "enrollment", "session_id": session_id, "voice_enrolled": False},
    )
    return {"status": "deleted"}


async def broadcast(session_id: str, payload: dict[str, object]) -> None:
    stale: list[WebSocket] = []
    message = json.dumps(payload)
    for socket in tuple(dashboard_clients[session_id]):
        try:
            await socket.send_text(message)
        except (RuntimeError, WebSocketDisconnect):
            stale.append(socket)
    for socket in stale:
        dashboard_clients[session_id].discard(socket)


@app.websocket("/ws/dashboard/{session_id}")
async def dashboard_socket(websocket: WebSocket, session_id: str) -> None:
    try:
        session = get_session(session_id)
    except ValueError:
        await websocket.close(code=1008)
        return
    await websocket.accept()
    dashboard_clients[session_id].add(websocket)
    await websocket.send_json({"type": "snapshot", **session.summary()})
    try:
        while True:
            message = await websocket.receive_text()
            if message == "ping":
                await websocket.send_json({"type": "pong", "timestamp": time.time()})
            elif message == "stop_audio" and session.audio_socket is not None:
                # Ask the phone to stop capture and enqueue its end marker after PCM.
                await session.audio_socket.send_json({"type": "stop_requested"})
    except WebSocketDisconnect:
        dashboard_clients[session_id].discard(websocket)


async def process_chunk(session: SessionState, chunk: AudioChunk) -> dict[str, object]:
    started = time.perf_counter()
    prediction, render_output = await asyncio.gather(
        asyncio.to_thread(inference.score, chunk),
        asyncio.to_thread(spectrogram.render_result, chunk),
    )
    identity_match = (
        cosine_similarity(prediction.embedding, session.enrollment)
        if session.enrollment is not None and prediction.embedding.shape == session.enrollment.shape
        else None
    )
    risk = session.risk_engine.update(prediction.fake_probability, identity_match)
    session.chunk_count += 1
    session.record_risk(risk.raw_score)
    session.updated_at = time.time()
    signal = {
        "rms_dbfs": prediction.rms_dbfs,
        "peak": prediction.peak,
        "zero_crossing_rate": prediction.zero_crossing_rate,
        "state": prediction.signal_state,
    }
    acoustic_features = render_output.features.as_dict()
    explanation = build_explanation(
        model_kind=prediction.model_kind,
        model_mode=settings.model_mode,
        fake_probability=prediction.fake_probability,
        risk_score=risk.raw_score,
        smoothed_risk=risk.smoothed_score,
        alert_level=risk.alert_level,
        signal=signal,
        acoustic_features=acoustic_features,
        model_evidence=prediction.model_evidence,
        identity_match=identity_match,
        caution_threshold=settings.caution_threshold,
        high_threshold=settings.high_threshold,
    )
    if explanation_runnable is not None and (
        (session.chunk_count - 1) % settings.langchain_interval_chunks == 0
    ):
        explanation = await asyncio.to_thread(
            rewrite_with_langchain,
            explanation_runnable,
            explanation,
        )
    payload: dict[str, object] = {
        "type": "result",
        "session_id": session.session_id,
        "stream_id": session.stream_id,
        "chunk_index": session.chunk_count,
        "timestamp": round(chunk.timestamp, 3),
        "risk_score": round(risk.raw_score, 4),
        "smoothed_risk": round(risk.smoothed_score, 4),
        "alert_level": risk.alert_level,
        "fake_probability": round(prediction.fake_probability, 4),
        "logit_margin": round(prediction.logit_margin, 4) if prediction.logit_margin is not None else None,
        # Backward-compatible top-level PNG key
        "spectrogram_png_b64": render_output.spectrogram.image_png_b64,
        # Structured spectrogram metadata (v2)
        "spectrogram": render_output.spectrogram.as_dict(),
        # Descriptive acoustic properties (do NOT feed into risk score)
        "acoustic_features": acoustic_features,
        "flagged_region": prediction.flagged_region,
        "model_evidence": prediction.model_evidence,
        "explanation": explanation,
        "identity_match": round(identity_match, 4) if identity_match is not None else None,
        "voice_enrolled": session.enrollment is not None,
        "model_kind": prediction.model_kind,
        "signal": signal,
        "processing_ms": round((time.perf_counter() - started) * 1000, 1),
    }
    # Exclude large binary and redundant structured keys from the session snapshot
    session.latest = {
        key: value
        for key, value in payload.items()
        if key not in ("spectrogram_png_b64", "spectrogram")
    }
    return payload


async def finish_audio_stream(session: SessionState, websocket: WebSocket, completed: bool) -> None:
    final_summary = session.finalize_stream(completed=completed)
    if final_summary is not None:
        await broadcast(session.session_id, final_summary)
    session.audio_connected = False
    session.audio_socket = None
    session.updated_at = time.time()
    await broadcast(session.session_id, {
        "type": "source", "connected": False, "stream_id": session.stream_id,
        "completed": completed, "window_count": session.chunk_count,
    })
    if completed:
        # The ordered end marker is read only after every preceding PCM frame.
        # Acknowledge via the audio socket as well as the dashboard subscription.
        try:
            await websocket.send_json({"type": "audio_stopped", "summary": final_summary})
            await websocket.close(code=1000, reason="Analysis complete")
        except (RuntimeError, WebSocketDisconnect):
            pass


@app.websocket("/ws/audio/{session_id}")
async def audio_socket(websocket: WebSocket, session_id: str) -> None:
    try:
        session = get_session(session_id)
    except ValueError:
        await websocket.close(code=1008)
        return
    await websocket.accept()
    if session.audio_connected:
        await websocket.send_json(
            {"type": "error", "message": "An audio source is already connected"}
        )
        await websocket.close(code=1008)
        return
    session.audio_connected = True
    session.reset_stream()
    session.audio_socket = websocket
    completed = False
    await broadcast(session_id, {"type": "source", "connected": True, "stream_id": session.stream_id})
    await broadcast(
        session_id,
        {
            "type": "source_status",
            "session_id": session_id,
            "source": "dashboard",
            "state": "streaming",
            "connected_at": time.time(),
            "network_state": "healthy",
        },
    )
    try:
        while True:
            message = await websocket.receive()
            if message["type"] == "websocket.disconnect":
                break
            if message.get("text"):
                try:
                    control = json.loads(message["text"])
                except (TypeError, json.JSONDecodeError):
                    continue
                if isinstance(control, dict) and control.get("type") == "audio_control" and control.get("action") == "stop":
                    completed = True
                    break
            if frame := message.get("bytes"):
                try:
                    if len(frame) > settings.max_frame_bytes:
                        raise ValueError("audio frame exceeds the configured size limit")
                    async with session.lock:
                        chunks = session.chunker.push(frame)
                        for chunk in chunks:
                            payload = await process_chunk(session, chunk)
                            await broadcast(session_id, payload)
                            await websocket.send_json(payload)
                except ValueError as exc:
                    await websocket.send_json({"type": "error", "message": str(exc)})
    except WebSocketDisconnect:
        pass
    finally:
        await finish_audio_stream(session, websocket, completed)
        await broadcast(
            session_id,
            {
                "type": "source_status",
                "session_id": session_id,
                "source": "dashboard",
                "state": "stopped",
                "connected_at": time.time(),
                "network_state": "disconnected",
            },
        )


@app.websocket("/ws/audio/pair/{token}")
async def paired_audio_socket(websocket: WebSocket, token: str) -> None:
    await websocket.accept()
    try:
        session_id = pairing_manager.validate_and_consume(token)
        session = get_session(session_id)
    except ValueError as exc:
        await websocket.close(code=1008, reason=str(exc))
        return
    if session.audio_connected:
        await websocket.send_json(
            {"type": "error", "message": "An audio source is already connected"}
        )
        await websocket.close(code=1008, reason="Session busy")
        return
    session.audio_connected = True
    session.reset_stream()
    session.audio_socket = websocket
    completed = False
    connected_at = time.time()
    await broadcast(session_id, {"type": "source", "connected": True, "stream_id": session.stream_id})
    await broadcast(
        session_id,
        {
            "type": "source_status",
            "session_id": session_id,
            "source": "phone",
            "state": "streaming",
            "connected_at": connected_at,
            "network_state": "healthy",
        },
    )

    # Store network health
    dropped_frames = 0

    try:
        while True:
            message = await websocket.receive()
            if message["type"] == "websocket.disconnect":
                break
            # Handle text messages (like status updates from phone)
            if "text" in message:
                try:
                    data = json.loads(message["text"])
                except (json.JSONDecodeError, TypeError):
                    continue
                if (
                    isinstance(data, dict)
                    and data.get("type") in {"relay_control", "audio_control"}
                    and data.get("action") == "stop"
                ):
                    pairing_manager.revoke(token)
                    completed = True
                    break
                if isinstance(data, dict) and data.get("type") == "status":
                    dropped_frames = int(data.get("dropped_frames", dropped_frames))
                    await broadcast(
                        session_id,
                        {
                            "type": "source_status",
                            "session_id": session_id,
                            "source": "phone",
                            "state": "streaming",
                            "connected_at": connected_at,
                            "dropped_frames": dropped_frames,
                            "network_state": "healthy" if dropped_frames < 5 else "degraded",
                        },
                    )
                continue

            if frame := message.get("bytes"):
                try:
                    if len(frame) > settings.max_frame_bytes:
                        raise ValueError("audio frame exceeds the configured size limit")
                    async with session.lock:
                        chunks = session.chunker.push(frame)
                        for chunk in chunks:
                            payload = await process_chunk(session, chunk)
                            await broadcast(session_id, payload)
                            await websocket.send_json(payload)
                except ValueError as exc:
                    await websocket.send_json({"type": "error", "message": str(exc)})
    except WebSocketDisconnect:
        pass
    finally:
        await finish_audio_stream(session, websocket, completed)
        await broadcast(
            session_id,
            {
                "type": "source_status",
                "session_id": session_id,
                "source": "phone",
                "state": "stopped",
                "connected_at": connected_at,
                "dropped_frames": dropped_frames,
                "network_state": "disconnected",
            },
        )
