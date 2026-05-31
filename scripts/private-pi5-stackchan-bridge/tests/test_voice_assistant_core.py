import importlib.util
import sys
import unittest
from pathlib import Path


MODULE_DIR = Path(__file__).resolve().parents[1]


def load_module(name: str, filename: str):
    if str(MODULE_DIR) not in sys.path:
        sys.path.insert(0, str(MODULE_DIR))
    path = MODULE_DIR / filename
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


voice = load_module("voice_assistant_core", "voice_assistant_core.py")
stt_core = load_module("stt_bridge_core", "stt_bridge_core.py")
chat_core = load_module("stackchan_chat_core", "stackchan_chat_core.py")


class FakeSttClient:
    def __init__(self, text: str = "こんにちは", fail: Exception | None = None):
        self.text = text
        self.fail = fail

    def transcribe(self, audio_bytes, content_type, language, model):
        if self.fail:
            raise self.fail
        return self.text, {"provider": "fake"}


class FakeDgxClient:
    auto_start = False

    def post_chat_completions(self, body: bytes):
        return (
            200,
            {
                "choices": [{"message": {"content": "返事です"}}],
                "model": "system-prod-primary",
            },
        )

    def ensure_runtime_ready(self):
        return False, {}


class FakeVoicevox:
    enabled = True

    def synthesize_wav(self, text: str) -> bytes:
        return b"RIFFxxxx"


class FakeAudioStore:
    def put(self, wav_bytes: bytes, content_type: str = "audio/wav") -> str:
        return "audio123"


class FakeDevice:
    enabled = True
    states: list[str] = []

    def set_state(self, state: str):
        self.states.append(state)
        return True, "ok"

    def playback(self, *, audio_url: str | None, reply_text: str):
        return True, f"played {audio_url}"


