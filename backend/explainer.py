"""Deterministic, evidence-bound layperson explanations.

This module is deliberately independent of an LLM. It establishes a factual
contract first; an optional LangChain layer may only rewrite this result.
"""

from __future__ import annotations

from collections.abc import Mapping

_ACTIONS = {
    "none": "Continue monitoring. Stay alert to unusual requests.",
    "caution": "Pause sensitive actions and verify the caller independently.",
    "high": "Stop sensitive actions and verify the caller through a trusted channel.",
}


def build_explanation(
    *,
    model_kind: str,
    model_mode: str,
    fake_probability: float,
    risk_score: float,
    smoothed_risk: float,
    alert_level: str,
    signal: Mapping[str, object],
    acoustic_features: Mapping[str, object],
    model_evidence: Mapping[str, object] | None = None,
    identity_match: float | None = None,
    caution_threshold: float = 0.55,
    high_threshold: float = 0.75,
) -> dict[str, object]:
    """Build a compact explanation from only measured backend fields."""

    if model_mode == "baseline":
        return {
            "source": "deterministic",
            "summary": "Integration baseline is active. This score validates the audio pipeline, not a trained deepfake model.",
            "anomaly_label": "No trained-model attribution",
            "evidence": ["A trained checkpoint is required for model-attention explanations."],
            "limits": ["Do not treat this baseline result as a deepfake finding."],
            "confidence": "limited",
            "recommended_action": "Load a trained checkpoint before using this result for an authenticity decision.",
        }

    evidence = dict(model_evidence or {})
    regions = list(evidence.get("top_time_regions", []))
    occlusion_regions = list(evidence.get("time_occlusion_regions", []))
    band_regions = list(evidence.get("frequency_band_occlusion", []))
    signal_quality = str(acoustic_features.get("signal_quality", signal.get("state", "unknown")))
    level_text = {"none": "Low clone risk", "caution": "Caution", "high": "High clone risk"}.get(alert_level, "Clone-risk result")
    summary = f"{level_text}. The current session risk is {round(smoothed_risk * 100)}%."
    factual_evidence = [
        f"The checkpoint model estimated {round(fake_probability * 100)}% fake probability for this window.",
    ]

    if regions:
        region = _top_delta_or_importance(occlusion_regions, regions)
        start, end = int(region.get("start_ms", 0)), int(region.get("end_ms", 0))
        if region.get("method") == "time_occlusion":
            change = round(abs(float(region.get("probability_delta", 0))) * 100)
            factual_evidence.append(
                f"Masking audio around {start / 1000:.2f}-{end / 1000:.2f} seconds changed the fake probability by {change} percentage points."
            )
        else:
            factual_evidence.append(
                f"The model placed its strongest attention on audio around {start / 1000:.2f}-{end / 1000:.2f} seconds."
            )

    if band_regions:
        strongest_band = max(band_regions, key=lambda item: abs(float(item.get("probability_delta", 0))))
        low, high = strongest_band.get("band_hz", [0, 0])
        change = round(abs(float(strongest_band.get("probability_delta", 0))) * 100)
        factual_evidence.append(
            f"Reducing energy in the {low}-{high} Hz band changed the fake probability by {change} percentage points."
        )

    if signal_quality in {"silence", "quiet", "clipping"}:
        factual_evidence.append(f"Signal quality is {signal_quality}, which limits confidence in this result.")
    else:
        factual_evidence.append("Signal quality is usable, with no major silence or clipping warning.")
    if identity_match is not None:
        factual_evidence.append(f"The optional enrolled-voice similarity is {round(identity_match * 100)}%.")

    nearest_threshold = min(abs(smoothed_risk - caution_threshold), abs(smoothed_risk - high_threshold))
    confidence = "limited" if signal_quality in {"silence", "quiet", "clipping"} else "moderate"
    has_material_occlusion = any(
        abs(float(item.get("probability_delta", 0))) >= 0.08
        for item in occlusion_regions
        if isinstance(item, Mapping)
    )
    if has_material_occlusion and nearest_threshold >= 0.08 and signal_quality == "usable":
        confidence = "strong"
    limits = [
        "This identifies model-influential audio, not proof that a voice is synthetic.",
        "The spectrogram is visual context; its colours do not determine the authenticity decision.",
    ]
    if not band_regions:
        limits.append("No frequency-level attribution was computed for this prediction.")
    else:
        limits.append("Band-occlusion results show sensitivity to a broad band, not a proven fake frequency.")

    return {
        "source": "deterministic",
        "model_kind": model_kind,
        "summary": summary,
        "anomaly_label": "Influential time region" if regions else "No localized model region",
        "evidence": factual_evidence,
        "limits": limits,
        "confidence": confidence,
        "recommended_action": _ACTIONS.get(alert_level, _ACTIONS["caution"]),
        "risk_context": {"risk_score": round(risk_score, 4), "smoothed_risk": round(smoothed_risk, 4)},
    }


def _top_delta_or_importance(
    occlusion_regions: list[object], regions: list[object]
) -> Mapping[str, object]:
    usable_occlusion = [item for item in occlusion_regions if isinstance(item, Mapping)]
    if usable_occlusion:
        return max(usable_occlusion, key=lambda item: abs(float(item.get("probability_delta", 0))))
    usable_regions = [item for item in regions if isinstance(item, Mapping)]
    return max(usable_regions, key=lambda item: float(item.get("importance", 0)))
