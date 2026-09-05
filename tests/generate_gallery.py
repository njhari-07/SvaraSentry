"""Visual QA gallery — generates reference spectrograms for manual inspection.

Usage
-----
    python tests/generate_gallery.py

Outputs PNG files to tests/fixtures/gallery/.  These files are for developer
reference; they are not part of the automated test suite.

Fixtures generated (matches the spec gallery requirement)
----------------------------------------------------------
  silence.png            — Pure digital silence
  quiet_hum.png          — 60 Hz hum at low amplitude
  quiet_speech.png       — Speech-band noise at low amplitude (~-52 dBFS)
  voiced_1khz.png        — 1 kHz pure tone (simulates voiced speech band)
  fricative_noise.png    — Broadband noise above 3 kHz (fricative approximation)
  two_tone_440_1760.png  — 440 Hz + 1760 Hz dual tone
  speech_band_noise.png  — Bandlimited noise 300–3000 Hz
  music_like.png         — Harmonic chord (A3 root + major third + fifth + octaves)
  high_energy_broadband  — Near-full-scale broadband signal
  clipping.png           — Hard-clipped sine wave
"""

from __future__ import annotations

import base64
import io
import sys
from math import pi
from pathlib import Path

import numpy as np
from PIL import Image

# Ensure the project root is on the path when run directly.
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.spectrogram import SpectrogramRenderer
from backend.streaming import AudioChunk

RATE = 16_000
WINDOW_S = 3.0
N = int(RATE * WINDOW_S)
OUT_DIR = ROOT / "tests" / "fixtures" / "gallery"
RENDERER = SpectrogramRenderer(width=560, height=180)


def _chunk(samples: np.ndarray) -> AudioChunk:
    pcm = (np.clip(samples, -1.0, 1.0) * 32767).astype("<i2").tobytes()
    return AudioChunk(pcm=pcm, start_sample=0, sample_rate=RATE)


def _save(name: str, chunk: AudioChunk) -> None:
    result = RENDERER.render_result(chunk)
    png_bytes = base64.b64decode(result.spectrogram.image_png_b64)
    path = OUT_DIR / f"{name}.png"
    path.write_bytes(png_bytes)
    feat = result.features
    print(
        f"  {name:25s}  quality={feat.signal_quality:8s}  "
        f"rms={feat.rms_dbfs:6.1f} dBFS  "
        f"centroid={feat.spectral_centroid_hz:6.0f} Hz  "
        f"flatness={feat.spectral_flatness:.3f}"
    )


def bandlimited_noise(lo_hz: float, hi_hz: float, amplitude: float = 0.3, seed: int = 0) -> np.ndarray:
    rng = np.random.default_rng(seed)
    noise = rng.standard_normal(N).astype(np.float32)
    # Simple brick-wall FFT filter
    spectrum = np.fft.rfft(noise)
    freqs = np.fft.rfftfreq(N, 1 / RATE)
    mask = (freqs >= lo_hz) & (freqs <= hi_hz)
    spectrum[~mask] = 0
    filtered = np.fft.irfft(spectrum, n=N).astype(np.float32)
    peak = np.max(np.abs(filtered)) + 1e-8
    return filtered / peak * amplitude


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Writing gallery to {OUT_DIR}\n")

    t = np.arange(N, dtype=np.float32) / RATE

    fixtures: list[tuple[str, np.ndarray]] = [
        # (name, samples)
        ("silence",
         np.zeros(N, dtype=np.float32)),

        ("quiet_hum",
         (0.02 * np.sin(2 * pi * 60 * t)).astype(np.float32)),

        ("quiet_speech",
         # Speech-band noise at low amplitude (~-52 dBFS) — simulates a distant or quiet speaker
         bandlimited_noise(300, 3000, amplitude=0.0025, seed=3)),

        ("voiced_1khz",
         (0.4 * np.sin(2 * pi * 1000 * t)).astype(np.float32)),

        ("fricative_noise",
         bandlimited_noise(3000, 8000, amplitude=0.25)),

        ("two_tone_440_1760",
         (0.3 * np.sin(2 * pi * 440 * t) + 0.3 * np.sin(2 * pi * 1760 * t)).astype(np.float32)),

        ("speech_band_noise",
         bandlimited_noise(300, 3000, amplitude=0.35)),

        ("music_like",
         # Harmonic chord: root + 3rd + 5th + octave (simulates musical content)
         (lambda t: (
             0.25 * np.sin(2 * pi * 220 * t) +   # A3 root
             0.20 * np.sin(2 * pi * 277 * t) +   # C#4 major third
             0.18 * np.sin(2 * pi * 330 * t) +   # E4 fifth
             0.15 * np.sin(2 * pi * 440 * t) +   # A4 octave
             0.10 * np.sin(2 * pi * 880 * t)     # A5 second octave
         ).astype(np.float32))(t)),

        ("high_energy_broadband",
         bandlimited_noise(0, 8000, amplitude=0.7, seed=7)),

        ("clipping",
         np.clip(2.0 * np.sin(2 * pi * 440 * t), -1.0, 1.0).astype(np.float32)),
    ]

    for name, samples in fixtures:
        _save(name, _chunk(samples))

    print(f"\nDone — {len(fixtures)} images written to {OUT_DIR}")


if __name__ == "__main__":
    main()
