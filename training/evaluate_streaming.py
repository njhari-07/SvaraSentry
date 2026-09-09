"""Evaluate complete held-out target recordings using serving-style 3s/1s windows."""

import argparse
import json
from pathlib import Path

import numpy as np
import torch

from training.audio_dataset import AudioDataset, _decode_source
from training.augmentations import AugmentationConfig
from training.evaluate import metric_report, model_from_checkpoint


@torch.inference_mode()
def score_recording(model, path, device):
    waveform = _decode_source(path, 16000)
    # PCM16 transport contract; no training augmentation or random crop.
    waveform = torch.trunc(waveform.clamp(-1, 1) * torch.where(waveform < 0, 32768, 32767)) / 32768
    scores = [float(model(waveform[start:start + 48000].unsqueeze(0).to(device)).logits.sigmoid().item())
              for start in range(0, waveform.numel() - 48000 + 1, 16000)]
    if not scores:
        return None
    return {"windows": len(scores), "mean": float(np.mean(scores)), "peak": max(scores),
            "scores": scores, "duration_seconds": waveform.numel() / 16000}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, default=Path("data/manifests/dataset_manifest.csv"))
    args = parser.parse_args()
    torch.set_num_threads(4)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model, payload = model_from_checkpoint(args.checkpoint, device)
    model.eval()
    dataset = AudioDataset(args.manifest, "validation", AugmentationConfig(enabled=False))
    records, skipped = [], []
    for record in dataset.records:
        if record.metadata.get("source") == "asvspoof2019_la":
            continue
        summary = score_recording(model, record.path, device)
        if summary is None:
            skipped.append(str(record.path))
            continue
        records.append({"path": str(record.path), "label": record.label, **record.metadata, **summary})
        print(f"target_file={len(records)} source={record.metadata.get('source')} mean={summary['mean']:.4f}", flush=True)
    if not records:
        raise ValueError("no target-domain validation recordings")
    report = {
        "checkpoint": str(args.checkpoint), "selection": payload.get("selection"),
        "scope": "Held-out-speaker team dev plus public-corpus row-level dev; reused development data, not an independent test set.",
        "window_samples": 48000, "stride_samples": 16000,
        "recording_metrics_at_0.5": metric_report([r["label"] for r in records], [r["mean"] for r in records], 0.5),
        "window_metrics_at_0.5": metric_report([r["label"] for r in records for _ in r["scores"]],
                                               [s for r in records for s in r["scores"]], 0.5),
        "slices": {}, "records": records, "skipped_shorter_than_3s": skipped,
    }
    for field in ("source", "language"):
        report["slices"][field] = {}
        for value in sorted({r.get(field, "unknown") for r in records}):
            selected = [r for r in records if r.get(field, "unknown") == value]
            report["slices"][field][value] = metric_report([r["label"] for r in selected], [r["mean"] for r in selected], 0.5)
    diagnostic = Path("tmp/mic-diagnostic/recorder-plain.flac")
    if diagnostic.is_file():
        report["recorder_diagnostic_not_training_data"] = score_recording(model, diagnostic, device)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"streaming evaluation saved: {args.output}", flush=True)


if __name__ == "__main__":
    main()
