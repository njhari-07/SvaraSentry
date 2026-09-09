# SvaraSentry model audit and amendment plan

Date: 10 September 2026. Scope: local source, completed training artifacts, exported checkpoint, 108 controlled GPU inferences, live Docker streaming, and browser behavior. No checkpoint was retrained or replaced during the initial audit.

## Finding

The model is working computationally, but its decisions are too sensitive to recording conditions to call it reliable on arbitrary microphones. The strongest evidence is a controlled test on the **same genuine three-second Recorder segment**: its score changes from **0.47% to 88.19% with only +6 dB gain**, without clipping. This cannot be attributed to a changed speaker, language, transcript, or file extension.

The likely explanation is a combination of amplitude/channel shortcuts, insufficient target-device data, and a validation protocol that does not resemble continuous streaming. The architecture itself is not the first thing to replace.

## 1. What was inspected

- `training/model.py`: XLSR encoder, local temporal convolution, two self-attention/graph blocks, attentive mean/std pooling and binary head.
- `training/audio_dataset.py`, `training/augmentations.py`, and the saved experiment configuration.
- `training/train.py`: optimizer setup, freezing, Phase B, accumulation, selection and resume.
- `training/evaluate.py`, all eight saved epoch reports and the 25,037-row development evaluation.
- `backend/model_inference.py`, `risk_engine.py`, streaming, enrollment, session handling and explanation generation.
- Browser file decoding, laptop microphone capture and phone AudioWorklet resampling.
- Production Compose, mounts, secrets, container health and final-window aggregation.

The deployed checkpoint remains Phase A epoch 3, format version 2, with 317,005,188 total parameters. The audit used the existing Windows CUDA environment, `venv/Scripts/python.exe`, with Torch 2.11.0+cu128 and Transformers 4.57.6. The other Python 3.13 interpreter is not this project's environment.

## 2. Controlled measurements

The audit used one stored genuine Harish English file, one stored cloned English file, and the converted genuine Windows Recorder file. It examined 18 overlapping windows from each; long team files were bounded to their first 20 seconds. On windows 1, 10 and 18, it additionally tested six amplitude/normalization variants. Total: **108 inferences**. Actual GPU audit execution took about 12 seconds, excluding interpreter startup.

These are diagnostic comparisons, not a new accuracy benchmark. They reuse known recordings and do not establish population-level performance.

### Same genuine Recorder segment, different amplitude

| Change | Fake score | RMS level | Clipping |
|---|---:|---:|---|
| Original | 0.47% | -34.76 dBFS | None |
| -6 dB | 0.46% | -40.76 dBFS | None |
| +6 dB | 88.19% | -28.75 dBFS | None |
| +14 dB | 89.85% | -20.75 dBFS | None |
| -12 dB | 20.84% | -46.77 dBFS | None |
| RMS normalized to -24 dBFS | 89.33% | -24.00 dBFS | None |
| Zero mean/unit variance, model input | 88.73% | Approximately 0 dB relative to amplitude 1 | Floating-point candidate; not clipped to PCM range |

The response is not monotonic with loudness. A simple volume threshold cannot correct it. Unit-variance normalization here is a floating-point model input experiment; values above 1 are expected in that representation and are not evidence of audio clipping.

### All 18 unmodified windows

| Audio | Average | Minimum | Maximum |
|---|---:|---:|---:|
| Stored real English | 3.83% | 0.33% | 20.40% |
| Stored fake English | 87.44% | 4.50% | 97.87% |
| Recorder real English | 60.12% | 0.47% | 98.21% |

For an apples-to-apples normalization comparison on the same three selected windows, the mean scores were:

- Stored real, unchanged: 7.43%; zero-mean/unit-variance: approximately 35%.
- Stored fake, unchanged: 90.03%; zero-mean/unit-variance: approximately 90%.
- Recorder real, unchanged: 61.81%; zero-mean/unit-variance: approximately 90%.

**Conclusion:** switching normalization on for this existing checkpoint is unsafe. It needs to be learned and evaluated as part of a new training configuration.

Raw results and the repeatable diagnostic are in `runs/model-audit-2026-09-10/robustness.json` and `training/audit_robustness.py`.

## 3. Findings ranked by priority

### P0: Amplitude and channel sensitivity is directly demonstrated

The local pretrained `preprocessor_config.json` specifies `do_normalize: true`. The application directly invokes `Wav2Vec2Model` on raw waveform amplitude, bypassing the feature extractor. The custom head was consequently trained on that amplitude convention too. The pretrained convention and task-training convention differ, but training and serving both use unnormalized amplitude; this is not simply a one-sided serving typo.

