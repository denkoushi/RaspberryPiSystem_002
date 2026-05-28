import json
import sys
import tempfile
import unittest
from pathlib import Path


MODULE_DIR = Path(__file__).resolve().parents[1]
if str(MODULE_DIR) not in sys.path:
    sys.path.insert(0, str(MODULE_DIR))

from active_model_state import read_active_model_state, write_active_model_state  # noqa: E402
from model_profiles import DisabledModelProfileError, UnknownModelProfileError, load_model_profiles, validate_startable_profile  # noqa: E402


class ModelProfileTests(unittest.TestCase):
    def write_manifest(self, root: Path, profile_id: str, body: dict) -> None:
        target = root / profile_id
        target.mkdir(parents=True)
        (target / "manifest.json").write_text(json.dumps(body), encoding="utf-8")

    def test_loads_profiles_and_writes_active_state(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "registry"
            storage = Path(tmp) / "hf" / "qwen"
            storage.mkdir(parents=True)
            self.write_manifest(
                root,
                "business_qwen36_27b_nvfp4",
                {
                    "modelProfileId": "business_qwen36_27b_nvfp4",
                    "displayNameJa": "Qwen3.6 27B NVFP4",
                    "backend": "blue",
                    "servedAlias": "system-prod-primary",
                    "sourceModelRef": "sakamakismile/Qwen3.6-27B-NVFP4",
                    "currentStorageLocation": str(storage),
                    "enabled": True,
                    "recommended": True,
                },
            )

            profiles = load_model_profiles(str(root))
            self.assertEqual(len(profiles), 1)
            profile = validate_startable_profile(str(root), "business_qwen36_27b_nvfp4")
            self.assertEqual(profile.backend, "blue")

            state_path = Path(tmp) / "state" / "active-model-profile.json"
            write_active_model_state(str(state_path), profile)
            state = read_active_model_state(str(state_path))
            self.assertIsNotNone(state)
            self.assertEqual(state.model_profile_id, "business_qwen36_27b_nvfp4")
            self.assertEqual(state.backend, "blue")

    def test_unknown_and_disabled_profiles_are_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "registry"
            self.write_manifest(
                root,
                "business_disabled",
                {
                    "modelProfileId": "business_disabled",
                    "displayNameJa": "disabled",
                    "backend": "green",
                    "servedAlias": "system-prod-primary",
                    "enabled": False,
                },
            )

            with self.assertRaises(UnknownModelProfileError):
                validate_startable_profile(str(root), "sakamakismile/Qwen3.6-27B-NVFP4")
            with self.assertRaises(DisabledModelProfileError):
                validate_startable_profile(str(root), "business_disabled")


if __name__ == "__main__":
    unittest.main()
