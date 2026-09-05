"""Combine externally assigned train/validation/test manifests safely.

This tool does not invent split policy. It validates the user-assigned splits,
adds a ``split`` column, and rejects path and group leakage before writing one
manifest consumable by ``training.AudioDataset``.
"""

from __future__ import annotations

import argparse
import csv
from collections import defaultdict
from pathlib import Path

_SPLITS = ("train", "validation", "test")
_REQUIRED_COLUMNS = {"path", "label"}


def read_rows(path: Path, split: str) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        if not reader.fieldnames or not _REQUIRED_COLUMNS.issubset(reader.fieldnames):
            raise ValueError(f"{path} must contain {sorted(_REQUIRED_COLUMNS)}")
        rows = []
        for row in reader:
            normalized = {key: value or "" for key, value in row.items()}
            declared = normalized.get("split", "").strip().lower()
            if declared and declared != split:
                raise ValueError(f"{path} contains split={declared!r}; expected {split!r}")
            normalized["split"] = split
            rows.append(normalized)
    if not rows:
        raise ValueError(f"{path} contains no rows")
    return rows


def validate(rows: list[dict[str, str]], group_column: str | None) -> None:
    paths: dict[str, str] = {}
    groups: dict[str, set[str]] = defaultdict(set)
    for row in rows:
        path = str(Path(row["path"]).expanduser().resolve())
        split = row["split"]
        existing = paths.setdefault(path, split)
        if existing != split:
            raise ValueError(f"audio path appears in multiple splits: {path}")
        if group_column:
            group = row.get(group_column, "").strip()
            if group:
                groups[group].add(split)
    leaked = sorted(group for group, splits in groups.items() if len(splits) > 1)
    if leaked:
        preview = ", ".join(leaked[:8])
        raise ValueError(f"{group_column} leakage across splits: {preview}")


def write_rows(rows: list[dict[str, str]], output: Path) -> None:
    fields = sorted({field for row in rows for field in row})
    required_order = ["path", "label", "split"]
    fields = required_order + [field for field in fields if field not in required_order]
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--train", required=True, type=Path)
    parser.add_argument("--validation", required=True, type=Path)
    parser.add_argument("--test", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument(
        "--group-column",
        default="speaker",
        help="Column that must not cross splits; pass an empty string to disable this check",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    rows = [
        *read_rows(args.train, "train"),
        *read_rows(args.validation, "validation"),
        *read_rows(args.test, "test"),
    ]
    validate(rows, args.group_column or None)
    write_rows(rows, args.output)
    counts = {split: sum(row["split"] == split for row in rows) for split in _SPLITS}
    print(f"Wrote {len(rows)} records to {args.output}: {counts}")


if __name__ == "__main__":
    main()
