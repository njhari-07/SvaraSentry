# SvaraSentry Full Training Report

**Report date:** 9 September 2026  
**Repository:** `njhari-07/SvaraSentry`  
**Training output:** `runs/xlsr-full`  
**Training objective:** Binary classification of bona fide (`real`, label 0) versus synthetic/cloned (`fake`, label 1) speech  
**Final status:** Completed successfully with exit code 0

## Executive summary

The complete SvaraSentry training schedule finished successfully. It ran three frozen-encoder Phase A epochs followed by five Phase B epochs with the top four XLSR encoder layers unfrozen. Every epoch used the complete 26,143-row training split and was evaluated on all 25,037 validation rows.

The best checkpoint is **Phase A epoch 3**, selected by the predefined lowest equal error rate (EER) criterion. A separate post-training evaluation of that checkpoint produced:

| Metric | Result |
|---|---:|
| Accuracy at threshold 0.5 | 97.58% |
| Precision | 99.22% |
| Recall | 98.05% |
| F1 | 98.63% |
| ROC-AUC | 0.9736 |
| PR-AUC | 0.9916 |
| EER | **3.79%** |
| EER operating threshold | 0.87851 |

Phase B did not improve the chosen EER objective. Its best epoch was Phase B epoch 1 at 5.61% EER; subsequent Phase B results ranged from 6.05% to 7.22% EER. This indicates that, under the current learning rates and data distribution, unfreezing the top XLSR layers reduced rather than improved validation performance.

The result is promising, but it is a validation result—not a final independent-test claim. Before deployment, the Phase A checkpoint must be packaged as the serving model, tested through the backend, calibrated for the intended error costs, and evaluated on a genuinely untouched test set.

## What was trained

### Input representation

Each source recording is converted into the same model-ready representation:

- 16,000 samples per second
- one audio channel (mono)
- 48,000 samples, equivalent to 3 seconds
- longer audio is cropped
- shorter audio is padded

This fixed input shape makes batching and inference predictable while preserving enough speech to expose voice-cloning artifacts.

### Model architecture

The detector contains:

1. A locally stored `wav2vec2-large-xlsr-53` speech encoder.
2. A temporal convolution projection into a 256-dimensional hidden representation.
3. Two AASIST-inspired temporal graph message-passing/attention blocks with four attention heads.
4. Attentive mean and standard-deviation pooling.
5. A binary classifier that produces a real/fake logit.

| Architecture setting | Value |
|---|---:|
| Total parameters | 317,005,188 |
| Hidden size | 256 |
| Graph blocks | 2 |
| Graph attention heads | 4 |
| Dropout | 0.15 |
| Local pretrained encoder | `training/pretrained/wav2vec2-large-xlsr-53` |

The classifier interprets higher scores as stronger evidence of fake or cloned speech.

## Data used

### Training and validation distribution

| Split | Real | Fake | Total |
|---|---:|---:|---:|
| Train | 3,309 | 22,834 | 26,143 |
| Validation | 2,730 | 22,307 | 25,037 |

The data is strongly fake-dominant. Training therefore used weighted binary cross-entropy with a fake-class positive weight of `0.144915`. In plain language, errors on the smaller real class were given more relative importance so the model could not obtain an apparently good result by predicting everything as fake.

### Split safety

- ASVspoof uses its official train/development protocol splits.
- Team recordings are split by whole speaker, preventing the same known speaker from appearing in both train and validation.
- Kannada and Tamil public datasets use deterministic seed-42 row-level splits because their source rows do not expose speaker IDs.
- Odia uses retained source speaker IDs and has no speaker overlap between splits.
- Hindi was excluded because only two clips were available; the originals remain preserved.

### Important data limitation

The validation set is dominated by ASVspoof English audio. Kannada and Odia validation subsets contain only real public-corpus clips, while individual ASVspoof attack subsets contain only fake clips. Consequently, some per-language and per-attack AUC/EER values are mathematically undefined. This is a dataset-composition limitation rather than an evaluator failure.

