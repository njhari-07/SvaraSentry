import io
import unittest
import wave

from fastapi.testclient import TestClient

from backend.main import app


def wav_bytes(seconds: int = 3) -> bytes:
    output = io.BytesIO()
    with wave.open(output, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(16_000)
        handle.writeframes(bytes(16_000 * seconds * 2))
    return output.getvalue()


class APITests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_health_and_config_report_runtime_mode(self):
        health = self.client.get("/health")
        config = self.client.get("/api/config")

        self.assertEqual(health.status_code, 200)
        self.assertEqual(health.json()["status"], "ok")
        self.assertEqual(config.json()["sample_rate"], 16_000)
        self.assertTrue(config.json()["baseline_disclaimer"])

    def test_product_surfaces_are_served(self):
        self.assertIn("SvaraSentry", self.client.get("/").text)
        self.assertIn("Phone relay", self.client.get("/phone").text)

    def test_audio_socket_emits_complete_result_contract(self):
        with self.client.websocket_connect("/ws/audio/api-test") as socket:
            for _ in range(12):
                socket.send_bytes(bytes(8_000))
            result = socket.receive_json()

        self.assertEqual(result["type"], "result")
        self.assertEqual(result["chunk_index"], 1)
        self.assertEqual(result["timestamp"], 3.0)
        self.assertIn(result["alert_level"], {"none", "caution", "high"})
        self.assertTrue(result["spectrogram_png_b64"])
        self.assertIn("rms_dbfs", result["signal"])

    def test_audio_socket_rejects_oversized_frames(self):
        with self.client.websocket_connect("/ws/audio/frame-limit-test") as socket:
            socket.send_bytes(bytes(64_001))
            result = socket.receive_json()

        self.assertEqual(result["type"], "error")
        self.assertIn("size limit", result["message"])

    def test_enrollment_lifecycle(self):
        session = "enrollment-test"
        response = self.client.post(
            f"/api/sessions/{session}/enrollment",
            files={"audio": ("reference.wav", wav_bytes(), "audio/wav")},
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(self.client.get(f"/api/sessions/{session}").json()["voice_enrolled"])

        deleted = self.client.delete(f"/api/sessions/{session}/enrollment")
        self.assertEqual(deleted.status_code, 200)
        self.assertFalse(self.client.get(f"/api/sessions/{session}").json()["voice_enrolled"])

    def test_short_enrollment_is_rejected(self):
        response = self.client.post(
            "/api/sessions/short-enrollment/enrollment",
            files={"audio": ("reference.wav", wav_bytes(seconds=1), "audio/wav")},
        )
        self.assertEqual(response.status_code, 422)

    def test_pairing_token_flow(self):
        session = "pairing-test"
        response = self.client.post(f"/api/sessions/{session}/pairing-token")
        self.assertEqual(response.status_code, 200)
        token = response.json()["token"]
        self.assertTrue(token)

        # Connect with token
        with self.client.websocket_connect(f"/ws/audio/pair/{token}") as socket:
            socket.send_bytes(bytes(8_000))
            result = socket.receive_json()
        
        self.assertEqual(result["type"], "result")
        self.assertEqual(result["chunk_index"], 1)
        
        # Token should be consumed, connecting again should fail
        with self.assertRaises(Exception):
            with self.client.websocket_connect(f"/ws/audio/pair/{token}"):
                pass


if __name__ == "__main__":
    unittest.main()
