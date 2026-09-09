"""Exercise pairing, relay reconnect, scoring, and intentional token revocation."""

from __future__ import annotations

import argparse
import json
import ssl
import urllib.request
from pathlib import Path

from websockets.exceptions import ConnectionClosed
from websockets.sync.client import connect

from training.smoke_checkpoint import audio_chunk


def pairing_token(api_base: str, session_id: str, tls: ssl.SSLContext | None) -> str:
    request = urllib.request.Request(
        f"{api_base.rstrip('/')}/api/sessions/{session_id}/pairing-token",
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=20, context=tls) as response:
        return str(json.load(response)["token"])


def send_audio(
    url: str,
    path: Path,
    tls: ssl.SSLContext | None,
    frame_bytes: int = 8_000,
) -> dict[str, object]:
    pcm = audio_chunk(path).pcm
    with connect(url, ssl=tls, open_timeout=20, close_timeout=5) as socket:
        for offset in range(0, len(pcm), frame_bytes):
            socket.send(pcm[offset : offset + frame_bytes])
        return json.loads(socket.recv(timeout=30))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("first_audio", type=Path)
    parser.add_argument("reconnect_audio", type=Path)
    parser.add_argument("--api-base", default="http://127.0.0.1:8000")
    parser.add_argument("--ws-base", default="ws://127.0.0.1:8000")
    parser.add_argument("--insecure-local-tls", action="store_true")
    args = parser.parse_args()

    session_id = "relay-smoke"
    tls = ssl._create_unverified_context() if args.insecure_local_tls else None
    token = pairing_token(args.api_base, session_id, tls)
    url = f"{args.ws_base.rstrip('/')}/ws/audio/pair/{token}"
    initial = send_audio(url, args.first_audio, tls)
    reconnected = send_audio(url, args.reconnect_audio, tls)

    with connect(url, ssl=tls, open_timeout=20, close_timeout=5) as socket:
        socket.send(json.dumps({"type": "relay_control", "action": "stop"}))
        try:
            socket.recv(timeout=10)
        except ConnectionClosed as closed:
            if closed.code != 1000:
                raise RuntimeError(f"unexpected intentional-stop code: {closed.code}") from closed

    revoked_code: int | None = None
    with connect(url, ssl=tls, open_timeout=20, close_timeout=5) as socket:
        try:
            socket.recv(timeout=10)
        except ConnectionClosed as closed:
            revoked_code = closed.code
    if revoked_code != 1008:
        raise RuntimeError(f"revoked pairing token was not rejected: {revoked_code}")

    print(
        json.dumps(
            {
                "initial_probability": initial.get("fake_probability"),
                "initial_alert": initial.get("alert_level"),
                "reconnect_probability": reconnected.get("fake_probability"),
                "reconnect_alert": reconnected.get("alert_level"),
                "model_kind": initial.get("model_kind"),
                "intentional_stop_code": 1000,
                "revoked_reuse_code": revoked_code,
            }
        )
    )


if __name__ == "__main__":
    main()
