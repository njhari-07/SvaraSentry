# SvaraSentry

SvaraSentry is a Dockerized, real-time voice-authenticity monitoring application.
It accepts microphone or file audio, analyzes overlapping windows, and streams
risk, signal, spectrogram, identity, and latency updates to an operational dashboard.

## Current status

- responsive live dashboard with microphone and browser-decoded file input
- 16 kHz mono PCM transport with 3-second windows and 1-second stride
- session-scoped WebSocket fan-out and source collision protection
- generated spectrograms, signal quality, processing latency, and risk history
- EMA risk smoothing with low, caution, and high response guidance
- optional in-memory voice enrollment and similarity contribution
- bounded frame/session resources and inactive-session expiry
- lazy checkpoint loading in a separate ML Docker target
- dataset manifest builder for real and generated WAV/FLAC files

The default score is **not a trained clone detector**. It is visibly labelled
as integration mode and exists so every other subsystem can be exercised before
the trained checkpoint arrives. See [the model handoff](docs/model-handoff.md).

## Run with Docker

Docker is the canonical development environment:

```bash
make up
```

Open <http://127.0.0.1:8000>. The dashboard can stream a WAV file through the
backend or capture a microphone. Source directories are bind-mounted and the
server reloads during development.

Useful commands:

```bash
make test
make lint
make logs
make down
make prod-up    # hardened, immutable baseline container
```

The default image deliberately excludes PyTorch and runs the clearly labelled
integration baseline. When a compatible checkpoint exists at
`training/checkpoints/model.pt`, run `make ml-up` to use the ML image.

Configuration defaults are documented in `.env.example`. Copy them into `.env`
to tune thresholds or resource bounds, and reference those variables from
`compose.yaml` when changing a deployment.

## Application flow

1. The browser resamples microphone or decoded file audio to 16 kHz mono PCM.
2. `/ws/audio/{session_id}` buffers arbitrary frames and emits overlapping windows.
3. The selected inference engine produces fake probability, embedding, and attention.
4. The risk engine combines model probability with optional identity mismatch.
5. `/ws/dashboard/{session_id}` broadcasts results to every viewer of that session.

Audio frames and enrollment embeddings are held in memory only. This milestone
does not persist calls, accounts, or audit history.

The phone relay is available at <http://127.0.0.1:8000/phone>. Mobile browsers
require a trusted HTTPS origin before granting microphone access, so expose this
route through your HTTPS demo hostname or tunnel for phone testing. Treat the
current app as a trusted-network demo until authentication is added.

## Build a dataset manifest

```bash
python -m data_pipeline.build_manifest \
  --real data/team_recordings \
  --fake data/sarvam_generated \
  --output data/dataset_manifest.csv
```

Optional metadata may be encoded in filenames as
`speaker__language__anything.wav`; otherwise `unknown` is used.

## Input contract

Send little-endian signed 16-bit mono PCM frames to `/ws/audio/{session_id}`.
Keep frames at or below 64 KB. Results are returned to the source and broadcast:

```json
{
  "type": "result",
  "session_id": "demo-1",
  "chunk_index": 4,
  "timestamp": 3.0,
  "risk_score": 0.42,
  "smoothed_risk": 0.37,
  "alert_level": "none",
  "spectrogram_png_b64": "...",
  "flagged_region": null,
  "identity_match": null,
  "voice_enrolled": false,
  "model_kind": "integration-baseline",
  "signal": {"rms_dbfs": -22.1, "peak": 0.41, "zero_crossing_rate": 0.08, "state": "speech"},
  "processing_ms": 18.4
}
```

REST endpoints are documented interactively at <http://127.0.0.1:8000/docs>.

## Verification

```bash
make test   # API, WebSocket, streaming, risk, enrollment, spectrogram
make lint   # Python static checks
```

The current suite contains 15 tests and runs inside the development image.
