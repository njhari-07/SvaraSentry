export function resample(samples: Float32Array, sourceRate: number, targetRate: number): Float32Array {
  if (sourceRate === targetRate) return new Float32Array(samples);
  const output = new Float32Array(Math.round(samples.length * targetRate / sourceRate));
  const ratio = sourceRate / targetRate;
  for (let index = 0; index < output.length; index += 1) {
    const position = index * ratio;
    const left = Math.floor(position);
    const mix = position - left;
    output[index] = samples[left] * (1 - mix) + (samples[Math.min(left + 1, samples.length - 1)] || 0) * mix;
  }
  return output;
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
