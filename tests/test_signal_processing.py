import base64
import io
import unittest
import wave
from math import pi, sin

import numpy as np

from backend.audio_io import decode_audio
from backend.inference import BaselineInferenceEngine
from backend.spectrogram import SpectrogramRenderer, cosine_similarity, voice_embedding
from backend.streaming import AudioChunk


def tone_chunk(frequency: float = 440, seconds: float = 3) -> AudioChunk:
    rate = 16_000
    samples = np.array(
        [sin(2 * pi * frequency * index / rate) * 0.4 for index in range(int(rate * seconds))]
    )
    pcm = (samples * 32767).astype("<i2").tobytes()
    return AudioChunk(pcm=pcm, start_sample=0, sample_rate=rate)


class SignalProcessingTests(unittest.TestCase):
    def test_uploaded_audio_is_resampled_to_runtime_rate(self):
        output = io.BytesIO()
        with wave.open(output, "wb") as handle:
            handle.setnchannels(1)
            handle.setsampwidth(2)
            handle.setframerate(8_000)
            handle.writeframes(bytes(8_000 * 2))

        decoded = decode_audio(output.getvalue(), target_rate=16_000)
        self.assertEqual(decoded.size, 16_000)

    def test_baseline_returns_bounded_score_and_metrics(self):
        result = BaselineInferenceEngine().score(tone_chunk())

        self.assertGreaterEqual(result.fake_probability, 0)
        self.assertLessEqual(result.fake_probability, 1)
        self.assertEqual(result.signal_state, "speech")
        self.assertEqual(result.embedding.shape, (34,))

    def test_spectrogram_is_a_png(self):
        encoded = SpectrogramRenderer(width=180, height=80).render_base64(tone_chunk())
        self.assertTrue(base64.b64decode(encoded).startswith(b"\x89PNG\r\n\x1a\n"))

    def test_voice_similarity_is_bounded(self):
        first = voice_embedding(np.linspace(-0.5, 0.5, 8000, dtype=np.float32))
        second = voice_embedding(np.linspace(-0.5, 0.5, 8000, dtype=np.float32))
        self.assertAlmostEqual(cosine_similarity(first, second), 1.0)


if __name__ == "__main__":
    unittest.main()
