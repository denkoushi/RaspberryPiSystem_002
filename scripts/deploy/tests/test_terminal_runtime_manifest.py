#!/usr/bin/env python3
from __future__ import annotations

import base64
import copy
import hashlib
import importlib.util
import io
import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock


SCRIPT = Path(__file__).parents[1] / "terminal-runtime-manifest.py"
SPEC = importlib.util.spec_from_file_location("terminal_runtime_manifest", SCRIPT)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("could not load terminal runtime manifest helper")
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)
ORIGINAL_RUN_COMMAND = MODULE._run_command


def image_id(seed: str) -> str:
    return "sha256:" + hashlib.sha256(seed.encode("utf-8")).hexdigest()


class FakeRuntime:
    def __init__(self, *, compose: dict, bind_source: Path) -> None:
        self.compose = copy.deepcopy(compose)
        self.bind_source = bind_source
        self.calls: list[list[str]] = []
        self.units: dict[str, dict[str, str]] = {}
        self.activation_units: dict[str, dict[str, str]] = {}
        self.unit_needs_reload: set[str] = set()
        self.unit_show_transitions: dict[str, list[str]] = {}
        self.stop_results_failed: set[str] = set()
        self.timer_start_transitions: dict[str, list[str]] = {}
        self.timer_persistent: dict[str, bool] = {}
        self.images: dict[str, str] = {}
        self.containers: dict[tuple[str, str], dict] = {}
        self.volumes: set[str] = set()
        self.service_references = {
            "nfc-agent": "raspberrypisystem_002-nfc-agent:latest",
            "barcode-agent": "raspberrypisystem_002-barcode-agent:latest",
            "torque-agent": "raspberrypisystem_002-torque-agent:latest",
        }
        self.service_mounts = {
            "nfc-agent": [
                {
                    "Type": "volume",
                    "Source": "/var/lib/docker/volumes/raspi_nfc-data/_data",
                    "Destination": "/data",
                    "RW": True,
                    "Name": "raspi_nfc-data",
                    "Propagation": "",
                },
                {
                    "Type": "bind",
                    "Source": str(bind_source),
                    "Destination": "/run/pcscd",
                    "RW": False,
                    "Name": "",
                    "Propagation": "rprivate",
                },
            ],
            "barcode-agent": [],
            "torque-agent": [],
        }
        self.service_restart = {
            "nfc-agent": {"Name": "unless-stopped", "MaximumRetryCount": 0},
            "barcode-agent": {"Name": "unless-stopped", "MaximumRetryCount": 0},
            "torque-agent": {"Name": "unless-stopped", "MaximumRetryCount": 0},
        }
        self.service_security = {
            service: {
                "privileged": False,
                "devices": [],
                "networkMode": "default",
                "user": "",
                "command": [f"/usr/local/bin/{service}"],
                "entrypoint": None,
                "capAdd": None,
                "capDrop": None,
                "securityOpt": None,
                "readOnlyRootfs": False,
            }
            for service in self.service_references
        }
        self.service_environment = {
            "nfc-agent": [
                "API_BASE_URL=https://api.example.invalid",
                "CLIENT_SECRET=SECRET-NFC-BASELINE",
                "PYTHONUNBUFFERED=1",
            ],
            "barcode-agent": [
                "API_BASE_URL=https://api.example.invalid",
                "CLIENT_SECRET=SECRET-BARCODE-BASELINE",
                "PYTHONUNBUFFERED=1",
            ],
            "torque-agent": [
                "API_BASE_URL=https://api.example.invalid",
                "CLIENT_KEY=SECRET-TORQUE-BASELINE",
                "PYTHONUNBUFFERED=1",
            ],
        }
        self.service_healthcheck = {
            "nfc-agent": None,
            "barcode-agent": None,
            "torque-agent": {
                "Test": [
                    "CMD",
                    "python",
                    "-c",
                    "import urllib.request; urllib.request.urlopen('http://127.0.0.1:7073/health')",
                ],
                "Interval": 15_000_000_000,
                "Timeout": 5_000_000_000,
                "StartPeriod": 10_000_000_000,
                "Retries": 3,
            },
        }
        self.service_host_config_extra = {
            service: {
                "AutoRemove": False,
                "PortBindings": {},
                "PublishAllPorts": False,
                "ExtraHosts": [],
                "Dns": [],
                "DnsOptions": [],
                "DnsSearch": [],
                "Links": [],
                "VolumesFrom": [],
                "GroupAdd": [],
                "Tmpfs": {},
                "Sysctls": {},
                "Ulimits": [],
                "LogConfig": {"Type": "json-file", "Config": {}},
            }
            for service in self.service_references
        }
        self.fail_compose_once: dict[str, int] = {}
        self.fail_compose_config_once = 0
        self.fail_tag_service_once: dict[str, int] = {}
        self.fail_image_rm_service_once: dict[str, int] = {}
        self.fail_image_list_once = 0
        self.fail_image_inspect_once = 0
        self.mutation_ordinal = 0
        self.fail_mutation_before: int | None = None
        self.fail_mutation_after: int | None = None
        self.next_container = 100

    @staticmethod
    def _is_mutation_call(call: list[str]) -> bool:
        if call[:2] == ["systemctl", "show"]:
            return False
        if call[:2] == ["docker", "ps"]:
            return False
        if call[:2] == ["docker", "inspect"]:
            return False
        if call[:3] == ["docker", "image", "inspect"]:
            return False
        if call[:3] == ["docker", "image", "ls"]:
            return False
        if call[:3] == ["docker", "volume", "inspect"]:
            return False
        if call[:2] == ["docker", "compose"] and "config" in call:
            return False
        return True

    @property
    def mutation_calls(self) -> list[list[str]]:
        return [call for call in self.calls if self._is_mutation_call(call)]

    def clone(self) -> "FakeRuntime":
        cloned = FakeRuntime(compose=self.compose, bind_source=self.bind_source)
        cloned.units = copy.deepcopy(self.units)
        cloned.activation_units = copy.deepcopy(self.activation_units)
        cloned.unit_needs_reload = set(self.unit_needs_reload)
        cloned.unit_show_transitions = copy.deepcopy(self.unit_show_transitions)
        cloned.stop_results_failed = set(self.stop_results_failed)
        cloned.timer_start_transitions = copy.deepcopy(
            self.timer_start_transitions
        )
        cloned.timer_persistent = copy.deepcopy(self.timer_persistent)
        cloned.images = copy.deepcopy(self.images)
        cloned.containers = copy.deepcopy(self.containers)
        cloned.volumes = set(self.volumes)
        cloned.service_references = copy.deepcopy(self.service_references)
        cloned.service_mounts = copy.deepcopy(self.service_mounts)
        cloned.service_restart = copy.deepcopy(self.service_restart)
        cloned.service_security = copy.deepcopy(self.service_security)
        cloned.service_environment = copy.deepcopy(self.service_environment)
        cloned.service_healthcheck = copy.deepcopy(self.service_healthcheck)
        cloned.service_host_config_extra = copy.deepcopy(
            self.service_host_config_extra
        )
        cloned.next_container = self.next_container
        cloned.fail_tag_service_once = copy.deepcopy(self.fail_tag_service_once)
        cloned.fail_image_rm_service_once = copy.deepcopy(
            self.fail_image_rm_service_once
        )
        cloned.fail_compose_config_once = self.fail_compose_config_once
        cloned.fail_image_list_once = self.fail_image_list_once
        cloned.fail_image_inspect_once = self.fail_image_inspect_once
        return cloned

    def add_unit(
        self,
        name: str,
        *,
        load: str = "loaded",
        unit_file: str = "enabled",
        active: str = "active",
        persistent: bool | None = None,
    ) -> None:
        self.units[name] = {
            "LoadState": load,
            "UnitFileState": unit_file,
            "ActiveState": active,
        }
        if name.endswith(".timer"):
            self.timer_persistent[name] = (
                name == "signage-daily-reboot.timer"
                if persistent is None
                else persistent
            )

    def add_container(
        self,
        service: str,
        image: str,
        *,
        running: bool,
        restart: dict | None = None,
        mounts: list[dict] | None = None,
        security: dict | None = None,
        environment: list[str] | None = None,
        healthcheck: dict | None = None,
    ) -> str:
        reference = self.service_references[service]
        self.images[reference] = image
        identifier = hashlib.sha256(
            f"{service}-{self.next_container}".encode("utf-8")
        ).hexdigest()
        self.next_container += 1
        selected_restart = copy.deepcopy(restart or self.service_restart[service])
        selected_security = copy.deepcopy(
            self.service_security[service] if security is None else security
        )
        selected_environment = copy.deepcopy(
            self.service_environment[service]
            if environment is None
            else environment
        )
        selected_healthcheck = copy.deepcopy(
            self.service_healthcheck[service]
            if healthcheck is None
            else healthcheck
        )
        container_config = {
            "Env": selected_environment,
            "Hostname": identifier[:12],
            "Image": reference,
            "User": selected_security["user"],
            "Cmd": selected_security["command"],
            "Entrypoint": selected_security["entrypoint"],
            "WorkingDir": f"/app/{service}",
            "Healthcheck": selected_healthcheck,
            "ExposedPorts": None,
            "Labels": {
                "com.docker.compose.project": self.compose["project"],
                "com.docker.compose.service": service,
                "com.docker.compose.project.working_dir": self.compose[
                    "workingDirectory"
                ],
                "com.docker.compose.project.config_files": ",".join(
                    self.compose["configFiles"]
                ),
                "com.docker.compose.version": "2.fake",
                "com.docker.compose.config-hash": f"config-{service}",
            },
        }
        host_config = {
            **copy.deepcopy(self.service_host_config_extra[service]),
            "RestartPolicy": selected_restart,
            "Privileged": selected_security["privileged"],
            "Devices": selected_security["devices"],
            "NetworkMode": selected_security["networkMode"],
            "CapAdd": selected_security["capAdd"],
            "CapDrop": selected_security["capDrop"],
            "SecurityOpt": selected_security["securityOpt"],
            "ReadonlyRootfs": selected_security["readOnlyRootfs"],
        }
        self.containers[(self.compose["project"], service)] = {
            "id": identifier,
            "imageId": image,
            "imageReference": reference,
            "running": running,
            "restartPolicy": selected_restart,
            "mounts": copy.deepcopy(
                self.service_mounts[service] if mounts is None else mounts
            ),
            "security": selected_security,
            "environment": selected_environment,
            "containerConfig": container_config,
            "hostConfig": host_config,
            "compose": copy.deepcopy(self.compose),
        }
        return identifier

    def _result(
        self,
        returncode: int,
        stdout: str,
        allowed_exit_codes: tuple[int, ...],
    ):
        if returncode not in allowed_exit_codes:
            raise MODULE.RuntimeManifestError("fake runtime command failed")
        return MODULE.CommandResult(returncode, stdout)

    def _finish_mutation(self, mutation_ordinal: int | None) -> None:
        if self.fail_mutation_after == mutation_ordinal:
            self.fail_mutation_after = None
            raise MODULE.RuntimeManifestError(
                "injected failure after runtime mutation"
            )

    def _find_container_by_id(self, identifier: str) -> tuple[tuple[str, str], dict]:
        for key, value in self.containers.items():
            if value["id"].startswith(identifier):
                return key, value
        raise MODULE.RuntimeManifestError("fake container is missing")

    def _service_from_filters(self, argv: list[str]) -> tuple[str, str]:
        project = ""
        service = ""
        for index, value in enumerate(argv):
            if value != "--filter":
                continue
            selected = argv[index + 1]
            if selected.startswith("label=com.docker.compose.project="):
                project = selected.rsplit("=", 1)[1]
            if selected.startswith("label=com.docker.compose.service="):
                service = selected.rsplit("=", 1)[1]
        return project, service

    def run(
        self, argv, *, allowed_exit_codes: tuple[int, ...] = (0,)
    ):
        call = list(argv)
        self.calls.append(call)
        mutation_ordinal: int | None = None
        if self._is_mutation_call(call):
            self.mutation_ordinal += 1
            mutation_ordinal = self.mutation_ordinal
            if self.fail_mutation_before == mutation_ordinal:
                self.fail_mutation_before = None
                raise MODULE.RuntimeManifestError(
                    "injected failure before runtime mutation"
                )

        if call[:2] == ["systemctl", "show"]:
            if MODULE.ACTIVATION_UNIT_RE.fullmatch(call[-1]):
                state = self.activation_units.get(
                    call[-1],
                    {
                        "LoadState": "not-found",
                        "ActiveState": "inactive",
                        "SubState": "dead",
                        "Result": "",
                        "ExecMainStatus": "0",
                    },
                )
                properties = [
                    value.removeprefix("--property=")
                    for value in call
                    if value.startswith("--property=")
                ]
                output = "\n".join(f"{key}={state[key]}" for key in properties)
                return self._result(0, output, allowed_exit_codes)
            state = self.units[call[-1]]
            values = {
                **state,
                "NeedDaemonReload": (
                    "yes" if call[-1] in self.unit_needs_reload else "no"
                ),
            }
            if call[-1].endswith(".timer"):
                values["Persistent"] = (
                    "yes" if self.timer_persistent[call[-1]] else "no"
                )
            properties = [
                value.removeprefix("--property=")
                for value in call
                if value.startswith("--property=")
            ]
            output = "\n".join(f"{key}={values[key]}" for key in properties)
            transitions = self.unit_show_transitions.get(call[-1], [])
            if transitions:
                state["ActiveState"] = transitions.pop(0)
            return self._result(0, output, allowed_exit_codes)
        if call[0] == "systemd-run":
            unit_argument = next(value for value in call if value.startswith("--unit="))
            unit = unit_argument.removeprefix("--unit=")
            self.activation_units[unit] = {
                "LoadState": "loaded",
                "ActiveState": "active",
                "SubState": "exited",
                "Result": "success",
                "ExecMainStatus": "0",
            }
            self._finish_mutation(mutation_ordinal)
            return self._result(0, "", allowed_exit_codes)
        if call[:2] == ["systemctl", "daemon-reload"]:
            self.unit_needs_reload.clear()
            self._finish_mutation(mutation_ordinal)
            return self._result(0, "", allowed_exit_codes)
        if call[0] == "systemctl":
            action = call[1]
            unit = call[-1]
            if MODULE.ACTIVATION_UNIT_RE.fullmatch(unit):
                if action == "stop":
                    self.activation_units.pop(unit, None)
                    self._finish_mutation(mutation_ordinal)
                    return self._result(0, "", allowed_exit_codes)
                if action == "reset-failed":
                    return self._result(
                        0 if unit in self.activation_units else 1,
                        "",
                        allowed_exit_codes,
                    )
                raise AssertionError(f"unexpected activation command: {call!r}")
            state = self.units[unit]
            runtime = "--runtime" in call
            if action == "start":
                state["ActiveState"] = "active"
                for triggered_unit in self.timer_start_transitions.get(unit, []):
                    self.units[triggered_unit]["ActiveState"] = "activating"
            elif action == "stop":
                state["ActiveState"] = (
                    "failed" if unit in self.stop_results_failed else "inactive"
                )
            elif action == "reset-failed" and state["ActiveState"] == "failed":
                state["ActiveState"] = "inactive"
            elif action == "unmask" and state["UnitFileState"] in {
                "masked",
                "masked-runtime",
            }:
                state["LoadState"] = "loaded"
                state["UnitFileState"] = "disabled"
            elif action == "mask":
                state["LoadState"] = "masked"
                state["UnitFileState"] = "masked-runtime" if runtime else "masked"
                state["ActiveState"] = "inactive"
            elif action == "enable":
                state["LoadState"] = "loaded"
                state["UnitFileState"] = "enabled-runtime" if runtime else "enabled"
            elif action == "disable":
                if runtime and state["UnitFileState"] == "enabled-runtime":
                    state["UnitFileState"] = "disabled"
                if not runtime and state["UnitFileState"] == "enabled":
                    state["UnitFileState"] = "disabled"
            self._finish_mutation(mutation_ordinal)
            return self._result(0, "", allowed_exit_codes)

        if call[:2] == ["docker", "ps"]:
            key = self._service_from_filters(call)
            container = self.containers.get(key)
            output = container["id"][:12] if container else ""
            return self._result(0, output, allowed_exit_codes)
        if call[:2] == ["docker", "inspect"]:
            _key, container = self._find_container_by_id(call[-1])
            compose = container["compose"]
            output = json.dumps(
                {
                    "id": container["id"],
                    "imageId": container["imageId"],
                    "imageReference": container["imageReference"],
                    "running": container["running"],
                    "containerConfig": container["containerConfig"],
                    "hostConfig": container["hostConfig"],
                    "restartPolicy": container["restartPolicy"],
                    "mounts": container["mounts"],
                    **container["security"],
                    "project": compose["project"],
                    "service": _key[1],
                    "workingDirectory": compose["workingDirectory"],
                    "configFiles": ",".join(compose["configFiles"]),
                }
            )
            return self._result(0, output, allowed_exit_codes)
        if call[:3] == ["docker", "image", "ls"]:
            if self.fail_image_list_once:
                self.fail_image_list_once -= 1
                return self._result(2, "", allowed_exit_codes)
            reference = call[-1]
            output = self.images.get(reference, "")
            return self._result(0, output, allowed_exit_codes)
        if call[:3] == ["docker", "image", "inspect"]:
            if self.fail_image_inspect_once:
                self.fail_image_inspect_once -= 1
                return self._result(2, "", allowed_exit_codes)
            reference = call[-1]
            if reference not in self.images:
                return self._result(1, "", allowed_exit_codes)
            return self._result(0, self.images[reference], allowed_exit_codes)
        if call[:2] == ["docker", "tag"]:
            source, destination = call[2], call[3]
            for service, remaining in self.fail_tag_service_once.items():
                if remaining and f"/{service}:" in destination:
                    self.fail_tag_service_once[service] -= 1
                    return self._result(2, "", allowed_exit_codes)
            resolved = source if source.startswith("sha256:") else self.images[source]
            self.images[destination] = resolved
            return self._result(0, "", allowed_exit_codes)
        if call[:3] == ["docker", "volume", "inspect"]:
            name = call[-1]
            return self._result(0 if name in self.volumes else 1, name, allowed_exit_codes)
        if call[:2] == ["docker", "compose"]:
            if "config" in call:
                if self.fail_compose_config_once:
                    self.fail_compose_config_once -= 1
                    return self._result(2, "", allowed_exit_codes)
                return self._result(0, "", allowed_exit_codes)
            service = call[-1]
            if self.fail_compose_once.get(service, 0):
                self.fail_compose_once[service] -= 1
                return self._result(2, "", allowed_exit_codes)
            reference = self.service_references[service]
            self.add_container(
                service,
                self.images[reference],
                running="up" in call,
            )
            return self._result(0, "", allowed_exit_codes)
        if call[:2] == ["docker", "update"]:
            _key, container = self._find_container_by_id(call[-1])
            value = call[call.index("--restart") + 1]
            if value.startswith("on-failure:"):
                name, maximum = value.split(":", 1)
                policy = {"Name": name, "MaximumRetryCount": int(maximum)}
            else:
                policy = {"Name": value, "MaximumRetryCount": 0}
            container["restartPolicy"] = policy
            container["hostConfig"]["RestartPolicy"] = copy.deepcopy(policy)
            return self._result(0, "", allowed_exit_codes)
        if call[:2] == ["docker", "stop"]:
            _key, container = self._find_container_by_id(call[-1])
            container["running"] = False
            return self._result(0, "", allowed_exit_codes)
        if call[:2] == ["docker", "rm"]:
            key, _container = self._find_container_by_id(call[-1])
            del self.containers[key]
            return self._result(0, "", allowed_exit_codes)
        if call[:3] == ["docker", "image", "rm"]:
            for service, remaining in self.fail_image_rm_service_once.items():
                if remaining and f"/{service}:" in call[-1]:
                    self.fail_image_rm_service_once[service] -= 1
                    return self._result(2, "", allowed_exit_codes)
            del self.images[call[-1]]
            return self._result(0, "", allowed_exit_codes)
        raise AssertionError(f"unexpected command: {call!r}")


class TerminalRuntimeManifestTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.base = Path(self.temporary.name)
        self.storage = self.base / "runtime-state"
        self.working = self.base / "repo"
        self.working.mkdir()
        self.config = self.working / "infrastructure/docker/docker-compose.client.yml"
        self.config.parent.mkdir(parents=True)
        self.config.write_text("services: {}\n", encoding="utf-8")
        self.bind_source = self.base / "pcscd"
        self.bind_source.mkdir()
        self.compose = {
            "project": "raspberrypisystem_002",
            "workingDirectory": str(self.working),
            "configFiles": [str(self.config)],
        }
        self.fake = FakeRuntime(compose=self.compose, bind_source=self.bind_source)
        self.fake.volumes.add("raspi_nfc-data")
        self.run_id = "run-123"
        self.host = "terminal-01"
        self.runner_patch = mock.patch.object(MODULE, "_run_command", self.fake.run)
        self.runner_patch.start()
        self.addCleanup(self.runner_patch.stop)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    @property
    def manifest_path(self) -> Path:
        return self.storage / self.run_id / self.host / "manifest.json"

    def capture(
        self,
        *,
        services: list[str] | None = None,
        units: list[str] | None = None,
        restart_on_restore_units: list[str] | None = None,
        run_id: str | None = None,
    ):
        selected_services = services or []
        return MODULE.capture(
            root=self.storage,
            run_id=run_id or self.run_id,
            host=self.host,
            units=units or [],
            docker_services=selected_services,
            restart_on_restore_units=restart_on_restore_units or [],
            compose_project=self.compose["project"] if selected_services else None,
            compose_working_directory=(
                self.compose["workingDirectory"] if selected_services else None
            ),
            compose_config_files=(self.compose["configFiles"] if selected_services else []),
        )

    def probe_capture(
        self,
        *,
        services: list[str] | None = None,
        units: list[str] | None = None,
        restart_on_restore_units: list[str] | None = None,
    ):
        selected_services = services or []
        return MODULE.probe_capture(
            run_id=self.run_id,
            host=self.host,
            units=units or [],
            docker_services=selected_services,
            restart_on_restore_units=restart_on_restore_units or [],
            compose_project=self.compose["project"] if selected_services else None,
            compose_working_directory=(
                self.compose["workingDirectory"] if selected_services else None
            ),
            compose_config_files=(
                self.compose["configFiles"] if selected_services else []
            ),
        )

    def restore(self, digest: str):
        return MODULE.restore(
            root=self.storage,
            run_id=self.run_id,
            host=self.host,
            expected_manifest_sha256=digest,
        )

    def candidate(self, service: str, seed: str = "candidate", *, running: bool = True):
        return self.fake.add_container(service, image_id(seed + service), running=running)

    def test_running_image_rolls_back_exactly_and_cleanup_preserves_volume(self):
        prior = image_id("prior-nfc")
        self.fake.add_container("nfc-agent", prior, running=True)
        captured = self.capture(services=["nfc-agent"])
        manifest_text = self.manifest_path.read_text(encoding="utf-8")
        manifest = json.loads(manifest_text)
        rollback_tag = manifest["docker"][0]["rollbackTag"]
        self.assertEqual(self.fake.images[rollback_tag], prior)
        self.assertRegex(
            manifest["docker"][0]["runtimeEnvironmentSha256"],
            r"^[0-9a-f]{64}$",
        )
        self.assertRegex(
            manifest["docker"][0]["runtimeConfigSha256"],
            r"^[0-9a-f]{64}$",
        )
        self.assertNotIn('"environment":', manifest_text)
        self.assertNotIn("SECRET-NFC-BASELINE", manifest_text)
        for directory in (
            self.storage,
            self.storage / self.run_id,
            self.storage / self.run_id / self.host,
        ):
            self.assertEqual(stat.S_IMODE(directory.stat().st_mode), 0o700)
        self.assertEqual(stat.S_IMODE(self.manifest_path.stat().st_mode), 0o600)
        self.assertEqual(
            stat.S_IMODE(
                (self.storage / self.run_id / self.host / ".lock").stat().st_mode
            ),
            0o600,
        )

        preflight = MODULE.preflight_restore(
            root=self.storage,
            run_id=self.run_id,
            host=self.host,
            expected_manifest_sha256=captured["manifestSha256"],
        )
        self.assertEqual(
            preflight["runtimeHealth"],
            {
                "activeSystemdUnits": [],
                "runningDockerServices": ["nfc-agent"],
            },
        )

        self.candidate("nfc-agent")
        restored_result = self.restore(captured["manifestSha256"])
        self.assertEqual(restored_result["runtimeHealth"], preflight["runtimeHealth"])
        restored = self.fake.containers[(self.compose["project"], "nfc-agent")]
        self.assertEqual(restored["imageId"], prior)
        self.assertTrue(restored["running"])
        self.assertEqual(
            restored["restartPolicy"],
            {"Name": "unless-stopped", "MaximumRetryCount": 0},
        )
        self.assertIn("raspi_nfc-data", self.fake.volumes)

        self.restore(captured["manifestSha256"])
        cleaned = MODULE.cleanup(
            root=self.storage,
            run_id=self.run_id,
            host=self.host,
            expected_manifest_sha256=captured["manifestSha256"],
            outcome="restored",
        )
        self.assertEqual(cleaned["tagCount"], 1)
        self.assertNotIn(rollback_tag, self.fake.images)
        self.assertIn("raspi_nfc-data", self.fake.volumes)
        mutations_before = len(self.fake.mutation_calls)
        repeated = MODULE.cleanup(
            root=self.storage,
            run_id=self.run_id,
            host=self.host,
            expected_manifest_sha256=captured["manifestSha256"],
            outcome="restored",
        )
        self.assertTrue(repeated["alreadyClean"])
        self.assertEqual(len(self.fake.mutation_calls), mutations_before)
        with self.assertRaisesRegex(MODULE.RuntimeManifestError, "outcome does not match"):
            MODULE.cleanup(
                root=self.storage,
                run_id=self.run_id,
                host=self.host,
                expected_manifest_sha256=captured["manifestSha256"],
                outcome="committed",
            )

    def test_absent_and_stopped_states_restore_without_removing_volumes(self):
        absent_capture = self.capture(services=["nfc-agent"], run_id="run-absent")
        self.candidate("nfc-agent", "absent-candidate")
        MODULE.restore(
            root=self.storage,
            run_id="run-absent",
            host=self.host,
            expected_manifest_sha256=absent_capture["manifestSha256"],
        )
        self.assertNotIn((self.compose["project"], "nfc-agent"), self.fake.containers)
        self.assertIn("raspi_nfc-data", self.fake.volumes)
        self.assertFalse(any("down" in call or "-v" in call for call in self.fake.calls))

        prior = image_id("prior-stopped")
        self.fake.add_container("barcode-agent", prior, running=False)
        stopped_capture = self.capture(
            services=["barcode-agent"], run_id="run-stopped"
        )
        self.candidate("barcode-agent", "stopped-candidate", running=True)
        restore_start = len(self.fake.calls)
        MODULE.restore(
            root=self.storage,
            run_id="run-stopped",
            host=self.host,
            expected_manifest_sha256=stopped_capture["manifestSha256"],
        )
        stopped = self.fake.containers[(self.compose["project"], "barcode-agent")]
        self.assertEqual(stopped["imageId"], prior)
        self.assertFalse(stopped["running"])
        stopped_restore_calls = self.fake.calls[restore_start:]
        compose_mutations = [
            call
            for call in stopped_restore_calls
            if call[:2] == ["docker", "compose"] and "config" not in call
        ]
        self.assertEqual(len(compose_mutations), 1)
        self.assertIn("create", compose_mutations[0])
        self.assertNotIn("up", compose_mutations[0])
        self.assertNotIn("-d", compose_mutations[0])
        self.assertEqual(
            compose_mutations[0][compose_mutations[0].index("--pull") + 1],
            "never",
        )
        self.assertFalse(
            any(call[:2] == ["docker", "stop"] for call in stopped_restore_calls)
        )

    def test_same_image_environment_drift_force_recreates_with_sealed_environment(self):
        prior = image_id("same-image-environment")
        old_environment = [
            "API_BASE_URL=https://old.example.invalid",
            "CLIENT_SECRET=SECRET-OLD-ENVIRONMENT",
            "PYTHONUNBUFFERED=1",
        ]
        candidate_environment = [
            "API_BASE_URL=https://candidate.example.invalid",
            "CLIENT_SECRET=SECRET-CANDIDATE-ENVIRONMENT",
            "PYTHONUNBUFFERED=1",
        ]
        self.fake.service_environment["nfc-agent"] = old_environment
        self.fake.add_container("nfc-agent", prior, running=True)
        captured = self.capture(services=["nfc-agent"])
        manifest_text = self.manifest_path.read_text(encoding="utf-8")
        self.assertNotIn("SECRET-OLD-ENVIRONMENT", manifest_text)
        self.assertNotIn("SECRET-CANDIDATE-ENVIRONMENT", manifest_text)

        # Model an env-only candidate recreation followed by rollback-manifest.py
        # restoring the old .env file before this runtime restore begins.
        self.fake.service_environment["nfc-agent"] = candidate_environment
        self.fake.add_container("nfc-agent", prior, running=True)
        self.fake.service_environment["nfc-agent"] = old_environment
        restore_start = len(self.fake.calls)

        self.restore(captured["manifestSha256"])

        restored = self.fake.containers[(self.compose["project"], "nfc-agent")]
        self.assertEqual(restored["imageId"], prior)
        self.assertEqual(restored["environment"], old_environment)
        compose_mutations = [
            call
            for call in self.fake.calls[restore_start:]
            if call[:2] == ["docker", "compose"] and "config" not in call
        ]
        self.assertEqual(len(compose_mutations), 1)
        self.assertIn("--force-recreate", compose_mutations[0])

    def test_environment_duplicates_and_malformed_entries_fail_closed(self):
        cases = (
            (["DUPLICATE=one", "DUPLICATE=two"], "duplicate key"),
            (["MISSING_EQUALS"], "entry is malformed"),
            (["BAD-KEY=value"], "key is malformed"),
        )
        for environment, message in cases:
            with self.subTest(environment=environment):
                self.fake.service_environment["barcode-agent"] = environment
                self.fake.add_container(
                    "barcode-agent", image_id("malformed-environment"), running=True
                )
                self.fake.calls.clear()
                with self.assertRaisesRegex(MODULE.RuntimeManifestError, message):
                    self.capture(services=["barcode-agent"])
                self.assertFalse(self.manifest_path.exists())
                self.assertEqual(self.fake.mutation_calls, [])

    def test_unsupported_baseline_runtime_features_fail_before_tagging(self):
        self.fake.service_host_config_extra["nfc-agent"]["PortBindings"] = {
            "7071/tcp": [{"HostIp": "127.0.0.1", "HostPort": "7071"}]
        }
        self.fake.add_container(
            "nfc-agent", image_id("unsupported-runtime"), running=True
        )
        self.fake.calls.clear()

        with self.assertRaisesRegex(
            MODULE.RuntimeManifestError, "unsupported by rollback capture: PortBindings"
        ):
            self.capture(services=["nfc-agent"])

        self.assertFalse(self.manifest_path.exists())
        self.assertEqual(self.fake.mutation_calls, [])

    def test_probe_capture_checks_all_agents_without_files_tags_or_mutation(self):
        for service in ("nfc-agent", "barcode-agent", "torque-agent"):
            self.fake.add_container(
                service, image_id(f"probe-{service}"), running=True
            )
        self.fake.calls.clear()

        result = self.probe_capture(
            services=["nfc-agent", "barcode-agent", "torque-agent"]
        )

        self.assertEqual(
            result,
            {
                "compatible": True,
                "unitCount": 0,
                "dockerCount": 3,
                "presentDockerCount": 3,
            },
        )
        self.assertEqual(self.fake.mutation_calls, [])
        self.assertFalse(self.storage.exists())
        self.assertFalse(any(call[:2] == ["docker", "tag"] for call in self.fake.calls))

    def test_probe_capture_accepts_a_mixed_optional_agent_runtime(self):
        self.fake.add_container(
            "torque-agent", image_id("probe-only-torque"), running=True
        )
        self.fake.calls.clear()

        result = self.probe_capture(
            services=["nfc-agent", "barcode-agent", "torque-agent"]
        )

        self.assertEqual(result["dockerCount"], 3)
        self.assertEqual(result["presentDockerCount"], 1)
        self.assertEqual(self.fake.mutation_calls, [])
        self.assertFalse(self.storage.exists())

    def test_probe_and_capture_accept_and_restore_torque_healthcheck(self):
        prior = image_id("torque-with-healthcheck")
        expected_healthcheck = copy.deepcopy(
            self.fake.service_healthcheck["torque-agent"]
        )
        self.fake.add_container("torque-agent", prior, running=True)

        probed = self.probe_capture(services=["torque-agent"])
        self.assertTrue(probed["compatible"])
        captured = self.capture(services=["torque-agent"])

        self.fake.service_healthcheck["torque-agent"] = {
            "Test": ["CMD", "false"],
            "Interval": 1_000_000_000,
            "Timeout": 1_000_000_000,
            "Retries": 1,
        }
        self.fake.add_container(
            "torque-agent", image_id("torque-candidate"), running=True
        )
        self.fake.service_healthcheck["torque-agent"] = expected_healthcheck

        self.restore(captured["manifestSha256"])

        restored = self.fake.containers[(self.compose["project"], "torque-agent")]
        self.assertEqual(
            restored["containerConfig"]["Healthcheck"], expected_healthcheck
        )

    def test_probe_rejects_external_runtime_feature_before_any_mutation(self):
        self.fake.service_host_config_extra["torque-agent"]["ExtraHosts"] = [
            "unsafe.invalid:192.0.2.10"
        ]
        self.fake.add_container(
            "torque-agent", image_id("unsupported-probe"), running=True
        )
        self.fake.calls.clear()

        with self.assertRaisesRegex(
            MODULE.RuntimeManifestError,
            "unsupported by rollback capture: ExtraHosts",
        ) as raised:
            self.probe_capture(services=["torque-agent"])

        self.assertEqual(raised.exception.code, "runtime.unsupported-feature")
        self.assertEqual(self.fake.mutation_calls, [])
        self.assertFalse(self.storage.exists())

    def test_same_image_functional_runtime_drift_is_recreated_from_compose(self):
        prior = image_id("same-image-runtime-config")
        self.fake.add_container("barcode-agent", prior, running=True)
        captured = self.capture(services=["barcode-agent"])

        self.fake.service_host_config_extra["barcode-agent"]["ExtraHosts"] = [
            "candidate.internal:192.0.2.10"
        ]
        self.fake.add_container("barcode-agent", prior, running=True)
        self.fake.service_host_config_extra["barcode-agent"]["ExtraHosts"] = []
        restore_start = len(self.fake.calls)

        self.restore(captured["manifestSha256"])

        restored = self.fake.containers[
            (self.compose["project"], "barcode-agent")
        ]
        self.assertEqual(restored["hostConfig"]["ExtraHosts"], [])
        compose_mutations = [
            call
            for call in self.fake.calls[restore_start:]
            if call[:2] == ["docker", "compose"] and "config" not in call
        ]
        self.assertEqual(len(compose_mutations), 1)

    def test_two_services_restore_in_reverse_and_partial_failure_is_retryable(self):
        prior_nfc = image_id("prior-nfc")
        prior_barcode = image_id("prior-barcode")
        self.fake.add_container("nfc-agent", prior_nfc, running=True)
        self.fake.add_container("barcode-agent", prior_barcode, running=True)
        captured = self.capture(services=["nfc-agent", "barcode-agent"])
        self.candidate("nfc-agent", "candidate")
        self.candidate("barcode-agent", "candidate")
        self.fake.fail_compose_once["nfc-agent"] = 1
        start = len(self.fake.calls)

        with self.assertRaisesRegex(MODULE.RuntimeManifestError, "fake runtime"):
            self.restore(captured["manifestSha256"])
        compose_services = [
            call[-1]
            for call in self.fake.calls[start:]
            if call[:2] == ["docker", "compose"] and "config" not in call
        ]
        self.assertEqual(compose_services, ["barcode-agent", "nfc-agent"])
        self.assertEqual(
            self.fake.containers[(self.compose["project"], "barcode-agent")]["imageId"],
            prior_barcode,
        )
        self.assertFalse(
            (self.storage / self.run_id / self.host / "restored.json").exists()
        )

        self.restore(captured["manifestSha256"])
        self.assertEqual(
            self.fake.containers[(self.compose["project"], "nfc-agent")]["imageId"],
            prior_nfc,
        )
        self.assertEqual(
            self.fake.containers[(self.compose["project"], "barcode-agent")]["imageId"],
            prior_barcode,
        )

    def test_lost_capture_result_retries_identically_but_changed_request_fails(self):
        self.fake.add_container("nfc-agent", image_id("prior-retry"), running=True)
        first = self.capture(services=["nfc-agent"])
        self.fake.calls.clear()

        repeated = self.capture(services=["nfc-agent"])

        self.assertEqual(repeated, first)
        self.assertEqual(self.fake.mutation_calls, [])
        with self.assertRaisesRegex(MODULE.RuntimeManifestError, "different Docker request"):
            self.capture(services=["barcode-agent"])
        changed_config = self.working / "compose.override.yml"
        changed_config.write_text("services: {}\n", encoding="utf-8")
        with self.assertRaisesRegex(MODULE.RuntimeManifestError, "different Compose context"):
            MODULE.capture(
                root=self.storage,
                run_id=self.run_id,
                host=self.host,
                units=[],
                docker_services=["nfc-agent"],
                compose_project=self.compose["project"],
                compose_working_directory=self.compose["workingDirectory"],
                compose_config_files=[changed_config],
            )

    def test_partial_tag_failure_removes_only_tags_created_by_that_attempt(self):
        self.fake.add_container("nfc-agent", image_id("prior-tag-nfc"), running=True)
        self.fake.add_container(
            "barcode-agent", image_id("prior-tag-barcode"), running=True
        )
        self.fake.fail_tag_service_once["barcode-agent"] = 1

        with self.assertRaisesRegex(MODULE.RuntimeManifestError, "fake runtime"):
            self.capture(services=["nfc-agent", "barcode-agent"])

        self.assertFalse(self.manifest_path.exists())
        self.assertFalse(
            any(reference.startswith("raspi-rollback/") for reference in self.fake.images)
        )
        removed = [
            call[-1]
            for call in self.fake.calls
            if call[:3] == ["docker", "image", "rm"]
        ]
        self.assertEqual(len(removed), 1)

    def test_missing_old_image_preflight_causes_zero_mutation(self):
        self.fake.add_unit("kiosk-browser.service")
        self.fake.add_container("nfc-agent", image_id("prior"), running=True)
        captured = self.capture(
            services=["nfc-agent"], units=["kiosk-browser.service"]
        )
        manifest = json.loads(self.manifest_path.read_text(encoding="utf-8"))
        del self.fake.images[manifest["docker"][0]["rollbackTag"]]
        self.candidate("nfc-agent")
        self.fake.units["kiosk-browser.service"].update(
            {"UnitFileState": "disabled", "ActiveState": "inactive"}
        )
        self.fake.calls.clear()

        with self.assertRaisesRegex(MODULE.RuntimeManifestError, "image is unavailable"):
            self.restore(captured["manifestSha256"])
        self.assertEqual(self.fake.mutation_calls, [])
        self.assertEqual(
            self.fake.units["kiosk-browser.service"]["ActiveState"], "inactive"
        )

    def test_kiosk_web_activation_is_manifest_bound_deterministic_and_idempotent(self):
        self.fake.add_unit("kiosk-browser.service", active="active")
        captured = self.capture(units=["kiosk-browser.service"])

        first = MODULE.activate_kiosk_web(
            root=self.storage,
            run_id=self.run_id,
            host=self.host,
            expected_manifest_sha256=captured["manifestSha256"],
        )
        repeated = MODULE.activate_kiosk_web(
            root=self.storage,
            run_id=self.run_id,
            host=self.host,
            expected_manifest_sha256=captured["manifestSha256"],
        )

        expected_unit = MODULE.kiosk_web_activation_unit_name(
            self.run_id, self.host
        )
        self.assertEqual(first, repeated)
        self.assertEqual(first["state"], "succeeded")
        self.assertEqual(first["operationUnit"], expected_unit)
        submissions = [call for call in self.fake.calls if call[0] == "systemd-run"]
        self.assertEqual(len(submissions), 1)
        self.assertIn(f"--unit={expected_unit}", submissions[0])
        self.assertEqual(
            submissions[0][-3:],
            ["/usr/bin/systemctl", "restart", "kiosk-browser.service"],
        )

    def test_kiosk_web_activation_rejects_unsealed_or_inactive_target_without_mutation(self):
        self.fake.add_unit("status-agent.timer", active="active")
        captured = self.capture(units=["status-agent.timer"])
        self.fake.calls.clear()
        with self.assertRaisesRegex(
            MODULE.RuntimeManifestError, "target is not sealed"
        ):
            MODULE.activate_kiosk_web(
                root=self.storage,
                run_id=self.run_id,
                host=self.host,
                expected_manifest_sha256=captured["manifestSha256"],
            )
        self.assertEqual(self.fake.mutation_calls, [])

        other_run = "run-inactive"
        self.fake.add_unit("kiosk-browser.service", active="inactive")
        inactive = self.capture(
            units=["kiosk-browser.service"], run_id=other_run
        )
        self.fake.calls.clear()
        with self.assertRaisesRegex(
            MODULE.RuntimeManifestError, "was not active"
        ):
            MODULE.activate_kiosk_web(
                root=self.storage,
                run_id=other_run,
                host=self.host,
                expected_manifest_sha256=inactive["manifestSha256"],
            )
        self.assertEqual(self.fake.mutation_calls, [])

    def test_kiosk_web_activation_cleanup_requires_quiescence_and_unloads_exact_unit(self):
        self.fake.add_unit("kiosk-browser.service", active="active")
        captured = self.capture(units=["kiosk-browser.service"])
        MODULE.activate_kiosk_web(
            root=self.storage,
            run_id=self.run_id,
            host=self.host,
            expected_manifest_sha256=captured["manifestSha256"],
        )
        operation_unit = MODULE.kiosk_web_activation_unit_name(
            self.run_id, self.host
        )
        self.fake.activation_units[operation_unit].update(
            {"ActiveState": "activating", "SubState": "start"}
        )
        with self.assertRaisesRegex(MODULE.RuntimeManifestError, "still running"):
            MODULE.cleanup_kiosk_web_activation(
                root=self.storage,
                run_id=self.run_id,
                host=self.host,
                expected_manifest_sha256=captured["manifestSha256"],
            )

        self.fake.activation_units[operation_unit].update(
            {"ActiveState": "active", "SubState": "exited"}
        )
        cleaned = MODULE.cleanup_kiosk_web_activation(
            root=self.storage,
            run_id=self.run_id,
            host=self.host,
            expected_manifest_sha256=captured["manifestSha256"],
        )
        self.assertTrue(cleaned["cleaned"])
        self.assertFalse(cleaned["alreadyClean"])
        self.assertNotIn(operation_unit, self.fake.activation_units)

    def test_read_only_preflight_reports_every_missing_rollback_image(self):
        self.fake.add_container("nfc-agent", image_id("prior-nfc"), running=True)
        self.fake.add_container(
            "barcode-agent", image_id("prior-barcode"), running=True
        )
        captured = self.capture(services=["nfc-agent", "barcode-agent"])
        manifest = json.loads(self.manifest_path.read_text(encoding="utf-8"))
        for record in manifest["docker"]:
            del self.fake.images[record["rollbackTag"]]
            self.candidate(record["service"])
        self.fake.calls.clear()

        result = MODULE.preflight_restore(
            root=self.storage,
            run_id=self.run_id,
            host=self.host,
            expected_manifest_sha256=captured["manifestSha256"],
        )

        self.assertFalse(result["ready"])
        self.assertEqual(len(result["issues"]), 2)
        self.assertIn("docker nfc-agent", "\n".join(result["issues"]))
        self.assertIn("docker barcode-agent", "\n".join(result["issues"]))
        self.assertEqual(self.fake.mutation_calls, [])

    def test_systemd_enabled_active_state_and_daemon_reload_are_restored(self):
        self.fake.add_unit("kiosk-browser.service", unit_file="enabled", active="active")
        captured = self.capture(units=["kiosk-browser.service"])
        self.fake.units["kiosk-browser.service"].update(
            {"UnitFileState": "disabled", "ActiveState": "failed"}
        )

        self.restore(captured["manifestSha256"])

        self.assertEqual(
            self.fake.units["kiosk-browser.service"],
            {
                "LoadState": "loaded",
                "UnitFileState": "enabled",
                "ActiveState": "active",
            },
        )
        self.assertIn(["systemctl", "daemon-reload"], self.fake.calls)

    def test_preflight_and_repeat_restore_reconcile_after_durable_receipt(self):
        self.fake.add_unit(
            "kiosk-browser.service", unit_file="enabled", active="active"
        )
        captured = self.capture(
            units=["kiosk-browser.service"],
            restart_on_restore_units=["kiosk-browser.service"],
        )
        self.restore(captured["manifestSha256"])
        receipt = self.storage / self.run_id / self.host / "restored.json"
        receipt_before = receipt.read_bytes()

        # Replaying the sealed file manifest atomically replaces the unit file.
        # systemd then reports NeedDaemonReload=yes even though a prior runtime
        # restore already wrote its durable receipt.
        self.fake.unit_needs_reload.add("kiosk-browser.service")
        self.fake.calls.clear()

        preflight = MODULE.preflight_restore(
            root=self.storage,
            run_id=self.run_id,
            host=self.host,
            expected_manifest_sha256=captured["manifestSha256"],
        )

        self.assertTrue(preflight["ready"])
        self.assertTrue(preflight["restoredReceipt"])
        self.assertTrue(preflight["requiresRuntimeReconciliation"])
        self.assertEqual(preflight["issues"], [])
        self.assertEqual(self.fake.mutation_calls, [])

        repeated = self.restore(captured["manifestSha256"])

        self.assertTrue(repeated["restored"])
        self.assertIn(["systemctl", "daemon-reload"], self.fake.calls)
        self.assertEqual(receipt.read_bytes(), receipt_before)
        self.assertNotIn("kiosk-browser.service", self.fake.unit_needs_reload)

    def test_preflight_treats_periodic_oneshot_transition_as_reconciliation(self):
        self.fake.add_unit(
            "status-agent.service", unit_file="enabled", active="inactive"
        )
        captured = self.capture(units=["status-agent.service"])
        self.fake.units["status-agent.service"]["ActiveState"] = "activating"
        self.fake.calls.clear()

        preflight = MODULE.preflight_restore(
            root=self.storage,
            run_id=self.run_id,
            host=self.host,
            expected_manifest_sha256=captured["manifestSha256"],
        )

        self.assertTrue(preflight["ready"])
        self.assertTrue(preflight["requiresRuntimeReconciliation"])
        self.assertEqual(preflight["issues"], [])
        self.assertEqual(self.fake.mutation_calls, [])

    def test_restore_quiesces_timer_before_periodic_oneshot_transition(self):
        units = [
            "status-agent.service",
            "status-agent.timer",
            "signage-lite-update.service",
            "signage-lite-update.timer",
        ]
        for unit in units:
            self.fake.add_unit(
                unit,
                unit_file=("enabled" if unit.endswith(".timer") else "static"),
                active=("active" if unit.endswith(".timer") else "inactive"),
            )
        captured = self.capture(units=units)
        self.fake.units["status-agent.service"]["ActiveState"] = "activating"
        self.fake.units["signage-lite-update.service"][
            "ActiveState"
        ] = "activating"
        self.fake.unit_needs_reload.update(units)
        self.fake.calls.clear()

        restored = self.restore(captured["manifestSha256"])

        self.assertTrue(restored["restored"])
        stop_calls = [
            call[-1]
            for call in self.fake.mutation_calls
            if call[:2] == ["systemctl", "stop"]
        ]
        self.assertEqual(
            stop_calls[:4],
            [
                "signage-lite-update.timer",
                "status-agent.timer",
                "signage-lite-update.service",
                "status-agent.service",
            ],
        )
        self.assertEqual(
            self.fake.units["status-agent.service"]["ActiveState"], "inactive"
        )
        self.assertEqual(
            self.fake.units["signage-lite-update.service"]["ActiveState"],
            "inactive",
        )
        self.assertEqual(
            self.fake.units["status-agent.timer"]["ActiveState"], "active"
        )
        self.assertEqual(
            self.fake.units["signage-lite-update.timer"]["ActiveState"], "active"
        )

    def test_restore_clears_failed_state_left_by_intentional_service_stop(self):
        self.fake.add_unit(
            "signage-lite.service", unit_file="enabled", active="active"
        )
        captured = self.capture(
            units=["signage-lite.service"],
            restart_on_restore_units=["signage-lite.service"],
        )
        self.fake.unit_needs_reload.add("signage-lite.service")
        self.fake.stop_results_failed.add("signage-lite.service")
        self.fake.calls.clear()

        restored = self.restore(captured["manifestSha256"])

        self.assertTrue(restored["restored"])
        mutations = self.fake.mutation_calls
        self.assertLess(
            mutations.index(["systemctl", "stop", "signage-lite.service"]),
            mutations.index(
                ["systemctl", "reset-failed", "signage-lite.service"]
            ),
        )
        self.assertLess(
            mutations.index(
                ["systemctl", "reset-failed", "signage-lite.service"]
            ),
            mutations.index(["systemctl", "daemon-reload"]),
        )
        self.assertEqual(
            self.fake.units["signage-lite.service"]["ActiveState"], "active"
        )

    def test_restore_accepts_timer_owned_oneshot_postflight_transition(self):
        units = ["status-agent.service", "status-agent.timer"]
        self.fake.add_unit(
            "status-agent.service", unit_file="enabled", active="inactive"
        )
        self.fake.add_unit(
            "status-agent.timer", unit_file="enabled", active="active"
        )
        captured = self.capture(units=units)
        self.fake.unit_needs_reload.update(units)
        self.fake.timer_start_transitions["status-agent.timer"] = [
            "status-agent.service"
        ]
        self.fake.calls.clear()

        restored = self.restore(captured["manifestSha256"])

        self.assertTrue(restored["restored"])
        self.assertEqual(
            self.fake.units["status-agent.service"]["ActiveState"],
            "activating",
        )
        self.assertEqual(
            self.fake.units["status-agent.timer"]["ActiveState"], "active"
        )
        self.assertTrue(
            (self.storage / self.run_id / self.host / "restored.json").exists()
        )

    def test_full_pi3_restore_retries_every_mutation_boundary(self):
        units = [
            "lightdm.service",
            "status-agent.service",
            "status-agent.timer",
            "haizen-agent.service",
            "signage-lite.service",
            "signage-lite-update.service",
            "signage-lite-update.timer",
            "signage-lite-watchdog.service",
            "signage-lite-watchdog.timer",
            "signage-daily-reboot.service",
            "signage-daily-reboot.timer",
        ]
        active_services = {"lightdm.service", "signage-lite.service"}
        timers = {unit for unit in units if unit.endswith(".timer")}
        transient_oneshots = set(MODULE.TRANSIENT_ONESHOT_UNITS)
        for unit in units:
            if unit == "haizen-agent.service":
                self.fake.add_unit(
                    unit,
                    load="not-found",
                    unit_file="not-found",
                    active="inactive",
                )
            else:
                self.fake.add_unit(
                    unit,
                    unit_file=(
                        "enabled"
                        if unit in active_services or unit in timers
                        else "static"
                    ),
                    active=(
                        "active"
                        if unit in active_services or unit in timers
                        else "inactive"
                    ),
                )
        captured = self.capture(
            units=units,
            restart_on_restore_units=[
                "haizen-agent.service",
                "signage-lite.service",
            ],
        )

        # Replay every Pi3 condition observed across the four production
        # failures at once instead of proving each correction in isolation.
        self.fake.unit_needs_reload.update(units)
        self.fake.stop_results_failed.add("signage-lite.service")
        for oneshot in transient_oneshots:
            self.fake.units[oneshot]["ActiveState"] = "activating"
        for oneshot, owner_timer in MODULE.TRANSIENT_ONESHOT_TIMER_BY_UNIT.items():
            self.fake.timer_start_transitions[owner_timer] = [oneshot]
        incident_start = self.fake.clone()
        incident_start.calls.clear()

        golden = incident_start.clone()
        with mock.patch.object(MODULE, "_run_command", golden.run):
            restored = self.restore(captured["manifestSha256"])
        self.assertTrue(restored["restored"])
        mutation_count = golden.mutation_ordinal
        self.assertEqual(mutation_count, 18)
        receipt = self.storage / self.run_id / self.host / "restored.json"
        receipt.unlink()

        for failure_side in ("before", "after"):
            for ordinal in range(1, mutation_count + 1):
                with self.subTest(failure_side=failure_side, ordinal=ordinal):
                    fake = incident_start.clone()
                    setattr(fake, f"fail_mutation_{failure_side}", ordinal)
                    with mock.patch.object(MODULE, "_run_command", fake.run):
                        with self.assertRaisesRegex(
                            MODULE.RuntimeManifestError,
                            f"injected failure {failure_side} runtime mutation",
                        ):
                            self.restore(captured["manifestSha256"])
                        self.assertFalse(receipt.exists())

                        repeated = self.restore(captured["manifestSha256"])
                        self.assertTrue(repeated["restored"])
                        self.assertTrue(receipt.exists())

                        # Model normal completion of the timer-owned oneshots,
                        # then prove the receipt and complete runtime are a
                        # stable no-reconciliation result.
                        for oneshot in transient_oneshots:
                            fake.units[oneshot]["ActiveState"] = "inactive"
                        preflight = MODULE.preflight_restore(
                            root=self.storage,
                            run_id=self.run_id,
                            host=self.host,
                            expected_manifest_sha256=captured["manifestSha256"],
                        )
                        self.assertTrue(preflight["ready"])
                        self.assertTrue(preflight["restoredReceipt"])
                        self.assertFalse(preflight["requiresRuntimeReconciliation"])
                    receipt.unlink()

    def test_restore_rejects_oneshot_transition_without_reactivated_owner_timer(self):
        units = ["status-agent.service", "signage-lite.service"]
        self.fake.add_unit(
            "status-agent.service", unit_file="enabled", active="inactive"
        )
        self.fake.add_unit(
            "signage-lite.service", unit_file="enabled", active="active"
        )
        captured = self.capture(
            units=units,
            restart_on_restore_units=["signage-lite.service"],
        )
        self.fake.unit_needs_reload.update(units)
        self.fake.timer_start_transitions["signage-lite.service"] = [
            "status-agent.service"
        ]
        self.fake.calls.clear()

        with self.assertRaisesRegex(
            MODULE.RuntimeManifestError,
            "systemd postflight verification failed",
        ):
            self.restore(captured["manifestSha256"])

        self.assertFalse(
            (self.storage / self.run_id / self.host / "restored.json").exists()
        )

    def test_capture_normalizes_real_systemd_missing_unit_output(self):
        self.fake.add_unit(
            "haizen-agent.service",
            load="not-found",
            unit_file="",
            active="inactive",
        )

        self.capture(units=["haizen-agent.service"])

        manifest = json.loads(self.manifest_path.read_text(encoding="utf-8"))
        self.assertEqual(
            manifest["units"],
            [
                {
                    "name": "haizen-agent.service",
                    "loadState": "not-found",
                    "unitFileState": "not-found",
                    "activeState": "inactive",
                    "persistent": None,
                }
            ],
        )
        self.assertEqual(self.fake.mutation_calls, [])

    def test_capture_rejects_empty_unit_file_state_for_loaded_unit(self):
        self.fake.add_unit(
            "haizen-agent.service",
            load="loaded",
            unit_file="",
            active="inactive",
        )

        with self.assertRaisesRegex(
            MODULE.RuntimeManifestError, "unit-file state is unsupported"
        ):
            self.capture(units=["haizen-agent.service"])

        self.assertFalse(self.manifest_path.exists())
        self.assertEqual(self.fake.mutation_calls, [])

    def test_unchanged_lightdm_is_not_cycled_when_release_unit_needs_reload(self):
        self.fake.add_unit("lightdm.service", unit_file="enabled", active="active")
        self.fake.add_unit(
            "kiosk-browser.service", unit_file="enabled", active="active"
        )
        self.fake.add_unit(
            "signage-daily-reboot.timer",
            unit_file="enabled",
            active="active",
            persistent=True,
        )
        captured = self.capture(
            units=[
                "lightdm.service",
                "kiosk-browser.service",
                "signage-daily-reboot.timer",
            ]
        )
        # The sealed file manifest has restored the kiosk unit on disk, while
        # systemd still has the release definition loaded.  lightdm was not
        # touched by the release and must keep its existing GUI session.
        self.fake.unit_needs_reload.add("kiosk-browser.service")
        self.fake.calls.clear()

        self.restore(captured["manifestSha256"])

        transitions = [
            call
            for call in self.fake.mutation_calls
            if call[0] == "systemctl" and call[1] in {"start", "stop"}
        ]
        self.assertEqual(
            transitions,
            [
                ["systemctl", "stop", "signage-daily-reboot.timer"],
                ["systemctl", "stop", "kiosk-browser.service"],
                ["systemctl", "start", "kiosk-browser.service"],
                ["systemctl", "start", "signage-daily-reboot.timer"],
            ],
        )
        self.assertFalse(
            any(call[-1] == "lightdm.service" for call in transitions)
        )
        self.assertIn(["systemctl", "daemon-reload"], self.fake.mutation_calls)
        self.assertEqual(
            self.fake.units["lightdm.service"]["ActiveState"], "active"
        )
        self.assertEqual(
            self.fake.units["kiosk-browser.service"]["ActiveState"], "active"
        )

    def test_sealed_active_release_service_restarts_after_file_manifest_restore(self):
        self.fake.add_unit(
            "kiosk-browser.service", unit_file="enabled", active="active"
        )
        captured = self.capture(
            units=["kiosk-browser.service"],
            restart_on_restore_units=["kiosk-browser.service"],
        )
        payload_revision = "old-script"
        running_revision = {"value": "candidate-script"}
        self.fake.calls.clear()

        def tracked_run(argv, *, allowed_exit_codes=(0,)):
            call = list(argv)
            result = self.fake.run(call, allowed_exit_codes=allowed_exit_codes)
            if call[:2] == ["systemctl", "stop"] and call[-1] == "kiosk-browser.service":
                running_revision["value"] = "stopped"
            if call[:2] == ["systemctl", "start"] and call[-1] == "kiosk-browser.service":
                running_revision["value"] = payload_revision
            return result

        with mock.patch.object(MODULE, "_run_command", tracked_run):
            self.restore(captured["manifestSha256"])

        transitions = [
            call
            for call in self.fake.mutation_calls
            if call[:2] in (["systemctl", "stop"], ["systemctl", "start"])
        ]
        self.assertEqual(
            transitions,
            [
                ["systemctl", "stop", "kiosk-browser.service"],
                ["systemctl", "start", "kiosk-browser.service"],
            ],
        )
        self.assertEqual(running_revision["value"], "old-script")

        mutation_count = len(self.fake.mutation_calls)
        self.restore(captured["manifestSha256"])
        self.assertEqual(len(self.fake.mutation_calls), mutation_count)

    def test_systemd_runtime_enablement_and_mask_are_restored_exactly(self):
        self.fake.add_unit(
            "status-agent.timer", unit_file="enabled-runtime", active="active"
        )
        self.fake.add_unit(
            "signage-lite.service",
            load="masked",
            unit_file="masked-runtime",
            active="inactive",
        )
        captured = self.capture(
            units=["status-agent.timer", "signage-lite.service"]
        )
        self.fake.units["status-agent.timer"].update(
            {"UnitFileState": "enabled", "ActiveState": "inactive"}
        )
        self.fake.units["signage-lite.service"].update(
            {
                "LoadState": "loaded",
                "UnitFileState": "enabled",
                "ActiveState": "active",
            }
        )

        self.restore(captured["manifestSha256"])

        self.assertEqual(
            self.fake.units["status-agent.timer"],
            {
                "LoadState": "loaded",
                "UnitFileState": "enabled-runtime",
                "ActiveState": "active",
            },
        )
        self.assertEqual(
            self.fake.units["signage-lite.service"],
            {
                "LoadState": "masked",
                "UnitFileState": "masked-runtime",
                "ActiveState": "inactive",
            },
        )

    def test_capture_rejects_active_transient_oneshots_until_they_quiesce(self):
        oneshots = {
            "status-agent.service",
            "signage-lite-update.service",
            "signage-lite-watchdog.service",
            "signage-daily-reboot.service",
        }
        self.assertEqual(MODULE.TRANSIENT_ONESHOT_UNITS, oneshots)
        for unit in sorted(oneshots):
            self.fake.add_unit(unit, unit_file="static", active="inactive")

        for active_unit in sorted(oneshots):
            with self.subTest(active_unit=active_unit):
                self.fake.units[active_unit]["ActiveState"] = "active"
                self.fake.calls.clear()
                with mock.patch.object(MODULE.time, "sleep") as sleep:
                    with self.assertRaisesRegex(
                        MODULE.RuntimeManifestError,
                        "transient oneshot unit did not quiesce before runtime capture",
                    ):
                        self.capture(units=sorted(oneshots))
                self.assertEqual(
                    sleep.call_count,
                    MODULE.TRANSIENT_ONESHOT_STABILIZATION_ATTEMPTS - 1,
                )
                self.assertFalse(self.manifest_path.exists())
                self.assertEqual(self.fake.mutation_calls, [])
                self.fake.units[active_unit]["ActiveState"] = "inactive"

        captured = self.capture(units=sorted(oneshots))
        self.assertTrue(self.manifest_path.exists())
        self.assertEqual(captured["unitCount"], len(oneshots))

    def test_capture_waits_for_transient_oneshot_to_quiesce_before_sealing(self):
        unit = "status-agent.service"
        self.fake.add_unit(unit, unit_file="static", active="activating")
        self.fake.unit_show_transitions[unit] = ["inactive"]

        with mock.patch.object(MODULE.time, "sleep") as sleep:
            captured = self.capture(units=[unit])

        self.assertEqual(captured["unitCount"], 1)
        self.assertEqual(sleep.call_count, 1)
        self.assertEqual(
            self.fake.units[unit]["ActiveState"], "inactive"
        )
        self.assertEqual(self.fake.mutation_calls, [])

    def test_sealed_active_transient_oneshot_is_rejected_before_restore(self):
        self.fake.add_unit(
            "signage-daily-reboot.service", unit_file="static", active="inactive"
        )
        self.capture(units=["signage-daily-reboot.service"])
        manifest = json.loads(self.manifest_path.read_text(encoding="utf-8"))
        manifest["units"][0]["activeState"] = "active"
        forged = MODULE._seal(manifest, "manifestSha256")
        self.manifest_path.write_text(json.dumps(forged), encoding="utf-8")
        self.fake.calls.clear()

        with self.assertRaisesRegex(
            MODULE.RuntimeManifestError,
            "transient oneshot unit cannot be sealed as active runtime state",
        ):
            self.restore(forged["manifestSha256"])
        self.assertEqual(self.fake.mutation_calls, [])

    def test_systemd_restore_quiesces_all_units_and_starts_timers_last(self):
        units = [
            "signage-lite-update.timer",
            "signage-lite-update.service",
            "signage-lite.service",
            "signage-lite-watchdog.timer",
            "signage-daily-reboot.timer",
        ]
        for unit in units:
            self.fake.add_unit(
                unit,
                unit_file="enabled",
                active=("inactive" if unit.endswith("update.service") else "active"),
            )
        captured = self.capture(units=units)
        for unit in units:
            self.fake.units[unit].update(
                {"UnitFileState": "disabled", "ActiveState": "failed"}
            )
        self.fake.calls.clear()

        self.restore(captured["manifestSha256"])

        mutations = self.fake.mutation_calls
        stop_indexes = [
            index
            for index, call in enumerate(mutations)
            if call[:2] == ["systemctl", "stop"]
        ]
        start_calls = [
            (index, call[-1])
            for index, call in enumerate(mutations)
            if call[:2] == ["systemctl", "start"]
        ]
        self.assertTrue(stop_indexes)
        self.assertTrue(start_calls)
        self.assertLess(max(stop_indexes), min(index for index, _unit in start_calls))
        daemon_reload_index = next(
            index
            for index, call in enumerate(mutations)
            if call == ["systemctl", "daemon-reload"]
        )
        self.assertLess(max(stop_indexes), daemon_reload_index)
        self.assertLess(daemon_reload_index, min(index for index, _unit in start_calls))
        stop_units = [
            call[-1]
            for call in mutations
            if call[:2] == ["systemctl", "stop"]
        ]
        self.assertEqual(
            stop_units[:3],
            [
                "signage-daily-reboot.timer",
                "signage-lite-watchdog.timer",
                "signage-lite-update.timer",
            ],
        )
        self.assertTrue(all(unit.endswith(".timer") for unit in stop_units[:3]))
        self.assertTrue(all(not unit.endswith(".timer") for unit in stop_units[3:]))
        self.assertEqual(
            [unit for _index, unit in start_calls],
            [
                "signage-lite.service",
                "signage-daily-reboot.timer",
                "signage-lite-watchdog.timer",
                "signage-lite-update.timer",
            ],
        )
        first_timer_start = min(
            index for index, unit in start_calls if unit.endswith(".timer")
        )
        self.assertTrue(
            all(
                index < first_timer_start
                for index, unit in start_calls
                if not unit.endswith(".timer")
            )
        )
        self.assertEqual(
            self.fake.units["signage-lite-update.service"]["ActiveState"],
            "inactive",
        )

    def test_compose_config_preflight_precedes_reference_mutation_and_never_pulls(self):
        self.fake.add_container("nfc-agent", image_id("prior-config"), running=True)
        self.fake.fail_compose_config_once = 1
        with self.assertRaisesRegex(MODULE.RuntimeManifestError, "fake runtime"):
            self.capture(services=["nfc-agent"])
        self.assertFalse(self.manifest_path.exists())
        self.assertEqual(self.fake.mutation_calls, [])
        self.assertFalse(
            any(reference.startswith("raspi-rollback/") for reference in self.fake.images)
        )

        captured = self.capture(services=["nfc-agent"])
        self.candidate("nfc-agent", "candidate-config")
        self.fake.calls.clear()
        self.fake.fail_compose_config_once = 1

        with self.assertRaisesRegex(MODULE.RuntimeManifestError, "fake runtime"):
            self.restore(captured["manifestSha256"])
        self.assertEqual(self.fake.mutation_calls, [])

        self.fake.calls.clear()
        self.restore(captured["manifestSha256"])
        config_index = next(
            index
            for index, call in enumerate(self.fake.calls)
            if call[:2] == ["docker", "compose"] and "config" in call
        )
        retag_index = next(
            index
            for index, call in enumerate(self.fake.calls)
            if call[:2] == ["docker", "tag"]
        )
        self.assertLess(config_index, retag_index)
        pull_arguments = [
            call[call.index("--pull") + 1]
            for call in self.fake.calls
            if "--pull" in call
        ]
        self.assertEqual(pull_arguments, ["never"])

    def test_docker_api_failure_is_not_misclassified_as_a_missing_image(self):
        self.fake.add_container("nfc-agent", image_id("prior-api"), running=True)
        captured = self.capture(services=["nfc-agent"])
        self.candidate("nfc-agent", "candidate-api")
        self.fake.calls.clear()
        self.fake.fail_image_list_once = 1

        with self.assertRaisesRegex(MODULE.RuntimeManifestError, "fake runtime"):
            self.restore(captured["manifestSha256"])
        self.assertEqual(self.fake.mutation_calls, [])

        self.fake.fail_image_list_once = 1
        with self.assertRaisesRegex(MODULE.RuntimeManifestError, "fake runtime"):
            MODULE.cleanup(
                root=self.storage,
                run_id=self.run_id,
                host=self.host,
                expected_manifest_sha256=captured["manifestSha256"],
                outcome="committed",
            )
        cleanup_started = self.storage / self.run_id / self.host / "cleanup-started.json"
        self.assertFalse(cleanup_started.exists())

        cleaned = MODULE.cleanup(
            root=self.storage,
            run_id=self.run_id,
            host=self.host,
            expected_manifest_sha256=captured["manifestSha256"],
            outcome="committed",
        )
        self.assertFalse(cleaned["alreadyClean"])
        self.fake.fail_image_list_once = 1
        with self.assertRaisesRegex(MODULE.RuntimeManifestError, "fake runtime"):
            MODULE.cleanup(
                root=self.storage,
                run_id=self.run_id,
                host=self.host,
                expected_manifest_sha256=captured["manifestSha256"],
                outcome="committed",
            )
        repeated = MODULE.cleanup(
            root=self.storage,
            run_id=self.run_id,
            host=self.host,
            expected_manifest_sha256=captured["manifestSha256"],
            outcome="committed",
        )
        self.assertTrue(repeated["alreadyClean"])

    def test_security_runtime_digest_hides_commands_and_rejects_privilege_drift(self):
        self.fake.service_security["nfc-agent"]["command"] = [
            "/usr/local/bin/nfc-agent",
            "SECRET-RUNTIME-ARGUMENT",
        ]
        self.fake.add_container("nfc-agent", image_id("prior-security"), running=True)
        captured = self.capture(services=["nfc-agent"])
        manifest_text = self.manifest_path.read_text(encoding="utf-8")
        manifest = json.loads(manifest_text)
        self.assertRegex(
            manifest["docker"][0]["runtimeSecuritySha256"], r"^[0-9a-f]{64}$"
        )
        self.assertNotIn("SECRET-RUNTIME-ARGUMENT", manifest_text)
        self.assertNotIn('"privileged"', manifest_text)

        self.candidate("nfc-agent", "candidate-security")
        self.fake.service_security["nfc-agent"]["privileged"] = True
        with self.assertRaisesRegex(
            MODULE.RuntimeManifestError, "sealed runtime state"
        ):
            self.restore(captured["manifestSha256"])
        restored = self.fake.containers[(self.compose["project"], "nfc-agent")]
        self.assertTrue(restored["security"]["privileged"])

    def test_fixed_command_environment_ignores_caller_runtime_routing(self):
        observed: dict[str, str] = {}

        def run_process(argv, **kwargs):
            observed.update(kwargs["env"])
            kwargs["stdout"].write(b"")
            return subprocess.CompletedProcess(argv, 0)

        poisoned = {
            "PATH": "/tmp/attacker-bin",
            "DOCKER_HOST": "tcp://attacker.invalid:2375",
            "DOCKER_CONTEXT": "attacker",
            "COMPOSE_FILE": "/tmp/attacker-compose.yml",
            "COMPOSE_PROJECT_NAME": "attacker",
            "DBUS_SYSTEM_BUS_ADDRESS": "unix:path=/tmp/attacker-bus",
            "SECRET_FROM_CALLER": "must-not-leak",
        }
        with mock.patch.dict(os.environ, poisoned, clear=False), mock.patch.object(
            MODULE.subprocess, "run", side_effect=run_process
        ):
            ORIGINAL_RUN_COMMAND(["systemctl", "daemon-reload"])

        self.assertEqual(
            observed,
            {
                "PATH": MODULE.SAFE_COMMAND_PATH,
                "LANG": "C",
                "LC_ALL": "C",
            },
        )

    def test_systemd_only_manifest_cannot_capture_or_restore_after_cleanup(self):
        self.fake.add_unit("lightdm.service", unit_file="enabled", active="active")
        captured = self.capture(units=["lightdm.service"])
        cleaned = MODULE.cleanup(
            root=self.storage,
            run_id=self.run_id,
            host=self.host,
            expected_manifest_sha256=captured["manifestSha256"],
            outcome="committed",
        )
        self.assertEqual(cleaned["tagCount"], 0)
        self.fake.calls.clear()

        with self.assertRaisesRegex(MODULE.RuntimeManifestError, "cleanup has started"):
            self.capture(units=["lightdm.service"])
        with self.assertRaisesRegex(MODULE.RuntimeManifestError, "cleanup has started"):
            self.restore(captured["manifestSha256"])
        self.assertEqual(self.fake.mutation_calls, [])

        repeated = MODULE.cleanup(
            root=self.storage,
            run_id=self.run_id,
            host=self.host,
            expected_manifest_sha256=captured["manifestSha256"],
            outcome="committed",
        )
        self.assertTrue(repeated["alreadyClean"])

    def test_manifest_survives_fresh_runner_and_restore_receipt_is_durable(self):
        prior = image_id("prior-crash")
        self.fake.add_container("barcode-agent", prior, running=True)
        captured = self.capture(services=["barcode-agent"])
        fresh = self.fake.clone()
        fresh.add_container("barcode-agent", image_id("candidate-crash"), running=True)

        with mock.patch.object(MODULE, "_run_command", fresh.run):
            result = self.restore(captured["manifestSha256"])

        self.assertTrue(result["restored"])
        self.assertEqual(
            fresh.containers[(self.compose["project"], "barcode-agent")]["imageId"],
            prior,
        )
        receipt = self.storage / self.run_id / self.host / "restored.json"
        self.assertTrue(receipt.exists())
        self.assertEqual(stat.S_IMODE(receipt.stat().st_mode), 0o600)

    def test_tamper_wrong_digest_duplicate_json_and_identity_fail_closed(self):
        self.fake.add_unit("lightdm.service", unit_file="enabled", active="active")
        captured = self.capture(units=["lightdm.service"])
        self.fake.units["lightdm.service"]["ActiveState"] = "inactive"
        self.fake.calls.clear()

        with self.assertRaisesRegex(MODULE.RuntimeManifestError, "expected sealed digest"):
            self.restore("0" * 64)
        self.assertEqual(self.fake.mutation_calls, [])

        original = self.manifest_path.read_text(encoding="utf-8")
        manifest = json.loads(original)
        manifest["units"][0]["activeState"] = "inactive"
        self.manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
        with self.assertRaisesRegex(MODULE.RuntimeManifestError, "integrity digest"):
            self.restore(captured["manifestSha256"])
        self.assertEqual(self.fake.mutation_calls, [])

        self.manifest_path.write_text(
            original.replace('"version": 2', '"version": 2, "version": 2', 1),
            encoding="utf-8",
        )
        with self.assertRaisesRegex(MODULE.RuntimeManifestError, "duplicate key"):
            self.restore(captured["manifestSha256"])
        self.assertEqual(self.fake.mutation_calls, [])

        self.manifest_path.write_text(
            original.replace('"version": 2', '"version": NaN', 1),
            encoding="utf-8",
        )
        with self.assertRaisesRegex(MODULE.RuntimeManifestError, "non-finite constant"):
            self.restore(captured["manifestSha256"])
        self.assertEqual(self.fake.mutation_calls, [])

        with self.assertRaisesRegex(MODULE.RuntimeManifestError, "run ID is malformed"):
            MODULE.capture(
                root=self.storage,
                run_id="../escape",
                host=self.host,
                units=["lightdm.service"],
                docker_services=[],
            )

    def test_cleanup_requires_success_and_never_removes_changed_tag(self):
        prior = image_id("prior-cleanup")
        self.fake.add_container("nfc-agent", prior, running=True)
        captured = self.capture(services=["nfc-agent"])
        manifest = json.loads(self.manifest_path.read_text(encoding="utf-8"))
        rollback_tag = manifest["docker"][0]["rollbackTag"]

        with self.assertRaisesRegex(MODULE.RuntimeManifestError, "verified restore"):
            MODULE.cleanup(
                root=self.storage,
                run_id=self.run_id,
                host=self.host,
                expected_manifest_sha256=captured["manifestSha256"],
                outcome="restored",
            )
        self.assertIn(rollback_tag, self.fake.images)

        self.candidate("nfc-agent")
        self.restore(captured["manifestSha256"])
        self.fake.images[rollback_tag] = image_id("tampered-tag")
        self.fake.calls.clear()
        with self.assertRaisesRegex(MODULE.RuntimeManifestError, "tag changed"):
            MODULE.cleanup(
                root=self.storage,
                run_id=self.run_id,
                host=self.host,
                expected_manifest_sha256=captured["manifestSha256"],
                outcome="restored",
            )
        self.assertFalse(
            any(call[:3] == ["docker", "image", "rm"] for call in self.fake.calls)
        )

    def test_committed_cleanup_is_explicit_verified_and_idempotent(self):
        prior = image_id("prior-forward-success")
        self.fake.add_container("barcode-agent", prior, running=True)
        captured = self.capture(services=["barcode-agent"])
        manifest = json.loads(self.manifest_path.read_text(encoding="utf-8"))
        rollback_tag = manifest["docker"][0]["rollbackTag"]

        cleaned = MODULE.cleanup(
            root=self.storage,
            run_id=self.run_id,
            host=self.host,
            expected_manifest_sha256=captured["manifestSha256"],
            outcome="committed",
        )

        self.assertEqual(cleaned["outcome"], "committed")
        self.assertNotIn(rollback_tag, self.fake.images)
        self.assertFalse(
            (self.storage / self.run_id / self.host / "restored.json").exists()
        )
        mutation_count = len(self.fake.mutation_calls)
        repeated = MODULE.cleanup(
            root=self.storage,
            run_id=self.run_id,
            host=self.host,
            expected_manifest_sha256=captured["manifestSha256"],
            outcome="committed",
        )
        self.assertTrue(repeated["alreadyClean"])
        self.assertEqual(len(self.fake.mutation_calls), mutation_count)

    def test_partial_cleanup_after_started_receipt_is_retryable(self):
        self.fake.add_container("nfc-agent", image_id("cleanup-nfc"), running=True)
        self.fake.add_container(
            "barcode-agent", image_id("cleanup-barcode"), running=True
        )
        captured = self.capture(services=["nfc-agent", "barcode-agent"])
        manifest = json.loads(self.manifest_path.read_text(encoding="utf-8"))
        tags = {record["service"]: record["rollbackTag"] for record in manifest["docker"]}
        self.fake.fail_image_rm_service_once["nfc-agent"] = 1

        with self.assertRaisesRegex(MODULE.RuntimeManifestError, "fake runtime"):
            MODULE.cleanup(
                root=self.storage,
                run_id=self.run_id,
                host=self.host,
                expected_manifest_sha256=captured["manifestSha256"],
                outcome="committed",
            )
        self.assertTrue(
            (self.storage / self.run_id / self.host / "cleanup-started.json").exists()
        )
        self.assertNotIn(tags["barcode-agent"], self.fake.images)
        self.assertIn(tags["nfc-agent"], self.fake.images)
        self.assertFalse(
            (self.storage / self.run_id / self.host / "cleanup.json").exists()
        )

        completed = MODULE.cleanup(
            root=self.storage,
            run_id=self.run_id,
            host=self.host,
            expected_manifest_sha256=captured["manifestSha256"],
            outcome="committed",
        )
        self.assertTrue(completed["cleaned"])
        self.assertNotIn(tags["nfc-agent"], self.fake.images)
        self.assertTrue(
            (self.storage / self.run_id / self.host / "cleanup.json").exists()
        )

    def test_cli_ansible_marker_contains_only_bounded_result(self):
        self.fake.add_unit("status-agent.timer", unit_file="enabled", active="active")
        output = io.StringIO()
        with redirect_stdout(output):
            status = MODULE.main(
                [
                    "capture",
                    "--root",
                    str(self.storage),
                    "--run-id",
                    self.run_id,
                    "--host",
                    self.host,
                    "--unit",
                    "status-agent.timer",
                    "--ansible-marker",
                ]
            )
        self.assertEqual(status, 0)
        line = output.getvalue().strip()
        self.assertTrue(line.startswith(MODULE.MARKER_PREFIX))
        decoded = base64.urlsafe_b64decode(
            line.removeprefix(MODULE.MARKER_PREFIX)
        )
        result = json.loads(decoded)
        self.assertEqual(result["unitCount"], 1)
        self.assertEqual(result["dockerCount"], 0)
        self.assertNotIn("units", result)

    def test_cli_error_marker_is_bounded_machine_readable_and_secret_free(self):
        secret = "DO-NOT-LEAK-SECRET"
        self.fake.service_host_config_extra["torque-agent"]["ExtraHosts"] = [
            f"{secret}:192.0.2.10"
        ]
        self.fake.add_container(
            "torque-agent", image_id("error-marker"), running=True
        )
        output = io.StringIO()
        with redirect_stdout(output):
            status = MODULE.main(
                [
                    "probe-capture",
                    "--run-id",
                    self.run_id,
                    "--host",
                    self.host,
                    "--docker-service",
                    "torque-agent",
                    "--compose-project",
                    self.compose["project"],
                    "--compose-working-directory",
                    self.compose["workingDirectory"],
                    "--compose-config-file",
                    self.compose["configFiles"][0],
                    "--ansible-marker",
                ]
            )

        self.assertEqual(status, 1)
        line = output.getvalue().strip()
        self.assertTrue(line.startswith(MODULE.ERROR_MARKER_PREFIX))
        self.assertNotIn(secret, line)
        payload = json.loads(
            base64.urlsafe_b64decode(
                line.removeprefix(MODULE.ERROR_MARKER_PREFIX)
            )
        )
        self.assertEqual(payload["code"], "runtime.unsupported-feature")
        self.assertLessEqual(len(payload["message"]), 512)


if __name__ == "__main__":
    unittest.main()
