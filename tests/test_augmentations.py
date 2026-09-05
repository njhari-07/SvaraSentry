from __future__ import annotations

import csv
import shutil
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace

import pytest
import torch

from training.audio_dataset import AudioDataset
from training.augmentations import (
    AudioAugmenter,
    AugmentationConfig,
    CodecConfig,
    GainConfig,
    NoiseConfig,
    RirConfig,
    _apply_rir,
    _mix_noise,
    load_augmentation_config,
)


def generator(seed: int) -> torch.Generator:
    result = torch.Generator()
    result.manual_seed(seed)
    return result


def no_random_config(**changes: object) -> AugmentationConfig:
    config = AugmentationConfig(enabled=False)
    return replace(config, **changes)


def prepare(
    augmenter: AudioAugmenter, audio: torch.Tensor, *, seed: int | None = None
) -> torch.Tensor:
    return augmenter(
        audio, source_sample_rate=16_000, generator=None if seed is None else generator(seed)
    )


@pytest.mark.parametrize("length", [0, 1, 1_000, 48_000, 60_000])
def test_contract_and_crop_pad(length: int) -> None:
    audio = torch.linspace(-0.5, 0.5, max(length, 1))[:length]
    output = prepare(AudioAugmenter(no_random_config()), audio)
    assert output.shape == (48_000,)
    assert output.dtype == torch.float32
    assert output.is_contiguous() and torch.isfinite(output).all()
    assert output.abs().max() <= 1


def test_input_is_not_mutated_and_multichannel_is_rejected() -> None:
    audio = torch.full((100,), 0.25)
    original = audio.clone()
    prepare(AudioAugmenter(no_random_config()), audio)
    assert torch.equal(audio, original)
    with pytest.raises(ValueError, match="downmix"):
        prepare(AudioAugmenter(no_random_config()), torch.zeros(2, 100))


def test_standalone_augmenter_rejects_wrong_sample_rate() -> None:
    with pytest.raises(ValueError, match="expected 16000 Hz"):
        AudioAugmenter(no_random_config())(torch.zeros(10), source_sample_rate=8_000)


def test_gain_has_expected_scale_when_it_is_the_only_transform() -> None:
    config = replace(
        no_random_config(enabled=True, unchanged_probability=0),
        gain=GainConfig(probability=1.0, min_db=6.0, max_db=6.0),
    )
    # Disable everything except gain, and use a full window to avoid crop/pad.
    config = replace(
        config,
        noise=NoiseConfig(probability=0),
        rir=RirConfig(probability=0),
        resample=replace(config.resample, probability=0),
        filtering=replace(config.filtering, probability=0),
        speed=replace(config.speed, probability=0),
        saturation=replace(config.saturation, probability=0),
    )
    source = torch.full((48_000,), 0.1)
    result = AudioAugmenter(config).augment(
        source, source_sample_rate=16_000, generator=generator(4)
    )
    assert torch.allclose(result.waveform, source * (10 ** (6 / 20)), atol=1e-6)
    assert result.applied[0]["name"] == "gain"


def test_noise_reaches_requested_snr_and_silence_is_safe() -> None:
    signal = torch.ones(16_000) * 0.1
    noise = torch.where(torch.arange(16_000) % 2 == 0, 1.0, -1.0)
    mixed = _mix_noise(signal, noise, 20.0, generator(3))
    achieved_noise = mixed - signal
    snr = 20 * torch.log10(
        torch.sqrt(signal.square().mean()) / torch.sqrt(achieved_noise.square().mean())
    )
    assert torch.isclose(snr, torch.tensor(20.0), atol=0.1)
    assert torch.equal(_mix_noise(torch.zeros(8), noise[:8], 8.0, generator(3)), torch.zeros(8))
    assert torch.equal(_mix_noise(signal[:8], torch.zeros(8), 8.0, generator(3)), signal[:8])


def test_rir_fft_convolution_matches_expected_direct_path_response() -> None:
    audio = torch.tensor([1.0, 0.0, 0.0, 0.0])
    rir = torch.tensor([2.0, 1.0])
    result = _apply_rir(audio, rir, wet=1.0)
    expected = torch.tensor([2.0, 1.0, 0.0, 0.0]) / torch.sqrt(torch.tensor(5.0))
    assert torch.allclose(result, expected, atol=1e-6)


def test_fixed_seed_produces_identical_audio_and_metadata() -> None:
    config = replace(
        AugmentationConfig(), noise=NoiseConfig(probability=0), rir=RirConfig(probability=0)
    )
    source = torch.sin(torch.arange(60_000) / 29)
    augmenter = AudioAugmenter(config)
    first = augmenter.augment(source, source_sample_rate=16_000, generator=generator(44))
    second = augmenter.augment(source, source_sample_rate=16_000, generator=generator(44))
    assert torch.equal(first.waveform, second.waveform)
    assert first.applied == second.applied


