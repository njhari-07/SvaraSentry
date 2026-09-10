# Risk timeline and timing verification

The running `/api/config` reports 16,000 Hz audio, three-second analysis windows and a one-second stride. Thus predictions cover 0–3s, 1–4s, 2–5s, etc.; they are not separate non-overlapping three-second blocks. Result arrival can lag audio time because of inference, rendering and explanation processing. This cadence and the deployed Phase A epoch 3 model remain unchanged.

The timeline now provides:

- Labeled audio elapsed-time and percentage axes, using server window-end timestamps.
- Separate per-window risk and smoothed live-risk lines, with a legend.
- Caution/high threshold guides from the running API configuration, replacing the old hardcoded chart guides and time-based color gradient.
- Final all-window mean guide after completion.
- A selectable, newest-first window table with start/end audio times, risk, smoothing and processing milliseconds.
- Selected-window model output, risk, input level and signal state; a follow-latest action.
- An honest empty state instead of synthetic waveform bars.
- A maximum 120-window local history, explicitly distinguished from the server's all-window final average. Reconnect gaps are disclosed. Queued windows are retained during finalization and added when the final result is confirmed, preserving the Stop display hold.

Checks: frontend lint and typecheck; nine Node audio/lifecycle tests; fourteen Python streaming/API tests. A new timing regression verifies no output before three seconds and successive window end timestamps of 3, 4, 5 and 6 seconds. No inference weights, scoring thresholds, backend audio processing or training settings were changed.

The rebuilt frontend became healthy. An eight-second PCM integration test produced six complete windows, displayed as 00:00–00:03 through 00:05–00:08. Browser verification confirmed all six log entries, selection of window #2 (00:01–00:04), its 4.3% window risk / 1.8% smoothed risk / 981 ms processing detail, and a final all-window mean of 5.4%. Visual inspection confirmed the time axis, threshold guides, selected-window marker and scrollable log. The smoke result is saved locally at `runs/model-audit-2026-09-10/timeline-smoke.json`.
