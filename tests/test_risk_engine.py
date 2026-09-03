import unittest

from backend.risk_engine import RiskEngine


class RiskEngineTests(unittest.TestCase):
    def test_smooths_scores_and_sets_alert_level(self):
        engine = RiskEngine(alpha=0.5, caution_threshold=0.5, high_threshold=0.8)
        first = engine.update(0.4)
        second = engine.update(0.8)
        third = engine.update(1.0)

        self.assertAlmostEqual(first.smoothed_score, 0.4)
        self.assertAlmostEqual(second.smoothed_score, 0.6)
        self.assertEqual(second.alert_level, "caution")
        self.assertEqual(third.alert_level, "high")

    def test_identity_mismatch_contributes_to_risk(self):
        result = RiskEngine(alpha=1).update(0.5, identity_match=0.0)
        self.assertAlmostEqual(result.raw_score, 0.6)


if __name__ == "__main__":
    unittest.main()

