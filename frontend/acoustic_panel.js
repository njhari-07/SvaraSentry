/**
 * acoustic_panel.js — Acoustic view module for ChhayaSwara dashboard.
 *
 * Owns all rendering logic for the spectrogram panel:
 *   - Spectrogram image with fade transition
 *   - Dynamic frequency-axis labels (mel or linear, from backend metadata)
 *   - Energy color-bar legend with dB bounds
 *   - Model-focus overlay (hatched band + label) — temporal attention only
 *   - Signal-quality badge (silence | quiet | usable | clipping)
 *   - Compact acoustic properties (centroid, rolloff, flatness, dominant band)
 *   - Help tooltip explaining each property
 *   - Crosshair / frequency+time readout on pointermove
 *
 * Design principles enforced here:
 *   - Energy patterns are described, not diagnosed.
 *   - "Model focus" is labelled as temporal weight, not spectral evidence.
 *   - Properties that are null/unavailable are hidden, not shown as 0.
 *   - All transitions respect prefers-reduced-motion.
 *   - Color-vision: the focus overlay uses a hatch pattern in addition to color.
 */

"use strict";

// ---------------------------------------------------------------------------
// Palette (mirrors Python PALETTE_STOPS for the color bar)
// Colors: dark-navy → deep-teal → teal → mint → amber → coral
// ---------------------------------------------------------------------------
const PALETTE = [
  [5, 11, 17],
  [11, 42, 55],
  [16, 103, 107],
  [77, 215, 164],
  [246, 211, 108],
  [255, 114, 92],
];

function paletteColor(t) {
  // t in [0,1] → CSS rgb string
  const scaled = t * (PALETTE.length - 1);
  const i = Math.min(Math.floor(scaled), PALETTE.length - 2);
  const f = scaled - i;
  const a = PALETTE[i], b = PALETTE[i + 1];
  const r = Math.round(a[0] * (1 - f) + b[0] * f);
  const g = Math.round(a[1] * (1 - f) + b[1] * f);
  const bl = Math.round(a[2] * (1 - f) + b[2] * f);
  return `rgb(${r},${g},${bl})`;
}

// ---------------------------------------------------------------------------
// Frequency helpers
// ---------------------------------------------------------------------------
function melToHz(mel) {
  return 700 * (Math.pow(10, mel / 2595) - 1);
}
function hzToMel(hz) {
  return 2595 * Math.log10(1 + hz / 700);
}

/**
 * Build axis tick labels appropriate for the given scale.
 * Returns an array of { label, fraction } objects where fraction is [0,1]
 * (0 = bottom, 1 = top) for positioning on the frequency axis.
 */
function buildFreqTicks(scale, minHz, maxHz) {
  const ticks = [];
  if (scale === "mel") {
    // Select round Hz values and map to mel-scale positions
    const targets = [0, 250, 500, 1000, 2000, 4000, 8000].filter(
      (hz) => hz >= minHz && hz <= maxHz
    );
    const melMin = hzToMel(Math.max(minHz, 1));
    const melMax = hzToMel(maxHz);
    const melSpan = melMax - melMin;
    for (const hz of targets) {
      const melHz = hzToMel(Math.max(hz, 1));
      const fraction = melSpan > 0 ? (melHz - melMin) / melSpan : 0;
      ticks.push({ label: hz >= 1000 ? `${hz / 1000}k` : `${hz}`, fraction });
    }
  } else {
    // Linear scale — evenly spaced
    const n = 5;
    for (let i = 0; i <= n; i++) {
      const hz = minHz + (maxHz - minHz) * (i / n);
      const fraction = i / n;
      ticks.push({ label: hz >= 1000 ? `${(hz / 1000).toFixed(1)}k` : `${Math.round(hz)}`, fraction });
    }
  }
  return ticks;
}

