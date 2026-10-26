import importlib.util
import http.client
import io
import json
import os
import sys
import threading
import unittest
from dataclasses import replace
import tempfile
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import Mock, patch


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


class MultiImageLabelsTests(unittest.TestCase):
    def setUp(self):
        self.module = load_module()
        self.images = [
            {"type": "image_url", "image_url": {"url": f"https://example.com/{index}.png"}}
            for index in range(3)
        ]

    def test_three_unlabelled_images_get_ordered_labels_without_mutating_input(self):
        messages = [{"role": "user", "content": self.images}]
        original = json.dumps(messages)
        expected = [{"role": "user", "content": [
            {"type": "text", "text": "画像1:"}, self.images[0],
            {"type": "text", "text": "画像2:"}, self.images[1],
            {"type": "text", "text": "画像3:"}, self.images[2],
        ]}]
        self.assertEqual(self.module.label_multi_image_messages(messages), expected)
        self.assertEqual(json.dumps(messages), original)
        self.assertEqual(self.module.label_multi_image_messages(expected), expected)

    def test_mixed_labels_preserve_text_and_reset_numbering_per_message(self):
        label = {"type": "text", "text": "First photo:"}
        messages = [
            {"role": "user", "content": [label, *self.images]},
            {"role": "user", "content": self.images[:2]},
        ]
        out = self.module.label_multi_image_messages(messages)
        self.assertEqual(out[0]["content"], [
            label, self.images[0], {"type": "text", "text": "画像2:"}, self.images[1],
            {"type": "text", "text": "画像3:"}, self.images[2],
        ])
        self.assertEqual(out[1]["content"], [
            {"type": "text", "text": "画像1:"}, self.images[0],
            {"type": "text", "text": "画像2:"}, self.images[1],
        ])

    def test_single_image_string_and_text_only_content_unchanged(self):
        for content in (self.images[:1], "hello", [], [{"type": "text", "text": "hello"}]):
            with self.subTest(content=content):
                messages = [{"role": "user", "content": content}]
                self.assertEqual(self.module.label_multi_image_messages(messages), messages)

    def test_labels_apply_only_to_blue_chat_completions(self):
        messages = [{"role": "user", "content": self.images}]
        body = json.dumps({"messages": messages}).encode()
        for backend, path in (("blue", "/v1/chat/completions"),
                              ("green", "/v1/chat/completions"), ("blue", "/v1/completions")):
            with self.subTest(backend=backend, path=path):
                out = self.module.inject_blue_chat_completions_defaults(path, body, backend)
                if backend == "blue" and path == "/v1/chat/completions":
                    self.assertEqual(json.loads(out)["messages"], self.module.label_multi_image_messages(messages))
                else:
                    self.assertEqual(out, body)


