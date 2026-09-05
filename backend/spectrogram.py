"""Spectrogram rendering, acoustic features, and signal descriptors.

Architecture
------------
* ``pcm_float`` / ``signal_metrics`` / ``voice_embedding`` / ``cosine_similarity``
  are low-level helpers also consumed by ``inference.py``.  Their signatures must
  not change.
* ``SpectrogramRenderer`` is the primary rendering class.  Call
  ``render_result(chunk)`` to obtain a structured ``SpectrogramResult`` plus
  ``AcousticFeatures``; or call the backward-compatible ``render_base64(chunk)``
  shim for existing callers that only need the PNG string.

Transform specification
-----------------------
* Input:        16 kHz mono PCM (int16 little-endian), 3-second window.
* STFT:         Hann window, frame_size=512 (32 ms), hop=160 (10 ms).
* Mel bank:     128 bins, 0–8000 Hz, converted with a triangular filter bank.
                If ``torchaudio`` is available it is used; otherwise a
                deterministic numpy implementation is used so that the module
                works in a lightweight base environment.
* dB scale:     power_db = 10 * log10(mel_power + 1e-10).
* Normalisation: fixed floor (−80 dB) and ceiling (−10 dB), no per-window
                 autoscaling.  Silence stays dark.
* Palette:      dark-navy → teal → amber → coral (perceptually ordered,
                reasonable for common colour-vision deficiencies).

Acoustic features
-----------------
All features are calculated on the same short-time spectrum.  They describe
audio signal properties; they are NOT deepfake probabilities and must not be
fed into the risk score without a separately evaluated design decision.
"""

from __future__ import annotations

import base64
import io
import math
from dataclasses import dataclass
from typing import Literal

import numpy as np
from PIL import Image

from backend.streaming import AudioChunk

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

SAMPLE_RATE: int = 16_000
FRAME_SIZE: int = 512  # 32 ms at 16 kHz
HOP_SIZE: int = 160  # 10 ms at 16 kHz
N_MEL: int = 128
F_MIN: float = 0.0
F_MAX: float = 8_000.0
FLOOR_DB: float = -80.0
CEILING_DB: float = -10.0
WINDOW_SECONDS: float = 3.0

# Palette colour stops: dark-navy → deep teal → teal → amber → coral
# Chosen to be readable under deuteranopia and protanopia simulations.
PALETTE_STOPS: np.ndarray = np.array(
    [
        [5, 11, 17],  # dark navy   (silence / noise floor)
        [11, 42, 55],  # deep teal
        [16, 103, 107],  # teal
        [77, 215, 164],  # mint-green
        [246, 211, 108],  # amber       (mid-high energy)
        [255, 114, 92],  # coral-red   (peak energy)
    ],
    dtype=np.float32,
)

ScaleType = Literal["mel", "linear"]


# ---------------------------------------------------------------------------
# Dataclasses
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class SignalMetrics:
    rms_dbfs: float
    peak: float
    zero_crossing_rate: float
    state: str


@dataclass(frozen=True, slots=True)
class SpectrogramConfig:
    """Rendering parameters.  Frozen so renderer output is deterministic."""

    scale: ScaleType = "mel"
    n_mel: int = N_MEL
    frame_size: int = FRAME_SIZE
    hop_size: int = HOP_SIZE
    f_min: float = F_MIN
    f_max: float = F_MAX
    floor_db: float = FLOOR_DB
    ceiling_db: float = CEILING_DB
    window_seconds: float = WINDOW_SECONDS


@dataclass(frozen=True, slots=True)
class SpectrogramResult:
    """Structured output from the renderer."""

    image_png_b64: str
    scale: ScaleType
    min_frequency_hz: float
    max_frequency_hz: float
    floor_db: float
    ceiling_db: float
    window_seconds: float

    def as_dict(self) -> dict[str, object]:
        return {
            "image_png_b64": self.image_png_b64,
            "scale": self.scale,
            "min_frequency_hz": self.min_frequency_hz,
            "max_frequency_hz": self.max_frequency_hz,
            "floor_db": self.floor_db,
            "ceiling_db": self.ceiling_db,
            "window_seconds": self.window_seconds,
        }


