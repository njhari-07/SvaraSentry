"""Build a reproducible CSV manifest from labelled audio and ASVspoof protocols."""

from __future__ import annotations

import argparse
import csv
from dataclasses import dataclass
from pathlib import Path

AUDIO_SUFFIXES = {".wav", ".flac"}


@dataclass(frozen=True, slots=True)
class ManifestRow:
    path: str
    label: str
    language: str
    speaker: str
    source: str
    split: str = "unspecified"
    attack_type: str = "unknown"


def metadata_from_name(path: Path) -> tuple[str, str]:
    parts = path.stem.split("__")
    if len(parts) >= 2:
        return parts[0] or "unknown", parts[1] or "unknown"
    return "unknown", "unknown"


def scan(root: Path, label: str) -> list[ManifestRow]:
    if not root.exists():
        return []
    rows = []
    for path in sorted(p for p in root.rglob("*") if p.suffix.lower() in AUDIO_SUFFIXES):
        speaker, language = metadata_from_name(path)
        rows.append(
            ManifestRow(
                path=str(path.resolve()),
                label=label,
                language=language,
                speaker=speaker,
                source=root.name,
            )
        )
    return rows


def scan_asvspoof(root: Path) -> list[ManifestRow]:
    """Build rows from ASVspoof 2019 LA protocol files, the label authority."""
    layouts = (
        (
            "train",
            root / "ASVspoof2019_LA_train" / "flac",
            root
            / "ASVspoof2019_LA_cm_protocols"
            / "ASVspoof2019.LA.cm.train.trn.txt",
        ),
        (
            "dev",
            root / "ASVspoof2019_LA_dev" / "flac",
            root
            / "ASVspoof2019_LA_cm_protocols"
            / "ASVspoof2019.LA.cm.dev.trl.txt",
        ),
    )
    rows: list[ManifestRow] = []
    seen_utterances: set[str] = set()
    for split, audio_dir, protocol_path in layouts:
        if not audio_dir.is_dir():
            raise ValueError(f"ASVspoof {split} audio directory not found: {audio_dir}")
        if not protocol_path.is_file():
            raise ValueError(f"ASVspoof {split} protocol not found: {protocol_path}")
        with protocol_path.open(encoding="utf-8") as protocol:
            for line_number, raw_line in enumerate(protocol, start=1):
                fields = raw_line.split()
                if not fields:
                    continue
                if len(fields) != 5:
                    raise ValueError(
                        f"Invalid ASVspoof protocol row at {protocol_path}:{line_number}"
                    )
                speaker, utterance, _unused, attack, protocol_label = fields
                try:
                    label = {"bonafide": "real", "spoof": "fake"}[protocol_label]
                except KeyError as exc:
                    raise ValueError(
                        f"Unknown ASVspoof label {protocol_label!r} at "
                        f"{protocol_path}:{line_number}"
                    ) from exc
                if utterance in seen_utterances:
                    raise ValueError(f"Duplicate ASVspoof utterance in protocols: {utterance}")
                seen_utterances.add(utterance)
                audio_path = audio_dir / f"{utterance}.flac"
                if not audio_path.is_file():
                    raise ValueError(
                        f"ASVspoof protocol references missing audio: {audio_path}"
                    )
                rows.append(
                    ManifestRow(
                        path=str(audio_path.resolve()),
                        label=label,
                        language="en",
                        speaker=speaker,
                        source="asvspoof2019_la",
                        split=split,
                        attack_type="none" if attack == "-" else attack,
                    )
                )
    return rows


def build_manifest(
    real_dirs: list[Path],
    fake_dirs: list[Path],
    output: Path,
    asvspoof_roots: list[Path] | None = None,
) -> int:
    rows = [row for root in real_dirs for row in scan(root, "real")]
    rows.extend(row for root in fake_dirs for row in scan(root, "fake"))
    rows.extend(row for root in (asvspoof_roots or []) for row in scan_asvspoof(root))
    paths = [row.path for row in rows]
    if len(paths) != len(set(paths)):
        raise ValueError("Manifest contains duplicate audio paths")
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=ManifestRow.__dataclass_fields__)
        writer.writeheader()
        writer.writerows(
            {
                "path": row.path,
                "label": row.label,
                "language": row.language,
                "speaker": row.speaker,
                "source": row.source,
                "split": row.split,
                "attack_type": row.attack_type,
            }
            for row in rows
        )
    return len(rows)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--real", type=Path, action="append", default=[])
    parser.add_argument("--fake", type=Path, action="append", default=[])
    parser.add_argument(
        "--asvspoof-root",
        type=Path,
        action="append",
        default=[],
        help="ASVspoof 2019 LA root containing audio partitions and CM protocols",
    )
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    count = build_manifest(args.real, args.fake, args.output, args.asvspoof_root)
    print(f"Wrote {count} rows to {args.output}")


if __name__ == "__main__":
    main()
