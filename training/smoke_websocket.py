"""Stream audio through a running SvaraSentry WebSocket and print its result."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from websockets.sync.client import connect

from training.smoke_checkpoint import audio_chunk


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("audio", nargs="+", type=Path)
    parser.add_argument("--base-url", default="ws://127.0.0.1:8000")
    parser.add_argument("--frame-bytes", type=int, default=8_000)
    args = parser.parse_args()

    base_url = args.base_url.rstrip("/")
    if base_url.startswith("http://"):
        base_url = "ws://" + base_url.removeprefix("http://")
    elif base_url.startswith("https://"):
        base_url = "wss://" + base_url.removeprefix("https://")

    for index, path in enumerate(args.audio, start=1):
        url = f"{base_url}/ws/audio/e2e-{index}"
        pcm = audio_chunk(path).pcm
        with connect(url, open_timeout=20, close_timeout=5) as socket:
            for offset in range(0, len(pcm), args.frame_bytes):
                socket.send(pcm[offset : offset + args.frame_bytes])
            result = json.loads(socket.recv(timeout=30))
        summary = {
            "audio": str(path),
            "type": result.get("type"),
            "fake_probability": result.get("fake_probability"),
            "smoothed_risk": result.get("smoothed_risk"),
            "alert_level": result.get("alert_level"),
            "model_kind": result.get("model_kind"),
            "signal_state": result.get("signal", {}).get("state"),
            "evidence_methods": result.get("model_evidence", {}).get("methods", []),
            "explanation_source": result.get("explanation", {}).get("source"),
            "explanation": result.get("explanation", {}).get("summary"),
            "processing_ms": result.get("processing_ms"),
        }
        print(json.dumps(summary))


if __name__ == "__main__":
    main()
