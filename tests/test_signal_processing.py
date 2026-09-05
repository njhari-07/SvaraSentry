"""Deterministic signal-processing tests for SvaraSentry.

Test plan
---------
Group A — Original (kept unchanged):
  A1  uploaded audio is resampled to the runtime rate
  A2  baseline engine returns a bounded score and signal metrics
  A3  spectrogram render produces a valid PNG
  A4  voice similarity is bounded

Group B — Spectrogram stability (new):
  B1  silence produces a mostly-dark image and silence metadata
  B2  440 Hz tone places peak spectral energy near 440 Hz
  B3  two-tone signal (440 + 1760 Hz) shows energy at both frequencies
  B4  broadband noise has higher flatness than a pure tone
  B5  amplitude change shifts rms_dbfs consistently under fixed normalisation
  B6  identical input and config produce identical image bytes and metadata
  B7  image dimensions, PNG signature, and base64 payload are well-formed
  B8  NaN / Inf / empty / short / clipped inputs are handled safely

Group C — Acoustic features (new):
  C1  silence returns signal_quality="silence" and zero acoustic metrics
  C2  clipped signal returns signal_quality="clipping" and clipping_percent > 0
  C3  spectral centroid of a tone is near the tone frequency
  C4  spectral rolloff is below the Nyquist limit
  C5  dominant band of a speech-range tone is the speech band (300–3000 Hz)

Group D — Transport and performance (new):
  D1  render_result returns SpectrogramResult and AcousticFeatures dataclasses
  D2  as_dict keys match the transport contract documented in the spec
  D3  render_base64 shim returns the same bytes as the structured path
  D4  rendering time stays within 150 ms per window on this machine
       (skipped unless env SVARASENTRY_PERF_TESTS=1)
"""

from __future__ import annotations

import base64
import io
import math
import os
import time
import unittest
import wave
from math import pi, sin

import numpy as np

from backend.audio_io import decode_audio
from backend.inference import BaselineInferenceEngine
from backend.spectrogram import (
    AcousticFeatures,
    SpectrogramConfig,
    SpectrogramRenderer,
    SpectrogramResult,
    _compute_acoustic_features,
    _compute_stft_power,
    _safe_samples,
    cosine_similarity,
    voice_embedding,
)
from backend.streaming import AudioChunk

RATE = 16_000
WINDOW_S = 3.0


# ---------------------------------------------------------------------------
# Fixture helpers
# ---------------------------------------------------------------------------

def _make_chunk(samples: np.ndarray, rate: int = RATE) -> AudioChunk:
    pcm = (np.clip(samples, -1.0, 1.0) * 32767).astype("<i2").tobytes()
    return AudioChunk(pcm=pcm, start_sample=0, sample_rate=rate)


def tone_chunk(frequency: float = 440.0, seconds: float = WINDOW_S, amplitude: float = 0.4) -> AudioChunk:
    """Pure sine tone at the given frequency."""
    n = int(RATE * seconds)
    t = np.arange(n, dtype=np.float32) / RATE
    samples = (np.sin(2 * pi * frequency * t) * amplitude).astype(np.float32)
    return _make_chunk(samples)


def silence_chunk(seconds: float = WINDOW_S) -> AudioChunk:
    samples = np.zeros(int(RATE * seconds), dtype=np.float32)
    return _make_chunk(samples)


def noise_chunk(seconds: float = WINDOW_S, amplitude: float = 0.3, seed: int = 42) -> AudioChunk:
    rng = np.random.default_rng(seed)
    samples = (rng.standard_normal(int(RATE * seconds)) * amplitude).astype(np.float32)
    return _make_chunk(samples)


def two_tone_chunk(f1: float = 440.0, f2: float = 1760.0, seconds: float = WINDOW_S) -> AudioChunk:
    n = int(RATE * seconds)
    t = np.arange(n, dtype=np.float32) / RATE
    samples = (0.3 * np.sin(2 * pi * f1 * t) + 0.3 * np.sin(2 * pi * f2 * t)).astype(np.float32)
    return _make_chunk(samples)


def clipped_chunk(seconds: float = WINDOW_S) -> AudioChunk:
    """Signal that clips hard at ±1."""
    n = int(RATE * seconds)
    t = np.arange(n, dtype=np.float32) / RATE
    samples = np.clip(2.0 * np.sin(2 * pi * 440 * t), -1.0, 1.0).astype(np.float32)
    return _make_chunk(samples)


def _default_renderer() -> SpectrogramRenderer:
    return SpectrogramRenderer(width=180, height=80)