@dataclass(frozen=True, slots=True)
class AcousticFeatures:
    """Descriptive acoustic properties of a single window.

    These values characterise the audio signal; they are not indicators of
    deepfake content and must not be interpreted as such.
    """

    rms_dbfs: float
    peak_dbfs: float
    clipping_percent: float
    spectral_centroid_hz: float
    spectral_rolloff_hz: float  # frequency below which 85 % of energy sits
    spectral_flatness: float  # 0 = pure tone, 1 = white noise
    dominant_band_hz: tuple[int, int]
    signal_quality: str  # silence | quiet | usable | clipping

    def as_dict(self) -> dict[str, object]:
        return {
            "rms_dbfs": self.rms_dbfs,
            "peak_dbfs": self.peak_dbfs,
            "clipping_percent": self.clipping_percent,
            "spectral_centroid_hz": self.spectral_centroid_hz,
            "spectral_rolloff_hz": self.spectral_rolloff_hz,
            "spectral_flatness": self.spectral_flatness,
            "dominant_band_hz": list(self.dominant_band_hz),
            "signal_quality": self.signal_quality,
        }


@dataclass(slots=True)
class RenderOutput:
    spectrogram: SpectrogramResult
    features: AcousticFeatures


# ---------------------------------------------------------------------------
# Low-level helpers (public API — do not change signatures)
# ---------------------------------------------------------------------------


def pcm_float(chunk: AudioChunk) -> np.ndarray:
    """Convert a raw PCM AudioChunk to float32 samples in [-1, 1]."""
    return np.frombuffer(chunk.pcm, dtype="<i2").astype(np.float32) / 32768.0


def signal_metrics(samples: np.ndarray) -> SignalMetrics:
    """Compute RMS dBFS, peak, ZCR, and a coarse signal state label."""
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
    """Cosine similarity clamped to [0, 1]."""
    denominator = float(np.linalg.norm(left) * np.linalg.norm(right))
    if not denominator:
        return 0.0
    return max(0.0, min(1.0, float(np.dot(left, right) / denominator)))


# ---------------------------------------------------------------------------
# Mel filter bank (numpy implementation — no librosa dependency)
# ---------------------------------------------------------------------------


def _hz_to_mel(hz: float) -> float:
    """Convert Hz to mel scale (HTK formula)."""
    return 2595.0 * math.log10(1.0 + hz / 700.0)


def _mel_to_hz(mel: float) -> float:
    """Convert mel to Hz (HTK formula)."""
    return 700.0 * (10.0 ** (mel / 2595.0) - 1.0)


def _build_mel_filterbank(
    n_mel: int,
    frame_size: int,
    sample_rate: int,
    f_min: float,
    f_max: float,
) -> np.ndarray:
    """Build a mel filter bank matrix of shape (n_mel, n_fft_bins).

    Each row is one triangular mel filter.  The matrix is normalised so that
    each filter integrates to approximately 1 (area normalisation).
    """
    n_fft = frame_size // 2 + 1
    mel_min = _hz_to_mel(f_min)
    mel_max = _hz_to_mel(f_max)

    # n_mel + 2 evenly-spaced points in mel space
    mel_points = np.linspace(mel_min, mel_max, n_mel + 2)
    hz_points = np.array([_mel_to_hz(m) for m in mel_points])

    # Bin indices for each mel point
    fft_freqs = np.linspace(0, sample_rate / 2, n_fft)
    bins = np.searchsorted(fft_freqs, hz_points)

    filterbank = np.zeros((n_mel, n_fft), dtype=np.float32)
    for m in range(n_mel):
        left, center, right = bins[m], bins[m + 1], bins[m + 2]
        # Rising slope
        for k in range(left, center):
            if center > left:
                filterbank[m, k] = (k - left) / (center - left)
        # Falling slope
        for k in range(center, right):
            if right > center:
                filterbank[m, k] = (right - k) / (right - center)

    # Area normalisation
    widths = hz_points[2:] - hz_points[:-2]
    widths = np.maximum(widths, 1e-8)
    filterbank = filterbank / widths[:, None]
    return filterbank