class GlmThinkingDefaultsTests(unittest.TestCase):
    def setUp(self):
        self.module = load_module()
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.manifest = root / "registry/glm/manifest.json"
        self.manifest.parent.mkdir(parents=True)
        self.manifest.write_text(json.dumps({
            "modelProfileId": "business_glm53_flash_fp4_tp2", "displayNameJa": "GLM",
            "backend": "blue", "servedAlias": "system-prod-primary",
            "runtimeProfile": {"chat": {"thinkingControl": "reasoning_effort"}},
        }))
        profile = self.module.find_model_profile(str(root / "registry"), "business_glm53_flash_fp4_tp2")
        from active_model_state import write_active_model_state
        self.state = root / "active-model-profile.json"
        write_active_model_state(str(self.state), profile)
        self.config = replace(self.module.load_config_from_env(),
                              model_registry_root=str(root / "registry"), active_model_state_path=str(self.state))

    def inject(self, payload, backend="blue", path="/v1/chat/completions"):
        return json.loads(self.module.inject_blue_chat_completions_defaults(
            path, json.dumps(payload).encode(), backend, self.config,
        ))

    def test_glm_defaults_without_kwargs(self):
        self.assertEqual(self.inject({})["chat_template_kwargs"], {
            "reasoning_effort": "low", "clear_thinking": True,
        })

    def test_glm_translates_enable_thinking_and_preserves_explicit_effort(self):
        for enable in (True, False, None, 1, "true"):
            for effort in ("absent", "low", "high", "medium", None):
                with self.subTest(enable=enable, effort=effort):
                    kwargs = {"enable_thinking": enable, "other": "kept"}
                    if effort != "absent":
                        kwargs["reasoning_effort"] = effort
                    out = self.inject({"chat_template_kwargs": kwargs})["chat_template_kwargs"]
                    self.assertNotIn("enable_thinking", out)
                    expected = effort if effort in ("low", "high") else "high" if enable is True else "low"
                    self.assertEqual(out, {"reasoning_effort": expected, "clear_thinking": True, "other": "kept"})

    def test_glm_normalizes_top_level_effort_and_preserves_clear_thinking(self):
        for effort in ("high", "low", "medium", "max", "none", None, 0):
            with self.subTest(effort=effort):
                out = self.inject({"reasoning_effort": effort, "chat_template_kwargs": {"clear_thinking": False}})
                self.assertEqual(out["reasoning_effort"], "high" if effort == "high" else "low")
                self.assertIs(out["chat_template_kwargs"]["clear_thinking"], False)

    def test_missing_unknown_or_unreadable_profiles_keep_qwen_behavior(self):
        for source in ("missing_state", "invalid_state", "unknown_profile", "missing_key", "invalid_manifest"):
            with self.subTest(source=source):
                state = self.state.read_bytes() if self.state.exists() else None
                manifest = self.manifest.read_bytes()
                if source == "missing_state":
                    self.state.unlink()
                elif source == "invalid_state":
                    self.state.write_text("{")
                elif source == "unknown_profile":
                    self.manifest.unlink()
                elif source == "missing_key":
                    body = json.loads(manifest)
                    body.pop("runtimeProfile")
                    self.manifest.write_text(json.dumps(body))
                else:
                    self.manifest.write_text("{")
                out = self.inject({})
                self.assertEqual(out["chat_template_kwargs"], {"enable_thinking": False})
                if state is not None:
                    self.state.write_bytes(state)
                self.manifest.write_bytes(manifest)

    def test_qwen_payload_is_unchanged_relative_to_legacy_defaults(self):
        self.config = replace(self.config, model_registry_root=str(MODULE_PATH.parent / "model-registry.examples"))
        from active_model_state import write_active_model_state
        qwen = self.module.find_model_profile(self.config.model_registry_root, "business_qwen38_flash_next_nvfp4")
        write_active_model_state(str(self.state), qwen)
        for payload in ({}, {"chat_template_kwargs": {"enable_thinking": True}},
                        {"reasoning_effort": "medium", "chat_template_kwargs": {"enable_thinking": False}}):
            body = json.dumps(payload).encode()
            self.assertEqual(self.module.inject_blue_chat_completions_defaults(
                "/v1/chat/completions", body, "blue", self.config,
            ), self.module.inject_blue_chat_completions_defaults("/v1/chat/completions", body, "blue"))

    def test_green_non_chat_and_invalid_bodies_unchanged(self):
        for backend, path, body in (("green", "/v1/chat/completions", b"{}"),
                                    ("blue", "/v1/completions", b"{}"),
                                    ("blue", "/v1/chat/completions", b"{"),
                                    ("blue", "/v1/chat/completions", b"[]")):
            self.assertEqual(self.module.inject_blue_chat_completions_defaults(
                path, body, backend, self.config,
            ), body)


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
                data=json.dumps({"reason": "business-restore"}).encode("utf-8"),
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
        self.assertEqual(json.loads(start_call[2].decode("utf-8")), {"reason": "business-restore"})


