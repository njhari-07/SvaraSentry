import unittest

from backend.streaming import PCMChunker


class PCMChunkerTests(unittest.TestCase):
    def test_emits_overlapping_windows_across_arbitrary_frames(self):
        chunker = PCMChunker(sample_rate=10, window_seconds=3, stride_seconds=1)
        frames = [bytes(20), bytes(30), bytes(30)]  # 40 samples total
        chunks = chunker.extend(frames)

        self.assertEqual(len(chunks), 2)
        self.assertEqual([chunk.start_sample for chunk in chunks], [0, 10])
        self.assertEqual([chunk.sample_count for chunk in chunks], [30, 30])
        self.assertEqual([chunk.timestamp for chunk in chunks], [3.0, 4.0])

    def test_rejects_partial_samples(self):
        with self.assertRaises(ValueError):
            PCMChunker().push(b"x")


if __name__ == "__main__":
    unittest.main()

