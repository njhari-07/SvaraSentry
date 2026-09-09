"""Extract audio rows from the Hugging Face Dataset Viewer API."""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import subprocess
import tempfile
import time
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import imageio_ffmpeg
import soundfile as sf

API_URL = "https://datasets-server.huggingface.co/rows"
PAGE_SIZE = 100
USER_AGENT = "SvaraSentry dataset extractor/1.0"


def fetch_bytes(url: str, attempts: int = 4) -> bytes:
    """Download a URL with short exponential retries."""
    request = Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(attempts):
        try:
            with urlopen(request, timeout=60) as response:
                return response.read()
        except OSError:
            if attempt == attempts - 1:
                raise
            time.sleep(2**attempt)
    raise RuntimeError("download retry loop exited unexpectedly")


def fetch_rows(dataset: str, config: str, split: str, offset: int, length: int) -> list[dict]:
    query = urlencode(
        {
            "dataset": dataset,
            "config": config,
            "split": split,
            "offset": offset,
            "length": length,
        }
    )
    payload = json.loads(fetch_bytes(f"{API_URL}?{query}"))
    return payload["rows"]


def audio_url(audio_cell: object) -> str:
    assets = audio_cell if isinstance(audio_cell, list) else [audio_cell]
    for asset in assets:
        if isinstance(asset, dict) and asset.get("src"):
            return str(asset["src"])
    raise ValueError("dataset row does not contain a downloadable audio asset")


def valid_flac(path: Path) -> bool:
    if not path.is_file():
        return False
    info = sf.info(path)
    return info.format == "FLAC" and info.samplerate == 16_000 and info.channels == 1


def safe_path_component(value: str) -> str:
    component = re.sub(r"[^A-Za-z0-9_.-]+", "_", value).strip("._")
    if not component:
        raise ValueError(f"invalid empty path component derived from {value!r}")
    return component


def convert_audio(source_url: str, destination: Path, ffmpeg: str) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="cdac_audio_") as temp_dir:
        input_path = Path(temp_dir) / "input_audio"
        input_path.write_bytes(fetch_bytes(source_url))
        partial_path = destination.with_suffix(".part.flac")
        subprocess.run(
            [
                ffmpeg,
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-i",
                str(input_path),
                "-vn",
                "-ar",
                "16000",
                "-ac",
                "1",
                "-c:a",
                "flac",
                str(partial_path),
            ],
            check=True,
        )
        if not valid_flac(partial_path):
            raise RuntimeError(f"FFmpeg produced an invalid FLAC file: {partial_path}")
        os.replace(partial_path, destination)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", default="cdactvm/kannada_new_data_v6")
    parser.add_argument("--config", default="default")
    parser.add_argument("--split", default="train")
    parser.add_argument("--count", type=int, default=300)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--speaker", default="cdac")
    parser.add_argument("--speaker-column")
    parser.add_argument("--language", default="kannada")
    parser.add_argument("--prefix", default="cdac_kn")
    parser.add_argument("--text-column", default="sentence")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.count < 1:
        raise ValueError("--count must be positive")

    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    metadata_rows: list[dict[str, object]] = []

    for offset in range(0, args.count, PAGE_SIZE):
        requested = min(PAGE_SIZE, args.count - offset)
        rows = fetch_rows(args.dataset, args.config, args.split, offset, requested)
        if len(rows) != requested:
            raise RuntimeError(f"requested {requested} rows at offset {offset}, received {len(rows)}")

        for wrapped_row in rows:
            row_index = int(wrapped_row["row_idx"])
            row = wrapped_row["row"]
            source_speaker = row.get(args.speaker_column) if args.speaker_column else None
            speaker = safe_path_component(str(source_speaker or args.speaker))
            audio_dir = args.output / speaker / safe_path_component(args.language)
            destination = audio_dir / f"{safe_path_component(args.prefix)}_{row_index:04d}.flac"
            if not valid_flac(destination):
                convert_audio(audio_url(row["audio"]), destination, ffmpeg)
            info = sf.info(destination)
            metadata_rows.append(
                {
                    "dataset_row": row_index,
                    "filename": destination.relative_to(args.output).as_posix(),
                    "sentence": row.get(args.text_column, ""),
                    "duration_seconds": f"{info.duration:.6f}",
                    "sample_rate": info.samplerate,
                    "channels": info.channels,
                    "source_speaker": source_speaker or "",
                    "source_duration_seconds": row.get("duration", ""),
                    "source_language": row.get("lang", ""),
                }
            )
        print(f"Prepared {len(metadata_rows)}/{args.count} clips", flush=True)

    metadata_path = args.output / "metadata.csv"
    partial_metadata = metadata_path.with_suffix(".part.csv")
    with partial_metadata.open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.DictWriter(handle, fieldnames=metadata_rows[0])
        writer.writeheader()
        writer.writerows(metadata_rows)
    os.replace(partial_metadata, metadata_path)

    total_seconds = sum(float(row["duration_seconds"]) for row in metadata_rows)
    print(
        f"Wrote {len(metadata_rows)} clips ({total_seconds / 60:.2f} minutes) "
        f"under {args.output}"
    )


if __name__ == "__main__":
    main()
