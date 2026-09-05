"""Training-only, reproducible waveform augmentation for 16 kHz speech.

``AudioAugmenter`` accepts already decoded, mono audio at its configured sample
rate.  It never inspects labels and always returns a contiguous ``float32``
three-second waveform.  Decode and any source-rate conversion belong in the
dataset layer, so serving code is deliberately not coupled to this module.
"""

from __future__ import annotations

import shutil
import subprocess
from collections import OrderedDict
from collections.abc import Sequence
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Literal

import torch
from torch.nn import functional as F

_ASSET_SUFFIXES = {".wav", ".flac"}
_EPSILON = 1e-8


@dataclass(frozen=True, slots=True)
class GainConfig:
    probability: float = 0.45
    min_db: float = -8.0
    max_db: float = 6.0


@dataclass(frozen=True, slots=True)
class NoiseConfig:
    probability: float = 0.45
    min_snr_db: float = 8.0
    max_snr_db: float = 35.0
    asset_dir: Path | None = None


@dataclass(frozen=True, slots=True)
class RirConfig:
    probability: float = 0.25
    min_wet: float = 0.20
    max_wet: float = 0.80
    asset_dir: Path | None = None


@dataclass(frozen=True, slots=True)
class ResampleConfig:
    probability: float = 0.25
    intermediate_rates: tuple[int, ...] = (8_000, 12_000, 22_050, 24_000)


@dataclass(frozen=True, slots=True)
class FilterConfig:
    probability: float = 0.25
    max_db: float = 6.0
    telephone_probability: float = 0.25


@dataclass(frozen=True, slots=True)
class SpeedConfig:
    probability: float = 0.20
    min_factor: float = 0.95
    max_factor: float = 1.05


@dataclass(frozen=True, slots=True)
class SaturationConfig:
    probability: float = 0.10
    min_drive: float = 1.1
    max_drive: float = 1.8


@dataclass(frozen=True, slots=True)
class CodecConfig:
    """Lossy codec round-trip settings for realistic VoIP channel artifacts."""

    enabled: bool = False
    probability: float = 0.20
    codec: Literal["opus"] = "opus"
    bitrates_kbps: tuple[int, ...] = (12, 16, 24)
    application: Literal["voip", "audio"] = "voip"
    binary: str | None = None


@dataclass(frozen=True, slots=True)
class AugmentationConfig:
    sample_rate: int = 16_000
    window_samples: int = 48_000
    enabled: bool = True
    unchanged_probability: float = 0.20
    max_random_transforms: int = 3
    padding: Literal["zero", "reflect"] = "zero"
    gain: GainConfig = field(default_factory=GainConfig)
    noise: NoiseConfig = field(default_factory=NoiseConfig)
    rir: RirConfig = field(default_factory=RirConfig)
    resample: ResampleConfig = field(default_factory=ResampleConfig)
    filtering: FilterConfig = field(default_factory=FilterConfig)
    speed: SpeedConfig = field(default_factory=SpeedConfig)
    saturation: SaturationConfig = field(default_factory=SaturationConfig)
    codec: CodecConfig = field(default_factory=CodecConfig)

    def __post_init__(self) -> None:
        if self.sample_rate <= 0 or self.window_samples <= 0:
            raise ValueError("sample_rate and window_samples must be positive")
        if self.padding not in {"zero", "reflect"}:
            raise ValueError("padding must be 'zero' or 'reflect'")
        if self.max_random_transforms < 0:
            raise ValueError("max_random_transforms must be non-negative")
        for probability in (
            self.unchanged_probability,
            self.gain.probability,
            self.noise.probability,
            self.rir.probability,
            self.resample.probability,
            self.filtering.probability,
            self.speed.probability,
            self.saturation.probability,
            self.codec.probability,
        ):
            if not 0.0 <= probability <= 1.0:
                raise ValueError("all augmentation probabilities must be in [0, 1]")
        if self.gain.min_db > self.gain.max_db or self.noise.min_snr_db > self.noise.max_snr_db:
            raise ValueError("minimum augmentation values may not exceed maximum values")
        if not self.resample.intermediate_rates or any(
            rate <= 0 for rate in self.resample.intermediate_rates
        ):
            raise ValueError(
                "intermediate resample rates must be a non-empty set of positive values"
            )
        if (
            self.rir.min_wet > self.rir.max_wet
            or not 0 <= self.rir.min_wet <= 1
            or not 0 <= self.rir.max_wet <= 1
        ):
            raise ValueError("RIR wet mix must be in [0, 1]")
        if self.speed.min_factor <= 0 or self.speed.min_factor > self.speed.max_factor:
            raise ValueError("speed factors must be positive and ordered")
        if (
            self.filtering.max_db < 0
            or self.saturation.min_drive <= 0
            or self.saturation.min_drive > self.saturation.max_drive
        ):
            raise ValueError("filter and saturation ranges are invalid")
        if self.codec.codec != "opus":
            raise ValueError("only the Opus codec is currently supported")
        if not self.codec.bitrates_kbps or any(rate <= 0 for rate in self.codec.bitrates_kbps):
            raise ValueError("codec bitrates_kbps must be a non-empty set of positive values")
        if self.codec.application not in {"voip", "audio"}:
            raise ValueError("codec application must be 'voip' or 'audio'")


