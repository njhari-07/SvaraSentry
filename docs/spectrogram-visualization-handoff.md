# Spectrogram visualization module handoff

## Purpose

Make the acoustic view visually engaging and genuinely informative. The view
should help an operator understand what speech energy is present, how it changes
through time, whether the signal is usable, and which time region influenced the
model—without pretending that a human can prove a deepfake by looking at colors.

## Existing behavior

The backend currently:

- converts each three-second PCM window to float samples;
- calculates an STFT using a 512-sample frame and 160-sample hop;
- converts power to a log scale;
- normalizes each window by its own percentiles;
- maps values through a fixed color palette;
- returns a 560 by 180 PNG as base64.

The dashboard currently:

- displays the latest PNG;
- labels the frequency range from 0 to 8 kHz;
- labels the three-second time range;
- overlays a red time band when model attention is available.

This works, but per-window normalization can make intensity appear to jump, the
linear frequency layout gives too much space to frequencies above the main speech
region, and the display does not explain acoustic properties clearly.

## Scope and ownership

Primary files:

```text
backend/spectrogram.py
backend/main.py
frontend/index.html
frontend/style.css
frontend/dashboard.js
tests/test_signal_processing.py
```

The owner may add a dedicated frontend visualization module and focused backend
feature structures. They should not change dataset preparation, training,
authentication, phone capture, or the risk formula.

## Design principles

1. **Descriptive, not deceptive.** Energy patterns and model attention may be
   visualized; unvalidated graphics must not be labelled “fake artifact.”
2. **Stable through time.** Similar energy should produce similar colors between
   adjacent windows; avoid independent autoscaling that causes flicker.
3. **Correct axes.** Frequency and time labels must match the actual transform.
4. **Speech-focused.** Make the human speech range readable without hiding the
   full 0–8 kHz input bandwidth.
5. **Accessible.** Use a color-vision-friendly palette, strong contrast, text
   labels, and a non-color-only anomaly indicator.
6. **Fast.** Visualization must remain secondary to inference and stay inside the
   end-to-end latency budget.

## Target experience

The panel should include:

- a crisp spectrogram with stable intensity mapping;
- selectable linear or perceptual/log-frequency view if useful;
- readable time and frequency axes;
- a labelled color scale for relative energy in dB;
- model-attention overlay with a clear legend;
- current signal-quality badge: silence, quiet, usable speech, or clipping;
- compact descriptive properties such as dominant band, spectral centroid,
  spectral rolloff, and spectral flatness/noisiness;
- a short help tooltip explaining energy, harmonics, noise, and attention;
- responsive behavior on desktop and mobile;
- freeze/inspect behavior only if it does not interrupt live monitoring.

## Proposed visual hierarchy

```text
Acoustic view                                      Signal: usable speech
┌────────────────────────────────────────────────────────────────────┐
│ frequency │ spectrogram                              energy scale │
│   8 kHz   │ dark -> teal -> yellow -> coral                high   │
│           │                  [model focus overlay]                   │
│   1 kHz   │ visible harmonics and speech-energy structure           │
│   0 Hz    │                                                   low   │
└────────────────────────────────────────────────────────────────────┘
       -3.0s                 -1.5s                         now

Dominant band: 300–3000 Hz | Centroid: 1.2 kHz | Character: tonal
```

## Backend rendering work

### 1. Spectral transform

- Keep input fixed at 16 kHz mono.
- Use a Hann-windowed STFT with documented frame and hop sizes.
- Calculate power or magnitude consistently and document the dB conversion.
- Consider a mel or log-frequency projection for the main speech-focused view.
- If using mel bins, label the axis accurately; do not display evenly spaced Hz
  ticks on a perceptually spaced axis.
- Keep calculations deterministic for identical input and configuration.

### 2. Stable normalization

Replace per-image percentile normalization with a stable approach, for example:

- fixed dB floor and ceiling selected from representative audio; or
- slowly adapting session-level bounds with strict minimum/maximum limits.

Expose the mapped range in metadata so the frontend color scale is truthful.
Silence must remain visually dark rather than expanding into a bright pattern.

Suggested configurable starting point:

```text
floor: approximately -80 dB relative to full scale
ceiling: approximately -20 to 0 dB relative to full scale
```

Tune these values using representative speech instead of hard-coding based on
one clip.

### 3. Descriptive acoustic properties

Calculate lightweight features with explicit definitions:

- RMS dBFS and peak level;
- dominant frequency or dominant frequency band;
- spectral centroid;
- spectral rolloff frequency;
- spectral flatness;
- optional low/mid/high-band energy ratios;
- clipping percentage, not only maximum peak;
- usable-speech ratio if voice activity detection is added.

These values describe audio. They are not deepfake probabilities and must not be
fed into the risk score without a separately evaluated design decision.

### 4. Model-attention overlay

The model currently supplies temporal attention, not a verified time-frequency
explanation. Therefore:

- overlay a vertical time region only;
- call it **Model focus** or **Influential time region**;
- do not imply that one frequency band caused the decision;
- clamp offsets to the three-second window;
- hide the overlay when attention is absent or invalid;
- visually distinguish focus from high spectrogram energy.

If a future explainability method produces a true time-frequency attribution map,
introduce it under a separately versioned response field.

### 5. Transport contract

Version one may keep `spectrogram_png_b64` for compatibility. Add structured
metadata rather than encoding labels into the image:

```json
{
  "spectrogram": {
    "image_png_b64": "...",
    "scale": "mel",
    "min_frequency_hz": 0,
    "max_frequency_hz": 8000,
    "floor_db": -80,
    "ceiling_db": -10,
    "window_seconds": 3.0
  },
  "acoustic_features": {
    "spectral_centroid_hz": 1210,
    "spectral_rolloff_hz": 3380,
    "spectral_flatness": 0.14,
    "dominant_band_hz": [300, 3000],
    "clipping_percent": 0.0
  }
}
```

For scale, later evaluate binary image delivery, WebP, or client-side rendering;
do not redesign transport before measuring base64 overhead.

## Frontend visualization work

- Render clear axis ticks that match the backend transform.
- Add an energy color bar with low/high labels and dB bounds.
- Use a perceptually ordered, color-vision-friendly palette.
- Keep text readable over the image with non-transparent backing where needed.
- Add crosshair/tooltip inspection on pointer devices if it remains accessible.
- Show acoustic properties as compact labelled values, not unexplained numbers.
- Explain spectral centroid, rolloff, and flatness through help text.
- Show model focus with border/pattern plus color so it remains distinguishable
  for color-vision deficiencies.
- Animate transitions subtly or not at all; avoid flashing on every new window.
- Respect `prefers-reduced-motion`.
- Preserve layout at narrow viewport widths.
- Hide unavailable properties rather than displaying misleading zeros.

## What the visualization may communicate

Safe descriptive examples:

- “Most energy is concentrated in the speech band.”
- “The signal is clipped.”
- “This window is mostly silence.”
- “The spectrum is relatively noise-like.”
- “The model placed more temporal weight on this interval.”

Avoid statements such as:

- “This red frequency proves the voice is fake.”
- “These harmonics are definitely synthetic.”
- “The model detected a fake frequency.”

The deepfake conclusion must come from the evaluated model and calibrated risk
layer, not a visual heuristic invented for the chart.

## Tests

Create deterministic synthetic fixtures and test at minimum:

1. silence produces a valid, mostly dark image and silence metadata;
2. a 440 Hz tone places peak energy near 440 Hz;
3. a two-tone signal shows both expected bands;
4. broadband noise has higher flatness than a pure tone;
5. increased amplitude changes dB energy consistently under fixed normalization;
6. identical input and configuration produce identical image bytes/metadata;
7. image dimensions, MIME signature, and payload bounds are enforced;
8. NaN, Inf, empty, short, and clipped inputs are handled safely;
9. axis labels correspond to linear/mel/log scale configuration;
10. invalid attention offsets are hidden or clamped;
11. frontend handles missing image, metadata, and attention independently;
12. responsive and color-contrast checks pass;
13. rendering time stays within an agreed budget on representative hardware;
14. result payload growth is measured and bounded.

Also keep a small visual QA gallery containing silence, quiet speech, voiced
speech, fricatives, music, broadband noise, hum, and clipping.

## Definition of done

- The spectrogram is stable, sharp, correctly labelled, and visually coherent.
- Silence, tones, speech, noise, and clipping are clearly distinguishable.
- Energy scale and frequency mapping are technically accurate.
- Model focus is presented as temporal attention, not false frequency evidence.
- Descriptive acoustic properties are readable and explained.
- The design works across dashboard sizes and accessibility settings.
- Deterministic numerical tests and a visual QA gallery exist.
- Rendering and payload overhead are measured and remain within budget.
- No dataset, phone relay, training loop, or risk-formula work is mixed into this
  module.
