"""Model-agnostic attribution helpers for live speech anti-spoofing.

The helpers in this module turn *measured* attribution values into small,
JSON-safe regions. They do not inspect the spectrogram image: the image is a
visual aid, not a source of model evidence.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable

import numpy as np

DEFAULT_BANDS_HZ: tuple[tuple[int, int], ...] = (
    (0, 300),
    (300, 3_000),
    (3_000, 6_000),
    (6_000, 8_000),
)


def top_time_regions(
    values: np.ndarray | Iterable[float],
    window_ms: float,
    *,
    method: str,
    count: int = 3,
    region_frames: int = 3,
) -> list[dict[str, object]]:
    """Return separated high-relevance time regions from frame-level values."""

    relevance = np.asarray(values, dtype=np.float64).reshape(-1)
    if relevance.size == 0 or not np.isfinite(relevance).any() or window_ms <= 0:
        return []
    relevance = np.nan_to_num(relevance, nan=0.0, posinf=0.0, neginf=0.0)
    frame_ms = window_ms / relevance.size
    radius = max(0, region_frames // 2)
    selected: list[int] = []
    for index in np.argsort(relevance)[::-1]:
        if len(selected) >= count:
            break
        if all(abs(int(index) - prior) > region_frames for prior in selected):
            selected.append(int(index))

    return [
        {
            "start_ms": round(max(0.0, (index - radius) * frame_ms)),
            "end_ms": round(min(window_ms, (index + radius + 1) * frame_ms)),
            "importance": round(float(relevance[index]), 5),
            "method": method,
        }
        for index in sorted(selected)
    ]


def occlude_time_regions(
    samples: np.ndarray,
    regions: Iterable[dict[str, object]],
    sample_rate: int,
    baseline_probability: float,
    score_samples: Callable[[np.ndarray], float],
) -> list[dict[str, object]]:
    """Measure causal time sensitivity by silencing selected intervals.

    A positive ``probability_delta`` means removing that interval lowered the
    fake probability, so it supported the spoof prediction. This is stronger
    evidence than attention alone, but adds one model pass per region.
    """

    scored: list[dict[str, object]] = []
    for region in regions:
        start_ms, end_ms = _time_bounds(region)
        start = max(0, int(start_ms * sample_rate / 1_000))
        end = min(samples.size, int(end_ms * sample_rate / 1_000))
        if end <= start:
            continue
        masked = samples.copy()
        masked[start:end] = 0.0
        changed_probability = score_samples(masked)
        scored.append(
            {
                **region,
                "method": "time_occlusion",
                "probability_delta": round(float(baseline_probability - changed_probability), 5),
            }
        )
    return scored


def occlude_frequency_bands(
    samples: np.ndarray,
    sample_rate: int,
    baseline_probability: float,
    score_samples: Callable[[np.ndarray], float],
    *,
    bands_hz: Iterable[tuple[int, int]] = DEFAULT_BANDS_HZ,
) -> list[dict[str, object]]:
    """Measure broad-band causal sensitivity using FFT band attenuation.

    Results support a statement about score sensitivity to a broad band. They
    must not be presented as a discovered or proven fake frequency.
    """

    if samples.size == 0:
        return []
    spectrum = np.fft.rfft(samples)
    frequencies = np.fft.rfftfreq(samples.size, d=1 / sample_rate)
    scored: list[dict[str, object]] = []
    for low_hz, high_hz in bands_hz:
        masked_spectrum = spectrum.copy()
        masked_spectrum[(frequencies >= low_hz) & (frequencies < high_hz)] = 0.0
        masked = np.fft.irfft(masked_spectrum, n=samples.size).astype(np.float32)
        changed_probability = score_samples(masked)
        scored.append(
            {
                "band_hz": [int(low_hz), int(high_hz)],
                "method": "band_occlusion",
                "probability_delta": round(float(baseline_probability - changed_probability), 5),
            }
        )
    return scored


def _time_bounds(region: dict[str, object]) -> tuple[float, float]:
    start = float(region.get("start_ms", 0))
    end = float(region.get("end_ms", start))
    return start, max(start, end)
