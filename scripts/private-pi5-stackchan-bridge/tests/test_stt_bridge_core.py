import importlib.util
import sys
import unittest
from pathlib import Path
from urllib.error import URLError


MODULE_DIR = Path(__file__).resolve().parents[1]
MODULE_PATH = MODULE_DIR / "stt_bridge_core.py"


def load_module():
    if str(MODULE_DIR) not in sys.path:
        sys.path.insert(0, str(MODULE_DIR))
    spec = importlib.util.spec_from_file_location("stt_bridge_core", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class FakeSttClient:
    def __init__(self, text="こんにちは", err=None):
        self._text = text
        self._err = err

    def transcribe(self, audio_bytes, content_type, language, model):
        if self._err is not None:
            raise self._err
        return self._text, {"provider": "fake"}


class SttBridgeCoreTests(unittest.TestCase):
    def test_validate_stt_json_payload_accepts_audio_base64(self):
        module = load_module()
        req, err = module.validate_stt_json_payload(
            {"audioBase64": "AQID", "contentType": "audio/wav", "language": "ja", "model": "whisper-1"}
        )
        self.assertIsNone(err)
        self.assertIsNotNone(req)
        self.assertEqual(req.audio_bytes, b"\x01\x02\x03")
        self.assertEqual(req.language, "ja")
        self.assertEqual(req.model, "whisper-1")

    def test_validate_stt_json_payload_rejects_missing_audio(self):
        module = load_module()
        req, err = module.validate_stt_json_payload({"language": "ja"})
        self.assertIsNone(req)
        self.assertEqual(err, "audioBase64 is required")

    def test_workflow_maps_urlerror_to_retryable_failure(self):
        module = load_module()
        req = module.ValidatedSttRequest(audio_bytes=b"\x00\x01", content_type="audio/wav", language="ja", model=None)
        workflow = module.SttWorkflow(FakeSttClient(err=URLError("network down")))
        out = workflow.run(req)
        self.assertIsInstance(out, module.SttFailure)
        self.assertEqual(out.code, "STT_UPSTREAM_UNREACHABLE")
        self.assertTrue(out.retryable)


if __name__ == "__main__":
    unittest.main()
