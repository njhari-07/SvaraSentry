"""Build a reproducible CSV manifest from labelled audio directories."""

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


def build_manifest(real_dirs: list[Path], fake_dirs: list[Path], output: Path) -> int:
    rows = [row for root in real_dirs for row in scan(root, "real")]
    rows.extend(row for root in fake_dirs for row in scan(root, "fake"))
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
            }
            for row in rows
        )
    return len(rows)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--real", type=Path, action="append", default=[])
    parser.add_argument("--fake", type=Path, action="append", default=[])
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    count = build_manifest(args.real, args.fake, args.output)
    print(f"Wrote {count} rows to {args.output}")


if __name__ == "__main__":
    main()

