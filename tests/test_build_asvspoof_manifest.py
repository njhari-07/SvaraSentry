from __future__ import annotations

import csv

from data_pipeline.build_asvspoof2019_la_manifest import (
    _PARTITIONS,
    _PROTOCOL_DIRECTORY,
    build_manifest,
)


def test_build_asvspoof_manifest_uses_official_partitions(tmp_path) -> None:
    protocol_dir = tmp_path / _PROTOCOL_DIRECTORY
    protocol_dir.mkdir()
    for index, partition in enumerate(_PARTITIONS):
        audio_dir = tmp_path / partition.audio_directory
        audio_dir.mkdir(parents=True)
        utterance = f"LA_{partition.split}_0001"
        (audio_dir / f"{utterance}.flac").touch()
        key = "bonafide" if partition.split == "validation" else "spoof"
        attack = "-" if key == "bonafide" else "A01"
        (protocol_dir / partition.protocol_file).write_text(f"speaker_{index} {utterance} - {attack} {key}\n")
    output = tmp_path / "manifest.csv"
    counts = build_manifest(tmp_path, output)
    assert counts == {"train": 1, "validation": 1, "test": 1}
    with output.open(newline="") as handle:
        rows = list(csv.DictReader(handle))
    assert [row["label"] for row in rows] == ["fake", "real", "fake"]
    assert rows[0]["fake_engine"] == "A01"
    assert rows[1]["fake_engine"] == ""
