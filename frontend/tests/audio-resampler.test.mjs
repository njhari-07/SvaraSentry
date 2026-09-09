import { test } from "node:test";
import assert from "node:assert/strict";
import { AudioResampler } from "../public/audio-resampler.mjs";

function convert(input, rate, chunkSize) {
  const resampler = new AudioResampler(rate, 16000);
  const parts = [];
  for (let offset = 0; offset < input.length; offset += chunkSize) parts.push(resampler.process(input.subarray(offset, offset + chunkSize)));
  parts.push(resampler.flush());
  return Float32Array.from(parts.flatMap((part) => Array.from(part)));
}
for (const rate of [16000, 22050, 44100, 48000]) {
  test(`${rate} Hz: exact sample count and chunk-invariant waveform`, () => {
    const signal = Float32Array.from({ length: rate }, (_, i) => 0.5 * Math.sin(2 * Math.PI * 1000 * i / rate));
    const reference = convert(signal, rate, signal.length);
    assert.equal(reference.length, 16000);
    for (const chunk of [128, 4096, 731]) assert.deepEqual(convert(signal, rate, chunk), reference);
  });
}
test("48 kHz: preserve speech-band tone and reject above-Nyquist alias", () => {
  const rms = (frequency) => {
    const input = Float32Array.from({ length: 48000 }, (_, i) => Math.sin(2 * Math.PI * frequency * i / 48000));
    const result = convert(input, 48000, 128).subarray(100, 15900);
    return Math.sqrt(result.reduce((sum, v) => sum + v * v, 0) / result.length);
  };
  assert.ok(Math.abs(rms(1000) - Math.SQRT1_2) < 0.03);
  assert.ok(rms(12000) < 0.01, "12 kHz must not alias into the 4 kHz speech band");
});

test("worklet downmixes stereo, batches PCM, and flushes the final partial frame", async () => {
  let Processor;
  const messages = [];
  globalThis.sampleRate = 48000;
  globalThis.AudioWorkletProcessor = class {
    port = { postMessage: (message) => messages.push(message), onmessage: null };
  };
  globalThis.registerProcessor = (_, implementation) => { Processor = implementation; };
  await import("../public/audio-processor.js");
  const processor = new Processor({ processorOptions: { targetRate: 16000 } });
  const channel = Float32Array.from({ length: 48128 }, (_, i) => 0.2 * Math.sin(i / 8));
  for (let offset = 0; offset < channel.length; offset += 128) {
    const part = channel.subarray(offset, offset + 128);
    processor.process([[part, part]]);
  }
  processor.port.onmessage({ data: { type: "flush" } });
  const frames = messages.filter((message) => message.type === "audio");
  assert.equal(frames.reduce((sum, frame) => sum + frame.buffer.byteLength / 2, 0), Math.round(channel.length / 3));
  assert.ok(frames.length > 1 && frames[0].buffer.byteLength === 8000);
  assert.equal(messages.at(-1).type, "flushed");
  assert.equal(processor.process([[channel]]), false);
});