## Augmentation pipeline

Augmentation was enabled only for training. Validation remained deterministic and unaugmented.

Every training example was first normalized to 16 kHz mono and a 3-second window. It then had a 20% chance of remaining unchanged. Otherwise, the pipeline independently sampled effects and applied no more than three to a single example.

| Transformation | Probability | Purpose |
|---|---:|---|
| Gain | 45% | Simulates quieter or louder recordings (`-8` to `+6` dB) |
| Background noise | 45% | Simulates environmental noise at 8–35 dB SNR |
| Room impulse response | 25% | Simulates reverberant rooms and microphone distance |
| Resampling | 25% | Simulates conversion through 8, 12, 22.05, or 24 kHz |
| Filtering/telephone response | 25% | Simulates restricted microphones and call channels |
| Speed/pitch perturbation | 20% | Applies a small 0.95–1.05 speed/pitch variation |
| Opus compression | 20% | Simulates VoIP at 12, 16, or 24 kbps |
| Saturation | 10% | Simulates clipped or overloaded microphone audio |

The random choices are reproducible from seed 42 and change deterministically between epochs. The goal is to make the detector learn synthetic-speech characteristics that survive ordinary channel, room, codec, and volume changes instead of learning recording-condition shortcuts.

## Optimization configuration

| Setting | Value |
|---|---:|
| Phase A epochs | 3 |
| Phase B epochs | 5 |
| Batch size | 1 |
| Gradient accumulation | 8 |
| Effective optimizer batch | 8 samples |
| Phase A head learning rate | `3e-4` |
| Phase B head learning rate | `5e-5` |
| Phase B encoder learning rate | `5e-6` |
| Weight decay | `0.01` |
| Gradient clipping | `1.0` |
| Mixed precision | Enabled |
| Phase B gradient checkpointing | Enabled |
| Data-loader workers | 0 |
| Training step cap | None |
| Validation sample cap | None |
| Random seed | 42 |

Using batch size 1 was deliberate for the 8 GB RTX 4060 Laptop GPU. Gradient accumulation provided an effective batch of eight without risking an out-of-memory failure. Zero background data-loader workers was the most reliable Windows configuration for the CPU-heavy audio augmentation pipeline.

## Two-phase training strategy

### Phase A: frozen XLSR encoder

Phase A froze the full pretrained speech encoder and trained only the temporal graph/classifier head.

| Parameter count | Value |
|---|---:|
| Trainable | 1,566,468 |
| Total | 317,005,188 |

Freezing the encoder reduces GPU memory, speeds training, and protects pretrained speech representations while the new classifier learns the task.

### Phase B: partial XLSR fine-tuning

Phase B restored the best Phase A checkpoint, unfroze the top four XLSR layers, and trained them with a much smaller encoder learning rate.

| Parameter count | Value |
|---|---:|
| Trainable | 51,953,412 |
| Total | 317,005,188 |

Phase B required more computation because gradients, optimizer states, and activations had to be retained for the unfrozen encoder layers. Gradient checkpointing reduced VRAM use by recomputing some activations during backward passes.

## Complete per-epoch results

All metrics below were measured on the same 25,037-row validation split. Accuracy, precision, recall, and F1 use threshold 0.5. Checkpoint selection used EER.

