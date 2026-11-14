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
    def test_metrics_timeouts_skip_fallback_queries(self):
        module = load_module()
        timeout = module.subprocess.TimeoutExpired('metrics', 10)
        for preceding, count in (([], 1), ([Mock(returncode=1)], 2),
                ([Mock(returncode=0, stdout='44, 32768, 131072'),
                  Mock(returncode=0, stdout='MemTotal: 134217728')], 3),
                ([Mock(returncode=0, stdout='44, 32768, 131072'),
                  Mock(returncode=0, stdout='MemTotal: 134217728'), Mock(returncode=1)], 4)):
            with self.subTest(count=count), patch.object(module.subprocess, 'run', side_effect=[*preceding, timeout]) as run:
                self.assertEqual(module.collect_gpu_metrics(), (False, None))
                self.assertEqual(run.call_count, count)
                self.assertTrue(all(call.kwargs['timeout'] == 10 for call in run.call_args_list))
        with patch.object(module.subprocess, 'run', side_effect=timeout) as run:
            self.assertFalse(module.is_container_running('container'))
            run.assert_called_once()
            self.assertEqual(run.call_args.kwargs['timeout'], 10)

    def test_collect_gpu_metrics_includes_detail_fields(self):
        module = load_module()

        class Proc:
            def __init__(self, returncode: int, stdout: str):
                self.returncode = returncode
                self.stdout = stdout

        calls: list[str] = []

        def run_impl(args, capture_output: bool, text: bool, check: bool, timeout=10):
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

        def run_impl(args, capture_output: bool, text: bool, check: bool, timeout=10):
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