class GatewayStreamingTests(unittest.TestCase):
    def setUp(self):
        self.module = load_module()
        with patch.dict(self.module.os.environ, {"LLM_SHARED_TOKEN": "shared-token"}, clear=True):
            self.config = self.module.load_config_from_env()
        self.proxy_impl = Mock(return_value=(202, b"buffered response", "application/json"))

    def _serve(self, handler):
        httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        thread = threading.Thread(target=httpd.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
        thread.start()

        def cleanup():
            httpd.shutdown()
            httpd.server_close()
            thread.join(timeout=3)

        self.addCleanup(cleanup)
        return httpd

    def _gateway(self, **config_changes):
        config = replace(self.config, **config_changes)
        return self._serve(self.module.make_handler(config, proxy_impl=self.proxy_impl))

    def _request(self, httpd, body, path="/v1/chat/completions", token="shared-token"):
        client = http.client.HTTPConnection("127.0.0.1", httpd.server_port, timeout=2)
        self.addCleanup(client.close)
        client.request("POST", path, body=body, headers={"X-LLM-Token": token, "Content-Type": "application/json"})
        return client.getresponse()

    def test_stream_arrives_before_upstream_finishes_and_blue_defaults_apply(self):
        for backend, path, protocol in (
            ("green", "/v1/chat/completions", "HTTP/1.1"),
            ("green", "/v1/completions", "HTTP/1.0"),
            ("blue", "/v1/chat/completions/", "HTTP/1.1"),
        ):
            with self.subTest(backend=backend, path=path, protocol=protocol):
                release = threading.Event()
                waiting = threading.Event()
                finished = threading.Event()
                received = []
                first = b'data: {"delta":"hello"}\n\n'
                rest = b'data: {"delta":" world"}\n\ndata: [DONE]\n\n'

                class Upstream(BaseHTTPRequestHandler):
                    def do_POST(self):
                        received.append((self.path, self.rfile.read(int(self.headers["Content-Length"]))))
                        self.send_response(201)
                        self.send_header("Content-Type", "text/event-stream")
                        self.end_headers()
                        self.wfile.write(first)
                        self.wfile.flush()
                        waiting.set()
                        if release.wait(timeout=3):
                            self.wfile.write(rest)
                            self.wfile.flush()
                        finished.set()

                    def log_message(self, *args):
                        pass

                upstream = self._serve(Upstream)
                url = f"http://127.0.0.1:{upstream.server_port}"
                gateway = self._gateway(active_backend=backend, green_backend_base_url=url, blue_backend_base_url=url)
                self.addCleanup(release.set)
                client = http.client.HTTPConnection("127.0.0.1", gateway.server_port, timeout=2)
                self.addCleanup(client.close)
                client._http_vsn = 10 if protocol == "HTTP/1.0" else 11
                client._http_vsn_str = protocol
                request_body = json.dumps({"stream": True, "messages": [{"role": "user", "content": "hi"}]}).encode()
                try:
                    client.request("POST", path, body=request_body, headers={"X-LLM-Token": "shared-token", "Content-Type": "application/json"})
                    with client.getresponse() as response:
                        self.assertEqual(response.status, 201)
                        self.assertEqual(response.getheader("Content-Type"), "text/event-stream")
                        self.assertEqual(response.getheader("Cache-Control"), "no-cache")
                        self.assertEqual(response.getheader("Connection"), "close")
                        self.assertIsNone(response.getheader("Content-Length"))
                        self.assertIsNone(response.getheader("Transfer-Encoding"))
                        self.assertEqual(response.read(len(first)), first)
                        self.assertTrue(waiting.wait(timeout=1))
                        self.assertFalse(finished.is_set())
                        self.assertFalse(release.is_set())
                        # Other requests remain serviceable while the upstream is blocked.
                        with urllib.request.urlopen(f"http://127.0.0.1:{gateway.server_port}/healthz", timeout=2) as health:
                            self.assertEqual(health.read(), b"ok\n")
                        release.set()
                        self.assertEqual(response.read(), rest)
                finally:
                    release.set()
                self.assertTrue(finished.wait(timeout=1))
                self.assertEqual(received[0][0], path)
                payload = json.loads(received[0][1])
                if backend == "blue":
                    self.assertIs(payload["chat_template_kwargs"]["enable_thinking"], False)
                else:
                    self.assertEqual(received[0][1], request_body)
        self.proxy_impl.assert_not_called()

    def test_stream_bad_token_returns_403_before_rewriting_or_proxying(self):
        gateway = self._gateway(active_backend="blue")
        with patch.object(self.module.urllib.request, "urlopen") as upstream_open, patch.object(
            self.module, "inject_blue_chat_completions_defaults"
        ) as inject_defaults:
            with self._request(gateway, b'{"stream":true}', token="wrong-token") as response:
                self.assertEqual(response.status, 403)
                self.assertEqual(response.read(), b"forbidden")
            upstream_open.assert_not_called()
            inject_defaults.assert_not_called()
        self.proxy_impl.assert_not_called()

    def test_stream_http_error_forwards_status_body_and_content_type(self):
        error_body = b'{"error":"rate limited"}'

        class Upstream(BaseHTTPRequestHandler):
            def do_POST(self):
                self.rfile.read(int(self.headers["Content-Length"]))
                self.send_response(429)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(error_body)))
                self.end_headers()
                self.wfile.write(error_body)

            def log_message(self, *args):
                pass

        upstream = self._serve(Upstream)
        gateway = self._gateway(green_backend_base_url=f"http://127.0.0.1:{upstream.server_port}")
        with self._request(gateway, b'{"stream":true}') as response:
            self.assertEqual(response.status, 429)
            self.assertEqual(response.getheader("Content-Type"), "application/json")
            self.assertEqual(response.getheader("Content-Length"), str(len(error_body)))
            self.assertEqual(response.read(), error_body)
        self.proxy_impl.assert_not_called()

    def test_stream_open_or_initial_read_failure_returns_buffered_502(self):
        gateway = self._gateway()
        for error, during_read in (
            (urllib.error.URLError("unreachable"), False),
            (TimeoutError("timed out"), False),
            (TimeoutError("timed out"), True),
        ):
            with self.subTest(error=type(error).__name__, during_read=during_read):
                upstream = io.BytesIO()
                upstream.read1 = Mock(side_effect=error)
                with patch.object(self.module.urllib.request, "urlopen", side_effect=None if during_read else error, return_value=upstream) as upstream_open:
                    with self._request(gateway, b'{"stream":true}') as response:
                        reason = error.reason if isinstance(error, urllib.error.URLError) else error
                        expected = f"bad gateway: {reason}".encode()
                        self.assertEqual(response.status, 502)
                        self.assertEqual(response.getheader("Content-Type"), "text/plain; charset=utf-8")
                        self.assertEqual(response.getheader("Content-Length"), str(len(expected)))
                        self.assertEqual(response.read(), expected)
                    self.assertEqual(upstream_open.call_args.kwargs["timeout"], 120)
                if during_read:
                    self.assertTrue(upstream.closed)
        self.proxy_impl.assert_not_called()

    def test_stream_read_failure_after_first_chunk_closes_without_second_response(self):
        gateway = self._gateway()
        first = b"data: hello\n\n"
        upstream = io.BytesIO()
        upstream.status = 200
        upstream.headers = {"Content-Type": "text/event-stream"}
        upstream.read1 = Mock(side_effect=[first, TimeoutError("timed out")])
        with patch.object(self.module.urllib.request, "urlopen", return_value=upstream):
            with self._request(gateway, b'{"stream":true}') as response:
                self.assertEqual(response.status, 200)
                self.assertEqual(response.read(), first)
        self.assertTrue(upstream.closed)
        self.proxy_impl.assert_not_called()

    def test_stream_client_disconnect_closes_upstream_without_raising(self):
        handler_type = self.module.make_handler(self.config, proxy_impl=self.proxy_impl)
        for error_type in (BrokenPipeError, ConnectionResetError):
            for operation in ("write", "flush"):
                with self.subTest(error=error_type.__name__, operation=operation):
                    upstream = io.BytesIO(b"data: hello\n\n")
                    upstream.status = 200
                    upstream.headers = {"Content-Type": "text/event-stream"}
                    handler = handler_type.__new__(handler_type)
                    handler.send_response = Mock()
                    handler.send_header = Mock()
                    handler.end_headers = Mock()
                    handler.wfile = Mock()
                    getattr(handler.wfile, operation).side_effect = error_type("client disconnected")
                    with patch.object(self.module.urllib.request, "urlopen", return_value=upstream):
                        handler._proxy_stream("http://127.0.0.1:1/v1/chat/completions", b'{"stream":true}', {})
                    self.assertTrue(upstream.closed)
                    self.assertTrue(handler.close_connection)
                    handler.send_response.assert_called_once_with(200)

    def test_non_streaming_bodies_and_other_routes_keep_using_proxy_impl(self):
        gateway = self._gateway()
        cases = [
            ("/v1/chat/completions", b'{"stream":false}'),
            ("/v1/chat/completions", b'{"messages":[]}'),
            ("/v1/chat/completions", b"not JSON"),
            ("/v1/chat/completions", b"\xff"),
            ("/v1/chat/completions", b'[{"stream":true}]'),
            ("/v1/chat/completions", b'{"stream":1}'),
            ("/v1/chat/completions", b'{"stream":"true"}'),
            ("/v1/completions", b'{"stream":false}'),
            ("/embed", b'{"stream":true}'),
            ("/v1/embeddings", b'{"stream":true}'),
        ]
        with patch.object(self.module.urllib.request, "urlopen") as upstream_open:
            for path, body in cases:
                with self.subTest(path=path, body=body):
                    with self._request(gateway, body, path=path) as response:
                        self.assertEqual(response.status, 202)
                        self.assertEqual(response.getheader("Content-Type"), "application/json")
                        self.assertEqual(response.getheader("Content-Length"), "17")
                        self.assertIsNone(response.getheader("Cache-Control"))
                        self.assertIsNone(response.getheader("Connection"))
                        self.assertEqual(response.read(), b"buffered response")
                    url = self.config.embedding_base_url if path == "/embed" else self.config.green_backend_base_url
                    self.proxy_impl.assert_called_with("POST", f"{url}{path}", body, {"Content-Type": "application/json"})
            upstream_open.assert_not_called()
        self.assertEqual(self.proxy_impl.call_count, len(cases))