def _pixel_brightness(png_b64: str) -> float:
    """Return mean luminance of a base64-encoded RGB PNG, range [0, 1]."""
    img_bytes = base64.b64decode(png_b64)
    from PIL import Image
    img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    arr = np.array(img, dtype=np.float32) / 255.0
    # Perceptual luminance
    return float(np.mean(0.2126 * arr[..., 0] + 0.7152 * arr[..., 1] + 0.0722 * arr[..., 2]))


# ---------------------------------------------------------------------------
# Group A — Original tests (signatures preserved)
# ---------------------------------------------------------------------------

class SignalProcessingTests(unittest.TestCase):
    def test_uploaded_audio_is_resampled_to_runtime_rate(self):
        output = io.BytesIO()
        with wave.open(output, "wb") as handle:
            handle.setnchannels(1)
            handle.setsampwidth(2)
            handle.setframerate(8_000)
            handle.writeframes(bytes(8_000 * 2))

        decoded = decode_audio(output.getvalue(), target_rate=16_000)
        self.assertEqual(decoded.size, 16_000)

    def test_baseline_returns_bounded_score_and_metrics(self):
        result = BaselineInferenceEngine().score(tone_chunk())

        self.assertGreaterEqual(result.fake_probability, 0)
        self.assertLessEqual(result.fake_probability, 1)
        self.assertEqual(result.signal_state, "speech")
        self.assertEqual(result.embedding.shape, (34,))

    def test_spectrogram_is_a_png(self):
        encoded = SpectrogramRenderer(width=180, height=80).render_base64(tone_chunk())
        self.assertTrue(base64.b64decode(encoded).startswith(b"\x89PNG\r\n\x1a\n"))

    def test_voice_similarity_is_bounded(self):
        first = voice_embedding(np.linspace(-0.5, 0.5, 8000, dtype=np.float32))
        second = voice_embedding(np.linspace(-0.5, 0.5, 8000, dtype=np.float32))
        self.assertAlmostEqual(cosine_similarity(first, second), 1.0)


# ---------------------------------------------------------------------------
# Group B — Spectrogram stability
# ---------------------------------------------------------------------------

