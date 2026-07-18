#!/usr/bin/env python3
from __future__ import annotations

import io
import json
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from scripts.deploy.rolling_release import terminal_preflight
from scripts.deploy.rolling_release.terminal_preflight_contract import (
    TerminalPreflightContractError,
    build_target_contracts,
)


SHA = "a" * 40
RUN_ID = "20260718-120000-a1b2c3"


def target(host: str = "kiosk-a") -> dict[str, object]:
    return {
        "version": 1,
        "mode": "target",
        "host": host,
        "profile": "kiosk",
        "address": "100.64.0.10",
        "user": "kiosk-a",
        "port": 22,
        "repoPath": "/opt/RaspberryPiSystem_002",
        "memoryRequiredMb": 120,
        "tailscaleEnabled": True,
        "servicesToRestart": ["kiosk-browser.service"],
        "manageKioskBrowser": True,
        "kioskBrowserEngine": "firefox",
        "firefoxMinimizeChrome": True,
        "clamavEnabled": True,
        "clamavLogDir": "/var/log/clamav",
        "clamavCron": "0 3 * * 0",
        "rkhunterEnabled": True,
        "rkhunterLogDir": "/var/log/rkhunter",
        "rkhunterCron": "30 3 * * 0",
        "nfcEnabled": True,
        "nfcContractValid": True,
        "barcodeEnabled": False,
        "barcodeSerialDevice": "/dev/ttyACM0",
        "torqueEnabled": False,
        "torqueContractValid": True,
        "haizenEnabled": False,
        "haizenHidDevice": "/dev/input/event0",
        "haizenInstallEvdev": True,
        "manageSignage": False,
        "inventoryIssues": [],
    }


def candidate_success(argv, *, timeout):
    del timeout
    if "-t" not in argv:
        return subprocess.CompletedProcess(argv, 0, "", "")
    object_name = argv[-1]
    relative = object_name.split(":", 1)[1]
    expected = dict(
        terminal_preflight._candidate_artifact_contract([target()])
    ).get(relative, "blob")
    return subprocess.CompletedProcess(argv, 0, f"{expected}\n", "")