class PrivateComfyWorkerTests(unittest.TestCase):
    def setUp(self):
        self.module = load_module()
        with patch.dict(os.environ, {}, clear=True):
            self.config = replace(self.module.load_config_from_env(), runtime_control_token="runtime-token")
        self.local = Mock(return_value=(0, "local ok"))
        self.worker = Mock(return_value={"ok": True, "exitCode": 0, "outputSample": "worker ok"})
        self.module.run_local_command = self.local
        self.module.run_worker_command = self.worker
        self.module.write_gateway_resource_state_best_effort = Mock(return_value=None)
        self.module.emit_agent_debug_log = Mock()

    def request(self, action, config=None):
        config = config or replace(self.config, private_comfy_worker_ssh_target="user@spark2.example")
        # Exercise the route directly; no listening socket is needed for command orchestration.
        handler = object.__new__(self.module.make_handler(config))
        handler.path = f"/private-comfyui/{action}"
        handler.headers = {"X-Runtime-Control-Token": "runtime-token", "Content-Length": "2"}
        handler.rfile = io.BytesIO(b"{}")
        handler._send = Mock()
        handler.do_POST()
        handler._send.assert_called_once()
        status, body, content_type = handler._send.call_args.args
        self.assertEqual(content_type, "application/json; charset=utf-8")
        return status, body

    def test_unset_target_preserves_all_response_bodies_without_threads_or_ssh(self):
        for action in ("start", "stop"):
            for result, status, fields in (
                ((0, "local ok"), 200, {"ok": True}),
                ((1, "failed"), 502, {"ok": False, "exitCode": 1, "output": "failed"}),
                (self.module.subprocess.TimeoutExpired("local", 240), 504, {"ok": False, "message": "timeout"}),
                (OSError("failed"), 500, {"ok": False, "message": "failed"}),
            ):
                with self.subTest(action=action, status=status):
                    self.local.side_effect = result if isinstance(result, Exception) else None
                    self.local.return_value = result
                    with patch.object(self.module, "ThreadPoolExecutor") as executor:
                        actual_status, body = self.request(action, self.config)
                    expected = {"ok": fields.pop("ok"), "path": f"/private-comfyui/{action}", **fields}
                    self.assertEqual((actual_status, body), (status, json.dumps(expected).encode()))
                    executor.assert_not_called()
        self.worker.assert_not_called()
        self.assertEqual(self.local.call_args.args[-1], 240)

    def test_start_and_stop_worker_failures_do_not_change_local_success(self):
        self.worker.return_value = {"ok": False, "exitCode": 255, "outputSample": "ssh failed"}
        for action in ("start", "stop"):
            with self.subTest(action=action):
                status, body = self.request(action)
                self.assertEqual(status, 200)
                self.assertEqual(json.loads(body), {"ok": True, "path": f"/private-comfyui/{action}",
                                                    "worker": self.worker.return_value})
                self.worker.assert_called_with("user@spark2.example",
                                               getattr(self.config, f"private_comfy_worker_{action}_cmd"), 20)

    def test_local_start_failures_attempt_worker_stop_after_both_commands(self):
        for result, status in (((1, "failed"), 502),
                               (self.module.subprocess.TimeoutExpired("local", 20), 504),
                               (OSError("failed"), 500)):
            with self.subTest(status=status):
                self.worker.reset_mock()
                self.local.side_effect = result if isinstance(result, Exception) else None
                self.local.return_value = result
                actual_status, body = self.request("start")
                self.assertEqual(actual_status, status)
                self.assertFalse(json.loads(body)["ok"])
                self.assertEqual(json.loads(body)["worker"], self.worker.return_value)
                self.assertEqual([call.args for call in self.worker.call_args_list], [
                    ("user@spark2.example", self.config.private_comfy_worker_start_cmd, 20),
                    ("user@spark2.example", self.config.private_comfy_worker_stop_cmd, 5),
                ])

    def test_failed_cleanup_does_not_change_local_failure_status(self):
        self.local.return_value = (1, "failed")
        self.worker.return_value = {"ok": False, "message": "timeout", "outputSample": ""}
        self.assertEqual(self.request("start")[0], 502)
        self.assertEqual(self.worker.call_count, 2)

    def test_local_stop_failure_still_stops_worker(self):
        self.local.return_value = (1, "failed")
        status, body = self.request("stop")
        self.assertEqual(status, 502)
        self.assertFalse(json.loads(body)["ok"])
        self.worker.assert_called_once_with("user@spark2.example", self.config.private_comfy_worker_stop_cmd, 20)

    def test_start_and_stop_commands_overlap_and_are_bounded(self):
        for action in ("start", "stop"):
            with self.subTest(action=action):
                barrier = threading.Barrier(2, timeout=1)
                def local(*args):
                    barrier.wait()
                    return 0, "ok"
                def worker(*args):
                    barrier.wait()
                    return {"ok": True, "exitCode": 0, "outputSample": "ok"}
                self.local.side_effect = local
                self.worker.side_effect = worker
                config = replace(self.config, private_comfy_worker_ssh_target="user@spark2.example",
                                 private_comfy_worker_cmd_timeout_sec=60)
                status, body = self.request(action, config)
                self.assertEqual(status, 200, body)
                self.assertTrue(json.loads(body)["worker"]["ok"])
                self.assertEqual(self.local.call_args.args[-1], self.config.private_comfy_cmd_timeout_sec)
                self.assertEqual(self.worker.call_args.args[-1], 20)

    def test_invalid_target_is_disabled_with_one_log_line_and_routes_work(self):
        for target in ("host", "-oProxyCommand=bad", "user@host;echo bad", "user@host\n", " user@host"):
            with self.subTest(target=target):
                with patch.dict(os.environ, {"PRIVATE_COMFY_WORKER_SSH_TARGET": target}, clear=True), \
                     patch("sys.stderr", new_callable=io.StringIO) as stderr:
                    config = replace(self.module.load_config_from_env(), runtime_control_token="runtime-token")
                self.assertEqual(config.private_comfy_worker_ssh_target, "")
                self.assertEqual(len(stderr.getvalue().splitlines()), 1)
                for action in ("start", "stop"):
                    status, body = self.request(action, config)
                    self.assertEqual(status, 200)
                    self.assertNotIn("worker", json.loads(body))
        self.worker.assert_not_called()

    def test_worker_environment_settings(self):
        env = {"PRIVATE_COMFY_WORKER_SSH_TARGET": "user@spark2.example",
               "PRIVATE_COMFY_WORKER_START_CMD": "custom start",
               "PRIVATE_COMFY_WORKER_STOP_CMD": "custom stop",
               "PRIVATE_COMFY_WORKER_CMD_TIMEOUT_SEC": "7"}
        with patch.dict(os.environ, env, clear=True):
            config = replace(self.module.load_config_from_env(), runtime_control_token="runtime-token")
        for action in ("start", "stop"):
            self.assertEqual(self.request(action, config)[0], 200)
            self.worker.assert_called_with("user@spark2.example", f"custom {action}", 7)

    def test_worker_command_exact_ssh_argv_output_and_failure_mapping(self):
        module = load_module()
        for returncode in (0, 255):
            with self.subTest(returncode=returncode):
                proc = Mock(returncode=returncode, stdout="x" * 500, stderr="error")
                with patch.object(module.subprocess, "run", return_value=proc) as run, \
                     patch("sys.stderr", new_callable=io.StringIO) as stderr:
                    result = module.run_worker_command("user@spark2.example", "docker compose up -d", 7)
                run.assert_called_once_with(
                    ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "--",
                     "user@spark2.example", "docker compose up -d"],
                    timeout=7, capture_output=True, text=True, check=False,
                )
                self.assertEqual(result, {"ok": returncode == 0, "exitCode": returncode, "outputSample": "x" * 400})
                self.assertEqual(len(stderr.getvalue().splitlines()), int(returncode != 0))
        for exc, message in ((module.subprocess.TimeoutExpired("ssh", 7), "timeout"), (OSError("failed"), "failed")):
            with patch.object(module.subprocess, "run", side_effect=exc), \
                 patch("sys.stderr", new_callable=io.StringIO) as stderr:
                result = module.run_worker_command("user@spark2.example", "stop", 7)
            self.assertEqual(result, {"ok": False, "message": message, "outputSample": ""})
            self.assertEqual(len(stderr.getvalue().splitlines()), 1)


if __name__ == "__main__":
    unittest.main()
