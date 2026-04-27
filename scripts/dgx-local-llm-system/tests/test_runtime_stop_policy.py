import importlib.util
import io
import sys
import unittest
from contextlib import redirect_stderr
from pathlib import Path


POLICY_PATH = Path(__file__).resolve().parents[1] / "runtime_stop_policy.py"


def load_policy():
    spec = importlib.util.spec_from_file_location("runtime_stop_policy", POLICY_PATH)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


class RuntimeStopPolicyTests(unittest.TestCase):
    def test_explicit_stop_mode_wins_over_keep_warm_flag(self):
        p = load_policy()
        env = {
            "BLUE_LLM_RUNTIME_STOP_MODE": "on_demand",
            "BLUE_LLM_RUNTIME_KEEP_WARM": "true",
        }
        self.assertEqual(p.load_blue_stop_mode_from_env(env), "on_demand")

    def test_legacy_keep_warm_when_stop_mode_unset(self):
        p = load_policy()
        env = {"BLUE_LLM_RUNTIME_KEEP_WARM": "true"}
        self.assertEqual(p.load_blue_stop_mode_from_env(env), "keep_warm")

    def test_default_token_falls_back_to_legacy(self):
        p = load_policy()
        env = {
            "BLUE_LLM_RUNTIME_STOP_MODE": "default",
            "BLUE_LLM_RUNTIME_KEEP_WARM": "0",
        }
        self.assertEqual(p.load_blue_stop_mode_from_env(env), "on_demand")

    def test_invalid_stop_mode_warns_and_falls_back(self):
        p = load_policy()
        env = {
            "BLUE_LLM_RUNTIME_STOP_MODE": "not-a-mode",
            "BLUE_LLM_RUNTIME_KEEP_WARM": "1",
        }
        err = io.StringIO()
        with redirect_stderr(err):
            mode = p.load_blue_stop_mode_from_env(env)
        self.assertEqual(mode, "keep_warm")
        self.assertIn("invalid BLUE_LLM_RUNTIME_STOP_MODE", err.getvalue())

    def test_always_on_uses_noop(self):
        p = load_policy()
        self.assertTrue(p.should_use_noop_stop_for_blue("always_on"))
        self.assertTrue(p.should_use_noop_stop_for_blue("keep_warm"))
        self.assertFalse(p.should_use_noop_stop_for_blue("on_demand"))


if __name__ == "__main__":
    unittest.main()
