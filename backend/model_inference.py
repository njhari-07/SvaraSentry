"""Lazy-loaded wav2vec2 checkpoint adapter."""

from __future__ import annotations

from pathlib import Path

import numpy as np

from backend.inference import InferenceResult
from backend.spectrogram import pcm_float, signal_metrics
from backend.streaming import AudioChunk


class CheckpointInferenceEngine:
    model_kind = "wav2vec2-attentive"

    def __init__(self, checkpoint_path: Path) -> None:
        if not checkpoint_path.is_file():
            raise FileNotFoundError(f"Checkpoint not found: {checkpoint_path}")
        try:
            import torch
        except ImportError as exc:
            raise RuntimeError("Install the 'ml' dependency extra for checkpoint mode") from exc

        from training.model import VoiceCloneDetector

        payload = torch.load(checkpoint_path, map_location="cpu", weights_only=True)
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self.model = VoiceCloneDetector(
            model_name=payload.get("model_name", "facebook/wav2vec2-base"),
            hidden_size=payload.get("hidden_size", 256),
        )
        self.model.load_state_dict(payload["state_dict"])
        self.model.to(self.device).eval()
        self.torch = torch

    def score(self, chunk: AudioChunk) -> InferenceResult:
        samples = pcm_float(chunk)
        metrics = signal_metrics(samples)
        output = self._forward(samples)
        probability = float(self.torch.sigmoid(output.logits).item())
        embedding = output.embedding.squeeze(0).detach().cpu().numpy().astype(np.float32)
        attention = output.attention.squeeze(0).detach().cpu().numpy()
        peak_index = int(np.argmax(attention))
        window_ms = chunk.sample_count * 1000 / chunk.sample_rate
        frame_ms = window_ms / max(1, attention.size)
        return InferenceResult(
            fake_probability=probability,
            embedding=embedding,
            rms_dbfs=metrics.rms_dbfs,
            peak=metrics.peak,
            zero_crossing_rate=metrics.zero_crossing_rate,
            signal_state=metrics.state,
            flagged_region={
                "time_offset_ms": [round(peak_index * frame_ms), round((peak_index + 1) * frame_ms)],
                "frequency_band": "model attention",
            },
            model_kind=self.model_kind,
        )

    def embed(self, samples: np.ndarray) -> np.ndarray:
        output = self._forward(samples)
        return output.embedding.squeeze(0).detach().cpu().numpy().astype(np.float32)

    def _forward(self, samples: np.ndarray):
        waveform = self.torch.from_numpy(samples).unsqueeze(0).to(self.device)
        with self.torch.inference_mode():
            return self.model(waveform)
