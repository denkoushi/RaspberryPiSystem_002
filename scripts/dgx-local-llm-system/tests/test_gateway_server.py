import importlib.util
import json
import sys
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "gateway-server.py"


def load_module():
    spec = importlib.util.spec_from_file_location("dgx_gateway_server", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class GatewayServerTests(unittest.TestCase):
    def test_resolve_backend_base_url_uses_active_backend(self):
        module = load_module()
        config = module.GatewayConfig(
            llm_shared_token="shared-token",
            runtime_control_token="runtime-token",
            host="127.0.0.1",
            port=38081,
            active_backend="blue",
            legacy_backend_base_url="http://legacy:38082",
            green_backend_base_url="http://green:38082",
            blue_backend_base_url="http://blue:38083",
            runtime_control_base_url="http://control:39090",
            embedding_api_key="",
            embedding_base_url="http://embed:38100",
        )

        self.assertEqual(module.resolve_backend_base_url(config), "http://blue:38083")

    def test_http_handler_routes_v1_and_runtime_requests(self):
        module = load_module()
        config = module.GatewayConfig(
            llm_shared_token="shared-token",
            runtime_control_token="runtime-token",
            host="127.0.0.1",
            port=38081,
            active_backend="blue",
            legacy_backend_base_url="http://legacy:38082",
            green_backend_base_url="http://green:38082",
            blue_backend_base_url="http://blue:38083",
            runtime_control_base_url="http://control:39090",
            embedding_api_key="",
            embedding_base_url="http://embed:38100",
        )
        calls: list[tuple[str, str, bytes, dict[str, str]]] = []

        def proxy_impl(method: str, url: str, body: bytes, headers: dict[str, str]):
            calls.append((method, url, body, headers))
            if url.endswith("/v1/models"):
                payload = json.dumps({"data": [{"id": "system-prod-primary"}]}).encode("utf-8")
                return 200, payload, "application/json"
            if url.endswith("/start"):
                payload = json.dumps({"ok": True}).encode("utf-8")
                return 200, payload, "application/json"
            return 404, b"not found", "text/plain; charset=utf-8"

        handler = module.make_handler(config, proxy_impl=proxy_impl)
        httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        base_url = f"http://127.0.0.1:{httpd.server_port}"
        try:
            models_req = urllib.request.Request(
                f"{base_url}/v1/models",
                method="GET",
                headers={"X-LLM-Token": "shared-token"},
            )
            with urllib.request.urlopen(models_req, timeout=5) as response:
                payload = json.loads(response.read().decode("utf-8"))
            self.assertEqual(payload["data"][0]["id"], "system-prod-primary")

            start_req = urllib.request.Request(
                f"{base_url}/start",
                data=b"",
                method="POST",
                headers={"X-Runtime-Control-Token": "runtime-token"},
            )
            with urllib.request.urlopen(start_req, timeout=5) as response:
                start_payload = json.loads(response.read().decode("utf-8"))
            self.assertTrue(start_payload["ok"])

            forbidden_req = urllib.request.Request(
                f"{base_url}/v1/models",
                method="GET",
                headers={"X-LLM-Token": "wrong-token"},
            )
            with self.assertRaises(urllib.error.HTTPError) as exc:
                urllib.request.urlopen(forbidden_req, timeout=5)
            self.assertEqual(exc.exception.code, 403)
        finally:
            httpd.shutdown()
            httpd.server_close()
            thread.join(timeout=5)

        self.assertEqual(calls[0][1], "http://blue:38083/v1/models")
        self.assertEqual(calls[1][1], "http://control:39090/start")
        self.assertEqual(calls[1][3]["X-Runtime-Control-Token"], "runtime-token")


if __name__ == "__main__":
    unittest.main()
