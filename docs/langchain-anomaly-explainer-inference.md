# LangChain anomaly explainer inference

## Context from Harish

Harish's point is valid: a spectrogram can help a technical reviewer see where
speech energy changes, but a layperson should not be expected to infer the model's
reasoning from colors, harmonics, or frequency bands. The dashboard should give a
plain-language explanation that clearly calls out the suspicious window and tells
the user what action to take.

## Current project state

The project already exposes the right raw material for an explainer:

- `backend/model_inference.py` returns a `fake_probability` from the checkpoint
  model.
- In checkpoint mode, it also returns `flagged_region.time_offset_ms`, derived
  from the model's temporal attention peak.
- `backend/spectrogram.py` returns descriptive acoustic features such as signal
  quality, clipping percentage, dominant band, spectral centroid, spectral
  rolloff, and spectral flatness.
- `backend/main.py` combines model output, smoothed risk, spectrogram metadata,
  acoustic features, optional identity match, and recommended alert level into
  one realtime result payload.

There is no LangChain dependency in the repo today. That means we should not add
an agent before defining exactly what it is allowed to say.

## Main inference

Yes, an explainer agent is a good product idea, but it should explain the model
evidence bundle rather than claim that the spectrogram alone proves a deepfake.

The current model attention is temporal, not frequency-specific. So the honest
message is:

> "The model gave the most weight to this short time interval. During the same
> window, the audio had these measurable properties. Because the overall risk is
> elevated, verify the caller through a trusted channel."

The message should not say:

> "This exact frequency proves the caller is fake."

To clearly indicate a true anomaly in both time and frequency, the model needs a
separate time-frequency attribution method, such as Grad-CAM over a spectrogram
model, integrated gradients, SHAP-style attribution on spectral features, or a
trained auxiliary artifact detector. The current Wav2Vec2 attention head is not
enough to justify that stronger claim.

## Recommended product behavior

Add an `explanation` object to each analysis result:

```json
{
  "explanation": {
    "summary": "High clone risk. The model focused on audio around 1.12-1.28 seconds.",
    "anomaly_label": "Influential time region",
    "evidence": [
      "Model confidence is above the high-risk threshold.",
      "The most influential model interval is 1.12-1.28 seconds in the latest 3-second window.",
      "The signal quality is usable, so the result is less likely to be caused by silence or clipping."
    ],
    "limits": [
      "This is temporal model attention, not proof of a specific fake frequency.",
      "Spectrogram features describe the audio signal; they are not the final authenticity decision."
    ],
    "recommended_action": "Stop sensitive actions and verify the caller using a saved trusted contact."
  }
}
```

This gives the layperson the missing interpretation while preserving scientific
honesty.

## LangChain agent shape

The agent should be small, deterministic, and constrained. It should receive only
structured JSON from the backend, not raw audio:

```text
Inputs:
- alert_level
- risk_score
- smoothed_risk
- flagged_region.time_offset_ms
- acoustic_features.signal_quality
- acoustic_features.clipping_percent
- acoustic_features.dominant_band_hz
- acoustic_features.spectral_flatness
- identity_match, if present
- model_kind

Output:
- summary
- anomaly_label
- evidence bullets
- limitations
- recommended action
```

The prompt should explicitly forbid unsupported frequency claims:

```text
You explain voice-clone risk to a non-technical operator. Use only the provided
fields. Do not claim that a spectrogram pattern proves a fake voice. If the model
only provides temporal attention, call it an influential time region, not a
frequency anomaly. Mention signal-quality limitations when audio is quiet,
silent, noisy, or clipped. Keep the response short and action-oriented.
```

For production, the safer implementation is a hybrid:

1. A rule-based explainer creates the core facts and recommended action.
2. A LangChain/LangGraph layer rewrites those facts into plain language.
3. A validator checks the final text for banned claims such as "this frequency
   proves fake" or "definitely synthetic".

This avoids hallucinated forensic explanations while still giving a polished
layperson-facing inference.

## Implementation path

1. Add a backend `ExplanationResult` dataclass and pure-Python rule-based
   explanation function.
2. Include `explanation` in the WebSocket/API result payload.
3. Render `explanation.summary`, `evidence`, `limits`, and
   `recommended_action` in the dashboard beside the spectrogram.
4. Add LangChain only after the deterministic contract is tested.
5. If the team wants frequency-specific anomaly callouts, add a separate
   attribution pipeline and version it separately from `flagged_region`.

## Shareable response to Harish

We can do this, but the agent should not infer fake frequencies directly from
the spectrogram. The current system can honestly explain the model's most
influential time region, the risk score, signal quality, and acoustic features in
plain language. A LangChain agent can sit on top of that structured evidence and
generate a layperson-friendly explanation, clearly saying where the model focused
and what action the user should take. For true frequency-level anomaly callouts,
we need an additional attribution method, because the current Wav2Vec2 attention
output is temporal attention, not a verified time-frequency proof.