| Phase | Epoch | Train loss | Accuracy | Precision | Recall | F1 | ROC-AUC | PR-AUC | EER | EER threshold |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| A | 1 | 0.1654 | 84.73% | 99.12% | 83.61% | 90.70% | 0.9512 | 0.9937 | 12.01% | 0.38137 |
| A | 2 | 0.0954 | 93.27% | 99.65% | 92.77% | 96.09% | **0.9913** | **0.9989** | 4.68% | 0.30935 |
| A | 3 | **0.0741** | **97.58%** | 99.22% | **98.05%** | **98.63%** | 0.9736 | 0.9916 | **3.85%** | 0.87936 |
| B | 1 | 0.2031 | 81.42% | 99.82% | 79.29% | 88.38% | 0.9803 | 0.9970 | 5.61% | 0.14563 |
| B | 2 | 0.1739 | 88.09% | 99.78% | 86.83% | 92.85% | 0.9796 | 0.9970 | 6.40% | 0.19078 |
| B | 3 | 0.1630 | 88.84% | 99.81% | 87.65% | 93.33% | 0.9846 | 0.9980 | 6.05% | 0.26297 |
| B | 4 | 0.1582 | 92.95% | 99.31% | 92.74% | 95.91% | 0.9845 | 0.9980 | 6.41% | 0.45345 |
| B | 5 | 0.1578 | 80.96% | 99.94% | 78.68% | 88.05% | 0.9831 | 0.9979 | 7.22% | 0.10322 |

### Interpretation

- Phase A improved consistently on the chosen EER objective: 12.01% → 4.68% → 3.85%.
- Phase A epoch 2 produced the highest ROC-AUC, while epoch 3 produced the lowest EER and best threshold-0.5 accuracy/F1.
- Because EER was the declared selection objective, Phase A epoch 3 is the winner.
- Phase B retained strong ranking AUC but produced worse EER than Phase A epoch 3.
- The moving EER thresholds in Phase B show that its score distribution was not stable across epochs.
- Phase B epoch 5's very high precision and lower recall mean it became overly conservative about predicting fake at threshold 0.5.

This pattern is consistent with partial fine-tuning causing calibration drift and possible overfitting or forgetting of useful pretrained representations. It does not mean Phase B failed to learn; it means Phase B did not improve the metric used to select the deployable detector.

## Winning checkpoint: detailed post-training evaluation

The selected `phase-a-best.pt` checkpoint was reloaded and evaluated with `training.evaluate` using CUDA, batch size 8, and two data-loader workers. All 25,037 validation rows completed successfully at approximately 52 clips per second.

The detailed evaluator produced an EER of 3.7876%, compared with 3.8462% during training. The small difference is attributable to floating-point/batching effects: training validation used batch size 1, while the post-training pass used batch size 8. The post-training figure is used below as the final audited result.

### Threshold 0.5

| Metric | Result |
|---|---:|
| Accuracy | 97.5756% |
| Precision | 99.2197% |
| Recall | 98.0499% |
| F1 | 98.6314% |
| ROC-AUC | 0.973645 |
| PR-AUC | 0.991586 |
| True negatives (real predicted real) | 2,558 |
| False positives (real predicted fake) | 172 |
| False negatives (fake predicted real) | 435 |
| True positives (fake predicted fake) | 21,872 |

### EER operating point

At threshold `0.8785106`:

| Metric | Result |
|---|---:|
| EER | **3.7876%** |
| Accuracy | 96.2296% |
| Precision | 99.5179% |
| Recall | 96.2344% |
| F1 | 97.8486% |
| True negatives | 2,626 |
| False positives | 104 |
| False negatives | 840 |
| True positives | 21,467 |

The EER threshold deliberately balances false-positive and false-negative rates. It does not necessarily maximize raw accuracy on this highly imbalanced validation set. Production threshold choice should reflect the real cost of falsely accusing real audio versus missing cloned audio.

## Breakdown by source

| Source | Examples | Accuracy at 0.5 | ROC-AUC | EER | Notes |
|---|---:|---:|---:|---:|---|
| ASVspoof 2019 LA | 24,844 | 97.64% | 0.9753 | 3.51% | Dominates the validation set |
| CDAC Kannada | 60 | 95.00% | N/A | N/A | Real-only; 3 false positives |
| CDAC Tamil | 60 | 100.00% | N/A | N/A | Real-only; 0 false positives |
| Harish/team validation | 13 | 69.23% | 0.9545 | 4.55% | Only 13 examples; 4 fake false negatives at 0.5 |
| Odia TTS | 60 | 76.67% | N/A | N/A | Real-only; 14 false positives |