class BusinessRoutingContractTests(unittest.TestCase):
    def setUp(self):
        self.module = load_module()
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.state = self.root / 'active.json'
        Path(str(self.state) + '.lock').touch()  # Created by control-server init.
        self.value = {'modelProfileId': 'business_deepseek_v41_flash_tp2', 'backend': 'blue',
            'displayNameJa': 'DeepSeek', 'servedAlias': 'system-prod-primary', 'stateUpdatedAt': '2026-11-02T00:00:00Z',
            'selectedBusinessProfileId': 'business_deepseek_v41_flash_tp2', 'selectionRevision': 3,
            'businessTransition': 'ready', 'businessGeneration': 'generation-3'}
        self.state.write_text(json.dumps(self.value))
        self.config = replace(self.module.load_config_from_env(), active_model_state_path=str(self.state),
            llm_shared_tokens=frozenset({'client-key'}), runtime_control_token='control-key',
            blue_backend_base_url='http://untrusted.invalid', model_registry_root=str(self.root / 'registry'))
        self.flag = patch.dict(os.environ, {'BUSINESS_DEEPSEEK_SWITCH_ENABLED': 'true',
            'DGX_PRIVATE_SHARED_DEEPSEEK_ENABLED': 'false',
            'BUSINESS_DEEPSEEK_UPSTREAM_API_KEY': 'business-only-key'})
        self.flag.start()
        self.addCleanup(self.flag.stop)
        self.calls = []
        self.runtime = {'modelProfileId': self.module.DEEPSEEK_PROFILE, 'selectionRevision': 3,
            'generation': 'generation-3', 'prepared': True, 'failureReason': None, 'apiListenerClosed': False,
            'launcherStopped': False, 'watchdogStopped': False,
            'ranks': [{'rank': r, 'generation': 'generation-3', 'running': True, 'gpuReleased': False} for r in (0, 1)],
            'privateSharingEvidence': {'generation': 'generation-3', 'weightsRevision': '878f5689-ablit-0bdc2036',
                'runtimeIdentity': 'tensorfold-native:serve:8889:parallel4:thinking', 'promptCacheGiB': 0,
                'learn': False, 'logDriver': 'none', 'requestResponseLogging': False, 'persistsConversations': False}}
        def proxy(method, url, body, headers):
            self.calls.append((method, url, body, headers))
            if url.endswith('/v1/models'):
                return 200, b'{"data":[{"id":"system-prod-primary"},{"id":"private-model"}]}', 'application/json'
            if url.endswith('/system/resource-state'):
                return 200, json.dumps({'ok': True, 'businessRuntime': self.runtime}).encode(), 'application/json'
            return 200, b'{"model":"upstream-internal-name","choices":[]}', 'application/json'
        self.handler = self.module.make_handler(self.config, proxy)

    def request(self, method='POST', path='/v1/chat/completions', payload=None, token='client-key', runtime_token=None,
                shared=None, extra_headers=''):
        data = json.dumps(payload or {'model': 'system-prod-primary', 'messages': [{'role': 'user', 'content': 'hello'}]}).encode() if method == 'POST' else b''
        headers = f'{method} {path} HTTP/1.0\r\nAuthorization: Bearer {token}\r\nContent-Length: {len(data)}\r\n'
        if runtime_token:
            headers += f'X-Runtime-Control-Token: {runtime_token}\r\n'
        if shared is not None:
            headers += f'X-Private-Shared-Runtime: {shared}\r\n'
        headers += extra_headers
        request = headers.encode() + b'\r\n' + data
        output = io.BytesIO()
        class Connection:
            def makefile(self, *args): return io.BytesIO(request)
            def sendall(self, data): output.write(data)
        self.handler(Connection(), ('127.0.0.1', 0), object())
        head, body = output.getvalue().split(b'\r\n\r\n', 1)
        return int(head.split()[1]), body

    def test_deepseek_json_object_adds_system_instruction_without_mutating_input(self):
        for content in ('Original system', [{'type': 'text', 'text': 'Original system'}], None):
            with self.subTest(content=content):
                payload = {'messages': [{'role': 'system', 'content': content}],
                    'response_format': {'type': 'json_object'}}
                original = json.dumps(payload)
                prepared, enabled = self.module.deepseek_json_request(payload)
                self.assertTrue(enabled)
                self.assertEqual(json.dumps(payload), original)
                self.assertNotIn('response_format', prepared)
                self.assertIn('exactly one JSON object', str(prepared['messages'][0]['content']))
                self.assertEqual(self.request(payload=payload)[0], 200)
                sent = json.loads(self.calls[-1][2])
                self.assertNotIn('response_format', sent)
                self.assertIn('no code fences', str(sent['messages'][0]['content']))
                if isinstance(content, str):
                    self.assertTrue(sent['messages'][0]['content'].startswith(content + '\n\n'))
                elif isinstance(content, list):
                    self.assertEqual(sent['messages'][0]['content'][:-1], content)
                else:
                    self.assertEqual(sent['messages'][1], payload['messages'][0])

    def test_deepseek_json_schema_removes_guided_fields_and_adds_schema(self):
        schema = {'type': 'object', 'properties': {'名前': {'type': 'string'}}}
        for fields in ({'guided_json': schema}, {'guided_json': json.dumps(schema)},
                       {'response_format': {'type': 'json_schema', 'json_schema': {'schema': schema}}}):
            with self.subTest(fields=fields):
                payload = {'messages': [{'role': 'user', 'content': 'hello'}],
                    'guided_regex': '.*', 'guided_custom': True, **fields}
                self.assertEqual(self.request(payload=payload)[0], 200)
                sent = json.loads(self.calls[-1][2])
                self.assertFalse(any(key.startswith('guided_') for key in sent))
                self.assertNotIn('response_format', sent)
                self.assertIn(json.dumps(schema, ensure_ascii=False), sent['messages'][0]['content'])
                self.assertEqual(sent['messages'][1:], payload['messages'])

    def test_deepseek_json_response_extracts_objects_and_keeps_alias(self):
        obj = {'名前': 'value'}
        encoded = json.dumps(obj, ensure_ascii=False)
        contents = [encoded, '<think>reasoning\nmore</think>\n```json\n' + encoded + '\n```',
            '```\n' + encoded + '\n```', 'prefix {broken} then ' + encoded + ' trailing',
            '[' + encoded + ']', 'unextractable content', '[1, 2]', None]
        raw = json.dumps({'model': 'internal', 'choices': [
            {'message': {'content': content}} for content in contents]}).encode()
        self.handler = self.module.make_handler(self.config, Mock(return_value=(200, raw, 'application/json')))
        status, body = self.request(payload={'response_format': {'type': 'json_object'}})
        self.assertEqual(status, 200)
        result = json.loads(body)
        self.assertEqual(result['model'], 'system-prod-primary')
        for index, choice in enumerate(result['choices']):
            if index < 5:
                self.assertEqual(json.loads(choice['message']['content']), obj)
            else:
                self.assertEqual(choice['message']['content'], contents[index])

    def test_deepseek_json_response_strips_incomplete_think_blocks(self):
        encoded = json.dumps({'answer': 2})
        unclosed = '<think>maybe answer {"draft": 1} then'
        for content, expected in ((unclosed, unclosed),
                ('reasoning</think>\n' + encoded, encoded),
                ('maybe answer {"draft": 1} then</think>\n' + encoded, encoded)):
            with self.subTest(content=content):
                raw = json.dumps({'model': 'internal', 'choices': [{'message': {'content': content}}]}).encode()
                result = json.loads(self.module.deepseek_json_response(raw))
                self.assertEqual(result['choices'][0]['message']['content'], expected)

    def test_deepseek_json_invalid_response_body_and_errors_are_unchanged(self):
        for status, raw in ((200, b'{broken'), (200, b'\xff'), (400, b'upstream error')):
            with self.subTest(status=status, raw=raw):
                self.assertEqual(self.module.deepseek_json_response(raw), raw)
                self.handler = self.module.make_handler(self.config, Mock(return_value=(status, raw, 'application/json')))
                self.assertEqual(self.request(payload={'response_format': {'type': 'json_object'}}), (status, raw))

    def test_deepseek_without_json_mode_preserves_existing_body_and_content(self):
        raw = b'{"model":"internal","choices":[{"message":{"content":"```json\\n{}\\n```"}}]}'
        for fields in ({}, {'response_format': {'type': 'text'}}):
            with self.subTest(fields=fields):
                payload = {'model': 'system-prod-primary', 'messages': [{'role': 'user', 'content': 'hello'}], **fields}
                proxy = Mock(return_value=(200, raw, 'application/json'))
                self.handler = self.module.make_handler(self.config, proxy)
                status, body = self.request(payload=payload)
                self.assertEqual(status, 200)
                expected = {key: value for key, value in payload.items() if key != 'response_format'}
                self.assertEqual(proxy.call_args.args[2], json.dumps(expected, ensure_ascii=False).encode())
                self.assertEqual(body, self.module.business_response_alias(raw))
                prepared, enabled = self.module.deepseek_json_request(payload)
                self.assertFalse(enabled)
                self.assertEqual(prepared, expected)

    def test_json_mode_only_applies_to_deepseek_chat_completions(self):
        payload = {'response_format': {'type': 'json_object'}, 'messages': []}
        self.assertEqual(self.request(path='/v1/completions', payload=payload)[0], 200)
        self.assertEqual(json.loads(self.calls[-1][2])['response_format'], payload['response_format'])
        self.value.update(modelProfileId=self.module.GLM_PROFILE, selectedBusinessProfileId=self.module.GLM_PROFILE)
        self.state.write_text(json.dumps(self.value))
        self.assertEqual(self.request(payload=payload)[0], 200)
        expected = self.module.inject_blue_chat_completions_defaults('/v1/chat/completions',
            json.dumps({**payload, 'model': 'system-prod-primary'}, ensure_ascii=False).encode(), 'blue', self.config)
        self.assertEqual(self.calls[-1][2], expected)
        self.assertEqual(json.loads(self.calls[-1][2])['response_format'], payload['response_format'])

    def test_deepseek_json_stream_only_changes_request(self):
        raw = b'data: {"model":"internal","choices":[{"delta":{"content":"```json"}}]}\n\ndata: [DONE]\n\n'
        response = io.BytesIO(raw)
        response.status = 200
        response.headers = {'Content-Type': 'text/event-stream'}
        with patch.object(self.module, 'business_urlopen', return_value=response) as upstream:
            status, body = self.request(path='/v1/chat/completions/', payload={'stream': True,
                'response_format': {'type': 'json_object'}, 'messages': []})
        self.assertEqual(status, 200)
        sent = json.loads(upstream.call_args.args[0].data)
        self.assertNotIn('response_format', sent)
        self.assertIn('exactly one JSON object', sent['messages'][0]['content'])
        self.assertEqual(body, raw.replace(b'"model":"internal","choices":[{"delta":{"content":"```json"}}]',
            b'"model": "system-prod-primary", "choices": [{"delta": {"content": "```json"}}]'))

    def test_shared_header_rejects_stale_empty_duplicate_or_disabled_without_body_echo(self):
        with patch.dict(os.environ, {'DGX_PRIVATE_SHARED_DEEPSEEK_ENABLED': 'true'}):
            for shared in ('2:generation-3', '3:stale-generation', '', 'private-body-sentinel'):
                for method in ('GET', 'POST'):
                    with self.subTest(shared=shared, method=method):
                        status, body = self.request(method, shared=shared,
                            payload={'messages': [{'content': 'private-body-sentinel'}]})
                        self.assertEqual((status, body), (409, b''))
            self.assertEqual(self.request(shared='3:generation-3',
                extra_headers='X-Private-Shared-Runtime: 3:generation-3\r\n'), (409, b''))
        self.assertEqual(self.calls, [])
        for flags in ({'DGX_PRIVATE_SHARED_DEEPSEEK_ENABLED': 'false'},
                      {'DGX_PRIVATE_SHARED_DEEPSEEK_ENABLED': 'true', 'BUSINESS_DEEPSEEK_SWITCH_ENABLED': 'false'}):
            with patch.dict(os.environ, flags):
                self.assertEqual(self.request(shared='3:generation-3'), (409, b''))
        self.assertFalse(any(url.endswith('/v1/chat/completions') for _, url, _, _ in self.calls))

    def test_matching_shared_header_passes_with_fixed_route_fresh_proof_and_no_body_logs(self):
        with patch.dict(os.environ, {'DGX_PRIVATE_SHARED_DEEPSEEK_ENABLED': 'true'}), \
                patch.object(self.module.sys, 'stderr', new_callable=io.StringIO) as logs:
            for method, path in (('POST', '/v1/chat/completions'), ('GET', '/v1/models')):
                self.assertEqual(self.request(method, path, shared='3:generation-3',
                    payload={'messages': [{'role': 'user', 'content': 'private-body-sentinel'}]})[0], 200)
                self.assertEqual(self.calls[-2][1], self.config.runtime_control_base_url + '/system/resource-state')
                self.assertEqual(self.calls[-1][1], 'http://192.168.100.11:8889' + path)
                self.assertNotIn('X-Private-Shared-Runtime', self.calls[-1][3])
            self.assertEqual(logs.getvalue(), '')
            self.assertFalse(hasattr(self.module, 'emit_agent_debug_log'))

    def test_shared_status_attestation_publishes_only_complete_current_ready_proof(self):
        def snapshot():
            status, body = self.request('GET', '/system/resource-state', runtime_token='control-key')
            self.assertEqual(status, 200)
            runtime = json.loads(body)['businessRuntime']
            self.assertNotIn('privateSharingEvidence', runtime)
            return runtime
        self.assertNotIn('privateSharing', snapshot())
        with patch.dict(os.environ, {'DGX_PRIVATE_SHARED_DEEPSEEK_ENABLED': 'true'}):
            proof = snapshot()['privateSharing']
            self.assertEqual(proof, {**self.runtime['privateSharingEvidence'], 'selectionRevision': 3,
                                    'generationFenced': True})
            original = json.loads(json.dumps(self.runtime))
            mutations = [lambda r: r.pop('privateSharingEvidence'),
                lambda r: r['privateSharingEvidence'].pop('logDriver'),
                lambda r: r['privateSharingEvidence'].update(logDriver='unknown'),
                lambda r: r['privateSharingEvidence'].update(learn=0),
                lambda r: r['privateSharingEvidence'].update(promptCacheGiB=False),
                lambda r: r['privateSharingEvidence'].update(requestResponseLogging=True),
                lambda r: r['privateSharingEvidence'].update(persistsConversations=True),
                lambda r: r.update(generation='stale'), lambda r: r.update(selectionRevision=2),
                lambda r: r.update(prepared=False), lambda r: r.update(apiListenerClosed=True),
                lambda r: r.update(failureReason='business_control_restarted'),
                lambda r: r['ranks'][1].update(running=False)]
            for index, mutate in enumerate(mutations):
                with self.subTest(mutation=index):
                    self.runtime = json.loads(json.dumps(original))
                    mutate(self.runtime)
                    self.assertNotIn('privateSharing', snapshot())
                    self.assertEqual(self.request(shared='3:generation-3'), (409, b''))
            self.runtime = original
            for transition in ('loading', 'failed', 'idle'):
                self.state.write_text(json.dumps({**self.value, 'businessTransition': transition}))
                self.assertNotIn('privateSharing', snapshot())
                self.assertEqual(self.request(shared='3:generation-3'), (409, b''))

    def test_no_shared_header_retains_business_behavior_even_without_proof(self):
        self.runtime.pop('privateSharingEvidence')
        with patch.dict(os.environ, {'DGX_PRIVATE_SHARED_DEEPSEEK_ENABLED': 'true'}):
            self.assertEqual(self.request()[0], 200)
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(self.calls[0][1], 'http://192.168.100.11:8889/v1/chat/completions')

    def test_shared_requests_refuse_glm_and_mutations_and_hold_generation_during_forward(self):
        from active_model_state import business_state_lock
        with patch.dict(os.environ, {'DGX_PRIVATE_SHARED_DEEPSEEK_ENABLED': 'true'}):
            with business_state_lock(str(self.state)):
                self.assertEqual(self.request(shared='3:generation-3'), (409, b''))
            self.assertEqual(self.request(path='/start', shared='3:generation-3'), (409, b''))
            self.state.write_text(json.dumps({**self.value, 'modelProfileId': self.module.GLM_PROFILE,
                'selectedBusinessProfileId': self.module.GLM_PROFILE}))
            self.assertEqual(self.request(shared='3:generation-3'), (409, b''))
            self.assertEqual(self.calls, [])
            self.state.write_text(json.dumps(self.value))
            def proxy(method, url, body, headers):
                with self.assertRaises(BlockingIOError):
                    with business_state_lock(str(self.state), blocking=False):
                        pass
                if url.endswith('/system/resource-state'):
                    return 200, json.dumps({'businessRuntime': self.runtime}).encode(), 'application/json'
                return 200, b'{"model":"system-prod-primary","choices":[]}', 'application/json'
            self.handler = self.module.make_handler(self.config, proxy)
            self.assertEqual(self.request(shared='3:generation-3')[0], 200)

    def test_shared_stream_uses_matching_generation_and_does_not_log_output(self):
        response = io.BytesIO()
        response.status = 200
        response.headers = {'Content-Type': 'text/event-stream'}
        response.read1 = Mock(side_effect=[b'data: {"model":"internal","choices":[{"delta":{"content":"private-output"}}]}\n\n', b''])
        with patch.dict(os.environ, {'DGX_PRIVATE_SHARED_DEEPSEEK_ENABLED': 'true'}), \
                patch.object(self.module.sys, 'stderr', new_callable=io.StringIO) as logs, \
                patch.object(self.module, 'business_urlopen', return_value=response) as upstream:
            status, body = self.request(payload={'stream': True}, shared='3:generation-3')
        self.assertEqual(status, 200)
        self.assertIn(b'private-output', body)
        self.assertEqual(upstream.call_args.args[0].full_url, 'http://192.168.100.11:8889/v1/chat/completions')
        self.assertEqual(logs.getvalue(), '')

    def test_deepseek_fixed_route_credential_alias_and_no_glm_transform(self):
        status, body = self.request()
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)['model'], 'system-prod-primary')
        method, url, body, headers = self.calls[-1]
        self.assertEqual(url, 'http://192.168.100.11:8889/v1/chat/completions')
        self.assertEqual(headers['Authorization'], 'Bearer business-only-key')
        self.assertNotIn('client-key', str(headers))
        self.assertNotIn('chat_template_kwargs', json.loads(body))
        status, body = self.request('GET', '/v1/models')
        self.assertEqual(status, 200)
        self.assertEqual([m['id'] for m in json.loads(body)['data']], ['system-prod-primary'])

    def test_glm_fixed_route_ignores_backend_url_env(self):
        self.value.update(modelProfileId='business_glm53_flash_fp4_tp2', selectedBusinessProfileId='business_glm53_flash_fp4_tp2')
        self.state.write_text(json.dumps(self.value))
        self.assertEqual(self.request()[0], 200)
        self.assertEqual(self.calls[-1][1], 'http://127.0.0.1:38083/v1/chat/completions')
        self.assertNotIn('Authorization', self.calls[-1][3])

    def test_legacy_glm_initial_state_routes_without_generation(self):
        self.value.update(modelProfileId=self.module.GLM_PROFILE, selectedBusinessProfileId=self.module.GLM_PROFILE,
            businessTransition='idle', selectionRevision=0)
        self.value.pop('businessGeneration')
        for generation in (None, ''):
            if generation is not None:
                self.value['businessGeneration'] = generation
            self.state.write_text(json.dumps(self.value))
            for method, path in (('POST', '/v1/chat/completions'), ('GET', '/v1/models')):
                with self.subTest(generation=generation, path=path):
                    self.assertEqual(self.request(method, path)[0], 200)
                    self.assertEqual(self.calls[-1][1], 'http://127.0.0.1:38083' + path)
                    self.assertNotIn('Authorization', self.calls[-1][3])

    def test_legacy_glm_initial_state_boundaries_fail_closed(self):
        self.value.update(modelProfileId=self.module.GLM_PROFILE, selectedBusinessProfileId=self.module.GLM_PROFILE,
            businessTransition='idle', selectionRevision=0)
        self.value.pop('businessGeneration')
        for changes in ({'selectionRevision': 1}, {'businessTransition': 'loading'},
                        {'businessTransition': 'failed'}, {'backend': 'green'},
                        {'servedAlias': 'other'}, {'businessGeneration': 'generation-1'},
                        {'modelProfileId': self.module.DEEPSEEK_PROFILE},
                        {'modelProfileId': self.module.DEEPSEEK_PROFILE,
                         'selectedBusinessProfileId': self.module.DEEPSEEK_PROFILE}):
            self.state.write_text(json.dumps({**self.value, **changes}))
            for method, path in (('POST', '/v1/chat/completions'), ('GET', '/v1/models')):
                with self.subTest(changes=changes, path=path):
                    status, body = self.request(method, path)
                    self.assertEqual(status, 503)
                    self.assertEqual(json.loads(body)['error']['code'], 'business_runtime_unavailable')
        self.assertEqual(self.calls, [])

    def test_images_wrong_model_missing_key_and_unknown_private_or_transition_fail_closed(self):
        self.assertEqual(self.request(payload={'messages': [{'content': [{'type': 'image_url', 'image_url': {'url': 'data:secret'}}]}]})[0], 400)
        self.assertEqual(self.request(payload={'model': 'other'})[0], 400)
        for changes in ({'businessTransition': 'loading'}, {'businessTransition': 'failed'},
                        {'modelProfileId': 'private_deepseek_v41_flash_tp2'}, {'businessGeneration': ''}):
            self.state.write_text(json.dumps({**self.value, **changes}))
            self.assertEqual(self.request()[0], 503)
            self.assertEqual(self.request('GET', '/v1/models')[0], 503)
        self.state.write_text('{broken')
        self.assertEqual(self.request()[0], 503)
        self.state.write_text(json.dumps(self.value))
        with patch.dict(os.environ, {'BUSINESS_DEEPSEEK_UPSTREAM_API_KEY': ''}):
            self.assertEqual(self.request()[0], 503)
        self.assertEqual(self.calls, [])

    def test_sse_alias_auth_and_raw_deepseek_body(self):
        chunks = [b'data: {"model":"internal","choices":[{"delta":{"content":"he',
                  b'llo"}}]}\n\ndata: [DONE]\n\n', b'']
        response = io.BytesIO()
        response.status = 200
        response.headers = {'Content-Type': 'text/event-stream'}
        response.read1 = Mock(side_effect=chunks)
        with patch.object(self.module, 'business_urlopen', return_value=response) as upstream:
            status, body = self.request(payload={'model': 'system-prod-primary', 'stream': True, 'messages': []})
        self.assertEqual(status, 200)
        self.assertIn(b'"model": "system-prod-primary"', body)
        self.assertIn(b'hello', body)
        self.assertIn(b'data: [DONE]', body)
        req = upstream.call_args.args[0]
        self.assertEqual(req.full_url, 'http://192.168.100.11:8889/v1/chat/completions')
        self.assertEqual(req.get_header('Authorization'), 'Bearer business-only-key')
        self.assertNotIn('chat_template_kwargs', json.loads(req.data))
        self.assertTrue(response.closed)

    def test_sse_preserves_non_objects_keepalives_comments_and_split_lines(self):
        raw = (b': keepalive\r\ndata: ping\ndata: [DONE]\n\ndata: [1,2]\n'
               b'data: "text"\ndata: null\ndata: {broken}\ndata: \xff\n'
               b'data: {"choices":[]}\ndata: {"model":"internal","choices":[]}\r\n'
               b'data: final keepalive')
        # Split every byte, including data:, UTF-8/non-JSON and CRLF boundaries.
        for chunks in ([raw, b''], [bytes([c]) for c in raw] + [b'']):
            response = io.BytesIO()
            response.status = 200
            response.headers = {'Content-Type': 'text/event-stream'}
            response.read1 = Mock(side_effect=chunks)
            with self.subTest(chunks=len(chunks)), patch.object(self.module, 'business_urlopen', return_value=response):
                status, body = self.request(payload={'stream': True, 'messages': []})
            self.assertEqual(status, 200)
            self.assertEqual(body, raw.replace(b'data: {"model":"internal","choices":[]}',
                b'data: {"model": "system-prod-primary", "choices": []}'))

    def test_image_named_tool_schema_is_allowed_but_image_content_is_rejected(self):
        payload = {'messages': [{'role': 'user', 'content': 'Describe the image property'}],
            'tools': [{'type': 'function', 'function': {'name': 'image', 'parameters':
                {'type': 'object', 'properties': {'image': {'type': 'string'},
                    'input': {'type': 'image_url'}}}}}]}
        self.assertEqual(self.request(payload=payload)[0], 200)
        self.assertEqual(json.loads(self.calls[-1][2])['tools'], payload['tools'])
        for kind in ('image_url', 'input_image', 'image'):
            with self.subTest(kind=kind):
                payload['messages'][0]['content'] = [{'type': kind, 'image_url': {'url': 'unused'}}]
                self.assertEqual(self.request(payload=payload)[0], 400)

    def test_gateway_shared_lock_requires_only_read_access(self):
        original_open = Path.open
        modes = []
        def restricted_open(path, mode='r', *args, **kwargs):
            if str(path).endswith('.lock'):
                modes.append(mode)
                if mode != 'r':
                    raise PermissionError('gateway cannot write the lock')
            return original_open(path, mode, *args, **kwargs)
        with patch.object(Path, 'open', restricted_open):
            self.assertEqual(self.request()[0], 200)
        self.assertEqual(modes, ['r'])

    def test_v1_paths_are_forwarded_verbatim_without_url_normalization(self):
        for enabled in ('true', 'false'):
            with patch.dict(os.environ, {'BUSINESS_DEEPSEEK_SWITCH_ENABLED': enabled}):
                for method in ('GET', 'POST'):
                    for tail in ('../reset_prefix_cache', '%2e%2e/reset_mm_cache',
                                 '%2E%2E%2Freset_encoder_cache', '..%2fsleep', '%2fwake_up',
                                 '%2fcollective_rpc', '%2fserver_info'):
                        path = '/v1/' + tail
                        with self.subTest(enabled=enabled, method=method, path=path):
                            self.assertEqual(self.request(method, path)[0], 200)
                            url = self.calls[-1][1]
                            self.assertTrue(url.endswith(path))
                            self.assertEqual(urllib.request.Request(url).selector, path)

    def test_resource_status_requires_runtime_token_and_proxies_structured_control_status(self):
        self.assertEqual(self.request('GET', '/system/resource-state')[0], 403)
        self.assertEqual(self.request('GET', '/system/resource-state', runtime_token='control-key')[0], 200)
        self.assertEqual(self.calls[-1][3], {'X-Runtime-Control-Token': 'control-key'})
        self.assertEqual(self.calls[-1][1], self.config.runtime_control_base_url + '/system/resource-state')

    def test_exclusive_lifecycle_lock_refuses_new_inference(self):
        from active_model_state import business_state_lock
        with business_state_lock(str(self.state)):
            self.assertEqual(self.request()[0], 503)
        self.assertEqual(self.calls, [])

    def test_flag_off_keeps_normal_and_sse_response_bytes(self):
        raw = b'data: {"model":"internal-name","choices":[]}\n\ndata: [DONE]\n\n'
        response = io.BytesIO(raw)
        response.status = 200
        response.headers = {'Content-Type': 'text/event-stream'}
        with patch.dict(os.environ, {'BUSINESS_DEEPSEEK_SWITCH_ENABLED': 'false'}):
            status, body = self.request()
            self.assertEqual(status, 200)
            self.assertEqual(body, b'{"model":"upstream-internal-name","choices":[]}')
            self.assertEqual(self.calls[-1][3], {'Content-Type': 'application/json'})
            with patch.object(self.module, 'business_urlopen', return_value=response):
                status, body = self.request(payload={'stream': True})
            self.assertEqual(status, 200)
            self.assertEqual(body, raw)


    def test_business_exception_logs_identity_without_request_or_credentials(self):
        def fail(*args):
            raise RuntimeError('request-body-secret business-only-key')
        self.handler = self.module.make_handler(self.config, fail)
        for shared, expected in ((None, 503), ('3:generation-3', 409)):
            output = io.StringIO()
            with patch('sys.stderr', output):
                status, body = self.request(shared=shared, payload={'messages': [{'content': 'request-body-secret'}]})
            self.assertEqual(status, expected)
            if shared is not None:
                self.assertEqual(output.getvalue(), '')
                continue
            line = next(line for line in output.getvalue().splitlines() if line.startswith('{'))
            record = json.loads(line)
            self.assertEqual(record['profileId'], self.value['selectedBusinessProfileId'])
            self.assertEqual(record['generation'], 'generation-3')
            self.assertEqual(record['exceptionType'], 'RuntimeError')
            for secret in ('request-body-secret', 'business-only-key', 'client-key', 'control-key'):
                self.assertNotIn(secret, output.getvalue())
            if expected == 503:
                self.assertEqual(json.loads(body)['error']['code'], 'business_runtime_unavailable')