def test_different_seeds_normally_produce_different_training_versions() -> None:
    config = replace(
        AugmentationConfig(), noise=NoiseConfig(probability=0), rir=RirConfig(probability=0)
    )
    source = torch.sin(torch.arange(60_000) / 29)
    augmenter = AudioAugmenter(config)
    assert not torch.equal(prepare(augmenter, source, seed=1), prepare(augmenter, source, seed=2))


def test_disabled_and_evaluation_modes_are_deterministic() -> None:
    source = torch.arange(60_000, dtype=torch.float32) / 100_000
    config = AugmentationConfig()
    evaluation = AudioAugmenter(config, training=False)
    assert torch.equal(prepare(evaluation, source, seed=1), prepare(evaluation, source, seed=2))
    disabled = AudioAugmenter(replace(config, enabled=False), training=True)
    assert torch.equal(prepare(disabled, source, seed=1), prepare(disabled, source, seed=2))


@pytest.mark.parametrize("transform", ["speed", "filter", "resample", "saturation"])
def test_individual_builtin_transforms_preserve_the_public_contract(transform: str) -> None:
    config = replace(
        no_random_config(enabled=True, unchanged_probability=0, max_random_transforms=1),
        gain=GainConfig(probability=0),
        noise=NoiseConfig(probability=0),
        rir=RirConfig(probability=0),
        resample=replace(AugmentationConfig().resample, probability=float(transform == "resample")),
        filtering=replace(AugmentationConfig().filtering, probability=float(transform == "filter")),
        speed=replace(AugmentationConfig().speed, probability=float(transform == "speed")),
        saturation=replace(
            AugmentationConfig().saturation, probability=float(transform == "saturation")
        ),
    )
    output = prepare(AudioAugmenter(config), torch.sin(torch.arange(50_000) / 19), seed=19)
    assert output.shape == (48_000,)
    assert output.dtype == torch.float32
    assert torch.isfinite(output).all() and output.abs().max() <= 1


def test_missing_explicit_assets_raise_clear_error(tmp_path) -> None:
    config = replace(AugmentationConfig(), noise=NoiseConfig(asset_dir=tmp_path / "missing"))
    with pytest.raises(ValueError, match="noise asset directory"):
        AudioAugmenter(config)


def test_evaluation_does_not_index_unused_augmentation_assets(tmp_path) -> None:
    config = replace(AugmentationConfig(), noise=NoiseConfig(asset_dir=tmp_path / "missing"))
    evaluation = AudioAugmenter(config, training=False)
    output = prepare(evaluation, torch.zeros(20))
    assert output.shape == (48_000,)


def test_opus_codec_round_trip_is_reproducible_and_reported() -> None:
    base = AugmentationConfig()
    config = replace(
        base,
        unchanged_probability=0,
        max_random_transforms=1,
        gain=replace(base.gain, probability=0),
        noise=replace(base.noise, probability=0),
        rir=replace(base.rir, probability=0),
        resample=replace(base.resample, probability=0),
        filtering=replace(base.filtering, probability=0),
        speed=replace(base.speed, probability=0),
        saturation=replace(base.saturation, probability=0),
        codec=CodecConfig(enabled=True, probability=1, bitrates_kbps=(16,)),
    )
    augmenter = AudioAugmenter(config)
    source = 0.2 * torch.sin(2 * torch.pi * 440 * torch.arange(48_000) / 16_000)
    first = augmenter.augment(source, source_sample_rate=16_000, generator=generator(7))
    second = augmenter.augment(source, source_sample_rate=16_000, generator=generator(7))
    assert first.waveform.shape == (48_000,)
    assert torch.equal(first.waveform, second.waveform)
    assert first.applied == second.applied
    assert first.applied[0]["name"] == "codec"
    assert first.applied[0]["codec"] == "opus"
    assert first.applied[0]["bitrate_kbps"] == 16
    assert first.applied[0]["tool_version"].startswith("ffmpeg version")
    assert not torch.equal(first.waveform, source)


def test_codec_rejects_a_missing_configured_binary(tmp_path) -> None:
    config = replace(
        AugmentationConfig(),
        codec=CodecConfig(enabled=True, binary=str(tmp_path / "missing-ffmpeg")),
    )
    with pytest.raises(ValueError, match="FFmpeg binary does not exist"):
        AudioAugmenter(config)


