export type AlertLevel = "none" | "caution" | "high";

export interface RuntimeConfig {
  sample_rate: number;
  window_seconds: number;
  stride_seconds: number;
  caution_threshold?: number;
  high_threshold?: number;
  model_kind: string;
  model_mode: string;
  baseline_disclaimer: boolean;
  explainability?: {
    time_occlusion: boolean;
    band_occlusion: boolean;
    integrated_gradients: boolean;
  };
}

export interface EvidenceRegion {
  start_ms?: number;
  end_ms?: number;
  importance?: number;
  method: string;
  probability_delta?: number;
}

export interface ModelEvidence {
  attribution_type?: string;
  top_time_regions?: EvidenceRegion[];
  time_occlusion_regions?: EvidenceRegion[];
  integrated_gradients_regions?: EvidenceRegion[];
  frequency_band_occlusion?: Array<{
    band_hz: [number, number];
    method: string;
    probability_delta: number;
  }>;
  frequency_attribution_available?: boolean;
  unsupported?: string[];
}

export interface Explanation {
  source: "deterministic" | "deterministic-fallback" | "langchain";
  summary: string;
  anomaly_label: string;
  evidence: string[];
  limits: string[];
  confidence: "limited" | "moderate" | "strong";
  recommended_action: string;
}

export interface AnalysisResult {
  type: "result";
  stream_id: string;
  chunk_index: number;
  timestamp?: number;
  risk_score: number;
  smoothed_risk: number;
  alert_level: AlertLevel;
  fake_probability?: number;
  logit_margin?: number | null;
  processing_ms: number;
  spectrogram_png_b64?: string;
  spectrogram?: { window_seconds?: number };
  acoustic_features?: Record<string, string | number>;
  flagged_region?: { time_offset_ms?: [number, number]; attribution_type?: string } | null;
  model_evidence?: ModelEvidence;
  explanation?: Explanation;
  identity_match?: number | null;
  voice_enrolled: boolean;
  signal?: { rms_dbfs: number; peak: number; state: string };
}

export interface FinalSessionSummary {
  type: "session_summary";
  session_id: string;
  stream_id: string;
  completed: boolean;
  window_count: number;
  average_risk: number;
  maximum_risk: number;
  high_risk_windows: number;
  caution_windows: number;
  high_risk_fraction: number;
  alert_level: AlertLevel;
  completed_at: number;
}

export interface DashboardMessage {
  type: "snapshot" | "result" | "session_summary" | "source" | "source_status" | "enrollment" | "reset" | "error";
  latest?: AnalysisResult;
  final_summary?: FinalSessionSummary;
  summary?: FinalSessionSummary;
  window_count?: number;
  average_risk?: number;
  maximum_risk?: number;
  high_risk_windows?: number;
  caution_windows?: number;
  high_risk_fraction?: number;
  alert_level?: AlertLevel;
  completed_at?: number;
  session_id?: string;
  stream_id?: string;
  completed?: boolean;
  voice_enrolled?: boolean;
  connected?: boolean;
  source?: "dashboard" | "phone";
  state?: string;
  network_state?: string;
  dropped_frames?: number;
  message?: string;
}
