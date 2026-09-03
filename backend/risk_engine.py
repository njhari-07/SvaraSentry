"""Score smoothing and alert policy."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(slots=True)
class RiskResult:
    raw_score: float
    smoothed_score: float
    alert_level: str


@dataclass(slots=True)
class RiskEngine:
    alpha: float = 0.35
    caution_threshold: float = 0.55
    high_threshold: float = 0.75
    _smoothed: float | None = field(default=None, init=False, repr=False)

    def __post_init__(self) -> None:
        if not 0 < self.alpha <= 1:
            raise ValueError("alpha must be in (0, 1]")
        if not 0 <= self.caution_threshold < self.high_threshold <= 1:
            raise ValueError("thresholds must satisfy 0 <= caution < high <= 1")

    def update(self, fake_probability: float, identity_match: float | None = None) -> RiskResult:
        if not 0 <= fake_probability <= 1:
            raise ValueError("fake_probability must be in [0, 1]")

        score = fake_probability
        if identity_match is not None:
            if not 0 <= identity_match <= 1:
                raise ValueError("identity_match must be in [0, 1]")
            mismatch = 1 - identity_match
            score = 0.8 * fake_probability + 0.2 * mismatch

        self._smoothed = (
            score
            if self._smoothed is None
            else self.alpha * score + (1 - self.alpha) * self._smoothed
        )
        if self._smoothed >= self.high_threshold:
            level = "high"
        elif self._smoothed >= self.caution_threshold:
            level = "caution"
        else:
            level = "none"
        return RiskResult(score, self._smoothed, level)

    def reset(self) -> None:
        self._smoothed = None