def test_dataset_honours_an_external_manifest_split_without_using_labels(tmp_path) -> None:
    manifest = tmp_path / "manifest.csv"
    with manifest.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["path", "label", "split"])
        writer.writeheader()
        writer.writerow({"path": "train.wav", "label": "fake", "split": "train"})
        writer.writerow({"path": "validation.wav", "label": "real", "split": "validation"})
    dataset = AudioDataset(manifest, "validation")
    assert len(dataset) == 1
    assert dataset.records[0].label == 0
    assert dataset.records[0].path.name == "validation.wav"


def test_dataset_only_uses_random_augmentation_for_train(tmp_path) -> None:
    sf = pytest.importorskip("soundfile")

    source = tmp_path / "sample.wav"
    sf.write(source, torch.linspace(-0.25, 0.25, 60_000).numpy(), 16_000)
    manifest = tmp_path / "manifest.csv"
    with manifest.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["path", "label"])
        writer.writeheader()
        writer.writerow({"path": source, "label": "real"})

    train = AudioDataset(manifest, "train", seed=42)
    validation = AudioDataset(manifest, "validation", seed=42)
    # The train augmenter is stochastic while validation's is structurally unable
    # to select a transform, independent of label.
    assert train.augmenter.training is True
    assert validation.augmenter.training is False
    first = validation[0]["waveform"]
    second = validation[0]["waveform"]
    assert torch.equal(first, second)


def test_yaml_configuration_is_executable_and_resolves_asset_paths(tmp_path) -> None:
    config_file = tmp_path / "augmentation.yaml"
    config_file.write_text(
        "audio:\n  sample_rate: 16000\n  window_samples: 48000\n"
        "augmentation:\n  enabled: false\n"
        "  noise: {asset_dir: data/noise}\n  rir: {asset_dir: data/rir}\n",
        encoding="utf-8",
    )
    config = load_augmentation_config(config_file, project_root=tmp_path)
    assert config.noise.asset_dir == tmp_path / "data/noise"
    assert config.rir.asset_dir == tmp_path / "data/rir"


def test_decoded_noise_and_rir_assets_work_end_to_end(tmp_path) -> None:
    pytest.importorskip("soundfile")
    noise_dir = tmp_path / "noise"
    rir_dir = tmp_path / "rir"
    noise_dir.mkdir()
    rir_dir.mkdir()
    fixture_dir = Path(__file__).parent / "fixtures" / "augmentation"
    shutil.copy2(fixture_dir / "noise.wav", noise_dir / "fixture.wav")
    shutil.copy2(fixture_dir / "rir.wav", rir_dir / "fixture.wav")
    base = replace(
        no_random_config(enabled=True, unchanged_probability=0, max_random_transforms=1),
        gain=GainConfig(probability=0),
        resample=replace(AugmentationConfig().resample, probability=0),
        filtering=replace(AugmentationConfig().filtering, probability=0),
        speed=replace(AugmentationConfig().speed, probability=0),
        saturation=replace(AugmentationConfig().saturation, probability=0),
    )
    source = torch.sin(torch.arange(48_000) / 23)
    noise_config = replace(
        base, noise=NoiseConfig(probability=1, asset_dir=noise_dir), rir=RirConfig(probability=0)
    )
    rir_config = replace(
        base, noise=NoiseConfig(probability=0), rir=RirConfig(probability=1, asset_dir=rir_dir)
    )
    noise_result = AudioAugmenter(noise_config).augment(
        source, source_sample_rate=16_000, generator=generator(5)
    )
    rir_result = AudioAugmenter(rir_config).augment(
        source, source_sample_rate=16_000, generator=generator(5)
    )
    for result, transform in ((noise_result, "noise"), (rir_result, "rir")):
        assert result.waveform.shape == (48_000,)
        assert torch.isfinite(result.waveform).all()
        assert result.applied[0]["name"] == transform
        assert result.applied[0]["asset"].endswith("fixture.wav")


def test_worker_seed_derivation_is_reproducible_and_worker_distinct(tmp_path, monkeypatch) -> None:
    manifest = tmp_path / "manifest.csv"
    with manifest.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["path", "label"])
        writer.writeheader()
        writer.writerow({"path": "sample.wav", "label": "real"})
    dataset = AudioDataset(manifest, "train", seed=123)
    monkeypatch.setattr("training.audio_dataset.get_worker_info", lambda: SimpleNamespace(id=0))
    worker_zero_first = dataset._generator("sample").initial_seed()
    worker_zero_second = dataset._generator("sample").initial_seed()
    monkeypatch.setattr("training.audio_dataset.get_worker_info", lambda: SimpleNamespace(id=1))
    worker_one = dataset._generator("sample").initial_seed()
    assert worker_zero_first == worker_zero_second
    assert worker_zero_first != worker_one
