"""Build a reproducible CSV manifest from labelled audio and ASVspoof protocols."""

from __future__ import annotations

import argparse
import csv
import hashlib
import random
from collections import Counter, defaultdict
from dataclasses import dataclass, replace
from pathlib import Path

AUDIO_SUFFIXES = {".wav", ".flac"}
LANGUAGE_ALIASES = {
    "english": "en",
    "hindi": "hi",
    "kannada": "kn",
    "odia": "or",
    "oriya": "or",
    "tamil": "ta",
}


def normalize_language(language: str) -> str:
    normalized = language.lower()
    return LANGUAGE_ALIASES.get(normalized, normalized)


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
        language = parts[1] or "unknown"
        return parts[0] or "unknown", normalize_language(language)
    return "unknown", "unknown"


def metadata_from_path(path: Path, root: Path) -> tuple[str, str]:
    """Read ``speaker/language`` metadata from folders, then fall back to the filename."""
    relative_parts = path.relative_to(root).parts
    if len(relative_parts) >= 3:
        language = relative_parts[-2]
        return relative_parts[-3], normalize_language(language)
    if len(relative_parts) == 2:
        language = relative_parts[0]
        return root.name, normalize_language(language)
    return metadata_from_name(path)


def scan(root: Path, label: str) -> list[ManifestRow]:
    if not root.exists():
        return []
    rows = []
    for path in sorted(p for p in root.rglob("*") if p.suffix.lower() in AUDIO_SUFFIXES):
        speaker, language = metadata_from_path(path, root)
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


def _seeded_random(seed: int, group: str) -> random.Random:
    digest = hashlib.sha256(f"{seed}:{group}".encode()).digest()
    return random.Random(int.from_bytes(digest[:8], "big"))


def _train_count(item_count: int, train_ratio: float) -> int:
    if item_count <= 1:
        return item_count
    return min(item_count - 1, max(1, round(item_count * train_ratio)))


def _balanced_train_speakers(
    rows: list[ManifestRow], *, seed: int, corpus: str, train_ratio: float
) -> set[str]:
    """Select a fixed number of speakers while closely matching the target row ratio."""
    speaker_counts = Counter(row.speaker for row in rows)
    speakers = sorted(speaker_counts)
    _seeded_random(seed, f"speakers:{corpus}").shuffle(speakers)
    target_speaker_count = _train_count(len(speakers), train_ratio)
    target_row_count = round(len(rows) * train_ratio)

    states: dict[tuple[int, int], tuple[str, ...]] = {(0, 0): ()}
    for speaker in speakers:
        next_states = dict(states)
        for (count, row_count), selected in states.items():
            if count >= target_speaker_count:
                continue
            key = (count + 1, row_count + speaker_counts[speaker])
            next_states.setdefault(key, (*selected, speaker))
        states = next_states

    candidates = [
        (row_count, selected)
        for (count, row_count), selected in states.items()
        if count == target_speaker_count
    ]
    _row_count, selected = min(
        candidates,
        key=lambda candidate: (abs(candidate[0] - target_row_count), candidate[0]),
    )
    return set(selected)


def assign_splits(
    rows: list[ManifestRow],
    *,
    row_level_sources: set[str] | None = None,
    seed: int = 42,
    train_ratio: float = 0.8,
) -> list[ManifestRow]:
    """Assign reproducible train/dev splits while keeping known speakers isolated.

    ASVspoof rows already carry protocol-authoritative splits and remain unchanged.
    Sources explicitly listed in ``row_level_sources`` are split by row because they
    do not expose reliable speaker identities. All other sources are split by whole
    speaker. Single-speaker input roots are pooled so separately supplied team
    folders still produce a useful speaker-disjoint split.
    """
    if not 0 < train_ratio < 1:
        raise ValueError("train_ratio must be between 0 and 1")

    row_level_sources = row_level_sources or set()
    pending = [row for row in rows if row.split == "unspecified"]
    split_by_path: dict[str, str] = {}

    row_groups: dict[str, list[ManifestRow]] = defaultdict(list)
    speaker_rows: list[ManifestRow] = []
    for row in pending:
        if row.source in row_level_sources:
            row_groups[row.source].append(row)
        else:
            speaker_rows.append(row)

    for source, source_rows in sorted(row_groups.items()):
        shuffled = sorted(source_rows, key=lambda row: row.path)
        _seeded_random(seed, f"rows:{source}").shuffle(shuffled)
        cutoff = _train_count(len(shuffled), train_ratio)
        for index, row in enumerate(shuffled):
            split_by_path[row.path] = "train" if index < cutoff else "dev"

    speakers_by_source: dict[str, set[str]] = defaultdict(set)
    for row in speaker_rows:
        speakers_by_source[row.source].add(row.speaker)
    singleton_sources = {
        source for source, speakers in speakers_by_source.items() if len(speakers) == 1
    }

    corpus_rows: dict[str, list[ManifestRow]] = defaultdict(list)
    for row in speaker_rows:
        corpus = "singleton-sources" if row.source in singleton_sources else row.source
        corpus_rows[corpus].append(row)

    for corpus, grouped_rows in sorted(corpus_rows.items()):
        speakers = sorted({row.speaker for row in grouped_rows})
        if corpus == "singleton-sources":
            _seeded_random(seed, f"speakers:{corpus}").shuffle(speakers)
            train_speakers = set(speakers[: _train_count(len(speakers), train_ratio)])
        else:
            train_speakers = _balanced_train_speakers(
                grouped_rows,
                seed=seed,
                corpus=corpus,
                train_ratio=train_ratio,
            )
        for row in grouped_rows:
            split_by_path[row.path] = "train" if row.speaker in train_speakers else "dev"

    return [
        replace(row, split=split_by_path[row.path]) if row.path in split_by_path else row
        for row in rows
    ]


def build_manifest(
    real_dirs: list[Path],
    fake_dirs: list[Path],
    output: Path,
    asvspoof_roots: list[Path] | None = None,
    *,
    row_level_sources: set[str] | None = None,
    split_seed: int = 42,
    train_ratio: float = 0.8,
    exclude_languages: set[str] | None = None,
) -> int:
    rows = [row for root in real_dirs for row in scan(root, "real")]
    rows.extend(row for root in fake_dirs for row in scan(root, "fake"))
    rows.extend(row for root in (asvspoof_roots or []) for row in scan_asvspoof(root))
    excluded = {normalize_language(language) for language in (exclude_languages or set())}
    rows = [row for row in rows if row.language not in excluded]
    rows = assign_splits(
        rows,
        row_level_sources=row_level_sources,
        seed=split_seed,
        train_ratio=train_ratio,
    )
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
    parser.add_argument(
        "--row-split-source",
        action="append",
        default=[],
        help="Source name lacking speaker IDs; may be repeated (for example cdac_tamil)",
    )
    parser.add_argument("--split-seed", type=int, default=42)
    parser.add_argument("--train-ratio", type=float, default=0.8)
    parser.add_argument(
        "--exclude-language",
        action="append",
        default=[],
        help="Normalized language code or name to omit; may be repeated",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    count = build_manifest(
        args.real,
        args.fake,
        args.output,
        args.asvspoof_root,
        row_level_sources=set(args.row_split_source),
        split_seed=args.split_seed,
        train_ratio=args.train_ratio,
        exclude_languages=set(args.exclude_language),
    )
    print(f"Wrote {count} rows to {args.output}")


if __name__ == "__main__":
    main()