class VoiceAssistantCoreTests(unittest.TestCase):
    def test_validate_voice_turn_json_payload(self):
        validated, err = voice.validate_voice_turn_json_payload(
            {"audioBase64": "aGVsbG8=", "emotion": "happy"}
        )
        self.assertIsNone(err)
        self.assertIsNotNone(validated)
        assert validated is not None
        self.assertEqual(validated.emotion, "happy")

    def test_voice_turn_success(self):
        wf = voice.VoiceTurnWorkflow(
            stt_core.SttWorkflow(FakeSttClient()),
            chat_core.ChatCompletionWorkflow(FakeDgxClient(), "system-prod-primary", None),
            FakeVoicevox(),
            FakeAudioStore(),
            FakeDevice(),
            "http://127.0.0.1:18080",
        )
        validated, _ = voice.validate_voice_turn_json_payload({"audioBase64": "aGVsbG8="})
        assert validated is not None
        outcome = wf.run(validated)
        self.assertIsInstance(outcome, voice.VoiceTurnSuccess)
        self.assertTrue(outcome.audio_url.endswith("audio123.wav"))
        payload = voice.format_voice_turn_success(outcome)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["sttText"], "こんにちは")

    def test_is_loopback_bridge_audio_url(self):
        base = "http://192.168.128.112:18080"
        self.assertTrue(
            voice.is_loopback_bridge_audio_url(
                "http://192.168.128.112:18080/api/stackchan/audio/abc.wav",
                base,
            )
        )
        self.assertFalse(
            voice.is_loopback_bridge_audio_url("http://other.host/audio.wav", base)
        )

    def test_voice_turn_skips_loopback_device_playback(self):
        device = FakeDevice()

        class OkVoicevox:
            enabled = True

            def synthesize_wav(self, text: str) -> bytes:
                return b"RIFF"

        wf = voice.VoiceTurnWorkflow(
            stt_core.SttWorkflow(FakeSttClient()),
            chat_core.ChatCompletionWorkflow(FakeDgxClient(), "m", None),
            OkVoicevox(),
            FakeAudioStore(),
            device,
            "http://192.168.128.112:18080",
        )
        validated, _ = voice.validate_voice_turn_json_payload(
            {"audioBase64": "aGVsbG8=", "triggerDevicePlayback": True}
        )
        assert validated is not None
        with unittest.mock.patch.object(device, "playback") as playback_mock:
            outcome = wf.run(validated)
        playback_mock.assert_not_called()
        self.assertIsInstance(outcome, voice.VoiceTurnSuccess)
        self.assertTrue(outcome.device_playback_ok)
        self.assertIn("deferred loopback", outcome.device_playback_detail)

    def test_resolve_public_audio_base_url_no_loopback_default(self):
        import os

        env = os.environ
        saved = {k: env.get(k) for k in ("VOICE_AUDIO_PUBLIC_BASE_URL", "VOICE_AUDIO_PUBLIC_HOST")}
        try:
            env.pop("VOICE_AUDIO_PUBLIC_BASE_URL", None)
            env.pop("VOICE_AUDIO_PUBLIC_HOST", None)
            self.assertIsNone(voice.resolve_public_audio_base_url("0.0.0.0", 18080))
            env["VOICE_AUDIO_PUBLIC_BASE_URL"] = "http://192.168.128.112:18080"
            self.assertEqual(
                voice.resolve_public_audio_base_url("0.0.0.0", 18080),
                "http://192.168.128.112:18080",
            )
        finally:
            for k, v in saved.items():
                if v is None:
                    env.pop(k, None)
                else:
                    env[k] = v

    def test_validate_rejects_oversized_audio(self):
        import os

        saved = os.environ.get("VOICE_TURN_MAX_AUDIO_BYTES")
        os.environ["VOICE_TURN_MAX_AUDIO_BYTES"] = "4"
        try:
            _, err = voice.validate_voice_turn_json_payload({"audioBase64": "aGVsbG8gd29ybGQ="})
            self.assertIsNotNone(err)
            assert err is not None
            self.assertIn("exceeds limit", err)
        finally:
            if saved is None:
                os.environ.pop("VOICE_TURN_MAX_AUDIO_BYTES", None)
            else:
                os.environ["VOICE_TURN_MAX_AUDIO_BYTES"] = saved

    def test_voice_turn_tts_failure_uses_speech_fallback(self):
        class FailingVoicevox:
            enabled = True

            def synthesize_wav(self, text: str) -> bytes:
                raise RuntimeError("voicevox down")

        device = FakeDevice()
        wf = voice.VoiceTurnWorkflow(
            stt_core.SttWorkflow(FakeSttClient()),
            chat_core.ChatCompletionWorkflow(FakeDgxClient(), "m", None),
            FailingVoicevox(),
            FakeAudioStore(),
            device,
            "http://192.168.128.112:18080",
        )
        validated, _ = voice.validate_voice_turn_json_payload({"audioBase64": "aGVsbG8="})
        assert validated is not None
        outcome = wf.run(validated)
        self.assertIsInstance(outcome, voice.VoiceTurnSuccess)
        self.assertEqual(outcome.audio_url, "")
        self.assertTrue(outcome.device_playback_ok)

    def test_voice_turn_stt_empty(self):
        wf = voice.VoiceTurnWorkflow(
            stt_core.SttWorkflow(FakeSttClient(text="   ")),
            chat_core.ChatCompletionWorkflow(FakeDgxClient(), "m", None),
            FakeVoicevox(),
            FakeAudioStore(),
            FakeDevice(),
            "http://127.0.0.1:18080",
        )
        validated, _ = voice.validate_voice_turn_json_payload({"audioBase64": "aGVsbG8="})
        assert validated is not None
        outcome = wf.run(validated)
        self.assertIsInstance(outcome, voice.VoiceTurnFailure)
        self.assertEqual(outcome.stage, "stt")
        self.assertEqual(outcome.code, "STT_EMPTY")


if __name__ == "__main__":
    unittest.main()
