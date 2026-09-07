"use client";
/* eslint-disable @next/next/no-img-element -- the live spectrogram is a transient base64 payload. */

import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";

import { delay, floatToPcm16, resample } from "@/lib/audio";
import { apiUrl, publicUrl, requestJson, websocketUrl } from "@/lib/api";
import type { AlertLevel, AnalysisResult, DashboardMessage, RuntimeConfig } from "@/lib/types";

type EventItem = { level: AlertLevel; title: string; copy: string; time: string };
type TrendPoint = { raw: number; risk: number };

const DEFAULT_CONFIG: RuntimeConfig = {
  sample_rate: 16_000,
  window_seconds: 3,
  stride_seconds: 1,
  model_kind: "loading",
  model_mode: "baseline",
  baseline_disclaimer: false,
};

const decisions: Record<AlertLevel, [string, string, string, string]> = {
  none: [
    "Voice appears consistent",
    "The current signal remains below the caution threshold.",
    "No action needed",
    "Continue the call, but stay alert to unusual requests.",
  ],
  caution: [
    "Verification recommended",
    "Pause sensitive actions and verify the caller with a known detail.",
    "Verify before acting",
    "Ask a question only the real caller should know. Do not share credentials or transfer funds.",
  ],
  high: [
    "Possible synthetic voice",
    "End the call and verify identity through a trusted channel.",
    "Stop and verify",
    "End the call. Contact the person through a saved number or another trusted channel.",
  ],
};

function friendlyModel(model: string) {
  return model === "integration-baseline" ? "Demo baseline" : model.replaceAll("-", " ");
}

