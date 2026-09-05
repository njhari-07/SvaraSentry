"""Manifest-backed CPU dataset that applies augmentation only for training."""

from __future__ import annotations

import csv
import hashlib
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import torch
from torch.utils.data import Dataset, get_worker_info

from training.augmentations import (
    AudioAugmenter,
    AugmentationConfig,
    _resample,
    load_augmentation_config,
)

Split = Literal["train", "validation", "test"]
_LABELS = {"real": 0, "fake": 1}


@dataclass(frozen=True, slots=True)
class AudioRecord:
    path: Path
    label: int
    sample_id: str
    metadata: dict[str, str]


class AudioDataset(Dataset[dict[str, object]]):
    """Decode a manifest and return only model-ready waveforms plus labels.

    Source files are explicitly downmixed and resampled here.  The augmenter is
    called for train only; validation/test use its deterministic preparation
    mode.  ``set_epoch`` must be called by a training loop before each epoch.
    """

    def __init__(
        self,
        manifest: str | Path,
        split: Split,
        config: AugmentationConfig | None = None,
        *,
        seed: int = 0,
        config_path: str | Path | None = None,
    ) -> None:
        if split not in {"train", "validation", "test"}:
            raise ValueError("split must be 'train', 'validation', or 'test'")
        if config is not None and config_path is not None:
            raise ValueError("pass either config or config_path, not both")
        if config_path is not None:
            config = load_augmentation_config(config_path, project_root=Path.cwd())
        self.records = _read_manifest(Path(manifest), split)
        self.split = split
        self.config = config if config is not None else AugmentationConfig()
        self.seed = seed
        self.epoch = 0
        self.augmenter = AudioAugmenter(self.config, training=(split == "train"))

    def set_epoch(self, epoch: int) -> None:
        if epoch < 0:
            raise ValueError("epoch must be non-negative")
        self.epoch = epoch

    def __len__(self) -> int:
        return len(self.records)

    def __getitem__(self, index: int) -> dict[str, object]:
        record = self.records[index]
        waveform = _decode_source(record.path, self.config.sample_rate)
        generator = self._generator(record.sample_id)
        prepared = self.augmenter.augment(
            waveform,
            source_sample_rate=self.config.sample_rate,
            generator=generator,
        )
        return {
            "waveform": prepared.waveform,
            "label": torch.tensor(record.label, dtype=torch.long),
            "sample_id": record.sample_id,
            "metadata": record.metadata,
        }

    def _generator(self, sample_id: str) -> torch.Generator:
        worker = get_worker_info()
        worker_id = 0 if worker is None else worker.id
        rank = int(os.environ.get("RANK", "0"))
        material = f"{self.seed}:{self.epoch}:{sample_id}:{worker_id}:{rank}".encode()
        seed = int.from_bytes(hashlib.blake2b(material, digest_size=8).digest(), "little")
        generator = torch.Generator(device="cpu")
        generator.manual_seed(seed)
        return generator


def _read_manifest(path: Path, requested_split: Split) -> list[AudioRecord]:
    with path.open(newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    required = {"path", "label"}
    if not rows or not required.issubset(rows[0]):
        raise ValueError(f"manifest must contain {sorted(required)} columns: {path}")
    records: list[AudioRecord] = []
    for row in rows:
        # Split assignment is external to augmentation.  A manifest without a
        # split column is treated as an already-selected split for compatibility.
        manifest_split = str(row.get("split") or "").strip().lower()
        if manifest_split == "dev":
            manifest_split = "validation"
        if manifest_split and manifest_split != requested_split:
            continue
        label = str(row["label"]).strip().lower()
        if label not in _LABELS:
            raise ValueError(f"unsupported label {label!r}; expected 'real' or 'fake'")
        source = Path(str(row["path"])).expanduser()
        metadata = {
            key: str(value)
            for key, value in row.items()
            if key not in {"path", "label", "id"} and value not in {None, ""}
        }
        if "fake_engine" not in metadata and row.get("attack_type"):
            metadata["fake_engine"] = str(row["attack_type"])
        records.append(AudioRecord(source, _LABELS[label], str(row.get("id") or source), metadata))
    if not records:
        raise ValueError(f"manifest has no records for split {requested_split!r}: {path}")
    return records


def _decode_source(path: Path, target_rate: int) -> torch.Tensor:
    try:
        import soundfile as sf
    except ImportError as error:  # pragma: no cover
        raise RuntimeError("soundfile is required to decode training audio") from error
    data, source_rate = sf.read(path, dtype="float32", always_2d=True)
    if data.shape[0] == 0:
        raise ValueError(f"empty audio source: {path}")
    waveform = torch.from_numpy(data.mean(axis=1).copy())  # explicit dataset-layer downmix
    if source_rate != target_rate:
        waveform = _resample(waveform, int(source_rate), target_rate)
    if not torch.isfinite(waveform).all():
        raise ValueError(f"non-finite decoded audio: {path}")
    return waveform.contiguous()
