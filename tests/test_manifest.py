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
            self.assertEqual({row["split"] for row in rows}, {"train", "dev"})

    def test_reads_speaker_and_language_from_nested_folders(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            person = root / "sarvam_cloned" / "harish"
            language = person / "tamil"
            language.mkdir(parents=True)
            (language / "harish_tamil_fake1.flac").touch()
            output = root / "manifest.csv"

            self.assertEqual(build_manifest([], [person], output), 1)
            with output.open(newline="", encoding="utf-8") as handle:
                row = next(csv.DictReader(handle))

            self.assertEqual(row["source"], "harish")
            self.assertEqual(row["speaker"], "harish")
            self.assertEqual(row["language"], "ta")
            self.assertEqual(row["split"], "train")

    def test_keeps_team_speakers_wholly_in_one_split(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            real_dirs = []
            fake_dirs = []
            for index in range(6):
                speaker = f"speaker{index}"
                real = root / "team_recordings" / speaker
                fake = root / "sarvam_cloned" / speaker
                real.mkdir(parents=True)
                fake.mkdir(parents=True)
                (real / f"{speaker}__tamil__real.flac").touch()
                (fake / f"{speaker}__tamil__fake.flac").touch()
                real_dirs.append(real)
                fake_dirs.append(fake)

            output = root / "manifest.csv"
            build_manifest(real_dirs, fake_dirs, output)
            with output.open(newline="", encoding="utf-8") as handle:
                rows = list(csv.DictReader(handle))

            splits_by_speaker = {
                speaker: {row["split"] for row in rows if row["speaker"] == speaker}
                for speaker in {row["speaker"] for row in rows}
            }
            self.assertTrue(all(len(splits) == 1 for splits in splits_by_speaker.values()))
            self.assertEqual(
                sum(splits == {"train"} for splits in splits_by_speaker.values()), 5
            )
            self.assertEqual(sum(splits == {"dev"} for splits in splits_by_speaker.values()), 1)

    def test_row_level_source_gets_reproducible_eighty_twenty_split(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "cdac_tamil"
            root.mkdir()
            for index in range(10):
                (root / f"cdac__tamil__{index:04d}.flac").touch()

            first = Path(temp) / "first.csv"
            second = Path(temp) / "second.csv"
            kwargs = {"row_level_sources": {"cdac_tamil"}, "split_seed": 42}
            build_manifest([root], [], first, **kwargs)
            build_manifest([root], [], second, **kwargs)

            with first.open(newline="", encoding="utf-8") as handle:
                first_rows = list(csv.DictReader(handle))
            with second.open(newline="", encoding="utf-8") as handle:
                second_rows = list(csv.DictReader(handle))

            self.assertEqual([row["split"] for row in first_rows], [row["split"] for row in second_rows])
            self.assertEqual(sum(row["split"] == "train" for row in first_rows), 8)
            self.assertEqual(sum(row["split"] == "dev" for row in first_rows), 2)

    def test_speaker_split_balances_rows_without_leakage(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "odia_tts"
            for speaker, clip_count in {"s1": 8, "s2": 5, "s3": 4, "s4": 2, "s5": 1}.items():
                language = root / speaker / "odia"
                language.mkdir(parents=True)
                for index in range(clip_count):
                    (language / f"{speaker}_{index}.flac").touch()

            output = Path(temp) / "manifest.csv"
            build_manifest([root], [], output)
            with output.open(newline="", encoding="utf-8") as handle:
                rows = list(csv.DictReader(handle))

            self.assertEqual({row["language"] for row in rows}, {"or"})
            self.assertTrue(
                all(
                    len({row["split"] for row in rows if row["speaker"] == speaker}) == 1
                    for speaker in {row["speaker"] for row in rows}
                )
            )
            self.assertLessEqual(abs(sum(row["split"] == "train" for row in rows) - 16), 1)

    def test_excludes_normalized_language_without_deleting_other_speaker_rows(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "team_recordings" / "speaker1"
            hindi = root / "hindi"
            tamil = root / "tamil"
            hindi.mkdir(parents=True)
            tamil.mkdir()
            (hindi / "hindi.flac").touch()
            (tamil / "tamil.flac").touch()
            output = Path(temp) / "manifest.csv"

            build_manifest([root], [], output, exclude_languages={"hindi"})
            with output.open(newline="", encoding="utf-8") as handle:
                rows = list(csv.DictReader(handle))

            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]["speaker"], "speaker1")
            self.assertEqual(rows[0]["language"], "ta")

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