@dataclass(frozen=True, slots=True)
class AugmentationResult:
    waveform: torch.Tensor
    applied: list[dict[str, Any]]


class AugmentationAssets:
    """Indexes optional noise/RIR assets and lazily caches decoded CPU tensors.

    Supplying an asset directory is an explicit request to enable that asset
    class.  A missing or invalid directory raises early instead of weakening an
    experiment without notice.  When no directory is supplied, the associated
    transform is simply unavailable.
    """

    def __init__(self, config: AugmentationConfig, cache_size: int = 16) -> None:
        self.sample_rate = config.sample_rate
        self.cache_size = cache_size
        self.noise = self._index(config.noise.asset_dir, "noise")
        self.rir = self._index(config.rir.asset_dir, "RIR")
        self._cache: OrderedDict[Path, torch.Tensor] = OrderedDict()

    def _index(self, directory: Path | None, kind: str) -> tuple[Path, ...]:
        if directory is None:
            return ()
        directory = Path(directory)
        if not directory.is_dir():
            raise ValueError(f"{kind} asset directory does not exist: {directory}")
        paths = tuple(
            sorted(p for p in directory.rglob("*") if p.suffix.lower() in _ASSET_SUFFIXES)
        )
        valid: list[Path] = []
        for path in paths:
            try:
                audio, source_rate = _decode_asset(path)
                if source_rate != self.sample_rate:
                    audio = _resample(audio, source_rate, self.sample_rate)
                if audio.numel() and torch.sqrt(torch.mean(audio.square())).item() > 1e-5:
                    valid.append(path)
            except (OSError, RuntimeError, ValueError):
                continue
        if not valid:
            raise ValueError(f"no valid, non-silent {kind} assets found in {directory}")
        return tuple(valid)

    def load(self, path: Path) -> torch.Tensor:
        cached = self._cache.get(path)
        if cached is not None:
            self._cache.move_to_end(path)
            return cached.clone()
        audio, source_rate = _decode_asset(path)
        if source_rate != self.sample_rate:
            audio = _resample(audio, source_rate, self.sample_rate)
        if not audio.numel() or not torch.isfinite(audio).all():
            raise ValueError(f"invalid augmentation asset: {path}")
        self._cache[path] = audio.contiguous()
        self._cache.move_to_end(path)
        while len(self._cache) > self.cache_size:
            self._cache.popitem(last=False)
        return audio.clone()


