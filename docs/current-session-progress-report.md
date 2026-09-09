# SvaraSentry Current Session Progress and Error Report

**Report date:** 8 September 2026  
**Repository:** `njhari-07/SvaraSentry`  
**Branch:** `main`  
**Pulled revision:** `3c434ea`  
**Workspace:** Windows, Docker Desktop, native Python 3.12 virtual environment, NVIDIA RTX 4060 Laptop GPU

## Executive summary

The Linux workspace has been reconstructed on Windows with the repository, audio assets, manifests, pretrained XLSR weights, native CUDA environment, and Docker development/production environments in place. The data pipeline now contains 51,180 valid manifest rows, excludes the underrepresented Hindi material without deleting its originals, and uses leakage-aware train/validation assignment.

The requested XLSR plus AASIST-style detection pipeline is implemented. Both training phases completed as bounded end-to-end pilot runs, and the Phase B pilot model was evaluated on all 25,037 validation clips. A detached full training run is now active: three complete Phase A epochs followed by five complete Phase B epochs, with full validation after every epoch. The pilot pipeline is operational, but its checkpoint is **not production-ready**: it is poorly calibrated at the default 0.5 threshold, and its full-validation EER is 38.24%. The active full run is intended to improve on that baseline.

## Full training currently running

The full run started at **8 September 2026, 21:45:52 IST** and is independent of the Codex task.

| Setting | Active value |
|---|---|
| Output directory | `runs/xlsr-full` |
| Detached PowerShell controller PID at launch | 23728 |
| Python CUDA worker PID at launch | 26676 |
| Phase A | 3 complete epochs, encoder frozen |
| Phase B | 5 complete epochs, top 4 encoder layers unfrozen |
| Training rows per epoch | 26,143 |
| Validation rows after every epoch | 25,037 |
| Batch size | 1 |
| Gradient accumulation | 8 |
| Step limit | None |
| Validation limit | None |
| Mixed precision | Enabled |
| Gradient checkpointing | Enabled for Phase B |
| Checkpoint objective | Lowest validation EER |

The controller uses the Windows execution-state API to prevent automatic system sleep while it is alive. Codex does not need to remain open, but Windows must remain powered on; a reboot, manual shutdown, forced sleep, or process termination will stop the run.

Live files:

- `runs/xlsr-full/training-status.json` records `running`, `complete`, or `failed`.
- `runs/xlsr-full/full-training.log` contains unbuffered training progress.
- `runs/xlsr-full/phase-a-best.pt` and `phase-b-best.pt` are created as phases complete.
- `runs/xlsr-full/model.pt` is the serving-format best checkpoint.

Launcher: `training/run_full_training.ps1`.

## Current dataset state

| Item | Current result |
|---|---:|
| Manifest rows | 51,180 |
| Train rows | 26,143 |
| Validation rows | 25,037 |
| Missing audio paths | 0 |
| Duplicate manifest rows | 0 |
| Unspecified splits | 0 |
| Team real recordings | 13 |
| Team fake recordings | 45 |
| CDAC Kannada | 300 clips / 40.75 minutes |
| CDAC Tamil | 300 clips / 38.67 minutes |
| Odia TTS | 300 clips / 34.89 minutes |
| ASVspoof 2019 LA train audio | 25,380 clips |
| ASVspoof 2019 LA development audio | 24,844 clips |
| Noise augmentation assets | 935 files |
| RIR augmentation assets | 60,325 files |

All public-corpus files are FLAC, 16 kHz, and mono. The two Hindi clips remain preserved on disk but are excluded from the manifest through `--exclude-language hi`.

### Split and leakage controls

- Team recordings are grouped by person. Aditi, Diya, Keerti, Praj, and Pranathi are assigned to train; Harish is wholly assigned to validation.
- No team speaker appears in both train and validation.
- CDAC Kannada and Tamil use deterministic seed-42 row-level 80/20 splits because these datasets do not expose speaker identifiers: 240 train and 60 validation clips for each language.
- Odia uses its retained source speaker identifiers: 67 speakers/240 clips in train and 17 speakers/60 clips in validation, with no speaker leakage.
- ASVspoof retains its official protocol-defined train/development splits.
- Language codes are normalized to `en`, `kn`, `or`, and `ta`.

