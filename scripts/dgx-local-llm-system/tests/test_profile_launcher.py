import json
import sys
import tempfile
import unittest
from pathlib import Path


MODULE_DIR = Path(__file__).resolve().parents[1]
if str(MODULE_DIR) not in sys.path:
    sys.path.insert(0, str(MODULE_DIR))

from model_profiles import load_model_profile_manifest  # noqa: E402
from profile_launcher import launcher_env_for_profile  # noqa: E402


class ProfileLauncherTests(unittest.TestCase):
    def test_maps_launcher_hints_to_env(self):
        with tempfile.TemporaryDirectory() as tmp:
            manifest = Path(tmp) / "manifest.json"
            manifest.write_text(
                json.dumps(
                    {
                        "modelProfileId": "business_qwen35_35b_gguf",
                        "displayNameJa": "35B",
                        "backend": "green",
                        "servedAlias": "system-prod-primary",
                        "launcherHints": {
                            "llamaServerModel": "/srv/dgx/shared-models/llm/gguf/model.gguf",
                            "llamaServerMmproj": "/srv/dgx/shared-models/llm/gguf/mmproj-F16.gguf",
                        },
                    }
                ),
                encoding="utf-8",
            )
            profile = load_model_profile_manifest(manifest)
            env = launcher_env_for_profile(profile)
            self.assertEqual(env["LLAMA_SERVER_MODEL"], "/srv/dgx/shared-models/llm/gguf/model.gguf")
            self.assertEqual(env["LLAMA_SERVER_MMPROJ"], "/srv/dgx/shared-models/llm/gguf/mmproj-F16.gguf")


if __name__ == "__main__":
    unittest.main()