The lower Odia real-only accuracy is a material warning: the model is more likely to flag this clean TTS-oriented real corpus as fake. More matched real and fake Odia data is needed before claiming reliable Odia support.

The 13-example Harish slice is too small for a stable performance claim. Its slice-specific EER threshold is approximately `0.0503`, which is dramatically different from the global threshold and demonstrates source-dependent calibration.

## Breakdown by language

| Language | Examples | Accuracy at 0.5 | ROC-AUC | EER | Composition |
|---|---:|---:|---:|---:|---|
| English (`en`) | 24,851 | 97.64% | 0.9753 | 3.51% | Both classes; mostly ASVspoof |
| Kannada (`kn`) | 60 | 95.00% | N/A | N/A | Real-only |
| Odia (`or`) | 60 | 76.67% | N/A | N/A | Real-only |
| Tamil (`ta`) | 66 | 93.94% | 0.8623 | 19.02% | Only 5 fake examples |

Tamil's apparent 93.94% accuracy hides weak fake recall: only 1 of 5 Tamil fake clips was detected at threshold 0.5. The 19.02% EER is based on a very small fake sample and must not be generalized. Kannada and Odia have no fake validation rows, so genuine language-specific discrimination cannot yet be measured.

## Breakdown by ASVspoof attack

Each A01–A06 slice contains only fake audio, so the accuracy below is effectively fake recall. AUC and EER cannot be calculated within a single-class slice.

| Attack | Fake clips | Detected at threshold 0.5 | Missed |
|---|---:|---:|---:|
| A01 | 3,716 | 99.84% | 6 |
| A02 | 3,716 | 99.81% | 7 |
| A03 | 3,716 | 99.84% | 6 |
| A04 | 3,716 | 97.36% | 98 |
| A05 | 3,716 | 99.97% | 1 |
| A06 | 3,716 | 91.58% | 313 |

A06 is the most difficult represented ASVspoof attack for this checkpoint and accounts for most attack-specific false negatives. Future training or sampling should emphasize A06-like attacks without overfitting to their corpus artifacts.

Rows with an `unknown` attack type total 193 examples and mix both classes. They achieved 89.12% accuracy, ROC-AUC 0.8452, and 18.16% EER, substantially worse than the main ASVspoof slice. This again shows weaker transfer outside the dominant benchmark distribution.

## Runtime timeline

| Time (IST) | Event |
|---|---|
| 8 Sep, 21:45:52 | Original full run started |
| 8 Sep, 22:46:24 | Phase A epoch 1 completed |
| 8 Sep, 23:29:26 | Phase A epoch 2 completed |
| 9 Sep, 00:24:00 | Phase A epoch 3 completed; overall winning checkpoint saved |
| 9 Sep, 02:25:17 | Phase B epoch 1 completed; Phase B best saved |
| 9 Sep, 04:19:40 | Phase B epoch 2 completed |
| 9 Sep, 06:23:49 | Phase B epoch 3 completed; recoverable last checkpoint saved |
| 9 Sep, 06:40:56 | Windows logged `Critical Battery Trigger Met` |
| 9 Sep, 06:41:04 | Windows powered off through a clean kernel API shutdown |
| 9 Sep, 07:37:22 | Phase B resumed from epoch 3 with model and optimizer state restored |
| 9 Sep, 08:55:41 | AC disconnected again at 79%; power guard detected it |
| 9 Sep, 09:13:19 | AC restored at 56%; training remained active |
| 9 Sep, 09:27:49 | Phase B epoch 4 completed |
| 9 Sep, 10:57:42 | Phase B epoch 5 completed |
| 9 Sep, 10:57:44 | Detached controller recorded `complete`, exit code 0 |

