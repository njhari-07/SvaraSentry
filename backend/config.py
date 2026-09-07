"""Runtime configuration loaded from environment variables."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _float(name: str, default: float) -> float:
    return float(os.getenv(name, default))


def _origins(name: str, default: tuple[str, ...]) -> tuple[str, ...]:
    value = os.getenv(name)
    if not value:
        return default
    return tuple(origin.strip().rstrip("/") for origin in value.split(",") if origin.strip())


@dataclass(frozen=True, slots=True)
class Settings:
    sample_rate: int = 16_000
    window_seconds: float = 3.0
    stride_seconds: float = 1.0
    risk_alpha: float = 0.35
    caution_threshold: float = 0.55
    high_threshold: float = 0.75
    session_ttl_seconds: int = 3_600
    max_sessions: int = 200
    max_frame_bytes: int = 64_000
    pairing_token_ttl_seconds: int = 120
    model_mode: str = "baseline"
    checkpoint_path: Path = Path("training/checkpoints/model.pt")
    frontend_origin: str = "http://localhost:3000"
    cors_origins: tuple[str, ...] = ("http://localhost:3000", "http://127.0.0.1:3000")

    @classmethod
    def from_env(cls) -> Settings:
        return cls(
            sample_rate=int(os.getenv("SVARASENTRY_SAMPLE_RATE", "16000")),
            window_seconds=_float("SVARASENTRY_WINDOW_SECONDS", 3.0),
            stride_seconds=_float("SVARASENTRY_STRIDE_SECONDS", 1.0),
            risk_alpha=_float("SVARASENTRY_RISK_ALPHA", 0.35),
            caution_threshold=_float("SVARASENTRY_CAUTION_THRESHOLD", 0.55),
            high_threshold=_float("SVARASENTRY_HIGH_THRESHOLD", 0.75),
            session_ttl_seconds=int(os.getenv("SVARASENTRY_SESSION_TTL_SECONDS", "3600")),
            max_sessions=int(os.getenv("SVARASENTRY_MAX_SESSIONS", "200")),
            max_frame_bytes=int(os.getenv("SVARASENTRY_MAX_FRAME_BYTES", "64000")),
            pairing_token_ttl_seconds=int(os.getenv("SVARASENTRY_PAIRING_TOKEN_TTL_SECONDS", "120")),
            model_mode=os.getenv("SVARASENTRY_MODEL_MODE", "baseline").lower(),
            checkpoint_path=Path(
                os.getenv("SVARASENTRY_CHECKPOINT", "training/checkpoints/model.pt")
            ),
            frontend_origin=os.getenv("SVARASENTRY_FRONTEND_ORIGIN", "http://localhost:3000").rstrip("/"),
            cors_origins=_origins(
                "SVARASENTRY_CORS_ORIGINS",
                ("http://localhost:3000", "http://127.0.0.1:3000"),
            ),
        )