class AudioAugmenter:
    """Prepare one mono waveform for a model training or evaluation window.

    ``training=False`` disables every stochastic operation, including random
    cropping.  Speed perturbation uses a resampling-style implementation and
    therefore changes pitch along with duration; its narrow range is deliberate.
    Codec augmentation uses a controlled FFmpeg Opus round-trip when enabled.
    """

    def __init__(
        self,
        config: AugmentationConfig,
        assets: AugmentationAssets | None = None,
        *,
        training: bool = True,
    ) -> None:
        self.config = config
        self.training = training
        self.codec_binary: str | None = None
        self.codec_version: str | None = None
        if self.training and self.config.enabled and self.config.codec.enabled:
            self.codec_binary = _resolve_ffmpeg(self.config.codec.binary)
            self.codec_version = _ffmpeg_version(self.codec_binary)
        # Evaluation has no stochastic asset transforms. Avoid a multi-second
        # scan of thousands of assets and allow validation/test to run without
        # locally installed augmentation collections.
        self.assets = assets
        if self.assets is None and self.training and self.config.enabled:
            self.assets = AugmentationAssets(config)

    def __call__(
        self,
        waveform: torch.Tensor,
        *,
        source_sample_rate: int,
        generator: torch.Generator | None = None,
    ) -> torch.Tensor:
        return self.augment(
            waveform,
            source_sample_rate=source_sample_rate,
            generator=generator,
        ).waveform

    def augment(
        self,
        waveform: torch.Tensor,
        *,
        source_sample_rate: int,
        generator: torch.Generator | None = None,
    ) -> AugmentationResult:
        """Return prepared audio and non-model metadata for optional experiment logs."""
        if source_sample_rate != self.config.sample_rate:
            raise ValueError(
                f"expected {self.config.sample_rate} Hz audio, received {source_sample_rate} Hz; "
                "resample before calling AudioAugmenter"
            )
        audio = _validate_waveform(waveform)
        applied: list[dict[str, Any]] = []
        random_enabled = self.training and self.config.enabled

        # Initial crop follows the requested order.  Short audio is padded only
        # after transforms that may change length.
        audio = _crop_initial(audio, self.config.window_samples, random_enabled, generator)
        if random_enabled and _chance(self.config.unchanged_probability, generator):
            applied.append({"name": "unchanged"})
        elif random_enabled:
            candidates = self._selected_transforms(generator)
            for name in candidates:
                audio, details = self._apply(name, audio, generator)
                applied.append({"name": name, **details})

        audio = _finalize_length(
            audio, self.config.window_samples, random_enabled, self.config.padding, generator
        )
        if not torch.isfinite(audio).all():
            raise ValueError("augmentation transform produced non-finite values")
        peak = audio.abs().max() if audio.numel() else torch.tensor(0.0)
        if peak > 1:
            audio = audio / peak
            applied.append({"name": "amplitude_safety", "peak_before": float(peak)})
        audio = audio.clamp(-1.0, 1.0).to(dtype=torch.float32).contiguous()
        return AugmentationResult(waveform=audio, applied=applied)

    def _selected_transforms(self, generator: torch.Generator | None) -> list[str]:
        # The order is intentional: transforms may be sampled independently, but
        # their execution follows the documented channel-processing sequence.
        assert self.assets is not None  # called only for enabled training augmentation
        probabilities = (
            ("speed", self.config.speed.probability),
            ("rir", self.config.rir.probability if self.assets.rir else 0.0),
            ("filter", self.config.filtering.probability),
            ("resample", self.config.resample.probability),
            ("gain", self.config.gain.probability),
            ("noise", self.config.noise.probability if self.assets.noise else 0.0),
            ("saturation", self.config.saturation.probability),
            ("codec", self.config.codec.probability if self.config.codec.enabled else 0.0),
        )
        selected = [name for name, probability in probabilities if _chance(probability, generator)]
        if len(selected) <= self.config.max_random_transforms:
            return selected
        keep = set(
            torch.randperm(len(selected), generator=generator)[
                : self.config.max_random_transforms
            ].tolist()
        )
        return [name for index, name in enumerate(selected) if index in keep]

    def _apply(
        self, name: str, audio: torch.Tensor, generator: torch.Generator | None
    ) -> tuple[torch.Tensor, dict[str, Any]]:
        if not audio.numel():
            return audio, {"skipped": "empty_input"}
        if name == "gain":
            db = _uniform(self.config.gain.min_db, self.config.gain.max_db, generator)
            return audio * (10.0 ** (db / 20.0)), {"db": db}
        if name == "noise":
            path = _choice(self.assets.noise, generator)
            snr_db = _uniform(self.config.noise.min_snr_db, self.config.noise.max_snr_db, generator)
            return _mix_noise(audio, self.assets.load(path), snr_db, generator), {
                "snr_db": snr_db,
                "asset": str(path),
            }
        if name == "rir":
            path = _choice(self.assets.rir, generator)
            wet = _uniform(self.config.rir.min_wet, self.config.rir.max_wet, generator)
            return _apply_rir(audio, self.assets.load(path), wet), {"wet": wet, "asset": str(path)}
        if name == "resample":
            rate = _choice(self.config.resample.intermediate_rates, generator)
            return _resample(
                _resample(audio, self.config.sample_rate, rate), rate, self.config.sample_rate
            ), {"intermediate_rate": rate}
        if name == "filter":
            telephone = _chance(self.config.filtering.telephone_probability, generator)
            if telephone:
                return _telephone_filter(audio, self.config.sample_rate), {
                    "profile": "telephone_300_3400"
                }
            db = _uniform(-self.config.filtering.max_db, self.config.filtering.max_db, generator)
            return _broad_eq(audio, self.config.sample_rate, db), {
                "profile": "broad_shelf",
                "db": db,
            }
        if name == "speed":
            factor = _uniform(self.config.speed.min_factor, self.config.speed.max_factor, generator)
            return _speed(audio, factor), {"factor": factor, "pitch_changes": True}
        if name == "saturation":
            drive = _uniform(
                self.config.saturation.min_drive, self.config.saturation.max_drive, generator
            )
            return torch.tanh(audio * drive) / torch.tanh(torch.tensor(drive)), {"drive": drive}
        if name == "codec":
            bitrate = int(_choice(self.config.codec.bitrates_kbps, generator))
            assert self.codec_binary is not None
            return _codec_round_trip(
                audio,
                sample_rate=self.config.sample_rate,
                ffmpeg_binary=self.codec_binary,
                bitrate_kbps=bitrate,
                application=self.config.codec.application,
            ), {
                "codec": self.config.codec.codec,
                "bitrate_kbps": bitrate,
                "application": self.config.codec.application,
                "tool_version": self.codec_version,
            }
        raise AssertionError(f"unknown transform {name}")