function Clock() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function Dashboard() {
  const [config, setConfig] = useState<RuntimeConfig>(DEFAULT_CONFIG);
  const [sessionId, setSessionId] = useState("demo-1");
  const [sessionInput, setSessionInput] = useState("demo-1");
  const [connection, setConnection] = useState<"connecting" | "online" | "offline">("connecting");
  const [sourceStatus, setSourceStatus] = useState("Audio stays in this session and is not saved by the server.");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [voiceEnrolled, setVoiceEnrolled] = useState(false);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [enrollStatus, setEnrollStatus] = useState("");
  const [pairingUrl, setPairingUrl] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);

  const monitorSocket = useRef<WebSocket | null>(null);
  const audioSocket = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const processor = useRef<ScriptProcessorNode | null>(null);
  const lastLevel = useRef<AlertLevel | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeSourceRef = useRef<"microphone" | "file" | "phone" | null>(null);

  function setActiveSource(source: "microphone" | "file" | "phone" | null) {
    activeSourceRef.current = source;
  }

  const level: AlertLevel = result?.alert_level ?? "none";
  const decision = result ? decisions[level] : ["Ready to monitor", "Choose a microphone or audio file to begin a session.", "No action needed", "Begin monitoring when a call starts."];
  const riskPercent = result ? Math.round(Math.max(0, Math.min(1, result.smoothed_risk)) * 100) : null;

  function resetDisplay() {
    setResult(null);
    setTrend([]);
    setEvents([]);
    lastLevel.current = null;
  }

  function recordResult(next: AnalysisResult) {
    setResult(next);
    setVoiceEnrolled(next.voice_enrolled);
    setTrend((current) => [...current.slice(-119), { raw: next.risk_score, risk: next.smoothed_risk }]);
    if (lastLevel.current !== next.alert_level) {
      const [, copy] = decisions[next.alert_level];
      const title = next.alert_level === "none" ? "Low risk" : next.alert_level === "caution" ? "Caution" : "High risk";
      setEvents((current) => [{ level: next.alert_level, title, copy, time: Clock() }, ...current].slice(0, 30));
      lastLevel.current = next.alert_level;
    }
  }

  useEffect(() => {
    let cancelled = false;
    const connect = () => {
      if (cancelled) return;
      setConnection("connecting");
      const socket = new WebSocket(websocketUrl(`/ws/dashboard/${encodeURIComponent(sessionId)}`));
      monitorSocket.current = socket;
      socket.onopen = () => {
        setConnection("online");
        socket.send("ping");
      };
      socket.onmessage = ({ data }) => {
        const message = JSON.parse(data) as DashboardMessage;
        if (message.type === "result") recordResult(message as AnalysisResult);
        if (message.type === "snapshot") {
          setVoiceEnrolled(Boolean(message.voice_enrolled));
          if (message.latest) recordResult(message.latest);
        }
        if (message.type === "source" && message.connected === false && activeSourceRef.current === "phone") {
          activeSourceRef.current = null;
          setActiveSource(null);
          setIsStreaming(false);
          setSourceStatus("Phone relay disconnected.");
        }
        if (message.type === "source_status" && message.source === "phone" && message.state === "streaming") {
          const network = message.network_state === "degraded" ? " · degraded network" : "";
          const dropped = message.dropped_frames ? ` · ${message.dropped_frames} frames dropped` : "";
          setPairingUrl(null);
          activeSourceRef.current = "phone";
          setActiveSource("phone");
          setIsStreaming(true);
          setSourceStatus(`Phone connected${network}${dropped}`);
        }
      };
      socket.onclose = () => {
        if (cancelled) return;
        setConnection("offline");
        reconnectTimer.current = setTimeout(connect, 1800);
      };
      socket.onerror = () => socket.close();
    };
    void requestJson<RuntimeConfig>("/api/config").then(setConfig).catch((error: Error) => {
      if (!cancelled) setSourceStatus(error.message);
    });
    connect();
    return () => {
      cancelled = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      monitorSocket.current?.close();
    };
  }, [sessionId]);

  async function stopAudio(updateStatus = true) {
    activeSourceRef.current = null;
    setActiveSource(null);
    setIsStreaming(false);
    processor.current?.disconnect();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    if (audioContext.current && audioContext.current.state !== "closed") await audioContext.current.close();
    audioSocket.current?.close();
    processor.current = null;
    streamRef.current = null;
    audioContext.current = null;
    audioSocket.current = null;
    if (updateStatus) setSourceStatus("Audio stream stopped.");
  }

  // The cleanup must run only when the dashboard unmounts, not after each stream-state update.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => { void stopAudio(false); }, []);

  async function openAudioSocket() {
    if (audioSocket.current?.readyState === WebSocket.OPEN) return audioSocket.current;
    const socket = new WebSocket(websocketUrl(`/ws/audio/${encodeURIComponent(sessionId)}`));
    socket.binaryType = "arraybuffer";
    socket.onmessage = ({ data }) => {
      const message = JSON.parse(data) as DashboardMessage;
      if (message.type === "error") setSourceStatus(message.message ?? "Audio stream error");
    };
    await new Promise<void>((resolve, reject) => {
      socket.onopen = () => resolve();
      socket.onerror = () => reject(new Error("Could not open the audio stream"));
    });
    audioSocket.current = socket;
    return socket;
  }

  async function startMicrophone() {
    try {
      await stopAudio(false);
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
        video: false,
      });
      streamRef.current = stream;
      const socket = await openAudioSocket();
      const context = new AudioContext();
      audioContext.current = context;
      const source = context.createMediaStreamSource(stream);
      const scriptProcessor = context.createScriptProcessor(4096, 1, 1);
      const silent = context.createGain();
      silent.gain.value = 0;
      scriptProcessor.onaudioprocess = ({ inputBuffer }) => {
        if (socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > config.sample_rate * 8) return;
        const pcm = floatToPcm16(resample(inputBuffer.getChannelData(0), context.sampleRate, config.sample_rate));
        socket.send(pcm);
      };
      source.connect(scriptProcessor);
      scriptProcessor.connect(silent);
      silent.connect(context.destination);
      processor.current = scriptProcessor;
      activeSourceRef.current = "microphone";
      setActiveSource("microphone");
      setIsStreaming(true);
      setSourceStatus("Microphone live · first score arrives after 3 seconds");
    } catch (error) {
      setSourceStatus(error instanceof Error ? error.message : "Could not start microphone");
      await stopAudio(false);
    }
  }

  async function streamFile(file: File) {
    try {
      await stopAudio(false);
      const decodeContext = new AudioContext();
      const decoded = await decodeContext.decodeAudioData(await file.arrayBuffer());
      await decodeContext.close();
      const samples = resample(decoded.getChannelData(0), decoded.sampleRate, config.sample_rate);
      if (samples.length < config.sample_rate * config.window_seconds) throw new Error(`Audio must be at least ${config.window_seconds} seconds`);
      const socket = await openAudioSocket();
      setActiveSource("file");
      activeSourceRef.current = "file";
      setIsStreaming(true);
      const frameSamples = Math.round(config.sample_rate * 0.25);
      for (let offset = 0; offset < samples.length; offset += frameSamples) {
        if (activeSourceRef.current !== "file" && offset > 0) break;
        socket.send(floatToPcm16(samples.subarray(offset, offset + frameSamples)));
        setSourceStatus(`${file.name} · ${Math.min(100, Math.round((offset + frameSamples) / samples.length * 100))}% streamed`);
        await delay(250);
      }
      setSourceStatus(`${file.name} · analysis complete`);
      await stopAudio(false);
    } catch (error) {
      setSourceStatus(error instanceof Error ? error.message : "Could not analyze file");
      await stopAudio(false);
    }
  }

  async function changeSession() {
    const next = sessionInput.trim() || "demo-1";
    await stopAudio(false);
    resetDisplay();
    setSessionId(next);
    setSessionInput(next);
  }

  async function resetSession() {
    await stopAudio(false);
    await requestJson(`/api/sessions/${encodeURIComponent(sessionId)}/reset`, { method: "POST" });
    resetDisplay();
  }

  async function enroll(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const form = new FormData();
    form.append("audio", file);
    setEnrollStatus("Creating the voice reference…");
    try {
      const response = await fetch(apiUrl(`/api/sessions/${encodeURIComponent(sessionId)}/enrollment`), { method: "POST", body: form });
      const body = await response.json() as { detail?: string; duration_seconds?: number };
      if (!response.ok) throw new Error(body.detail ?? "Enrollment failed");
      setVoiceEnrolled(true);
      setEnrollStatus(`Voice enrolled from ${body.duration_seconds}s of audio.`);
      setEvents((current) => [{ level: "none", title: "Trusted voice enrolled", copy: "Future windows will include an identity similarity signal.", time: Clock() }, ...current]);
    } catch (error) {
      setEnrollStatus(error instanceof Error ? error.message : "Enrollment failed");
    }
  }

  async function removeEnrollment() {
    await requestJson(`/api/sessions/${encodeURIComponent(sessionId)}/enrollment`, { method: "DELETE" });
    setVoiceEnrolled(false);
    setEnrollStatus("Voice reference removed.");
  }

  async function openPairing() {
    try {
      const response = await requestJson<{ token: string }>(`/api/sessions/${encodeURIComponent(sessionId)}/pairing-token`, { method: "POST" });
      setPairingUrl(publicUrl(`/phone?pair=${encodeURIComponent(response.token)}`));
    } catch (error) {
      setSourceStatus(error instanceof Error ? error.message : "Could not generate pairing link");
    }
  }

  return (
    <main className="shell">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="SvaraSentry home"><span className="brand-mark" aria-hidden>|||</span><span>Svara<span>Sentry</span></span></Link>
        <div className="topbar-actions">
          <label className="session-field"><span>SESSION</span><input value={sessionInput} maxLength={80} onChange={(event) => setSessionInput(event.target.value)} onBlur={() => void changeSession()} /></label>
          <span className={`connection ${connection}`}><i />{connection === "online" ? "Connected" : connection === "connecting" ? "Connecting" : "Reconnecting"}</span>
        </div>
      </header>

      {config.baseline_disclaimer && <section className="mode-banner"><b>Integration mode.</b> Scores are simulated until a trained checkpoint is loaded.</section>}

      <section className="decision-panel">
        <div className="decision-copy">
          <span className="section-kicker"><i className={result ? "live-dot" : ""} />LIVE ANALYSIS</span>
          <h1>{decision[0]}</h1><p>{decision[1]}</p>
          <div className="source-actions">
            {!isStreaming && <button className="button primary" type="button" onClick={() => void startMicrophone()}>Start microphone</button>}
            {!isStreaming && <label className="button secondary">Analyze a file<input type="file" accept="audio/*,.wav,.flac,.mp3,.m4a,.ogg" onChange={(event) => { const file = event.target.files?.[0]; if (file) void streamFile(file); event.target.value = ""; }} /></label>}
            {!isStreaming && <button className="button secondary" type="button" onClick={() => void openPairing()}>Connect phone</button>}
            {isStreaming && <button className="button danger" type="button" onClick={() => void stopAudio()}>Stop stream</button>}
          </div>
          <p className="source-status" role="status">{sourceStatus}</p>
        </div>
        <div className="score-wrap">
          <div className="gauge" style={{ "--risk": riskPercent ?? 0 } as CSSProperties}><div className="gauge-inner"><strong>{riskPercent ?? "—"}</strong>{riskPercent !== null && <span>%</span>}<small>CLONE RISK</small></div></div>
          <span className={`risk-badge ${result ? level : "neutral"}`}>{result ? (level === "none" ? "Low risk" : level) : "Waiting"}</span>
        </div>
      </section>

      <section className="metric-grid" aria-label="Session metrics">
        <Metric label="Detection engine" value={friendlyModel(config.model_kind)} detail={config.model_mode === "baseline" ? "Pipeline validation" : "Checkpoint loaded"} />
        <Metric label="Signal quality" value={result?.signal?.state ?? "No signal"} detail={result?.signal ? `${result.signal.rms_dbfs} dBFS · peak ${Math.round(result.signal.peak * 100)}%` : "— dBFS"} />
        <Metric label="Processing" value={result ? `${Math.round(result.processing_ms)} ms` : "— ms"} detail={`${result?.chunk_index ?? 0} windows analyzed`} />
        <Metric label="Voice identity" value={!voiceEnrolled ? "Not enrolled" : result?.identity_match == null ? "Enrolled" : `${Math.round(result.identity_match * 100)}% match`} detail={!voiceEnrolled ? "Optional second signal" : "Compared with reference"} action="Enroll" onAction={() => setEnrollOpen(true)} />
      </section>

      <section className="analysis-grid">
        <article className="panel"><PanelTitle kicker="ACOUSTIC VIEW" title="Spectrogram" /><div className="spectrogram-frame">
          {result?.spectrogram_png_b64 ? <img src={`data:image/png;base64,${result.spectrogram_png_b64}`} alt="Live audio spectrogram" /> : <p className="empty-state">Spectrogram appears after the first three-second window.</p>}
          {result?.flagged_region?.time_offset_ms && <span className="attention-region" style={{ left: `${result.flagged_region.time_offset_ms[0] / ((result.spectrogram?.window_seconds ?? 3) * 10)}%`, width: `${(result.flagged_region.time_offset_ms[1] - result.flagged_region.time_offset_ms[0]) / ((result.spectrogram?.window_seconds ?? 3) * 10)}%` }} />}
        </div>
        <div className="acoustic-props">{Object.entries(result?.acoustic_features ?? {}).slice(0, 5).map(([key, value]) => <span key={key}><b>{key.replaceAll("_", " ")}</b>{String(value)}</span>)}</div></article>
        <article className="panel"><PanelTitle kicker="SESSION TREND" title="Risk timeline" right={`${result?.chunk_index ?? 0} windows`} /><RiskChart points={trend} /></article>
      </section>

      <section className="bottom-grid">
        <article className="panel"><PanelTitle kicker="AUDIT TRAIL" title="Session events" action="Reset session" onAction={() => void resetSession()} />
          <ol className="event-list">{events.length ? events.map((event, index) => <li key={`${event.time}-${index}`} className={event.level}><i /><div><strong>{event.title}</strong><p>{event.copy}</p></div><time>{event.time}</time></li>) : <li className="empty-event"><i /><div><strong>No events yet</strong><p>Risk transitions and identity checks will appear here.</p></div></li>}</ol>
        </article>
        <aside className={`response-card ${level}`}><span>{level === "none" ? "✓" : level === "caution" ? "!" : "×"}</span><div><small>RECOMMENDED RESPONSE</small><h2>{decision[2]}</h2><p>{decision[3]}</p></div></aside>
      </section>
      <footer><span>SvaraSentry</span><span>{config.sample_rate / 1000} kHz · {config.window_seconds}s window · {config.stride_seconds}s stride</span><Link href="/phone">Phone relay</Link><a href={apiUrl("/docs")} target="_blank" rel="noreferrer">API docs</a></footer>

      {enrollOpen && <Modal title="Enroll a trusted voice" onClose={() => setEnrollOpen(false)}><p>Upload at least two seconds of clean WAV or FLAC speech. The reference remains in memory for this session only.</p><label className="dropzone">Choose reference audio<input type="file" accept="audio/wav,audio/flac,.wav,.flac" onChange={enroll} /></label><p role="status">{enrollStatus}</p><div className="modal-actions"><button className="button ghost" type="button" onClick={() => void removeEnrollment()}>Remove enrollment</button><button className="button secondary" type="button" onClick={() => setEnrollOpen(false)}>Done</button></div></Modal>}
      {pairingUrl && <Modal title="Connect phone relay" onClose={() => setPairingUrl(null)}><p>Scan this QR code with your phone. The pairing link expires in two minutes.</p><div className="qr"><QRCodeSVG value={pairingUrl} size={200} level="H" /></div><a className="pair-link" href={pairingUrl}>{pairingUrl}</a></Modal>}
    </main>
  );
}

