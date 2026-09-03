import csv
import tempfile
import unittest
from pathlib import Path

from data_pipeline.build_manifest import build_manifest


class ManifestTests(unittest.TestCase):
    def test_builds_sorted_labelled_rows(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            real = root / "team_recordings"
            fake = root / "sarvam_generated"
            real.mkdir()
            fake.mkdir()
            (real / "speaker1__hi__sample.wav").touch()
            (fake / "clone.flac").touch()
            output = root / "manifest.csv"

            self.assertEqual(build_manifest([real], [fake], output), 2)
            with output.open(newline="", encoding="utf-8") as handle:
                rows = list(csv.DictReader(handle))

            self.assertEqual([row["label"] for row in rows], ["real", "fake"])
            self.assertEqual(rows[0]["speaker"], "speaker1")
            self.assertEqual(rows[0]["language"], "hi")


if __name__ == "__main__":
    unittest.main()

