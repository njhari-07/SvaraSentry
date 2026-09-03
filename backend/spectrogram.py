"""Small spectrogram images and signal descriptors for dashboard updates."""

from __future__ import annotations

import base64
import io
import math
from dataclasses import dataclass

import numpy as np
from PIL import Image

from backend.streaming import AudioChunk


@dataclass(frozen=True, slots=True)
class SignalMetrics:
    rms_dbfs: float
    peak: float
    zero_crossing_rate: float
    state: str


def pcm_float(chunk: AudioChunk) -> np.ndarray:
    return np.frombuffer(chunk.pcm, dtype="<i2").astype(np.float32) / 32768.0


def signal_metrics(samples: np.ndarray) -> SignalMetrics:
    if samples.size == 0:
        return SignalMetrics(-96.0, 0.0, 0.0, "silence")
    rms = float(np.sqrt(np.mean(np.square(samples))))
    peak = float(np.max(np.abs(samples)))
    zcr = float(np.mean(np.signbit(samples[1:]) != np.signbit(samples[:-1])))
    dbfs = max(-96.0, 20 * math.log10(max(rms, 1e-8)))
    state = "clipping" if peak >= 0.99 else "speech" if dbfs > -45 else "quiet"
    return SignalMetrics(round(dbfs, 1), round(peak, 4), round(zcr, 4), state)


def voice_embedding(samples: np.ndarray) -> np.ndarray:
    """Return a compact demo embedding; the ML engine replaces this identity signal."""
    if samples.size == 0:
        return np.zeros(34, dtype=np.float32)
    spectrum = np.abs(np.fft.rfft(samples * np.hanning(samples.size))) ** 2
    bands = np.array_split(np.log1p(spectrum), 32)
    embedding = np.array([float(np.mean(band)) for band in bands], dtype=np.float32)
    metrics = signal_metrics(samples)
    embedding = np.concatenate(
        [embedding, np.array([metrics.zero_crossing_rate, metrics.rms_dbfs / 96], dtype=np.float32)]
    )
    norm = np.linalg.norm(embedding)
    return embedding / norm if norm else embedding


def cosine_similarity(left: np.ndarray, right: np.ndarray) -> float:
    denominator = float(np.linalg.norm(left) * np.linalg.norm(right))
    if not denominator:
        return 0.0
    return max(0.0, min(1.0, float(np.dot(left, right) / denominator)))


class SpectrogramRenderer:
    def __init__(self, width: int = 560, height: int = 180) -> None:
        self.width = width
        self.height = height

    def render_base64(self, chunk: AudioChunk) -> str:
        samples = pcm_float(chunk)
        frame_size = 512
        hop = 160
        if samples.size < frame_size:
            samples = np.pad(samples, (0, frame_size - samples.size))
        frames = np.lib.stride_tricks.sliding_window_view(samples, frame_size)[::hop]
        power = np.abs(np.fft.rfft(frames * np.hanning(frame_size), axis=1)) ** 2
        log_power = 10 * np.log10(np.maximum(power, 1e-10)).T
        low, high = np.percentile(log_power, [8, 99])
        normalized = np.clip((log_power - low) / max(high - low, 1e-6), 0, 1)
        image = Image.fromarray(self._palette(normalized[::-1]), mode="RGB").resize(
            (self.width, self.height), Image.Resampling.BILINEAR
        )
        output = io.BytesIO()
        image.save(output, format="PNG", optimize=True)
        return base64.b64encode(output.getvalue()).decode("ascii")

    @staticmethod
    def _palette(values: np.ndarray) -> np.ndarray:
        stops = np.array(
            [[5, 11, 17], [11, 42, 55], [16, 103, 107], [77, 215, 164], [246, 211, 108], [255, 114, 92]],
            dtype=np.float32,
        )
        scaled = values * (len(stops) - 1)
        indices = np.minimum(scaled.astype(int), len(stops) - 2)
        fraction = (scaled - indices)[..., None]
        return (stops[indices] * (1 - fraction) + stops[indices + 1] * fraction).astype(np.uint8)