// ---------------------------------------------------------------------------
// Signal quality badge helpers
// ---------------------------------------------------------------------------
const QUALITY_CONFIG = {
  silence: { label: "Silence", icon: "○", cls: "sq-silence" },
  quiet:   { label: "Quiet",   icon: "◔", cls: "sq-quiet" },
  usable:  { label: "Usable speech", icon: "●", cls: "sq-usable" },
  clipping:{ label: "Clipping", icon: "▲", cls: "sq-clipping" },
};

// ---------------------------------------------------------------------------
// Acoustic properties helpers
// ---------------------------------------------------------------------------
function formatHz(hz) {
  if (hz == null || isNaN(hz)) return null;
  return hz >= 1000 ? `${(hz / 1000).toFixed(1)} kHz` : `${Math.round(hz)} Hz`;
}

function formatFlatness(v) {
  if (v == null || isNaN(v)) return null;
  if (v < 0.15) return `${v.toFixed(2)} (tonal)`;
  if (v < 0.45) return `${v.toFixed(2)} (mixed)`;
  return `${v.toFixed(2)} (noise-like)`;
}

function formatBand(band) {
  if (!Array.isArray(band) || band.length < 2) return null;
  const lo = band[0] >= 1000 ? `${band[0] / 1000}k` : `${band[0]}`;
  const hi = band[1] >= 1000 ? `${band[1] / 1000}k` : `${band[1]}`;
  return `${lo}–${hi} Hz`;
}