def _validate_waveform(waveform: torch.Tensor) -> torch.Tensor:
    if not isinstance(waveform, torch.Tensor):
        raise TypeError("waveform must be a torch.Tensor")
    if not waveform.is_floating_point():
        raise TypeError("waveform must use a floating-point dtype")
    if waveform.ndim == 2 and waveform.shape[0] == 1:
        waveform = waveform[0]
    elif waveform.ndim != 1:
        raise ValueError(
            "waveform must have shape [samples] or [1, samples]; downmix explicitly first"
        )
    if not torch.isfinite(waveform).all():
        raise ValueError("waveform contains NaN or Inf")
    return waveform.detach().to(dtype=torch.float32, device="cpu").clone().contiguous()


def _crop_initial(
    audio: torch.Tensor, length: int, random_crop: bool, generator: torch.Generator | None
) -> torch.Tensor:
    if audio.numel() <= length:
        return audio
    if random_crop:
        start = int(torch.randint(audio.numel() - length + 1, (), generator=generator))
    else:
        start = (audio.numel() - length) // 2
    return audio[start : start + length]


def _finalize_length(
    audio: torch.Tensor,
    length: int,
    random_crop: bool,
    padding: str,
    generator: torch.Generator | None,
) -> torch.Tensor:
    if audio.numel() > length:
        return _crop_initial(audio, length, random_crop, generator)
    if audio.numel() == length:
        return audio
    missing = length - audio.numel()
    if padding == "reflect" and audio.numel() > 1:
        # Repeated reflect padding is safe for clips much shorter than the window.
        result = audio
        while result.numel() < length:
            need = length - result.numel()
            reflected = result.flip(0)
            result = torch.cat((result, reflected[:need]))
        return result
    return F.pad(audio, (0, missing))


