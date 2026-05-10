import importlib.util
import io
import sys
import unittest
from pathlib import Path
from urllib.error import HTTPError


MODULE_DIR = Path(__file__).resolve().parents[1]
MODULE_PATH = MODULE_DIR / "stackchan_chat_core.py"


def load_module():
    if str(MODULE_DIR) not in sys.path:
        sys.path.insert(0, str(MODULE_DIR))
    spec = importlib.util.spec_from_file_location("stackchan_chat_core", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class FakeDgxClient:
    def __init__(self, auto_start=False, post_results=None, ready_result=(False, {"message": "not ready"})):
        self.auto_start = auto_start
        self._post_results = list(post_results or [])
        self._ready_result = ready_result
        self.ensure_calls = 0

    def post_chat_completions(self, body: bytes):
        if not self._post_results:
            raise AssertionError("unexpected post_chat_completions call")
        result = self._post_results.pop(0)
        if isinstance(result, Exception):
            raise result
        return result

    def ensure_runtime_ready(self):
        self.ensure_calls += 1
        return self._ready_result


class StackchanChatCoreTests(unittest.TestCase):
    def test_validate_chat_payload_accepts_defaults(self):
        module = load_module()

        validated, err = module.validate_chat_payload(
            {"messages": [{"role": "user", "content": "こんにちは"}]}
        )

        self.assertIsNone(err)
        self.assertIsNotNone(validated)
        self.assertEqual(validated.max_tokens, 1024)
        self.assertEqual(validated.temperature, 0.35)
        self.assertFalse(validated.enable_thinking)

    def test_validate_chat_payload_rejects_empty_messages(self):
        module = load_module()

        validated, err = module.validate_chat_payload({"messages": []})

        self.assertIsNone(validated)
        self.assertEqual(err, "messages must be non-empty array")

    def test_workflow_retries_http_502_once_after_runtime_recovery(self):
        module = load_module()
        request = module.ValidatedChatRequest(
            messages=[{"role": "user", "content": "hello"}],
            max_tokens=32,
            temperature=0.2,
            enable_thinking=False,
        )
        first_error = HTTPError(
            url="http://example.invalid/v1/chat/completions",
            code=502,
            msg="Bad Gateway",
            hdrs=None,
            fp=io.BytesIO(b"bad gateway"),
        )
        parsed = {
            "model": "system-prod-primary",
            "choices": [{"message": {"content": "  reply from dgx  "}}],
            "usage": {"total_tokens": 12},
        }
        client = FakeDgxClient(
            auto_start=True,
            post_results=[first_error, (200, parsed)],
            ready_result=(True, {"ready": {"status": 200}}),
        )
        logs = []

        workflow = module.ChatCompletionWorkflow(client, "system-prod-primary")
        outcome = workflow.run(request, log=lambda fmt, *args: logs.append(fmt % args))

        self.assertIsInstance(outcome, module.ChatSuccess)
        self.assertEqual(outcome.status_code, 200)
        self.assertEqual(outcome.parsed, parsed)
        self.assertEqual(client.ensure_calls, 1)
        self.assertEqual(logs, ["upstream 502 recovered after runtime start"])

    def test_workflow_returns_failure_when_runtime_recovery_fails(self):
        module = load_module()
        request = module.ValidatedChatRequest(
            messages=[{"role": "user", "content": "hello"}],
            max_tokens=32,
            temperature=0.2,
            enable_thinking=False,
        )
        first_error = HTTPError(
            url="http://example.invalid/v1/chat/completions",
            code=503,
            msg="Service Unavailable",
            hdrs=None,
            fp=io.BytesIO(b"backend unavailable"),
        )
        client = FakeDgxClient(
            auto_start=True,
            post_results=[first_error],
            ready_result=(False, {"message": "runtime did not become ready in time"}),
        )

        workflow = module.ChatCompletionWorkflow(client, "system-prod-primary")
        outcome = workflow.run(request)

        self.assertIsInstance(outcome, module.ChatFailure)
        self.assertEqual(outcome.http_status, 503)
        self.assertEqual(outcome.code, "UPSTREAM_HTTP_ERROR")
        self.assertTrue(outcome.retryable)
        self.assertEqual(outcome.details["status"], 503)
        self.assertEqual(outcome.details["runtimeRecovery"]["message"], "runtime did not become ready in time")

    def test_format_simple_success_extracts_reply_text(self):
        module = load_module()

        payload = module.format_simple_success(
            {
                "model": "system-prod-primary",
                "choices": [{"message": {"content": "  こんにちは。  "}}],
                "usage": {"total_tokens": 18},
            }
        )

        self.assertEqual(payload["replyText"], "こんにちは。")
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["usage"]["total_tokens"], 18)


if __name__ == "__main__":
    unittest.main()
