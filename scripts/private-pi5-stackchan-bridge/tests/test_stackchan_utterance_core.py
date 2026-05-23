import importlib.util
import sys
import unittest
from pathlib import Path
from urllib.error import HTTPError


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


utterance = load_module("stackchan_utterance_core", "stackchan_utterance_core.py")
chat_core = load_module("stackchan_chat_core", "stackchan_chat_core.py")
stt_core = load_module("stt_bridge_core", "stt_bridge_core.py")


class FakeSttClient:
    def __init__(self, text: str = "こんにちは", fail: Exception | None = None):
        self.text = text
        self.fail = fail

    def transcribe(self, audio_bytes: bytes, content_type: str, language: str | None, model: str | None):
        if self.fail:
            raise self.fail
        return self.text, {"provider": "fake"}


class FakeDgxClient:
    def __init__(self):
        self.auto_start = False
        self.last_body = None

    def post_chat_completions(self, body: bytes):
        self.last_body = body
        return (
            200,
            {
                "choices": [{"message": {"content": "こんにちは、調子はどう？"}}],
                "model": "system-prod-primary",
            },
        )

    def ensure_runtime_ready(self):
        return False, {}


class UtteranceCoreTests(unittest.TestCase):
    def test_validate_utterance_json_payload(self):
        validated, err = utterance.validate_utterance_json_payload(
            {
                "audioBase64": "aGVsbG8=",
                "messages": [{"role": "assistant", "content": "前の返事"}],
            }
        )
        self.assertIsNone(err)
        self.assertIsNotNone(validated)
        assert validated is not None
        self.assertEqual(len(validated.prior_messages), 1)

    def test_utterance_workflow_success(self):
        stt_wf = stt_core.SttWorkflow(FakeSttClient())
        chat_wf = chat_core.ChatCompletionWorkflow(FakeDgxClient(), "system-prod-primary")
        wf = utterance.UtteranceWorkflow(stt_wf, chat_wf)
        validated, _ = utterance.validate_utterance_json_payload({"audioBase64": "aGVsbG8="})
        assert validated is not None
        outcome = wf.run(validated)
        self.assertIsInstance(outcome, utterance.UtteranceSuccess)
        self.assertEqual(outcome.stt_text, "こんにちは")
        payload = utterance.format_utterance_success(outcome)
        self.assertEqual(payload["replyText"], "こんにちは、調子はどう？")

    def test_utterance_workflow_stt_empty(self):
        stt_wf = stt_core.SttWorkflow(FakeSttClient(text="   "))
        chat_wf = chat_core.ChatCompletionWorkflow(FakeDgxClient(), "system-prod-primary")
        wf = utterance.UtteranceWorkflow(stt_wf, chat_wf)
        validated, _ = utterance.validate_utterance_json_payload({"audioBase64": "aGVsbG8="})
        assert validated is not None
        outcome = wf.run(validated)
        self.assertIsInstance(outcome, utterance.UtteranceFailure)
        self.assertEqual(outcome.code, "STT_EMPTY")
        self.assertEqual(outcome.stage, "stt")


if __name__ == "__main__":
    unittest.main()