def _mix_noise(
    audio: torch.Tensor, noise: torch.Tensor, snr_db: float, generator: torch.Generator | None
) -> torch.Tensor:
    if not audio.numel() or not noise.numel():
        return audio
    noise = _fit_noise(noise, audio.numel(), generator)
    active = audio[audio.abs() > max(float(audio.abs().max()) * 0.02, _EPSILON)]
    signal_rms = torch.sqrt(torch.mean((active if active.numel() else audio).square()))
    noise_rms = torch.sqrt(torch.mean(noise.square()))
    if signal_rms <= _EPSILON or noise_rms <= _EPSILON:
        return audio
    scale = signal_rms / (10.0 ** (snr_db / 20.0) * noise_rms)
    return audio + noise * scale


def _fit_noise(noise: torch.Tensor, length: int, generator: torch.Generator | None) -> torch.Tensor:
    if noise.numel() >= length:
        start = int(torch.randint(noise.numel() - length + 1, (), generator=generator))
        return noise[start : start + length]
    repeats = (length + noise.numel() - 1) // noise.numel()
    return noise.repeat(repeats)[:length]


def _apply_rir(audio: torch.Tensor, rir: torch.Tensor, wet: float) -> torch.Tensor:
    if not audio.numel() or not rir.numel():
        return audio
    rir = rir / torch.sqrt(torch.sum(rir.square()).clamp_min(_EPSILON))
    # Align the strongest direct-path candidate at the start, then keep the tail.
    direct = int(torch.argmax(rir.abs()))
    rir = rir[direct:]
    full_length = audio.numel() + rir.numel() - 1
    fft_length = 1 << (full_length - 1).bit_length()
    # Frequency-domain convolution is materially cheaper than direct conv1d for
    # 48k windows and longer real room responses. Both operands remain CPU-side.
    reverberant = torch.fft.irfft(
        torch.fft.rfft(audio, n=fft_length) * torch.fft.rfft(rir, n=fft_length),
        n=fft_length,
    )[: audio.numel()]
    return audio * (1.0 - wet) + reverberant * wet


def _resample(audio: torch.Tensor, source_rate: int, target_rate: int) -> torch.Tensor:
    """Windowed-sinc anti-aliasing followed by linear time interpolation."""
    if source_rate <= 0 or target_rate <= 0:
        raise ValueError("sample rates must be positive")
    if source_rate == target_rate or audio.numel() < 2:
        return audio.clone()
    filtered = audio
    if target_rate < source_rate:
        filtered = _lowpass(audio, cutoff_hz=0.47 * target_rate, sample_rate=source_rate)
    output_length = max(1, round(filtered.numel() * target_rate / source_rate))
    return F.interpolate(
        filtered[None, None], size=output_length, mode="linear", align_corners=False
    )[0, 0]


