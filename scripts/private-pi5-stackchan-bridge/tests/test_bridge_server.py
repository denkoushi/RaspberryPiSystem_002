import importlib.util
import io
import json
import sys
import unittest
from pathlib import Path


MODULE_DIR = Path(__file__).resolve().parents[1]
MODULE_PATH = MODULE_DIR / "bridge_server.py"


def load_module():
    if str(MODULE_DIR) not in sys.path:
        sys.path.insert(0, str(MODULE_DIR))
    spec = importlib.util.spec_from_file_location("bridge_server", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class FakeDgxClient:
    auto_start = False

    def __init__(self, response):
        self.response = response
        self.calls = 0
        self.last_body = None

    def post_chat_completions(self, body: bytes):
        self.calls += 1
        self.last_body = body
        return 200, self.response


class FakeHandler:
    def __init__(self, path, payload):
        body = json.dumps(payload).encode("utf-8")
        self.path = path
        self.headers = {"Content-Type": "application/json", "Content-Length": str(len(body))}
        self.rfile = io.BytesIO(body)
        self.wfile = io.BytesIO()
        self.status_code = None
        self.response_headers = []
        self.logs = []

    def send_response(self, status_code):
        self.status_code = status_code

    def send_header(self, name, value):
        self.response_headers.append((name, value))

    def end_headers(self):
        pass

    def log_message(self, fmt, *args):
        self.logs.append(fmt % args)

    def json_body(self):
        return json.loads(self.wfile.getvalue().decode("utf-8"))


class BridgeServerRouteTests(unittest.TestCase):
    def setUp(self):
        self.module = load_module()
        self.original_token = self.module.STACKCHAN_TOKEN
        self.module.STACKCHAN_TOKEN = ""
        self.fake_dgx = FakeDgxClient(
            {
                "model": "system-prod-primary",
                "choices": [{"message": {"content": "Sparkからの返答です。"}}],
                "usage": {"total_tokens": 12},
            }
        )

    def tearDown(self):
        self.module.STACKCHAN_TOKEN = self.original_token

    def make_handler(self, path, payload):
        handler = FakeHandler(path, payload)
        handler.dgx_client = self.fake_dgx
        handler.stt_client = None
        handler.home_assistant_client = None
        handler.dgx_model = "system-prod-primary"
        return handler

    def test_openai_compatible_chat_completions_returns_upstream_payload(self):
        handler = self.make_handler(
            "/v1/chat/completions",
            {
                "model": "spark-qwen",
                "messages": [{"role": "user", "content": "こんにちは"}],
                "max_tokens": 32,
                "stream": False,
            },
        )

        self.module.Handler._handle_post(handler)

        self.assertEqual(handler.status_code, 200)
        self.assertEqual(handler.json_body()["choices"][0]["message"]["content"], "Sparkからの返答です。")
        sent = json.loads(self.fake_dgx.last_body.decode("utf-8"))
        self.assertEqual(sent["model"], "system-prod-primary")
        self.assertEqual(sent["messages"], [{"role": "user", "content": "こんにちは"}])
        self.assertEqual(sent["max_tokens"], 32)

    def test_openai_compatible_chat_completions_rejects_streaming(self):
        handler = self.make_handler(
            "/v1/chat/completions",
            {
                "model": "spark-qwen",
                "messages": [{"role": "user", "content": "こんにちは"}],
                "stream": True,
            },
        )

        self.module.Handler._handle_post(handler)

        self.assertEqual(handler.status_code, 400)
        self.assertEqual(handler.json_body()["error"]["message"], "streaming responses are not supported")
        self.assertEqual(handler.json_body()["error"]["type"], "invalid_request_error")
        self.assertNotIn("ok", handler.json_body())
        self.assertEqual(self.fake_dgx.calls, 0)

    def test_openai_compatible_chat_completions_uses_openai_error_shape_for_auth(self):
        self.module.STACKCHAN_TOKEN = "expected-token"
        handler = self.make_handler(
            "/v1/chat/completions",
            {
                "model": "spark-qwen",
                "messages": [{"role": "user", "content": "こんにちは"}],
                "stream": False,
            },
        )

        self.module.Handler._handle_post(handler)

        self.assertEqual(handler.status_code, 401)
        body = handler.json_body()
        self.assertNotIn("ok", body)
        self.assertEqual(body["error"]["message"], "invalid stackchan token")
        self.assertEqual(body["error"]["type"], "authentication_error")
        self.assertEqual(body["error"]["code"], "UNAUTHORIZED")
        self.assertEqual(self.fake_dgx.calls, 0)

    def test_openai_compatible_chat_completions_accepts_bearer_token(self):
        self.module.STACKCHAN_TOKEN = "expected-token"
        handler = self.make_handler(
            "/v1/chat/completions",
            {
                "model": "spark-qwen",
                "messages": [{"role": "user", "content": "こんにちは"}],
                "max_completion_tokens": 32,
                "stream": False,
            },
        )
        handler.headers["Authorization"] = "Bearer expected-token"

        self.module.Handler._handle_post(handler)

        self.assertEqual(handler.status_code, 200)
        body = handler.json_body()
        self.assertNotIn("ok", body)
        self.assertEqual(body["model"], "system-prod-primary")
        self.assertEqual(body["choices"][0]["message"]["content"], "Sparkからの返答です。")
        sent = json.loads(self.fake_dgx.last_body.decode("utf-8"))
        self.assertEqual(sent["model"], "system-prod-primary")
        self.assertEqual(sent["max_tokens"], 32)
        self.assertEqual(self.fake_dgx.calls, 1)


if __name__ == "__main__":
    unittest.main()
