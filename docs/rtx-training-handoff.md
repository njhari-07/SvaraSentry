# RTX training handoff

This document records the work completed on the Mac and the exact point from
which to continue on the RTX 4060/CUDA machine.

## Repository state

- Repository: `https://github.com/njhari-07/SvaraSentry.git`
- Branch: `main`
- Start from the latest commit on `main`.
- The pipeline was verified in GitHub CI before this history was consolidated:
  Docker build, 43 tests, and Ruff lint all pass.

## Completed on the Mac

| Item | Status |
| --- | --- |
| Training-only waveform augmentation | Complete and tested. |
| Real noise and RIR augmentation assets | Installed locally from OpenSLR SLR28. |
| Asset validation | 935 noise files and 60,325 RIR files were decoded/validated. |
| Dataset | ASVspoof 2019 LA extracted and manifest built from official protocols. |
| Manifest | `data/dataset_manifest.csv`: 121,461 audio rows (25,380 train, 24,844 validation, 71,237 test). |
| Labels | 12,483 real and 108,978 fake examples. |
| Sample report | 32 real augmented samples generated locally in `runs/augmentation-samples.jsonl`. It includes noise, RIR, telephone/filter, resample, speed, gain, and saturation metadata. |
| Baseline config | `training/configs/baseline.yaml` disables stochastic augmentation. |
| Augmented config | `training/configs/augmentation.yaml` enables the conservative training policy. |

The asset provenance and license are documented in
[`augmentation-assets.md`](augmentation-assets.md). Codec augmentation is
intentionally deferred; do not enable it yet.

## Important: data is not in Git

The following paths are deliberately ignored by Git and must be copied to the
RTX machine separately:

```text
data/raw/asvspoof2019_la/
data/augmentation_assets/
```

Do **not** copy or download `LA.zip`; the extracted dataset above is sufficient.
Do **not** delete `data/augmentation_assets/`; it contains the noise and RIR
files required by the augmented experiment.

## Continue on the RTX machine

Using an external SSD is the simplest way to move the large files.

1. Install Git and Python on the RTX machine, then clone the repository:

   ```bash
   git clone https://github.com/njhari-07/SvaraSentry.git
   cd SvaraSentry
   ```

2. From the external SSD, copy the two ignored folders into the same relative
   paths in this clone:

   ```text
   data/raw/asvspoof2019_la/
   data/augmentation_assets/
   ```

3. Rebuild the manifest on the RTX machine. This is required because manifests
   contain absolute audio paths and the RTX machine uses a different path:

   ```bash
   python -m data_pipeline.build_asvspoof2019_la_manifest \
     --root data/raw/asvspoof2019_la/LA \
     --output data/dataset_manifest.csv
   ```

4. Confirm the NVIDIA driver and RTX GPU are available:

   ```bash
   nvidia-smi
   ```

   The output must list the RTX 4060. If it does not, stop here and install or
   update the NVIDIA driver before setting up Python dependencies.

5. Tell the project owner whether the RTX machine uses **Windows** or
   **Ubuntu/Linux**. The Python/PyTorch CUDA setup commands differ by operating
   system and CUDA driver version.

## GPU work still required

After the machine is confirmed and its Python environment is configured, run
the following in this order.

### 1. Loader benchmarks

Benchmark the real training manifest for 0, 2, 4, and 8 workers. Keep the
fastest stable setting that does not exhaust RAM or GPU memory.

```bash
for workers in 0 2 4 8; do
  python -m training.benchmark_loader \
    --manifest data/dataset_manifest.csv --split train \
    --workers "$workers" --batch-size 8 --batches 100 --device cuda
done
```

### 2. Controlled training experiments

Use the same seed, epochs, batch size, learning rate, and selected worker count
for both runs. Replace `WORKERS` below with the selected benchmark result.

```bash
python -m training.train \
  --manifest data/dataset_manifest.csv --output runs/baseline \
  --augmentation-config training/configs/baseline.yaml --workers WORKERS

python -m training.train \
  --manifest data/dataset_manifest.csv --output runs/augmented \
  --augmentation-config training/configs/augmentation.yaml --workers WORKERS
```

### 3. Results review

Compare the generated validation reports for both experiments:

- ROC-AUC
- PR-AUC
- EER
- false-positive rate at the selected threshold
- language, source, speaker, and fake-engine slices where present

The augmented model must not materially hurt clean-audio performance. The next
remaining enhancement after these runs is controlled clean/noise/RIR/telephone
robustness evaluation. Codec robustness stays deferred until a reproducible
ffmpeg-based workflow is approved and implemented.

## Helpful references

- [GPU experiment runbook](gpu-experiment-runbook.md)
- [Augmentation asset provenance](augmentation-assets.md)
- [Audio augmentation implementation handoff](audio-augmentation-handoff.md)
