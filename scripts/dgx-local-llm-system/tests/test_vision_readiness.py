import json
import sys
import tempfile
import unittest
from pathlib import Path


MODULE_DIR = Path(__file__).resolve().parents[1]
if str(MODULE_DIR) not in sys.path:
    sys.path.insert(0, str(MODULE_DIR))

from model_profiles import load_model_profile_manifest  # noqa: E402
from vision_readiness import assess_runtime_readiness  # noqa: E402


class VisionReadinessTests(unittest.TestCase):
    def test_blue_declares_vision_ready(self):
        with tempfile.TemporaryDirectory() as tmp:
            manifest = Path(tmp) / "manifest.json"
            manifest.write_text(
                json.dumps(
                    {
                        "modelProfileId": "business_qwen36_27b_nvfp4",
                        "displayNameJa": "27B",
                        "backend": "blue",
                        "servedAlias": "system-prod-primary",
                        "declaredCapabilities": ["text", "vision"],
                    }
                ),
                encoding="utf-8",
            )
            profile = load_model_profile_manifest(manifest)
            ready, reason = assess_runtime_readiness(profile)
            self.assertEqual(ready, ("text", "vision"))
            self.assertEqual(reason, "blue_native_vlm")

    def test_green_without_mmproj_in_log_is_not_vision_ready(self):
        with tempfile.TemporaryDirectory() as tmp:
            manifest = Path(tmp) / "manifest.json"
            log_path = Path(tmp) / "llama-server.log"
            log_path.write_text("started pid=1\n", encoding="utf-8")
            manifest.write_text(
                json.dumps(
                    {
                        "modelProfileId": "business_qwen35_35b_gguf",
                        "displayNameJa": "35B",
                        "backend": "green",
                        "servedAlias": "system-prod-primary",
                        "declaredCapabilities": ["text", "vision"],
                        "visionRequiresMmproj": True,
                    }
                ),
                encoding="utf-8",
            )
            profile = load_model_profile_manifest(manifest)
            ready, reason = assess_runtime_readiness(profile, llama_log_path=str(log_path))
            self.assertEqual(ready, ("text",))
            self.assertEqual(reason, "mmproj_missing")

    def test_green_with_mmproj_in_start_env_is_vision_ready(self):
        with tempfile.TemporaryDirectory() as tmp:
            manifest = Path(tmp) / "manifest.json"
            manifest.write_text(
                json.dumps(
                    {
                        "modelProfileId": "business_qwen35_35b_gguf",
                        "displayNameJa": "35B",
                        "backend": "green",
                        "servedAlias": "system-prod-primary",
                        "declaredCapabilities": ["text", "vision"],
                        "visionRequiresMmproj": True,
                    }
                ),
                encoding="utf-8",
            )
            profile = load_model_profile_manifest(manifest)
            ready, reason = assess_runtime_readiness(
                profile,
                start_env={"LLAMA_SERVER_MMPROJ": "/srv/dgx/shared-models/llm/gguf/mmproj-F16.gguf"},
            )
            self.assertEqual(ready, ("text", "vision"))
            self.assertEqual(reason, "mmproj_configured")

    def test_green_with_mmproj_in_log_is_vision_ready(self):
        with tempfile.TemporaryDirectory() as tmp:
            manifest = Path(tmp) / "manifest.json"
            log_path = Path(tmp) / "llama-server.log"
            log_path.write_text("mmproj=/srv/dgx/shared-models/llm/gguf/mmproj-F16.gguf\n", encoding="utf-8")
            manifest.write_text(
                json.dumps(
                    {
                        "modelProfileId": "business_qwen35_35b_gguf",
                        "displayNameJa": "35B",
                        "backend": "green",
                        "servedAlias": "system-prod-primary",
                        "declaredCapabilities": ["text", "vision"],
                        "visionRequiresMmproj": True,
                    }
                ),
                encoding="utf-8",
            )
            profile = load_model_profile_manifest(manifest)
            ready, reason = assess_runtime_readiness(profile, llama_log_path=str(log_path))
            self.assertEqual(ready, ("text", "vision"))
            self.assertEqual(reason, "mmproj_detected")


if __name__ == "__main__":
    unittest.main()
