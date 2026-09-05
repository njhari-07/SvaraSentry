class RelayProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.targetRate = options.processorOptions.targetRate || 16000;
    this.sourceRate = sampleRate; // Global in AudioWorkletGlobalScope
  }

  resample(input) {
    if (this.sourceRate === this.targetRate) return new Float32Array(input);
    const output = new Float32Array(Math.round(input.length * this.targetRate / this.sourceRate));
    const ratio = this.sourceRate / this.targetRate;
    for (let index = 0; index < output.length; index++) {
      const position = index * ratio;
      const left = Math.floor(position);
      const mix = position - left;
      output[index] = input[left] * (1 - mix) + (input[Math.min(left + 1, input.length - 1)] || 0) * mix;
    }
    return output;
  }

  toPcm(samples) {
    const pcm = new Int16Array(samples.length);
    for (let index = 0; index < samples.length; index++) {
      const value = Math.max(-1, Math.min(1, samples[index]));
      pcm[index] = value < 0 ? value * 32768 : value * 32767;
    }
    return pcm.buffer;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const channelData = input[0];
    const resampled = this.resample(channelData);
    
    // Calculate simple DBFS for UI
    let sumSquares = 0;
    for(let i=0; i<resampled.length; i++) sumSquares += resampled[i] * resampled[i];
    const rms = Math.sqrt(sumSquares / resampled.length);
    let dbfs = 20 * Math.log10(rms || 1e-5);
    if (dbfs < -100) dbfs = -100;

    const pcmBuffer = this.toPcm(resampled);
    
    this.port.postMessage({ buffer: pcmBuffer, dbfs }, [pcmBuffer]);

    return true;
  }
}

registerProcessor('relay-processor', RelayProcessor);