# Cache the filter bank (same config always produces same matrix)
_FILTERBANK_CACHE: dict[tuple, np.ndarray] = {}


def _get_filterbank(
    n_mel: int,
    frame_size: int,
    sample_rate: int,
    f_min: float,
    f_max: float,
) -> np.ndarray:
    key = (n_mel, frame_size, sample_rate, f_min, f_max)
    if key not in _FILTERBANK_CACHE:
        _FILTERBANK_CACHE[key] = _build_mel_filterbank(n_mel, frame_size, sample_rate, f_min, f_max)
    return _FILTERBANK_CACHE[key]


# ---------------------------------------------------------------------------
# Acoustic features computation
# ---------------------------------------------------------------------------

_BAND_BOUNDARIES_HZ: list[tuple[int, int]] = [
    (0, 300),
    (300, 3000),
    (3000, 6000),
    (6000, 8000),
]

_BAND_LABELS: list[str] = ["sub-bass", "speech", "presence", "brilliance"]


def _compute_acoustic_features(
    samples: np.ndarray,
    power_spectrum: np.ndarray,  # shape (n_fft_bins, n_frames), non-negative
    sample_rate: int,
    config: SpectrogramConfig,
) -> AcousticFeatures:
    """Derive acoustic descriptors from samples and an STFT power matrix.

    Parameters
    ----------
    samples:        Float32 samples in [-1, 1].
    power_spectrum: Linear-scale STFT power, shape (n_fft_bins, n_frames).
    sample_rate:    Audio sample rate (Hz).
    config:         Rendering configuration.
    """
    # --- time-domain features ---
    if samples.size == 0:
        rms = 1e-10
        peak = 0.0
        clipping_pct = 0.0
    else:
        rms = float(np.sqrt(np.mean(np.square(samples))))
        peak = float(np.max(np.abs(samples)))
        clipping_pct = round(100.0 * float(np.mean(np.abs(samples) >= 0.99)), 3)

    rms_dbfs = round(max(-96.0, 20 * math.log10(max(rms, 1e-8))), 1)
    peak_dbfs = round(max(-96.0, 20 * math.log10(max(peak, 1e-8))), 1)

    # --- frequency-domain features (averaged over frames) ---
    n_fft_bins = power_spectrum.shape[0]
    freqs = np.linspace(0, sample_rate / 2, n_fft_bins)
    mean_power = np.mean(power_spectrum, axis=1)  # (n_fft_bins,)
    total_power = float(np.sum(mean_power))

    if total_power < 1e-20:
        # Silent frame
        return AcousticFeatures(
            rms_dbfs=rms_dbfs,
            peak_dbfs=peak_dbfs,
            clipping_percent=clipping_pct,
            spectral_centroid_hz=0.0,
            spectral_rolloff_hz=0.0,
            spectral_flatness=0.0,
            dominant_band_hz=(0, 300),
            signal_quality="silence",
        )

    # Spectral centroid
    centroid_hz = round(float(np.sum(freqs * mean_power) / total_power), 1)

    # Spectral rolloff (85 % cumulative energy threshold)
    cumulative = np.cumsum(mean_power)
    rolloff_idx = int(np.searchsorted(cumulative, 0.85 * total_power))
    rolloff_idx = min(rolloff_idx, n_fft_bins - 1)
    rolloff_hz = round(float(freqs[rolloff_idx]), 1)

    # Spectral flatness (geometric mean / arithmetic mean of power)
    # Computed on mean_power to summarise the whole window.
    log_mean = float(np.mean(np.log(mean_power + 1e-10)))
    mean_log = math.log(max(float(np.mean(mean_power)), 1e-10))
    flatness = round(min(1.0, max(0.0, math.exp(log_mean - mean_log))), 4)

    # Dominant band
    band_energies: list[float] = []
    for lo, hi in _BAND_BOUNDARIES_HZ:
        mask = (freqs >= lo) & (freqs < hi)
        band_energies.append(float(np.sum(mean_power[mask])))
    dominant_idx = int(np.argmax(band_energies))
    dominant_band = _BAND_BOUNDARIES_HZ[dominant_idx]

    # Signal quality label
    if peak >= 0.99 and clipping_pct > 0.01:
        quality = "clipping"
    elif rms_dbfs > -45:
        quality = "usable"
    elif rms_dbfs > -70:
        quality = "quiet"
    else:
        quality = "silence"

    return AcousticFeatures(
        rms_dbfs=rms_dbfs,
        peak_dbfs=peak_dbfs,
        clipping_percent=clipping_pct,
        spectral_centroid_hz=centroid_hz,
        spectral_rolloff_hz=rolloff_hz,
        spectral_flatness=flatness,
        dominant_band_hz=dominant_band,
        signal_quality=quality,
    )


