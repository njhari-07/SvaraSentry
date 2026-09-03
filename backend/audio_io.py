"""Decode uploaded audio into the runtime's canonical sample format."""

from __future__ import annotations

import io

import numpy as np
import soundfile as sf


def decode_audio(content: bytes, target_rate: int = 16_000) -> np.ndarray:
    samples, sample_rate = sf.read(io.BytesIO(content), dtype="float32", always_2d=True)
    mono = np.mean(samples, axis=1)
    if sample_rate != target_rate:
        target_length = round(mono.size * target_rate / sample_rate)
        source_positions = np.arange(target_length, dtype=np.float64) * sample_rate / target_rate
        mono = np.interp(source_positions, np.arange(mono.size), mono)
    return np.clip(mono, -1, 1).astype(np.float32)