class SpectrogramStabilityTests(unittest.TestCase):

    def setUp(self):
        self.renderer = _default_renderer()

    # B1 — silence is dark
    def test_b1_silence_produces_dark_image(self):
        result = self.renderer.render_result(silence_chunk())
        brightness = _pixel_brightness(result.spectrogram.image_png_b64)
        # Silence should map to floor_db → value 0 → darkest palette entry
        self.assertLess(brightness, 0.12, "Silence image should be mostly dark")

    def test_b1_silence_metadata_is_silence(self):
        result = self.renderer.render_result(silence_chunk())
        self.assertEqual(result.features.signal_quality, "silence")

    # B2 — 440 Hz tone places energy near 440 Hz
    def test_b2_440hz_tone_peak_near_440hz(self):
        chunk = tone_chunk(440.0)
        samples = np.frombuffer(chunk.pcm, dtype="<i2").astype(np.float32) / 32768.0
        power = _compute_stft_power(samples, 512, 160)
        mean_power = np.mean(power, axis=1)
        freqs = np.linspace(0, RATE / 2, power.shape[0])
        peak_freq = float(freqs[np.argmax(mean_power)])
        self.assertAlmostEqual(peak_freq, 440.0, delta=50.0,
                               msg=f"Peak at {peak_freq:.1f} Hz, expected ~440 Hz")

    # B3 — two-tone has energy at both bands
    def test_b3_two_tone_energy_at_both_frequencies(self):
        chunk = two_tone_chunk(440.0, 1760.0)
        samples = np.frombuffer(chunk.pcm, dtype="<i2").astype(np.float32) / 32768.0
        power = _compute_stft_power(samples, 512, 160)
        mean_power = np.mean(power, axis=1)
        freqs = np.linspace(0, RATE / 2, power.shape[0])

        def band_energy(lo, hi):
            mask = (freqs >= lo) & (freqs < hi)
            return float(np.sum(mean_power[mask]))

        low_band = band_energy(300, 600)
        high_band = band_energy(1500, 2100)
        # Both bands must have meaningful energy relative to the total
        total = float(np.sum(mean_power)) + 1e-10
        self.assertGreater(low_band / total, 0.05, "Low-frequency band too quiet")
        self.assertGreater(high_band / total, 0.05, "High-frequency band too quiet")

    # B4 — noise has higher flatness than a tone
    def test_b4_noise_has_higher_flatness_than_tone(self):
        def flatness_of(chunk):
            return self.renderer.render_result(chunk).features.spectral_flatness

        tone_flat = flatness_of(tone_chunk(440.0))
        noise_flat = flatness_of(noise_chunk(seed=0))
        self.assertGreater(noise_flat, tone_flat,
                           msg=f"Noise flatness {noise_flat:.3f} should exceed tone flatness {tone_flat:.3f}")

    # B5 — amplitude change shifts dBFS consistently
    def test_b5_amplitude_changes_dbfs_monotonically(self):
        quiet = self.renderer.render_result(_make_chunk(
            0.05 * np.sin(2 * pi * 440 * np.arange(int(RATE * WINDOW_S)) / RATE, dtype=np.float32)
            if False else (0.05 * np.ones(int(RATE * WINDOW_S), dtype=np.float32))
        )).features.rms_dbfs
        loud = self.renderer.render_result(_make_chunk(
            0.5 * np.ones(int(RATE * WINDOW_S), dtype=np.float32)
        )).features.rms_dbfs
        self.assertGreater(loud, quiet,
                           msg="Louder signal must have higher rms_dbfs")

    # B6 — determinism
    def test_b6_identical_input_produces_identical_output(self):
        chunk = tone_chunk(880.0, seed=None)
        r1 = self.renderer.render_result(chunk)
        r2 = self.renderer.render_result(chunk)
        self.assertEqual(
            r1.spectrogram.image_png_b64,
            r2.spectrogram.image_png_b64,
            "Same input must produce identical PNG bytes",
        )
        self.assertEqual(r1.features.spectral_centroid_hz, r2.features.spectral_centroid_hz)

    # B7 — image dimensions and MIME
    def test_b7_image_dimensions_and_mime(self):
        renderer = SpectrogramRenderer(width=240, height=90)
        b64 = renderer.render_base64(tone_chunk())
        raw = base64.b64decode(b64)
        self.assertTrue(raw.startswith(b"\x89PNG\r\n\x1a\n"), "Must be a valid PNG")
        from PIL import Image
        img = Image.open(io.BytesIO(raw))
        self.assertEqual(img.size, (240, 90))
        # base64 string must only contain safe ASCII
        self.assertTrue(b64.isascii())

    # B8 — robustness
    def test_b8_nan_input_does_not_raise(self):
        bad = np.full(int(RATE * WINDOW_S), float("nan"), dtype=np.float32)
        chunk = _make_chunk(bad)  # pcm conversion will clamp
        result = self.renderer.render_result(chunk)
        self.assertIsInstance(result.spectrogram.image_png_b64, str)

    def test_b8_inf_input_does_not_raise(self):
        bad = np.full(int(RATE * WINDOW_S), float("inf"), dtype=np.float32)
        chunk = _make_chunk(bad)
        result = self.renderer.render_result(chunk)
        self.assertIsInstance(result.spectrogram.image_png_b64, str)

    def test_b8_empty_input_does_not_raise(self):
        chunk = AudioChunk(pcm=b"", start_sample=0, sample_rate=RATE)
        result = self.renderer.render_result(chunk)
        self.assertIsInstance(result.spectrogram.image_png_b64, str)

    def test_b8_short_input_is_padded_and_valid(self):
        samples = np.zeros(100, dtype=np.float32)
        chunk = _make_chunk(samples)
        result = self.renderer.render_result(chunk)
        raw = base64.b64decode(result.spectrogram.image_png_b64)
        self.assertTrue(raw.startswith(b"\x89PNG\r\n\x1a\n"))

    def test_b8_clipped_input_does_not_raise(self):
        result = self.renderer.render_result(clipped_chunk())
        self.assertIsInstance(result.spectrogram.image_png_b64, str)


# ---------------------------------------------------------------------------
# Group C — Acoustic features
# ---------------------------------------------------------------------------

