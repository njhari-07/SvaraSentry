"""Read-only checkpoint experiments; never modifies weights or source audio."""

from __future__ import annotations

import argparse
import csv
import json
import time
from collections import Counter
from pathlib import Path

import numpy as np
import soundfile as sf
import torch

from training.evaluate import model_from_checkpoint


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkpoint", type=Path, default=Path("training/checkpoints/model.pt"))
    parser.add_argument("--output", type=Path, default=Path("runs/model-audit-2026-09-10/robustness.json"))
    args = parser.parse_args()
    torch.set_num_threads(4)
    started = time.perf_counter()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model, payload = model_from_checkpoint(args.checkpoint, device)
    model.eval()
    with Path("data/manifests/dataset_manifest.csv").open(encoding="utf-8", newline="") as handle:
        manifest = list(csv.DictReader(handle))
    files = {}
    for label in ("real", "fake"):
        files[label] = Path(next(
            row["path"] for row in manifest
            if row["source"] == "harish" and row["language"] == "en" and row["label"] == label
        ))
    files["recorder_real"] = Path("tmp/mic-diagnostic/recorder-plain.flac")
    records = []
    for name, path in files.items():
        samples, rate = sf.read(path, dtype="float32", always_2d=True)
        if rate != 16000:
            raise ValueError(f"Expected converted 16 kHz diagnostic input: {path}")
        samples = samples.mean(axis=1)
        available = (len(samples) - 48000) // 16000 + 1
        # Full recorder; first 18 seconds of long team files for a bounded audit.
        starts = range(min(available, 18))
        for window in starts:
            base = samples[window * 16000:window * 16000 + 48000]
            variants = {"unchanged": base}
            if window in {0, min(available, 18) // 2, min(available, 18) - 1}:
                for gain in (-12, -6, 6, 14):
                    variants[f"gain_{gain:+d}db"] = np.clip(base * 10 ** (gain / 20), -1, 1)
                centered = base - base.mean()
                variants["zero_mean_unit_variance"] = centered / np.sqrt(centered.var() + 1e-7)
                variants["rms_minus24db"] = np.clip(
                    base * (10 ** (-24 / 20)) / max(float(np.sqrt(np.mean(base ** 2))), 1e-6), -1, 1
                )
            for variant, waveform in variants.items():
                # Match serving PCM quantization except the normalization candidate,
                # which is a proposed floating-point MODEL-input policy, not PCM gain.
                if variant != "zero_mean_unit_variance":
                    waveform = (waveform * 32767).astype("<i2").astype(np.float32) / 32768
                with torch.inference_mode():
                    output = model(torch.from_numpy(waveform.astype(np.float32)).unsqueeze(0).to(device))
                records.append({
                    "audio": name, "window": window + 1, "end_seconds": window + 3,
                    "variant": variant, "score": float(output.logits.sigmoid().item()),
                    "rms_dbfs": float(20 * np.log10(max(np.sqrt(np.mean(waveform ** 2)), 1e-10))),
                    "peak": float(np.abs(waveform).max()),
                    "clipped_fraction": float(np.mean(np.abs(waveform) >= 0.999)),
                })
        print(f"audited {name}: {min(available, 18)} windows", flush=True)
    summaries = []
    for name in files:
        for variant in sorted({r["variant"] for r in records if r["audio"] == name}):
            values = [r["score"] for r in records if r["audio"] == name and r["variant"] == variant]
            summaries.append({"audio": name, "variant": variant, "windows": len(values),
                              "mean": float(np.mean(values)), "min": min(values), "max": max(values)})
    source_label = Counter((r["source"], r["label"], r["split"]) for r in manifest)
    report = {
        "checkpoint": str(args.checkpoint), "selection": payload.get("selection"),
        "device": str(device), "duration_seconds": time.perf_counter() - started,
        "total_parameters": sum(p.numel() for p in model.parameters()),
        "encoder_config": {key: getattr(model.encoder.config, key, None) for key in
                           ("apply_spec_augment", "mask_time_prob", "layerdrop", "hidden_dropout", "feat_extract_norm")},
        "source_label_split": [{"source": k[0], "label": k[1], "split": k[2], "count": v}
                               for k, v in sorted(source_label.items())],
        "summaries": summaries, "windows": records,
        "scope": "Three local files; perturbations share content. Diagnostic, not independent accuracy evaluation.",
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({"output": str(args.output), "inferences": len(records), "seconds": report["duration_seconds"]}))


if __name__ == "__main__":
    main()
