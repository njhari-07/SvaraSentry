class RelayProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.targetRate = options.processorOptions.targetRate || 16000;
    this.sourceRate = sampleRate;
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    const output = new Float32Array(Math.round(input.length * this.targetRate / this.sourceRate));
    const ratio = this.sourceRate / this.targetRate;
    let sumSquares = 0;
    for (let index = 0; index < output.length; index += 1) {
      const position = index * ratio;
      const left = Math.floor(position);
      const mix = position - left;
      const value = input[left] * (1 - mix) + (input[Math.min(left + 1, input.length - 1)] || 0) * mix;
      output[index] = value;
      sumSquares += value * value;
    }
    const pcm = new Int16Array(output.length);
    for (let index = 0; index < output.length; index += 1) {
      const value = Math.max(-1, Math.min(1, output[index]));
      pcm[index] = value < 0 ? value * 32768 : value * 32767;
    }
    const dbfs = Math.max(-100, 20 * Math.log10(Math.sqrt(sumSquares / output.length) || 1e-5));
    this.port.postMessage({ buffer: pcm.buffer, dbfs }, [pcm.buffer]);
    return true;
  }
}

registerProcessor("relay-processor", RelayProcessor);
