import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "mac_usb_dev.sh"


class MacUsbDevSafeModeTests(unittest.TestCase):
    def test_safe_mode_default_skips_voice_overlay(self):
        text = SCRIPT.read_text(encoding="utf-8")
        self.assertIn("STACKCHAN_ENABLE_VOICE_OVERLAY", text)
        self.assertIn('STACKCHAN_ENABLE_VOICE_OVERLAY="${STACKCHAN_ENABLE_VOICE_OVERLAY:-0}"', text)
        self.assertIn("voice_overlay_enabled", text)
        self.assertIn("revert_firmware_overlays.py", text)
        self.assertIn('python3 "${REVERT_OVERLAYS}"', text)
        self.assertNotIn('python3 "${UTTERANCE_OVERLAY}"', text)
        self.assertNotIn("STACKCHAN_UTTERANCE_URL", text)

    def test_voice_overlay_is_opt_in(self):
        text = SCRIPT.read_text(encoding="utf-8")
        self.assertIn('python3 "${VOICE_OVERLAY}"', text)
        self.assertIn("if voice_overlay_enabled", text)
        self.assertIn("STACKCHAN_VOICE_TURN_URL", text)


if __name__ == "__main__":
    unittest.main()