Proposed amendment: version an explicit input policy in checkpoint metadata, train candidates with the policy applied inside the shared model entry point, and compare against the unchanged champion. Do not normalize only browser uploads or only the backend.

Wav2Vec2's feature extractor normalization is documented by [Hugging Face](https://huggingface.co/docs/transformers/model_doc/wav2vec2). The local saved preprocessing configuration is the direct evidence for this particular encoder.

### P0: The deployment channel is underrepresented

The manifest has 51,180 rows, of which **50,224 rows are ASVspoof** (45,096 fake and 5,128 real), about 98.13%. The remaining rows total 956. Public Indian-language sources add genuine speech, but only 45 team clone files represent the custom fake domain.

The active team split has only **nine real training files** and **34 fake training files**. A long recording is one dataset row, and the loader takes one random three-second crop from that row each epoch. Thus the deployed Phase A model saw only **27 three-second draws from team-real training files across three epochs: 81 seconds before augmentation**, possibly with overlap. The 66 minutes of stored team-real audio are not all traversed each epoch.

Proposed amendment: build a speaker-grouped window index over long recordings, apply voice-activity filtering, and use balanced sampling across class and recording channel. Split original recordings/speakers before making windows. Otherwise adjacent windows can leak across train and validation.

For a first controlled sampling experiment, consider approximately 70% benchmark and 30% target-channel draws, with real/fake balance inside each group. This is a starting hypothesis, not a proven optimum. If class sampling becomes balanced, recompute or remove the old positive-class loss weight; do not double-correct imbalance blindly.

### P0: Development metrics are not a separate final test

The 25,037 development clips were repeatedly used for epoch selection and threshold selection. The final audit evaluates that same development split. Its 97.58% accuracy and 3.79% EER are valid descriptions of those predictions, but they are not untouched test-set estimates.

The loader also evaluates one deterministic **center crop** per file. Serving scans every three-second window with one-second stride. The Recorder's low first windows and high later windows demonstrate why these protocols can disagree.

Proposed amendment: preserve a separate speaker/device-disjoint test set; evaluate complete files with exactly the live windowing and aggregation; report both window and recording metrics, with thresholds fitted on calibration data only.

### P0: Final averaging changes the operating threshold

The 0.879358 high-risk threshold came from development-window scores, while 0.55 remains a heuristic caution boundary. Neither has been validated for the new arithmetic recording average.

The audited fake clip averages 0.8744, slightly below the high-risk boundary. Its mean therefore gives caution, despite high-risk sections. The peak and high-window fraction must remain visible. A whole-recording policy needs calibration on complete real recordings, fake recordings, and mixtures containing short fake regions. Overlapping windows are correlated, so their fraction is not the exact fraction of unique audio time that is fake.

A score is also not a calibrated probability. Weighted BCE and class-prior differences are additional reasons not to interpret the gauge literally as a fraud probability.

### P1: Browser resampling has no anti-alias filter

Training's resampler applies a 101-tap low-pass filter before downsampling. The browser's original file/microphone path performs linear interpolation without that filter. At 48 kHz to 16 kHz, its integer-ratio samples effectively discard two of every three input samples, allowing frequencies above 8 kHz to fold into the speech band.

The original phone worklet also rounds independently per 128-sample callback: at 48 kHz, 128 inputs become 43 outputs. Over one second this yields **16,125 samples instead of 16,000**, a +0.78125% sample-count error. At 44.1 kHz it yields 15,848.44 samples/s, about -0.947%. This affects timing and pitch and creates repeated boundary artifacts.

Proposed amendment: share a stateful, band-limited resampler across file, microphone and relay; carry fractional phase between callbacks; test tones above/below Nyquist, exact output lengths and chunk invariance. Replace the laptop's deprecated ScriptProcessor with the existing AudioWorklet approach. Assess the unchanged checkpoint again after this transport correction; it cannot by itself cure the measured gain failure.

### P1: Training drops the final incomplete accumulation group

Training uses batch size 1 and gradient accumulation 8. A complete epoch has 26,143 batches, leaving a remainder of seven. The optimizer steps at multiples of eight or a configured step limit, but not at ordinary end-of-loader. Those seven gradients are cleared at the next epoch without an update.

This affects only approximately 0.027% of each epoch and is not an explanation for a 90% genuine-voice score. It is still a correctness issue to fix before another run. The last group should use its actual size as the loss divisor and always trigger an optimizer step.

