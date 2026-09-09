import argparse
import csv

import torch
from torch import nn

from training.audio_dataset import AudioDataset
from training.augmentations import AugmentationConfig
from training.export_checkpoint import export_training_checkpoint
from training.train import (
    existing_overall_best_eer,
    make_loader,
    serializable_arguments,
    serving_checkpoint,
)


def test_existing_manifest_dev_split_is_validation(tmp_path):
    manifest = tmp_path / "manifest.csv"
    with manifest.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["path", "label", "split", "attack_type"])
        writer.writeheader()
        writer.writerows([
            {"path": "train.flac", "label": "real", "split": "train", "attack_type": "none"},
            {"path": "dev.flac", "label": "fake", "split": "dev", "attack_type": "A01"},
        ])
    dataset = AudioDataset(manifest, "validation", AugmentationConfig(enabled=False))
    assert len(dataset) == 1
    assert dataset.records[0].path.name == "dev.flac"
    assert dataset.records[0].metadata["fake_engine"] == "A01"


def test_workers_restart_to_receive_epoch_state():
    args = argparse.Namespace(batch_size=1, workers=2, device="cpu")
    loader = make_loader([torch.zeros(1)], args, shuffle=False)
    assert not loader.persistent_workers


def test_export_has_backend_contract(tmp_path):
    model = nn.Module()
    model.projection = nn.Sequential(nn.LayerNorm(4), nn.Linear(4, 2))
    path = tmp_path / "model.pt"
    torch.save(serving_checkpoint(model, "local-encoder", {"overall": {"eer": 0.2}}), path)
    payload = torch.load(path, weights_only=True)
    assert payload["model_name"] == "local-encoder"
    assert payload["hidden_size"] == 2
    model.load_state_dict(payload["state_dict"], strict=True)


def test_checkpoint_arguments_are_safe_loader_compatible(tmp_path):
    arguments = serializable_arguments(
        argparse.Namespace(manifest=tmp_path / "manifest.csv", epochs=1)
    )
    path = tmp_path / "arguments.pt"
    torch.save(arguments, path)
    loaded = torch.load(path, weights_only=True)
    assert loaded == {"manifest": str(tmp_path / "manifest.csv"), "epochs": 1}


def test_export_training_checkpoint_preserves_winner_metadata(tmp_path):
    source = tmp_path / "phase-a-best.pt"
    output = tmp_path / "model.pt"
    torch.save(
        {
            "format_version": 2,
            "phase": "a",
            "epoch": 3,
            "architecture": {
                "model_name": "local-encoder",
                "hidden_size": 256,
                "graph_layers": 2,
                "graph_heads": 4,
                "dropout": 0.15,
            },
            "model": {"weight": torch.ones(2)},
            "report": {"overall": {"eer": 0.0379, "eer_threshold": 0.8785}},
        },
        source,
    )

    metadata = export_training_checkpoint(source, output)
    exported = torch.load(output, weights_only=True)

    assert metadata["selection"]["phase"] == "a"
    assert exported["selection"] == {
        "metric": "eer",
        "value": 0.0379,
        "phase": "a",
        "epoch": 3,
        "source": "phase-a-best.pt",
    }
    assert torch.equal(exported["state_dict"]["weight"], torch.ones(2))


def test_overall_best_eer_compares_all_phases(tmp_path):
    (tmp_path / "phase-a-epoch-001.json").write_text(
        '{"overall": {"eer": 0.04}}', encoding="utf-8"
    )
    (tmp_path / "phase-b-epoch-001.json").write_text(
        '{"overall": {"eer": 0.06}}', encoding="utf-8"
    )
    assert existing_overall_best_eer(tmp_path) == 0.04
