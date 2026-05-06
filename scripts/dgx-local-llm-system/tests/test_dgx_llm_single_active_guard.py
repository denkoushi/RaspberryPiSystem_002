import importlib.util
import os
import sys
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "dgx_llm_single_active_guard.py"


def load_guard_module():
    spec = importlib.util.spec_from_file_location("dgx_llm_single_active_guard", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class SingleActiveGuardTests(unittest.TestCase):
    def tearDown(self) -> None:
        os.environ.pop("DGX_LLM_SINGLE_ACTIVE_GUARD", None)

    def test_inactive_backend(self):
        module = load_guard_module()
        self.assertEqual(module.inactive_backend("green"), "blue")
        self.assertEqual(module.inactive_backend("blue"), "green")

    def test_resolve_hard_stop_prefers_backend_specific_cmd(self):
        module = load_guard_module()
        self.assertEqual(
            module.resolve_hard_stop_for_backend(
                "green",
                green_stop_cmd="g-stop",
                blue_stop_cmd="b-stop",
                legacy_stop_cmd="legacy",
            ),
            "g-stop",
        )
        self.assertEqual(
            module.resolve_hard_stop_for_backend(
                "blue",
                green_stop_cmd="g-stop",
                blue_stop_cmd="b-stop",
                legacy_stop_cmd="legacy",
            ),
            "b-stop",
        )

    def test_resolve_hard_stop_falls_back_to_legacy(self):
        module = load_guard_module()
        self.assertEqual(
            module.resolve_hard_stop_for_backend(
                "green",
                green_stop_cmd="",
                blue_stop_cmd="",
                legacy_stop_cmd="legacy-only",
            ),
            "legacy-only",
        )

    def test_single_active_guard_enabled_env(self):
        module = load_guard_module()
        os.environ.pop("DGX_LLM_SINGLE_ACTIVE_GUARD", None)
        self.assertTrue(module.single_active_guard_enabled())
        os.environ["DGX_LLM_SINGLE_ACTIVE_GUARD"] = "false"
        self.assertFalse(module.single_active_guard_enabled())


if __name__ == "__main__":
    unittest.main()
