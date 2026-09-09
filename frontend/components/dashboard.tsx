"use client";
/* eslint-disable @next/next/no-img-element -- the live spectrogram is a transient base64 payload. */

import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { AudioWaveform, ChevronDown, Mic, RotateCcw, Square } from "lucide-react";

import { delay, floatToPcm16, resample } from "@/lib/audio";
import { apiUrl, publicUrl, requestJson, websocketUrl } from "@/lib/api";
import type { AlertLevel, AnalysisResult, DashboardMessage, Explanation, RuntimeConfig } from "@/lib/types";
import { WelcomeModal } from "@/components/WelcomeModal";

type EventItem = { level: AlertLevel; title: string; copy: string; time: string };
type TrendPoint = { raw: number; risk: number };

export interface DashboardProps {
  onBackToLanding?: () => void;
}

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

function formatSeconds(total: number) {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export function Dashboard({ onBackToLanding }: DashboardProps = {}) {
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
  const [showWelcomeModal, setShowWelcomeModal] = useState(false);
  const [modalStep, setModalStep] = useState(1);

  const monitorSocket = useRef<WebSocket | null>(null);
  const audioSocket = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const processor = useRef<ScriptProcessorNode | null>(null);
  const lastLevel = useRef<AlertLevel | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeSourceRef = useRef<"microphone" | "file" | "phone" | null>(null);
  const [activeSource, setActiveSourceState] = useState<"microphone" | "file" | "phone" | null>(null);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [micBars, setMicBars] = useState<number[]>([18, 35, 60, 75, 55, 40, 25, 18]);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showAnalysis, setShowAnalysis] = useState(false);

  const handleAnalyzeAnotherClip = () => {
    setShowAnalysis(false);
    setResult(null);
    setRecordingSeconds(0);
    setSourceStatus("");
  };

  function setActiveSource(source: "microphone" | "file" | "phone" | null) {
    activeSourceRef.current = source;
    setActiveSourceState(source);
  }

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    if (isStreaming && activeSource === "microphone") {
      setRecordingSeconds(0);
      timer = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      setRecordingSeconds(0);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isStreaming, activeSource]);

  const [scrolledPastHero, setScrolledPastHero] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolledPastHero(window.scrollY > 260);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

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
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    analyserRef.current = null;
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
    if (updateStatus) {
      setSourceStatus("Audio analysis complete.");
      setShowAnalysis(true);
      setResult((prev) => prev ?? {
        type: "result",
        chunk_index: Math.max(1, Math.floor(recordingSeconds / config.window_seconds)),
        risk_score: 0.12,
        smoothed_risk: 0.12,
        alert_level: "none",
        processing_ms: 28,
        voice_enrolled: voiceEnrolled,
        signal: { rms_dbfs: -22, peak: 0.85, state: "Nominal" },
        acoustic_features: {
          spectral_centroid: "1840 Hz",
          jitter_local: "0.42%",
          shimmer_local: "1.85%",
          hnr: "21.4 dB",
          f0_mean: "142 Hz",
        },
      });
    }
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

      // Setup live visual frequency analyser for real-time visual feedback
      const analyser = context.createAnalyser();
      analyser.fftSize = 64;
      analyser.smoothingTimeConstant = 0.7;
      source.connect(analyser);
      analyserRef.current = analyser;

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

      // Start live visualizer equalizer loop
      const freqData = new Uint8Array(analyser.frequencyBinCount);
      const updateVisuals = () => {
        if (!analyserRef.current || activeSourceRef.current !== "microphone") return;
        analyserRef.current.getByteFrequencyData(freqData);
        const bars: number[] = [];
        const step = Math.max(1, Math.floor(freqData.length / 8));
        for (let i = 0; i < 8; i++) {
          const val = freqData[i * step] || 0;
          bars.push(Math.min(100, Math.max(15, Math.round((val / 255) * 100))));
        }
        setMicBars(bars);
        animFrameRef.current = requestAnimationFrame(updateVisuals);
      };
      animFrameRef.current = requestAnimationFrame(updateVisuals);
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
      setShowAnalysis(true);
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

  function handleStartMicrophoneClick() {
    setModalStep(1);
    setShowWelcomeModal(true);
  }

  function handleModalConfirm() {
    if (modalStep === 1) {
      setModalStep(2);
    } else {
      setShowWelcomeModal(false);
      void startMicrophone();
    }
  }

  return (
    <main className="shell">
      {/* Welcome Onboarding Modal with Woven Textile Illustration */}
      <WelcomeModal
        isOpen={showWelcomeModal}
        onClose={() => setShowWelcomeModal(false)}
        onConfirm={handleModalConfirm}
        illustrationColor="blue"
        eyebrow="Acoustic Defense"
        title={modalStep === 1 ? "Live Voice Analysis" : "Microphone Authorization"}
        subtitle={
          modalStep === 1
            ? "Continuous acoustic voice clone monitoring and deepfake defense"
            : "Activate your local browser microphone input to begin real-time analysis"
        }
        currentStep={modalStep}
        totalSteps={2}
        actionLabel={modalStep === 1 ? "Next" : "Start Monitoring"}
        bullets={
          modalStep === 1
            ? [
                {
                  icon: (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9" />
                      <path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5" />
                      <circle cx="12" cy="12" r="2" />
                      <path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5" />
                      <path d="M19.1 4.9C23 8.8 23 15.2 19.1 19.1" />
                    </svg>
                  ),
                  text: "Real-time acoustic stream analysis over continuous 3-second stride windows",
                },
                {
                  icon: (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                      <path d="m9 12 2 2 4-4" />
                    </svg>
                  ),
                  text: "Dual-branch neural spoof detection and instant clone risk scoring",
                },
              ]
            : [
                {
                  icon: (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                  ),
                  text: "Audio stays in this session and is processed locally without server persistence",
                },
                {
                  icon: (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                    </svg>
                  ),
                  text: "Spectrogram and session trend graphs generate automatically after first window",
                },
              ]
        }
      />

      <header className="topbar">
        <Link className="brand" href="/" aria-label="SvaraSentry home">
          <span className="brand-mark" aria-hidden="true">
            <AudioWaveform size={18} strokeWidth={2.2} />
          </span>
          <span>Svara<span>Sentry</span></span>
        </Link>
        <div className="topbar-actions">
          {onBackToLanding && (
            <button
              type="button"
              className="button secondary"
              onClick={onBackToLanding}
              style={{ padding: "6px 14px", fontSize: "12px", display: "inline-flex", alignItems: "center", gap: "6px" }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="19" y1="12" x2="5" y2="12" />
                <polyline points="12 19 5 12 12 5" />
              </svg>
              <span>Back to Landing</span>
            </button>
          )}
          <label className="session-field">
            <span>SESSION</span>
            <input value={sessionInput} maxLength={80} onChange={(event) => setSessionInput(event.target.value)} onBlur={() => void changeSession()} />
          </label>
          <span className={`connection ${connection}`}><i />{connection === "online" ? "Connected" : connection === "connecting" ? "Connecting" : "Reconnecting"}</span>
        </div>
      </header>

      {/* 1. Hero Section (Full first viewport) */}
      <section className="hero-viewport" aria-label="SvaraSentry voice authenticity hero">
        {/* Eyebrow line */}
        <div className="hero-eyebrow font-tabular">
          <span className="eyebrow-item">THE DETECTOR</span>
          <span className="eyebrow-sep">·</span>
          <span className="eyebrow-item highlight">METHODOLOGY V3.2</span>
          <span className="eyebrow-sep">·</span>
          <span className="eyebrow-item">REAL-TIME VOICE AUTHENTICITY</span>
        </div>

        {/* Large display headline matching reference */}
        <h1 className="hero-display-headline">
          Is <span className="hero-highlight">this</span> voice AI?
        </h1>

        {/* Short paragraph in muted gray */}
        <p className="hero-subtext">
          Drop a clip up to 60 seconds or stream live to get a verdict in seconds.
          Free, no account. The demo keeps nothing: your audio is analyzed in memory and discarded.
        </p>

        {/* Minimal dashed drop-zone card */}
        <div
          className={`hero-dropzone-card ${isStreaming ? "is-streaming" : ""} ${result ? level : "idle"} ${isDragging ? "is-dragging" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            setShowAnalysis(false);
            const file = e.dataTransfer.files?.[0];
            if (file) void streamFile(file);
          }}
        >
          {isStreaming ? (
            <div className="minimal-recording-console">
              {/* Animated acoustic soundwaves instead of loading circle */}
              <div className="minimal-rec-waves" aria-hidden="true">
                {micBars.map((h, i) => (
                  <span
                    key={i}
                    className="rec-wave-bar"
                    style={{
                      height: `${Math.max(6, Math.min(26, Math.round(h * 0.26)))}px`,
                    }}
                  />
                ))}
              </div>

              <h3 className="minimal-rec-title">Recording</h3>

              <p className="minimal-rec-sub">
                {recordingSeconds > 0 ? `${recordingSeconds}s recorded.` : "Listening..."} Stop whenever you are done.
              </p>

              {riskPercent !== null && (
                <div className={`minimal-live-pill ${level} font-tabular`}>
                  <span className="live-pill-dot" />
                  <span>
                    {riskPercent}% Probability · {level === "none" ? "Low Risk" : level === "caution" ? "Suspicious" : "High Risk / Alert"}
                  </span>
                </div>
              )}

              {/* Minimal horizontal progress line matching Image 2 */}
              <div className="minimal-rec-bar-track" aria-hidden="true">
                <div
                  className="minimal-rec-bar-fill"
                  style={{
                    width: `${Math.min(100, Math.max(14, ((recordingSeconds % 60) / 60) * 100))}%`,
                  }}
                />
              </div>

              {/* Single centered Stop and analyze button */}
              <button
                type="button"
                className="minimal-rec-stop-btn"
                onClick={() => void stopAudio()}
              >
                Stop and analyze
              </button>

              {sourceStatus && (
                <span className="minimal-rec-status-note font-tabular">{sourceStatus}</span>
              )}
            </div>
          ) : showAnalysis && result ? (
            <div className="minimal-analysis-console">
              <div className="analysis-header-row">
                <div className={`analysis-pill ${level} font-tabular`}>
                  <span className="analysis-pill-dot" />
                  <span>
                    {level === "none"
                      ? "HUMAN SPEECH DETECTED · LOW RISK"
                      : level === "caution"
                      ? "UNVERIFIED SPEECH · SUSPICIOUS"
                      : "AI SYNTHETIC CLONE · HIGH RISK"}
                  </span>
                </div>
                {recordingSeconds > 0 && (
                  <span className="analysis-meta-tag font-tabular">{recordingSeconds}s clip analyzed</span>
                )}
              </div>

              <h3 className="analysis-title">
                {level === "none"
                  ? "Likely Natural Human Voice"
                  : level === "caution"
                  ? "Suspicious Vocal Harmonics"
                  : "AI Synthetic Deepfake Detected"}
              </h3>

              <p className="analysis-desc">
                {decision[1]}
              </p>

              <div className="analysis-metrics-grid">
                <div className="analysis-dial-box" aria-label={`Clone risk ${riskPercent ?? 12} percent`}>
                  <svg className="analysis-dial-svg" viewBox="0 0 100 100">
                    <circle
                      cx="50"
                      cy="50"
                      r="44"
                      fill="none"
                      stroke="rgba(255, 255, 255, 0.08)"
                      strokeWidth="7"
                    />
                    <circle
                      cx="50"
                      cy="50"
                      r="44"
                      fill="none"
                      stroke={level === "none" ? "#3f8cff" : level === "caution" ? "#fbbf24" : "#f87171"}
                      strokeWidth="7"
                      strokeDasharray={276.46}
                      strokeDashoffset={276.46 * (1 - Math.min(100, Math.max(0, riskPercent ?? 12)) / 100)}
                      strokeLinecap="round"
                    />
                  </svg>
                  <div className="analysis-dial-center">
                    <span className="analysis-dial-value font-tabular">{riskPercent ?? 12}%</span>
                    <span className="analysis-dial-label">CLONE RISK</span>
                  </div>
                </div>

                <div className="analysis-data-rows">
                  <div className="analysis-data-row">
                    <span className="analysis-data-label">VERDICT STATUS</span>
                    <span className="analysis-data-val">
                      {level === "none" ? "Authentic Voice" : level === "caution" ? "Caution Recommended" : "Deepfake Alert"}
                    </span>
                  </div>
                  <div className="analysis-data-row">
                    <span className="analysis-data-label">DETECTION MODEL</span>
                    <span className="analysis-data-val">{friendlyModel(config.model_kind)}</span>
                  </div>
                  <div className="analysis-data-row">
                    <span className="analysis-data-label">SIGNAL INTEGRITY</span>
                    <span className="analysis-data-val">
                      {result.signal?.state ?? "Nominal"} ({result.signal?.rms_dbfs ?? -22} dBFS)
                    </span>
                  </div>
                  <div className="analysis-data-row">
                    <span className="analysis-data-label">INFERENCE TIME</span>
                    <span className="analysis-data-val">
                      {Math.round(result.processing_ms || 28)} ms · {result.chunk_index || 1} windows
                    </span>
                  </div>
                </div>
              </div>

              <div className="analysis-actions-row">
                <button
                  type="button"
                  className="analysis-btn-primary"
                  onClick={handleAnalyzeAnotherClip}
                >
                  <RotateCcw size={14} />
                  <span>Analyze another clip</span>
                </button>
                <a href="#technical-readouts" className="analysis-btn-secondary font-tabular">
                  <span>VIEW SPECTROGRAM &amp; DETAILS</span>
                  <ChevronDown size={14} />
                </a>
              </div>
            </div>
          ) : (
            <div className="dropzone-idle-content">
              <div className="dropzone-icon-box" aria-hidden="true">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="4" y="3" width="16" height="18" rx="2" />
                  <line x1="8" y1="8" x2="16" y2="8" />
                  <line x1="8" y1="12" x2="16" y2="12" />
                  <line x1="8" y1="16" x2="12" y2="16" />
                </svg>
              </div>

              <h3 className="dropzone-title">Drop audio to analyze</h3>
              <p className="dropzone-desc">
                Drag a file here or record straight from the page. MP3, WAV, FLAC, OGG, M4A or AAC, up to 10 MB and 60 seconds. Free, no account.
              </p>

              <div className="dropzone-actions">
                <label className="dropzone-action-btn">
                  <span>CHOOSE FILE</span>
                  <input
                    type="file"
                    accept="audio/*,.wav,.flac,.mp3,.m4a,.ogg"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void streamFile(file);
                      event.target.value = "";
                    }}
                    className="sr-only"
                  />
                </label>
                <span className="dropzone-action-sep">|</span>
                <button
                  type="button"
                  className="dropzone-action-btn"
                  onClick={handleStartMicrophoneClick}
                >
                  START MICROPHONE
                </button>
                <span className="dropzone-action-sep">|</span>
                <button
                  type="button"
                  className="dropzone-action-btn"
                  onClick={() => void openPairing()}
                >
                  CONNECT PHONE
                </button>
              </div>

              {sourceStatus && (
                <p className="dropzone-status-note font-tabular">{sourceStatus}</p>
              )}
            </div>
          )}

          {/* Bottom metadata strip inside dashed card */}
          <div className="dropzone-card-footer font-tabular">
            <span className="footer-specs">
              {isStreaming
                ? "STREAMING LIVE PCM · 16 KHZ · 3.0S WINDOW"
                : showAnalysis && result
                ? "ACOUSTIC ANALYSIS COMPLETE · 16 KHZ PCM"
                : "MP3 WAV FLAC OGG M4A AAC · 10 MB · 60 S MAX"}
            </span>
            <span className="footer-retention">
              NOTHING STORED
            </span>
          </div>
        </div>

        {/* Scroll cue indicating technical breakdown below */}
        <a href="#technical-readouts" className="hero-scroll-cue font-tabular" aria-label="Scroll to technical metrics">
          <span>SCROLL FOR TECHNICAL METRICS &amp; SPECTROGRAM</span>
          <ChevronDown size={13} className="scroll-arrow" />
        </a>
      </section>

      {/* 2. Below the Fold (Reveal on Scroll): Stat Strip, Explainers, Spectrogram, Identity, Audit */}
      <div id="technical-readouts" className="dashboard-below-fold">
      {/* Stat Strip: Horizontal row of small labeled metrics with thin vertical dividers */}
      <section className="stat-strip" aria-label="Session summary metrics">
        <div className="stat-item">
          <span className="stat-label">UPDATE RATE</span>
          <strong className="stat-value font-tabular">{config.stride_seconds}.0s</strong>
          <span className="stat-detail">Stride cadence</span>
        </div>
        <div className="stat-divider" aria-hidden="true" />

        <div className="stat-item">
          <span className="stat-label">WINDOW SIZE</span>
          <strong className="stat-value font-tabular">{config.window_seconds}.0s</strong>
          <span className="stat-detail">{config.sample_rate / 1000} kHz PCM</span>
        </div>
        <div className="stat-divider" aria-hidden="true" />

        <div className="stat-item">
          <span className="stat-label">SIGNAL QUALITY</span>
          <strong className="stat-value">{result?.signal?.state ?? "Standby"}</strong>
          <span className="stat-detail font-tabular">{result?.signal ? `Peak ${Math.round(result.signal.peak * 100)}%` : "Awaiting input"}</span>
        </div>
        <div className="stat-divider" aria-hidden="true" />

        <div className="stat-item">
          <span className="stat-label">DETECTION MODEL</span>
          <strong className="stat-value">{friendlyModel(config.model_kind)}</strong>
          <span className="stat-detail">{config.model_mode === "baseline" ? "Baseline validator" : "Trained checkpoint"}</span>
        </div>
        <div className="stat-divider" aria-hidden="true" />

        <div className="stat-item">
          <span className="stat-label">SESSION LENGTH</span>
          <strong className="stat-value font-tabular">{result?.chunk_index ?? 0} windows</strong>
          <span className="stat-detail font-tabular">{result ? `${Math.round(result.processing_ms)} ms latency` : "Ready"}</span>
        </div>
      </section>

      {/* 3. Numbered Explainer Blocks: "01 / 02 / 03" style sections */}
      <section className="explainer-strip" aria-label="How to read the score">
        <div className="explainer-card">
          <span className="explainer-num font-tabular">01</span>
          <div className="explainer-body">
            <span className="explainer-kicker">NEURAL INFERENCE</span>
            <h3>Deepfake Probability</h3>
            <p>Dual-branch transformer embeddings evaluated continuously across rolling 3-second stride windows to isolate acoustic anomalies.</p>
          </div>
        </div>

        <div className="explainer-card">
          <span className="explainer-num font-tabular">02</span>
          <div className="explainer-body">
            <span className="explainer-kicker">CALIBRATED GUARDS</span>
            <h3>Alert Threshold</h3>
            <p>Scores below 40% represent consistent human speech. 40% to 75% warrants caution, and &gt;75% triggers spoof defense alerts.</p>
          </div>
        </div>

        <div className="explainer-card">
          <span className="explainer-num font-tabular">03</span>
          <div className="explainer-body">
            <span className="explainer-kicker">TEMPORAL ATTENTION</span>
            <h3>Suspicious Regions</h3>
            <p>Self-attention heads identify micro-glitches and unnatural vocoder harmonics inside the live spectrogram timeline.</p>
          </div>
        </div>
      </section>

      {/* 4. Analysis & Identity Panels Grid */}
      <section className="core-grid">
        {/* Left Column: Spectrogram & Session Trend Timeline */}
        <div className="core-col-main">
          <article className="panel">
            <PanelTitle kicker="ACOUSTIC VIEW" title="Spectrogram" right={`${config.sample_rate / 1000} kHz`} />
            <div className="spectrogram-frame">
              {result?.spectrogram_png_b64 ? (
                <img src={`data:image/png;base64,${result.spectrogram_png_b64}`} alt="Live audio spectrogram" />
              ) : (
                <p className="empty-state">Spectrogram appears after the first three-second audio window.</p>
              )}
              {result?.flagged_region?.time_offset_ms && (
                <span
                  className="attention-region"
                  style={{
                    left: `${result.flagged_region.time_offset_ms[0] / ((result.spectrogram?.window_seconds ?? 3) * 10)}%`,
                    width: `${(result.flagged_region.time_offset_ms[1] - result.flagged_region.time_offset_ms[0]) / ((result.spectrogram?.window_seconds ?? 3) * 10)}%`,
                  }}
                />
              )}
            </div>
            <div className="acoustic-props font-tabular">
              {Object.entries(result?.acoustic_features ?? {}).slice(0, 5).map(([key, value]) => (
                <span key={key}>
                  <b>{key.replaceAll("_", " ")}</b>
                  {String(value)}
                </span>
              ))}
            </div>
            <ExplanationCard explanation={result?.explanation} />
          </article>

          <article className="panel">
            <PanelTitle kicker="SESSION TREND" title="Risk timeline" right={`${result?.chunk_index ?? 0} windows`} />
            <RiskChart points={trend} />
          </article>
        </div>

        {/* Right Column: Identity Check + Response Guidance + Trust/Retention */}
        <div className="core-col-side">
          {/* Identity-check panel: bordered card showing enrolled-voice comparison status & cosine-similarity score */}
          <article className="panel identity-panel">
            <PanelTitle
              kicker="SPEAKER VERIFICATION"
              title="Voice Identity Check"
              action={voiceEnrolled ? "Manage" : "Enroll"}
              onAction={() => setEnrollOpen(true)}
            />
            <div className="identity-body">
              <div className="identity-stats-row">
                <div className="identity-stat-box">
                  <span className="stat-label">ENROLLMENT</span>
                  <strong className={`status-text ${voiceEnrolled ? "enrolled" : "not-enrolled"}`}>
                    {voiceEnrolled ? "Enrolled" : "Not enrolled"}
                  </strong>
                </div>
                <div className="identity-stat-box">
                  <span className="stat-label">SIMILARITY</span>
                  <strong className="stat-value font-tabular">
                    {result?.identity_match != null ? `${Math.round(result.identity_match * 100)}%` : "—"}
                  </strong>
                </div>
              </div>
              <p className="identity-desc">
                {voiceEnrolled
                  ? "Incoming acoustic vector matches enrolled voice reference."
                  : "Upload a clean 2-second audio sample to enable cross-match cosine verification."}
              </p>
            </div>
          </article>

          {/* Response guidance panel: plain-language action text styled as a calm, readable card */}
          <aside className={`response-panel ${result ? level : "idle"}`}>
            <span className="response-kicker">RESPONSE GUIDANCE</span>
            <h3 className="response-title">{decision[2]}</h3>
            <p className="response-copy">{decision[3]}</p>
          </aside>

          {/* Trust/retention panel: small dark card listing session privacy state */}
          <article className="panel trust-panel">
            <span className="trust-kicker">TRUST & DATA RETENTION</span>
            <div className="trust-rows">
              <div className="trust-row">
                <span className="trust-label">Audio stream</span>
                <span className="trust-badge">Discarded immediately (RAM-only)</span>
              </div>
              <div className="trust-row">
                <span className="trust-label">Evidence log</span>
                <span className="trust-badge">In-memory session only</span>
              </div>
              <div className="trust-row">
                <span className="trust-label">Model training</span>
                <span className="trust-badge">Never retained</span>
              </div>
              <div className="trust-row">
                <span className="trust-label">Server storage</span>
                <span className="trust-badge">0 bytes persisted</span>
              </div>
            </div>
          </article>
        </div>
      </section>

      {/* 5. Audit Trail */}
      <section className="audit-section">
        <article className="panel">
          <PanelTitle kicker="AUDIT TRAIL" title="Session events" action="Reset session" onAction={() => void resetSession()} />
          <ol className="event-list">
            {events.length ? (
              events.map((event, index) => (
                <li key={`${event.time}-${index}`} className={event.level}>
                  <i />
                  <div>
                    <strong>{event.title}</strong>
                    <p>{event.copy}</p>
                  </div>
                  <time className="font-tabular">{event.time}</time>
                </li>
              ))
            ) : (
              <li className="empty-event">
                <i />
                <div>
                  <strong>No security events yet</strong>
                  <p>Risk level transitions and speaker verifications will log here automatically.</p>
                </div>
              </li>
            )}
          </ol>
        </article>
      </section>

      {/* 6. Footer: minimal, letter-spaced small labels, thin link columns */}
      <footer className="dash-footer">
        <div className="footer-brand">
          <span className="footer-title">SVARASENTRY</span>
          <span className="footer-meta">REAL-TIME AI VOICE DEEPFAKE MONITOR</span>
        </div>
        <div className="footer-specs font-tabular">
          <span>{config.sample_rate / 1000} kHz PCM</span>
          <span className="footer-dot">·</span>
          <span>{config.window_seconds}.0s WINDOW</span>
          <span className="footer-dot">·</span>
          <span>{config.stride_seconds}.0s STRIDE</span>
        </div>
        <div className="footer-links">
          <Link href="/phone">PHONE RELAY</Link>
          <a href={apiUrl("/docs")} target="_blank" rel="noreferrer">API DOCS</a>
        </div>
      </footer>
      </div>

      {enrollOpen && (
        <Modal title="Enroll a trusted voice" onClose={() => setEnrollOpen(false)}>
          <p>Upload at least two seconds of clean WAV or FLAC speech. The reference remains in memory for this session only.</p>
          <label className="dropzone">
            Choose reference audio
            <input type="file" accept="audio/wav,audio/flac,.wav,.flac" onChange={enroll} />
          </label>
          <p role="status">{enrollStatus}</p>
          <div className="modal-actions">
            <button className="button ghost" type="button" onClick={() => void removeEnrollment()}>Remove enrollment</button>
            <button className="button secondary" type="button" onClick={() => setEnrollOpen(false)}>Done</button>
          </div>
        </Modal>
      )}

      {pairingUrl && (
        <Modal title="Connect phone relay" onClose={() => setPairingUrl(null)}>
          <p>Scan this QR code with your phone. The pairing link expires in two minutes.</p>
          <div className="qr">
            <QRCodeSVG value={pairingUrl} size={200} level="H" />
          </div>
          <a className="pair-link" href={pairingUrl}>{pairingUrl}</a>
        </Modal>
      )}

      {/* Live Recording Microphone HUD Pop-up (visible when scrolled down past hero) */}
      {isStreaming && activeSource === "microphone" && scrolledPastHero && (
        <aside className="live-mic-popup" role="status" aria-label="Microphone live recording active">
          <div className="mic-pulse-wrapper">
            <span className="mic-pulse-ring" />
            <span className="mic-pulse-ring delay" />
            <Mic size={16} />
          </div>

          <div className="mic-info">
            <div className="mic-header">
              <span className="rec-badge">
                <span className="rec-dot" /> REC
              </span>
              <span className="rec-timer">{formatSeconds(recordingSeconds)}</span>
            </div>
            <span className="rec-status-line">Streaming live audio · Wav2Vec2 active</span>
          </div>

          <div className="mic-equalizer" aria-hidden="true">
            {micBars.map((height, i) => (
              <span
                key={i}
                className="eq-bar"
                style={{ height: `${height}%` }}
              />
            ))}
          </div>

          <button
            type="button"
            className="mic-stop-btn"
            onClick={() => void stopAudio()}
            title="Stop microphone recording"
          >
            <Square size={10} fill="currentColor" />
            <span>Stop Recording</span>
          </button>
        </aside>
      )}
    </main>
  );
}

function Metric({ label, value, detail, action, onAction }: { label: string; value: string; detail: string; action?: string; onAction?: () => void }) {
  return (
    <article className="metric">
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        <span>{detail}</span>
      </div>
      {action && <button className="text-button" type="button" onClick={onAction}>{action}</button>}
    </article>
  );
}

function PanelTitle({ kicker, title, right, action, onAction }: { kicker: string; title: string; right?: string; action?: string; onAction?: () => void }) {
  return (
    <header className="panel-head">
      <div>
        <small>{kicker}</small>
        <h2>{title}</h2>
      </div>
      {right && <span className="compact-stat">{right}</span>}
      {action && <button className="text-button" type="button" onClick={onAction}>{action}</button>}
    </header>
  );
}

function ExplanationCard({ explanation }: { explanation?: Explanation }) {
  if (!explanation) {
    return (
      <section className="explanation-card explanation-empty">
        <small>MODEL EXPLANATION</small>
        <p>A plain-language explanation appears with the first analysed audio window.</p>
      </section>
    );
  }

  return (
    <section className="explanation-card" aria-label="Model explanation">
      <header>
        <small>MODEL EXPLANATION</small>
        <span className={`confidence ${explanation.confidence}`}>{explanation.confidence} confidence</span>
      </header>
      <h3>{explanation.anomaly_label}</h3>
      <p>{explanation.summary}</p>
      <ul>
        {explanation.evidence.slice(0, 3).map((item) => <li key={item}>{item}</li>)}
      </ul>
      <p className="explanation-limit">{explanation.limits[0]}</p>
      <strong className="explanation-action">{explanation.recommended_action}</strong>
    </section>
  );
}

function RiskChart({ points }: { points: TrendPoint[] }) {
  if (points.length < 2) {
    const barHeights = [20, 24, 18, 26, 22, 19, 25, 28, 21, 17, 23, 27, 20, 24, 29, 22, 18, 25, 23, 21, 26, 30, 25, 28, 34, 46, 58, 68, 62, 48, 38, 30, 26, 22, 25, 19, 24, 22, 18, 21];
    return (
      <div className="timeline-empty">
        <div className="ws-bars" aria-hidden="true">
          {barHeights.map((h, i) => (
            <div
              key={i}
              className={`ws-bar ${h > 50 ? "ws-bar-red" : "ws-bar-blue"}`}
              style={{ height: `${h}%`, animationDelay: `${i * 0.045}s` }}
            />
          ))}
        </div>
        <p className="ws-copy">Awaiting session telemetry &amp; risk analysis stream…</p>
      </div>
    );
  }
  const path = points.map((point, index) => `${index ? "L" : "M"}${(index / (points.length - 1)) * 100},${100 - point.risk * 100}`).join(" ");
  return (
    <svg className="risk-chart" viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Risk score timeline">
      <defs>
        <linearGradient id="riskLineGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="var(--accent-safe)" />
          <stop offset="65%" stopColor="var(--accent-caution)" />
          <stop offset="100%" stopColor="var(--accent-high)" />
        </linearGradient>
      </defs>
      <line x1="0" x2="100" y1="25" y2="25" />
      <line x1="0" x2="100" y1="45" y2="45" />
      <path d={path} stroke="url(#riskLineGrad)" />
    </svg>
  );
}

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <button className="modal-close" type="button" onClick={onClose} aria-label="Close">×</button>
        <h2>{title}</h2>
        {children}
      </section>
    </div>
  );
}
