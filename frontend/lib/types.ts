export type AlertLevel = "none" | "caution" | "high";

export interface RuntimeConfig {
  sample_rate: number;
  window_seconds: number;
  stride_seconds: number;
  model_kind: string;
  model_mode: string;
  baseline_disclaimer: boolean;
}

export interface AnalysisResult {
  type: "result";
  chunk_index: number;
  risk_score: number;
  smoothed_risk: number;
  alert_level: AlertLevel;
  processing_ms: number;
  spectrogram_png_b64?: string;
  spectrogram?: { window_seconds?: number };
  acoustic_features?: Record<string, string | number>;
  flagged_region?: { time_offset_ms?: [number, number] } | null;
  identity_match?: number | null;
  voice_enrolled: boolean;
  signal?: { rms_dbfs: number; peak: number; state: string };
}

export interface DashboardMessage {
  type: "snapshot" | "result" | "source" | "source_status" | "enrollment" | "reset" | "error";
  latest?: AnalysisResult;
  voice_enrolled?: boolean;
  connected?: boolean;
  source?: "dashboard" | "phone";
  state?: string;
  network_state?: string;
  dropped_frames?: number;
  message?: string;
}
