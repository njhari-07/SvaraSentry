# Mobile phone relay module handoff

## Purpose

Turn a phone into a secure live microphone for a SvaraSentry session while the
main dashboard remains open on a laptop or operator workstation.

The phone does not run the deepfake model. It captures audio, converts it to the
runtime format, and sends it to the server. The server analyzes the audio and
broadcasts results to the matching dashboard.

```text
Phone microphone -> HTTPS phone page -> WSS audio stream -> backend session
                                                       -> model analysis
                                                       -> laptop dashboard
```

## Is it possible now?

The basic path already exists:

- `/phone` serves the mobile relay interface.
- `getUserMedia()` requests microphone access.
- browser audio is downmixed/resampled to 16 kHz;
- samples are converted to mono PCM16;
- `/ws/audio/{session_id}` receives the stream;
- `/ws/dashboard/{session_id}` sends results to dashboard viewers.

For a real phone, the server must be reachable from the phone through a hostname
or IP address. `127.0.0.1` on the phone points to the phone itself, not the laptop.
Mobile microphone access also requires a trusted HTTPS page in normal browser
conditions. The phone and dashboard must join the same session.

## Final user flow

1. Operator opens the dashboard and starts a protected session.
2. Dashboard displays a QR code and short pairing code.
3. Phone scans the QR code and opens a short-lived HTTPS pairing URL.
4. Phone shows the session name and asks the user to confirm microphone sharing.
5. User grants microphone permission and taps **Start relay**.
6. Phone displays live connection, audio level, elapsed time, and network health.
7. Dashboard confirms that the phone source is connected.
8. Results update on the dashboard approximately once per second.
9. Either device can stop the relay; the pairing token then expires.

The QR URL should contain a short-lived pairing token, not a permanent credential
or a freely editable session ID.

## Scope and ownership

Primary files:

```text
frontend/phone_relay.html
frontend/phone_relay.css
frontend/phone_relay.js
frontend/index.html
frontend/dashboard.js
backend/main.py
backend/config.py
tests/test_api.py
tests/test_streaming.py
```

The owner may add focused modules for audio capture, pairing, and session tokens.
They should not edit model architecture, risk calculations, dataset code, or
spectrogram rendering except where an event contract must be coordinated.

## Required work

### 1. Secure remote access

- Serve production traffic through HTTPS and WSS.
- Document a safe development method using a trusted HTTPS hostname or tunnel.
- Never tell users to disable browser security or certificate checks.
- Display a clear blocking message when the page is not a secure context.
- Verify operation on Android Chrome and iOS Safari.

### 2. Session pairing

Replace manually shared session IDs with a controlled pairing flow:

- dashboard requests a short-lived, single-session pairing token;
- backend binds the token to a session and intended audio-source permission;
- dashboard renders a QR/deep link such as `/phone?pair=<opaque-token>`;
- phone exchanges the token for an authorized WebSocket connection;
- token expires after a short time and becomes unusable after pairing or stop;
- invalid, expired, or reused tokens produce understandable errors.

Avoid putting secrets in logs, analytics, page titles, or referrer headers.

### 3. Modern audio capture

- Replace deprecated `ScriptProcessorNode` usage with `AudioWorklet` where browser
  support allows it.
- Provide a tested fallback only when required.
- Request mono audio and handle the actual device sample rate returned by the
  browser.
- Resample with bounded CPU use and convert to little-endian signed PCM16.
- Send frames small enough to remain under the configured WebSocket limit.
- Never play captured microphone audio through the phone speaker.
- Stop tracks, worklets, contexts, timers, and sockets on every exit path.

Output contract:

```text
sample rate: 16,000 Hz
channels: 1
encoding: little-endian signed PCM16
transport: binary WebSocket frames
```

### 4. Connection state machine

Implement explicit states rather than inferring state from a nullable socket:

```text
idle -> requesting_permission -> connecting -> streaming
streaming -> reconnecting -> streaming
any active state -> stopping -> stopped
any state -> actionable_error
```

