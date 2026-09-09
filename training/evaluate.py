"""Evaluate a SvaraSentry checkpoint with overall and metadata-sliced metrics."""

from __future__ import annotations

import argparse
import csv
import json
import random
import time
from pathlib import Path
from typing import Any

import numpy as np
import torch
from sklearn.metrics import (
    average_precision_score,
    confusion_matrix,
    precision_recall_fscore_support,
    roc_auc_score,
    roc_curve,
)
from torch import nn
from torch.utils.data import DataLoader, Dataset, Subset

from training.audio_dataset import AudioDataset
from training.augmentations import load_augmentation_config
from training.model import VoiceCloneDetector


def classification_metrics(
    labels_array: np.ndarray,
    scores_array: np.ndarray,
    threshold: float,
) -> dict[str, Any]:
    predictions = (scores_array >= threshold).astype(np.int64)
    matrix = confusion_matrix(labels_array, predictions, labels=[0, 1])
    tn, fp, fn, tp = (int(value) for value in matrix.ravel())
    precision, recall, f1, _support = precision_recall_fscore_support(
        labels_array,
        predictions,
        average="binary",
        zero_division=0,
    )
    return {
        "threshold": threshold,
        "accuracy": float(np.mean(predictions == labels_array)),
        "precision": float(precision),
        "recall": float(recall),
        "f1": float(f1),
        "confusion_matrix": {"tn": tn, "fp": fp, "fn": fn, "tp": tp},
    }


def metric_report(labels: list[int], scores: list[float], threshold: float) -> dict[str, Any]:
    labels_array = np.asarray(labels, dtype=np.int64)
    scores_array = np.asarray(scores, dtype=np.float64)
    report: dict[str, Any] = {
        "examples": len(labels),
        **classification_metrics(labels_array, scores_array, threshold),
        "roc_auc": None,
        "pr_auc": None,
        "eer": None,
        "eer_threshold": None,
    }
    if len(set(labels)) < 2:
        return report

    fpr, tpr, thresholds = roc_curve(labels_array, scores_array)
    fnr = 1 - tpr
    eer_index = int(np.argmin(np.abs(fnr - fpr)))
    report.update(
        {
            "roc_auc": float(roc_auc_score(labels_array, scores_array)),
            "pr_auc": float(average_precision_score(labels_array, scores_array)),
            "eer": float((fpr[eer_index] + fnr[eer_index]) / 2),
            "eer_threshold": float(thresholds[eer_index]),
            "eer_operating_point": classification_metrics(
                labels_array,
                scores_array,
                float(thresholds[eer_index]),
            ),
        }
    )
    return report


def limited_dataset(dataset: AudioDataset, limit: int, seed: int) -> Dataset:
    if limit <= 0 or limit >= len(dataset):
        return dataset
    indices = list(range(len(dataset)))
    random.Random(seed).shuffle(indices)
    return Subset(dataset, sorted(indices[:limit]))


@torch.inference_mode()
def evaluate_model(
    model: nn.Module,
    loader: DataLoader,
    device: torch.device,
    threshold: float,
    log_every: int = 0,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    model.eval()
    predictions: list[dict[str, Any]] = []
    started = time.perf_counter()
    for batch_number, batch in enumerate(loader, start=1):
        waveform = batch["waveform"].to(device, non_blocking=True)
        batch_labels = batch["label"].tolist()
        scores = torch.sigmoid(model(waveform).logits).cpu().tolist()
        metadata = batch["metadata"]
        sample_ids = batch["sample_id"]
        for index, (label, score) in enumerate(zip(batch_labels, scores, strict=True)):
            row: dict[str, Any] = {
                "sample_id": str(sample_ids[index]),
                "label": int(label),
                "score": float(score),
            }
            for key, values in metadata.items():
                row[key] = str(values[index])
            predictions.append(row)
        if log_every and batch_number % log_every == 0:
            elapsed = time.perf_counter() - started
            print(
                f"evaluated={len(predictions)} examples_per_second="
                f"{len(predictions) / elapsed:.2f}",
                flush=True,
            )

    labels = [int(row["label"]) for row in predictions]
    scores = [float(row["score"]) for row in predictions]
    report: dict[str, Any] = {
        "overall": metric_report(labels, scores, threshold),
        "slices": {},
    }
    for field in ("source", "language", "attack_type"):
        values = sorted({str(row[field]) for row in predictions if field in row})
        if not values:
            continue
        report["slices"][field] = {}
        for value in values:
            selected = [row for row in predictions if row.get(field) == value]
            report["slices"][field][value] = metric_report(
                [int(row["label"]) for row in selected],
                [float(row["score"]) for row in selected],
                threshold,
            )
    return report, predictions


def model_from_checkpoint(path: Path, device: torch.device) -> tuple[VoiceCloneDetector, dict]:
    payload = torch.load(path, map_location="cpu", weights_only=True)
    architecture = payload.get("architecture", {})
    model = VoiceCloneDetector(
        model_name=payload.get("model_name", architecture.get("model_name", "facebook/wav2vec2-base")),
        hidden_size=payload.get("hidden_size", architecture.get("hidden_size", 256)),
        graph_layers=payload.get("graph_layers", architecture.get("graph_layers", 2)),
        graph_heads=payload.get("graph_heads", architecture.get("graph_heads", 4)),
        dropout=payload.get("dropout", architecture.get("dropout", 0.15)),
        waveform_normalization=payload.get(
            "waveform_normalization", architecture.get("waveform_normalization", "none")
        ),
    )
    state_dict = payload.get("state_dict", payload.get("model"))
    if state_dict is None:
        raise ValueError(f"checkpoint has no model weights: {path}")
    model.load_state_dict(state_dict)
    return model.to(device), payload


def write_predictions(path: Path, rows: list[dict[str, Any]]) -> None:
    fieldnames = sorted({key for row in rows for key in row})
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--checkpoint", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument(
        "--augmentation-config",
        type=Path,
        default=Path("training/configs/augmentation.yaml"),
    )
    parser.add_argument("--split", choices=("validation", "test"), default="validation")
    parser.add_argument("--batch-size", type=int, default=2)
    parser.add_argument("--workers", type=int, default=0)
    parser.add_argument("--threshold", type=float, default=0.5)
    parser.add_argument("--max-examples", type=int, default=0)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--log-every", type=int, default=100)
    parser.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.batch_size < 1 or args.workers < 0 or args.max_examples < 0:
        raise ValueError("batch-size must be positive; workers and max-examples cannot be negative")
    device = torch.device(args.device)
    if device.type == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("CUDA requested but unavailable")
    config = load_augmentation_config(args.augmentation_config, project_root=Path.cwd())
    dataset = AudioDataset(args.manifest, args.split, config, seed=args.seed)
    selected = limited_dataset(dataset, args.max_examples, args.seed)
    loader = DataLoader(
        selected,
        batch_size=args.batch_size,
        shuffle=False,
        num_workers=args.workers,
        pin_memory=device.type == "cuda",
    )
    model, payload = model_from_checkpoint(args.checkpoint, device)
    report, predictions = evaluate_model(
        model,
        loader,
        device,
        args.threshold,
        log_every=args.log_every,
    )
    report["checkpoint"] = str(args.checkpoint)
    report["checkpoint_phase"] = payload.get("phase")
    report["split"] = args.split
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "evaluation.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    write_predictions(args.output / "predictions.csv", predictions)
    print(json.dumps(report["overall"], indent=2))


if __name__ == "__main__":
    main()
