"""Train and evaluate the detector from a validated split manifest.

Example:
    python -m training.train --manifest data/dataset_manifest.csv --output runs/baseline
"""

from __future__ import annotations

import argparse
import json
import random
from pathlib import Path
from typing import Any

import numpy as np
import torch
from sklearn.metrics import average_precision_score, roc_auc_score, roc_curve
from torch import nn
from torch.utils.data import DataLoader

from training.audio_dataset import AudioDataset
from training.augmentations import augmentation_config_dict, load_augmentation_config
from training.model import VoiceCloneDetector


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--augmentation-config", type=Path, default=Path("training/configs/augmentation.yaml"))
    parser.add_argument("--model-name", default="facebook/wav2vec2-base")
    parser.add_argument("--epochs", type=int, default=10)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--learning-rate", type=float, default=1e-5)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    parser.add_argument("--threshold", type=float, default=0.5)
    return parser.parse_args()


def make_loader(dataset: AudioDataset, args: argparse.Namespace, *, shuffle: bool) -> DataLoader:
    return DataLoader(
        dataset,
        batch_size=args.batch_size,
        shuffle=shuffle,
        num_workers=args.workers,
        pin_memory=torch.device(args.device).type == "cuda",
        # Recreate workers after set_epoch so they receive the new epoch seed.
        persistent_workers=False,
    )


def metric_report(labels: list[int], scores: list[float], threshold: float) -> dict[str, float | None]:
    if len(set(labels)) < 2:
        return {"roc_auc": None, "pr_auc": None, "eer": None, "false_positive_rate": None}
    labels_array = np.asarray(labels)
    scores_array = np.asarray(scores)
    fpr, tpr, _ = roc_curve(labels_array, scores_array)
    fnr = 1 - tpr
    eer = float((fpr[np.argmin(np.abs(fnr - fpr))] + fnr[np.argmin(np.abs(fnr - fpr))]) / 2)
    negatives = labels_array == 0
    fpr_at_threshold = float(np.mean(scores_array[negatives] >= threshold)) if negatives.any() else None
    return {
        "roc_auc": float(roc_auc_score(labels_array, scores_array)),
        "pr_auc": float(average_precision_score(labels_array, scores_array)),
        "eer": eer,
        "false_positive_rate": fpr_at_threshold,
    }


def serving_checkpoint(model: nn.Module, model_name: str, report: dict) -> dict:
    """Package trained weights using the backend's checkpoint contract."""
    return {
        "format_version": 1,
        "model_name": model_name,
        "hidden_size": model.projection[1].out_features,
        "state_dict": model.state_dict(),
        "metrics": report["overall"],
    }


@torch.inference_mode()
def evaluate(model: nn.Module, loader: DataLoader, device: torch.device, threshold: float) -> dict[str, Any]:
    model.eval()
    labels: list[int] = []
    scores: list[float] = []
    rows: list[dict[str, str | int | float]] = []
    for batch in loader:
        waveform = batch["waveform"].to(device, non_blocking=True)
        batch_labels = batch["label"].tolist()
        probabilities = torch.sigmoid(model(waveform).logits).cpu().tolist()
        metadata = batch["metadata"]
        for index, (label, score) in enumerate(zip(batch_labels, probabilities, strict=True)):
            row: dict[str, str | int | float] = {"label": int(label), "score": float(score)}
            for key, values in metadata.items():
                row[key] = str(values[index])
            rows.append(row)
            labels.append(int(label))
            scores.append(float(score))
    report: dict[str, Any] = {"overall": metric_report(labels, scores, threshold), "examples": len(labels), "slices": {}}
    for field in ("language", "source", "speaker", "fake_engine"):
        values = sorted({str(row[field]) for row in rows if field in row})
        if not values:
            continue
        report["slices"][field] = {}
        for value in values:
            selected = [row for row in rows if row.get(field) == value]
            report["slices"][field][value] = {
                "examples": len(selected),
                **metric_report([int(row["label"]) for row in selected], [float(row["score"]) for row in selected], threshold),
            }
    return report


def main() -> None:
    args = parse_args()
    if args.epochs <= 0 or args.batch_size <= 0 or args.workers < 0 or args.learning_rate <= 0:
        raise ValueError("epochs, batch-size, and learning-rate must be positive; workers cannot be negative")
    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    device = torch.device(args.device)
    if device.type == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("CUDA requested but unavailable")
    config = load_augmentation_config(args.augmentation_config, project_root=Path.cwd())
    train_dataset = AudioDataset(args.manifest, "train", config, seed=args.seed)
    validation_dataset = AudioDataset(args.manifest, "validation", config, seed=args.seed)
    train_loader = make_loader(train_dataset, args, shuffle=True)
    validation_loader = make_loader(validation_dataset, args, shuffle=False)
    model = VoiceCloneDetector(args.model_name).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.learning_rate)
    loss_fn = nn.BCEWithLogitsLoss()
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "experiment.json").write_text(
        json.dumps({"seed": args.seed, "arguments": vars(args), "augmentation": augmentation_config_dict(config)}, indent=2, default=str),
        encoding="utf-8",
    )
    best_auc = float("-inf")
    for epoch in range(args.epochs):
        train_dataset.set_epoch(epoch)
        model.train()
        losses: list[float] = []
        for batch in train_loader:
            waveform = batch["waveform"].to(device, non_blocking=True)
            labels = batch["label"].to(device, dtype=torch.float32, non_blocking=True)
            optimizer.zero_grad(set_to_none=True)
            loss = loss_fn(model(waveform).logits, labels)
            loss.backward()
            optimizer.step()
            losses.append(float(loss.detach().cpu()))
        report = evaluate(model, validation_loader, device, args.threshold)
        report["epoch"] = epoch + 1
        report["train_loss"] = float(np.mean(losses))
        (args.output / f"validation-epoch-{epoch + 1:03d}.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
        auc = report["overall"]["roc_auc"]
        if auc is not None and auc >= best_auc:
            best_auc = auc
            torch.save(
                {"epoch": epoch + 1, "model": model.state_dict(), "optimizer": optimizer.state_dict(), "report": report, "augmentation": augmentation_config_dict(config), "seed": args.seed},
                args.output / "best.pt",
            )
            torch.save(
                serving_checkpoint(model, args.model_name, report),
                args.output / "model.pt",
            )
        print(f"epoch={epoch + 1} loss={report['train_loss']:.4f} validation={report['overall']}")


if __name__ == "__main__":
    main()
