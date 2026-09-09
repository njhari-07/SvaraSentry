import random
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
import torch
from torch import nn

from training.audio_dataset import AudioRecord
from training.balanced_dataset import ChannelBalancedDataset
from training.model import VoiceCloneDetector
from training.train import accumulation_group_size, atomic_torch_save, restore_rng, rng_state


def test_partial_gradient_group_has_correct_weight():
    assert [accumulation_group_size(i, 11, 8) for i in range(1, 12)] == [8] * 8 + [3] * 3
    assert accumulation_group_size(26143, 26143, 8) == 7


def test_rng_round_trip_is_weights_only_safe(tmp_path):
    path = tmp_path / "rng.pt"
    atomic_torch_save(rng_state(), path)
    expected = (random.random(), np.random.rand(), torch.rand(2))
    restore_rng(torch.load(path, weights_only=True))
    assert expected[0] == random.random()
    assert expected[1] == np.random.rand()
    assert torch.equal(expected[2], torch.rand(2))
    assert not path.with_suffix(".pt.tmp").exists()


class FakeDataset:
    split = "train"

    def __init__(self):
        examples = [("asv_real", 0, "asvspoof2019_la"), ("asv_fake", 1, "asvspoof2019_la"),
                    ("raw/real/team_recordings/name/real", 0, "name"),
                    ("raw/fake/sarvam_cloned/name/fake", 1, "name"), ("public/real", 0, "cdac")]
        self.records = [AudioRecord(Path(path), label, str(i), {"source": source})
                        for i, (path, label, source) in enumerate(examples * 2000)]

    def set_epoch(self, epoch):
        self.epoch = epoch

    def get_draw(self, index, draw_id=None):
        return index, draw_id


def test_balanced_draws_are_reproducible_and_label_balanced():
    dataset = ChannelBalancedDataset(FakeDataset())
    original = dataset.draws.copy()
    counts = dataset.distribution()
    for key, mass in dataset.group_mass.items():
        assert abs(counts[key] / len(dataset) - mass) < 0.02
    assert dataset[5] == (dataset.draws[5], 5)
    dataset.set_epoch(1)
    assert dataset.draws != original
    dataset.set_epoch(0)
    assert dataset.draws == original
    fake = FakeDataset()
    fake.split = "validation"
    with pytest.raises(ValueError, match="training-only"):
        ChannelBalancedDataset(fake)


def test_waveform_policy_is_optional_and_gain_stable(monkeypatch):
    class Encoder(nn.Module):
        config = SimpleNamespace(hidden_size=8)

        def forward(self, wave):
            self.input = wave.detach().clone()
            return SimpleNamespace(last_hidden_state=wave[:, ::100].unsqueeze(-1).repeat(1, 1, 8))

    monkeypatch.setattr("training.model.Wav2Vec2Model.from_pretrained", lambda _: Encoder())
    model = VoiceCloneDetector("stub", hidden_size=8, dropout=0, graph_layers=1).eval()
    wave = torch.randn(1, 800) * 0.05 + 0.01
    with torch.no_grad():
        model(wave)
        assert torch.equal(model.encoder.input, wave)  # legacy checkpoint unchanged
        model.waveform_normalization = "zero_mean_unit_variance"
        first = model(wave).logits
        assert abs(float(model.encoder.input.mean())) < 1e-5
        assert abs(float(model.encoder.input.square().mean()) - 1) < 0.001
        second = model(wave * 2).logits
        assert torch.allclose(first, second, atol=1e-4)
