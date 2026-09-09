import { AudioResampler } from "./audio-resampler.mjs";

class RelayProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.resampler = new AudioResampler(sampleRate, options.processorOptions.targetRate || 16000);
    this.active = true;
    this.pending = [];
    this.port.onmessage = ({ data }) => {
      if (data?.type === "flush" && this.active) {
        this.active = false;
        this.queue(this.resampler.flush());
        this.send();
        this.port.postMessage({ type: "flushed" });
      }
    };
  }
  send() {
    if (!this.pending.length) return;
    const pcm = new Int16Array(this.pending.length);
    let sumSquares = 0;
    for (let i = 0; i < pcm.length; i++) {
      const value = Math.max(-1, Math.min(1, this.pending[i]));
      pcm[i] = value < 0 ? value * 32768 : value * 32767;
      sumSquares += value * value;
    }
    const dbfs = Math.max(-100, 20 * Math.log10(Math.sqrt(sumSquares / pcm.length) || 1e-5));
    this.pending = [];
    this.port.postMessage({ type: "audio", buffer: pcm.buffer, dbfs }, [pcm.buffer]);
  }
  queue(samples) {
    for (const sample of samples) {
      this.pending.push(sample);
      if (this.pending.length === 4000) this.send();
    }
  }
  process(inputs) {
    if (!this.active) return false;
    const channels = inputs[0];
    if (!channels?.length || !channels[0]?.length) return true;
    const mono = new Float32Array(channels[0].length);
    for (const channel of channels) {
      for (let i = 0; i < mono.length; i++) mono[i] += channel[i] / channels.length;
    }
    this.queue(this.resampler.process(mono));
    return true;
  }
}
registerProcessor("relay-processor", RelayProcessor);
