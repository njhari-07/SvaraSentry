"""Inference interface, integration baseline, and runtime engine factory."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import numpy as np

from backend.spectrogram import pcm_float, signal_metrics, voice_embedding
from backend.streaming import AudioChunk


@dataclass(slots=True)
class InferenceResult:
    fake_probability: float
    embedding: np.ndarray
    rms_dbfs: float
    peak: float
    zero_crossing_rate: float
    signal_state: str
    flagged_region: dict[str, object] | None = None
    model_kind: str = "unknown"


class InferenceEngine(Protocol):
    model_kind: str

    def score(self, chunk: AudioChunk) -> InferenceResult: ...

    def embed(self, samples: np.ndarray) -> np.ndarray: ...


class BaselineInferenceEngine:
    """A non-ML scorer used solely to validate the real-time transport path."""

    model_kind = "integration-baseline"

    def embed(self, samples: np.ndarray) -> np.ndarray:
        return voice_embedding(samples)

    def score(self, chunk: AudioChunk) -> InferenceResult:
        samples = pcm_float(chunk)
        metrics = signal_metrics(samples)
        rms = 10 ** (metrics.rms_dbfs / 20)
        probability = min(
            1.0, max(0.0, 0.08 + 0.72 * rms + 0.42 * metrics.zero_crossing_rate)
        )
        return InferenceResult(
            fake_probability=probability,
            embedding=self.embed(samples),
            rms_dbfs=metrics.rms_dbfs,
            peak=metrics.peak,
            zero_crossing_rate=metrics.zero_crossing_rate,
            signal_state=metrics.state,
            model_kind=self.model_kind,
        )


def create_inference_engine(mode: str, checkpoint: Path) -> InferenceEngine:
    if mode == "baseline":
        return BaselineInferenceEngine()
    if mode == "checkpoint":
        from backend.model_inference import CheckpointInferenceEngine

        return CheckpointInferenceEngine(checkpoint)
    raise ValueError(f"Unsupported model mode: {mode!r}")