## Repository and Windows migration work

- Cloned and synchronized the GitHub repository on Windows.
- Preserved local work while pulling the latest `main` changes.
- Resolved `.gitignore` and `.dockerignore` overlap by retaining the required rules from both sides.
- Kept the recovery stash rather than deleting it.
- Retained all original downloaded audio for later review; no originals were deleted.
- Corrected the Praj filename/folder identification so it appears as `praj_hindi_real` where applicable before Hindi exclusion.
- Added a reusable Hugging Face audio extractor for bounded, streaming dataset acquisition.
- Updated the Windows migration guide and the earlier Docker verification report.

## Docker environment

Four project images are intentional:

| Image | Purpose |
|---|---|
| `svarasentry-app:latest` | Backend development/runtime image |
| `svarasentry-frontend:latest` | Frontend development image |
| `svarasentry-app-prod:latest` | Lean production backend image |
| `svarasentry-frontend-prod:latest` | Built standalone production frontend image |

The running development stack exposes:

- Frontend: `http://localhost:3000`
- Backend and health endpoint: `http://localhost:8000`

Docker was hardened with Python 3.12, matched PyTorch/TorchAudio 2.11 CPU wheels, dependency checks during builds, longer package download timeouts/retries, source permission normalization, a dedicated frontend build, and exclusions that prevent datasets, virtual environments, checkpoints, pretrained weights, and training runs from entering Docker build context.

The Docker images are CPU-only by design. Model training was therefore run in the native Windows CUDA environment to use the RTX 4060 GPU.

## Model implementation completed

### `training/model.py`

- Local pretrained `wav2vec2-large-xlsr-53` encoder.
- Temporal convolution projection.
- Two AASIST-inspired graph-attention/message-passing blocks.
- Attentive mean and standard-deviation pooling.
- Binary real/fake classifier head.
- Encoder freeze support for Phase A.
- Selective top-layer unfreezing for Phase B.
- Optional gradient checkpointing.
- Serving-compatible `DetectorOutput` containing logits, embedding, and attention.

### `training/train.py`

- `--phase a`, `--phase b`, and `--phase all` execution modes.
- Phase A trains only the classifier/graph head with the encoder frozen.
- Phase B resumes Phase A, unfreezes the top encoder layers, and uses a lower learning rate.
- Automatic mixed precision, gradient accumulation, gradient clipping, checkpoint resume, and bounded pilot-run controls.
- Class-imbalance handling through weighted binary cross-entropy. For the current train manifest, the fake-class positive weight is approximately `0.144915` (3,309 real versus 22,834 fake).
- Safe, serving-oriented checkpoint format plus phase-specific resumable training checkpoints.

### `training/evaluate.py`

- Accuracy, precision, recall, F1, and confusion matrix.
- ROC-AUC, PR-AUC, EER, and EER-derived threshold.
- Metrics at both the default 0.5 threshold and the EER operating point.
- Breakdowns by source, language, and attack type.
- Machine-readable `evaluation.json` and row-level `predictions.csv` outputs.

### Integration updates

- `backend/model_inference.py` now reads graph-layer, graph-head, hidden-size, and dropout metadata from the new serving checkpoint.
- Augmentation assets are indexed by path and decoded lazily, preventing startup from scanning/decompressing over 60,000 files.
- Training integration and augmentation regression tests were updated for the new behavior.

## Training progress

These are deliberately bounded pilot runs intended to prove the complete training path and obtain the first real signal. They are not full-dataset epochs.

### Phase A: frozen encoder

Configuration:

- Batch size: 2
- Gradient accumulation: 4
- Maximum training batches: 500
- Validation subset: 512 clips
- Gradient checkpointing: disabled
- Trainable parameters: 1,566,468 of 317,005,188

Results:

| Metric | Result |
|---|---:|
| Mean training loss | 0.1884 |
| ROC-AUC | 0.5542 |
| PR-AUC | 0.8966 |
| EER | 46.50% |
| EER threshold | 0.577021 |

At threshold 0.5, the model classified all 512 validation examples as fake. Ranking was slightly better than chance, so Phase B was allowed to proceed.

### Phase B: top encoder layers unfrozen

Configuration:

