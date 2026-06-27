import json
import sys
import tempfile
import unittest
from pathlib import Path


MODULE_DIR = Path(__file__).resolve().parents[1]
if str(MODULE_DIR) not in sys.path:
    sys.path.insert(0, str(MODULE_DIR))

from active_model_state import read_active_model_state, write_active_model_state  # noqa: E402
from model_profiles import (  # noqa: E402
    DisabledModelProfileError,
    UnknownModelProfileError,
    load_model_profiles,
    model_profile_to_api,
    profile_storage_available,
    validate_startable_profile,
)
from model_storage_delete import (  # noqa: E402
    ModelStorageDeleteBlockedError,
    build_model_storage_delete_plan,
    delete_preview_to_api,
    execute_model_storage_delete,
)


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
            self.assertEqual(state.declared_capabilities, ("text", "vision"))
            self.assertEqual(state.runtime_ready_capabilities, ("text", "vision"))

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

    def test_profile_available_when_current_storage_location_exists_under_hf_cache_hub(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "registry"
            hub_storage = Path(tmp) / "hf-cache" / "hub" / "models--sakamakismile--Qwen3.6-27B-NVFP4"
            hub_storage.mkdir(parents=True)
            shared_target = Path(tmp) / "shared-models" / "hf" / "sakamakismile" / "Qwen3.6-27B-NVFP4"
            self.write_manifest(
                root,
                "business_qwen36_27b_nvfp4",
                {
                    "modelProfileId": "business_qwen36_27b_nvfp4",
                    "displayNameJa": "Qwen3.6 27B NVFP4",
                    "backend": "blue",
                    "servedAlias": "system-prod-primary",
                    "storageLocation": str(shared_target),
                    "currentStorageLocation": str(hub_storage),
                    "enabled": True,
                },
            )

            profile = load_model_profiles(str(root))[0]
            self.assertTrue(profile_storage_available(profile))
            api = model_profile_to_api(profile)
            self.assertEqual(api["status"], "available")
            validate_startable_profile(str(root), "business_qwen36_27b_nvfp4")

    def test_business_orchestration_eligible_defaults_true_and_can_be_false(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "registry"
            storage = Path(tmp) / "gguf"
            storage.mkdir(parents=True)
            self.write_manifest(
                root,
                "business_qwen36_27b_nvfp4",
                {
                    "modelProfileId": "business_qwen36_27b_nvfp4",
                    "displayNameJa": "Qwen3.6 27B NVFP4",
                    "backend": "blue",
                    "servedAlias": "system-prod-primary",
                    "currentStorageLocation": str(storage),
                    "enabled": True,
                },
            )
            self.write_manifest(
                root,
                "qwen36_35b_uncensored",
                {
                    "modelProfileId": "qwen36_35b_uncensored",
                    "displayNameJa": "uncensored",
                    "backend": "green",
                    "servedAlias": "system-prod-primary",
                    "currentStorageLocation": str(storage),
                    "businessOrchestrationEligible": False,
                    "enabled": True,
                },
            )
            profiles = {p.id: model_profile_to_api(p) for p in load_model_profiles(str(root))}
            self.assertTrue(profiles["business_qwen36_27b_nvfp4"]["businessOrchestrationEligible"])
            self.assertFalse(profiles["qwen36_35b_uncensored"]["businessOrchestrationEligible"])

    def test_declared_capabilities_launcher_hints_and_runtime_profile_in_api(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "registry"
            storage = Path(tmp) / "gguf"
            storage.mkdir(parents=True)
            self.write_manifest(
                root,
                "business_qwen35_35b_gguf",
                {
                    "modelProfileId": "business_qwen35_35b_gguf",
                    "displayNameJa": "35B GGUF",
                    "backend": "green",
                    "servedAlias": "system-prod-primary",
                    "currentStorageLocation": str(storage),
                    "declaredCapabilities": ["text", "vision"],
                    "visionRequiresMmproj": True,
                    "launcherHints": {"llamaServerModel": str(storage / "model.gguf")},
                    "runtimeProfile": {
                        "engine": "llama.cpp",
                        "memoryPolicy": "gguf_business_fallback",
                        "llamaCpp": {"ctxSize": 2048, "parallel": 1, "nGpuLayers": 99},
                    },
                    "enabled": True,
                },
            )
            profile = load_model_profiles(str(root))[0]
            api = model_profile_to_api(profile)
            self.assertEqual(api["declaredCapabilities"], ["text", "vision"])
            self.assertTrue(api["visionRequiresMmproj"])
            self.assertIn("llamaServerModel", api["launcherHints"])
            self.assertEqual(api["runtimeProfile"]["engine"], "llama.cpp")
            self.assertEqual(api["runtimeProfile"]["llamaCpp"]["ctxSize"], 2048)

    def test_profile_unavailable_when_current_storage_location_missing_hub_segment(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "registry"
            hub_storage = Path(tmp) / "hf-cache" / "hub" / "models--sakamakismile--Qwen3.6-27B-NVFP4"
            hub_storage.mkdir(parents=True)
            wrong_current = Path(tmp) / "hf-cache" / "models--sakamakismile--Qwen3.6-27B-NVFP4"
            shared_target = Path(tmp) / "shared-models" / "hf" / "sakamakismile" / "Qwen3.6-27B-NVFP4"
            self.write_manifest(
                root,
                "business_qwen36_27b_nvfp4",
                {
                    "modelProfileId": "business_qwen36_27b_nvfp4",
                    "displayNameJa": "Qwen3.6 27B NVFP4",
                    "backend": "blue",
                    "servedAlias": "system-prod-primary",
                    "storageLocation": str(shared_target),
                    "currentStorageLocation": str(wrong_current),
                    "enabled": True,
                },
            )

            profile = load_model_profiles(str(root))[0]
            self.assertFalse(profile_storage_available(profile))
            api = model_profile_to_api(profile)
            self.assertEqual(api["status"], "unavailable")
            self.assertIn("unavailableReasonJa", api)

    def test_model_storage_delete_preview_and_execute_removes_storage_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "registry"
            storage = Path(tmp) / "hf-cache" / "hub" / "models--org--model"
            storage.mkdir(parents=True)
            (storage / "weights.safetensors").write_bytes(b"x" * 1024)
            self.write_manifest(
                root,
                "business_test_model",
                {
                    "modelProfileId": "business_test_model",
                    "displayNameJa": "Test Model",
                    "backend": "blue",
                    "servedAlias": "system-prod-primary",
                    "currentStorageLocation": str(storage),
                    "enabled": True,
                },
            )
            profile = load_model_profiles(str(root))[0]
            plan = build_model_storage_delete_plan(
                profile,
                all_profiles=[profile],
                active_profile_id=None,
                allowed_roots=(str(Path(tmp) / "hf-cache"),),
                include_size=True,
            )

            self.assertTrue(plan.can_delete)
            self.assertIsNotNone(plan.plan_fingerprint)
            preview = delete_preview_to_api(plan)
            self.assertEqual(preview["requiredConfirmation"], "DELETE business_test_model")
            result = execute_model_storage_delete(
                plan,
                plan_fingerprint=plan.plan_fingerprint or "",
                confirmation="DELETE business_test_model",
            )

            self.assertTrue(result["ok"])
            self.assertFalse(storage.exists())
            self.assertTrue((root / "business_test_model" / "manifest.json").exists())

    def test_model_storage_delete_blocks_active_shared_and_outside_allowed_root(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "registry"
            storage = Path(tmp) / "hf-cache" / "hub" / "models--org--shared"
            storage.mkdir(parents=True)
            self.write_manifest(
                root,
                "business_active",
                {
                    "modelProfileId": "business_active",
                    "displayNameJa": "Active",
                    "backend": "blue",
                    "servedAlias": "system-prod-primary",
                    "currentStorageLocation": str(storage),
                    "enabled": True,
                },
            )
            self.write_manifest(
                root,
                "business_shared",
                {
                    "modelProfileId": "business_shared",
                    "displayNameJa": "Shared",
                    "backend": "blue",
                    "servedAlias": "system-prod-primary",
                    "currentStorageLocation": str(storage),
                    "enabled": True,
                },
            )
            active, shared = load_model_profiles(str(root))

            active_plan = build_model_storage_delete_plan(
                active,
                all_profiles=[active, shared],
                active_profile_id="business_active",
                allowed_roots=(str(Path(tmp) / "hf-cache"),),
                include_size=True,
            )
            self.assertFalse(active_plan.can_delete)
            self.assertIn("active_profile", [reason.code for reason in active_plan.blocked_reasons])
            self.assertIn("shared_storage", [reason.code for reason in active_plan.blocked_reasons])

            outside_plan = build_model_storage_delete_plan(
                shared,
                all_profiles=[shared],
                active_profile_id=None,
                allowed_roots=(str(Path(tmp) / "other-root"),),
                include_size=True,
            )
            self.assertFalse(outside_plan.can_delete)
            self.assertIn("outside_allowed_roots", [reason.code for reason in outside_plan.blocked_reasons])
            with self.assertRaises(ModelStorageDeleteBlockedError):
                execute_model_storage_delete(
                    outside_plan,
                    plan_fingerprint=outside_plan.plan_fingerprint or "",
                    confirmation="DELETE business_shared",
                )


if __name__ == "__main__":
    unittest.main()
