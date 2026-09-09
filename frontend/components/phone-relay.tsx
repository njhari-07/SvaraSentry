"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

import { websocketUrl } from "@/lib/api";
import { finishAudio, flushAudioProcessor } from "@/lib/finish-audio";

type RelayState = "idle" | "requesting" | "connecting" | "streaming" | "reconnecting" | "stopping" | "stopped" | "error";

export function PhoneRelay() {
  const token = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("pair");
  const insecureContext = typeof window !== "undefined" && !window.isSecureContext && window.location.hostname !== "localhost";
  const [state, setState] = useState<RelayState>(() => !token || insecureContext ? "error" : "idle");
  const [copy, setCopy] = useState(() => !token
    ? "No pairing token found. Scan a new QR code from the dashboard."
    : insecureContext
      ? "Microphone access requires HTTPS. Open the secure pairing link again."
      : "Tap below to share your microphone with the dashboard.");
  const [elapsed, setElapsed] = useState(0);
  const [droppedFrames, setDroppedFrames] = useState(0);
  const [level, setLevel] = useState<number | null>(null);
  const socket = useRef<WebSocket | null>(null);
  const context = useRef<AudioContext | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const processor = useRef<AudioWorkletNode | null>(null);
  const started = useRef<number | null>(null);
  const attempts = useRef(0);
  const shouldReconnect = useRef(false);

  const usable = Boolean(token) && (window.isSecureContext || window.location.hostname === "localhost");

  useEffect(() => () => { void cleanup(); }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (started.current) setElapsed(Math.floor((Date.now() - started.current) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  async function cleanup() {
    shouldReconnect.current = false;
    processor.current?.disconnect();
    stream.current?.getTracks().forEach((track) => track.stop());
    if (context.current && context.current.state !== "closed") await context.current.close();
    socket.current?.close();
    processor.current = null;
    stream.current = null;
    context.current = null;
    socket.current = null;
    started.current = null;
  }

  async function connect() {
    if (!token) return;
    shouldReconnect.current = true;
    setState("connecting");
    setCopy("Connecting to the dashboard…");
    const nextSocket = new WebSocket(websocketUrl(`/ws/audio/pair/${encodeURIComponent(token)}`));
    nextSocket.binaryType = "arraybuffer";
    socket.current = nextSocket;
    nextSocket.onmessage = ({ data }) => {
      try {
        const message = JSON.parse(data) as { type?: string; message?: string };
        if (message.type === "stop_requested") void stop();
        if (message.type === "error") {
          setState("error");
          setCopy(message.message ?? "The relay could not connect.");
          void cleanup();
        }
      } catch { /* binary result messages are not expected on the relay */ }
    };
    nextSocket.onclose = () => {
      if (!shouldReconnect.current) return;
      if (attempts.current >= 5) {
        setState("error");
        setCopy("Lost connection to the dashboard.");
        void cleanup();
        return;
      }
      attempts.current += 1;
      setState("reconnecting");
      setCopy(`Reconnecting (${attempts.current}/5)…`);
      window.setTimeout(() => {
        void connect().catch(() => {
          // onclose schedules the next bounded reconnect attempt.
        });
      }, Math.min(1000 * 2 ** attempts.current, 10_000));
    };
    await new Promise<void>((resolve, reject) => {
      nextSocket.onopen = () => {
        attempts.current = 0;
        setState("streaming");
        setCopy("Live audio is being analyzed by the connected dashboard.");
        resolve();
      };
      nextSocket.onerror = () => reject(new Error("Could not reach the dashboard"));
    });
  }

  async function start() {
    if (!usable || !token) return;
    try {
      setState("requesting");
      setCopy("Allow microphone access to start the relay.");
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 }, video: false });
      await connect();
      const nextContext = new AudioContext();
      context.current = nextContext;
      await nextContext.audioWorklet.addModule("/audio-processor.js");
      const source = nextContext.createMediaStreamSource(stream.current);
      const nextProcessor = new AudioWorkletNode(nextContext, "relay-processor", { processorOptions: { targetRate: 16_000 } });
      nextProcessor.port.onmessage = ({ data }: MessageEvent<{ type: string; buffer?: ArrayBuffer; dbfs: number }>) => {
        if (!data.buffer) return;
        const activeSocket = socket.current;
        if (!activeSocket || activeSocket.readyState !== WebSocket.OPEN) return;
        if (activeSocket.bufferedAmount > 128_000) {
          setDroppedFrames((count) => count + 1);
          return;
        }
        activeSocket.send(data.buffer);
        setLevel(Math.round(data.dbfs));
      };
      source.connect(nextProcessor);
      nextProcessor.connect(nextContext.destination);
      processor.current = nextProcessor;
      attempts.current = 0;
      started.current = Date.now();
      setState("streaming");
      setCopy("Live audio is being analyzed by the connected dashboard.");
    } catch (error) {
      setState("error");
      setCopy(error instanceof Error ? error.message : "Microphone setup failed.");
      await cleanup();
    }
  }

  async function stop() {
    shouldReconnect.current = false;
    setState("stopping");
    setCopy("Microphone stopped. Finishing queued audio analysis…");
    stream.current?.getTracks().forEach((track) => track.stop());
    try {
      if (processor.current) await flushAudioProcessor(processor.current);
      if (socket.current) await finishAudio(socket.current);
      setState("stopped");
      setCopy("Final analysis is ready on the dashboard.");
    } catch (error) {
      setState("error");
      setCopy(error instanceof Error ? error.message : "Could not confirm final analysis.");
    } finally {
      await cleanup();
    }
  }

  const live = state === "streaming" || state === "reconnecting";
  const heading = state === "streaming" ? "Relay is live" : state === "reconnecting" ? "Reconnecting relay" : state === "error" ? "Pairing required" : "Ready to relay";

  return (
    <main className="phone-shell">
      <header className="phone-header">
        <Link className="phone-brand" href="/" aria-label="SvaraSentry home">
          <span className="brand-mark" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <linearGradient id="phoneShield" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="#38bdf8" />
                  <stop offset="50%" stopColor="#60a5fa" />
                  <stop offset="100%" stopColor="#2563eb" />
                </linearGradient>
                <linearGradient id="phoneWave" x1="12" y1="6" x2="12" y2="18" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="#ffffff" />
                  <stop offset="100%" stopColor="#7dd3fc" />
                </linearGradient>
              </defs>
              <path
                d="M12 2.5L4.5 5.5V11.5C4.5 16.2 7.7 20.6 12 21.8C16.3 20.6 19.5 16.2 19.5 11.5V5.5L12 2.5Z"
                stroke="url(#phoneShield)"
                strokeWidth="1.8"
                strokeLinejoin="round"
                fill="rgba(56, 189, 248, 0.12)"
              />
              <path d="M8 10V14" stroke="url(#phoneWave)" strokeWidth="2" strokeLinecap="round" />
              <path d="M10.7 7.5V16.5" stroke="url(#phoneWave)" strokeWidth="2" strokeLinecap="round" />
              <path d="M13.3 6V18" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" />
              <path d="M16 8.5V15.5" stroke="url(#phoneWave)" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </span>
          <strong>Svara<span>Sentry</span></strong>
        </Link>
        <small>PHONE RELAY</small>
      </header>

      <section className="relay-card">
        <div className="relay-state">
          <span className={`relay-state-dot ${live ? "live" : ""}`} aria-hidden />
          <span>{live ? "STREAMING" : state === "error" ? "NOT PAIRED" : "STANDBY"}</span>
        </div>
        <h1>{heading}</h1>
        <p>{copy}</p>

        {live && (
          <dl className="relay-stats">
            <div><dt>Input level</dt><dd>{level ?? "—"} dBFS</dd></div>
            <div><dt>Elapsed</dt><dd>{String(Math.floor(elapsed / 60)).padStart(2, "0")}:{String(elapsed % 60).padStart(2, "0")}</dd></div>
            <div><dt>Dropped frames</dt><dd>{droppedFrames}</dd></div>
          </dl>
        )}

        <button className={live ? "button danger" : "button primary"} type="button" disabled={state === "stopping" || (!usable && state !== "error")} onClick={() => void (live ? stop() : start())}>{state === "stopping" ? "Finishing analysis…" : live ? "Stop relay" : "Start relay"}</button>
        <div className="relay-privacy"><span>16 kHz PCM</span><span>Session only</span><span>No server storage</span></div>
      </section>

      <Link className="phone-dashboard-link" href="/">Open dashboard</Link>
    </main>
  );
}
