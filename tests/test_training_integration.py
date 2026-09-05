import argparse
import csv

import torch
from torch import nn

from training.audio_dataset import AudioDataset
from training.augmentations import AugmentationConfig
from training.train import make_loader, serving_checkpoint


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
