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
            self.assertEqual(rows[0]["split"], "unspecified")

    def test_builds_asvspoof_rows_from_protocols(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "LA"
            train = root / "ASVspoof2019_LA_train" / "flac"
            dev = root / "ASVspoof2019_LA_dev" / "flac"
            protocols = root / "ASVspoof2019_LA_cm_protocols"
            train.mkdir(parents=True)
            dev.mkdir(parents=True)
            protocols.mkdir()
            for directory, utterance in (
                (train, "LA_T_1000001"),
                (train, "LA_T_1000002"),
                (dev, "LA_D_1000001"),
                (dev, "LA_D_1000002"),
                (dev, "LA_D_UNLISTED"),
            ):
                (directory / f"{utterance}.flac").touch()
            (protocols / "ASVspoof2019.LA.cm.train.trn.txt").write_text(
                "LA_0001 LA_T_1000001 - - bonafide\n"
                "LA_0002 LA_T_1000002 - A01 spoof\n",
                encoding="utf-8",
            )
            (protocols / "ASVspoof2019.LA.cm.dev.trl.txt").write_text(
                "LA_0003 LA_D_1000001 - - bonafide\n"
                "LA_0004 LA_D_1000002 - A06 spoof\n",
                encoding="utf-8",
            )
            output = Path(temp) / "manifest.csv"

            self.assertEqual(build_manifest([], [], output, [root]), 4)
            with output.open(newline="", encoding="utf-8") as handle:
                rows = list(csv.DictReader(handle))

            self.assertEqual([row["label"] for row in rows], ["real", "fake", "real", "fake"])
            self.assertEqual([row["split"] for row in rows], ["train", "train", "dev", "dev"])
            self.assertEqual([row["attack_type"] for row in rows], ["none", "A01", "none", "A06"])
            self.assertTrue(all(row["source"] == "asvspoof2019_la" for row in rows))
            self.assertNotIn("LA_D_UNLISTED.flac", {Path(row["path"]).name for row in rows})

    def test_asvspoof_protocol_rejects_missing_audio(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "LA"
            (root / "ASVspoof2019_LA_train" / "flac").mkdir(parents=True)
            (root / "ASVspoof2019_LA_dev" / "flac").mkdir(parents=True)
            protocols = root / "ASVspoof2019_LA_cm_protocols"
            protocols.mkdir()
            (protocols / "ASVspoof2019.LA.cm.train.trn.txt").write_text(
                "LA_0001 LA_T_MISSING - A01 spoof\n", encoding="utf-8"
            )
            (protocols / "ASVspoof2019.LA.cm.dev.trl.txt").write_text("", encoding="utf-8")

            with self.assertRaisesRegex(ValueError, "missing audio"):
                build_manifest([], [], Path(temp) / "manifest.csv", [root])


if __name__ == "__main__":
    unittest.main()