### P1: Phase B introduces more than just trainable top layers

Phase A correctly calls `model.encoder.eval()` after `model.train()`. Phase B calls `model.train()` on the entire encoder, including frozen lower layers. The saved encoder configuration has time masking probability 0.075, layer dropout 0.1 and hidden dropout 0.1. Thus Phase B both unfreezes parameters and re-enables stochastic encoder behavior. The external augmentation pipeline is also active.

This is a plausible contributor to instability, not a proven sole cause. PyTorch's [module documentation](https://docs.pytorch.org/docs/stable/generated/torch.nn.Module.html) distinguishes parameter freezing from evaluation mode.

Candidate experiment: freeze the feature extractor and lower layers in evaluation mode, optionally train only the last one or two transformer layers with controlled dropout, use warmup/decay and early stopping, and compare against a frozen-encoder candidate. Current Phase B did not improve EER; more unfreezing is not the first recommendation.

### P1: Checkpoint recovery can be made more reproducible

The current resume restores model and optimizer, but not GradScaler state, data-order RNG, Python/NumPy RNG, or CUDA RNG. It also overwrites experiment metadata on resume. Checkpoint writes are not atomic, and replacing `last` with `best` can leave no `last` file immediately after an improving epoch.

Proposed amendment: atomic temporary-file replacement, preserve both latest and best, save RNG/scaler and next-epoch indices, maintain an append-only run history. These are future-run reliability improvements; existing saved checkpoints loaded successfully.

### P2: Optional identity fusion is not validated speaker verification

The enrollment embedding comes from the spoof classifier's head. That head is optimized for real/fake discrimination, not speaker identity. Its cosine similarity is fused into risk with a fixed 80/20 heuristic. Enrollment and removal can also change the scoring basis during a stream.

Use a separately validated speaker-verification encoder and calibrated fusion if identity becomes a requirement. For detector validation, keep enrollment off or freeze its state per recording and report which scoring mode was used. This is not the cause of the reported tests, which had no enrollment.

### P2: Silence/quality metadata does not gate model decisions

The backend calculates signal state, RMS and peak, but still scores every complete window. Add tested speech-activity and insufficient-evidence behavior. Display abstention explicitly; do not silently turn poor audio into a low-risk decision. Keep the all-analyzed-window average clearly defined if a separate speech-only average is added.

### P2: The head and explanation have specific limits

The head is temporal self-attention with a local temporal convolution and attentive statistics pooling. It is AASIST-inspired; it is not a full canonical spectro-temporal AASIST reproduction. Temporal attention highlights influential regions, not proof of synthesis. Neither attention maps nor the Groq rewrite establish that a particular vocoder artifact exists.

A larger head or a different pretrained encoder is lower priority than correcting channels, sampling and validation. Benchmark a simple attentive-pooling head as an ablation before adding complexity.

## 4. Recommended experiment sequence

1. Keep the current champion checkpoint as the reference and verify input transport.
2. Build a window index from existing long recordings after speaker/source splitting; quantify actual usable speech.
3. Collect matched real and fake audio through the deployment microphones/recorders and codec paths. Include English, Tamil, Kannada and Odia with several speakers; do not tie one class to one device.
4. Hold back fresh speakers/recordings/devices for testing. Do not train on the same Recorder file that is being used to demonstrate the bug and then present its improved score as generalization.
5. Run a frozen-encoder pilot with source-balanced windows and versioned input normalization, comparing both normalized and unnormalized candidates.
6. Select by genuine false-positive rate and fake recall on target channels, alongside benchmark EER. Track worst-language/device behavior.
7. Try limited top-layer tuning only if the frozen-encoder candidate plateaus. Reduce aggressive combined augmentation if diagnostics show it erases useful speech cues.
8. Calibrate whole-recording scores and partial-fake alerts independently from window scores. Use a held-out calibration set and fit simple calibration first.
9. Promote a candidate only after it passes the same browser, file and relay tests plus the untouched test set. Retain a rollback path.

