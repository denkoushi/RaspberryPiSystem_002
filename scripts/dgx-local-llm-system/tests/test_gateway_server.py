import importlib.util
import json
import sys
import threading
import unittest
from dataclasses import replace
import tempfile
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "gateway-server.py"


def load_module():
    module_dir = str(MODULE_PATH.parent)
    if module_dir not in sys.path:
        sys.path.insert(0, module_dir)
    spec = importlib.util.spec_from_file_location("dgx_gateway_server", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class GatewayServerTests(unittest.TestCase):
    def test_collect_gpu_metrics_includes_detail_fields(self):
        module = load_module()

        class Proc:
            def __init__(self, returncode: int, stdout: str):
                self.returncode = returncode
                self.stdout = stdout

        calls: list[str] = []

        def run_impl(args, capture_output: bool, text: bool, check: bool):
            command = args[-1]
            calls.append(command)
            if "--query-gpu=" in command:
                return Proc(
                    0,
                    (
                        "44, 32768, 131072, 46, 11.3, 120, 1280, 1280, 850, "
                        "P2, None, NVIDIA GB10, 580.159.03\n"
                    ),
                )
            if "--query-compute-apps=pid,process_name,used_memory" in command:
                return Proc(0, "1234, python, 2048\n")
            if "/proc/meminfo" in command:
                return Proc(0, "MemTotal: 134217728\nMemAvailable: 104857600\n")
            raise AssertionError(f"unexpected command: {command}")

        original_run = module.subprocess.run
        module.subprocess.run = run_impl
        try:
            ok, payload = module.collect_gpu_metrics()
        finally:
            module.subprocess.run = original_run

        self.assertTrue(ok)
        self.assertEqual(payload["gpuUtilPct"], 44)
        self.assertEqual(payload["unifiedMemoryUsedGiB"], 32)
        self.assertEqual(payload["unifiedMemoryTotalGiB"], 128)
        self.assertEqual(payload["freeMemoryGiB"], 96)
        self.assertEqual(payload["startupFreeMemoryGiB"], 100)
        self.assertEqual(payload["systemMemoryAvailableGiB"], 100)
        self.assertEqual(payload["memoryMetricSource"], "gpu_memory")
        self.assertEqual(payload["gpuProcessCount"], 1)
        self.assertEqual(payload["gpuProcessMemoryUsedGiB"], 2)
        self.assertEqual(payload["gpuProcesses"][0]["processName"], "python")
        self.assertEqual(payload["gpuTemperatureC"], 46)
        self.assertEqual(payload["gpuPowerDrawW"], 11.3)
        self.assertEqual(payload["gpuPowerLimitW"], 120)
        self.assertEqual(payload["gpuClockSmMhz"], 1280)
        self.assertEqual(payload["gpuClockGraphicsMhz"], 1280)
        self.assertEqual(payload["gpuClockMemoryMhz"], 850)
        self.assertEqual(payload["gpuPstate"], "P2")
        self.assertEqual(payload["gpuClocksThrottleReason"], "None")
        self.assertEqual(payload["gpuName"], "NVIDIA GB10")
        self.assertEqual(payload["driverVersion"], "580.159.03")
        self.assertEqual(len(calls), 3)

    def test_collect_gpu_metrics_falls_back_to_legacy_query(self):
        module = load_module()

        class Proc:
            def __init__(self, returncode: int, stdout: str):
                self.returncode = returncode
                self.stdout = stdout

        calls: list[str] = []

        def run_impl(args, capture_output: bool, text: bool, check: bool):
            command = args[-1]
            calls.append(command)
            if "temperature.gpu" in command:
                return Proc(1, "")
            if "--query-gpu=utilization.gpu,memory.used,memory.total " in command:
                return Proc(0, "44, 32768, 131072\n")
            if "--query-compute-apps=pid,process_name,used_memory" in command:
                return Proc(0, "")
            if "/proc/meminfo" in command:
                return Proc(0, "MemTotal: 134217728\nMemAvailable: 67108864\n")
            raise AssertionError(f"unexpected command: {command}")

        original_run = module.subprocess.run
        module.subprocess.run = run_impl
        try:
            ok, payload = module.collect_gpu_metrics()
        finally:
            module.subprocess.run = original_run

        self.assertTrue(ok)
        self.assertEqual(payload["gpuUtilPct"], 44)
        self.assertEqual(payload["unifiedMemoryUsedGiB"], 32)
        self.assertEqual(payload["unifiedMemoryTotalGiB"], 128)
        self.assertEqual(payload["freeMemoryGiB"], 96)
        self.assertEqual(payload["startupFreeMemoryGiB"], 64)
        self.assertEqual(payload["memoryMetricSource"], "gpu_memory")
        self.assertNotIn("gpuTemperatureC", payload)
        self.assertEqual(len(calls), 4)

    def test_resolve_backend_base_url_uses_active_backend(self):
        module = load_module()
        config = module.GatewayConfig(
            llm_shared_tokens=frozenset({"shared-token"}),
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

    def test_model_profile_endpoints_and_active_state_routing(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "registry"
            storage = Path(tmp) / "hf" / "qwen"
            storage.mkdir(parents=True)
            manifest_dir = root / "business_qwen36_27b_nvfp4"
            manifest_dir.mkdir(parents=True)
            (manifest_dir / "manifest.json").write_text(
                json.dumps(
                    {
                        "modelProfileId": "business_qwen36_27b_nvfp4",
                        "displayNameJa": "Qwen3.6 27B NVFP4",
                        "backend": "blue",
                        "servedAlias": "system-prod-primary",
                        "sourceModelRef": "sakamakismile/Qwen3.6-27B-NVFP4",
                        "currentStorageLocation": str(storage),
                        "enabled": True,
                        "recommended": True,
                    }
                ),
                encoding="utf-8",
            )
            state_path = Path(tmp) / "state" / "active-model-profile.json"
            state_path.parent.mkdir(parents=True)
            state_path.write_text(
                json.dumps(
                    {
                        "activeProfileId": "business_qwen36_27b_nvfp4",
                        "modelProfileId": "business_qwen36_27b_nvfp4",
                        "displayNameJa": "Qwen3.6 27B NVFP4",
                        "backend": "blue",
                        "servedAlias": "system-prod-primary",
                        "stateUpdatedAt": "2026-05-28T00:00:00Z",
                    }
                ),
                encoding="utf-8",
            )
            resource_state_path = Path(tmp) / "state" / "dgx-resource-state.json"
            resource_state_path.write_text(
                json.dumps(
                    {
                        "owner": "business",
                        "status": "preparing",
                        "updatedAt": "2026-05-28T00:00:00Z",
                        "action": "start",
                        "reason": "scenario_guide_model_profile",
                        "modelProfileId": "business_qwen36_27b_nvfp4",
                        "displayNameJa": "Qwen3.6 27B NVFP4",
                        "backend": "blue",
                        "guaranteeLevel": "post_only",
                    }
                ),
                encoding="utf-8",
            )
            config = module.GatewayConfig(
                llm_shared_tokens=frozenset({"shared-token"}),
                runtime_control_token="runtime-token",
                host="127.0.0.1",
                port=38081,
                active_backend="green",
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
                model_registry_root=str(root),
                active_model_state_path=str(state_path),
                resource_state_path=str(resource_state_path),
            )
            calls: list[str] = []

            def proxy_impl(method: str, url: str, body: bytes, headers: dict[str, str]):
                calls.append(url)
                return 200, json.dumps({"data": [{"id": "system-prod-primary"}]}).encode(), "application/json"

            handler = module.make_handler(config, proxy_impl=proxy_impl)
            httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler)
            thread = threading.Thread(target=httpd.serve_forever, daemon=True)
            thread.start()
            base_url = f"http://127.0.0.1:{httpd.server_port}"
            try:
                profiles_req = urllib.request.Request(
                    f"{base_url}/system/model-profiles",
                    method="GET",
                    headers={"X-LLM-Token": "shared-token"},
                )
                with urllib.request.urlopen(profiles_req, timeout=5) as response:
                    profiles_payload = json.loads(response.read().decode("utf-8"))
                resource_req = urllib.request.Request(
                    f"{base_url}/system/resource-state",
                    method="GET",
                    headers={"X-LLM-Token": "shared-token"},
                )
                with urllib.request.urlopen(resource_req, timeout=5) as response:
                    resource_payload = json.loads(response.read().decode("utf-8"))
                models_req = urllib.request.Request(
                    f"{base_url}/v1/models",
                    method="GET",
                    headers={"X-LLM-Token": "shared-token"},
                )
                with urllib.request.urlopen(models_req, timeout=5):
                    pass
            finally:
                httpd.shutdown()
                httpd.server_close()
                thread.join(timeout=5)

            self.assertEqual(profiles_payload["activeProfileId"], "business_qwen36_27b_nvfp4")
            self.assertEqual(profiles_payload["profiles"][0]["backend"], "blue")
            self.assertEqual(profiles_payload["resourceState"]["owner"], "business")
            self.assertEqual(resource_payload["owner"], "business")
            self.assertEqual(resource_payload["modelProfileId"], "business_qwen36_27b_nvfp4")
            self.assertIn("http://blue:38083/v1/models", calls)

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

    def test_runtime_shortcut_success_writes_resource_state(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            resource_state_path = Path(tmp) / "state" / "dgx-resource-state.json"
            config = module.GatewayConfig(
                llm_shared_tokens=frozenset({"shared-token"}),
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
                resource_state_path=str(resource_state_path),
            )
            commands: list[tuple[str, str]] = []

            def run_local_command(command: str, cwd: str, timeout_sec: int):
                commands.append((command, cwd))
                return 0, "ok"

            module.run_local_command = run_local_command
            handler = module.make_handler(config)
            httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler)
            thread = threading.Thread(target=httpd.serve_forever, daemon=True)
            thread.start()
            base_url = f"http://127.0.0.1:{httpd.server_port}"
            try:
                comfy_req = urllib.request.Request(
                    f"{base_url}/private-comfyui/start",
                    data=json.dumps({"reason": "manual private request"}).encode("utf-8"),
                    method="POST",
                    headers={
                        "Content-Type": "application/json",
                        "X-Runtime-Control-Token": "runtime-token",
                    },
                )
                with urllib.request.urlopen(comfy_req, timeout=5) as response:
                    comfy_payload = json.loads(response.read().decode("utf-8"))

                exp_req = urllib.request.Request(
                    f"{base_url}/experiment-lab/stop",
                    data=json.dumps({"reason": "experiment done"}).encode("utf-8"),
                    method="POST",
                    headers={
                        "Content-Type": "application/json",
                        "X-Runtime-Control-Token": "runtime-token",
                    },
                )
                with urllib.request.urlopen(exp_req, timeout=5) as response:
                    exp_payload = json.loads(response.read().decode("utf-8"))
            finally:
                httpd.shutdown()
                httpd.server_close()
                thread.join(timeout=5)

            self.assertEqual(comfy_payload["resourceState"]["owner"], "private")
            self.assertEqual(comfy_payload["resourceState"]["status"], "preparing")
            self.assertEqual(comfy_payload["resourceState"]["action"], "private-comfyui-start")
            self.assertEqual(comfy_payload["resourceState"]["reason"], "manual private request")
            self.assertEqual(exp_payload["resourceState"]["owner"], "experiment")
            self.assertEqual(exp_payload["resourceState"]["status"], "released")
            self.assertEqual(exp_payload["resourceState"]["action"], "experiment-lab-stop")
            persisted = json.loads(resource_state_path.read_text(encoding="utf-8"))
            self.assertEqual(persisted["owner"], "experiment")
            self.assertEqual(persisted["status"], "released")
            self.assertEqual(
                commands,
                [
                    ("./start-private-comfyui.sh", "/tmp"),
                    ("./stop-trtllm-server.sh", "/tmp"),
                ],
            )

    def test_http_handler_routes_v1_and_runtime_requests(self):
        module = load_module()
        config = module.GatewayConfig(
            llm_shared_tokens=frozenset({"shared-token"}),
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

            additional_config = replace(
                config,
                llm_shared_tokens=frozenset({"shared-token", "hermes-only"}),
            )
            additional_handler = module.make_handler(additional_config, proxy_impl=proxy_impl)
            additional_httpd = ThreadingHTTPServer(("127.0.0.1", 0), additional_handler)
            additional_thread = threading.Thread(target=additional_httpd.serve_forever, daemon=True)
            additional_thread.start()
            additional_base = f"http://127.0.0.1:{additional_httpd.server_port}"
            try:
                hermes_req = urllib.request.Request(
                    f"{additional_base}/v1/models",
                    method="GET",
                    headers={"Authorization": "Bearer hermes-only"},
                )
                with urllib.request.urlopen(hermes_req, timeout=5) as response:
                    hermes_payload = json.loads(response.read().decode("utf-8"))
                self.assertEqual(hermes_payload["data"][0]["id"], "system-prod-primary")
            finally:
                additional_httpd.shutdown()
                additional_httpd.server_close()
                additional_thread.join(timeout=5)
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
