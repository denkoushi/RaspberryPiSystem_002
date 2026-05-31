import importlib.util
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch


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


device_mod = load_module("stackchan_device_client", "stackchan_device_client.py")


class StackChanDeviceClientTests(unittest.TestCase):
    def test_playback_prefers_audio_url(self):
        client = device_mod.StackChanDeviceClient(
            device_mod.StackChanDeviceConfig(base_url="http://192.168.1.10", enabled=True)
        )
        with patch.object(client, "play_audio_url", return_value=(True, "ok")) as play_audio:
            with patch.object(client, "speech_text") as speech:
                ok, detail = client.playback(audio_url="http://pi5/audio/x.wav", reply_text="hi")
        self.assertTrue(ok)
        play_audio.assert_called_once()
        speech.assert_not_called()

    def test_playback_falls_back_to_speech(self):
        client = device_mod.StackChanDeviceClient(
            device_mod.StackChanDeviceConfig(base_url="http://192.168.1.10", enabled=True)
        )
        with patch.object(client, "play_audio_url", return_value=(False, "fail")):
            with patch.object(client, "speech_text", return_value=(True, "speech")) as speech:
                ok, detail = client.playback(audio_url="http://pi5/audio/x.wav", reply_text="hi")
        self.assertTrue(ok)
        speech.assert_called_once_with("hi")


if __name__ == "__main__":
    unittest.main()