- Resumed from `phase-a-best.pt`
- Batch size: 1
- Gradient accumulation: 8
- Maximum training batches: 300
- Validation subset: 512 clips
- Top encoder layers unfrozen: 4
- Gradient checkpointing: enabled
- Trainable parameters: 51,953,412 of 317,005,188

Results on the 512-clip validation subset:

| Metric | Result |
|---|---:|
| Mean training loss | 0.2145 |
| ROC-AUC | 0.6989 |
| PR-AUC | 0.9294 |
| EER | 34.84% |
| EER threshold | 0.488947 |

Ranking improved over Phase A, but the default threshold now classified every item as real. This is a calibration failure at 0.5, not a successful classifier operating point.

## Full Phase B validation results

The final Phase B checkpoint was evaluated on all 25,037 validation clips using CUDA, batch size 8, and two data-loader workers. Evaluation completed successfully at approximately 60 clips/second.

### Overall metrics

| Metric | Default threshold 0.5 | EER threshold 0.488954 |
|---|---:|---:|
| Accuracy | 10.90% | 61.76% |
| Precision | 0.00% | 92.96% |
| Recall | 0.00% | 61.76% |
| F1 | 0.00% | 74.21% |
| True negatives | 2,730 | 1,686 |
| False positives | 0 | 1,044 |
| False negatives | 22,307 | 8,530 |
| True positives | 0 | 13,777 |

Threshold-independent metrics:

- ROC-AUC: **0.6576**
- PR-AUC: **0.9293**
- EER: **38.24%**

The high PR-AUC is influenced by the validation set being heavily fake-dominant (22,307 fake versus 2,730 real), so it must not be read in isolation. ROC-AUC and EER show that substantial model improvement is still needed.

### Source/language observations

- ASVspoof (24,844 clips): ROC-AUC 0.6747, EER 37.13%.
- Kannada, Odia, and public Tamil validation subsets contain only real clips, so per-language ROC-AUC and EER are mathematically undefined for those slices.
- Tamil overall has 66 clips but only 5 fake clips; its ROC-AUC is 0.4066 and is not stable enough for a strong conclusion.
- Harish's 13 validation samples produce ROC-AUC 0.5 and EER 70.45%; this tiny slice is insufficient for reliable generalization claims.
- Attack-specific A01-A06 slices contain only fake samples, so individual attack EER/AUC values are also undefined. Their raw scores remain available in the predictions file for later cross-attack analysis.

## Errors encountered and resolutions

| Stage | Error/symptom | Root cause | Resolution/status |
|---|---|---|---|
| Git synchronization | Pull encountered `.gitignore`/`.dockerignore` conflicts | Local migration rules overlapped with upstream edits | Combined the required rules, completed the pull, and preserved the recovery stash |
| Python command reliability | Different Python installations/interpreters were being selected | Windows PATH and environment ambiguity | Standardized project commands on the repository `venv` Python 3.12 interpreter |
| Audio conversion | `ffmpeg` was not consistently available from the shell | Executable was not reliably present on PATH | Used the available bundled FFmpeg executable and verified outputs as 16 kHz mono FLAC |
| Hugging Face extraction | The expected `datasets` workflow was not initially usable as written | Missing/incompatible local dependency path and large-download risk | Added bounded streaming extraction and downloaded only the requested clips |
| Praj duration/name | Praj appeared to have about 16 minutes and fragmented naming | A filename/source association caused the wrong interpretation | Corrected the naming and regenerated/verified the manifest |
| Manifest verification | Ad-hoc checks depended on whichever Python was active | Interpreter mismatch made repeated checks unreliable | Put normalization, exclusions, and split assignment in `build_manifest.py`; added tests |
| Frontend lint/build | 23 lint findings and build-related issues | Existing component patterns and configuration drift | Corrected affected components/configuration; ESLint, TypeScript, and production build subsequently passed |
| Docker build reliability | Prior Linux dependency/download and permission failures could recur | Unmatched ML wheels, network timeouts, and bind-mount executable bits | Matched Torch/TorchAudio versions, added `pip check`, retries/timeouts, and scoped Ruff handling |
| First CUDA training smoke run | `_pickle.UnpicklingError` while reloading the checkpoint with `weights_only=True`; unsupported `pathlib.WindowsPath` | Raw `Path` objects from CLI arguments were stored inside the training checkpoint | Serialize all checkpoint arguments as primitive strings/numbers; added a regression test; rerun passed |
| First substantive Phase A launch | Training appeared hung before GPU work; GPU utilization stayed near 0% | Startup eagerly decoded/validated 60,325 RIR assets plus noise files | Changed augmentation indexing to path-only and validation to lazy decode-on-sample; launch became immediate |
| Phase A threshold behavior | All validation clips predicted fake at 0.5 | Pilot model scores were not calibrated | Recorded ranking/EER metrics and continued cautiously to Phase B |
| Phase B threshold behavior | All validation clips predicted real at 0.5 | Score distribution moved below the fixed threshold after partial fine-tuning | Evaluator now reports EER threshold and its operating metrics; proper calibration remains future work |
| Per-language/per-attack metrics | Some slice AUC/EER values are null | Several slices contain only one class | Kept null rather than inventing a metric; documented the dataset limitation |
| First detached full-training launch | Controller exited without creating a status file | `Start-Process` split the quoted workspace path containing spaces | Relaunched with one correctly quoted argument line and external launcher diagnostics; no training had started |
| Second detached full-training launch | PowerShell rejected conversion of `0x80000000` to `UInt32` | PowerShell treated the high-bit hexadecimal literal as a negative signed integer | Replaced it with explicit unsigned decimal `2147483648`; no training had started; third launch succeeded |