function Metric({ label, value, detail, action, onAction }: { label: string; value: string; detail: string; action?: string; onAction?: () => void }) {
  return <article className="metric"><div><small>{label}</small><strong>{value}</strong><span>{detail}</span></div>{action && <button className="text-button" type="button" onClick={onAction}>{action}</button>}</article>;
}

function PanelTitle({ kicker, title, right, action, onAction }: { kicker: string; title: string; right?: string; action?: string; onAction?: () => void }) {
  return <header className="panel-head"><div><small>{kicker}</small><h2>{title}</h2></div>{right && <span className="compact-stat">{right}</span>}{action && <button className="text-button" type="button" onClick={onAction}>{action}</button>}</header>;
}

function RiskChart({ points }: { points: TrendPoint[] }) {
  if (points.length < 2) return <div className="chart-empty">Risk history appears here</div>;
  const path = points.map((point, index) => `${index ? "L" : "M"}${(index / (points.length - 1)) * 100},${100 - point.risk * 100}`).join(" ");
  return <svg className="risk-chart" viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Risk score timeline"><line x1="0" x2="100" y1="25" y2="25" /><line x1="0" x2="100" y1="45" y2="45" /><path d={path} /></svg>;
}

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return <div className="modal-backdrop" role="presentation"><section className="modal" role="dialog" aria-modal="true" aria-label={title}><button className="modal-close" type="button" onClick={onClose} aria-label="Close">×</button><h2>{title}</h2>{children}</section></div>;
}
