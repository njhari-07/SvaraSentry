import type { FinalSessionSummary } from "./types";

export function flushAudioProcessor(processor: AudioWorkletNode): Promise<void> {
  return new Promise((resolve, reject) => {
    const listener = (event: MessageEvent) => {
      if (event.data?.type !== "flushed") return;
      clearTimeout(timer);
      processor.port.removeEventListener("message", listener);
      resolve();
    };
    const timer = setTimeout(() => {
      processor.port.removeEventListener("message", listener);
      reject(new Error("Microphone buffering could not be flushed completely."));
    }, 3000);
    processor.port.addEventListener("message", listener);
    processor.port.postMessage({ type: "flush" });
  });
}

/** Wait for the server to process all PCM queued before the stop marker. */
export function finishAudio(socket: WebSocket): Promise<FinalSessionSummary | null> {
  return new Promise((resolve, reject) => {
    if (socket.readyState !== WebSocket.OPEN) {
      reject(new Error("Audio connection closed before the final result was confirmed."));
      return;
    }
    const cleanup = () => {
      clearTimeout(timer);
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("close", onClose);
    };
    const onMessage = (event: MessageEvent) => {
      const message = JSON.parse(event.data) as { type: string; summary?: FinalSessionSummary | null };
      if (message.type !== "audio_stopped") return;
      cleanup();
      resolve(message.summary ?? null);
    };
    const onClose = () => {
      cleanup();
      reject(new Error("Connection interrupted; only completed windows are available."));
    };
    const timer = setTimeout(() => {
      cleanup();
      socket.close();
      reject(new Error("Final analysis timed out; the available summary may be incomplete."));
    }, 60_000);
    socket.addEventListener("message", onMessage);
    socket.addEventListener("close", onClose);
    socket.send(JSON.stringify({ type: "audio_control", action: "stop" }));
  });
}