def _lowpass(
    audio: torch.Tensor, cutoff_hz: float, sample_rate: int, taps: int = 101
) -> torch.Tensor:
    cutoff = min(cutoff_hz / sample_rate, 0.49)
    positions = torch.arange(taps, dtype=audio.dtype, device=audio.device) - (taps - 1) / 2
    kernel = 2 * cutoff * torch.sinc(2 * cutoff * positions)
    kernel *= torch.hamming_window(taps, periodic=False, dtype=audio.dtype, device=audio.device)
    kernel /= kernel.sum().clamp_min(_EPSILON)
    return F.conv1d(audio[None, None], kernel[None, None], padding=taps // 2)[0, 0]


def _telephone_filter(audio: torch.Tensor, sample_rate: int) -> torch.Tensor:
    low = _lowpass(audio, 3_400.0, sample_rate)
    # High-pass by subtracting a 300 Hz low-pass component.
    return low - _lowpass(low, 300.0, sample_rate)


def _broad_eq(audio: torch.Tensor, sample_rate: int, db: float) -> torch.Tensor:
    spectrum = torch.fft.rfft(audio)
    frequencies = torch.fft.rfftfreq(audio.numel(), d=1.0 / sample_rate).to(audio.device)
    # A smooth tilt: one side is boosted while the other is attenuated.
    tilt = (frequencies / (sample_rate / 2)).clamp(0, 1) * 2 - 1
    gain = torch.pow(torch.tensor(10.0, dtype=audio.dtype), (db * tilt) / 20.0)
    return torch.fft.irfft(spectrum * gain, n=audio.numel())


def _speed(audio: torch.Tensor, factor: float) -> torch.Tensor:
    length = max(1, round(audio.numel() / factor))
    return F.interpolate(audio[None, None], size=length, mode="linear", align_corners=False)[0, 0]


def _resolve_ffmpeg(configured_binary: str | None) -> str:
    """Return a usable FFmpeg executable without silently disabling codecs."""
    if configured_binary:
        candidate = shutil.which(configured_binary) or configured_binary
        if Path(candidate).is_file() or shutil.which(candidate):
            return str(candidate)
        raise ValueError(f"configured FFmpeg binary does not exist: {configured_binary}")
    system_binary = shutil.which("ffmpeg")
    if system_binary:
        return system_binary
    try:
        import imageio_ffmpeg

        bundled_binary = imageio_ffmpeg.get_ffmpeg_exe()
    except (ImportError, RuntimeError) as error:
        raise ValueError(
            "codec augmentation requires FFmpeg; install ffmpeg or the imageio-ffmpeg package"
        ) from error
    if not Path(bundled_binary).is_file():
        raise ValueError(f"imageio-ffmpeg returned a missing executable: {bundled_binary}")
    return bundled_binary


def _ffmpeg_version(ffmpeg_binary: str) -> str:
    result = subprocess.run(
        [ffmpeg_binary, "-version"],
        check=True,
        capture_output=True,
        timeout=10,
    )
    first_line = result.stdout.decode("utf-8", errors="replace").splitlines()[0]
    return first_line.strip()


def _codec_round_trip(
    audio: torch.Tensor,
    *,
    sample_rate: int,
    ffmpeg_binary: str,
    bitrate_kbps: int,
    application: Literal["voip", "audio"],
) -> torch.Tensor:
    """Encode to Opus and decode back using pipes; no compressed file is retained."""
    source = audio.detach().to(dtype=torch.float32, device="cpu").contiguous().numpy().tobytes()
    common = [ffmpeg_binary, "-hide_banner", "-loglevel", "error", "-nostdin"]
    encode = subprocess.run(
        [
            *common,
            "-f",
            "f32le",
            "-ar",
            str(sample_rate),
            "-ac",
            "1",
            "-i",
            "pipe:0",
            "-c:a",
            "libopus",
            "-application",
            application,
            "-b:a",
            f"{bitrate_kbps}k",
            "-vbr",
            "off",
            "-compression_level",
            "10",
            "-f",
            "ogg",
            "pipe:1",
        ],
        input=source,
        check=True,
        capture_output=True,
        timeout=30,
    )
    decode = subprocess.run(
        [
            *common,
            "-f",
            "ogg",
            "-i",
            "pipe:0",
            "-f",
            "f32le",
            "-acodec",
            "pcm_f32le",
            "-ar",
            str(sample_rate),
            "-ac",
            "1",
            "pipe:1",
        ],
        input=encode.stdout,
        check=True,
        capture_output=True,
        timeout=30,
    )
    if not decode.stdout:
        raise RuntimeError("FFmpeg codec round-trip produced empty audio")
    return torch.frombuffer(bytearray(decode.stdout), dtype=torch.float32).clone()


def _decode_asset(path: Path) -> tuple[torch.Tensor, int]:
    try:
        import soundfile as sf
    except ImportError as error:  # pragma: no cover - package is a base dependency
        raise RuntimeError("soundfile is required to decode augmentation assets") from error
    data, sample_rate = sf.read(path, dtype="float32", always_2d=True)
    if data.shape[1] == 0:
        raise ValueError("empty audio asset")
    audio = torch.from_numpy(data.mean(axis=1).copy())
    return audio, int(sample_rate)


def _chance(probability: float, generator: torch.Generator | None) -> bool:
    return bool(torch.rand((), generator=generator) < probability)


def _uniform(low: float, high: float, generator: torch.Generator | None) -> float:
    return float(torch.empty(()).uniform_(low, high, generator=generator))


def _choice(values: Sequence[Any], generator: torch.Generator | None) -> Any:
    if not values:
        raise ValueError("cannot select from an empty augmentation asset list")
    return values[int(torch.randint(len(values), (), generator=generator))]


def load_augmentation_config(
    path: str | Path,
    *,
    project_root: str | Path | None = None,
) -> AugmentationConfig:
    """Load the checked-in YAML configuration into the executable dataclasses.

    Relative asset paths are interpreted from ``project_root`` (the current
    directory by default), not from the config file's ``training/configs``
    directory. This keeps ``data/augmentation_assets/...`` portable.
    """
    try:
        import yaml
    except ImportError as error:  # pragma: no cover - declared project dependency
        raise RuntimeError("PyYAML is required to load augmentation configuration") from error
    config_path = Path(path)
    with config_path.open(encoding="utf-8") as handle:
        document = yaml.safe_load(handle) or {}
    if not isinstance(document, dict):
        raise TypeError(f"augmentation configuration must be a mapping: {config_path}")
    audio = _mapping(document.get("audio"), "audio")
    augmentation = _mapping(document.get("augmentation"), "augmentation")
    root = Path.cwd() if project_root is None else Path(project_root)

    def asset_path(section: str) -> Path | None:
        raw = _mapping(augmentation.get(section), section).get("asset_dir")
        if raw is None:
            return None
        value = Path(str(raw))
        return value if value.is_absolute() else root / value

    def section(name: str) -> dict[str, Any]:
        return _mapping(augmentation.get(name), name)

    return AugmentationConfig(
        sample_rate=int(audio.get("sample_rate", 16_000)),
        window_samples=int(audio.get("window_samples", 48_000)),
        enabled=bool(augmentation.get("enabled", True)),
        unchanged_probability=float(augmentation.get("unchanged_probability", 0.20)),
        max_random_transforms=int(augmentation.get("max_random_transforms", 3)),
        padding=str(augmentation.get("padding", "zero")),
        gain=GainConfig(**section("gain")),
        noise=NoiseConfig(
            probability=float(section("noise").get("probability", 0.45)),
            min_snr_db=float(section("noise").get("min_snr_db", 8.0)),
            max_snr_db=float(section("noise").get("max_snr_db", 35.0)),
            asset_dir=asset_path("noise"),
        ),
        rir=RirConfig(
            probability=float(section("rir").get("probability", 0.25)),
            min_wet=float(section("rir").get("min_wet", 0.20)),
            max_wet=float(section("rir").get("max_wet", 0.80)),
            asset_dir=asset_path("rir"),
        ),
        resample=ResampleConfig(
            probability=float(section("resample").get("probability", 0.25)),
            intermediate_rates=tuple(
                int(rate)
                for rate in section("resample").get(
                    "intermediate_rates", (8_000, 12_000, 22_050, 24_000)
                )
            ),
        ),
        filtering=FilterConfig(**section("filtering")),
        speed=SpeedConfig(**section("speed")),
        saturation=SaturationConfig(**section("saturation")),
        codec=CodecConfig(
            enabled=bool(section("codec").get("enabled", False)),
            probability=float(section("codec").get("probability", 0.20)),
            codec=str(section("codec").get("codec", "opus")),
            bitrates_kbps=tuple(
                int(rate) for rate in section("codec").get("bitrates_kbps", (12, 16, 24))
            ),
            application=str(section("codec").get("application", "voip")),
            binary=section("codec").get("binary"),
        ),
    )


def augmentation_config_dict(config: AugmentationConfig) -> dict[str, Any]:
    """Return a JSON-serializable snapshot suitable for experiment metadata."""
    return _json_safe(asdict(config))


def _mapping(value: Any, name: str) -> dict[str, Any]:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise TypeError(f"{name} configuration must be a mapping")
    return value


def _json_safe(value: Any) -> Any:
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, dict):
        return {key: _json_safe(item) for key, item in value.items()}
    if isinstance(value, tuple):
        return [_json_safe(item) for item in value]
    return value