class TerminalPreflightTest(unittest.TestCase):
    def test_contract_builder_resolves_tailscale_address_and_omits_secrets(self):
        inventory = {
            "_meta": {
                "hostvars": {
                    "kiosk-a": {
                        "ansible_host": "{{ current_network.kiosk_a_ip | default(local_network.kiosk_a_ip) }}",
                        "ansible_user": "kiosk-a",
                        "network_mode": "tailscale",
                        "tailscale_network": {"kiosk_a_ip": "100.64.0.10"},
                        "local_network": {"kiosk_a_ip": "192.168.10.10"},
                        "tailscale_enabled": True,
                        "status_agent_client_key": "must-not-cross-boundary",
                        "nfc_agent_client_id": "kiosk-a-client",
                        "nfc_agent_client_secret": "must-not-cross-boundary",
                        "manage_kiosk_browser": True,
                        "kiosk_browser_engine": "firefox",
                    }
                }
            }
        }

        contracts = build_target_contracts(
            inventory, [{"host": "kiosk-a", "role": "kiosk"}]
        )

        self.assertEqual(contracts[0]["address"], "100.64.0.10")
        serialized = json.dumps(contracts)
        self.assertNotIn("must-not-cross-boundary", serialized)
        self.assertNotIn("client_secret", serialized)
        terminal_preflight.parse_spec(json.dumps(contracts[0]))

    def test_contract_builder_rejects_malformed_resource_threshold(self):
        inventory = {
            "_meta": {
                "hostvars": {
                    "kiosk-a": {
                        "ansible_host": "100.64.0.10",
                        "ansible_user": "kiosk-a",
                        "memory_required_mb": "120",
                    }
                }
            }
        }

        with self.assertRaisesRegex(TerminalPreflightContractError, "memory_required_mb"):
            build_target_contracts(inventory, [{"host": "kiosk-a", "role": "kiosk"}])

    def test_parser_rejects_invalid_numeric_address(self):
        with self.assertRaisesRegex(
            terminal_preflight.TerminalPreflightConfigError, "address"
        ):
            terminal_preflight.parse_spec(json.dumps({**target(), "address": "999.999.1.1"}))

    def test_orchestrator_reports_all_issues_before_any_release_unit(self):
        first = {
            "version": 1,
            "host": "kiosk-a",
            "profile": "kiosk",
            "ready": False,
            "issues": [
                {"code": "package.pcsc-tools", "message": "package missing"},
                {"code": "unit.pcscd.socket.active", "message": "socket inactive"},
            ],
        }
        second = {
            "version": 1,
            "host": "kiosk-b",
            "profile": "kiosk",
            "ready": False,
            "issues": [
                {"code": "repo.dirty", "message": "repository dirty"},
            ],
        }
        results = [first, second]

        def run_command(_argv, *, timeout):
            value = results.pop(0)
            marker = terminal_preflight._encode_marker(value)
            return subprocess.CompletedProcess([], 78, f"TERMINAL_PREFLIGHT_RESULT:{marker}\n", "")

        with tempfile.TemporaryDirectory() as temporary:
            lock = Path(temporary, "logs", "deploy", "fleet-release-state.lock")
            lock.parent.mkdir(parents=True)
            lock.write_bytes(b"")
            spec = {
                "version": 1,
                "mode": "orchestrator",
                "project": str(Path(temporary).resolve()),
                "runId": RUN_ID,
                "sha": SHA,
                "expectedServerClientId": "raspberrypi5-server",
                "targets": [target("kiosk-a"), {**target("kiosk-b"), "address": "100.64.0.11"}],
            }
            stderr = io.StringIO()
            with patch("sys.stderr", stderr):
                outcome = terminal_preflight.execute_orchestrator(
                    spec,
                    run_command=run_command,
                    candidate_run_command=candidate_success,
                    server_client_id_reader=lambda: "raspberrypi5-server",
                    source="TRUSTED_SOURCE",
                )

        self.assertEqual(outcome, terminal_preflight.EX_CONFIG)
        output = stderr.getvalue()
        self.assertIn("package.pcsc-tools", output)
        self.assertIn("unit.pcscd.socket.active", output)
        self.assertIn("repo.dirty", output)
        self.assertIn("3 issue(s) across 2 terminal(s)", output)

    def test_candidate_artifacts_and_terminal_issues_are_reported_together(self):
        selected = {
            **target(),
            "nfcEnabled": False,
            "torqueEnabled": True,
        }
        terminal_result = {
            "version": 1,
            "host": "kiosk-a",
            "profile": "kiosk",
            "ready": False,
            "issues": [{"code": "repo.dirty", "message": "repository dirty"}],
        }

        def remote_runner(argv, *, timeout):
            del argv, timeout
            marker = terminal_preflight._encode_marker(terminal_result)
            return subprocess.CompletedProcess(
                [], 78, f"TERMINAL_PREFLIGHT_RESULT:{marker}\n", ""
            )

        def candidate_runner(argv, *, timeout):
            del timeout
            if "-t" not in argv:
                return subprocess.CompletedProcess(argv, 0, "", "")
            object_name = argv[-1]
            if object_name.endswith(":clients/torque-agent"):
                return subprocess.CompletedProcess(argv, 128, "", "missing")
            relative = object_name.split(":", 1)[1]
            expected = dict(
                terminal_preflight._candidate_artifact_contract([selected])
            )[relative]
            return subprocess.CompletedProcess(argv, 0, f"{expected}\n", "")

        with tempfile.TemporaryDirectory() as temporary:
            lock = Path(temporary, "logs", "deploy", "fleet-release-state.lock")
            lock.parent.mkdir(parents=True)
            lock.write_bytes(b"")
            spec = {
                "version": 1,
                "mode": "orchestrator",
                "project": str(Path(temporary).resolve()),
                "runId": RUN_ID,
                "sha": SHA,
                "expectedServerClientId": "raspberrypi5-server",
                "targets": [selected],
            }
            stderr = io.StringIO()
            with patch("sys.stderr", stderr):
                outcome = terminal_preflight.execute_orchestrator(
                    spec,
                    run_command=remote_runner,
                    candidate_run_command=candidate_runner,
                    server_client_id_reader=lambda: "raspberrypi5-server",
                    source="TRUSTED_SOURCE",
                )

        self.assertEqual(outcome, terminal_preflight.EX_CONFIG)
        output = stderr.getvalue()
        self.assertIn("candidate.artifact-missing", output)
        self.assertIn("clients/torque-agent", output)
        self.assertIn("repo.dirty", output)
        self.assertIn("2 issue(s) across candidate and 1 terminal(s)", output)

    def test_candidate_contract_owns_agent_source_trees_not_the_current_terminal(self):
        selected = {
            **target(),
            "barcodeEnabled": True,
            "torqueEnabled": True,
        }
        artifacts = dict(terminal_preflight._candidate_artifact_contract([selected]))
        self.assertEqual(artifacts["clients/nfc-agent"], "tree")
        self.assertEqual(artifacts["clients/barcode-agent"], "tree")
        self.assertEqual(artifacts["clients/torque-agent"], "tree")

        required_directories: list[str] = []

        def record_directory(_issues, path, _code, **_requirements):
            required_directories.append(path)

        socket_stat = Mock(st_mode=stat.S_IFSOCK | 0o660)
        with patch.object(terminal_preflight, "_check_repository"), patch.object(
            terminal_preflight, "_check_network"
        ), patch.object(terminal_preflight, "_check_resources"), patch.object(
            terminal_preflight, "_require_directory", side_effect=record_directory
        ), patch.object(terminal_preflight, "_require_file"), patch.object(
            terminal_preflight, "_require_packages"
        ), patch.object(terminal_preflight, "_require_command"), patch.object(
            terminal_preflight, "_require_unit"
        ), patch.object(terminal_preflight, "_unit_exists", return_value=False), patch.object(
            terminal_preflight, "_command", return_value=subprocess.CompletedProcess([], 0, "", "")
        ), patch.object(terminal_preflight.os, "stat", return_value=socket_stat), patch.object(
            terminal_preflight, "_check_cron"
        ):
            result = terminal_preflight.run_target_probe(
                {**selected, "manageKioskBrowser": False}
            )

        self.assertTrue(result["ready"])
        self.assertFalse(
            any(
                path.startswith("/opt/RaspberryPiSystem_002/clients/")
                for path in required_directories
            )
        )

    def test_orchestrator_does_not_create_a_missing_lock_or_release_state(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            spec = {
                "version": 1,
                "mode": "orchestrator",
                "project": str(root.resolve()),
                "runId": RUN_ID,
                "sha": SHA,
                "expectedServerClientId": "raspberrypi5-server",
                "targets": [],
            }
            outcome = terminal_preflight.execute_orchestrator(
                spec,
                server_client_id_reader=lambda: "raspberrypi5-server",
                source="TRUSTED_SOURCE",
            )

            self.assertEqual(outcome, terminal_preflight.EX_TEMPFAIL)
            self.assertEqual(list(root.rglob("*")), [])

    def test_nfc_baseline_uses_socket_activation_not_service_enablement(self):
        spec = target()
        spec["manageKioskBrowser"] = False
        observed_units: list[tuple[str, dict[str, bool]]] = []

        def record_unit(_issues, unit, **requirements):
            observed_units.append((unit, requirements))

        socket_stat = Mock(st_mode=stat.S_IFSOCK | 0o660)
        with patch.object(terminal_preflight, "_check_repository"), patch.object(
            terminal_preflight, "_check_network"
        ), patch.object(terminal_preflight, "_check_resources"), patch.object(
            terminal_preflight, "_require_directory"
        ), patch.object(terminal_preflight, "_require_file"
        ), patch.object(terminal_preflight, "_require_packages"), patch.object(
            terminal_preflight, "_require_command"
        ), patch.object(terminal_preflight, "_require_unit", side_effect=record_unit), patch.object(
            terminal_preflight, "_unit_exists", return_value=False
        ), patch.object(terminal_preflight, "_command", return_value=subprocess.CompletedProcess([], 0, "", "")), patch.object(
            terminal_preflight.os, "stat", return_value=socket_stat
        ), patch.object(terminal_preflight, "_check_cron"):
            result = terminal_preflight.run_target_probe(spec)

        self.assertTrue(result["ready"])
        self.assertIn(
            (
                "pcscd.socket",
                {"loaded": True, "active": True, "enabled": True},
            ),
            observed_units,
        )
        self.assertFalse(any(unit == "pcscd.service" for unit, _ in observed_units))


if __name__ == "__main__":
    unittest.main()
