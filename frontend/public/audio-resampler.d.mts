export class AudioResampler {
  constructor(sourceRate: number, targetRate?: number);
  process(input: Float32Array): Float32Array;
  flush(): Float32Array;
}