Total wall-clock duration from initial start to final completion was approximately 13 hours 12 minutes, including about 56 minutes of shutdown/restart downtime and the repeated partial epoch-4 work.

## Interruption, root cause, and recovery

### Confirmed root cause

Windows Event Viewer and the generated battery report establish the sequence:

- AC was disconnected at 06:23:51 with 25% battery.
- Battery fell to 3% at 06:40:34 under training load.
- Kernel-Power event 524 recorded `Critical Battery Trigger Met` at 06:40:56.
- `winlogon.exe`, acting as `NT AUTHORITY\\SYSTEM`, initiated a clean power-off.

There was no CUDA error, out-of-memory error, NaN, disk failure, Python exception, or Windows Update event. The operating system shut down to protect against complete battery exhaustion.

### What was preserved

- All three Phase A reports and the Phase A best checkpoint.
- Phase B epoch 1–3 reports.
- Phase B epoch-3 model weights.
- Both Phase B AdamW optimizer parameter groups and their state.
- The complete training log up to shutdown.
- All datasets and augmentation assets.

Only the first 3,900 steps of the interrupted Phase B epoch 4 were lost. Epoch 4 restarted from its beginning, so no samples were omitted from the final completed schedule; only computation time was repeated.

### Resume hardening

The trainer was updated so same-phase resume now:

- restores model weights;
- restores optimizer state;
- resumes at the next incomplete epoch number;
- reads earlier epoch reports so best-EER history is preserved;
- refuses nonsensical resume requests where the requested final epoch is already complete.

The resume code passed Ruff and all four targeted training integration tests before relaunch.

### Power guard

A separate power guard monitored AC state every 15 seconds. It detected the second disconnection at 08:55:41 and logged repeated warnings until AC returned at 09:13:19. The machine did not reach critical battery during this event.

The optional Windows `msg.exe` popup was unavailable on this Windows installation, so popup attempts were logged as non-training errors. The guard's AC detection, log, and audible beep path continued to function. This did not affect model training.

## Errors and operational incidents

| Incident | Effect on training | Resolution |
|---|---|---|
| First launcher argument quoting failed because the workspace path contains spaces | Training did not start | Relaunched with one correctly quoted argument line |
| Power-state constant `0x80000000` was interpreted as signed by PowerShell | Training did not start | Used explicit unsigned decimal `2147483648` |
| Critical battery shutdown | Interrupted Phase B epoch 4 at step 3,900 | Verified epoch-3 checkpoint; restored model and optimizer; restarted epoch 4 |
| Second AC disconnection | No interruption; battery fell from 79% to 56% | Power guard alerted/logged; AC restored before shutdown |
| `msg.exe` unavailable | Only the optional visual guard popup failed | Logging and audible alert continued; training unaffected |

No actual training step produced a traceback, CUDA out-of-memory event, non-finite loss, corrupted checkpoint, or failed validation pass.

## Checkpoint selection and deployment warning

### Correct model to select

**Overall winner:** `runs/xlsr-full/phase-a-best.pt`  
**Selected phase/epoch:** Phase A epoch 3  
**Selection reason:** lowest validation EER across all eight epochs

### Other checkpoints

| Artifact | Meaning | Approximate size |
|---|---|---:|
| `phase-a-best.pt` | Overall winner, resumable training format | 1.19 GiB |
| `phase-b-best.pt` | Best within Phase B, epoch 1 | 1.57 GiB |
| `phase-b-last.pt` | Final Phase B epoch 5 state | 1.57 GiB |
| `model.pt` | Existing serving package from Phase B epoch 1 | 1.18 GiB |

**Do not deploy the current `runs/xlsr-full/model.pt` as the overall winner.** It contains the Phase B best model because the training loop updated the serving package within each phase. The actual overall winner is the Phase A checkpoint and must be repackaged into serving format before backend deployment.

## Metric definitions in plain language

