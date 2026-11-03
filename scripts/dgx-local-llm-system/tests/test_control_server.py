import importlib.util
import io
import json
import subprocess
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

    def test_explicit_private_deepseek_start_is_not_restored_by_profileless_start(self):
        self.check_private_start_is_not_restored("private_deepseek_v41_flash_tp2", "dsv41_tensorfold_2x")

    def test_explicit_private_glm53_start_is_not_restored_by_profileless_start(self):
        self.check_private_start_is_not_restored("private_glm53_flash_ablit_tp2", "glm53_tensorfold_2x")

    def check_private_start_is_not_restored(self, profile_id, adapter):
        fixture = MODULE_PATH.parent / "tests/fixtures" / profile_id / "manifest.json"
        private = json.loads(fixture.read_text())
        # Registry fixtures may be disabled until provisioned; enable only this temporary copy.
        private["enabled"] = True
        private["currentStorageLocation"] = str(self.storage)
        self.manifest.write_text(json.dumps(private))
        config = replace(self.config, active_backend="blue")
        calls = []
        handler = self.module.make_handler(
            config, command_runner=lambda cmd, extra_env=None: calls.append((cmd, extra_env)),
        )
        def post(body):
            data = json.dumps(body).encode()
            request = (
                b"POST /start HTTP/1.0\r\nX-Runtime-Control-Token: runtime-token\r\n"
                b"Content-Type: application/json\r\nContent-Length: "
                + str(len(data)).encode() + b"\r\n\r\n" + data
            )
            response = io.BytesIO()

            # Exercise the real HTTP parser and handler without opening a port.
            class Connection:
                def makefile(self, *args):
                    return io.BytesIO(request)

                def sendall(self, data):
                    response.write(data)

            handler(Connection(), ("127.0.0.1", 0), object())
            headers, payload = response.getvalue().split(b"\r\n\r\n", 1)
            return int(headers.split()[1]), json.loads(payload)

        status, payload = post({"modelProfileId": private["modelProfileId"]})
        self.assertEqual(status, 200)
        self.assertEqual(payload["modelProfile"]["activeProfileId"], private["modelProfileId"])
        self.assertEqual(calls[-1][0], "blue-start")
        self.assertEqual(calls[-1][1]["BLUE_SERVER_ADAPTER"], adapter)
        self.assertEqual(calls[-1][1]["BLUE_MODEL_PROFILE_ID"], private["modelProfileId"])
        self.assertEqual(self.module.read_active_model_state(str(self.state)).model_profile_id,
                         private["modelProfileId"])
        calls.clear()
        status, payload = post({})
        self.assertEqual(status, 200)
        self.assertNotIn("modelProfile", payload)
        self.assertEqual(calls[-1], ("blue-start", None))
        calls.clear()
        status, payload = post({"reason": "business-restore"})
        self.assertEqual(status, 503)
        self.assertEqual(payload["code"], "BUSINESS_RESTORE_UNAVAILABLE")
        self.assertEqual(calls, [])

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


