import importlib.util
import sys
import unittest
from pathlib import Path


AUTH_MODULE_PATH = Path(__file__).resolve().parents[1] / "gateway_llm_auth.py"


def load_auth_module():
    spec = importlib.util.spec_from_file_location("dgx_gateway_llm_auth", AUTH_MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class GatewayLlmAuthTests(unittest.TestCase):
    def setUp(self) -> None:
        self.auth = load_auth_module()

    def test_load_tokens_primary_only(self) -> None:
        tokens = self.auth.load_llm_shared_tokens_from_env(
            {"LLM_SHARED_TOKEN": "primary", "LLM_SHARED_ADDITIONAL_TOKENS": ""}
        )
        self.assertEqual(tokens, frozenset({"primary"}))

    def test_load_tokens_primary_and_additional(self) -> None:
        tokens = self.auth.load_llm_shared_tokens_from_env(
            {
                "LLM_SHARED_TOKEN": "stackchan",
                "LLM_SHARED_ADDITIONAL_TOKENS": "hermes-chat, hermes-tools",
            }
        )
        self.assertEqual(tokens, frozenset({"stackchan", "hermes-chat", "hermes-tools"}))

    def test_llm_shared_token_ok_x_llm_token(self) -> None:
        headers = {"X-LLM-Token": "hermes-chat"}
        self.assertTrue(
            self.auth.llm_shared_token_ok(headers, frozenset({"stackchan", "hermes-chat"}))
        )

    def test_llm_shared_token_ok_bearer(self) -> None:
        headers = {"Authorization": "Bearer hermes-tools"}
        self.assertTrue(
            self.auth.llm_shared_token_ok(headers, frozenset({"stackchan", "hermes-tools"}))
        )

    def test_llm_shared_token_ok_rejects_unknown(self) -> None:
        headers = {"Authorization": "Bearer wrong"}
        self.assertFalse(self.auth.llm_shared_token_ok(headers, frozenset({"stackchan"})))

    def test_llm_shared_token_ok_empty_tokens(self) -> None:
        self.assertFalse(self.auth.llm_shared_token_ok({"X-LLM-Token": "x"}, frozenset()))


if __name__ == "__main__":
    unittest.main()
