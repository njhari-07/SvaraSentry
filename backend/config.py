"""Runtime configuration loaded from environment variables."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

_ENV_PREFIXES = ("CHHAYASWARA_", "SWARASENTRY_", "SVARASENTRY_")


def _getenv(name: str, default: str | None = None) -> str | None:
    # Check CHHAYASWARA_*, SWARASENTRY_*, SVARASENTRY_*
    for prefix in _ENV_PREFIXES:
        if name.startswith(prefix):
            suffix = name[len(prefix) :]
            for check_prefix in _ENV_PREFIXES:
                val = os.getenv(check_prefix + suffix)
                if val is not None:
                    return val
            return default
    return os.getenv(name, default)


def _float(name: str, default: float) -> float:
    val = _getenv(name)
    return float(val) if val is not None else default


def _bool(name: str, default: bool = False) -> bool:
    value = _getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _origins(name: str, default: tuple[str, ...]) -> tuple[str, ...]:
    value = _getenv(name)
    if not value:
        return default
    return tuple(origin.strip().rstrip("/") for origin in value.split(",") if origin.strip())


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
    pairing_token_ttl_seconds: int = 120
    model_mode: str = "baseline"
    checkpoint_path: Path = Path("training/checkpoints/model.pt")
    explanation_occlusion: bool = False
    explanation_band_occlusion: bool = False
    explanation_integrated_gradients: bool = False
    explanation_top_regions: int = 3
    frontend_origin: str = "http://localhost:3000"
    cors_origins: tuple[str, ...] = ("http://localhost:3000", "http://127.0.0.1:3000")

    @classmethod
    def from_env(cls) -> Settings:
        return cls(
            sample_rate=int(_getenv("CHHAYASWARA_SAMPLE_RATE", "16000") or "16000"),
            window_seconds=_float("CHHAYASWARA_WINDOW_SECONDS", 3.0),
            stride_seconds=_float("CHHAYASWARA_STRIDE_SECONDS", 1.0),
            risk_alpha=_float("CHHAYASWARA_RISK_ALPHA", 0.35),
            caution_threshold=_float("CHHAYASWARA_CAUTION_THRESHOLD", 0.55),
            high_threshold=_float("CHHAYASWARA_HIGH_THRESHOLD", 0.75),
            session_ttl_seconds=int(_getenv("CHHAYASWARA_SESSION_TTL_SECONDS", "3600") or "3600"),
            max_sessions=int(_getenv("CHHAYASWARA_MAX_SESSIONS", "200") or "200"),
            max_frame_bytes=int(_getenv("CHHAYASWARA_MAX_FRAME_BYTES", "64000") or "64000"),
            pairing_token_ttl_seconds=int(_getenv("CHHAYASWARA_PAIRING_TOKEN_TTL_SECONDS", "120") or "120"),
            model_mode=(_getenv("CHHAYASWARA_MODEL_MODE", "baseline") or "baseline").lower(),
            checkpoint_path=Path(
                _getenv("CHHAYASWARA_CHECKPOINT", "training/checkpoints/model.pt") or "training/checkpoints/model.pt"
            ),
            explanation_occlusion=_bool("CHHAYASWARA_EXPLAIN_OCCLUSION"),
            explanation_band_occlusion=_bool("CHHAYASWARA_EXPLAIN_BAND_OCCLUSION"),
            explanation_integrated_gradients=_bool("CHHAYASWARA_EXPLAIN_INTEGRATED_GRADIENTS"),
            explanation_top_regions=int(_getenv("CHHAYASWARA_EXPLAIN_TOP_REGIONS", "3") or "3"),
            frontend_origin=(_getenv("CHHAYASWARA_FRONTEND_ORIGIN", "http://localhost:3000") or "http://localhost:3000").rstrip("/"),
            cors_origins=_origins(
                "CHHAYASWARA_CORS_ORIGINS",
                ("http://localhost:3000", "http://127.0.0.1:3000"),
            ),
        )
