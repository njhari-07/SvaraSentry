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

    def test_default_cadence_first_three_seconds_then_one_second_stride(self):
        chunker = PCMChunker()
        self.assertEqual(chunker.push(bytes(16000 * 2 * 2)), [])
        first = chunker.push(bytes(16000 * 2))
        self.assertEqual([chunk.timestamp for chunk in first], [3.0])
        rest = chunker.push(bytes(16000 * 2 * 3))
        self.assertEqual([chunk.timestamp for chunk in rest], [4.0, 5.0, 6.0])
        self.assertEqual([chunk.start_sample / 16000 for chunk in rest], [1.0, 2.0, 3.0])
        self.assertTrue(all(chunk.sample_count == 48000 for chunk in first + rest))


if __name__ == "__main__":
    unittest.main()

