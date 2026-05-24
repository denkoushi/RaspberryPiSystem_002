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
            private_comfy_root="/tmp",
            private_comfy_start_cmd="./start-private-comfyui.sh",
            private_comfy_stop_cmd="./stop-private-comfyui.sh",
            private_comfy_health_url="http://127.0.0.1:8188",
            experiment_lab_root="/tmp",
            experiment_lab_start_cmd="./start-trtllm-server.sh",
            experiment_lab_stop_cmd="./stop-trtllm-server.sh",
            experiment_lab_health_url="http://127.0.0.1:38083/v1/models",
            experiment_lab_health_mode="http",
            experiment_lab_container_name="system-prod-trtllm",
            agent_container_root="/tmp",
            agent_container_start_cmd="./start-agent-container.sh",
            agent_container_stop_cmd="./stop-agent-container.sh",
            agent_container_health_url="http://127.0.0.1:5555/agent-health",
            agent_container_health_mode="http",
            agent_container_container_name="dgx-agent-container",
            private_comfy_cmd_timeout_sec=60,
        )

        self.assertEqual(module.resolve_backend_base_url(config), "http://blue:38083")

    def test_inject_blue_chat_completions_defaults_adds_enable_thinking_false(self):
        module = load_module()
        body = json.dumps(
            {"model": "system-prod-primary", "messages": [{"role": "user", "content": "hi"}]}
        ).encode()
        out = module.inject_blue_chat_completions_defaults(
            "/v1/chat/completions", body, "blue"
        )
        payload = json.loads(out.decode())
        self.assertFalse(payload["chat_template_kwargs"]["enable_thinking"])

    def test_inject_blue_chat_completions_defaults_skips_green(self):
        module = load_module()
        body = b'{"model":"x"}'
        out = module.inject_blue_chat_completions_defaults(
            "/v1/chat/completions", body, "green"
        )
        self.assertEqual(out, body)

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
            private_comfy_root="/tmp",
            private_comfy_start_cmd="./start-private-comfyui.sh",
            private_comfy_stop_cmd="./stop-private-comfyui.sh",
            private_comfy_health_url="http://127.0.0.1:8188",
            experiment_lab_root="/tmp",
            experiment_lab_start_cmd="./start-trtllm-server.sh",
            experiment_lab_stop_cmd="./stop-trtllm-server.sh",
            experiment_lab_health_url="http://127.0.0.1:38083/v1/models",
            experiment_lab_health_mode="http",
            experiment_lab_container_name="system-prod-trtllm",
            agent_container_root="/tmp",
            agent_container_start_cmd="./start-agent-container.sh",
            agent_container_stop_cmd="./stop-agent-container.sh",
            agent_container_health_url="http://127.0.0.1:5555/agent-health",
            agent_container_health_mode="http",
            agent_container_container_name="dgx-agent-container",
            private_comfy_cmd_timeout_sec=60,
        )
        module.run_local_command = lambda command, cwd, timeout_sec: (0, "ok")
        calls: list[tuple[str, str, bytes, dict[str, str]]] = []

        def proxy_impl(method: str, url: str, body: bytes, headers: dict[str, str]):
            calls.append((method, url, body, headers))
            if url.endswith("/v1/models"):
                payload = json.dumps({"data": [{"id": "system-prod-primary"}]}).encode("utf-8")
                return 200, payload, "application/json"
            if url == "http://127.0.0.1:8188":
                payload = b"ok"
                return 200, payload, "text/plain; charset=utf-8"
            if url == "http://127.0.0.1:38083/v1/models":
                payload = json.dumps({"data": [{"id": "system-prod-primary"}]}).encode("utf-8")
                return 200, payload, "application/json"
            if url == "http://127.0.0.1:5555/agent-health":
                payload = json.dumps({"ok": True}).encode("utf-8")
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

            bearer_models_req = urllib.request.Request(
                f"{base_url}/v1/models",
                method="GET",
                headers={"Authorization": "Bearer shared-token"},
            )
            with urllib.request.urlopen(bearer_models_req, timeout=5) as response:
                bearer_payload = json.loads(response.read().decode("utf-8"))
            self.assertEqual(bearer_payload["data"][0]["id"], "system-prod-primary")

            comfy_health_req = urllib.request.Request(
                f"{base_url}/private-comfyui/health",
                method="GET",
            )
            with urllib.request.urlopen(comfy_health_req, timeout=5) as response:
                self.assertEqual(response.status, 200)

            exp_health_req = urllib.request.Request(
                f"{base_url}/experiment-lab/health",
                method="GET",
            )
            with urllib.request.urlopen(exp_health_req, timeout=5) as response:
                self.assertEqual(response.status, 200)

            agent_health_req = urllib.request.Request(
                f"{base_url}/agent-container/health",
                method="GET",
            )
            with urllib.request.urlopen(agent_health_req, timeout=5) as response:
                self.assertEqual(response.status, 200)

            start_req = urllib.request.Request(
                f"{base_url}/start",
                data=b"",
                method="POST",
                headers={"X-Runtime-Control-Token": "runtime-token"},
            )
            with urllib.request.urlopen(start_req, timeout=5) as response:
                start_payload = json.loads(response.read().decode("utf-8"))
            self.assertTrue(start_payload["ok"])

            comfy_req = urllib.request.Request(
                f"{base_url}/private-comfyui/start",
                data=b"",
                method="POST",
                headers={"X-Runtime-Control-Token": "runtime-token"},
            )
            with urllib.request.urlopen(comfy_req, timeout=5) as response:
                comfy_payload = json.loads(response.read().decode("utf-8"))
            self.assertTrue(comfy_payload["ok"])

            exp_req = urllib.request.Request(
                f"{base_url}/experiment-lab/start",
                data=b"",
                method="POST",
                headers={"X-Runtime-Control-Token": "runtime-token"},
            )
            with urllib.request.urlopen(exp_req, timeout=5) as response:
                exp_payload = json.loads(response.read().decode("utf-8"))
            self.assertTrue(exp_payload["ok"])

            agent_req = urllib.request.Request(
                f"{base_url}/agent-container/start",
                data=b"",
                method="POST",
                headers={"X-Runtime-Control-Token": "runtime-token"},
            )
            with urllib.request.urlopen(agent_req, timeout=5) as response:
                agent_payload = json.loads(response.read().decode("utf-8"))
            self.assertTrue(agent_payload["ok"])

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

        urls = [c[1] for c in calls]
        self.assertIn("http://blue:38083/v1/models", urls)
        self.assertIn("http://127.0.0.1:8188", urls)
        self.assertIn("http://127.0.0.1:5555/agent-health", urls)
        start_call = next(c for c in calls if c[1] == "http://control:39090/start")
        self.assertEqual(start_call[3]["X-Runtime-Control-Token"], "runtime-token")


if __name__ == "__main__":
    unittest.main()
