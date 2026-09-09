"""Two-phase XLSR anti-spoof training from the leakage-safe manifest."""

from __future__ import annotations

import argparse
import json
import random
import shutil
import time
from pathlib import Path
from typing import Any

import numpy as np
import torch
from torch import nn
from torch.utils.data import DataLoader

from training.audio_dataset import AudioDataset
from training.augmentations import augmentation_config_dict, load_augmentation_config
from training.balanced_dataset import ChannelBalancedDataset
from training.evaluate import evaluate_model, limited_dataset
from training.model import VoiceCloneDetector


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument(
        "--augmentation-config",
        type=Path,
        default=Path("training/configs/augmentation.yaml"),
    )
    parser.add_argument("--model-name", default="training/pretrained/wav2vec2-large-xlsr-53")
    parser.add_argument("--phase", choices=("a", "b", "all"), default="all")
    parser.add_argument("--phase-a-epochs", type=int, default=1)
    parser.add_argument("--phase-b-epochs", type=int, default=1)
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument("--gradient-accumulation", type=int, default=8)
    parser.add_argument("--workers", type=int, default=0)
    parser.add_argument("--head-learning-rate", type=float, default=3e-4)
    parser.add_argument("--phase-b-head-learning-rate", type=float, default=5e-5)
    parser.add_argument("--encoder-learning-rate", type=float, default=5e-6)
    parser.add_argument("--weight-decay", type=float, default=1e-2)
    parser.add_argument("--unfreeze-layers", type=int, default=4)
    parser.add_argument("--max-steps-per-epoch", type=int, default=0)
    parser.add_argument("--validation-max-examples", type=int, default=0)
    parser.add_argument("--resume", type=Path)
    parser.add_argument("--warm-start", type=Path, help="Weights only; start a new experiment")
    parser.add_argument("--waveform-normalization", choices=("none", "zero_mean_unit_variance"), default="none")
    parser.add_argument("--sampling", choices=("files", "channel-balanced"), default="files")
    parser.add_argument("--cache-megabytes", type=int, default=0)
    parser.add_argument("--encoder-eval-during-finetune", action="store_true")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--threshold", type=float, default=0.5)
    parser.add_argument("--gradient-clip", type=float, default=1.0)
    parser.add_argument("--log-every", type=int, default=10)
    parser.add_argument("--hidden-size", type=int, default=256)
    parser.add_argument("--graph-layers", type=int, default=2)
    parser.add_argument("--graph-heads", type=int, default=4)
    parser.add_argument("--dropout", type=float, default=0.15)
    parser.add_argument("--amp", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument(
        "--gradient-checkpointing",
        action=argparse.BooleanOptionalAction,
        default=True,
    )
    parser.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    return parser.parse_args()


def make_loader(dataset, args: argparse.Namespace, *, shuffle: bool) -> DataLoader:
    return DataLoader(
        dataset,
        batch_size=args.batch_size,
        shuffle=shuffle,
        num_workers=args.workers,
        pin_memory=torch.device(args.device).type == "cuda",
        persistent_workers=False,
    )


def architecture_dict(model: VoiceCloneDetector) -> dict[str, Any]:
    return {
        "model_name": model.model_name,
        "hidden_size": model.hidden_size,
        "graph_layers": model.graph_layer_count,
        "graph_heads": model.graph_head_count,
        "dropout": model.dropout_rate,
        "waveform_normalization": model.waveform_normalization,
    }


def serializable_arguments(args: argparse.Namespace) -> dict[str, Any]:
    return {
        key: str(value) if isinstance(value, Path) else value
        for key, value in vars(args).items()
    }


def serving_checkpoint(
    model: nn.Module,
    model_name: str,
    report: dict,
    *,
    phase: str | None = None,
    epoch: int | None = None,
) -> dict:
    """Package trained weights using the backend's checkpoint contract."""
    hidden_size = getattr(model, "hidden_size", model.projection[1].out_features)
    return {
        "format_version": 2,
        "model_name": model_name,
        "hidden_size": hidden_size,
        "graph_layers": getattr(model, "graph_layer_count", 2),
        "graph_heads": getattr(model, "graph_head_count", 4),
        "dropout": getattr(model, "dropout_rate", 0.15),
        "waveform_normalization": getattr(model, "waveform_normalization", "none"),
        "state_dict": model.state_dict(),
        "metrics": report["overall"],
        "selection": {
            "metric": "eer",
            "value": report["overall"].get("eer"),
            "phase": phase,
            "epoch": epoch,
        },
    }


def class_weight(dataset: AudioDataset, device: torch.device) -> tuple[torch.Tensor, dict[str, int]]:
    real = sum(record.label == 0 for record in dataset.records)
    fake = sum(record.label == 1 for record in dataset.records)
    if real == 0 or fake == 0:
        raise ValueError("training split must contain both real and fake examples")
    return torch.tensor([real / fake], device=device), {"real": real, "fake": fake}


def configure_phase(
    model: VoiceCloneDetector,
    phase: str,
    args: argparse.Namespace,
) -> tuple[torch.optim.Optimizer, dict[str, int]]:
    if phase == "a":
        model.freeze_encoder()
        groups = [{"params": model.head_parameters(), "lr": args.head_learning_rate}]
    else:
        encoder_parameters = model.unfreeze_top_encoder_layers(args.unfreeze_layers)
        if args.gradient_checkpointing:
            model.enable_gradient_checkpointing()
        groups = [
            {"params": model.head_parameters(), "lr": args.phase_b_head_learning_rate},
            {"params": encoder_parameters, "lr": args.encoder_learning_rate},
        ]
    optimizer = torch.optim.AdamW(groups, weight_decay=args.weight_decay)
    counts = {
        "trainable": sum(parameter.numel() for parameter in model.parameters() if parameter.requires_grad),
        "total": sum(parameter.numel() for parameter in model.parameters()),
    }
    return optimizer, counts


def atomic_torch_save(payload: Any, path: Path) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    torch.save(payload, temporary)
    temporary.replace(path)


def rng_state() -> dict[str, Any]:
    numpy_state = np.random.get_state()
    return {
        "python": random.getstate(),
        "numpy": (numpy_state[0], numpy_state[1].tolist(), *numpy_state[2:]),
        "torch": torch.get_rng_state(),
        "cuda": torch.cuda.get_rng_state_all() if torch.cuda.is_available() else [],
    }


def restore_rng(state: dict[str, Any]) -> None:
    random.setstate(state["python"])
    numpy_state = state["numpy"]
    np.random.set_state((numpy_state[0], np.array(numpy_state[1], dtype=np.uint32), *numpy_state[2:]))
    torch.set_rng_state(state["torch"].cpu())
    if state["cuda"] and torch.cuda.is_available():
        torch.cuda.set_rng_state_all([item.cpu() for item in state["cuda"]])


def accumulation_group_size(step: int, total: int, accumulation: int) -> int:
    return min(accumulation, total - ((step - 1) // accumulation) * accumulation)


def save_training_checkpoint(
    path: Path,
    model: VoiceCloneDetector,
    optimizer: torch.optim.Optimizer,
    phase: str,
    epoch: int,
    report: dict[str, Any],
    args: argparse.Namespace,
    scaler: torch.amp.GradScaler | None = None,
) -> None:
    atomic_torch_save(
        {
            "format_version": 2,
            "phase": phase,
            "epoch": epoch,
            "architecture": architecture_dict(model),
            "model": model.state_dict(),
            "optimizer": optimizer.state_dict(),
            "report": report,
            "arguments": serializable_arguments(args),
            "scaler": scaler.state_dict() if scaler is not None else {},
            "rng": rng_state(),
        },
        path,
    )


def load_weights(path: Path, model: VoiceCloneDetector) -> dict[str, Any]:
    payload = torch.load(path, map_location="cpu", weights_only=True)
    state_dict = payload.get("model", payload.get("state_dict"))
    if state_dict is None:
        raise ValueError(f"checkpoint has no model weights: {path}")
    model.load_state_dict(state_dict)
    return payload


def existing_best_eer(output: Path, phase: str) -> float:
    """Recover the best completed-epoch objective before a resumed run."""
    values: list[float] = []
    for report_path in output.glob(f"phase-{phase}-epoch-*.json"):
        report = json.loads(report_path.read_text(encoding="utf-8"))
        eer = report.get("overall", {}).get("eer")
        if eer is not None:
            values.append(float(eer))
    return min(values, default=float("inf"))


def existing_overall_best_eer(output: Path) -> float:
    """Return the best completed EER across every training phase."""
    return min(existing_best_eer(output, "a"), existing_best_eer(output, "b"))


def run_phase(
    phase: str,
    epochs: int,
    model: VoiceCloneDetector,
    train_dataset: AudioDataset,
    validation_loader: DataLoader,
    device: torch.device,
    args: argparse.Namespace,
    loss_fn: nn.Module,
    resume_payload: dict[str, Any] | None = None,
) -> Path:
    optimizer, parameter_counts = configure_phase(model, phase, args)
    start_epoch = 1
    if resume_payload is not None and resume_payload.get("phase") == phase:
        optimizer_state = resume_payload.get("optimizer")
        if optimizer_state is None:
            raise ValueError("same-phase resume checkpoint has no optimizer state")
        optimizer.load_state_dict(optimizer_state)
        start_epoch = int(resume_payload.get("epoch", 0)) + 1
        print(
            f"resuming phase={phase} at epoch={start_epoch} "
            f"with optimizer state restored",
            flush=True,
        )
    train_loader = make_loader(train_dataset, args, shuffle=True)
    amp_enabled = args.amp and device.type == "cuda"
    scaler = torch.amp.GradScaler("cuda", enabled=amp_enabled)
    if resume_payload is not None and resume_payload.get("phase") == phase:
        if resume_payload.get("scaler"):
            scaler.load_state_dict(resume_payload["scaler"])
        if resume_payload.get("rng"):
            restore_rng(resume_payload["rng"])
    best_eer = existing_best_eer(args.output, phase)
    serving_best_eer = existing_overall_best_eer(args.output)
    best_path = args.output / f"phase-{phase}-best.pt"
    print(
        f"phase={phase} trainable={parameter_counts['trainable']:,}/"
        f"{parameter_counts['total']:,} amp={amp_enabled}"
    )

    if start_epoch > epochs:
        if best_path.is_file():
            print(f"phase={phase} already complete; keeping {best_path}", flush=True)
            return best_path
        raise ValueError(
            f"checkpoint already completed phase {phase} epoch {start_epoch - 1}; "
            f"requested final epoch is {epochs}"
        )

    for epoch in range(start_epoch, epochs + 1):
        train_dataset.set_epoch(epoch - 1 + (args.phase_a_epochs if phase == "b" else 0))
        if isinstance(train_dataset, ChannelBalancedDataset):
            print(f"epoch_draws={train_dataset.distribution()}", flush=True)
        model.train()
        if phase == "a" or args.encoder_eval_during_finetune:
            model.encoder.eval()
        optimizer.zero_grad(set_to_none=True)
        losses: list[float] = []
        started = time.perf_counter()
        steps = 0
        total_steps = min(len(train_loader), args.max_steps_per_epoch or len(train_loader))
        for step, batch in enumerate(train_loader, start=1):
            waveform = batch["waveform"].to(device, non_blocking=True)
            labels = batch["label"].to(device, dtype=torch.float32, non_blocking=True)
            with torch.autocast(
                device_type=device.type,
                dtype=torch.float16,
                enabled=amp_enabled,
            ):
                raw_loss = loss_fn(model(waveform).logits, labels)
                loss = raw_loss / accumulation_group_size(step, total_steps, args.gradient_accumulation)
            if not torch.isfinite(raw_loss):
                raise FloatingPointError(f"non-finite loss: phase={phase} epoch={epoch} step={step}")
            scaler.scale(loss).backward()
            should_step = step % args.gradient_accumulation == 0
            reached_limit = step >= total_steps
            if should_step or reached_limit:
                scaler.unscale_(optimizer)
                torch.nn.utils.clip_grad_norm_(
                    [parameter for group in optimizer.param_groups for parameter in group["params"]],
                    args.gradient_clip,
                )
                scaler.step(optimizer)
                scaler.update()
                optimizer.zero_grad(set_to_none=True)
            losses.append(float(raw_loss.detach().cpu()))
            steps = step
            if step % args.log_every == 0:
                elapsed = time.perf_counter() - started
                print(
                    f"phase={phase} epoch={epoch} step={step} "
                    f"loss={np.mean(losses[-args.log_every:]):.4f} "
                    f"examples_per_second={step * args.batch_size / elapsed:.2f}",
                    flush=True,
                )
            if reached_limit:
                break

        print(f"phase={phase} epoch={epoch} validation starting", flush=True)
        report, _predictions = evaluate_model(model, validation_loader, device, args.threshold, log_every=1000)
        report.update(
            {
                "phase": phase,
                "epoch": epoch,
                "train_loss": float(np.mean(losses)),
                "train_steps": steps,
                "parameter_counts": parameter_counts,
            }
        )
        report_path = args.output / f"phase-{phase}-epoch-{epoch:03d}.json"
        report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
        last_path = args.output / f"phase-{phase}-last.pt"
        save_training_checkpoint(
            last_path,
            model,
            optimizer,
            phase,
            epoch,
            report,
            args,
            scaler,
        )
        eer = report["overall"]["eer"]
        objective = float(eer) if eer is not None else float("inf")
        if objective <= best_eer:
            best_eer = objective
            temporary_best = best_path.with_suffix(".pt.tmp")
            shutil.copyfile(last_path, temporary_best)
            temporary_best.replace(best_path)
        # Retain each candidate epoch for source-aware review, independent of global EER.
        atomic_torch_save(
            serving_checkpoint(model, args.model_name, report, phase=phase, epoch=epoch),
            args.output / f"phase-{phase}-epoch-{epoch:03d}-model.pt",
        )
        if objective <= serving_best_eer:
            serving_best_eer = objective
            atomic_torch_save(
                serving_checkpoint(model, args.model_name, report, phase=phase, epoch=epoch),
                args.output / "model.pt",
            )
        print(
            f"phase={phase} epoch={epoch} train_loss={report['train_loss']:.4f} "
            f"validation={json.dumps(report['overall'])}",
            flush=True,
        )
    return best_path


def validate_args(args: argparse.Namespace) -> None:
    positive = (
        args.phase_a_epochs,
        args.phase_b_epochs,
        args.batch_size,
        args.gradient_accumulation,
        args.head_learning_rate,
        args.phase_b_head_learning_rate,
        args.encoder_learning_rate,
        args.gradient_clip,
        args.log_every,
    )
    if any(value <= 0 for value in positive):
        raise ValueError("epoch, batch, optimization, clipping, and logging values must be positive")
    if args.workers < 0 or args.max_steps_per_epoch < 0 or args.validation_max_examples < 0:
        raise ValueError("workers and maximum sample/step values cannot be negative")
    if args.cache_megabytes < 0 or (args.resume and args.warm_start):
        raise ValueError("cache must be non-negative; choose resume OR warm-start")
    if args.phase == "b" and args.resume is None:
        raise ValueError("Phase B requires --resume with a Phase A checkpoint")


def main() -> None:
    args = parse_args()
    validate_args(args)
    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(args.seed)
    device = torch.device(args.device)
    if device.type == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("CUDA requested but unavailable")

    config = load_augmentation_config(args.augmentation_config, project_root=Path.cwd())
    train_dataset = AudioDataset(args.manifest, "train", config, seed=args.seed, cache_megabytes=args.cache_megabytes)
    validation_dataset = AudioDataset(args.manifest, "validation", config, seed=args.seed)
    selected_validation = limited_dataset(
        validation_dataset,
        args.validation_max_examples,
        args.seed,
    )
    validation_loader = make_loader(selected_validation, args, shuffle=False)
    model = VoiceCloneDetector(
        args.model_name,
        hidden_size=args.hidden_size,
        graph_layers=args.graph_layers,
        graph_heads=args.graph_heads,
        dropout=args.dropout,
        waveform_normalization=args.waveform_normalization,
    ).to(device)
    resume_payload: dict[str, Any] | None = None
    if args.resume:
        resume_payload = load_weights(args.resume, model)
        previous_policy = resume_payload.get("architecture", resume_payload).get("waveform_normalization", "none")
        if previous_policy != args.waveform_normalization:
            raise ValueError("resume cannot change preprocessing; use --warm-start for a new experiment")
        print(f"loaded checkpoint={args.resume} phase={resume_payload.get('phase')}")
    elif args.warm_start:
        load_weights(args.warm_start, model)
        print(f"weights-only warm start={args.warm_start}; new policy={args.waveform_normalization}", flush=True)

    pos_weight, class_counts = class_weight(train_dataset, device)
    if args.sampling == "channel-balanced":
        train_dataset = ChannelBalancedDataset(train_dataset, args.seed)
        pos_weight = torch.ones(1, device=device)  # sampling already balances labels
    loss_fn = nn.BCEWithLogitsLoss(pos_weight=pos_weight)
    args.output.mkdir(parents=True, exist_ok=True)
    experiment_path = args.output / "experiment.json"
    if experiment_path.exists():
        if not args.resume:
            raise FileExistsError("output already has an experiment; choose a fresh directory or --resume")
        experiment_path = args.output / f"resume-{time.time_ns()}.json"
    experiment_path.write_text(
        json.dumps(
            {
                "seed": args.seed,
                "arguments": vars(args),
                "architecture": architecture_dict(model),
                "augmentation": augmentation_config_dict(config),
                "class_counts": class_counts,
                "fake_pos_weight": float(pos_weight.item()),
            },
            indent=2,
            default=str,
        ),
        encoding="utf-8",
    )
    print(
        f"device={device} train={len(train_dataset)} validation={len(validation_dataset)} "
        f"validation_used={len(selected_validation)} classes={class_counts} "
        f"fake_pos_weight={pos_weight.item():.6f}"
    )

    if args.phase in {"a", "all"}:
        phase_a_best = run_phase(
            "a",
            args.phase_a_epochs,
            model,
            train_dataset,
            validation_loader,
            device,
            args,
            loss_fn,
            resume_payload,
        )
        load_weights(phase_a_best, model)
    if args.phase in {"b", "all"}:
        run_phase(
            "b",
            args.phase_b_epochs,
            model,
            train_dataset,
            validation_loader,
            device,
            args,
            loss_fn,
            resume_payload,
        )


if __name__ == "__main__":
    main()
