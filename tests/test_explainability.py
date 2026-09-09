import unittest

import numpy as np

from backend.attribution import occlude_frequency_bands, occlude_time_regions, top_time_regions
from backend.explainer import build_explanation
from backend.langchain_agent import rewrite_with_langchain


class _Runnable:
    def __init__(self, response: str):
        self.response = response

    def invoke(self, _input, /, **_kwargs):
        return self.response


class _FailingRunnable:
    def invoke(self, _input, /, **_kwargs):
        raise TimeoutError("provider unavailable")


class ExplainabilityTests(unittest.TestCase):
    def test_top_time_regions_are_separated_and_json_safe(self):
        regions = top_time_regions(
            np.array([0.05, 0.8, 0.7, 0.1, 0.95, 0.2]),
            3_000,
            method="temporal_attention",
            count=2,
            region_frames=1,
        )

        self.assertEqual(len(regions), 2)
        self.assertEqual(regions[0]["method"], "temporal_attention")
        self.assertGreaterEqual(regions[0]["start_ms"], 0)
        self.assertLessEqual(regions[-1]["end_ms"], 3_000)

    def test_occlusion_reports_measured_score_delta(self):
        samples = np.ones(160, dtype=np.float32)
        regions = [{"start_ms": 0, "end_ms": 500, "importance": 0.9, "method": "attention"}]
        output = occlude_time_regions(
            samples,
            regions,
            160,
            1.0,
            lambda value: float(np.mean(value)),
        )

        self.assertEqual(output[0]["method"], "time_occlusion")
        self.assertGreater(output[0]["probability_delta"], 0)

    def test_band_occlusion_describes_broad_bands_only(self):
        samples = np.sin(2 * np.pi * 1_000 * np.arange(1_600) / 16_000).astype(np.float32)
        output = occlude_frequency_bands(
            samples,
            16_000,
            1.0,
            lambda value: float(np.sqrt(np.mean(np.square(value)))),
            bands_hz=((0, 300), (300, 3_000)),
        )

        self.assertEqual(output[1]["band_hz"], [300, 3_000])
        self.assertEqual(output[1]["method"], "band_occlusion")
        self.assertGreater(output[1]["probability_delta"], output[0]["probability_delta"])

    def test_checkpoint_explanation_separates_model_evidence_from_visual_context(self):
        explanation = build_explanation(
            model_kind="wav2vec2-attentive",
            model_mode="checkpoint",
            fake_probability=0.81,
            risk_score=0.81,
            smoothed_risk=0.77,
            alert_level="high",
            signal={"state": "usable"},
            acoustic_features={"signal_quality": "usable"},
            model_evidence={
                "top_time_regions": [
                    {"start_ms": 900, "end_ms": 1_200, "importance": 0.9, "method": "temporal_attention"}
                ]
            },
        )

        self.assertEqual(explanation["source"], "deterministic")
        self.assertIn("strongest attention", " ".join(explanation["evidence"]))
        self.assertIn("not proof", " ".join(explanation["limits"]))
        self.assertIn("No frequency-level attribution", " ".join(explanation["limits"]))

    def test_baseline_explanation_cannot_be_presented_as_model_evidence(self):
        explanation = build_explanation(
            model_kind="integration-baseline",
            model_mode="baseline",
            fake_probability=0.6,
            risk_score=0.6,
            smoothed_risk=0.6,
            alert_level="caution",
            signal={"state": "usable"},
            acoustic_features={"signal_quality": "usable"},
        )

        self.assertEqual(explanation["confidence"], "limited")
        self.assertIn("not a trained deepfake model", explanation["summary"])

    def test_langchain_rewrite_uses_fallback_for_unsafe_claims(self):
        explanation = {
            "source": "deterministic",
            "summary": "Caution. Verify independently.",
            "limits": ["Model score is not proof."],
        }
        rewritten = rewrite_with_langchain(_Runnable("This definitely synthetic voice proves the voice is fake."), explanation)

        self.assertEqual(rewritten["source"], "deterministic-fallback")
        self.assertEqual(rewritten["summary"], explanation["summary"])

    def test_langchain_rewrite_accepts_cautious_summary(self):
        explanation = {
            "source": "deterministic",
            "summary": "Caution. Verify independently.",
            "limits": ["Model score is not proof."],
        }
        rewritten = rewrite_with_langchain(
            _Runnable("The model flagged an influential time segment. Pause sensitive actions and verify independently."),
            explanation,
        )

        self.assertEqual(rewritten["source"], "langchain")
        self.assertIn("Pause sensitive actions", rewritten["summary"])

    def test_langchain_rewrite_falls_back_when_provider_fails(self):
        explanation = {
            "source": "deterministic",
            "summary": "Caution. Verify independently.",
            "limits": ["Model score is not proof."],
        }

        rewritten = rewrite_with_langchain(_FailingRunnable(), explanation)

        self.assertEqual(rewritten["source"], "deterministic-fallback")
        self.assertEqual(rewritten["summary"], explanation["summary"])


if __name__ == "__main__":
    unittest.main()
