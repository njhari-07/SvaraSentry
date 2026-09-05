from __future__ import annotations

import csv

import pytest

from data_pipeline.prepare_split_manifest import read_rows, validate, write_rows


def write_manifest(path, rows: list[dict[str, str]]) -> None:
    with path.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["path", "label", "speaker"])
        writer.writeheader()
        writer.writerows(rows)


def test_split_manifest_combines_external_splits_and_preserves_metadata(tmp_path) -> None:
    paths = []
    for split, speaker in (("train", "a"), ("validation", "b"), ("test", "c")):
        path = tmp_path / f"{split}.csv"
        write_manifest(path, [{"path": f"{split}.wav", "label": "real", "speaker": speaker}])
        paths.append((path, split))
    rows = [row for path, split in paths for row in read_rows(path, split)]
    validate(rows, "speaker")
    output = tmp_path / "combined.csv"
    write_rows(rows, output)
    with output.open(newline="") as handle:
        combined = list(csv.DictReader(handle))
    assert [row["split"] for row in combined] == ["train", "validation", "test"]
    assert [row["speaker"] for row in combined] == ["a", "b", "c"]


def test_split_manifest_rejects_speaker_leakage(tmp_path) -> None:
    train = tmp_path / "train.csv"
    validation = tmp_path / "validation.csv"
    write_manifest(train, [{"path": "a.wav", "label": "real", "speaker": "same"}])
    write_manifest(validation, [{"path": "b.wav", "label": "fake", "speaker": "same"}])
    with pytest.raises(ValueError, match="speaker leakage"):
        validate([*read_rows(train, "train"), *read_rows(validation, "validation")], "speaker")