class BusinessQwenRoutingTests(unittest.TestCase):
    request = BusinessRoutingContractTests.request

    def setUp(self):
        BusinessRoutingContractTests.setUp(self)
        flags = patch.dict(os.environ, {'BUSINESS_DEEPSEEK_SWITCH_ENABLED': 'true',
            'BUSINESS_QWEN38_SWITCH_ENABLED': 'true', 'DGX_PRIVATE_SHARED_QWEN38_ENABLED': 'false'})
        flags.start()
        self.addCleanup(flags.stop)
        self.value.update(modelProfileId=self.module.BUSINESS_QWEN38_PROFILE_ID,
            selectedBusinessProfileId=self.module.BUSINESS_QWEN38_PROFILE_ID)
        self.state.write_text(json.dumps(self.value))
        self.runtime['modelProfileId'] = self.module.BUSINESS_QWEN38_PROFILE_ID

    def test_fixed_route_alias_and_qwen_defaults_without_other_model_conversions(self):
        payload = {'messages': [{'role': 'user', 'content': 'hello'}],
            'response_format': {'type': 'json_object'}, 'guided_json': {'type': 'object'}}
        status, body = self.request(payload=payload)
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)['model'], 'system-prod-primary')
        self.assertEqual([call[1] for call in self.calls], [
            self.config.runtime_control_base_url + '/system/resource-state',
            'http://127.0.0.1:38083/v1/models',
            'http://127.0.0.1:38083/v1/chat/completions'])
        self.assertEqual(self.calls[0][3], {'X-Runtime-Control-Token': 'control-key'})
        sent = json.loads(self.calls[-1][2])
        self.assertEqual(sent, {**payload, 'model': 'system-prod-primary',
            'chat_template_kwargs': {'enable_thinking': False}})
        self.assertNotIn('Authorization', self.calls[-1][3])

    def test_business_posts_skip_owner_gate_and_reset_when_sharing_disabled(self):
        for flag in ('', 'false', '0', 'TRUE'):
            with self.subTest(flag=flag), patch.dict(os.environ, {'DGX_PRIVATE_SHARED_QWEN38_ENABLED': flag}), \
                    patch.object(self.module.QwenOwnerExclusive, 'request') as gate, \
                    patch.object(self.module, 'reset_qwen_caches') as reset:
                self.assertEqual(self.request(payload={'messages': []})[0], 200)
                gate.assert_not_called()
                reset.assert_not_called()

    def test_first_business_post_resets_once_when_sharing_enabled(self):
        for flag in ('true', '1'):
            self.enable_sharing()
            with self.subTest(flag=flag), patch.dict(os.environ, {'DGX_PRIVATE_SHARED_QWEN38_ENABLED': flag}), \
                    patch.object(self.module, 'reset_qwen_caches', return_value=True) as reset:
                for _ in range(2):
                    self.assertEqual(self.request(payload={'messages': []})[0], 200)
                reset.assert_called_once()

    def test_thinking_default_preserves_explicit_value_and_other_kwargs(self):
        for kwargs, expected in (({}, {'enable_thinking': False}),
                ({'other': 'value'}, {'other': 'value', 'enable_thinking': False}),
                ({'enable_thinking': True}, {'enable_thinking': True})):
            with self.subTest(kwargs=kwargs):
                self.assertEqual(self.request(payload={'messages': [], 'chat_template_kwargs': kwargs})[0], 200)
                self.assertEqual(json.loads(self.calls[-1][2])['chat_template_kwargs'], expected)

    def test_both_flags_required_including_after_disabling_running_qwen(self):
        for deepseek, qwen, expected in (('false', 'false', 503), ('true', 'false', 503),
                ('false', 'true', 503), ('true', 'true', 200), ('1', '1', 200)):
            with self.subTest(deepseek=deepseek, qwen=qwen), patch.dict(os.environ, {
                    'BUSINESS_DEEPSEEK_SWITCH_ENABLED': deepseek,
                    'BUSINESS_QWEN38_SWITCH_ENABLED': qwen}):
                self.calls.clear()
                for method, path in (('POST', '/v1/chat/completions'), ('GET', '/v1/models')):
                    self.assertEqual(self.request(method, path)[0], expected)
                if expected == 503:
                    self.assertEqual(self.calls, [])

    def test_private_alias_never_receives_business_request_or_stream(self):
        def proxy(method, url, body, headers):
            self.calls.append((method, url, body, headers))
            if url.endswith('/system/resource-state'):
                return 200, json.dumps({'businessRuntime': self.runtime}).encode(), 'application/json'
            return 200, b'{"data":[{"id":"private-qwen38-flash-next"}]}', 'application/json'
        self.handler = self.module.make_handler(self.config, proxy)
        with patch.object(self.module, 'business_urlopen') as stream:
            for method, path, payload in (('GET', '/v1/models', None),
                    ('POST', '/v1/chat/completions', {'messages': []}),
                    ('POST', '/v1/chat/completions', {'messages': [], 'stream': True})):
                with self.subTest(method=method, payload=payload):
                    self.assertEqual(self.request(method, path, payload)[0], 503)
            stream.assert_not_called()
        self.assertTrue(all(call[0] == 'GET' for call in self.calls))

    def test_live_runtime_identity_revision_generation_and_both_ranks_required(self):
        original = json.loads(json.dumps(self.runtime))
        variants = [
            {**original, 'modelProfileId': 'private_qwen38_flash_next_orcarouter_fp8_tp2'},
            {**original, 'selectionRevision': 2}, {**original, 'selectionRevision': True},
            {**original, 'generation': 'generation-old'}, {**original, 'prepared': False},
            {**original, 'failureReason': 'business_rank_state_inconsistent'},
            {**original, 'apiListenerClosed': True}, {**original, 'ranks': original['ranks'][:1]},
            {**original, 'ranks': [original['ranks'][0], {**original['ranks'][1], 'running': False}]},
            {**original, 'ranks': [original['ranks'][0], {**original['ranks'][1], 'generation': 'old'}]},
            {**original, 'ranks': [original['ranks'][0], original['ranks'][0]]},
        ]
        for runtime in variants:
            with self.subTest(runtime=runtime):
                self.runtime = runtime
                self.calls.clear()
                self.assertEqual(self.request()[0], 503)
                self.assertEqual(len(self.calls), 1)
                self.assertTrue(self.calls[0][1].endswith('/system/resource-state'))

    def test_selected_active_ready_and_generation_state_required(self):
        for changes in ({'selectedBusinessProfileId': self.module.GLM_PROFILE},
                {'modelProfileId': self.module.GLM_PROFILE}, {'businessTransition': 'loading'},
                {'businessTransition': 'failed'}, {'businessGeneration': ''},
                {'businessGeneration': 'old'}, {'selectionRevision': 2}):
            with self.subTest(changes=changes):
                self.state.write_text(json.dumps({**self.value, **changes}))
                self.calls.clear()
                self.assertEqual(self.request()[0], 503)
                self.assertFalse(any(call[0] == 'POST' for call in self.calls))

    def test_images_pass_in_chat_responses_and_images_routes(self):
        for image_type in ('image_url', 'input_image', 'image'):
            part = {'type': image_type, 'image_url': {'url': 'data:private'}}
            for path, payload in (('/v1/chat/completions', {'messages': [{'content': [part]}]}),
                    ('/v1/responses', {'input': [{'content': [part]}]})):
                with self.subTest(image_type=image_type, path=path):
                    self.assertEqual(self.request(path=path, payload=payload)[0], 200)
        self.assertEqual(self.request(path='/v1/images/generations', payload={'prompt': 'image'})[0], 200)
        self.assertEqual(self.request(payload={'messages': [], 'chat_template_kwargs': None})[0], 400)

    def test_qwen_private_sharing_refused_without_forwarding(self):
        for shared in ('3:generation-3', ''):
            with self.subTest(shared=shared):
                self.assertEqual(self.request(shared=shared)[0], 409)
        self.assertEqual(self.calls, [])

    def test_models_filter_preserves_business_alias(self):
        status, body = self.request('GET', '/v1/models')
        self.assertEqual(status, 200)
        self.assertEqual([model['id'] for model in json.loads(body)['data']], ['system-prod-primary'])

    def test_sse_preserves_business_alias_and_qwen_defaults(self):
        response = io.BytesIO()
        response.status = 200
        response.headers = {'Content-Type': 'text/event-stream'}
        response.read1 = Mock(side_effect=[b'data: {"model":"internal","choices":[]}\n\ndata: [DONE]\n\n', b''])
        with patch.object(self.module, 'business_urlopen', return_value=response) as upstream:
            status, body = self.request(payload={'messages': [], 'stream': True,
                'response_format': {'type': 'json_object'}})
        self.assertEqual(status, 200)
        self.assertIn(b'"model": "system-prod-primary"', body)
        self.assertIn(b'data: [DONE]', body)
        request = upstream.call_args.args[0]
        self.assertEqual(request.full_url, 'http://127.0.0.1:38083/v1/chat/completions')
        sent = json.loads(request.data)
        self.assertEqual(sent['chat_template_kwargs'], {'enable_thinking': False})
        self.assertEqual(sent['response_format'], {'type': 'json_object'})
        self.assertNotIn('reasoning_effort', sent)
        self.assertIsNone(request.get_header('Authorization'))

    def enable_sharing(self):
        flag = patch.dict(os.environ, {'DGX_PRIVATE_SHARED_QWEN38_ENABLED': 'true'})
        flag.start()
        self.addCleanup(flag.stop)
        self.runtime['privateSharingEvidence'] = self.module.qwen_sharing_evidence('generation-3')
        self.reset_status = 200
        def proxy(method, url, body, headers):
            self.calls.append((method, url, body, headers))
            if '/reset_' in url:
                return self.reset_status, b'{"success":true}', 'application/json'
            if url.endswith('/system/resource-state'):
                return 200, json.dumps({'businessRuntime': self.runtime}).encode(), 'application/json'
            if url.endswith('/v1/models'):
                return 200, b'{"data":[{"id":"system-prod-primary"}]}', 'application/json'
            return 200, b'{"model":"system-prod-primary","choices":[]}', 'application/json'
        self.handler = self.module.make_handler(self.config, proxy)

    def test_shared_images_and_secret_salt_only_on_private_requests(self):
        self.enable_sharing()
        salts = []
        for shared in (None, '3:generation-3', '3:generation-3', None):
            for path, payload in (('/v1/chat/completions', {'messages': [{'content': [{'type': 'image_url'}]}]}),
                                  ('/v1/responses', {'input': [{'type': 'input_image'}]}),
                                  ('/v1/images/generations', {'prompt': 'image'})):
                status, response = self.request(path=path, shared=shared, payload={**payload, 'cache_salt': 'client-salt'})
                self.assertEqual(status, 200)
                sent = json.loads(self.calls[-1][2])
                if shared:
                    salts.append(sent['cache_salt'])
                    self.assertEqual(len(sent['cache_salt']), 64)
                    self.assertNotEqual(sent['cache_salt'], 'client-salt')
                    self.assertNotIn(sent['cache_salt'].encode(), response)
                else:
                    self.assertNotIn('cache_salt', sent)
        self.assertEqual(len(set(salts)), 1)
        self.assertEqual([call[1].rsplit('/', 1)[1] for call in self.calls if '/reset_' in call[1]],
                         ['reset_prefix_cache', 'reset_mm_cache', 'reset_encoder_cache'] * 3)

    def test_qwen_only_resource_status_publishes_proof_and_both_flags_off_strip_it(self):
        self.enable_sharing()
        self.runtime['privateSharing'] = {'untrusted': True}
        for qwen, expected in (('true', True), ('false', False)):
            with patch.dict(os.environ, {'DGX_PRIVATE_SHARED_DEEPSEEK_ENABLED': 'false',
                                         'DGX_PRIVATE_SHARED_QWEN38_ENABLED': qwen}):
                status, body = self.request('GET', '/system/resource-state', runtime_token='control-key')
            self.assertEqual(status, 200)
            runtime = json.loads(body)['businessRuntime']
            self.assertNotIn('privateSharingEvidence', runtime)
            self.assertEqual('privateSharing' in runtime, expected)
            if expected:
                self.assertEqual(runtime['privateSharing']['generation'], 'generation-3')

    def test_shared_images_only_allow_inline_data_urls_while_business_is_unchanged(self):
        self.enable_sharing()
        for path, field in (('/v1/chat/completions', 'messages'), ('/v1/responses', 'input')):
            for image in ({'url': 'https://example.test/private.png'}, 'http://example.test/a',
                          {'url': 'file:///private/image.png'}, {'url': '/private/image.png'},
                          {'url': 'ftp://example.test/a'}, None, {'url': 42}):
                payload = {field: [{'content': [{'type': 'image_url', 'image_url': image}]}]}
                with self.subTest(path=path, image=image):
                    self.calls.clear()
                    status, body = self.request(path=path, shared='3:generation-3', payload=payload)
                    self.assertEqual(status, 400)
                    self.assertEqual(json.loads(body)['error']['code'], 'private_shared_image_url_unsupported')
                    self.assertFalse(any(call[0] == 'POST' for call in self.calls))
                    self.assertEqual(self.request(path=path, payload=payload)[0], 200)
            for image in ('data:image/png;base64,AA==', {'url': 'data:image/png;base64,AA=='}):
                self.assertEqual(self.request(path=path, shared='3:generation-3', payload={
                    field: [{'content': [{'type': 'input_image', 'image_url': image}]}]})[0], 200)

    def test_shared_failures_never_call_business_diagnostics(self):
        self.enable_sharing()
        for error in (ValueError('private_shared_busy'), RuntimeError('private-input-output-detail')):
            self.handler = self.module.make_handler(self.config, Mock(side_effect=error))
            with patch.object(self.module, 'log_business_failure') as log:
                self.assertEqual(self.request(shared='3:generation-3')[0], 409)
            log.assert_not_called()

    def test_preempted_buffered_handler_skips_error_write_after_downstream_abort(self):
        self.enable_sharing()
        original_handler = self.handler
        # The proxy runs in the request lifetime, so it can emulate the hard abort.
        def proxy(method, url, body, headers):
            if url.endswith('/system/resource-state'):
                return 200, json.dumps({'businessRuntime': self.runtime}).encode(), 'application/json'
            if url.endswith('/v1/models'):
                return 200, b'{"data":[{"id":"system-prod-primary"}]}', 'application/json'
            if '/reset_' in url:
                return 200, b'{"success":true}', 'application/json'
            handler = self.module._business_request.context[3]
            handler._qwen_preempted = True
            handler._business_abort()
            return 200, b'{"choices":[]}', 'application/json'
        cls = self.module.make_handler(self.config, proxy)
        handler = object.__new__(cls)
        handler.connection = object()
        handler.path = '/v1/chat/completions'
        handler.headers = http.client.HTTPMessage()
        handler.headers['X-Private-Shared-Runtime'] = '3:generation-3'
        handler._send_json = Mock()
        handler._send = Mock()
        handler._business_v1('POST', b'{"messages":[]}')
        self.assertTrue(handler._business_downstream_closed)
        handler._send_json.assert_not_called()
        handler._send.assert_not_called()
        self.assertTrue(handler.close_connection)
        self.handler = original_handler

    def test_preempted_stream_skips_error_write_after_downstream_abort(self):
        handler = object.__new__(self.handler)
        handler._qwen_preempted = True
        handler._business_downstream_closed = True
        handler._send_json = Mock()
        handler.wfile = Mock()
        with patch.object(self.module, 'business_urlopen', side_effect=OSError('closed')):
            handler._proxy_stream('http://engine/v1/chat/completions', b'{}', {}, business=True)
        handler._send_json.assert_not_called()
        handler.wfile.write.assert_not_called()

    def test_business_salt_removed_even_with_sharing_disabled(self):
        self.assertEqual(self.request(payload={'messages': [], 'cache_salt': 'untrusted'})[0], 200)
        self.assertNotIn('cache_salt', json.loads(self.calls[-1][2]))
        self.assertEqual(sum('/reset_' in call[1] for call in self.calls), 0)

    def test_shared_attestation_exact_fields_types_and_generation(self):
        self.enable_sharing()
        proof = self.module.attest_private_sharing(self.config, self.runtime)['privateSharing']
        self.assertEqual(proof, {**self.runtime['privateSharingEvidence'],
                                'selectionRevision': 3, 'generationFenced': True})
        original = json.loads(json.dumps(self.runtime))
        mutations = [lambda r: r.pop('privateSharingEvidence'),
                     lambda r: r.update(generation='old'), lambda r: r.update(selectionRevision=True)]
        for key, value in original['privateSharingEvidence'].items():
            mutations.extend([lambda r, k=key: r['privateSharingEvidence'].pop(k),
                              lambda r, k=key: r['privateSharingEvidence'].update({k: 'wrong'})])
        mutations.append(lambda r: r['privateSharingEvidence'].update(mmProcessorCacheGiB=False))
        for mutate in mutations:
            self.runtime = json.loads(json.dumps(original))
            mutate(self.runtime)
            self.calls.clear()
            self.assertEqual(self.request(shared='3:generation-3')[0], 409)
            self.assertFalse(any(call[0] == 'POST' for call in self.calls))
        self.runtime = original
        for shared in ('2:generation-3', '3:old', ''):
            self.assertEqual(self.request(shared=shared)[0], 409)
        self.assertEqual(self.request(shared='3:generation-3',
            extra_headers='X-Private-Shared-Runtime: 3:generation-3\r\n')[0], 409)

    def test_failed_reset_blocks_private_but_business_always_passes_and_retry_recovers(self):
        self.enable_sharing()
        self.assertEqual(self.request()[0], 200)
        self.reset_status = 500
        status, response = self.request(shared='3:generation-3')
        self.assertEqual((status, json.loads(response)['error']['code']), (409, 'private_shared_isolation_failed'))
        self.reset_status = 200
        self.assertEqual(self.request(shared='3:generation-3')[0], 200)

    def test_business_cuts_private_upstream_stream_after_five_seconds(self):
        self.enable_sharing()
        upstream, peer = self.module.socket.socketpair()
        self.addCleanup(upstream.close)
        self.addCleanup(peer.close)
        upstream.settimeout(8)
        reading = threading.Event()
        results, errors = [], []
        class Stream:
            status = 200
            headers = {'Content-Type': 'text/event-stream'}
            fp = Mock(raw=Mock(_sock=upstream))
            first = True
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def read1(self, size):
                if self.first:
                    self.first = False
                    return b'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'
                reading.set()
                return upstream.recv(size)
        def private():
            try:
                results.append(self.request(shared='3:generation-3', payload={'stream': True}))
            except Exception as error:
                errors.append(error)
        with patch.object(self.module, 'business_urlopen', return_value=Stream()):
            worker = threading.Thread(target=private, daemon=True)
            worker.start()
            self.assertTrue(reading.wait(2))
            start = self.module.time.monotonic()
            self.assertEqual(self.request()[0], 200)
            elapsed = self.module.time.monotonic() - start
            worker.join(2)
        self.assertFalse(worker.is_alive())
        self.assertEqual(errors, [])
        self.assertGreaterEqual(elapsed, 5)
        self.assertLess(elapsed, 7)
        self.assertEqual(results[0][0], 200)
        self.assertIn(b'partial', results[0][1])
        self.assertIn(b'private_shared_preempted', results[0][1])
        self.assertNotIn(b'[DONE]', results[0][1])
        peer.settimeout(1)
        self.assertEqual(peer.recv(1), b'')
        self.assertEqual([call[1].rsplit('/', 1)[1] for call in self.calls if '/reset_' in call[1]],
                         ['reset_prefix_cache', 'reset_mm_cache', 'reset_encoder_cache'] * 2)

    def test_business_reset_failure_and_private_retry_recovery(self):
        self.enable_sharing()
        self.assertEqual(self.request(shared='3:generation-3')[0], 200)
        self.reset_status = 500
        self.assertEqual(self.request()[0], 200)
        self.assertEqual(self.request(shared='3:generation-3')[0], 409)
        self.reset_status = 200
        self.assertEqual(self.request(shared='3:generation-3')[0], 200)


