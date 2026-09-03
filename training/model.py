"""wav2vec2 feature extractor with an attentive anti-spoofing head."""

from __future__ import annotations

from dataclasses import dataclass

import torch
from torch import nn
from transformers import Wav2Vec2Model


@dataclass
class DetectorOutput:
    logits: torch.Tensor
    embedding: torch.Tensor
    attention: torch.Tensor


class VoiceCloneDetector(nn.Module):
    def __init__(self, model_name: str = "facebook/wav2vec2-base", hidden_size: int = 256) -> None:
        super().__init__()
        self.encoder = Wav2Vec2Model.from_pretrained(model_name)
        input_size = self.encoder.config.hidden_size
        self.projection = nn.Sequential(
            nn.LayerNorm(input_size),
            nn.Linear(input_size, hidden_size),
            nn.GELU(),
            nn.Dropout(0.15),
        )
        self.attention = nn.Sequential(
            nn.Linear(hidden_size, hidden_size // 2),
            nn.Tanh(),
            nn.Linear(hidden_size // 2, 1),
        )
        self.classifier = nn.Sequential(
            nn.LayerNorm(hidden_size),
            nn.Linear(hidden_size, hidden_size // 2),
            nn.GELU(),
            nn.Dropout(0.15),
            nn.Linear(hidden_size // 2, 1),
        )

    def forward(self, waveform: torch.Tensor) -> DetectorOutput:
        projected = self.projection(self.encoder(waveform).last_hidden_state)
        attention = torch.softmax(self.attention(projected).squeeze(-1), dim=-1)
        embedding = torch.sum(projected * attention.unsqueeze(-1), dim=1)
        logits = self.classifier(embedding).squeeze(-1)
        return DetectorOutput(logits=logits, embedding=embedding, attention=attention)

