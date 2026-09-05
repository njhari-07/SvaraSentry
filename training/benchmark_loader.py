"""Measure CPU audio-loader throughput for an existing training manifest.

Example:
    python -m training.benchmark_loader --manifest data/train.csv --workers 4 --device cuda
"""

from __future__ import annotations

import argparse
import time
from pathlib import Path

import torch
from torch.utils.data import DataLoader

from training.audio_dataset import AudioDataset


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--split", choices=("train", "validation", "test"), default="train")
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--batches", type=int, default=100)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--epoch", type=int, default=0)
    parser.add_argument(
        "--augmentation-config",
        type=Path,
        default=Path("training/configs/augmentation.yaml"),
        help="YAML config with augmentation policy and asset paths",
    )
    parser.add_argument("--device", default="cpu", help="Use cuda to include pinned non-blocking copies")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.batch_size <= 0 or args.workers < 0 or args.batches <= 0:
        raise ValueError("batch-size and batches must be positive; workers cannot be negative")
    device = torch.device(args.device)
    if device.type == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("--device cuda requested but CUDA is unavailable")
    dataset = AudioDataset(
        args.manifest,
        args.split,
        seed=args.seed,
        config_path=args.augmentation_config,
    )
    dataset.set_epoch(args.epoch)
    loader = DataLoader(
        dataset,
        batch_size=args.batch_size,
        num_workers=args.workers,
        pin_memory=device.type == "cuda",
        persistent_workers=args.workers > 0,
    )
    start = time.perf_counter()
    examples = 0
    for batch_index, batch in enumerate(loader, start=1):
        waveform = batch["waveform"]
        if device.type == "cuda":
            waveform = waveform.to(device, non_blocking=True)
        examples += waveform.shape[0]
        if batch_index >= args.batches:
            break
    if device.type == "cuda":
        torch.cuda.synchronize(device)
    elapsed = time.perf_counter() - start
    print(
        f"{examples} examples in {elapsed:.2f}s "
        f"({examples / elapsed:.1f} examples/s; workers={args.workers}; device={device})"
    )


if __name__ == "__main__":
    main()
