"""Lazy-loaded wav2vec2 checkpoint adapter."""

from __future__ import annotations

from pathlib import Path

import numpy as np

from backend.attribution import occlude_frequency_bands, occlude_time_regions, top_time_regions
from backend.inference import AttributionOptions, InferenceResult
from backend.spectrogram import pcm_float, signal_metrics
from backend.streaming import AudioChunk


class CheckpointInferenceEngine:
    model_kind = "wav2vec2-attentive"

    def __init__(self, checkpoint_path: Path, attribution: AttributionOptions) -> None:
        if not checkpoint_path.is_file():
            raise FileNotFoundError(f"Checkpoint not found: {checkpoint_path}")
        try:
            import torch
        except ImportError as exc:
            raise RuntimeError("Install the 'ml' dependency extra for checkpoint mode") from exc

        from training.model import VoiceCloneDetector

        payload = torch.load(checkpoint_path, map_location="cpu", weights_only=True)
        if payload.get("format_version") != 2:
            raise ValueError(
                f"Unsupported checkpoint format version: {payload.get('format_version')!r}"
            )
        architecture_keys = ("model_name", "hidden_size", "graph_layers", "graph_heads", "dropout")
        missing = [key for key in architecture_keys if key not in payload]
        if missing:
            raise ValueError(f"Checkpoint architecture is missing: {', '.join(missing)}")
        state_dict = payload.get("state_dict")
        if not isinstance(state_dict, dict):
            raise TypeError("Serving checkpoint does not contain a state_dict")

        model_source = Path(str(payload["model_name"]))
        if not model_source.is_absolute():
            repository_source = Path(__file__).resolve().parents[1] / model_source
            if repository_source.exists():
                model_source = repository_source
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self.model = VoiceCloneDetector(
            model_name=str(model_source),
            hidden_size=int(payload["hidden_size"]),
            graph_layers=int(payload["graph_layers"]),
            graph_heads=int(payload["graph_heads"]),
            dropout=float(payload["dropout"]),
            waveform_normalization=payload.get("waveform_normalization", "none"),
        )
        self.model.load_state_dict(state_dict)
        self.model.to(self.device).eval()
        self.torch = torch
        metrics = payload.get("metrics", {})
        selection = payload.get("selection", {})
        self.checkpoint_metadata = {
            "format_version": payload["format_version"],
            "phase": selection.get("phase"),
            "epoch": selection.get("epoch"),
            "selection_metric": selection.get("metric"),
            "selection_value": selection.get("value"),
            "eer": metrics.get("eer"),
            "eer_threshold": metrics.get("eer_threshold"),
        }
        self.attribution = AttributionOptions(
            top_regions=max(1, attribution.top_regions),
            time_occlusion=attribution.time_occlusion,
            band_occlusion=attribution.band_occlusion,
            integrated_gradients=attribution.integrated_gradients,
        )

    def score(self, chunk: AudioChunk) -> InferenceResult:
        samples = pcm_float(chunk)
        metrics = signal_metrics(samples)
        output = self._forward(samples)
        logit_margin = float(output.logits.item())
        probability = float(self.torch.sigmoid(output.logits).item())
        embedding = output.embedding.squeeze(0).detach().cpu().numpy().astype(np.float32)
        attention = output.attention.squeeze(0).detach().cpu().numpy()
        window_ms = chunk.sample_count * 1000 / chunk.sample_rate
        regions = top_time_regions(
            attention,
            window_ms,
            method="temporal_attention",
            count=self.attribution.top_regions,
        )
        evidence: dict[str, object] = {
            "attribution_type": "wav2vec2_temporal",
            "top_time_regions": regions,
            "methods": ["temporal_attention"],
            "frequency_attribution_available": False,
            "unsupported": [
                "aasist_graph_attention",
                "aasist_node_importance",
                "aasist_edge_importance",
            ],
        }
        if self.attribution.time_occlusion and regions:
            evidence["time_occlusion_regions"] = occlude_time_regions(
                samples,
                regions,
                chunk.sample_rate,
                probability,
                self._probability,
            )
            evidence["methods"].append("time_occlusion")
        if self.attribution.band_occlusion:
            evidence["frequency_band_occlusion"] = occlude_frequency_bands(
                samples,
                chunk.sample_rate,
                probability,
                self._probability,
            )
            evidence["frequency_attribution_available"] = True
            evidence["methods"].append("band_occlusion")
        if self.attribution.integrated_gradients:
            evidence["integrated_gradients_regions"] = self._integrated_gradients_regions(
                samples,
                window_ms,
            )
            evidence["methods"].append("integrated_gradients")

        flagged_region = None
        if regions:
            flagged_region = {
                "time_offset_ms": [regions[0]["start_ms"], regions[0]["end_ms"]],
                "attribution_type": "temporal_attention",
            }
        return InferenceResult(
            fake_probability=probability,
            embedding=embedding,
            rms_dbfs=metrics.rms_dbfs,
            peak=metrics.peak,
            zero_crossing_rate=metrics.zero_crossing_rate,
            signal_state=metrics.state,
            logit_margin=logit_margin,
            flagged_region=flagged_region,
            model_evidence=evidence,
            model_kind=self.model_kind,
        )

    def embed(self, samples: np.ndarray) -> np.ndarray:
        output = self._forward(samples)
        return output.embedding.squeeze(0).detach().cpu().numpy().astype(np.float32)

    def _forward(self, samples: np.ndarray):
        waveform = self.torch.from_numpy(samples).unsqueeze(0).to(self.device)
        with self.torch.inference_mode():
            return self.model(waveform)

    def _probability(self, samples: np.ndarray) -> float:
        output = self._forward(samples)
        return float(self.torch.sigmoid(output.logits).item())

    def _integrated_gradients_regions(
        self, samples: np.ndarray, window_ms: float, steps: int = 12
    ) -> list[dict[str, object]]:
        """Return time regions from integrated gradients over raw waveform input.

        This is intentionally opt-in: it performs multiple backwards passes and
        should normally run on a GPU or an asynchronous analysis worker.
        """

        waveform = self.torch.from_numpy(samples).unsqueeze(0).to(self.device)
        baseline = self.torch.zeros_like(waveform)
        total_gradient = self.torch.zeros_like(waveform)
        for alpha in self.torch.linspace(1 / steps, 1, steps, device=self.device):
            interpolated = (baseline + alpha * (waveform - baseline)).detach().requires_grad_(True)
            output = self.model(interpolated)
            gradient = self.torch.autograd.grad(output.logits.sum(), interpolated)[0]
            total_gradient += gradient
        attribution = ((waveform - baseline) * total_gradient / steps).abs().squeeze(0)
        frame_count = max(1, int(self._forward(samples).attention.shape[-1]))
        frame_size = int(np.ceil(attribution.numel() / frame_count))
        padded = self.torch.nn.functional.pad(
            attribution,
            (0, frame_count * frame_size - attribution.numel()),
        )
        values = padded.reshape(frame_count, frame_size).mean(dim=1).detach().cpu().numpy()
        return top_time_regions(
            values,
            window_ms,
            method="integrated_gradients",
            count=self.attribution.top_regions,
        )
