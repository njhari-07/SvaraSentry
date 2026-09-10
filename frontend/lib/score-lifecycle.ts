import type { AnalysisResult, FinalSessionSummary } from "./types";

/** Transport messages may arrive on two sockets. A finalized stream is immutable. */
export class ScoreLifecycle {
  stream: string | null = null;
  stopping = false;
  sealed = false;
  latest: AnalysisResult | null = null;
  history: AnalysisResult[] = [];

  begin(stream: string) {
    if (stream === this.stream) return false;
    this.stream = stream;
    this.stopping = false;
    this.sealed = false;
    this.latest = null;
    this.history = [];
    return true;
  }

  stop() { this.stopping = true; }

  result(result: AnalysisResult) {
    if (this.sealed || result.stream_id !== this.stream || result.chunk_index <= (this.latest?.chunk_index ?? 0)) return false;
    this.latest = result;
    // Timeline history needs scalar metadata, not 120 spectrogram image payloads.
    this.history = [...this.history.slice(-119), { ...result, spectrogram_png_b64: undefined }];
    return !this.stopping;
  }

  finish(summary: FinalSessionSummary) {
    if (summary.stream_id !== this.stream || this.sealed) return false;
    this.sealed = true;
    this.stopping = false;
    return true;
  }
}