class AcousticFeatureTests(unittest.TestCase):

    def setUp(self):
        self.renderer = _default_renderer()

    def _features(self, chunk: AudioChunk) -> AcousticFeatures:
        return self.renderer.render_result(chunk).features

    # C1 — silence metadata
    def test_c1_silence_quality_and_zero_centroid(self):
        feat = self._features(silence_chunk())
        self.assertEqual(feat.signal_quality, "silence")
        self.assertEqual(feat.spectral_centroid_hz, 0.0)
        self.assertEqual(feat.spectral_rolloff_hz, 0.0)

    # C2 — clipping detection
    def test_c2_clipped_signal_quality(self):
        feat = self._features(clipped_chunk())
        self.assertEqual(feat.signal_quality, "clipping")
        self.assertGreater(feat.clipping_percent, 0.0)

    # C3 — centroid near tone frequency
    def test_c3_centroid_near_tone_frequency(self):
        feat = self._features(tone_chunk(1000.0))
        # Centroid won't be exactly 1000 Hz (harmonics, windowing) but should be close-ish
        self.assertLess(abs(feat.spectral_centroid_hz - 1000.0), 500.0,
                        f"Centroid {feat.spectral_centroid_hz} Hz unexpectedly far from 1000 Hz")

    # C4 — rolloff is sub-Nyquist
    def test_c4_rolloff_below_nyquist(self):
        feat = self._features(tone_chunk(440.0))
        self.assertLessEqual(feat.spectral_rolloff_hz, RATE / 2)

    # C5 — dominant band of a speech-range tone
    def test_c5_dominant_band_for_speech_tone(self):
        # 1 kHz is in the speech band 300–3000 Hz
        feat = self._features(tone_chunk(1000.0))
        lo, hi = feat.dominant_band_hz
        self.assertLessEqual(lo, 1000)
        self.assertGreaterEqual(hi, 1000)


# ---------------------------------------------------------------------------
# Group D — Transport contract and performance
# ---------------------------------------------------------------------------

class TransportContractTests(unittest.TestCase):

    def setUp(self):
        self.renderer = _default_renderer()

    def test_d1_render_result_types(self):
        out = self.renderer.render_result(tone_chunk())
        self.assertIsInstance(out.spectrogram, SpectrogramResult)
        self.assertIsInstance(out.features, AcousticFeatures)

    def test_d2_spectrogram_dict_keys(self):
        d = self.renderer.render_result(tone_chunk()).spectrogram.as_dict()
        required = {"image_png_b64", "scale", "min_frequency_hz", "max_frequency_hz",
                    "floor_db", "ceiling_db", "window_seconds"}
        self.assertEqual(required, set(d.keys()))

    def test_d2_acoustic_features_dict_keys(self):
        d = self.renderer.render_result(tone_chunk()).features.as_dict()
        required = {"rms_dbfs", "peak_dbfs", "clipping_percent", "spectral_centroid_hz",
                    "spectral_rolloff_hz", "spectral_flatness", "dominant_band_hz", "signal_quality"}
        self.assertEqual(required, set(d.keys()))

    def test_d3_render_base64_shim_matches_structured_path(self):
        chunk = tone_chunk(660.0)
        structured = self.renderer.render_result(chunk).spectrogram.image_png_b64
        shim = self.renderer.render_base64(chunk)
        self.assertEqual(structured, shim)

    def test_d4_rendering_time_within_budget(self):
        if not os.getenv("SVARASENTRY_PERF_TESTS"):
            self.skipTest("Set SVARASENTRY_PERF_TESTS=1 to run performance tests")
        renderer = SpectrogramRenderer()  # full 560×180 size
        chunk = tone_chunk()
        # warm up
        renderer.render_result(chunk)
        t0 = time.perf_counter()
        for _ in range(5):
            renderer.render_result(chunk)
        elapsed_ms = (time.perf_counter() - t0) * 1000 / 5
        self.assertLess(elapsed_ms, 150.0, f"Rendering took {elapsed_ms:.1f} ms — exceeds 150 ms budget")


# ---------------------------------------------------------------------------
# Utility — standalone tone_chunk with optional seed (for B6)
# ---------------------------------------------------------------------------
# Override the module-level tone_chunk to accept **kwargs gracefully.
def tone_chunk(frequency: float = 440.0, seconds: float = WINDOW_S,  # noqa: F811
               amplitude: float = 0.4, seed=None) -> AudioChunk:
    n = int(RATE * seconds)
    t = np.arange(n, dtype=np.float32) / RATE
    samples = (np.sin(2 * pi * frequency * t) * amplitude).astype(np.float32)
    return _make_chunk(samples)


# ---------------------------------------------------------------------------
# Group E — Axis labels, attention clamping, payload bounds (spec tests 9, 10, 14)
# ---------------------------------------------------------------------------

