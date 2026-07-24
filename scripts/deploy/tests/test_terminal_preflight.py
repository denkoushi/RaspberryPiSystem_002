#!/usr/bin/env python3
from __future__ import annotations

import base64
import io
import json
import shlex
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from scripts.deploy.rolling_release.adapter_registry import adapter_for_profile
from scripts.deploy.rolling_release import terminal_preflight
from scripts.deploy.rolling_release.terminal_preflight_contract import (
    TerminalPreflightContractError,
    build_target_contracts,
)


SHA = "a" * 40
RUN_ID = "20260718-120000-a1b2c3"
ROOT = Path(__file__).resolve().parents[3]

TORQUE_HELPER_PATH = (
    "infrastructure/ansible/roles/client/templates/torque-bluetooth-adapter.sh.j2"
)
TORQUE_UNIT_PATH = (
    "infrastructure/ansible/roles/client/templates/torque-bluetooth-adapter@.service.j2"
)
TORQUE_GUARD_UNIT_PATH = (
    "infrastructure/ansible/roles/client/templates/torque-bluetooth-guard.service.j2"
)
TORQUE_RULE_PATH = (
    "infrastructure/ansible/roles/client/templates/90-torque-bluetooth-adapter.rules.j2"
)
TORQUE_TASKS_PATH = "infrastructure/ansible/roles/client/tasks/torque-agent.yml"
TORQUE_CANDIDATE_SOURCES = {
    TORQUE_HELPER_PATH: "#!/usr/bin/env bash\n"
    "set -euo pipefail\n"
    "readonly vendor='{{ torque_agent_bluetooth_adapter.usb_vendor_id }}'\n"
    "readonly product='{{ torque_agent_bluetooth_adapter.usb_product_id }}'\n"
    "run_btmgmt() { mkfifo -m 600 \"${stdin_fifo}\"; timeout --kill-after=1 4 btmgmt \"$@\" <&9 2>&1; cut -c1-240; }\n"
    "printf 'torque-bluetooth operation=%s result=%s status=%s\\n' info success 0\n"
    "probe_exact_controller() {\n"
    "  for _ in {1..3}; do run_btmgmt info; done\n"
    "}\n"
    "[[ \"${1:-}\" == '--probe' ]]\n",
    TORQUE_UNIT_PATH: "[Unit]\nAfter=bluetooth.service systemd-rfkill.service\n"
    "Requires=bluetooth.service\n[Service]\n"
    "ExecStart=/usr/local/libexec/torque-bluetooth-adapter --power-off %I\n"
    "TimeoutStartSec=90\nTimeoutStopSec=10\n",
    TORQUE_GUARD_UNIT_PATH: "[Unit]\nAfter=bluetooth.service systemd-rfkill.service\n"
    "Requires=bluetooth.service\n[Service]\n"
    "ExecStart=/usr/local/libexec/torque-bluetooth-guard --poll-seconds 1 --command-timeout-seconds 4\n"
    "Restart=always\nRuntimeDirectory=torque-bluetooth-guard\nTimeoutStopSec=10\n",
    TORQUE_RULE_PATH: 'ACTION=="add", SUBSYSTEM=="bluetooth", ENV{DEVTYPE}=="host", '
    'ATTRS{idVendor}=="{{ torque_agent_bluetooth_adapter.usb_vendor_id }}", '
    'ATTRS{idProduct}=="{{ torque_agent_bluetooth_adapter.usb_product_id }}", '
    'ENV{SYSTEMD_WANTS}+="torque-bluetooth-adapter@%k.service", '
    'ENV{SYSTEMD_WANTS}+="torque-bluetooth-guard.service"\n',
    TORQUE_TASKS_PATH: "- ansible.builtin.systemd:\n"
    "    name: torque-bluetooth-adapter@hci1.service\n"
    "    state: started\n"
    "  rescue:\n"
    "    - ansible.builtin.command: systemctl show torque-bluetooth-adapter@hci1.service\n"
    "    - ansible.builtin.command: journalctl --lines=80 --output=short-iso\n",
}


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
        "torqueUsbVendorId": "",
        "torqueUsbProductId": "",
        "haizenEnabled": False,
        "haizenHidDevice": "/dev/input/event0",
        "haizenInstallEvdev": True,
        "manageSignage": False,
        "inventoryIssues": [],
        "runtimeManifestContract": adapter_for_profile(
            "kiosk", runtime=None
        ).runtime_manifest_contract.as_preflight_payload(),
    }


