#!/usr/bin/env python3
import importlib.util
import shutil
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
APPLY_SCRIPT = REPO_ROOT / "scripts/stackchan-ai-stackchan-ex/apply_stt_private_bridge.py"
FIXTURE_CPP = (
    REPO_ROOT
    / "scripts/stackchan-ai-stackchan-ex/tests/fixtures/upstream_CloudSpeechClient.cpp"
)


def load_apply_module():
    spec = importlib.util.spec_from_file_location("apply_stt_private_bridge", APPLY_SCRIPT)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def fixture_target(tmp: Path) -> Path:
    target = tmp / "AI_StackChan_Ex/firmware/src/stt/CloudSpeechClient.cpp"
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(FIXTURE_CPP, target)
    return target


class ApplySttPrivateBridgeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.apply = load_apply_module()
        if not FIXTURE_CPP.is_file():
            raise unittest.SkipTest(f"missing fixture: {FIXTURE_CPP}")

    def test_idempotent_on_upstream_cloudspeech_client(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = fixture_target(Path(tmp))
            self.assertTrue(self.apply.apply(target))
            first = target.read_text(encoding="utf-8")
            self.assertIn(self.apply.MARKER, first)
            self.assertFalse(self.apply.apply(target))
            second = target.read_text(encoding="utf-8")
            self.assertEqual(first, second)

    def test_revert_restores_upstream_shape(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = fixture_target(Path(tmp))
            original = target.read_text(encoding="utf-8")
            self.apply.apply(target)
            self.assertTrue(self.apply.revert(target))
            reverted = target.read_text(encoding="utf-8")
            self.assertNotIn(self.apply.PATCH_BEGIN, reverted)
            self.assertNotIn("TranscribeAudioViaBridge", reverted)
            self.assertIn("String CloudSpeechClient::speech_to_text(){", reverted)

    def test_no_concrete_host_literals_in_script(self):
        text = APPLY_SCRIPT.read_text(encoding="utf-8")
        self.assertNotIn("192.168.", text)
        self.assertNotIn("18080", text)


if __name__ == "__main__":
    unittest.main()