- **Accuracy:** fraction of all clips classified correctly. It can be misleading on imbalanced data.
- **Precision:** among clips called fake, how many were actually fake.
- **Recall:** among all fake clips, how many the model detected.
- **F1:** balance between fake precision and fake recall.
- **ROC-AUC:** how well the raw score ranks fake above real across all possible thresholds.
- **PR-AUC:** precision/recall ranking quality; strongly influenced by class prevalence.
- **EER:** operating point where the false-accept and false-reject rates are approximately equal. Lower is better.
- **Threshold:** probability/score boundary used to convert the model's continuous score into a real/fake decision.

## Artifacts and audit trail

### Training

- `runs/xlsr-full/full-training.log`
- `runs/xlsr-full/training-status.json`
- `runs/xlsr-full/experiment.json`
- `runs/xlsr-full/phase-a-epoch-001.json` through `phase-a-epoch-003.json`
- `runs/xlsr-full/phase-b-epoch-001.json` through `phase-b-epoch-005.json`
- `runs/xlsr-full/phase-a-best.pt`
- `runs/xlsr-full/phase-b-best.pt`
- `runs/xlsr-full/phase-b-last.pt`
- `runs/xlsr-full/model.pt`

### Detailed winning-model evaluation

- `runs/xlsr-full/evaluation-phase-a-best/evaluation.json`
- `runs/xlsr-full/evaluation-phase-a-best/predictions.csv`

### Power and recovery evidence

- `runs/xlsr-full/battery-report.html`
- `runs/xlsr-full/power-guard.log`
- `runs/xlsr-full/resume-launcher-stderr.log`

The raw predictions CSV contains one row per evaluated clip and allows every aggregate result to be independently recalculated.

## Limitations

1. The winning score was measured on the validation split used for epoch selection, not on a never-seen final test set.
2. ASVspoof English data dominates validation, so the overall result primarily measures performance on that benchmark.
3. Public Kannada and Odia validation rows contain only real audio, preventing language-specific EER measurement.
4. Tamil contains only five fake validation examples; its result is too small for a dependable claim.
5. The team validation source contains only 13 examples.
6. Source and recording-condition differences may allow the model to learn corpus shortcuts rather than only synthesis artifacts.
7. Attack slices A01–A06 are fake-only, so their reported accuracy is recall and not full binary accuracy.
8. Thresholds differ substantially by source and language, showing that calibration is not yet universal.
9. Dataset licenses and redistribution constraints must be verified before public or commercial deployment.

## Recommended next steps

1. Repackage `phase-a-best.pt` into a serving-format checkpoint and record its architecture plus the selected calibration threshold.
2. Run a backend loading/inference smoke test against known real and fake files.
3. Run the complete Ruff and Pytest suites after final packaging.
4. Evaluate on an untouched, source-balanced test set containing both real and fake audio for English, Kannada, Odia, and Tamil.
5. Choose the deployment threshold from application costs. Use `0.87851` only as the current validation EER candidate, not as an unquestioned production constant.
6. Add substantially more fake Kannada, Odia, and Tamil examples and matched real recording conditions.
7. Investigate A06 and `unknown` attack failures using the saved predictions CSV.
8. Consider keeping XLSR frozen for the first deployment candidate; Phase B did not improve EER in this experiment.
9. Add early stopping and cross-phase serving-checkpoint selection so future runs automatically package the overall best epoch.

## Final conclusion

The end-to-end training system is functional and recoverable: audio loading, augmentation, weighted loss, frozen-head training, partial encoder fine-tuning, full validation, checkpointing, resume, and detailed evaluation all completed. The strongest current detector is the Phase A epoch-3 checkpoint with a post-training validation EER of 3.79%.

The correct engineering conclusion is not that SvaraSentry is finished, but that it now has a strong benchmark candidate and a reproducible evidence trail. The next milestone is to package the actual winner, validate it through the application, and test it on genuinely unseen, language-balanced real-world audio before making production claims.
