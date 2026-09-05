# RTX experiment runbook

Run these commands from the repository root on the RTX/CUDA machine. Keep the
raw ASVspoof data and SLR28 assets local to that machine; they are intentionally
ignored by Git and must not be pushed.

## 1. Copy the local experiment data

Copy `data/raw/asvspoof2019_la/`, `data/augmentation_assets/`, and
`data/dataset_manifest.csv` to the same paths under the clone on the CUDA
machine. If the destination path differs, rebuild the manifest there so its
absolute audio paths are correct:

```bash
python -m data_pipeline.build_asvspoof2019_la_manifest \
  --root data/raw/asvspoof2019_la/LA \
  --output data/dataset_manifest.csv
```

## 2. Verify CUDA and benchmark loader workers

```bash
python -c "import torch; print(torch.cuda.is_available(), torch.cuda.get_device_name(0))"

for workers in 0 2 4 8; do
  python -m training.benchmark_loader \
    --manifest data/dataset_manifest.csv --split train \
    --workers "$workers" --batch-size 8 --batches 100 --device cuda
done
```

Select the fastest stable worker count that does not exhaust GPU or host RAM.

## 3. Run the controlled experiments

Use the same seed, epochs, batch size, learning rate, and selected worker count
in both runs. Replace `WORKERS` with the chosen value.

```bash
python -m training.train \
  --manifest data/dataset_manifest.csv --output runs/baseline \
  --augmentation-config training/configs/baseline.yaml --workers WORKERS

python -m training.train \
  --manifest data/dataset_manifest.csv --output runs/augmented \
  --augmentation-config training/configs/augmentation.yaml --workers WORKERS
```

Each run writes validation ROC-AUC, PR-AUC, EER, false-positive rate, and
available language/source/speaker/fake-engine slices to `runs/<experiment>/`.
Run clean/noise/RIR/telephone/Opus robustness evaluations after a checkpoint is
selected. Codec augmentation uses a controlled in-memory FFmpeg round-trip and
records the bitrate and tool version in transform metadata.
