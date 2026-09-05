"""Create an auditable sample report for the configured training augmentation.

Example:
    python -m training.augmentation_report --manifest data/dataset_manifest.csv --output runs/augmentation-samples.jsonl
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import torch

from training.audio_dataset import AudioDataset, _decode_source
from training.augmentations import load_augmentation_config


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--count", type=int, default=32)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--epoch", type=int, default=0)
    parser.add_argument("--augmentation-config", type=Path, default=Path("training/configs/augmentation.yaml"))
    return parser.parse_args()


def waveform_stats(waveform: torch.Tensor) -> dict[str, float]:
    return {
        "mean": float(waveform.mean()),
        "rms": float(torch.sqrt(torch.mean(waveform.square()))),
        "peak": float(waveform.abs().max()),
        "zero_fraction": float(torch.mean((waveform == 0).to(torch.float32))),
    }


def main() -> None:
    args = parse_args()
    if args.count <= 0:
        raise ValueError("count must be positive")
    config = load_augmentation_config(args.augmentation_config, project_root=Path.cwd())
    dataset = AudioDataset(args.manifest, "train", config, seed=args.seed)
    dataset.set_epoch(args.epoch)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8") as handle:
        for index, record in enumerate(dataset.records[: args.count]):
            source = _decode_source(record.path, config.sample_rate)
            result = dataset.augmenter.augment(
                source,
                source_sample_rate=config.sample_rate,
                generator=dataset._generator(record.sample_id),
            )
            row = {
                "sample_id": record.sample_id,
                "label": record.label,
                "metadata": record.metadata,
                "source_stats": waveform_stats(source),
                "augmented_stats": waveform_stats(result.waveform),
                "applied": result.applied,
            }
            handle.write(json.dumps(row) + "\n")
    print(f"Wrote {min(args.count, len(dataset))} augmentation samples to {args.output}")


if __name__ == "__main__":
    main()
