"""Detached, logged overnight candidate experiment. Never deploys its weights."""

import argparse
import ctypes
import hashlib
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path


def digest(path):
    with path.open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("runs/xlsr-channel-candidate-20260910"))
    parser.add_argument("--resume", type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    os.chdir(root)
    output = args.output.resolve()
    if output.exists() and not args.resume:
        raise FileExistsError("candidate output already exists; use --resume or a new directory")
    output.mkdir(parents=True, exist_ok=True)
    champion = root / "training/checkpoints/model.pt"
    if shutil.disk_usage(root).free < 20 * 1024 ** 3:
        raise RuntimeError("At least 20 GiB free disk is required for retained candidate checkpoints")
    state = {"state": "preflight", "controller_pid": os.getpid(), "started_at": datetime.now().astimezone().isoformat(),
             "output": str(output), "log": str(output / "candidate.log"), "auto_deploy": False,
             "schedule": "3 Phase A epochs + 2 Phase B epochs; full 25,037-example dev after each epoch"}

    def status(**updates):
        state.update(updates, updated_at=datetime.now().astimezone().isoformat())
        temporary = output / "training-status.json.tmp"
        temporary.write_text(json.dumps(state, indent=2), encoding="utf-8")
        temporary.replace(output / "training-status.json")

    protected = False
    try:
        import torch

        from training.audio_dataset import AudioDataset
        from training.augmentations import load_augmentation_config

        if not torch.cuda.is_available():
            raise RuntimeError("CUDA is required for this overnight experiment")
        config = load_augmentation_config(root / "training/configs/augmentation.yaml", project_root=root)
        train = AudioDataset(root / "data/manifests/dataset_manifest.csv", "train", config)
        dev = AudioDataset(root / "data/manifests/dataset_manifest.csv", "validation", config)
        missing = [str(r.path) for r in [*train.records, *dev.records] if not r.path.is_file()]
        if missing:
            raise FileNotFoundError(f"Missing {len(missing)} audio files; first: {missing[0]}")
        def team_speakers(dataset):
            return {r.metadata.get("speaker") for r in dataset.records
                    if any(name in str(r.path) for name in ("team_recordings", "sarvam_cloned"))}
        if team_speakers(train) & team_speakers(dev):
            raise ValueError("team speaker leakage between training and development")
        provenance = {"champion_sha256": digest(champion), "manifest_sha256": digest(root / "data/manifests/dataset_manifest.csv"),
                      "train_files": len(train), "dev_files": len(dev), "cuda": torch.cuda.get_device_name(0),
                      "code_sha256": {str(p.relative_to(root)): digest(p) for p in (root / "training").glob("*.py")},
                      "augmentation_sha256": digest(root / "training/configs/augmentation.yaml")}
        (output / f"provenance-{datetime.now().astimezone():%Y%m%d-%H%M%S}.json").write_text(json.dumps(provenance, indent=2), encoding="utf-8")
        del train, dev
        if os.name == "nt":
            protected = bool(ctypes.windll.kernel32.SetThreadExecutionState(0x80000001))
            if not protected:
                raise RuntimeError("Windows sleep-prevention request failed")
        phase = "all"
        weights = ["--warm-start", str(champion)]
        if args.resume:
            payload = torch.load(args.resume, map_location="cpu", weights_only=True, mmap=True)
            phase = "b" if payload.get("phase") == "b" else "all"
            del payload
            weights = ["--resume", str(args.resume)]
        command = [sys.executable, "-u", "-m", "training.train", "--manifest", "data/manifests/dataset_manifest.csv",
                   "--output", str(output), "--phase", phase, "--phase-a-epochs", "3", "--phase-b-epochs", "2",
                   *weights, "--waveform-normalization", "zero_mean_unit_variance", "--sampling", "channel-balanced",
                   "--cache-megabytes", "256", "--encoder-eval-during-finetune", "--unfreeze-layers", "2",
                   "--head-learning-rate", "0.0001", "--phase-b-head-learning-rate", "0.00002",
                   "--encoder-learning-rate", "0.000001", "--log-every", "100", "--device", "cuda"]
        with (output / "candidate.log").open("a", encoding="utf-8", buffering=1) as log:
            def run(command, stage):
                log.write(f"\n[{datetime.now().astimezone().isoformat()}] {stage}\n")
                log.flush()
                worker = subprocess.Popen(command, cwd=root, stdout=log, stderr=subprocess.STDOUT)
                status(state="running", stage=stage, worker_pid=worker.pid, sleep_prevention=protected)
                code = worker.wait()
                if code:
                    raise RuntimeError(f"{stage} exited with code {code}; see candidate.log")
            run(command, "training")
            # Compare every epoch on complete target recordings; do not blindly promote global-EER winner.
            checkpoints = [champion, *sorted(output.glob("phase-*-epoch-*-model.pt"))]
            for checkpoint in checkpoints:
                name = "champion" if checkpoint == champion else checkpoint.stem
                run([sys.executable, "-u", "-m", "training.evaluate_streaming", "--checkpoint", str(checkpoint),
                     "--output", str(output / f"{name}-streaming.json")], f"streaming-evaluation:{name}")
            run([sys.executable, "-u", "-m", "training.audit_robustness", "--checkpoint", str(output / "model.pt"),
                 "--output", str(output / "candidate-robustness.json")], "gain-robustness-audit")
        if digest(champion) != provenance["champion_sha256"]:
            raise RuntimeError("deployed checkpoint changed externally during experiment; review before comparison")
        status(state="complete", stage="awaiting-human-review", worker_pid=None,
               note="Candidate trained and evaluated; current deployment unchanged. No automatic promotion.")
    except Exception as error:
        status(state="failed", error=str(error))
        raise
    finally:
        if protected:
            ctypes.windll.kernel32.SetThreadExecutionState(0x80000000)


if __name__ == "__main__":
    main()