Channel and compression augmentation have research support, but require task-specific validation; see [Cohen et al., A Study On Data Augmentation In Voice Anti-Spoofing](https://arxiv.org/abs/2110.10491). This does not predict a numerical improvement for SvaraSentry.

## 5. Candidate success criteria

The following are proposed engineering targets, not achieved claims:

- repeated genuine English recordings stay below the agreed false-alarm boundary across microphones;
- fake recall does not materially regress when real false positives improve;
- reasonable gain perturbations do not turn the same genuine segment from almost zero to almost one;
- every full submitted window is accounted for before an explicit completed-session acknowledgement;
- new sessions do not retain prior scores;
- silence and broken/low-quality streams are distinguishable from low-risk speech;
- final-score calibration uses recording-level examples and tests short injected fake sections;
- report uncertainty/confidence intervals using independent recordings/speakers, not treating overlapping windows as independent trials.

## 6. Docker and final-score completion

The initial deployed update on 10 September rebuilt both production services and verified their health, the selected Phase A checkpoint, dependency consistency and LangChain-backed explanations.

Changes include:

- an ordered `audio_control/stop` marker and `audio_stopped` acknowledgement;
- server calculation of mean, peak, window count and high-risk fraction;
- separate completed versus interrupted summaries;
- stream IDs to prevent old summaries overwriting a new stream;
- dashboard source reset on a new recording;
- safe no-complete-window behavior and rejection of reset during active capture;
- phone stop integration and a request from the dashboard to stop the phone;
- a label distinguishing last-window explanations from the whole-recording average;
- health checks for both containers and more time for backend model startup;
- exclusion of certificates, diagnostics, data and secrets from the Docker build context;
- a portable `run_docker.ps1` that locates the user-installed Docker CLI.

Automated suite at this stage: **103 passed, 1 optional performance test skipped**. Frontend lint/type checking and the Docker production build passed. Runtime `pip check` found no broken dependencies.

Live Docker Recorder test: **18 windows, average 60.13%, peak 98.20%, 10/18 high-risk windows (55.56%), final caution**. Last live EMA was 90.21%, demonstrating the intended difference. The paired endpoint also completed a three-window test and returned the correct 2.18% average.

The browser snapshot visibly showed `FINAL AVERAGE RISK`, 60%, 18 windows, peak 98%, and 56% high-risk.

Use the following from the repository in PowerShell:

```powershell
.\run_docker.ps1          # start/check the current production images
.\run_docker.ps1 -Build   # rebuild and then start/check
```

Frontend: `http://127.0.0.1:3000/app`. Backend health: `http://127.0.0.1:8000/health`.

Two inactive development containers remain preserved. Compose may call them orphans because the production file contains only production services. No model, dataset, image cache, volume, or original recording was deleted.

## 7. Limits of this audit

The gain experiment proves sensitivity on the tested content. It does not by itself identify which encoder features carry the shortcut, prove every device fails, or establish how many new samples are sufficient. The first report's benchmark is dominated by English/ASVspoof, Indian-language fake counts are tiny, and C-DAC has no reliable speaker IDs. Robust deployment requires representative data and a new independent evaluation, not simply lower displayed scores.

## 8. Overnight candidate implementation and launch

The user approved an overnight experiment. A separate candidate started on **10 September 2026 at 01:15 IST**. This is an experiment, not a claimed accuracy improvement, and the existing production checkpoint remains deployed.

### Changes implemented

- The model now supports a checkpoint-owned `waveform_normalization` policy. The candidate uses zero-mean/unit-variance normalization inside the model, in both training and inference. Legacy checkpoints default to `none`, preserving their behavior. This is not a last-minute gain change applied to the existing champion.
- Training can use deterministic source/label-balanced sampling. Expected draw mass: ASV real 35%, ASV fake 35%, team real 7.5%, public real 7.5%, team fake 15%. Labels are already balanced by sampling, so extra class weighting is disabled for this option.
- Repeated draws from a long recording receive independent crop/augmentation seeds. First-epoch draws include **1,984 team-real crops**, compared with nine team-real file draws in the old setup. These are additional views of the same recordings, not new independent speakers or recordings.
- A bounded 256 MiB cache avoids repeatedly decoding long recordings. Source recordings remain untouched.
- The final incomplete accumulation group is now applied, using its actual group size. Non-finite loss causes a visible failure instead of silently continuing.
- Checkpoint writes are atomic. Latest and best checkpoints are retained separately, with optimizer, AMP scaler and random-generator state. Every epoch also has a separate inference checkpoint for later source-aware comparisons.
- The candidate's Phase B updates only the top two encoder layers, with lower learning rates and encoder stochastic masking/dropout disabled. Evaluation mode does not disable gradients for those trainable parameters.
- File upload, laptop microphone and phone relay now share a stateful anti-aliasing resampler. Chunk boundaries no longer reset interpolation phase or introduce sample-count drift. Both live routes use the audio worklet, which batches PCM and flushes its final partial frame before the server stop marker.

### Verification before launch

- Python regression suite: **107 passed, one optional performance test skipped**.
- Six JavaScript audio tests passed: exact output counts at four source rates; chunk-invariant waveforms; suppression of above-Nyquist aliasing; stereo/worklet framing and final-buffer flush.
- Frontend lint and TypeScript checks passed; production Docker frontend build passed.
- CUDA smoke run completed both phases (17 training steps each, 64 validation examples), followed by a successful same-phase resume test. These tiny validation results test the machinery, not real-world accuracy.
- All 51,180 manifest paths passed existence checks. Team speaker overlap between train and development was rejected by preflight; the current manifest passed.
- Both rebuilt production services became healthy. Backend health confirms the original Phase A epoch 3 checkpoint and the enabled Groq agent. Runtime dependency checks passed. The resampler module is served with a JavaScript MIME type.

### Run details and evaluation plan

| Item | Value |
| --- | --- |
| Output | `runs/xlsr-channel-candidate-20260910/` |
| Live log | `candidate.log` inside that folder |
| State | `training-status.json` inside that folder |
| Detached controller PID | 7120 |
| Training worker PID | 32608 |
| Charger guard PID | 28108 |
| Schedule | 3 Phase A epochs, then 2 Phase B epochs |
| Per-epoch training draws | 26,143 |
| Per-epoch development examples | 25,037, no subset limit |
| Latest launch verification | Phase A epoch 1 passed step 1,000, about 9.9 examples/second |
| Initial total estimate | 6–9 hours, approximately 07:15–10:15 IST; provisional |
| Automatic deployment | Disabled |

The controller then evaluates the champion and every candidate epoch on complete held-out target recordings, using three-second windows with a one-second stride. It saves window scores, recording averages, peaks and source/language breakdowns. Recordings shorter than three seconds are explicitly listed as skipped. The existing Recorder diagnostic remains outside training and is reported separately. A further gain audit is queued for the global-EER-winning candidate.

A candidate must be reviewed for target-real false positives, fake recall, recording-level behavior and ASV regression before promotion. Existing development data have already influenced model selection; these comparisons are not an independent test-set result. Fresh laptop/phone recordings from additional speakers remain necessary.

Training continues without this chat running. Windows idle-sleep prevention and the existing charger-disconnection alert are active. Keep the laptop plugged in, ventilated and the lid open. Neither mechanism can prevent a deliberate shutdown, a lid policy that forces sleep, or battery exhaustion. Recovery checkpoints are saved at epoch boundaries; an interrupted unfinished epoch may need to be repeated. There is no automatic checkpoint promotion or automatic post-shutdown restart.

### Errors encountered during this follow-up

1. The default pytest temporary/cache directories had Windows access-denied errors. Re-ran the full suite with a fresh isolated temporary directory and the cache provider disabled; tests passed. Existing files were not deleted to work around this.
2. Ruff found a mutable class constant annotation and import/timezone style issues in the new code. Corrected them; checks passed.
3. The Node worklet harness printed a module-type detection warning for the browser's ES-module `.js` file. All six tests passed; the browser loads it as an AudioWorklet module. This warning is not a runtime training failure.
4. No CUDA out-of-memory, non-finite-loss or checkpoint-resume failure occurred in the preflight trials or the first 1,000 full-run steps. This is current evidence, not a guarantee against later failures.

No original recording, dataset, champion checkpoint, Docker volume or image cache was deleted.

### Final rebuilt-service checks, approximately 01:21 IST

The actual browser uploaded the original 48 kHz stereo M4A Recorder file through the rebuilt frontend. It completed with **18 windows**, displayed **FINAL AVERAGE RISK 60%**, peak 98% and 56% high-risk windows. This confirms that the upload conversion, ordered completion and final-average UI work together; it also confirms that the champion's microphone-domain false alarm has not magically disappeared.

The rebuilt paired endpoint passed another five-second/three-window smoke test: scores 0.0047, 0.0432 and 0.0175; final average 0.0218; completion acknowledged; both deterministic and LangChain explanations observed. Results are in `runs/model-audit-2026-09-10/docker-rebuilt-relay.json`. This tests the pairing protocol, not a new physical-phone microphone recording.

The candidate subsequently passed step 2,600 at approximately 9.45 training examples/second. Training and its queued evaluation continue independently; results require review before any replacement of the current model.
