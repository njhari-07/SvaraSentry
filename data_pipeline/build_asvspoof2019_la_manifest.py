"""Create SvaraSentry's labelled manifest from ASVspoof 2019 LA protocols.

The official LA train/dev/eval partitions become train/validation/test. Their
speakers are already disjoint, so this tool never reassigns samples or splits.
"""

from __future__ import annotations

import argparse
import csv
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True, slots=True)
class Partition:
    split: str
    audio_directory: str
    protocol_file: str


_PARTITIONS = (
    Partition("train", "ASVspoof2019_LA_train/flac", "ASVspoof2019.LA.cm.train.trn.txt"),
    Partition("validation", "ASVspoof2019_LA_dev/flac", "ASVspoof2019.LA.cm.dev.trl.txt"),
    Partition("test", "ASVspoof2019_LA_eval/flac", "ASVspoof2019.LA.cm.eval.trl.txt"),
)
_PROTOCOL_DIRECTORY = "ASVspoof2019_LA_cm_protocols"


def parse_protocol(protocol: Path, audio_directory: Path, split: str) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    with protocol.open(encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            fields = line.split()
            if not fields:
                continue
            if len(fields) < 5:
                raise ValueError(f"malformed protocol row in {protocol}:{line_number}")
            speaker, utterance, attack, key = fields[0], fields[1], fields[-2], fields[-1].lower()
            if key not in {"bonafide", "spoof"}:
                raise ValueError(
                    f"{protocol}:{line_number} has no usable label ({key!r}); "
                    "use a released label protocol for this partition"
                )
            audio = audio_directory / f"{utterance}.flac"
            if not audio.is_file():
                raise FileNotFoundError(f"protocol references missing audio: {audio}")
            rows.append(
                {
                    "path": str(audio.resolve()),
                    "label": "real" if key == "bonafide" else "fake",
                    "split": split,
                    "id": utterance,
                    "speaker": speaker,
                    "language": "en",
                    "source": "asvspoof2019_la",
                    "fake_engine": "" if key == "bonafide" or attack == "-" else attack,
                }
            )
    if not rows:
        raise ValueError(f"no rows found in {protocol}")
    return rows


def build_manifest(root: Path, output: Path) -> dict[str, int]:
    protocol_root = root / _PROTOCOL_DIRECTORY
    rows: list[dict[str, str]] = []
    for partition in _PARTITIONS:
        rows.extend(
            parse_protocol(
                protocol_root / partition.protocol_file,
                root / partition.audio_directory,
                partition.split,
            )
        )
    speakers: dict[str, set[str]] = {}
    for row in rows:
        speakers.setdefault(row["speaker"], set()).add(row["split"])
    leaked = [speaker for speaker, splits in speakers.items() if len(splits) > 1]
    if leaked:
        raise ValueError(f"official ASVspoof speaker leakage detected: {', '.join(leaked[:8])}")
    output.parent.mkdir(parents=True, exist_ok=True)
    fields = ["path", "label", "split", "id", "speaker", "language", "source", "fake_engine"]
    with output.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)
    return {split: sum(row["split"] == split for row in rows) for split in ("train", "validation", "test")}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True, type=Path, help="Extracted ASVspoof 2019 LA directory")
    parser.add_argument("--output", required=True, type=Path)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    counts = build_manifest(args.root, args.output)
    print(f"Wrote {sum(counts.values())} rows to {args.output}: {counts}")


if __name__ == "__main__":
    main()