# ---------------------------------------------------------------------------
# Colour palette
# ---------------------------------------------------------------------------


def _apply_palette(values: np.ndarray) -> np.ndarray:
    """Map float values in [0, 1] to RGB uint8 via PALETTE_STOPS.

    Parameters
    ----------
    values: Array of floats in [0, 1], any shape.

    Returns
    -------
    Uint8 array of shape (*values.shape, 3).
    """
    stops = PALETTE_STOPS
    scaled = values * (len(stops) - 1)
    indices = np.minimum(scaled.astype(np.int32), len(stops) - 2)
    fraction = (scaled - indices)[..., None]
    return (stops[indices] * (1 - fraction) + stops[indices + 1] * fraction).astype(np.uint8)


# ---------------------------------------------------------------------------
# Main renderer
# ---------------------------------------------------------------------------


class SpectrogramRenderer:
    """Render spectrogram images and compute acoustic features.

    Parameters
    ----------
    width:  Output image width in pixels (time axis).
    height: Output image height in pixels (frequency axis).
    config: Rendering parameters.  Defaults to ``SpectrogramConfig()``.
    """

    def __init__(
        self,
        width: int = 560,
        height: int = 180,
        config: SpectrogramConfig | None = None,
    ) -> None:
        self.width = width
        self.height = height
        self.config = config or SpectrogramConfig()

    # ------------------------------------------------------------------
    # Public API — structured output
    # ------------------------------------------------------------------

    def render_result(self, chunk: AudioChunk) -> RenderOutput:
        """Render one audio chunk and return structured output.

        Returns a ``RenderOutput`` containing:
        - ``spectrogram``: ``SpectrogramResult`` with PNG + metadata.
        - ``features``:    ``AcousticFeatures`` with descriptive properties.
        """
        cfg = self.config
        samples = pcm_float(chunk)
        samples = _safe_samples(samples, cfg.frame_size)

        power_spectrum = _compute_stft_power(samples, cfg.frame_size, cfg.hop_size)
        features = _compute_acoustic_features(samples, power_spectrum, SAMPLE_RATE, cfg)

        if cfg.scale == "mel":
            display_matrix = _apply_mel_bank(power_spectrum, cfg, SAMPLE_RATE)
        else:
            display_matrix = power_spectrum  # (n_fft_bins, n_frames)

        png_b64 = _render_png(display_matrix, cfg, self.width, self.height)

        spec_result = SpectrogramResult(
            image_png_b64=png_b64,
            scale=cfg.scale,
            min_frequency_hz=cfg.f_min,
            max_frequency_hz=cfg.f_max,
            floor_db=cfg.floor_db,
            ceiling_db=cfg.ceiling_db,
            window_seconds=cfg.window_seconds,
        )
        return RenderOutput(spectrogram=spec_result, features=features)

    # ------------------------------------------------------------------
    # Backward-compatible shim
    # ------------------------------------------------------------------

    def render_base64(self, chunk: AudioChunk) -> str:
        """Return the spectrogram as a base64 PNG string.

        Existing callers that only need the image string can continue to use
        this method unchanged.  The underlying rendering now uses stable
        normalisation and the mel projection.
        """
        return self.render_result(chunk).spectrogram.image_png_b64

    # ------------------------------------------------------------------
    # Private (kept for reference / testing)
    # ------------------------------------------------------------------

    @staticmethod
    def _palette(values: np.ndarray) -> np.ndarray:
        """Delegate to module-level palette function (kept for compat)."""
        return _apply_palette(values)