Display distinct messages for:

- permission denied;
- no microphone found;
- insecure page;
- invalid/expired pairing token;
- session already has an audio source;
- server unavailable;
- network disconnected;
- stream interrupted by backgrounding or device lock.

### 5. Reconnection and backpressure

- Detect WebSocket close/error events.
- Reconnect only while the user still intends to relay.
- Use bounded exponential backoff with jitter.
- Re-authorize the session during reconnect.
- Never buffer audio without a strict memory/time bound.
- Drop stale frames when `bufferedAmount` exceeds the threshold; live analysis is
  more valuable than delivering old audio late.
- Show a degraded-network indicator and dropped-frame count.
- Do not allow simultaneous reconnect loops.

### 6. Mobile lifecycle

- Handle `visibilitychange`, page freeze/resume, audio interruption, and browser
  navigation.
- Request a screen wake lock while streaming when supported.
- Clearly warn that locking the phone may suspend capture on some devices.
- Release the wake lock on stop.
- Recover cleanly after a phone call, route change, Bluetooth disconnect, or
  permission change when the browser exposes those events.
- Keep controls usable with safe-area insets and one-handed portrait layouts.

### 7. Relay user interface

Show:

- paired session identity;
- microphone permission state;
- live input-level meter;
- connection quality/state;
- elapsed relay time;
- whether dashboard acknowledgement has been received;
- large start/stop control;
- privacy statement explaining where audio goes and whether it is retained;
- troubleshooting guidance without exposing technical stack traces.

Do not show a “secure” label merely because a socket opened. Only use that label
when HTTPS/WSS, authentication, and session authorization have been verified.

### 8. Backend lifecycle and security

- Authenticate both dashboard and phone clients.
- Authorize each client for one session and role.
- Validate WebSocket origin where applicable.
- Use opaque, high-entropy session identifiers.
- Enforce token expiry and one-source-per-session rules server-side.
- Apply rate, connection, frame-size, and session-duration limits.
- Broadcast source-connected, source-disconnected, and source-health events.
- Avoid storing raw audio unless a separately authorized retention feature exists.
- Record security-relevant metadata without recording pairing secrets.

## Event contract additions

Suggested source-status event:

```json
{
  "type": "source_status",
  "session_id": "opaque-session-id",
  "source": "phone",
  "state": "streaming",
  "connected_at": 1730000000.0,
  "audio_level_dbfs": -24.2,
  "dropped_frames": 0,
  "network_state": "healthy"
}
```

Keep operational source health separate from model inference results.

## Tests

At minimum, test:

1. valid pairing token joins only its bound session;
2. invalid, expired, and reused tokens are rejected;
3. second audio source is rejected without interrupting the first;
4. microphone denial produces an actionable UI state;
5. output PCM is mono, 16 kHz, correctly bounded, and correctly encoded;
6. no frame exceeds the backend limit;
7. high `bufferedAmount` drops stale frames without growing memory;
8. reconnect uses one bounded backoff loop and stops after user cancellation;
9. stop releases tracks, worklet/context, wake lock, timers, and socket;
10. dashboard receives connect, health, disconnect, and result events;
11. refresh/background/resume behavior is safe and understandable;
12. Android Chrome and iOS Safari complete a real device-to-dashboard test;
13. no raw audio or pairing secret appears in application logs;
14. accessibility checks cover focus, labels, contrast, and reduced motion.

## Definition of done

- Phone joins a laptop dashboard by QR code or controlled pairing link.
- Real devices work through a trusted HTTPS deployment.
- Audio reaches the intended session and produces continuous dashboard results.
- Authentication, authorization, expiry, and one-source rules are server-enforced.
- Capture uses `AudioWorklet` or a documented compatible fallback.
- Reconnection, backpressure, screen lifecycle, and cleanup are bounded and tested.
- The phone clearly communicates microphone, network, pairing, and privacy state.
- Android Chrome and iOS Safari evidence is recorded in a device test matrix.
- No model, dataset, or spectrogram work is mixed into this module.
