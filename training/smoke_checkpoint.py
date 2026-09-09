"""Load a serving checkpoint and score one or more audio files through the backend."""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np

from backend.audio_io import decode_audio
from backend.inference import AttributionOptions
from backend.model_inference import CheckpointInferenceEngine
from backend.streaming import AudioChunk

SAMPLE_RATE = 16_000
WINDOW_SAMPLES = 48_000


def audio_chunk(path: Path) -> AudioChunk:
    samples = decode_audio(path.read_bytes(), target_rate=SAMPLE_RATE)[:WINDOW_SAMPLES]
    samples = np.pad(samples, (0, max(0, WINDOW_SAMPLES - samples.size)))
    pcm = (np.clip(samples, -1, 1) * 32767).astype("<i2").tobytes()
    return AudioChunk(pcm=pcm, start_sample=0, sample_rate=SAMPLE_RATE)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("checkpoint", type=Path)
    parser.add_argument("audio", nargs="+", type=Path)
    args = parser.parse_args()

    started = time.perf_counter()
    engine = CheckpointInferenceEngine(args.checkpoint, AttributionOptions())
    print(
        json.dumps(
            {
                "event": "checkpoint_loaded",
                "device": str(engine.device),
                "seconds": round(time.perf_counter() - started, 3),
            }
        )
    )
    for path in args.audio:
        started = time.perf_counter()
        result = engine.score(audio_chunk(path))
        print(
            json.dumps(
                {
                    "event": "scored",
                    "audio": str(path),
                    "fake_probability": round(result.fake_probability, 6),
                    "signal_state": result.signal_state,
                    "model_kind": result.model_kind,
                    "evidence_methods": result.model_evidence.get("methods", []),
                    "seconds": round(time.perf_counter() - started, 3),
                }
            )
        )


if __name__ == "__main__":
    main()