// ---------------------------------------------------------------------------
// AcousticPanel class
// ---------------------------------------------------------------------------
export class AcousticPanel {
  /**
   * @param {Object} elements — map of element IDs to DOM nodes, resolved
   *                            externally so the class has no document coupling.
   */
  constructor(elements) {
    this._el = elements;
    this._config = null;        // last SpectrogramResult metadata
    this._reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this._crosshairActive = false;

    this._initColorbar();
    this._initCrosshair();
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Update the panel with a new result message from the server. */
  update(result) {
    this._updateSpectrogram(result);
    this._updateSignalQuality(result.acoustic_features);
    this._updateAcousticProps(result.acoustic_features);
    this._updateFocus(result.flagged_region, result.spectrogram);
    if (result.spectrogram) {
      this._config = result.spectrogram;
      this._updateFreqAxis(result.spectrogram);
      this._updateColorbar(result.spectrogram);
    }
  }

  /** Reset to idle state. */
  reset() {
    const el = this._el;
    if (el.img) { el.img.src = ""; el.img.classList.remove("visible"); }
    if (el.empty) el.empty.hidden = false;
    if (el.focus) el.focus.hidden = true;
    if (el.focusLabel) el.focusLabel.hidden = true;
    if (el.badge) { el.badge.textContent = ""; el.badge.className = "signal-quality-badge"; }
    if (el.props) el.props.innerHTML = "";
    this._config = null;
  }

  // -------------------------------------------------------------------------
  // Spectrogram image
  // -------------------------------------------------------------------------

  _updateSpectrogram(result) {
    const el = this._el;
    const b64 = result.spectrogram_png_b64 || result.spectrogram?.image_png_b64;
    if (!b64 || !el.img) return;

    const src = `data:image/png;base64,${b64}`;
    if (el.img.src === src) return;   // identical frame — no flicker

    if (!this._reduceMotion) {
      el.img.style.transition = "opacity 0.18s ease";
      el.img.style.opacity = "0";
    }
    el.img.src = src;
    el.img.classList.add("visible");
    if (el.empty) el.empty.hidden = true;

    if (!this._reduceMotion) {
      requestAnimationFrame(() => { el.img.style.opacity = "1"; });
    }
  }

  // -------------------------------------------------------------------------
  // Frequency axis
  // -------------------------------------------------------------------------

  _updateFreqAxis(meta) {
    const el = this._el;
    if (!el.freqAxis) return;
    const ticks = buildFreqTicks(
      meta.scale || "mel",
      meta.min_frequency_hz ?? 0,
      meta.max_frequency_hz ?? 8000
    );
    // Render ticks top-to-bottom (high frequency first on screen)
    const ticksDesc = [...ticks].sort((a, b) => b.fraction - a.fraction);
    el.freqAxis.innerHTML = ticksDesc
      .map((t) => `<span data-frac="${t.fraction.toFixed(3)}">${t.label}</span>`)
      .join("");
  }

  // -------------------------------------------------------------------------
  // Color bar
  // -------------------------------------------------------------------------

  _initColorbar() {
    const el = this._el;
    if (!el.colorbar) return;
    // Draw a vertical gradient canvas
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 256;
    const ctx = canvas.getContext("2d");
    for (let y = 0; y < 256; y++) {
      const t = 1 - y / 255;   // top = high energy
      ctx.fillStyle = paletteColor(t);
      ctx.fillRect(0, y, 1, 1);
    }
    el.colorbar.style.background =
      `linear-gradient(to bottom, ${PALETTE.slice().reverse().map((c, i) => `rgb(${c.join(",")}) ${(i / (PALETTE.length - 1) * 100).toFixed(0)}%`).join(", ")})`;
  }

  _updateColorbar(meta) {
    const el = this._el;
    if (!el.colorbarHigh) return;
    el.colorbarHigh.textContent = `${meta.ceiling_db ?? -10} dB`;
    if (el.colorbarLow) el.colorbarLow.textContent = `${meta.floor_db ?? -80} dB`;
  }

  // -------------------------------------------------------------------------
  // Model-focus overlay
  // -------------------------------------------------------------------------

  _updateFocus(region, meta) {
    const el = this._el;
    if (!el.focus) return;

    if (!region?.time_offset_ms || !meta) {
      el.focus.hidden = true;
      if (el.focusLabel) el.focusLabel.hidden = true;
      return;
    }

    const [start, end] = region.time_offset_ms;
    const totalMs = (meta.window_seconds ?? 3.0) * 1000;

    // Clamp to window
    const clampedStart = Math.max(0, start);
    const clampedEnd = Math.min(totalMs, end);
    if (clampedEnd <= clampedStart) {
      el.focus.hidden = true;
      if (el.focusLabel) el.focusLabel.hidden = true;
      return;
    }

    const leftPct = (clampedStart / totalMs) * 100;
    const widthPct = Math.max(2, ((clampedEnd - clampedStart) / totalMs) * 100);

    el.focus.style.left = `${leftPct.toFixed(2)}%`;
    el.focus.style.width = `${widthPct.toFixed(2)}%`;
    el.focus.hidden = false;
    if (el.focusLabel) el.focusLabel.hidden = false;
  }

  // -------------------------------------------------------------------------
  // Signal quality badge
  // -------------------------------------------------------------------------

  _updateSignalQuality(features) {
    const el = this._el;
    if (!el.badge || !features) return;
    const quality = features.signal_quality;
    const cfg = QUALITY_CONFIG[quality] || QUALITY_CONFIG.quiet;
    el.badge.textContent = `${cfg.icon} ${cfg.label}`;
    el.badge.className = `signal-quality-badge ${cfg.cls}`;
    el.badge.setAttribute("aria-label", `Signal: ${cfg.label}`);
  }

  // -------------------------------------------------------------------------
  // Acoustic properties
  // -------------------------------------------------------------------------

  _updateAcousticProps(features) {
    const el = this._el;
    if (!el.props || !features) return;

    const rows = [
      {
        key: "Centroid",
        val: formatHz(features.spectral_centroid_hz),
        title: "Spectral centroid — the frequency that divides the spectrum into two equal energy halves. Voiced speech typically sits between 0.5 and 2 kHz.",
      },
      {
        key: "Rolloff",
        val: formatHz(features.spectral_rolloff_hz),
        title: "Spectral rolloff — the frequency below which 85% of total energy is concentrated.",
      },
      {
        key: "Flatness",
        val: formatFlatness(features.spectral_flatness),
        title: "Spectral flatness — 0 means pure tone (harmonic), 1 means broadband noise. This describes texture, not authenticity.",
      },
      {
        key: "Band",
        val: formatBand(features.dominant_band_hz),
        title: "Dominant band — the frequency range with the highest mean energy in this window.",
      },
    ];

    el.props.innerHTML = rows
      .filter((r) => r.val !== null)
      .map(
        (r) =>
          `<div class="ap-row"><span class="ap-key" title="${r.title}">${r.key}</span>` +
          `<span class="ap-val">${r.val}</span></div>`
      )
      .join("");
  }

  // -------------------------------------------------------------------------
  // Crosshair / pointer tooltip
  // -------------------------------------------------------------------------

  _initCrosshair() {
    const el = this._el;
    if (!el.frame || !el.crosshair) return;

    el.frame.addEventListener("pointermove", (e) => this._onPointerMove(e));
    el.frame.addEventListener("pointerleave", () => this._hideCrosshair());
    el.frame.addEventListener("pointerenter", () => { this._crosshairActive = true; });
  }

  _onPointerMove(e) {
    const el = this._el;
    if (!el.crosshair || !el.frame || !this._config) return;

    const rect = el.frame.getBoundingClientRect();
    const xFrac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const yFrac = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));