def candidate_success(argv, *, timeout):
    del timeout
    if "blob" in argv:
        relative = argv[-1].split(":", 1)[1]
        if relative in TORQUE_CANDIDATE_SOURCES:
            return subprocess.CompletedProcess(
                argv,
                0,
                TORQUE_CANDIDATE_SOURCES[relative],
                "",
            )
        return subprocess.CompletedProcess(
            argv, 0, "# candidate runtime manifest source\n", ""
        )
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
        self.assertEqual(
            contracts[0]["runtimeManifestContract"],
            adapter_for_profile(
                "kiosk", runtime=None
            ).runtime_manifest_contract.as_preflight_payload(),
        )
        terminal_preflight.parse_spec(json.dumps(contracts[0]))

    def test_contract_builder_resolves_indirect_inventory_address_alias(self):
        inventory = {
            "_meta": {
                "hostvars": {
                    "kiosk-a": {
                        "ansible_host": "{{ kiosk_ip }}",
                        "ansible_user": "kiosk-a",
                        "kiosk_ip": "{{ current_network.kiosk_a_ip | default(local_network.kiosk_a_ip) }}",
                        "network_mode": "tailscale",
                        "tailscale_network": {"kiosk_a_ip": "100.64.0.10"},
                        "local_network": {"kiosk_a_ip": "192.168.10.10"},
                        "tailscale_enabled": True,
                        "nfc_agent_client_id": "kiosk-a-client",
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

    def test_candidate_runtime_helper_source_is_read_from_exact_git_blob(self):
        observed: list[list[str]] = []

        def runner(argv, *, timeout):
            self.assertEqual(timeout, 20)
            observed.append(list(argv))
            return subprocess.CompletedProcess(
                argv, 0, "# exact candidate helper\n", ""
            )

        source, issues = terminal_preflight._candidate_runtime_manifest_source(
            {
                "project": "/opt/RaspberryPiSystem_002",
                "sha": SHA,
            },
            run_command=runner,
        )

        self.assertEqual(source, "# exact candidate helper\n")
        self.assertEqual(issues, [])
        self.assertEqual(
            observed[0][-2:],
            ["blob", f"{SHA}:scripts/deploy/terminal-runtime-manifest.py"],
        )

    def test_candidate_agent_health_source_is_read_from_exact_git_blob(self):
        observed: list[list[str]] = []

        def runner(argv, *, timeout):
            self.assertEqual(timeout, 20)
            observed.append(list(argv))
            return subprocess.CompletedProcess(
                argv, 0, "# exact candidate health helper\n", ""
            )

        source, issues = terminal_preflight._candidate_agent_health_source(
            {
                "project": "/opt/RaspberryPiSystem_002",
                "sha": SHA,
            },
            run_command=runner,
        )

        self.assertEqual(source, "# exact candidate health helper\n")
        self.assertEqual(issues, [])
        self.assertEqual(
            observed[0][-2:],
            ["blob", f"{SHA}:scripts/deploy/terminal-agent-health-probe.py"],
        )

    def test_candidate_torque_helper_source_is_read_from_exact_git_blob(self):
        selected = {
            **target(),
            "torqueEnabled": True,
            "torqueUsbVendorId": "2357",
            "torqueUsbProductId": "0604",
        }
        source, issues = terminal_preflight._candidate_torque_helper_template_source(
            {
                "project": "/opt/RaspberryPiSystem_002",
                "sha": SHA,
                "targets": [selected],
            },
            run_command=candidate_success,
        )

        self.assertEqual(issues, [])
        self.assertIn(terminal_preflight._TORQUE_VENDOR_PLACEHOLDER, source)

    def test_candidate_torque_bluetooth_contract_rejects_a_competing_start_owner(self):
        sources = dict(TORQUE_CANDIDATE_SOURCES)
        sources[TORQUE_TASKS_PATH] += (
            "- ansible.builtin.command: >-\n"
            "    udevadm trigger --subsystem-match=bluetooth --action=add\n"
        )

        issues = terminal_preflight._candidate_torque_bluetooth_contract_issues(sources)

        self.assertEqual(
            issues,
            [
                {
                    "code": "candidate.torque-bluetooth-ownership",
                    "message": "candidate torque Bluetooth tasks must use one synchronous start owner",
                }
            ],
        )

    def test_candidate_torque_bluetooth_contract_allows_guard_restart(self):
        sources = dict(TORQUE_CANDIDATE_SOURCES)
        sources[TORQUE_TASKS_PATH] += (
            "- name: Restart the fail-closed guard\n"
            "  ansible.builtin.systemd:\n"
            "    name: torque-bluetooth-guard.service\n"
            "    state: restarted\n"
        )

        self.assertEqual(
            terminal_preflight._candidate_torque_bluetooth_contract_issues(sources),
            [],
        )

    def test_candidate_torque_bluetooth_contract_requires_boot_guard_activation(self):
        sources = dict(TORQUE_CANDIDATE_SOURCES)
        sources[TORQUE_RULE_PATH] = sources[TORQUE_RULE_PATH].replace(
            ', ENV{SYSTEMD_WANTS}+="torque-bluetooth-guard.service"',
            "",
        )
        sources[TORQUE_GUARD_UNIT_PATH] = "[Service]\nRestart=no\n"

        issues = terminal_preflight._candidate_torque_bluetooth_contract_issues(sources)

        self.assertEqual(
            {issue["code"] for issue in issues},
            {
                "candidate.torque-bluetooth-guard-unit",
                "candidate.torque-bluetooth-udev",
            },
        )

    def test_repository_torque_bluetooth_assets_pass_candidate_contract(self):
        sources = {
            path: (ROOT / path).read_text(encoding="utf-8")
            for path in terminal_preflight._TORQUE_BLUETOOTH_DEPLOYMENT_ARTIFACTS
        }

        self.assertEqual(
            terminal_preflight._candidate_torque_bluetooth_contract_issues(sources),
            [],
        )

    def test_candidate_torque_bluetooth_contract_rejects_missing_diagnostics_and_evidence(self):
        sources = dict(TORQUE_CANDIDATE_SOURCES)
        sources[TORQUE_HELPER_PATH] = "#!/usr/bin/env bash\nprobe_exact_controller() { power on; }\n"
        sources[TORQUE_TASKS_PATH] = (
            "- ansible.builtin.systemd:\n"
            "    name: torque-bluetooth-adapter@hci1.service\n"
            "    state: started\n"
        )

        issues = terminal_preflight._candidate_torque_bluetooth_contract_issues(sources)

        self.assertEqual(
            {issue["code"] for issue in issues},
            {
                "candidate.torque-bluetooth-diagnostics",
                "candidate.torque-bluetooth-failure-evidence",
            },
        )

    def test_remote_probe_transports_all_exact_candidate_probe_sources(self):
        preflight_source = "sentinel-preflight-payload-value"
        runtime_source = "sentinel-runtime-payload-value"
        agent_health_source = "sentinel-agent-health-payload-value"
        torque_helper_source = "sentinel-torque-helper-payload-value"
        command = terminal_preflight._remote_probe_command(target())
        probe_input = terminal_preflight._remote_probe_input(
            target(), preflight_source, runtime_source, agent_health_source,
            torque_helper_source
        )
        remote = shlex.split(command[-1])
        envelope = json.loads(probe_input)

        self.assertEqual(remote[-2:], ["-c", terminal_preflight.TARGET_LOADER])
        self.assertNotIn(preflight_source, command[-1])
        self.assertNotIn(runtime_source, command[-1])
        self.assertNotIn(agent_health_source, command[-1])
        self.assertNotIn(torque_helper_source, command[-1])
        self.assertEqual(envelope["preflightSource"], preflight_source)
        self.assertEqual(envelope["runtimeManifestSource"], runtime_source)
        self.assertEqual(envelope["agentHealthSource"], agent_health_source)
        self.assertEqual(envelope["torqueHelperTemplateSource"], torque_helper_source)
        self.assertEqual(envelope["spec"]["host"], "kiosk-a")

    def test_remote_probe_streams_source_larger_than_linux_single_argument_limit(self):
        preflight_source = "#" + ("x" * 150_000) + "\n" + """
import base64
import json
payload = {"version": 1, "host": "kiosk-a", "profile": "kiosk", "ready": True, "issues": []}
encoded = base64.urlsafe_b64encode(json.dumps(payload).encode("utf-8")).decode("ascii")
print("TERMINAL_PREFLIGHT_RESULT:" + encoded)
"""
        runtime_source = "# candidate runtime source\n"
        agent_health_source = "# candidate health source\n"
        torque_helper_source = "# candidate torque helper source\n"
        probe_input = terminal_preflight._remote_probe_input(
            target(), preflight_source, runtime_source, agent_health_source,
            torque_helper_source
        )
        completed = subprocess.run(
            [sys.executable, "-c", terminal_preflight.TARGET_LOADER],
            input=probe_input,
            text=True,
            capture_output=True,
            check=False,
        )

        self.assertGreater(len(preflight_source), 131_072)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertTrue(terminal_preflight._decode_marker(completed.stdout)["ready"])
        self.assertEqual(json.loads(probe_input)["runtimeManifestSource"], runtime_source)
        self.assertEqual(json.loads(probe_input)["agentHealthSource"], agent_health_source)
        self.assertEqual(
            json.loads(probe_input)["torqueHelperTemplateSource"],
            torque_helper_source,
        )
        self.assertLess(
            len(terminal_preflight._remote_probe_command(target())[-1]), 131_072
        )

    def test_target_main_reports_unexpected_probe_error_without_its_message(self):
        secret = "DO-NOT-LEAK-TARGET-ERROR"
        stdout = io.StringIO()

        with patch.object(
            terminal_preflight,
            "run_target_probe",
            side_effect=UnicodeDecodeError("utf-8", b"x", 0, 1, secret),
        ), patch("sys.stdout", stdout):
            outcome = terminal_preflight.main([json.dumps(target())])

        self.assertEqual(outcome, terminal_preflight.EX_CONFIG)
        result = terminal_preflight._decode_marker(stdout.getvalue())
        self.assertEqual(
            result,
            {
                "version": 1,
                "host": "kiosk-a",
                "profile": "kiosk",
                "ready": False,
                "issues": [
                    {
                        "code": "probe.internal",
                        "message": "terminal preflight probe raised UnicodeDecodeError",
                    }
                ],
            },
        )
        self.assertNotIn(secret, stdout.getvalue())

    def test_missing_marker_classifies_closed_ssh_without_returning_remote_output(self):
        secret = "DO-NOT-LEAK-SSH-OUTPUT"
        completed = subprocess.CompletedProcess(
            [],
            255,
            "",
            f"ssh: connection closed; {secret}",
        )

        issue = terminal_preflight._missing_marker_issue(completed)

        self.assertEqual(
            issue,
            {
                "code": "transport.ssh-closed",
                "message": "terminal SSH connection closed before returning a result marker",
            },
        )
        self.assertNotIn(secret, json.dumps(issue))

    def test_missing_marker_classifies_common_ssh_failure_boundaries(self):
        cases = (
            (
                "ssh: connect to host 100.64.0.1 port 22: Operation timed out",
                "transport.ssh-timeout",
            ),
            (
                "ssh: connect to host 100.64.0.1 port 22: Connection refused",
                "transport.ssh-refused",
            ),
            (
                "ssh: connect to host 100.64.0.1 port 22: No route to host",
                "transport.ssh-route",
            ),
            ("user@100.64.0.1: Permission denied (publickey).", "transport.ssh-auth"),
            (
                "ssh: Could not resolve hostname kiosk-a: nodename nor servname provided",
                "transport.ssh-name",
            ),
        )

        for stderr, expected_code in cases:
            with self.subTest(expected_code):
                issue = terminal_preflight._missing_marker_issue(
                    subprocess.CompletedProcess([], 255, "", stderr)
                )
                self.assertEqual(issue["code"], expected_code)
                self.assertNotIn(stderr, json.dumps(issue))

    def test_missing_marker_classifies_sudo_rejection_without_returning_output(self):
        secret = "DO-NOT-LEAK-SUDO-OUTPUT"
        completed = subprocess.CompletedProcess(
            [],
            1,
            "",
            f"sudo: a password is required; {secret}",
        )

        issue = terminal_preflight._missing_marker_issue(completed)

        self.assertEqual(
            issue,
            {
                "code": "transport.privilege",
                "message": "terminal privilege boundary rejected the read-only probe",
            },
        )
        self.assertNotIn(secret, json.dumps(issue))

    def test_missing_marker_classifies_loader_and_other_process_exits(self):
        self.assertEqual(
            terminal_preflight._missing_marker_issue(
                subprocess.CompletedProcess([], terminal_preflight.EX_CONFIG, "", "")
            ),
            {
                "code": "transport.loader",
                "message": "terminal probe loader rejected the read-only envelope",
            },
        )
        self.assertEqual(
            terminal_preflight._missing_marker_issue(
                subprocess.CompletedProcess([], 70, "", "")
            ),
            {
                "code": "transport.process",
                "message": (
                    "terminal probe process exited before returning a result marker "
                    "(exit 70)"
                ),
            },
        )

    def test_runtime_probe_uses_shared_contract_and_accepts_bounded_result(self):
        selected = target()
        contract = selected["runtimeManifestContract"]
        payload = {
            "compatible": True,
            "unitCount": len(contract["systemdUnits"]),
            "dockerCount": len(contract["dockerServices"]),
            "presentDockerCount": 3,
        }
        encoded = base64.urlsafe_b64encode(
            json.dumps(payload, sort_keys=True).encode("utf-8")
        ).decode("ascii")
        completed = subprocess.CompletedProcess(
            [],
            0,
            f"TERMINAL_RUNTIME_MANIFEST_RESULT:{encoded}\n",
            "",
        )

        with patch.object(terminal_preflight, "_command", return_value=completed) as run:
            issue = terminal_preflight._probe_runtime_capture(
                selected, "# candidate helper"
            )

        self.assertIsNone(issue)
        arguments = run.call_args.args[0]
        self.assertEqual(arguments[:3], [
            "/usr/bin/python3",
            "-",
            "probe-capture",
        ])
        self.assertEqual(run.call_args.kwargs["input_text"], "# candidate helper")
        self.assertNotIn("--root", arguments)
        for service in contract["dockerServices"]:
            self.assertIn(service, arguments)

    def test_runtime_probe_returns_safe_machine_error_without_raw_output(self):
        secret = "DO-NOT-LEAK-RUNTIME-SECRET"
        payload = {
            "version": 1,
            "code": "runtime.unsupported-feature",
            "message": "Docker runtime feature is unsupported by rollback capture: ExtraHosts",
        }
        encoded = base64.urlsafe_b64encode(
            json.dumps(payload, sort_keys=True).encode("utf-8")
        ).decode("ascii")
        completed = subprocess.CompletedProcess(
            [],
            1,
            f"TERMINAL_RUNTIME_MANIFEST_ERROR:{encoded}\n",
            secret,
        )

        with patch.object(terminal_preflight, "_command", return_value=completed):
            issue = terminal_preflight._probe_runtime_capture(
                target(), "# candidate helper"
            )

        self.assertEqual(issue, {
            "code": "runtime.unsupported-feature",
            "message": payload["message"],
        })
        self.assertNotIn(secret, json.dumps(issue))

    def test_live_agent_health_runs_every_enabled_agent_from_candidate_source(self):
        selected = {
            **target(),
            "barcodeEnabled": True,
            "torqueEnabled": True,
            "torqueUsbVendorId": "2357",
            "torqueUsbProductId": "0604",
        }
        completed = [
            subprocess.CompletedProcess(
                [], 0, f"TERMINAL_AGENT_HEALTH_OK:{agent}:{port}\n", ""
            )
            for agent, port in (
                ("nfc-agent", 7071),
                ("barcode-agent", 7072),
                ("torque-agent", 7073),
            )
        ]

        with patch.object(Path, "is_file", return_value=True), patch.object(
            terminal_preflight, "_command", side_effect=completed
        ) as run:
            issues = terminal_preflight._probe_live_agent_health(
                selected, "# exact candidate health helper"
            )

        self.assertEqual(issues, [])
        self.assertEqual(run.call_count, 3)
        for call, agent in zip(
            run.call_args_list,
            ("nfc-agent", "barcode-agent", "torque-agent"),
            strict=True,
        ):
            self.assertEqual(call.args[0][:3], ["/usr/bin/python3", "-", "--agent"])
            self.assertIn(agent, call.args[0])
            self.assertEqual(
                call.kwargs["input_text"], "# exact candidate health helper"
            )

    def test_live_agent_health_returns_safe_issue_without_raw_probe_output(self):
        secret = "DO-NOT-LEAK-AGENT-SECRET"
        completed = subprocess.CompletedProcess([], 1, "", secret)

        with patch.object(Path, "is_file", return_value=True), patch.object(
            terminal_preflight, "_command", return_value=completed
        ):
            issues = terminal_preflight._probe_live_agent_health(
                target(), "# exact candidate health helper"
            )

        self.assertEqual(
            issues,
            [
                {
                    "code": "agent.nfc-agent.health",
                    "message": "nfc-agent did not pass the stable live health contract",
                }
            ],
        )
        self.assertNotIn(secret, json.dumps(issues))

    def test_live_agent_health_skips_a_new_optional_agent_without_install_marker(self):
        selected = {
            **target(),
            "nfcEnabled": False,
            "torqueEnabled": True,
        }

        with patch.object(Path, "is_file", return_value=False), patch.object(
            terminal_preflight, "_command"
        ) as run:
            issues = terminal_preflight._probe_live_agent_health(
                selected, "# exact candidate health helper"
            )

        self.assertEqual(issues, [])
        run.assert_not_called()

    def test_candidate_torque_helper_probe_runs_exact_rendered_source(self):
        selected = {
            **target(),
            "torqueEnabled": True,
            "torqueUsbVendorId": "2357",
            "torqueUsbProductId": "0604",
        }
        template = (
            "#!/usr/bin/env bash\n"
            "set -euo pipefail\n"
            "vendor='{{ torque_agent_bluetooth_adapter.usb_vendor_id }}'\n"
            "product='{{ torque_agent_bluetooth_adapter.usb_product_id }}'\n"
            "[[ \"${1:-}\" == '--probe' && \"$vendor\" == 2357 && \"$product\" == 0604 ]]\n"
        )

        with patch.object(
            terminal_preflight,
            "_command",
            return_value=subprocess.CompletedProcess([], 0, "", ""),
        ) as run:
            issue = terminal_preflight._probe_candidate_torque_helper(
                selected, template
            )

        self.assertIsNone(issue)
        self.assertEqual(run.call_args.args[0], ["/usr/bin/bash", "-s", "--", "--probe"])
        rendered = run.call_args.kwargs["input_text"]
        self.assertIn("vendor='2357'", rendered)
        self.assertIn("product='0604'", rendered)
        self.assertNotIn("{{", rendered)

    def test_candidate_torque_helper_probe_hides_raw_failure_output(self):
        secret = "DO-NOT-LEAK-TORQUE-SECRET"
        selected = {
            **target(),
            "torqueEnabled": True,
            "torqueUsbVendorId": "2357",
            "torqueUsbProductId": "0604",
        }
        template = (
            "vendor='{{ torque_agent_bluetooth_adapter.usb_vendor_id }}'\n"
            "product='{{ torque_agent_bluetooth_adapter.usb_product_id }}'\n"
        )
        with patch.object(
            terminal_preflight,
            "_command",
            return_value=subprocess.CompletedProcess([], 1, secret, secret),
        ):
            issue = terminal_preflight._probe_candidate_torque_helper(
                selected, template
            )

        self.assertEqual(issue["code"], "torque.candidate-helper-probe")
        self.assertNotIn(secret, json.dumps(issue))

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

        def run_command(_argv, *, timeout, input_text=None):
            self.assertIsNotNone(input_text)
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
            "torqueUsbVendorId": "2357",
            "torqueUsbProductId": "0604",
        }
        terminal_result = {
            "version": 1,
            "host": "kiosk-a",
            "profile": "kiosk",
            "ready": False,
            "issues": [{"code": "repo.dirty", "message": "repository dirty"}],
        }

        def remote_runner(argv, *, timeout, input_text=None):
            self.assertIsNotNone(input_text)
            del argv, timeout
            marker = terminal_preflight._encode_marker(terminal_result)
            return subprocess.CompletedProcess(
                [], 78, f"TERMINAL_PREFLIGHT_RESULT:{marker}\n", ""
            )

        def candidate_runner(argv, *, timeout):
            del timeout
            if "blob" in argv:
                relative = argv[-1].split(":", 1)[1]
                return subprocess.CompletedProcess(
                    argv,
                    0,
                    TORQUE_CANDIDATE_SOURCES.get(
                        relative, "# candidate runtime manifest source\n"
                    ),
                    "",
                )
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
            "torqueUsbVendorId": "2357",
            "torqueUsbProductId": "0604",
        }
        artifacts = dict(terminal_preflight._candidate_artifact_contract([selected]))
        self.assertEqual(
            artifacts[
                "scripts/deploy/rolling_release/terminal_manifest_capture.py"
            ],
            "blob",
        )
        self.assertEqual(
            artifacts[
                "scripts/deploy/rolling_release/terminal_release_evidence.py"
            ],
            "blob",
        )
        self.assertEqual(
            artifacts["scripts/deploy/terminal-identity-probe.py"], "blob"
        )
        self.assertEqual(artifacts["clients/nfc-agent"], "tree")
        self.assertEqual(artifacts["clients/barcode-agent"], "tree")
        self.assertEqual(artifacts["clients/torque-agent"], "tree")
        self.assertEqual(
            artifacts[
                "infrastructure/ansible/roles/client/templates/"
                "torque-bluetooth-adapter.sh.j2"
            ],
            "blob",
        )

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
