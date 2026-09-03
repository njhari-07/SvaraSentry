"""Runtime configuration loaded from environment variables."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _float(name: str, default: float) -> float:
    return float(os.getenv(name, default))


@dataclass(frozen=True, slots=True)
class Settings:
    sample_rate: int = 16_000
    window_seconds: float = 3.0
    stride_seconds: float = 1.0
    risk_alpha: float = 0.35
    caution_threshold: float = 0.55
    high_threshold: float = 0.75
    session_ttl_seconds: int = 3_600
    max_sessions: int = 200
    max_frame_bytes: int = 64_000
    model_mode: str = "baseline"
    checkpoint_path: Path = Path("training/checkpoints/model.pt")

    @classmethod
    def from_env(cls) -> Settings:
        return cls(
            sample_rate=int(os.getenv("SVARASENTRY_SAMPLE_RATE", "16000")),
            window_seconds=_float("SVARASENTRY_WINDOW_SECONDS", 3.0),
            stride_seconds=_float("SVARASENTRY_STRIDE_SECONDS", 1.0),
            risk_alpha=_float("SVARASENTRY_RISK_ALPHA", 0.35),
            caution_threshold=_float("SVARASENTRY_CAUTION_THRESHOLD", 0.55),
            high_threshold=_float("SVARASENTRY_HIGH_THRESHOLD", 0.75),
            session_ttl_seconds=int(os.getenv("SVARASENTRY_SESSION_TTL_SECONDS", "3600")),
            max_sessions=int(os.getenv("SVARASENTRY_MAX_SESSIONS", "200")),
            max_frame_bytes=int(os.getenv("SVARASENTRY_MAX_FRAME_BYTES", "64000")),
            model_mode=os.getenv("SVARASENTRY_MODEL_MODE", "baseline").lower(),
            checkpoint_path=Path(
                os.getenv("SVARASENTRY_CHECKPOINT", "training/checkpoints/model.pt")
            ),
        )
