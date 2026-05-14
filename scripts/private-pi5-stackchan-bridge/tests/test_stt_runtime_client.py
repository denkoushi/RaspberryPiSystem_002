import importlib.util
import sys
import unittest
from pathlib import Path
from unittest.mock import patch


MODULE_DIR = Path(__file__).resolve().parents[1]
MODULE_PATH = MODULE_DIR / "stt_runtime_client.py"


def load_module():
    if str(MODULE_DIR) not in sys.path:
        sys.path.insert(0, str(MODULE_DIR))
    spec = importlib.util.spec_from_file_location("stt_runtime_client", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class FakeSegment:
    def __init__(self, text):
        self.text = text


class FakeWhisperModel:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def transcribe(self, path, language=None, vad_filter=True):
        self.calls.append({"path": path, "language": language, "vad_filter": vad_filter})
        text = self.responses.pop(0)
        return [FakeSegment(text)] if text else [], object()


class SttRuntimeClientTests(unittest.TestCase):
    def test_local_transcribe_retries_without_vad_when_short_speech_is_empty(self):
        module = load_module()
        client = module.SttRuntimeClient(
            module.SttRuntimeConfig(
                provider="faster-whisper-local",
                local_language_default="ja",
                local_vad_filter=True,
                local_retry_without_vad=True,
            )
        )
        fake_model = FakeWhisperModel(["", " スタック "])
        client._whisper_model = fake_model

        text, details = client.transcribe(b"RIFF....WAVE", "audio/wav", None, None)

        self.assertEqual(text, "スタック")
        self.assertEqual(details["retryWithoutVad"], True)
        self.assertEqual(fake_model.calls[0]["language"], "ja")
        self.assertEqual(fake_model.calls[0]["vad_filter"], True)
        self.assertIsNone(fake_model.calls[1]["language"])
        self.assertEqual(fake_model.calls[1]["vad_filter"], False)

    def test_local_stt_no_retry_when_disabled(self):
        module = load_module()
        cfg = module.SttRuntimeConfig(
            provider="faster-whisper-local",
            local_language_default="ja",
            local_vad_filter=True,
            local_retry_without_vad=False,
        )
        client = module.SttRuntimeClient(cfg)
        fake_model = FakeWhisperModel([""])
        client._whisper_model = fake_model

        text, _details = client.transcribe(
            audio_bytes=b"RIFFxxxx",
            content_type="audio/wav",
            language=None,
            model=None,
        )

        self.assertEqual(text, "")
        self.assertEqual(len(fake_model.calls), 1)

    def test_config_from_env_reads_new_stt_flags(self):
        module = load_module()
        with patch.dict(
            module.os.environ,
            {
                "STT_LOCAL_LANGUAGE_DEFAULT": "ja",
                "STT_LOCAL_VAD_FILTER": "true",
                "STT_LOCAL_RETRY_WITHOUT_VAD": "true",
                "STT_LOCAL_FALLBACK_TO_UPSTREAM_ON_EMPTY": "false",
            },
            clear=False,
        ):
            cfg = module.config_from_env()
        self.assertEqual(cfg.local_language_default, "ja")
        self.assertTrue(cfg.local_vad_filter)
        self.assertTrue(cfg.local_retry_without_vad)
        self.assertFalse(cfg.local_fallback_to_upstream_on_empty)

    def test_local_stt_falls_back_to_upstream_on_empty(self):
        module = load_module()
        cfg = module.SttRuntimeConfig(
            provider="faster-whisper-local",
            local_retry_without_vad=False,
            local_fallback_to_upstream_on_empty=True,
            upstream_model="whisper-1",
        )
        client = module.SttRuntimeClient(cfg)
        client._whisper_model = FakeWhisperModel([""])

        with patch.object(module.SttRuntimeClient, "_transcribe_upstream", return_value="明日の天気") as upstream:
            text, details = client.transcribe(
                audio_bytes=b"RIFFxxxx",
                content_type="audio/wav",
                language="ja",
                model=None,
            )

        self.assertEqual(text, "明日の天気")
        self.assertTrue(details.get("fallbackUsed"))
        self.assertEqual(details.get("fallbackProvider"), "upstream-openai")
        upstream.assert_called_once()


if __name__ == "__main__":
    unittest.main()