## Generated model and evaluation artifacts

| Artifact | Purpose |
|---|---|
| `runs/xlsr-aasist/phase-a-best.pt` | Resumable best Phase A training checkpoint |
| `runs/xlsr-aasist/phase-b-best.pt` | Resumable best Phase B training checkpoint |
| `runs/xlsr-aasist/model.pt` | Serving-format Phase B checkpoint |
| `runs/xlsr-aasist/phase-a-epoch-001.json` | Phase A epoch metrics |
| `runs/xlsr-aasist/phase-b-epoch-001.json` | Phase B epoch metrics |
| `runs/xlsr-aasist/evaluation-full/evaluation.json` | Complete validation metrics and breakdowns |
| `runs/xlsr-aasist/evaluation-full/predictions.csv` | Per-clip scores and predictions |

## Current verification state

| Check | Current state |
|---|---|
| Manifest integrity and path resolution | Passed |
| Speaker leakage checks | Passed |
| Audio format checks | Passed |
| Native CUDA XLSR forward pass | Passed |
| Phase A training and checkpoint resume | Passed |
| Phase B training and checkpoint resume | Passed |
| Full 25,037-clip evaluation | Passed |
| Docker development/production builds | Passed earlier in this session |
| Backend and frontend health checks | Passed earlier in this session |
| Frontend lint/type/build | Passed earlier in this session |
| Detached full Phase A + Phase B run | Running |
| Full test suite after final evaluation changes | Pending final rerun |
| Serving checkpoint load through backend | Pending final smoke rerun |

## Remaining work and honest limitations

1. Allow the active complete Phase A and Phase B schedule to finish; inspect its best-EER checkpoints and epoch reports.
2. Tune learning rates, unfreezing depth, augmentation probabilities, and class-balancing strategy using validation EER rather than raw accuracy if the full run remains weak.
3. Calibrate the serving threshold on a dedicated calibration set; do not deploy with 0.5 based on the pilot checkpoint.
4. Add balanced real/fake examples for each supported language. The current Kannada and Odia validation slices contain only real public-corpus examples.
5. Reserve an independent final test set. The current full report measures the same validation partition used for model selection.
6. Verify source dataset licensing/usage terms before redistribution or production use.
7. Run the final test-suite and backend-serving smoke checks after this report snapshot.
8. Review and commit the current uncommitted changes only after approval; nothing has been pushed from this workspace.

## Conclusion

The Windows migration, Docker environment, data preparation, manifest construction, model implementation, two-phase CUDA training path, and full evaluation path are all functioning. The complete multi-epoch run is now underway outside Codex. The most important remaining problem is model quality and calibration, not pipeline wiring. The completed pilot Phase B checkpoint is a valid baseline, but its 38.24% EER and collapsed 0.5-threshold predictions make that pilot unsuitable for production deployment in its present form.
