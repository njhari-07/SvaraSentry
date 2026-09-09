"""Verify the deployed checkpoint stream drains and returns a full summary."""

from __future__ import annotations

import argparse
import json
import math
import urllib.request
from pathlib import Path
from uuid import uuid4

import numpy as np
import soundfile as sf
from websockets.sync.client import connect


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("audio", type=Path)
    parser.add_argument("--session", default="audit-" + uuid4().hex[:10])
    parser.add_argument("--paired", action="store_true")
    parser.add_argument("--seconds", type=float, default=20)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    samples, rate = sf.read(args.audio, dtype="float32", always_2d=True)
    if rate != 16000:
        raise ValueError("Use a preconverted 16 kHz input for this transport smoke test")
    samples = samples[:int(args.seconds * rate)].mean(axis=1)
    pcm = (np.clip(samples, -1, 1) * 32767).astype("<i2").tobytes()
    url = f"ws://127.0.0.1:8000/ws/audio/{args.session}"
    if args.paired:
        request = urllib.request.Request(
            f"http://127.0.0.1:8000/api/sessions/{args.session}/pairing-token", method="POST"
        )
        with urllib.request.urlopen(request, timeout=10) as response:
            token = json.load(response)["token"]
        url = f"ws://127.0.0.1:8000/ws/audio/pair/{token}"
    results = []
    with connect(url, open_timeout=20, close_timeout=5) as socket:
        for offset in range(0, len(pcm), 8000):
            socket.send(pcm[offset:offset + 8000])
        socket.send(json.dumps({"type": "audio_control", "action": "stop"}))
        while True:
            message = json.loads(socket.recv(timeout=60))
            if message["type"] == "result":
                results.append(message)
            elif message["type"] == "audio_stopped":
                summary = message["summary"]
                break
            else:
                raise AssertionError(f"Unexpected stream message: {message['type']}")
    expected = max(0, (len(samples) - 48000) // 16000 + 1)
    assert len(results) == expected == summary["window_count"]
    assert summary["completed"]
    assert all(r["model_kind"] == "wav2vec2-attentive" for r in results)
    assert math.isclose(summary["average_risk"], np.mean([r["risk_score"] for r in results]), abs_tol=0.00011)
    assert summary["maximum_risk"] == max(r["risk_score"] for r in results)
    with urllib.request.urlopen(f"http://127.0.0.1:8000/api/sessions/{args.session}", timeout=10) as response:
        snapshot = json.load(response)
    assert snapshot["final_summary"] == summary
    assert not snapshot["audio_connected"]
    report = {"audio": str(args.audio), "paired": args.paired, "summary": summary,
              "last_ema": results[-1]["smoothed_risk"], "window_scores": [r["risk_score"] for r in results],
              "explanation_sources": sorted({r["explanation"]["source"] for r in results}), "passed": True}
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report))


if __name__ == "__main__":
    main()
