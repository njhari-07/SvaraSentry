"""Deterministic source/label-balanced draws with independent crops per draw."""

from collections import Counter
from typing import ClassVar

import torch
from torch.utils.data import Dataset

from training.audio_dataset import AudioDataset, AudioRecord


def sampling_group(record: AudioRecord) -> str:
    path = str(record.path).replace("\\", "/").lower()
    if record.metadata.get("source") == "asvspoof2019_la":
        return "asv_real" if record.label == 0 else "asv_fake"
    if "/team_recordings/" in path and record.label == 0:
        return "team_real"
    if "/sarvam_cloned/" in path and record.label == 1:
        return "team_fake"
    if record.label == 0:
        return "public_real"
    raise ValueError(f"unrecognized fake training source: {record.path}")


class ChannelBalancedDataset(Dataset):
    # Equal class mass, 70% ASV overall, 30% target-domain material.
    group_mass: ClassVar[dict[str, float]] = {"asv_real": 0.35, "asv_fake": 0.35,
                  "team_real": 0.075, "public_real": 0.075, "team_fake": 0.15}

    def __init__(self, dataset: AudioDataset, seed: int = 42):
        if dataset.split != "train":
            raise ValueError("balanced sampling is training-only")
        self.dataset = dataset
        self.records = dataset.records
        self.seed = seed
        self.groups = [sampling_group(record) for record in self.records]
        counts = Counter(self.groups)
        if set(counts) != set(self.group_mass):
            raise ValueError(f"missing required training groups: {set(self.group_mass) - set(counts)}")
        self.weights = torch.tensor([self.group_mass[group] / counts[group]
                                     for group in self.groups], dtype=torch.double)
        self.set_epoch(0)

    def set_epoch(self, epoch: int):
        self.dataset.set_epoch(epoch)
        generator = torch.Generator().manual_seed(self.seed + epoch)
        self.draws = torch.multinomial(self.weights, len(self.records), replacement=True,
                                       generator=generator).tolist()

    def __len__(self):
        return len(self.draws)

    def __getitem__(self, index):
        return self.dataset.get_draw(self.draws[index], draw_id=index)

    def distribution(self):
        return dict(Counter(self.groups[index] for index in self.draws))
