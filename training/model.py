"""XLSR encoder with a compact AASIST-style spectro-temporal graph head."""

from __future__ import annotations

from contextlib import nullcontext
from dataclasses import dataclass

import torch
from torch import nn
from transformers import Wav2Vec2Model


@dataclass
class DetectorOutput:
    logits: torch.Tensor
    embedding: torch.Tensor
    attention: torch.Tensor


class TemporalGraphBlock(nn.Module):
    """Self-attention message passing over temporal XLSR frame nodes."""

    def __init__(self, hidden_size: int, heads: int, dropout: float) -> None:
        super().__init__()
        self.input_norm = nn.LayerNorm(hidden_size)
        self.graph_attention = nn.MultiheadAttention(
            hidden_size,
            heads,
            dropout=dropout,
            batch_first=True,
        )
        self.message_gate = nn.Parameter(torch.tensor(0.0))
        self.output_norm = nn.LayerNorm(hidden_size)
        self.feed_forward = nn.Sequential(
            nn.Linear(hidden_size, hidden_size * 2),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(hidden_size * 2, hidden_size),
            nn.Dropout(dropout),
        )

    def forward(self, nodes: torch.Tensor) -> torch.Tensor:
        normalized = self.input_norm(nodes)
        messages, _weights = self.graph_attention(
            normalized,
            normalized,
            normalized,
            need_weights=False,
        )
        nodes = nodes + torch.sigmoid(self.message_gate) * messages
        return nodes + self.feed_forward(self.output_norm(nodes))


class VoiceCloneDetector(nn.Module):
    """Binary spoof detector preserving the backend's output/checkpoint contract."""

    def __init__(
        self,
        model_name: str = "facebook/wav2vec2-base",
        hidden_size: int = 256,
        graph_layers: int = 2,
        graph_heads: int = 4,
        dropout: float = 0.15,
        waveform_normalization: str = "none",
    ) -> None:
        super().__init__()
        if hidden_size % graph_heads:
            raise ValueError("hidden_size must be divisible by graph_heads")
        if graph_layers < 1:
            raise ValueError("graph_layers must be positive")

        self.model_name = model_name
        self.hidden_size = hidden_size
        self.graph_layer_count = graph_layers
        self.graph_head_count = graph_heads
        self.dropout_rate = dropout
        if waveform_normalization not in {"none", "zero_mean_unit_variance"}:
            raise ValueError("unsupported waveform normalization policy")
        self.waveform_normalization = waveform_normalization
        self.encoder = Wav2Vec2Model.from_pretrained(model_name)
        input_size = self.encoder.config.hidden_size
        self.projection = nn.Sequential(
            nn.LayerNorm(input_size),
            nn.Linear(input_size, hidden_size),
            nn.GELU(),
            nn.Dropout(dropout),
        )
        self.local_branch = nn.Sequential(
            nn.Conv1d(hidden_size, hidden_size, kernel_size=5, padding=2, groups=4),
            nn.GELU(),
            nn.Dropout(dropout),
        )
        self.graph_blocks = nn.ModuleList(
            TemporalGraphBlock(hidden_size, graph_heads, dropout) for _ in range(graph_layers)
        )
        self.attention = nn.Sequential(
            nn.LayerNorm(hidden_size),
            nn.Linear(hidden_size, hidden_size // 2),
            nn.Tanh(),
            nn.Linear(hidden_size // 2, 1),
        )
        self.embedding_norm = nn.LayerNorm(hidden_size)
        self.classifier = nn.Sequential(
            nn.Linear(hidden_size * 2, hidden_size),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(hidden_size, 1),
        )

    def freeze_encoder(self) -> None:
        for parameter in self.encoder.parameters():
            parameter.requires_grad = False

    def unfreeze_top_encoder_layers(self, layer_count: int) -> list[nn.Parameter]:
        if layer_count < 1:
            raise ValueError("layer_count must be positive")
        self.freeze_encoder()
        layers = self.encoder.encoder.layers
        if layer_count > len(layers):
            raise ValueError(f"encoder has only {len(layers)} transformer layers")
        modules: list[nn.Module] = [*layers[-layer_count:], self.encoder.encoder.layer_norm]
        for module in modules:
            for parameter in module.parameters():
                parameter.requires_grad = True
        return [parameter for parameter in self.encoder.parameters() if parameter.requires_grad]

    def enable_gradient_checkpointing(self) -> None:
        self.encoder.gradient_checkpointing_enable()

    def encoder_is_frozen(self) -> bool:
        return not any(parameter.requires_grad for parameter in self.encoder.parameters())

    def head_parameters(self) -> list[nn.Parameter]:
        return [
            parameter
            for name, parameter in self.named_parameters()
            if not name.startswith("encoder.") and parameter.requires_grad
        ]

    def forward(self, waveform: torch.Tensor) -> DetectorOutput:
        if self.waveform_normalization == "zero_mean_unit_variance":
            # The policy belongs to the checkpoint, never to just one input route.
            waveform = waveform.float()
            waveform = waveform - waveform.mean(dim=-1, keepdim=True)
            waveform = waveform / torch.sqrt(waveform.square().mean(dim=-1, keepdim=True) + 1e-7)
        encoder_context = torch.no_grad() if self.encoder_is_frozen() else nullcontext()
        with encoder_context:
            encoded = self.encoder(waveform).last_hidden_state
        nodes = self.projection(encoded)
        nodes = nodes + self.local_branch(nodes.transpose(1, 2)).transpose(1, 2)
        for block in self.graph_blocks:
            nodes = block(nodes)

        attention = torch.softmax(self.attention(nodes).squeeze(-1), dim=-1)
        attentive_mean = torch.sum(nodes * attention.unsqueeze(-1), dim=1)
        centered = nodes - attentive_mean.unsqueeze(1)
        attentive_std = torch.sqrt(
            torch.sum(centered.square() * attention.unsqueeze(-1), dim=1).clamp_min(1e-5)
        )
        embedding = self.embedding_norm(attentive_mean)
        logits = self.classifier(torch.cat((embedding, attentive_std), dim=-1)).squeeze(-1)
        return DetectorOutput(logits=logits, embedding=embedding, attention=attention)
