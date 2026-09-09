/** Stateful low-pass resampling; sample phase is preserved between callbacks. */
export class AudioResampler {
  constructor(sourceRate, targetRate = 16000) {
    if (!(sourceRate > 0 && targetRate > 0)) throw new Error("Invalid sample rate");
    this.sourceRate = sourceRate;
    this.targetRate = targetRate;
    this.ratio = sourceRate / targetRate;
    this.buffer = new Float32Array(0);
    this.offset = 0;
    this.total = 0;
    this.produced = 0;
    this.finished = false;
    this.half = targetRate < sourceRate ? 50 : 0;
    this.kernel = new Float64Array(this.half * 2 + 1);
    const cutoff = 0.47 * targetRate / sourceRate;
    let sum = 0;
    for (let i = -this.half; i <= this.half; i++) {
      const sinc = i === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * i) / (Math.PI * i);
      const window = this.half ? 0.54 + 0.46 * Math.cos(Math.PI * i / this.half) : 1;
      this.kernel[i + this.half] = this.half ? sinc * window : 1;
      sum += this.kernel[i + this.half];
    }
    for (let i = 0; i < this.kernel.length; i++) this.kernel[i] /= sum;
  }
  process(input) {
    if (this.finished) throw new Error("Resampler already finished");
    if (this.sourceRate === this.targetRate) {
      this.total += input.length;
      this.produced += input.length;
      return new Float32Array(input);
    }
    const joined = new Float32Array(this.buffer.length + input.length);
    joined.set(this.buffer);
    joined.set(input, this.buffer.length);
    this.buffer = joined;
    this.total += input.length;
    return this.emit(false);
  }
  filtered(index) {
    let value = 0;
    for (let tap = -this.half; tap <= this.half; tap++) {
      const location = index + tap - this.offset;
      if (location >= 0 && location < this.buffer.length) value += this.buffer[location] * this.kernel[tap + this.half];
    }
    return value;
  }
  emit(flush) {
    const output = [];
    const expected = Math.round(this.total / this.ratio);
    while (this.produced < expected) {
      const position = this.produced * this.ratio;
      const left = Math.floor(position);
      if (!flush && left + this.half + 1 >= this.total) break;
      const mix = position - left;
      output.push(this.filtered(left) * (1 - mix) + this.filtered(left + 1) * mix);
      this.produced++;
    }
    const keepFrom = Math.max(this.offset, Math.floor(this.produced * this.ratio) - this.half);
    this.buffer = this.buffer.slice(keepFrom - this.offset);
    this.offset = keepFrom;
    return Float32Array.from(output);
  }
  flush() {
    if (this.finished) return new Float32Array(0);
    this.finished = true;
    return this.sourceRate === this.targetRate ? new Float32Array(0) : this.emit(true);
  }
}