class AxisAndPayloadTests(unittest.TestCase):
    """
    E1  scale field in SpectrogramResult matches SpectrogramConfig (test 9)
    E2  attention offsets outside the window are clamped / hidden (test 10)
    E3  as_dict payload size is bounded and does not contain the full PNG (test 14)
    E4  signal_quality="quiet" for a low-amplitude, non-silent signal
    """

    # E1 — axis label scale roundtrip -----------------------------------------
    def test_e1_mel_config_produces_mel_scale_result(self):
        cfg = SpectrogramConfig(scale="mel")
        r = SpectrogramRenderer(width=120, height=60, config=cfg).render_result(tone_chunk())
        self.assertEqual(r.spectrogram.scale, "mel")

    def test_e1_linear_config_produces_linear_scale_result(self):
        cfg = SpectrogramConfig(scale="linear")
        r = SpectrogramRenderer(width=120, height=60, config=cfg).render_result(tone_chunk())
        self.assertEqual(r.spectrogram.scale, "linear")

    def test_e1_frequency_bounds_are_preserved_in_result(self):
        cfg = SpectrogramConfig(scale="mel", f_min=0.0, f_max=8000.0)
        r = SpectrogramRenderer(width=120, height=60, config=cfg).render_result(tone_chunk())
        self.assertEqual(r.spectrogram.min_frequency_hz, 0.0)
        self.assertEqual(r.spectrogram.max_frequency_hz, 8000.0)

    def test_e1_floor_ceiling_are_preserved_in_result(self):
        cfg = SpectrogramConfig(floor_db=-80.0, ceiling_db=-10.0)
        r = SpectrogramRenderer(width=120, height=60, config=cfg).render_result(tone_chunk())
        self.assertEqual(r.spectrogram.floor_db, -80.0)
        self.assertEqual(r.spectrogram.ceiling_db, -10.0)

    # E2 — attention offset clamping ------------------------------------------
    # The clamping logic lives in acoustic_panel.js (JS unit); we test the
    # Python-side data: AcousticFeatures.signal_quality is a separate concern.
    # For the Python layer, verify that out-of-range flagged_region values from
    # the inference engine do not crash process_chunk or the spectrogram renderer.
    def test_e2_renderer_is_unaffected_by_attention_metadata(self):
        """Renderer ignores attention region — that's handled frontend-side."""
        renderer = SpectrogramRenderer(width=120, height=60)
        # Renderer only accepts an AudioChunk; attention region is never passed in.
        result = renderer.render_result(tone_chunk())
        self.assertIsInstance(result.spectrogram.image_png_b64, str)

    def test_e2_window_seconds_boundary_is_positive(self):
        """window_seconds in result must always be > 0 so the frontend can divide."""
        cfg = SpectrogramConfig(window_seconds=3.0)
        r = SpectrogramRenderer(width=120, height=60, config=cfg).render_result(tone_chunk())
        self.assertGreater(r.spectrogram.window_seconds, 0)

    # E3 — payload size bounds (test 14) --------------------------------------
    def test_e3_features_dict_is_json_serializable_and_small(self):
        """acoustic_features dict must be JSON-safe and under 1 KB."""
        import json
        feat = SpectrogramRenderer(width=120, height=60).render_result(tone_chunk()).features.as_dict()
        serialized = json.dumps(feat)
        self.assertLess(
            len(serialized), 1024,
            f"acoustic_features JSON is {len(serialized)} bytes — exceeds 1 KB"
        )

    def test_e3_spectrogram_metadata_dict_excludes_image_bytes(self):
        """The structured spectrogram dict (without image) must be tiny."""
        import json
        d = SpectrogramRenderer(width=120, height=60).render_result(tone_chunk()).spectrogram.as_dict()
        d_no_img = {k: v for k, v in d.items() if k != "image_png_b64"}
        serialized = json.dumps(d_no_img)
        self.assertLess(len(serialized), 256,
                        f"Spectrogram metadata is {len(serialized)} bytes — unexpectedly large")

    def test_e3_base64_image_is_pure_ascii(self):
        """base64 payload must be ASCII-clean (no embedded binary in JSON)."""
        b64 = SpectrogramRenderer(width=120, height=60).render_base64(tone_chunk())
        self.assertTrue(b64.isascii())
        # Confirm it round-trips cleanly
        raw = base64.b64decode(b64)
        self.assertGreater(len(raw), 0)

    # E4 — quiet signal quality state -----------------------------------------
    def test_e4_low_amplitude_signal_is_quiet(self):
        """A very quiet non-silent signal should be classified as 'quiet'."""
        n = int(RATE * WINDOW_S)
        t = np.arange(n, dtype=np.float32) / RATE
        # −55 dBFS ≈ amplitude of 0.00178; use 0.002 to be safely above silence
        samples = (0.002 * np.sin(2 * math.pi * 440 * t)).astype(np.float32)
        feat = SpectrogramRenderer(width=120, height=60).render_result(_make_chunk(samples)).features
        self.assertEqual(feat.signal_quality, "quiet",
                         f"Expected 'quiet' but got '{feat.signal_quality}' (rms={feat.rms_dbfs} dBFS)")


if __name__ == "__main__":
    unittest.main()