class QwenOwnerExclusiveTests(unittest.TestCase):
    def setUp(self):
        self.module = load_module()
        self.gate = self.module.QwenOwnerExclusive()
        self.resets = []
        self.identity = (3, 'generation-3')
        self.draining = False

    def handler(self):
        handler = Mock(_business_timed_out=False)
        handler._business_abort = Mock(side_effect=lambda **kwargs: setattr(handler, '_business_timed_out', True))
        return handler

    def reset(self, cancelled=lambda: False):
        self.assertFalse(self.gate.active['business'])
        self.assertFalse(self.gate.active['private'])
        self.resets.append(self.gate.owner)
        return True

    def request(self, owner, handler=None, reset=None):
        return self.gate.request(owner, self.identity, handler or self.handler(), reset or self.reset,
                                 lambda: self.draining)

    def test_initial_private_resets_and_same_owner_is_concurrent_and_generation_resets(self):
        with self.request('private'):
            with self.request('private'):
                self.assertEqual(len(self.gate.active['private']), 2)
        self.assertEqual(self.resets, ['unknown'])
        for identity in ((3, 'generation-4'), (4, 'generation-4')):
            self.identity = identity
            with self.request('private'):
                pass
        self.assertEqual(self.resets, ['unknown'] * 3)

    def test_private_waits_for_business_while_new_business_passes(self):
        entered, finished = threading.Event(), threading.Event()
        errors = []
        def private():
            try:
                entered.set()
                with self.request('private'):
                    finished.set()
            except Exception as error:
                errors.append(error)
        with self.request('business'):
            worker = threading.Thread(target=private)
            worker.start()
            self.assertTrue(entered.wait(1))
            self.assertFalse(finished.wait(0.05))
            with self.request('business'):
                self.assertEqual(len(self.gate.active['business']), 2)
        worker.join(2)
        self.assertFalse(worker.is_alive())
        self.assertTrue(finished.is_set())
        self.assertEqual(errors, [])
        self.assertEqual(self.resets, ['unknown', 'business'])

    def test_private_wait_timeout_leaves_business_unblocked(self):
        with self.request('business'), patch.object(self.module, 'QWEN_PRIVATE_WAIT_SECONDS', 0):
            with self.assertRaisesRegex(ValueError, 'private_shared_busy'):
                with self.request('private'):
                    self.fail('private admitted')
            with self.request('business'):
                pass
        self.assertEqual(self.resets, ['unknown'])

    def test_business_preempts_private_at_five_second_deadline(self):
        self.assertEqual(self.module.QWEN_BUSINESS_PREEMPT_SECONDS, 5)
        self.assertEqual(self.module.QWEN_PRIVATE_WAIT_SECONDS, 30)
        private = self.handler()
        entered, ended = threading.Event(), threading.Event()
        def hold_private():
            with self.request('private', private):
                entered.set()
                while not private._business_timed_out:
                    ended.wait(0.005)
            ended.set()
        worker = threading.Thread(target=hold_private)
        worker.start()
        self.assertTrue(entered.wait(1))
        with patch.object(self.module, 'QWEN_BUSINESS_PREEMPT_SECONDS', 0.05):
            with self.request('business'):
                self.assertFalse(self.gate.active['private'])
        worker.join(1)
        self.assertFalse(worker.is_alive())
        self.assertTrue(ended.is_set())
        private._business_abort.assert_called()
        self.assertEqual(self.resets, ['unknown', 'private'])

    def test_lifecycle_cancels_private_and_waiters_exit(self):
        private = self.handler()
        with self.request('private', private):
            self.draining = True
            for _ in range(100):
                if private._business_timed_out:
                    break
                threading.Event().wait(0.005)
            self.assertTrue(private._business_timed_out)
            with self.assertRaisesRegex(ValueError, 'business_draining'):
                with self.request('private'):
                    pass

    def test_business_arrival_immediately_stops_new_private_admission(self):
        arrived, release = threading.Event(), threading.Event()
        errors = []
        def business():
            try:
                with self.request('business'):
                    arrived.set()
            except Exception as error:
                errors.append(error)
        with self.request('private'):
            worker = threading.Thread(target=business, daemon=True)
            worker.start()
            for _ in range(100):
                with self.gate.condition:
                    waiting = self.gate.business_waiters
                if waiting:
                    break
                release.wait(0.005)
            self.assertEqual(waiting, 1)
            with self.assertRaisesRegex(ValueError, 'private_shared_busy'):
                with self.request('private'):
                    self.fail('new private admitted')
        worker.join(2)
        self.assertFalse(worker.is_alive())
        self.assertTrue(arrived.is_set())
        self.assertEqual(errors, [])

    def test_prefix_false_retries_then_resets_both_image_caches(self):
        self.assertEqual(self.module.QWEN_CACHE_RESET_SECONDS, 10)
        self.assertEqual(self.module.QWEN_PREFIX_RESET_INTERVAL_SECONDS, 0.5)
        proxy = Mock(side_effect=[(200, b'{"success":false}', ''),
                                  (200, b'{"success":true}', ''), (204, b'', ''), (200, b'', '')])
        with patch.object(self.module.time, 'sleep') as sleep:
            self.assertTrue(self.module.reset_qwen_caches('http://engine', proxy))
        sleep.assert_called_once_with(0.5)
        self.assertEqual([call.args[1] for call in proxy.call_args_list],
                         ['http://engine/reset_prefix_cache'] * 2 +
                         ['http://engine/reset_mm_cache', 'http://engine/reset_encoder_cache'])

    def test_reset_failures_and_prefix_retry_deadline(self):
        for responses in ([(500, b'', '')], [(200, b'{}', '')], [(200, b'{"success":1}', '')],
                          [(200, b'{"success":true}', ''), (500, b'', '')],
                          [(200, b'{"success":true}', ''), (200, b'', ''), (500, b'', '')]):
            self.assertFalse(self.module.reset_qwen_caches('http://engine', Mock(side_effect=responses)))
        with patch.object(self.module, 'QWEN_CACHE_RESET_SECONDS', 0):
            self.assertFalse(self.module.reset_qwen_caches('http://engine', Mock(return_value=(200, b'{"success":false}', ''))))

    def test_first_business_attempts_reset_once_even_on_failure(self):
        for success in (True, False):
            self.gate = self.module.QwenOwnerExclusive()
            reset = Mock(return_value=success)
            for _ in range(2):
                with self.request('business', reset=reset):
                    self.assertEqual(self.gate.owner, 'business')
                    self.assertEqual(self.gate.uncleared, not success)
            reset.assert_called_once()

    def test_reset_failure_logs_only_one_fixed_line(self):
        for owner in ('business', 'private'):
            for failure in (False, RuntimeError('secret body /private/path profile generation')):
                with self.subTest(owner=owner, failure=type(failure).__name__):
                    self.gate = self.module.QwenOwnerExclusive()
                    reset = Mock(side_effect=failure) if isinstance(failure, Exception) else Mock(return_value=failure)
                    with patch.object(self.module.sys, 'stderr', new_callable=io.StringIO) as logs:
                        if owner == 'private':
                            with self.assertRaisesRegex(ValueError, 'private_shared_isolation_failed'):
                                with self.request(owner, reset=reset):
                                    self.fail('private admitted')
                        else:
                            with self.request(owner, reset=reset):
                                pass
                    self.assertEqual(logs.getvalue(), '[dgx-local-llm-gateway] qwen_cache_reset_failed\n')
                    reset.assert_called_once()

    def test_reset_deadline_failure_logs_only_one_fixed_line(self):
        proxy = Mock()
        with patch.object(self.module, 'QWEN_CACHE_RESET_SECONDS', 0), \
                patch.object(self.module.sys, 'stderr', new_callable=io.StringIO) as logs:
            with self.request('business', reset=lambda cancelled:
                    self.module.reset_qwen_caches('http://engine', proxy, cancelled)):
                self.assertTrue(self.gate.uncleared)
        proxy.assert_not_called()
        self.assertEqual(logs.getvalue(), '[dgx-local-llm-gateway] qwen_cache_reset_failed\n')

    def test_successful_or_cancelled_reset_does_not_log(self):
        for result in (True, None):
            with self.subTest(result=result):
                self.gate = self.module.QwenOwnerExclusive()
                with patch.object(self.module.sys, 'stderr', new_callable=io.StringIO) as logs:
                    if result is None:
                        with self.assertRaisesRegex(ValueError, 'private_shared_busy'):
                            with self.request('private', reset=Mock(return_value=result)):
                                self.fail('private admitted')
                    else:
                        with self.request('private', reset=Mock(return_value=result)):
                            pass
                self.assertEqual(logs.getvalue(), '')

    def test_private_reset_yields_to_business_between_retries_and_each_reset_and_next_private_resets(self):
        for initial_owner in ('unknown', 'business'):
            for interrupt_at in ('/reset_prefix_cache', '/reset_mm_cache', '/reset_encoder_cache'):
                self.gate = self.module.QwenOwnerExclusive()
                self.gate.identity = self.identity
                self.gate.owner = initial_owner
                self.gate.uncleared = initial_owner == 'unknown'
                uncleared = self.gate.uncleared
                in_reset, release = threading.Event(), threading.Event()
                private_errors, business_errors, calls = [], [], []
                business_reset = Mock(return_value=False)
                def proxy(method, url, body, headers):
                    calls.append(url)
                    if url.endswith(interrupt_at):
                        in_reset.set()
                        if not release.wait(1):
                            raise AssertionError('business did not arrive')
                    return 200, (b'{"success":false}' if interrupt_at == '/reset_prefix_cache'
                                 else b'{"success":true}'), ''
                def private():
                    try:
                        with self.request('private', reset=lambda cancel: self.module.reset_qwen_caches('http://engine', proxy, cancel)):
                            private_errors.append('admitted')
                    except ValueError as error:
                        private_errors.append(str(error))
                def business():
                    try:
                        with self.request('business', reset=business_reset):
                            self.assertEqual(self.gate.uncleared, uncleared)
                    except Exception as error:
                        business_errors.append(error)
                with patch.object(self.module, 'QWEN_PREFIX_RESET_INTERVAL_SECONDS', 0.001):
                    worker = threading.Thread(target=private, daemon=True)
                    worker.start()
                    self.assertTrue(in_reset.wait(1))
                    business_worker = threading.Thread(target=business, daemon=True)
                    business_worker.start()
                    with self.gate.condition:
                        self.assertTrue(self.gate.condition.wait_for(lambda: self.gate.business_waiters == 1, timeout=1))
                    release.set()
                    worker.join(1)
                    business_worker.join(1)
                self.assertFalse(worker.is_alive())
                self.assertFalse(business_worker.is_alive())
                self.assertEqual(private_errors, ['private_shared_busy'])
                self.assertEqual(business_errors, [])
                business_reset.assert_not_called()
                self.assertEqual(len(calls), {'/reset_prefix_cache': 1, '/reset_mm_cache': 2, '/reset_encoder_cache': 3}[interrupt_at])
                self.assertEqual(self.gate.owner, 'business')
                self.assertEqual(self.gate.uncleared, uncleared)
                retry_reset = Mock(side_effect=self.reset)
                with self.request('private', reset=retry_reset):
                    retry_reset.assert_called_once()
                    self.assertEqual(self.gate.owner, 'private')
                    self.assertFalse(self.gate.uncleared)

    def test_identity_change_with_active_private_preempts_and_bounds_business_wait(self):
        self.assertEqual(self.module.QWEN_BUSINESS_DRAIN_SECONDS, 2)
        for identity in ((3, 'generation-4'), (4, 'generation-3')):
            self.gate = self.module.QwenOwnerExclusive()
            self.identity = (3, 'generation-3')
            private = self.handler()
            entered, release = threading.Event(), threading.Event()
            def hold_private():
                with self.request('private', private):
                    entered.set()
                    release.wait(2)  # Deliberately ignores both aborts until business enters.
            worker = threading.Thread(target=hold_private, daemon=True)
            worker.start()
            self.assertTrue(entered.wait(1))
            self.identity = identity
            with self.assertRaisesRegex(ValueError, 'private_shared_busy'):
                with self.request('private'):
                    self.fail('old private work must be cleared by business')
            def reset(cancelled):
                self.assertEqual(self.gate.owner, 'private')
                # A reset transport obeys the one total deadline.
                self.module.time.sleep(self.module.QWEN_CACHE_RESET_SECONDS)
                return False
            with patch.object(self.module, 'QWEN_BUSINESS_PREEMPT_SECONDS', 0.05), \
                    patch.object(self.module, 'QWEN_BUSINESS_DRAIN_SECONDS', 0.02), \
                    patch.object(self.module, 'QWEN_CACHE_RESET_SECONDS', 0.1):
                start = self.module.time.monotonic()
                with self.request('business', reset=reset):
                    elapsed = self.module.time.monotonic() - start
                    self.assertEqual(private._business_abort.call_args_list[0].kwargs, {'include_downstream': False})
                    self.assertEqual(private._business_abort.call_args_list[1].kwargs, {})
                    self.assertTrue(self.gate.uncleared)
                    self.assertGreaterEqual(elapsed, 0.17)
                    self.assertLess(elapsed, 0.22)  # 5 + 2 + 10, scaled to 0.05 + 0.02 + 0.1.
                release.set()
            worker.join(1)
            self.assertFalse(worker.is_alive())

    def test_private_resumes_with_reset_after_old_identity_private_ends_without_business(self):
        self.gate = self.module.QwenOwnerExclusive()
        self.identity = (3, 'generation-3')
        private = self.handler()
        entered, release = threading.Event(), threading.Event()
        def hold_private():
            with self.request('private', private):
                entered.set()
                release.wait(2)
        worker = threading.Thread(target=hold_private, daemon=True)
        worker.start()
        self.assertTrue(entered.wait(1))
        self.identity = (3, 'generation-4')
        with self.assertRaisesRegex(ValueError, 'private_shared_busy'):
            with self.request('private'):
                self.fail('old private work is still active')
        release.set()
        worker.join(1)
        self.assertFalse(worker.is_alive())
        resets = []
        def reset(cancelled):
            resets.append(self.gate.owner)
            return True
        with self.request('private', reset=reset):
            self.assertEqual(self.gate.owner, 'private')
            self.assertFalse(self.gate.uncleared)
        self.assertEqual(resets, ['private'])

    def test_all_cache_resets_share_one_absolute_deadline(self):
        deadlines = []
        def proxy(method, url, body, headers):
            deadlines.append(self.module._business_request.reset_deadline)
            return 200, b'{"success":true}', ''
        self.assertTrue(self.module.reset_qwen_caches('http://engine', proxy))
        self.assertEqual(len(deadlines), 3)
        self.assertEqual(len(set(deadlines)), 1)
        calls = []
        def slow_mm(method, url, body, headers):
            calls.append(url)
            if url.endswith('/reset_mm_cache'):
                self.module.time.sleep(0.03)
            return 200, b'{"success":true}', ''
        with patch.object(self.module, 'QWEN_CACHE_RESET_SECONDS', 0.02):
            self.assertFalse(self.module.reset_qwen_caches('http://engine', slow_mm))
        self.assertEqual(len(calls), 2)

    def test_reset_deadline_interrupts_trickling_upstream_without_aborting_business(self):
        upstream, peer = self.module.socket.socketpair()
        self.addCleanup(upstream.close)
        self.addCleanup(peer.close)
        downstream, client = self.module.socket.socketpair()
        self.addCleanup(downstream.close)
        self.addCleanup(client.close)
        handler = Mock(connection=downstream)
        def proxy(*args):
            self.module._business_request.context[2].append(upstream)
            self.assertEqual(upstream.recv(1), b'')
            return 200, b'{"success":true}', ''
        with self.module.business_request_lifetime(handler), patch.object(self.module, 'QWEN_CACHE_RESET_SECONDS', 0.03):
            self.assertFalse(self.module.reset_qwen_caches('http://engine', proxy))
            self.assertFalse(handler._business_timed_out)
            downstream.sendall(b'ok')
            self.assertEqual(client.recv(2), b'ok')
