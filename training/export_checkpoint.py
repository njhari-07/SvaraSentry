"""Export a resumable training checkpoint into the backend serving format."""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any

import torch


def export_training_checkpoint(source: Path, output: Path) -> dict[str, Any]:
    """Package model weights, architecture, metrics, and selection provenance."""
    source = source.resolve()
    output = output.resolve()
    if source == output:
        raise ValueError("source and output checkpoints must be different files")
    if not source.is_file():
        raise FileNotFoundError(f"training checkpoint not found: {source}")

    payload = torch.load(source, map_location="cpu", weights_only=True, mmap=True)
    state_dict = payload.get("model", payload.get("state_dict"))
    architecture = payload.get("architecture")
    report = payload.get("report", {})
    metrics = report.get("overall", payload.get("metrics"))
    if state_dict is None:
        raise ValueError("training checkpoint does not contain model weights")
    if not isinstance(architecture, dict):
        raise TypeError("training checkpoint does not contain architecture metadata")
    if not isinstance(metrics, dict):
        raise TypeError("training checkpoint does not contain evaluation metrics")

    required = ("model_name", "hidden_size", "graph_layers", "graph_heads", "dropout")
    missing = [key for key in required if key not in architecture]
    if missing:
        raise ValueError(f"architecture metadata is missing: {', '.join(missing)}")

    serving = {
        "format_version": 2,
        **{key: architecture[key] for key in required},
        "waveform_normalization": architecture.get("waveform_normalization", "none"),
        "state_dict": state_dict,
        "metrics": metrics,
        "selection": {
            "metric": "eer",
            "value": metrics.get("eer"),
            "phase": payload.get("phase"),
            "epoch": payload.get("epoch"),
            "source": source.name,
        },
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(f"{output.suffix}.tmp")
    try:
        torch.save(serving, temporary)
        temporary.replace(output)
    finally:
        temporary.unlink(missing_ok=True)
    return {key: value for key, value in serving.items() if key != "state_dict"}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    metadata = export_training_checkpoint(args.source, args.output)
    print(f"exported {args.source} -> {args.output}")
    print(metadata)


if __name__ == "__main__":
    main()
