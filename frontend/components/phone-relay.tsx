"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

import { websocketUrl } from "@/lib/api";

type RelayState = "idle" | "requesting" | "connecting" | "streaming" | "reconnecting" | "stopped" | "error";

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
      window.setTimeout(() => { void connect(); }, Math.min(1000 * 2 ** attempts.current, 10_000));
    };
    await new Promise<void>((resolve, reject) => {
      nextSocket.onopen = () => resolve();
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
      nextProcessor.port.onmessage = ({ data }: MessageEvent<{ buffer: ArrayBuffer; dbfs: number }>) => {
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
    setState("stopped");
    setCopy("Audio is no longer being sent to the dashboard.");
    await cleanup();
  }

  const live = state === "streaming" || state === "reconnecting";
  return <main className="phone-shell"><header className="phone-header"><span className="brand-mark" aria-hidden>|||</span><strong>Svara<span>Sentry</span></strong><small>PHONE RELAY</small></header><section className="relay-card"><div className={`orb ${live ? "live" : ""}`}><span>●</span></div><h1>{state === "streaming" ? "Relaying securely" : state === "reconnecting" ? "Reconnecting" : state === "error" ? "Action needed" : "Ready to relay"}</h1><p>{copy}</p>{live && <dl className="relay-stats"><div><dt>Input level</dt><dd>{level ?? "—"} dBFS</dd></div><div><dt>Elapsed</dt><dd>{String(Math.floor(elapsed / 60)).padStart(2, "0")}:{String(elapsed % 60).padStart(2, "0")}</dd></div><div><dt>Dropped frames</dt><dd>{droppedFrames}</dd></div></dl>}<button className={live ? "button danger" : "button primary"} type="button" disabled={!usable && state !== "error"} onClick={() => void (live ? stop() : start())}>{live ? "Stop relay" : "Start relay"}</button><p className="privacy-note">Audio is streamed only for this live session and is not stored by the server.</p></section><Link href="/">Open dashboard</Link></main>;
}