    // Time (x axis): 0 = oldest, 1 = newest
    const windowSec = this._config.window_seconds ?? 3.0;
    const timeSec = (xFrac - 1) * windowSec;  // negative = seconds ago
    const timeLabel = `${timeSec.toFixed(1)}s`;

    // Frequency (y axis): 0 = top = high freq, 1 = bottom = low freq
    const freqFrac = 1 - yFrac;  // 0 = low, 1 = high
    let freqLabel;
    if (this._config.scale === "mel") {
      const melMin = hzToMel(Math.max(this._config.min_frequency_hz, 1));
      const melMax = hzToMel(this._config.max_frequency_hz);
      const hz = melToHz(melMin + freqFrac * (melMax - melMin));
      freqLabel = formatHz(hz);
    } else {
      const hz = this._config.min_frequency_hz + freqFrac * (this._config.max_frequency_hz - this._config.min_frequency_hz);
      freqLabel = formatHz(hz);
    }

    el.crosshair.textContent = `${freqLabel ?? ""} · ${timeLabel}`;
    el.crosshair.style.left = `${(e.clientX - rect.left + 10).toFixed(0)}px`;
    el.crosshair.style.top = `${(e.clientY - rect.top - 28).toFixed(0)}px`;
    el.crosshair.hidden = false;

    // Update aria-live region for accessibility
    if (el.crosshairAria) {
      el.crosshairAria.textContent = `Pointer at ${freqLabel ?? ""}, ${timeLabel}`;
    }
  }

  _hideCrosshair() {
    this._crosshairActive = false;
    if (this._el.crosshair) this._el.crosshair.hidden = true;
  }
}

// ---------------------------------------------------------------------------
// Factory — resolves DOM elements and returns a ready AcousticPanel
// ---------------------------------------------------------------------------
export function createAcousticPanel() {
  const $ = (id) => document.getElementById(id);
  return new AcousticPanel({
    img:          $("spectrogram"),
    empty:        $("spectrogram-empty"),
    frame:        $("spectrogram-frame"),
    freqAxis:     $("frequency-axis"),
    colorbar:     $("energy-colorbar"),
    colorbarHigh: $("colorbar-high"),
    colorbarLow:  $("colorbar-low"),
    focus:        $("attention-region"),
    focusLabel:   $("focus-legend"),
    badge:        $("signal-quality-badge"),
    props:        $("acoustic-props"),
    crosshair:    $("crosshair-tip"),
    crosshairAria:$("crosshair-aria"),
  });
}
