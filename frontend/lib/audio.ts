import { AudioResampler } from "../public/audio-resampler.mjs";

export function resample(samples: Float32Array, sourceRate: number, targetRate: number): Float32Array {
  const resampler = new AudioResampler(sourceRate, targetRate);
  const main = resampler.process(samples);
  const tail = resampler.flush();
  const output = new Float32Array(main.length + tail.length);
  output.set(main);
  output.set(tail, main.length);
  return output;
}

export function downmix(buffer: AudioBuffer): Float32Array {
  if (buffer.numberOfChannels === 1) return new Float32Array(buffer.getChannelData(0));
  const mono = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const samples = buffer.getChannelData(channel);
    for (let index = 0; index < mono.length; index += 1) {
      mono[index] += samples[index] / buffer.numberOfChannels;
    }
  }
  return mono;
}

export function floatToPcm16(samples: Float32Array): ArrayBuffer {
  const pcm = new Int16Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    pcm[index] = sample < 0 ? sample * 32768 : sample * 32767;
  }
  return pcm.buffer;
}

export const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