# ---------------------------------------------------------------------------
# Internal rendering helpers
# ---------------------------------------------------------------------------


def _safe_samples(samples: np.ndarray, min_size: int) -> np.ndarray:
    """Sanitise samples: replace NaN/Inf and pad to minimum length."""
    samples = np.nan_to_num(samples, nan=0.0, posinf=0.0, neginf=0.0)
    if samples.size < min_size:
        samples = np.pad(samples, (0, min_size - samples.size))
    return samples


def _compute_stft_power(samples: np.ndarray, frame_size: int, hop_size: int) -> np.ndarray:
    """Compute STFT power spectrum.

    Returns
    -------
    power: shape (n_fft_bins, n_frames), linear scale (not dB).
    """
    window = np.hanning(frame_size).astype(np.float32)
    frames = np.lib.stride_tricks.sliding_window_view(samples, frame_size)[::hop_size]
    # shape: (n_frames, frame_size)
    power = np.abs(np.fft.rfft(frames * window, axis=1)) ** 2  # (n_frames, n_fft)
    return power.T  # (n_fft_bins, n_frames)


def _apply_mel_bank(power: np.ndarray, cfg: SpectrogramConfig, sample_rate: int) -> np.ndarray:
    """Project linear STFT power onto mel bins.

    Returns
    -------
    mel_power: shape (n_mel, n_frames), linear scale.
    """
    filterbank = _get_filterbank(cfg.n_mel, cfg.frame_size, sample_rate, cfg.f_min, cfg.f_max)
    return filterbank @ power  # (n_mel, n_frames)


def _normalize_db(matrix: np.ndarray, floor_db: float, ceiling_db: float) -> np.ndarray:
    """Convert power to dB and normalise to [0, 1] using fixed bounds.

    Parameters
    ----------
    matrix:     Linear-scale power, shape (freq_bins, n_frames).
    floor_db:   dB value that maps to 0.0 (dark).
    ceiling_db: dB value that maps to 1.0 (bright).

    Returns
    -------
    Normalised float32 array in [0, 1], same shape as input.
    """
    db = 10.0 * np.log10(np.maximum(matrix, 1e-10)).astype(np.float32)
    span = ceiling_db - floor_db
    if span < 1e-6:
        span = 1.0
    return np.clip((db - floor_db) / span, 0.0, 1.0)


def _render_png(
    matrix: np.ndarray,
    cfg: SpectrogramConfig,
    width: int,
    height: int,
) -> str:
    """Normalise, colourise, and encode to base64 PNG.

    Parameters
    ----------
    matrix: Linear-scale power, shape (freq_bins, n_frames).
    cfg:    Rendering config (supplies floor/ceiling dB).
    width:  Output image width.
    height: Output image height.
    """
    normalised = _normalize_db(matrix, cfg.floor_db, cfg.ceiling_db)
    # Flip so low frequencies are at the bottom of the image
    rgb = _apply_palette(normalised[::-1])
    image = Image.fromarray(rgb, mode="RGB").resize((width, height), Image.Resampling.BILINEAR)
    buf = io.BytesIO()
    image.save(buf, format="PNG", optimize=True)
    return base64.b64encode(buf.getvalue()).decode("ascii")