class BusinessSwitchContractTests(unittest.TestCase):
    def setUp(self):
        from unittest.mock import patch
        ProfilelessStartTests.setUp(self)
        self.flag = patch.dict('os.environ', {'BUSINESS_DEEPSEEK_SWITCH_ENABLED': 'true'})
        self.flag.start()
        self.addCleanup(self.flag.stop)
        self.calls = []
        self.deep = 'business_deepseek_v41_flash_tp2'
        manifest = json.loads((MODULE_PATH.parent / 'model-registry.examples' / self.deep / 'manifest.json').read_text())
        manifest['enabled'] = True
        target = self.manifest.parent.parent / 'deepseek/manifest.json'
        target.parent.mkdir()
        target.write_text(json.dumps(manifest))
        self.prepared = patch('business_tensorfold.check_prepared')
        self.prepared_mock = self.prepared.start()
        self.addCleanup(self.prepared.stop)
        self.monitor = patch.object(self.module, 'monitor_business_ready')
        self.monitor_mock = self.monitor.start()
        self.addCleanup(self.monitor.stop)
        self.threads = patch.object(self.module.threading, 'Thread')
        self.thread_mock = self.threads.start()
        self.thread_mock.return_value.is_alive.return_value = True
        self.addCleanup(self.threads.stop)
        self.handler = self.module.make_handler(self.config, lambda cmd, extra_env=None: self.calls.append((cmd, extra_env)))

    def request(self, path='/start', method='POST', **body):
        data = json.dumps(body).encode()
        request = (f'{method} {path} HTTP/1.0\r\nX-Runtime-Control-Token: runtime-token\r\nContent-Length: {len(data)}\r\n\r\n'.encode() + data)
        output = io.BytesIO()
        class Connection:
            def makefile(self, *args): return io.BytesIO(request)
            def sendall(self, data): output.write(data)
        self.handler(Connection(), ('127.0.0.1', 0), object())
        header, payload = output.getvalue().split(b'\r\n\r\n', 1)
        return int(header.split()[1]), json.loads(payload)

    def state_value(self):
        return json.loads(self.state.read_text())

    def test_migrate_only_valid_business_state_and_preserve_off_serialization(self):
        from unittest.mock import patch
        value = self.state_value()
        self.assertEqual((value['selectedBusinessProfileId'], value['selectionRevision'], value['businessTransition']),
                         (self.profile.id, 0, 'idle'))
        for body in ({}, {'modelProfileId': 'private_test'}, {'selectedBusinessProfileId': self.deep, 'selectionRevision': True}, []):
            self.state.write_text(json.dumps(body))
            with self.assertRaises(self.module.BusinessRestoreUnavailableError):
                self.module.make_handler(self.config)
        self.state.write_text('{broken')
        with self.assertRaises(self.module.BusinessRestoreUnavailableError):
            self.module.make_handler(self.config)
        with patch.dict('os.environ', {'BUSINESS_DEEPSEEK_SWITCH_ENABLED': 'false'}):
            self.module.write_active_model_state(str(self.state), self.profile)
            self.assertNotIn('selectionRevision', self.state_value())
            self.assertNotIn('businessTransition', self.state_value())

    def test_explicit_selection_is_atomic_loading_and_stale_restore_is_conflict(self):
        status, _ = self.request(modelProfileId=self.deep, reason='business-model-selection')
        self.assertEqual(status, 200)
        value = self.state_value()
        self.assertEqual(value['selectedBusinessProfileId'], self.deep)
        self.assertEqual(value['selectionRevision'], 1)
        self.assertEqual(value['businessTransition'], 'loading')
        self.assertTrue(value['businessGeneration'])
        self.assertEqual(self.calls[-1][1]['DGX_BUSINESS_GENERATION'], value['businessGeneration'])
        self.assertEqual(self.calls[-1][1]['BLUE_ABLITERATED'], '0')
        count = len(self.calls)
        for request in ({'modelProfileId': self.profile.id, 'reason': 'keep-warm', 'selectionRevision': 0},
                        {'modelProfileId': self.deep, 'reason': 'business-restore', 'selectionRevision': 0},
                        {'modelProfileId': self.deep, 'reason': 'keep-warm'},
                        {'modelProfileId': self.deep, 'reason': 'business-restore', 'selectionRevision': True}):
            self.assertEqual(self.request(**request)[0], 409)
        self.assertEqual(len(self.calls), count)
        self.assertEqual(self.request(modelProfileId=self.deep, reason='business-model-selection')[0], 200)
        self.assertEqual(self.state_value(), value)  # duplicate click does not replace the generation
        self.assertEqual(len(self.calls), count)

    def test_unprepared_selection_does_not_stop_or_change_selection(self):
        self.prepared_mock.side_effect = RuntimeError('business_deepseek_unprepared')
        before = self.state_value()
        status, payload = self.request(modelProfileId=self.deep, reason='business-model-selection')
        self.assertEqual(status, 503)
        self.assertIn('business_deepseek_unprepared', payload['message'])
        self.assertEqual(self.calls, [])
        self.assertEqual(self.state_value(), before)

    def test_kit_layout_mismatch_refuses_before_stopping(self):
        self.prepared_mock.side_effect = RuntimeError('business_kit_layout_mismatch')
        before = self.state.read_bytes()
        status, payload = self.request(modelProfileId=self.deep, reason='business-model-selection')
        self.assertEqual(status, 503)
        self.assertIn('business_kit_layout_mismatch', payload['message'])
        self.assertEqual(self.calls, [])
        self.assertEqual(self.state.read_bytes(), before)

    def test_restarted_control_fails_orphaned_loading_then_restarts_same_profile(self):
        self.request(modelProfileId=self.deep, reason='business-model-selection')
        previous = self.state_value()
        self.module._business_monitors.clear()  # Process-local threads are lost on restart.
        self.handler = self.module.make_handler(self.config, lambda cmd, extra_env=None: self.calls.append((cmd, extra_env)))
        current = self.state_value()
        self.assertEqual(current['businessTransition'], 'failed')
        self.assertEqual(current['businessFailureReason'], 'business_control_restarted')
        self.assertEqual(current['businessGeneration'], previous['businessGeneration'])
        result = {'generation': previous['businessGeneration'], 'prepared': True, 'ranks': []}
        from unittest.mock import patch
        with patch('business_tensorfold.runtime_status', return_value=result):
            self.assertEqual(self.module.business_runtime_status(self.config)['failureReason'], 'business_control_restarted')
        count = len(self.calls)
        self.assertEqual(self.request(reason='business-restore')[0], 200)
        self.assertGreater(len(self.calls), count)
        self.assertNotEqual(self.state_value()['businessGeneration'], previous['businessGeneration'])
        self.assertNotIn('businessFailureReason', self.state_value())

    def test_monitor_accepts_deepseek_probe_answered_only_in_reasoning(self):
        from unittest.mock import patch
        real_monitor = self.monitor.temp_original
        self.request(modelProfileId=self.deep, reason='business-model-selection')
        config, identity, profile = self.thread_mock.call_args.kwargs['args']
        replies = [{'data': [{'id': 'system-prod-primary'}]},
                   {'choices': [{'message': {'role': 'assistant', 'content': '', 'reasoning_content': 'OK'}}]}]
        class Reply:
            def __init__(self, value): self.value = value
            def __enter__(self): return io.BytesIO(json.dumps(self.value).encode())
            def __exit__(self, *args): return False
        ready = {'prepared': True, 'failureReason': None, 'ranks': [{'running': True}, {'running': True}]}
        with patch.dict('os.environ', {'BUSINESS_DEEPSEEK_UPSTREAM_API_KEY': 'test-key'}), \
             patch.object(self.module.urllib.request, 'urlopen', side_effect=lambda *a, **k: Reply(replies.pop(0))), \
             patch('business_tensorfold.runtime_status', return_value=ready), \
             patch.object(self.module.time, 'sleep', side_effect=AssertionError('probe retried')):
            real_monitor(config, identity, profile)
        self.assertEqual(self.state_value()['businessTransition'], 'ready')

    def test_start_defensively_fails_loading_when_monitor_died(self):
        self.request(modelProfileId=self.deep, reason='business-model-selection')
        previous = self.state_value()
        self.thread_mock.return_value.is_alive.return_value = False
        self.prepared_mock.side_effect = RuntimeError('business_deepseek_unprepared')
        self.assertEqual(self.request(reason='business-restore')[0], 503)
        self.assertEqual(self.state_value()['businessFailureReason'], 'business_control_restarted')
        self.prepared_mock.side_effect = None
        self.assertEqual(self.request(reason='business-restore')[0], 200)
        self.assertNotEqual(self.state_value()['businessGeneration'], previous['businessGeneration'])

    def test_initial_glm_resource_state_has_valid_identity_and_observed_ranks(self):
        from unittest.mock import patch
        before = self.state.read_bytes()
        for running in (False, True):
            rank_output = 'true\nfalse\n' if running else 'false\ntrue\n'
            outputs = [subprocess.CompletedProcess([], 0, stdout=rank_output),
                       subprocess.CompletedProcess([], 0, stdout=rank_output),
                       subprocess.CompletedProcess([], 0, stdout='listener' if running else '')]
            with self.subTest(running=running), patch('resource_state.subprocess.run', side_effect=outputs):
                status, payload = self.request('/system/resource-state', method='GET')
            self.assertEqual(status, 200)
            value = payload['businessRuntime']
            self.assertTrue(value['generation'])
            self.assertEqual(value['selectionRevision'], 0)
            self.assertEqual(value['modelProfileId'], self.profile.id)
            self.assertTrue(value['prepared'])
            self.assertIsNone(value['failureReason'])
            self.assertEqual(value['apiListenerClosed'], not running)
            self.assertEqual(value['ranks'], [dict(rank=r, generation=value['generation'],
                running=running, gpuReleased=not running) for r in (0, 1)])
        self.assertEqual(self.state.read_bytes(), before)

    def test_private_start_stop_preserves_selection_and_restore_uses_selected(self):
        self.request(modelProfileId=self.deep, reason='business-model-selection')
        value = self.state_value()
        private = json.loads((MODULE_PATH.parent / 'tests/fixtures/private_deepseek_v41_flash_tp2/manifest.json').read_text())
        private['enabled'] = True
        private['currentStorageLocation'] = str(self.storage)
        target = self.manifest.parent.parent / 'private/manifest.json'
        target.parent.mkdir()
        target.write_text(json.dumps(private))
        self.assertEqual(self.request(modelProfileId=private['modelProfileId'])[0], 200)
        self.assertFalse(self.state_value()['businessOrchestrationEligible'])
        self.assertEqual(self.request('/stop-force')[0], 200)
        self.assertEqual(self.state_value()['selectedBusinessProfileId'], self.deep)
        self.assertEqual(self.state_value()['selectionRevision'], value['selectionRevision'])
        self.assertEqual(self.request(reason='business-restore')[0], 200)
        self.assertEqual(self.state_value()['modelProfileId'], self.deep)
        self.assertNotEqual(self.state_value()['businessGeneration'], value['businessGeneration'])

    def test_failed_start_keeps_new_selection_and_generation(self):
        def fail(cmd, extra_env=None):
            if extra_env:
                raise RuntimeError('failure with secret output')
        self.handler = self.module.make_handler(self.config, fail)
        status, payload = self.request(modelProfileId=self.deep, reason='business-model-selection')
        self.assertEqual(status, 503)
        self.assertEqual(payload['code'], 'business_runtime_start_failed')
        value = self.state_value()
        self.assertEqual(value['selectedBusinessProfileId'], self.deep)
        self.assertEqual(value['businessTransition'], 'failed')
        self.assertNotIn('secret', json.dumps(payload))

    def test_same_selected_profile_start_after_stop_has_new_generation(self):
        self.request(reason='business-restore')
        previous = self.state_value()
        self.request('/stop-force')
        self.request(reason='business-restore')
        self.assertEqual(self.state_value()['selectionRevision'], previous['selectionRevision'])
        self.assertNotEqual(self.state_value()['businessGeneration'], previous['businessGeneration'])

    def test_status_matches_cp_fields_and_revision(self):
        from unittest.mock import patch
        self.request(modelProfileId=self.deep, reason='business-model-selection')
        generation = self.state_value()['businessGeneration']
        result = {'generation': generation, 'prepared': True,
                  'ranks': [{'rank': r, 'generation': generation, 'running': True, 'gpuReleased': False} for r in (0, 1)],
                  'launcherStopped': False, 'watchdogStopped': False, 'apiListenerClosed': False, 'failureReason': None}
        with patch('business_tensorfold.runtime_status', return_value=result):
            status = self.module.business_runtime_status(self.config)
        self.assertEqual(set(status), {'modelProfileId', 'selectionRevision', 'generation', 'prepared', 'ranks',
                                      'launcherStopped', 'watchdogStopped', 'apiListenerClosed', 'failureReason'})
        self.assertEqual(status['modelProfileId'], self.deep)
        self.assertEqual(status['selectionRevision'], 1)
        self.assertEqual({r['rank'] for r in status['ranks']}, {0, 1})

    def test_inference_lock_holds_lifecycle_until_request_drains(self):
        from active_model_state import business_state_lock
        with business_state_lock(str(self.state), exclusive=False):
            with self.assertRaises(BlockingIOError):
                with business_state_lock(str(self.state), blocking=False):
                    self.fail('lifecycle acquired while inference was in flight')

    def test_failed_stop_keeps_selection_and_blocks_inference(self):
        self.request(modelProfileId=self.deep, reason='business-model-selection')
        previous = self.state_value()
        def fail(*args):
            raise RuntimeError('rank 1 still running')
        self.handler = self.module.make_handler(self.config, fail)
        self.assertEqual(self.request('/stop-force')[0], 503)
        current = self.state_value()
        self.assertEqual(current['selectedBusinessProfileId'], previous['selectedBusinessProfileId'])
        self.assertEqual(current['selectionRevision'], previous['selectionRevision'])
        self.assertEqual(current['businessTransition'], 'failed')
        self.assertEqual(current['businessFailureReason'], 'business_runtime_stop_unverified')
