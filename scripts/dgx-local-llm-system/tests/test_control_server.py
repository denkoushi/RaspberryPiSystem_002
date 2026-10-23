import importlib.util
import json
import sys
import threading
import unittest
import urllib.error
import urllib.request
from dataclasses import replace
from http.server import ThreadingHTTPServer
from pathlib import Path
import tempfile


MODULE_PATH = Path(__file__).resolve().parents[1] / "control-server.py"


def append_command(calls: list, cmd: str, extra_env=None) -> None:
    calls.append(cmd)


def load_module():
    spec = importlib.util.spec_from_file_location("dgx_control_server", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class ProfilelessStartTests(unittest.TestCase):
    def setUp(self):
        self.module = load_module()
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.storage = root / "glm"
        self.storage.mkdir()
        self.manifest = root / "registry/glm/manifest.json"
        self.manifest.parent.mkdir(parents=True)
        self.manifest.write_text(json.dumps({
            "modelProfileId": "business_glm53_flash_fp4_tp2", "displayNameJa": "GLM",
            "backend": "blue", "servedAlias": "system-prod-primary",
            "currentStorageLocation": str(self.storage), "enabled": True,
            "businessOrchestrationEligible": True,
            "launcherHints": {"blueModelDir": str(self.storage)},
            "runtimeProfile": {"engine": "vllm", "vllm": {"tensorParallelSize": 2}},
        }))
        self.state = root / "active-model-profile.json"
        self.config = replace(
            self.module.load_config_from_env(), token="runtime-token", active_backend="green",
            green_start_cmd="green-start", green_stop_cmd="green-stop",
            blue_start_cmd="blue-start", blue_stop_cmd="blue-stop",
            model_registry_root=str(root / "registry"), active_model_state_path=str(self.state),
            resource_state_path=str(root / "resource.json"),
        )
        self.profile = self.module.validate_startable_profile(
            self.config.model_registry_root, "business_glm53_flash_fp4_tp2",
        )
        self.module.write_active_model_state(str(self.state), self.profile)

    def test_plain_start_uses_active_glm_profile_env(self):
        calls = []
        handler = self.module.make_handler(
            self.config, command_runner=lambda cmd, extra_env=None: calls.append((cmd, extra_env)),
        )
        httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        try:
            request = urllib.request.Request(
                f"http://127.0.0.1:{httpd.server_port}/start", data=b"", method="POST",
                headers={"X-Runtime-Control-Token": "runtime-token"},
            )
            with urllib.request.urlopen(request, timeout=5) as response:
                payload = json.loads(response.read())
        finally:
            httpd.shutdown()
            httpd.server_close()
            thread.join(timeout=5)
        self.assertEqual(payload["modelProfile"]["activeProfileId"], self.profile.id)
        self.assertEqual([cmd for cmd, env in calls], ["green-stop", "blue-start"])
        self.assertEqual(calls[-1][1]["BLUE_MODEL_PROFILE_ID"], self.profile.id)
        self.assertEqual(calls[-1][1]["BLUE_MODEL_DIR"], str(self.storage))
        self.assertEqual(calls[-1][1]["VLLM_TENSOR_PARALLEL_SIZE"], "2")
        self.assertEqual(calls[-1][1]["BLUE_SERVER_COMMAND"], "")

    def test_valid_active_profile_for_other_reasons_and_business_restore(self):
        for reason in (None, "runtime-restart", "business-restore"):
            with self.subTest(reason=reason):
                self.assertEqual(self.module.resolve_start_profile(self.config, None, reason), self.profile)

    def test_invalid_active_profile_falls_back_but_business_restore_fails_closed(self):
        state = self.state.read_bytes()
        manifest = self.manifest.read_bytes()
        for case in ("missing-state", "corrupt-state", "incomplete-state", "backend-mismatch",
                     "missing-profile", "corrupt-profile", "disabled", "private", "missing-storage"):
            with self.subTest(case=case):
                self.state.write_bytes(state)
                self.manifest.write_bytes(manifest)
                if case == "missing-state":
                    self.state.unlink()
                elif case == "corrupt-state":
                    self.state.write_text("{")
                elif case == "incomplete-state":
                    self.state.write_text("{}")
                elif case == "backend-mismatch":
                    self.state.write_text(json.dumps({**json.loads(state), "backend": "green"}))
                elif case == "missing-profile":
                    self.manifest.unlink()
                elif case == "corrupt-profile":
                    self.manifest.write_text("{")
                else:
                    changes = {
                        "disabled": {"enabled": False},
                        "private": {"businessOrchestrationEligible": False},
                        "missing-storage": {"currentStorageLocation": str(self.storage / "missing")},
                    }
                    self.manifest.write_text(json.dumps({**json.loads(manifest), **changes[case]}))
                for reason in (None, "runtime-restart"):
                    self.assertIsNone(self.module.resolve_start_profile(self.config, None, reason))
                with self.assertRaises(self.module.BusinessRestoreUnavailableError):
                    self.module.resolve_start_profile(self.config, None, "business-restore")


class ControlServerTests(unittest.TestCase):
    def test_resolve_command_prefers_backend_specific_command(self):
        module = load_module()
        config = module.ControlConfig(
            token="token",
            active_backend="blue",
            start_cmd="legacy-start",
            stop_cmd="legacy-stop",
            green_start_cmd="green-start",
            green_stop_cmd="green-stop",
            blue_start_cmd="blue-start",
            blue_stop_cmd="blue-stop",
            blue_stop_mode="on_demand",
            host="127.0.0.1",
            port=39090,
        )

        self.assertEqual(module.resolve_command(config, "start"), "blue-start")
        self.assertEqual(module.resolve_command(config, "stop"), "blue-stop")

    def test_http_handler_runs_blue_commands(self):
        module = load_module()
        config = module.ControlConfig(
            token="runtime-token",
            active_backend="blue",
            start_cmd="legacy-start",
            stop_cmd="legacy-stop",
            green_start_cmd="green-start",
            green_stop_cmd="green-stop",
            blue_start_cmd="blue-start",
            blue_stop_cmd="blue-stop",
            blue_stop_mode="on_demand",
            host="127.0.0.1",
            port=39090,
        )
        calls: list[str] = []
        handler = module.make_handler(config, command_runner=lambda cmd, extra_env=None: append_command(calls, cmd, extra_env))
        httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        base_url = f"http://127.0.0.1:{httpd.server_port}"
        try:
            start_req = urllib.request.Request(
                f"{base_url}/start",
                data=b"",
                method="POST",
                headers={"X-Runtime-Control-Token": "runtime-token"},
            )
            with urllib.request.urlopen(start_req, timeout=5) as response:
                payload = json.loads(response.read().decode("utf-8"))
            self.assertEqual(payload["backend"], "blue")

            stop_req = urllib.request.Request(
                f"{base_url}/stop",
                data=b"",
                method="POST",
                headers={"X-Runtime-Control-Token": "runtime-token"},
            )
            with urllib.request.urlopen(stop_req, timeout=5):
                pass
        finally:
            httpd.shutdown()
            httpd.server_close()
            thread.join(timeout=5)

        self.assertEqual(calls, ["green-stop", "blue-start", "blue-stop"])

    def test_resolve_command_blue_stop_noop_when_keep_warm_mode(self):
        module = load_module()
        config = module.ControlConfig(
            token="token",
            active_backend="blue",
            start_cmd="legacy-start",
            stop_cmd="legacy-stop",
            green_start_cmd="green-start",
            green_stop_cmd="green-stop",
            blue_start_cmd="blue-start",
            blue_stop_cmd="blue-stop",
            blue_stop_mode="keep_warm",
            host="127.0.0.1",
            port=39090,
        )

        self.assertEqual(module.resolve_command(config, "start"), "blue-start")
        self.assertEqual(module.resolve_command(config, "stop"), ":")
        self.assertEqual(module.resolve_command(config, "stop-force"), "blue-stop")

    def test_resolve_command_blue_stop_noop_when_always_on_mode(self):
        module = load_module()
        config = module.ControlConfig(
            token="token",
            active_backend="blue",
            start_cmd="legacy-start",
            stop_cmd="legacy-stop",
            green_start_cmd="green-start",
            green_stop_cmd="green-stop",
            blue_start_cmd="blue-start",
            blue_stop_cmd="blue-stop",
            blue_stop_mode="always_on",
            host="127.0.0.1",
            port=39090,
        )

        self.assertEqual(module.resolve_command(config, "stop"), ":")
        self.assertEqual(module.resolve_command(config, "stop-force"), "blue-stop")

    def test_http_handler_keep_warm_still_hard_stops_green_before_start(self):
        module = load_module()
        config = module.ControlConfig(
            token="runtime-token",
            active_backend="blue",
            start_cmd="legacy-start",
            stop_cmd="legacy-stop",
            green_start_cmd="green-start",
            green_stop_cmd="green-stop",
            blue_start_cmd="blue-start",
            blue_stop_cmd="blue-stop",
            blue_stop_mode="keep_warm",
            host="127.0.0.1",
            port=39090,
        )
        calls: list[str] = []
        handler = module.make_handler(config, command_runner=lambda cmd, extra_env=None: append_command(calls, cmd, extra_env))
        httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        base_url = f"http://127.0.0.1:{httpd.server_port}"
        try:
            start_req = urllib.request.Request(
                f"{base_url}/start",
                data=b"",
                method="POST",
                headers={"X-Runtime-Control-Token": "runtime-token"},
            )
            with urllib.request.urlopen(start_req, timeout=5):
                pass
            stop_req = urllib.request.Request(
                f"{base_url}/stop",
                data=b"",
                method="POST",
                headers={"X-Runtime-Control-Token": "runtime-token"},
            )
            with urllib.request.urlopen(stop_req, timeout=5):
                pass
        finally:
            httpd.shutdown()
            httpd.server_close()
            thread.join(timeout=5)

        self.assertEqual(calls, ["green-stop", "blue-start", ":"])

    def test_http_handler_stop_force_bypasses_keep_warm(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            missing_state = str(Path(tmp) / "no-active-model-state.json")
            config = module.ControlConfig(
                token="runtime-token",
                active_backend="blue",
                start_cmd="legacy-start",
                stop_cmd="legacy-stop",
                green_start_cmd="green-start",
                green_stop_cmd="green-stop",
                blue_start_cmd="blue-start",
                blue_stop_cmd="blue-stop",
                blue_stop_mode="keep_warm",
                host="127.0.0.1",
                port=39090,
                active_model_state_path=missing_state,
            )
            self._assert_stop_force_bypasses_keep_warm(module, config)

    def _assert_stop_force_bypasses_keep_warm(self, module, config) -> None:
        calls: list[str] = []
        handler = module.make_handler(config, command_runner=lambda cmd, extra_env=None: append_command(calls, cmd, extra_env))
        httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        base_url = f"http://127.0.0.1:{httpd.server_port}"
        try:
            stop_req = urllib.request.Request(
                f"{base_url}/stop-force",
                data=b"",
                method="POST",
                headers={"X-Runtime-Control-Token": "runtime-token"},
            )
            with urllib.request.urlopen(stop_req, timeout=5) as response:
                payload = json.loads(response.read().decode("utf-8"))
        finally:
            httpd.shutdown()
            httpd.server_close()
            thread.join(timeout=5)

        self.assertEqual(payload["action"], "stop-force")
        self.assertEqual(payload["backend"], "blue")
        self.assertEqual(payload.get("backendSource"), "env_fallback")
        self.assertEqual(calls, ["blue-stop"])

    def test_http_handler_start_with_model_profile_selects_backend_and_writes_state(self):
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
                        "currentStorageLocation": str(storage),
                        "enabled": True,
                    }
                ),
                encoding="utf-8",
            )
            state_path = Path(tmp) / "state" / "active-model-profile.json"
            resource_state_path = Path(tmp) / "state" / "dgx-resource-state.json"
            config = module.ControlConfig(
                token="runtime-token",
                active_backend="green",
                start_cmd="legacy-start",
                stop_cmd="legacy-stop",
                green_start_cmd="green-start",
                green_stop_cmd="green-stop",
                blue_start_cmd="blue-start",
                blue_stop_cmd="blue-stop",
                blue_stop_mode="on_demand",
                host="127.0.0.1",
                port=39090,
                model_registry_root=str(root),
                active_model_state_path=str(state_path),
                resource_state_path=str(resource_state_path),
            )
            calls: list[str] = []
            handler = module.make_handler(config, command_runner=lambda cmd, extra_env=None: append_command(calls, cmd, extra_env))
            httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler)
            thread = threading.Thread(target=httpd.serve_forever, daemon=True)
            thread.start()
            base_url = f"http://127.0.0.1:{httpd.server_port}"
            try:
                start_req = urllib.request.Request(
                    f"{base_url}/start",
                    data=json.dumps({"modelProfileId": "business_qwen36_27b_nvfp4"}).encode(),
                    method="POST",
                    headers={"X-Runtime-Control-Token": "runtime-token", "Content-Type": "application/json"},
                )
                with urllib.request.urlopen(start_req, timeout=5) as response:
                    payload = json.loads(response.read().decode("utf-8"))
            finally:
                httpd.shutdown()
                httpd.server_close()
                thread.join(timeout=5)

            self.assertEqual(payload["backend"], "blue")
            self.assertEqual(payload["modelProfile"]["activeProfileId"], "business_qwen36_27b_nvfp4")
            self.assertEqual(payload["resourceState"]["owner"], "business")
            self.assertEqual(payload["resourceState"]["status"], "preparing")
            self.assertEqual(payload["resourceState"]["modelProfileId"], "business_qwen36_27b_nvfp4")
            self.assertEqual(calls, ["green-stop", "blue-start"])
            saved = json.loads(state_path.read_text(encoding="utf-8"))
            self.assertEqual(saved["backend"], "blue")
            resource_saved = json.loads(resource_state_path.read_text(encoding="utf-8"))
            self.assertEqual(resource_saved["owner"], "business")

    def test_business_restore_validates_active_business_profile_before_stopping(self):
        module = load_module()
        cases = (
            {
                "name": "business",
                "profile": {
                    "modelProfileId": "business_qwen38_flash_next_nvfp4",
                    "displayNameJa": "Business",
                    "backend": "blue",
                    "currentStorageLocation": "storage",
                    "businessOrchestrationEligible": True,
                    "enabled": True,
                },
                "state": {"modelProfileId": "business_qwen38_flash_next_nvfp4", "backend": "blue"},
                "expected_status": 200,
                "expected_calls": ["green-stop", "blue-start"],
            },
            {
                "name": "private",
                "profile": {
                    "modelProfileId": "private_profile",
                    "displayNameJa": "Private",
                    "backend": "green",
                    "currentStorageLocation": "storage",
                    "businessOrchestrationEligible": False,
                    "enabled": True,
                },
                "state": {"modelProfileId": "private_profile", "backend": "green"},
                "expected_status": 503,
                "expected_calls": [],
            },
            {
                "name": "backend-mismatch",
                "profile": {
                    "modelProfileId": "business_profile",
                    "displayNameJa": "Business",
                    "backend": "blue",
                    "currentStorageLocation": "storage",
                    "businessOrchestrationEligible": True,
                    "enabled": True,
                },
                "state": {"modelProfileId": "business_profile", "backend": "green"},
                "expected_status": 503,
                "expected_calls": [],
            },
            {
                "name": "disabled",
                "profile": {
                    "modelProfileId": "disabled_profile",
                    "displayNameJa": "Disabled",
                    "backend": "blue",
                    "currentStorageLocation": "storage",
                    "businessOrchestrationEligible": True,
                    "enabled": False,
                },
                "state": {"modelProfileId": "disabled_profile", "backend": "blue"},
                "expected_status": 503,
                "expected_calls": [],
            },
            {
                "name": "missing-state",
                "profile": None,
                "state": None,
                "expected_status": 503,
                "expected_calls": [],
            },
            {
                "name": "corrupt-state",
                "profile": None,
                "state": "{not-json",
                "expected_status": 503,
                "expected_calls": [],
            },
        )
        for case in cases:
            with self.subTest(case=case["name"]), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp) / "registry"
                storage = Path(tmp) / "storage"
                storage.mkdir(parents=True)
                profile = case["profile"]
                if profile is not None:
                    profile = dict(profile)
                    profile["currentStorageLocation"] = str(storage)
                    manifest_dir = root / profile["modelProfileId"]
                    manifest_dir.mkdir(parents=True)
                    (manifest_dir / "manifest.json").write_text(json.dumps(profile), encoding="utf-8")
                else:
                    root.mkdir(parents=True)
                state_path = Path(tmp) / "state" / "active-model-profile.json"
                state_path.parent.mkdir(parents=True)
                if case["state"] is not None:
                    state = case["state"]
                    state_path.write_text(
                        state if isinstance(state, str) else json.dumps(
                            {
                                "activeProfileId": state["modelProfileId"],
                                "modelProfileId": state["modelProfileId"],
                                "displayNameJa": "State",
                                "backend": state["backend"],
                                "servedAlias": "system-prod-primary",
                                "stateUpdatedAt": "2026-09-06T00:00:00Z",
                            }
                        ),
                        encoding="utf-8",
                    )
                config = module.ControlConfig(
                    token="runtime-token",
                    active_backend="green",
                    start_cmd="legacy-start",
                    stop_cmd="legacy-stop",
                    green_start_cmd="green-start",
                    green_stop_cmd="green-stop",
                    blue_start_cmd="blue-start",
                    blue_stop_cmd="blue-stop",
                    blue_stop_mode="on_demand",
                    host="127.0.0.1",
                    port=39090,
                    model_registry_root=str(root),
                    active_model_state_path=str(state_path),
                    resource_state_path=str(Path(tmp) / "state" / "resource.json"),
                )
                calls: list[str] = []
                handler = module.make_handler(config, command_runner=lambda cmd, extra_env=None: append_command(calls, cmd, extra_env))
                httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler)
                thread = threading.Thread(target=httpd.serve_forever, daemon=True)
                thread.start()
                request = urllib.request.Request(
                    f"http://127.0.0.1:{httpd.server_port}/start",
                    data=json.dumps({"reason": "business-restore"}).encode(),
                    method="POST",
                    headers={"X-Runtime-Control-Token": "runtime-token", "Content-Type": "application/json"},
                )
                try:
                    if case["expected_status"] == 200:
                        with urllib.request.urlopen(request, timeout=5) as response:
                            payload = json.loads(response.read().decode("utf-8"))
                        self.assertEqual(payload["modelProfile"]["activeProfileId"], profile["modelProfileId"])
                        self.assertEqual(payload["resourceState"]["owner"], "business")
                    else:
                        with self.assertRaises(urllib.error.HTTPError) as raised:
                            urllib.request.urlopen(request, timeout=5)
                        self.assertEqual(case["expected_status"], raised.exception.code)
                        self.assertEqual(
                            "BUSINESS_RESTORE_UNAVAILABLE",
                            json.loads(raised.exception.read().decode("utf-8"))["code"],
                        )
                finally:
                    httpd.shutdown()
                    httpd.server_close()
                    thread.join(timeout=5)
                self.assertEqual(calls, case["expected_calls"])

    def test_http_handler_private_model_profile_writes_private_owner(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "registry"
            storage = Path(tmp) / "gguf"
            storage.mkdir(parents=True)
            manifest_dir = root / "qwen36_35b_uncensored"
            manifest_dir.mkdir(parents=True)
            (manifest_dir / "manifest.json").write_text(
                json.dumps(
                    {
                        "modelProfileId": "qwen36_35b_uncensored",
                        "displayNameJa": "Uncensored",
                        "backend": "green",
                        "servedAlias": "system-prod-primary",
                        "currentStorageLocation": str(storage),
                        "businessOrchestrationEligible": False,
                        "enabled": True,
                    }
                ),
                encoding="utf-8",
            )
            state_path = Path(tmp) / "state" / "active-model-profile.json"
            resource_state_path = Path(tmp) / "state" / "dgx-resource-state.json"
            config = module.ControlConfig(
                token="runtime-token",
                active_backend="blue",
                start_cmd="legacy-start",
                stop_cmd="legacy-stop",
                green_start_cmd="green-start",
                green_stop_cmd="green-stop",
                blue_start_cmd="blue-start",
                blue_stop_cmd="blue-stop",
                blue_stop_mode="on_demand",
                host="127.0.0.1",
                port=39090,
                model_registry_root=str(root),
                active_model_state_path=str(state_path),
                resource_state_path=str(resource_state_path),
            )
            calls: list[str] = []
            handler = module.make_handler(config, command_runner=lambda cmd, extra_env=None: append_command(calls, cmd, extra_env))
            httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler)
            thread = threading.Thread(target=httpd.serve_forever, daemon=True)
            thread.start()
            base_url = f"http://127.0.0.1:{httpd.server_port}"
            try:
                start_req = urllib.request.Request(
                    f"{base_url}/start",
                    data=json.dumps(
                        {
                            "modelProfileId": "qwen36_35b_uncensored",
                            "reason": "business-restore",
                        }
                    ).encode(),
                    method="POST",
                    headers={"X-Runtime-Control-Token": "runtime-token", "Content-Type": "application/json"},
                )
                with urllib.request.urlopen(start_req, timeout=5) as response:
                    payload = json.loads(response.read().decode("utf-8"))
            finally:
                httpd.shutdown()
                httpd.server_close()
                thread.join(timeout=5)

            self.assertEqual(payload["backend"], "green")
            self.assertEqual(payload["resourceState"]["owner"], "private")
            self.assertEqual(payload["resourceState"]["modelProfileId"], "qwen36_35b_uncensored")
            self.assertEqual(calls, ["blue-stop", "green-start"])

    def test_http_handler_green_active_hard_stops_blue_before_start(self):
        module = load_module()
        config = module.ControlConfig(
            token="runtime-token",
            active_backend="green",
            start_cmd="legacy-start",
            stop_cmd="legacy-stop",
            green_start_cmd="green-start",
            green_stop_cmd="green-stop",
            blue_start_cmd="blue-start",
            blue_stop_cmd="blue-stop",
            blue_stop_mode="on_demand",
            host="127.0.0.1",
            port=39090,
        )
        calls: list[str] = []
        handler = module.make_handler(config, command_runner=lambda cmd, extra_env=None: append_command(calls, cmd, extra_env))
        httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        base_url = f"http://127.0.0.1:{httpd.server_port}"
        try:
            start_req = urllib.request.Request(
                f"{base_url}/start",
                data=b"",
                method="POST",
                headers={"X-Runtime-Control-Token": "runtime-token"},
            )
            with urllib.request.urlopen(start_req, timeout=5):
                pass
        finally:
            httpd.shutdown()
            httpd.server_close()
            thread.join(timeout=5)

        self.assertEqual(calls, ["blue-stop", "green-start"])

    def test_stop_force_uses_active_model_state_backend_over_env(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            state_path = Path(tmp) / "state" / "active-model-profile.json"
            state_path.parent.mkdir(parents=True)
            state_path.write_text(
                json.dumps(
                    {
                        "activeProfileId": "business_qwen35_35b_gguf",
                        "modelProfileId": "business_qwen35_35b_gguf",
                        "displayNameJa": "35B",
                        "backend": "green",
                        "servedAlias": "system-prod-primary",
                        "stateUpdatedAt": "2026-05-29T00:00:00Z",
                    }
                ),
                encoding="utf-8",
            )
            config = module.ControlConfig(
                token="runtime-token",
                active_backend="blue",
                start_cmd="legacy-start",
                stop_cmd="legacy-stop",
                green_start_cmd="green-start",
                green_stop_cmd="green-stop",
                blue_start_cmd="blue-start",
                blue_stop_cmd="blue-stop",
                blue_stop_mode="keep_warm",
                host="127.0.0.1",
                port=39090,
                active_model_state_path=str(state_path),
            )
            calls: list[str] = []
            handler = module.make_handler(config, command_runner=lambda cmd, extra_env=None: append_command(calls, cmd, extra_env))
            httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler)
            thread = threading.Thread(target=httpd.serve_forever, daemon=True)
            thread.start()
            base_url = f"http://127.0.0.1:{httpd.server_port}"
            try:
                stop_req = urllib.request.Request(
                    f"{base_url}/stop-force",
                    data=b"",
                    method="POST",
                    headers={"X-Runtime-Control-Token": "runtime-token"},
                )
                with urllib.request.urlopen(stop_req, timeout=5) as response:
                    payload = json.loads(response.read().decode("utf-8"))
            finally:
                httpd.shutdown()
                httpd.server_close()
                thread.join(timeout=5)

            self.assertEqual(payload["backend"], "green")
            self.assertEqual(payload["backendSource"], "model_profile_state")
            self.assertEqual(calls, ["green-stop"])

    def test_stop_uses_active_model_state_backend_over_env(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            state_path = Path(tmp) / "state" / "active-model-profile.json"
            state_path.parent.mkdir(parents=True)
            state_path.write_text(
                json.dumps(
                    {
                        "activeProfileId": "business_qwen35_35b_gguf",
                        "modelProfileId": "business_qwen35_35b_gguf",
                        "displayNameJa": "35B",
                        "backend": "green",
                        "servedAlias": "system-prod-primary",
                        "stateUpdatedAt": "2026-05-29T00:00:00Z",
                    }
                ),
                encoding="utf-8",
            )
            config = module.ControlConfig(
                token="runtime-token",
                active_backend="blue",
                start_cmd="legacy-start",
                stop_cmd="legacy-stop",
                green_start_cmd="green-start",
                green_stop_cmd="green-stop",
                blue_start_cmd="blue-start",
                blue_stop_cmd="blue-stop",
                blue_stop_mode="keep_warm",
                host="127.0.0.1",
                port=39090,
                active_model_state_path=str(state_path),
            )
            calls: list[str] = []
            handler = module.make_handler(config, command_runner=lambda cmd, _env=None: calls.append(cmd))
            httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler)
            thread = threading.Thread(target=httpd.serve_forever, daemon=True)
            thread.start()
            base_url = f"http://127.0.0.1:{httpd.server_port}"
            try:
                stop_req = urllib.request.Request(
                    f"{base_url}/stop",
                    data=b"",
                    method="POST",
                    headers={"X-Runtime-Control-Token": "runtime-token"},
                )
                with urllib.request.urlopen(stop_req, timeout=5) as response:
                    payload = json.loads(response.read().decode("utf-8"))
            finally:
                httpd.shutdown()
                httpd.server_close()
                thread.join(timeout=5)

            self.assertEqual(payload["backend"], "green")
            self.assertEqual(payload["backendSource"], "model_profile_state")
            self.assertEqual(calls, ["green-stop"])

    def test_single_active_guard_disabled_skips_hard_stop_on_start(self):
        import os

        self.addCleanup(lambda: os.environ.pop("DGX_LLM_SINGLE_ACTIVE_GUARD", None))
        os.environ["DGX_LLM_SINGLE_ACTIVE_GUARD"] = "false"
        module = load_module()
        config = module.ControlConfig(
            token="runtime-token",
            active_backend="blue",
            start_cmd="legacy-start",
            stop_cmd="legacy-stop",
            green_start_cmd="green-start",
            green_stop_cmd="green-stop",
            blue_start_cmd="blue-start",
            blue_stop_cmd="blue-stop",
            blue_stop_mode="on_demand",
            host="127.0.0.1",
            port=39090,
        )
        calls: list[str] = []
        handler = module.make_handler(config, command_runner=lambda cmd, extra_env=None: append_command(calls, cmd, extra_env))
        httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        base_url = f"http://127.0.0.1:{httpd.server_port}"
        try:
            start_req = urllib.request.Request(
                f"{base_url}/start",
                data=b"",
                method="POST",
                headers={"X-Runtime-Control-Token": "runtime-token"},
            )
            with urllib.request.urlopen(start_req, timeout=5):
                pass
        finally:
            httpd.shutdown()
            httpd.server_close()
            thread.join(timeout=5)

        self.assertEqual(calls, ["blue-start"])


if __name__ == "__main__":
    unittest.main()
