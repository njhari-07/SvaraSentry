# Stop/final-score follow-up — 10 September 2026

The user chose to retain the deployed Phase A epoch 3 model. No model weights, inference preprocessing, thresholds or training configuration were changed in this follow-up.

## Findings and changes

- Stop ends capture, but the backend must finish audio already queued before the ordered stop marker. Previously, the dashboard continued displaying each late smoothed score during that interval. It now holds the display and explicitly labels this interval **FINALIZING ANALYSIS**. The all-window arithmetic average replaces the held live value once confirmed. This one final transition is necessary: the last live smoothed value is not the all-window average.
- A stream-scoped score lifecycle rejects duplicate and out-of-order results, stale-stream messages, duplicate final summaries and any result after finalization. Reconnecting to the same completed stream cannot clear its final score. Last-window metadata is retained during draining without moving the gauge.
- Phone Stop now waits for the matching stream's completion before a session change/reset can proceed. Timeout or disconnect is reported as unconfirmed, not success.
- A previously scheduled phone reconnect checks whether reconnection is still wanted. It cannot restart capture after an intentional Stop. Duplicate Stop requests are guarded.
- Blurring the unchanged session-name field no longer unnecessarily stops/reset-displays the current session.
- Added a recording-condition caveat and basic quiet/near-clipping guidance. These are display-only heuristics, not validated distance measurement, noise detection or probability correction. No windows are excluded from the average and no scores are artificially reduced.

## Verification

- Frontend TypeScript and ESLint checks passed.
- Eight Node tests passed: six resampling/worklet tests plus two lifecycle tests covering draining, immutability, duplicate acknowledgments, reconnection and stale windows.
- Eleven backend API tests passed, including ordered-stop draining and all-window arithmetic averages.
- Before deployment, backend health confirmed Phase A epoch 3 with the existing 0.8793585300445557 EER threshold. Only the frontend Docker service is being rebuilt/recreated.

Deployment completed: the frontend production build passed and the recreated frontend became healthy; the backend was not restarted. A browser test uploaded the original Recorder M4A and clicked Stop during streaming. The display showed **FINALIZING ANALYSIS**, holding 73% at 10 displayed windows; after the queued window finished, it showed **FINAL AVERAGE RISK 40%**, 11 windows. The persisted server summary was 0.4002 with `completed: true` and `audio_connected: false`. This verifies the intended single live-to-final transition, not improved model accuracy. Post-test backend health still reports the original Phase A epoch 3 model.

## Remaining limitation

Microphone distance changes voice level, room/reverberation balance and speech-to-background ratio. The user's observation is consistent with the measured recording-condition sensitivity, but it does not establish distance as the sole cause. The retained model still misclassifies some genuine recordings. This UI/transport fix does not claim to repair that model limitation.
