#!/usr/bin/env python3
from __future__ import annotations

import base64
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from scripts.deploy.rolling_release.backends import ansible


class Runtime:
    ANSIBLE_DIRECTORY = Path('/ansible')
    PROJECT = Path('/project')
    def __init__(self, result):
        self.result = result
        self.calls = []
        self.state_calls = []

    def run(self, command, **kwargs):
        self.calls.append((command, kwargs))
        result = self.result.pop(0) if isinstance(self.result, list) else self.result
        if isinstance(result, BaseException):
            raise result
        return result

    def state_command(self, *arguments):
        self.state_calls.append(arguments)


def manifest_marker(value):
    encoded = base64.urlsafe_b64encode(
        json.dumps(value, sort_keys=True).encode("utf-8")
    ).decode("ascii")
    return f"ROLLBACK_MANIFEST_RESULT:{encoded}"


class SelectedHostsTest(unittest.TestCase):
    def test_empty_limit_skips_ansible(self):
        runtime = Runtime("unused")
        self.assertIsNone(ansible.selected_hosts("inventory.yml", "", runtime=runtime))
        self.assertEqual(runtime.calls, [])

    def test_zero_match_is_an_explicit_empty_selection(self):
        error = subprocess.CalledProcessError(
            1,
            ["ansible"],
            output="  hosts (0):\n",
            stderr="[WARNING]: No hosts matched\n",
        )
        runtime = Runtime(error)

        self.assertEqual(
            ansible.selected_hosts(
                "inventory.yml", "missing-host", runtime=runtime
            ),
            [],
        )

    def test_non_zero_match_failure_is_not_hidden(self):
        error = subprocess.CalledProcessError(
            2,
            ["ansible"],
            output="",
            stderr="inventory could not be parsed",
        )
        runtime = Runtime(error)

        with self.assertRaises(subprocess.CalledProcessError):
            ansible.selected_hosts(
                "inventory.yml", "kiosk", runtime=runtime
            )

    def test_successful_output_preserves_inventory_order(self):
        runtime = Runtime("  hosts (2):\n    kiosk-b\n    kiosk-a\n")
        selected = ansible.selected_hosts(
            "inventory.yml", "kiosk", runtime=runtime
        )
        self.assertEqual(selected, ["kiosk-b", "kiosk-a"])
        self.assertEqual(runtime.calls[0][1]['cwd'], runtime.ANSIBLE_DIRECTORY)


class RollbackManifestAdapterTest(unittest.TestCase):
    RUN_ID = "run-123"
    HOST = "kiosk-a"
    PREVIOUS_SHA = "a" * 40
    DIGEST = "c" * 64

    def _capture_result(self, terminal_type="kiosk"):
        user = "tools03" if terminal_type == "kiosk" else "signageras3"
        home = f"/home/{user}"
        paths = ansible._terminal_manifest_paths(
            terminal_type, user, home, self.RUN_ID
        )
        return paths, {
            "captured": True,
            "manifest": (
                "/var/lib/raspi-release/rollback-manifests/"
                f"{self.RUN_ID}/{self.HOST}/manifest.json"
            ),
            "manifestSha256": self.DIGEST,
            "count": len(paths),
            "destinations": paths,
            "repository": {
                "path": "/opt/RaspberryPiSystem_002",
                "head": self.PREVIOUS_SHA,
            },
        }

    def test_capture_seals_explicit_kiosk_paths_and_repository_head(self):
        paths, result = self._capture_result()
        identity = (
            "ROLLBACK_REMOTE_IDENTITY:tools03:/home/tools03\n"
            "ROLLBACK_REMOTE_IDENTITY:tools03:/home/tools03\n"
        )
        runtime = Runtime([identity, manifest_marker(result)])

        reference = ansible.capture_terminal_manifest(
            "inventory.yml",
            {"host": self.HOST, "terminalType": "kiosk"},
            self.RUN_ID,
            self.PREVIOUS_SHA,
            runtime=runtime,
        )

        self.assertEqual(
            reference,
            {
                "path": result["manifest"],
                "manifestSha256": self.DIGEST,
                "count": len(paths),
            },
        )
        identity_command = runtime.calls[0][0]
        self.assertNotIn("-b", identity_command)
        self.assertIn("ROLLBACK_REMOTE_IDENTITY", identity_command[-1])
        command, options = runtime.calls[1]
        self.assertEqual(command[0:7], [
            "ansible", "-i", "inventory.yml", self.HOST, "-b", "-m", "script"
        ])
        action = command[-1]
        self.assertIn("/project/scripts/deploy/rollback-manifest.py", action)
        self.assertIn("capture-set", action)
        self.assertIn("--repository /opt/RaspberryPiSystem_002", action)
        self.assertIn(f"--expected-head {self.PREVIOUS_SHA}", action)
        for path in paths:
            self.assertIn(f"--path {path}", action)
        self.assertNotIn("client-key", action)
        self.assertTrue(options["capture"])

    def test_capture_uses_signage_only_paths_and_run_scoped_prestage_file(self):
        paths, result = self._capture_result("signage")
        runtime = Runtime([
            "ROLLBACK_REMOTE_IDENTITY:signageras3:/home/signageras3\n",
            manifest_marker(result),
        ])

        ansible.capture_terminal_manifest(
            "inventory.yml",
            {"host": self.HOST, "terminalType": "signage"},
            self.RUN_ID,
            self.PREVIOUS_SHA,
            runtime=runtime,
        )

        action = runtime.calls[1][0][-1]
        self.assertIn(
            f"--path /run/signage/release-{self.RUN_ID}-maintenance.svg", action
        )
        self.assertIn("--path /etc/systemd/system/signage-lite.service", action)
        self.assertNotIn("--path /etc/systemd/system/kiosk-browser.service", action)

    def test_capture_rejects_malformed_identity_before_helper_execution(self):
        runtime = Runtime("ROLLBACK_REMOTE_IDENTITY:root:/root\n")
        with self.assertRaisesRegex(RuntimeError, "could not be resolved"):
            ansible.capture_terminal_manifest(
                "inventory.yml",
                {"host": self.HOST, "terminalType": "kiosk"},
                self.RUN_ID,
                self.PREVIOUS_SHA,
                runtime=runtime,
            )
        self.assertEqual(len(runtime.calls), 1)

    def test_capture_rejects_invalid_run_host_sha_without_remote_call(self):
        invalid_cases = (
            ({"host": "bad host", "terminalType": "kiosk"}, self.RUN_ID, self.PREVIOUS_SHA),
            ({"host": self.HOST, "terminalType": "other"}, self.RUN_ID, self.PREVIOUS_SHA),
            ({"host": self.HOST, "terminalType": "kiosk"}, "x", self.PREVIOUS_SHA),
            ({"host": self.HOST, "terminalType": "kiosk"}, self.RUN_ID, "main"),
        )
        for target_spec, run_id, sha in invalid_cases:
            with self.subTest(target_spec=target_spec, run_id=run_id, sha=sha):
                runtime = Runtime("unused")
                with self.assertRaises(ValueError):
                    ansible.capture_terminal_manifest(
                        "inventory.yml",
                        target_spec,
                        run_id,
                        sha,
                        runtime=runtime,
                    )
                self.assertEqual(runtime.calls, [])

    def test_marker_allows_identical_callback_duplicates_only(self):
        marker = manifest_marker({"restored": True})
        self.assertEqual(
            ansible._manifest_marker(f"{marker}\n{marker}\n"),
            {"restored": True},
        )
        with self.assertRaisesRegex(RuntimeError, "disagree"):
            ansible._manifest_marker(
                marker + "\n" + manifest_marker({"restored": False})
            )

    def test_marker_rejects_noncanonical_base64_and_duplicate_json_keys(self):
        malformed = "ROLLBACK_MANIFEST_RESULT:AAAA=A=="
        with self.assertRaisesRegex(RuntimeError, "malformed"):
            ansible._manifest_marker(malformed)
        duplicate_json = base64.urlsafe_b64encode(b'{"a":1,"a":2}').decode("ascii")
        with self.assertRaisesRegex(RuntimeError, "malformed"):
            ansible._manifest_marker(
                "ROLLBACK_MANIFEST_RESULT:" + duplicate_json
            )

    def test_capture_rejects_wrong_repository_proof(self):
        _paths, result = self._capture_result()
        result["repository"]["head"] = "b" * 40
        runtime = Runtime([
            "ROLLBACK_REMOTE_IDENTITY:tools03:/home/tools03\n",
            manifest_marker(result),
        ])
        with self.assertRaisesRegex(RuntimeError, "capture result is invalid"):
            ansible.capture_terminal_manifest(
                "inventory.yml",
                {"host": self.HOST, "terminalType": "kiosk"},
                self.RUN_ID,
                self.PREVIOUS_SHA,
                runtime=runtime,
            )

    def _rollback_target(self, count=2):
        return {
            "state": "rolling-back",
            "previousSha": self.PREVIOUS_SHA,
            "rollbackManifest": {
                "path": (
                    "/var/lib/raspi-release/rollback-manifests/"
                    f"{self.RUN_ID}/{self.HOST}/manifest.json"
                ),
                "manifestSha256": self.DIGEST,
                "count": count,
            },
        }

    def _restore_result(self):
        return {
            "restored": True,
            "manifest": (
                "/var/lib/raspi-release/rollback-manifests/"
                f"{self.RUN_ID}/{self.HOST}/manifest.json"
            ),
            "manifestSha256": self.DIGEST,
            "count": 2,
            "destinations": ["/etc/one", "/etc/two"],
            "repository": {
                "path": "/opt/RaspberryPiSystem_002",
                "head": self.PREVIOUS_SHA,
            },
        }

    def test_rollback_restores_exact_manifest_then_reconciles_without_playbook(self):
        runtime = Runtime([
            manifest_marker(self._restore_result()),
            self.PREVIOUS_SHA + "\n",
            "",
        ])
        target = self._rollback_target()

        self.assertTrue(
            ansible.rollback_terminal(
                "inventory.yml",
                {"host": self.HOST, "terminalType": "kiosk"},
                target,
                self.RUN_ID,
                runtime=runtime,
            )
        )

        self.assertEqual(target["rollback"], "success")
        restore_action = runtime.calls[0][0][-1]
        self.assertIn(" restore ", f" {restore_action} ")
        self.assertIn(
            f"--expected-manifest-sha256 {self.DIGEST}", restore_action
        )
        self.assertNotIn("ansible-playbook", " ".join(runtime.calls[0][0]))
        self.assertIn("rev-parse HEAD", runtime.calls[1][0][-1])
        reconcile = runtime.calls[2][0][-1]
        self.assertIn("systemctl daemon-reload", reconcile)
        self.assertIn("kiosk-browser.service", reconcile)
        self.assertIn("status-agent.service", reconcile)

    def test_signage_rollback_reconciles_all_required_health_units(self):
        runtime = Runtime([
            manifest_marker(self._restore_result()),
            self.PREVIOUS_SHA + "\n",
            "",
        ])
        target = self._rollback_target()
        self.assertTrue(
            ansible.rollback_terminal(
                "inventory.yml",
                {"host": self.HOST, "terminalType": "signage"},
                target,
                self.RUN_ID,
                runtime=runtime,
            )
        )
        reconcile = runtime.calls[2][0][-1]
        for unit in (
            "lightdm.service",
            "signage-lite.service",
            "signage-lite-update.timer",
            "signage-lite-watchdog.timer",
            "signage-daily-reboot.timer",
            "status-agent.timer",
        ):
            self.assertIn(unit, reconcile)

    def test_rollback_rejects_tampered_reference_without_remote_mutation(self):
        target = self._rollback_target()
        target["rollbackManifest"]["path"] = "/tmp/other/manifest.json"
        runtime = Runtime("unused")
        self.assertFalse(
            ansible.rollback_terminal(
                "inventory.yml",
                {"host": self.HOST, "terminalType": "kiosk"},
                target,
                self.RUN_ID,
                runtime=runtime,
            )
        )
        self.assertEqual(runtime.calls, [])
        self.assertIn("failed:", target["rollback"])

    def test_rollback_fails_closed_when_restored_head_does_not_match(self):
        runtime = Runtime([
            manifest_marker(self._restore_result()),
            "b" * 40 + "\n",
        ])
        target = self._rollback_target()
        self.assertFalse(
            ansible.rollback_terminal(
                "inventory.yml",
                {"host": self.HOST, "terminalType": "kiosk"},
                target,
                self.RUN_ID,
                runtime=runtime,
            )
        )
        self.assertEqual(len(runtime.calls), 2)
        self.assertIn("HEAD was not restored", target["rollback"])


class ServerConfigConvergenceTest(unittest.TestCase):
    def test_uses_host_config_only_mode_and_immutable_revision(self):
        runtime = Runtime("")

        ansible.converge_server_config(
            "inventory.yml",
            "pi5",
            "a" * 40,
            "run-1",
            runtime=runtime,
        )

        command, options = runtime.calls[0]
        self.assertEqual(
            command,
            [
                "ansible-playbook",
                "-i",
                "inventory.yml",
                "/ansible/playbooks/deploy-staged.yml",
                "--limit",
                "pi5",
                "-e",
                "release_orchestrated=true release_rollback=false "
                "server_release_mode=host-config-only",
            ],
        )
        self.assertEqual(options["cwd"], runtime.ANSIBLE_DIRECTORY)
        self.assertEqual(options["env"]["ANSIBLE_REPO_VERSION"], "a" * 40)
        self.assertEqual(options["env"]["RUN_ID"], "run-1")
        self.assertEqual(options["env"]["RELEASE_ORCHESTRATED"], "1")


class TerminalReleasePlaybookTest(unittest.TestCase):
    def test_terminal_playbook_uses_release_only_mutation_profile(self):
        runtime = Runtime("")
        ansible.playbook(
            "inventory.yml",
            "kiosk-a",
            "a" * 40,
            "run-123",
            runtime=runtime,
        )
        command, options = runtime.calls[0]
        self.assertIn(
            "release_orchestrated=true release_rollback=false "
            "terminal_release_mode=release-only",
            command,
        )
        self.assertEqual(options["env"]["ANSIBLE_REPO_VERSION"], "a" * 40)

    def test_terminal_playbook_rejects_legacy_rollback_mode_without_execution(self):
        runtime = Runtime("")
        with self.assertRaisesRegex(ValueError, "sealed manifest"):
            ansible.playbook(
                "inventory.yml",
                "kiosk-a",
                "a" * 40,
                "run-123",
                rollback=True,
                runtime=runtime,
            )
        self.assertEqual(runtime.calls, [])


class SignageMaintenancePrestageTest(unittest.TestCase):
    def test_prestage_is_runtime_only_and_requires_existing_renderer(self):
        runtime = Runtime(["", "", ""])
        ansible.prestage_signage_maintenance(
            "inventory.yml",
            "signage-a",
            "run-123",
            "terminal-a",
            runtime=runtime,
        )

        self.assertEqual(len(runtime.calls), 3)
        probe = runtime.calls[0][0]
        self.assertEqual(probe[5:7], ["-m", "shell"])
        self.assertIn("command -v rsvg-convert", probe[-1])
        copy = runtime.calls[1][0]
        self.assertEqual(copy[5:7], ["-m", "copy"])
        self.assertIn(
            "dest=/run/signage/release-run-123-maintenance.svg", copy[-1]
        )
        render = runtime.calls[2][0]
        self.assertIn("/run/signage/current.tmp.jpg", render[-1])
        all_commands = "\n".join(
            " ".join(command) for command, _options in runtime.calls
        )
        self.assertNotIn("-m apt", all_commands)
        self.assertNotIn("dest=/usr/local/share", all_commands)
        self.assertEqual(
            runtime.state_calls,
            [("ack", "--run-id", "run-123", "--client", "terminal-a")],
        )

    def test_prestage_rejects_invalid_identity_before_mutation(self):
        runtime = Runtime("")
        with self.assertRaises(ValueError):
            ansible.prestage_signage_maintenance(
                "inventory.yml",
                "signage-a",
                "bad run",
                "terminal-a",
                runtime=runtime,
            )
        self.assertEqual(runtime.calls, [])


class TerminalHealthAdapterTest(unittest.TestCase):
    def test_identity_probe_executes_on_terminal_without_key_in_command(self):
        runtime = Runtime(
            'host | CHANGED => {"stdout":"TERMINAL_IDENTITY_OK:terminal-a",'
            '"stdout_lines":["TERMINAL_IDENTITY_OK:terminal-a"]}\n'
        )

        result = ansible.probe_terminal_identity(
            "inventory.yml", "kiosk-a", "terminal-a", runtime=runtime
        )

        self.assertEqual(
            result, {"authenticated": True, "statusClientId": "terminal-a"}
        )
        command, options = runtime.calls[0]
        self.assertEqual(command[0:5], ["ansible", "-i", "inventory.yml", "kiosk-a", "-b"])
        self.assertEqual(command[5:7], ["-m", "script"])
        self.assertIn("/project/scripts/deploy/terminal-identity-probe.py", command[-1])
        self.assertIn("--expected-client-id terminal-a", command[-1])
        self.assertNotIn("CLIENT_KEY", " ".join(command))
        self.assertTrue(options["capture"])

    def test_wrong_or_missing_identity_marker_fails_closed(self):
        for output in ("", "TERMINAL_IDENTITY_OK:other\n"):
            with self.subTest(output=output):
                with self.assertRaisesRegex(RuntimeError, "could not be verified"):
                    ansible.probe_terminal_identity(
                        "inventory.yml",
                        "kiosk-a",
                        "terminal-a",
                        runtime=Runtime(output),
                    )

    def test_signage_ready_proof_binds_exact_cycle_without_key_in_argv(self):
        sha = "a" * 40
        verification_id = "b" * 32
        runtime = Runtime(
            f"TERMINAL_READY_OK:{sha}\nTERMINAL_READY_OK:{sha}\n"
        )
        ansible.prove_signage_ready(
            "inventory.yml",
            "signage-a",
            "run-123",
            "terminal-a",
            sha,
            verification_id,
            runtime=runtime,
        )
        command, options = runtime.calls[0]
        self.assertEqual(command[0:7], [
            "ansible", "-i", "inventory.yml", "signage-a", "-b", "-m", "script"
        ])
        action = command[-1]
        self.assertIn("/project/scripts/deploy/terminal-ready-probe.py", action)
        self.assertIn("--run-id run-123", action)
        self.assertIn(f"--release-sha {sha}", action)
        self.assertIn(f"--verification-id {verification_id}", action)
        self.assertIn("--expected-client-id terminal-a", action)
        self.assertIn("--repo /opt/RaspberryPiSystem_002", action)
        self.assertNotIn("CLIENT_KEY", action)
        self.assertNotIn("client-key", action)
        self.assertEqual(options["cwd"], runtime.ANSIBLE_DIRECTORY)
        self.assertTrue(options["capture"])

    def test_signage_ready_proof_rejects_wrong_or_missing_marker(self):
        sha = "a" * 40
        for output in ("", "TERMINAL_READY_OK:" + "c" * 40):
            with self.subTest(output=output):
                with self.assertRaisesRegex(RuntimeError, "could not be verified"):
                    ansible.prove_signage_ready(
                        "inventory.yml",
                        "signage-a",
                        "run-123",
                        "terminal-a",
                        sha,
                        "b" * 32,
                        runtime=Runtime(output),
                    )

    def test_signage_ready_proof_validates_all_public_identifiers(self):
        invalid = (
            ("bad host", "run-123", "terminal-a", "a" * 40, "b" * 32),
            ("signage-a", "x", "terminal-a", "a" * 40, "b" * 32),
            ("signage-a", "run-123", "bad client!", "a" * 40, "b" * 32),
            ("signage-a", "run-123", "terminal-a", "main", "b" * 32),
            ("signage-a", "run-123", "terminal-a", "a" * 40, "bad"),
        )
        for host, run_id, client_id, sha, verification_id in invalid:
            with self.subTest(host=host, run_id=run_id, client_id=client_id):
                runtime = Runtime("unused")
                with self.assertRaises(ValueError):
                    ansible.prove_signage_ready(
                        "inventory.yml",
                        host,
                        run_id,
                        client_id,
                        sha,
                        verification_id,
                        runtime=runtime,
                    )
                self.assertEqual(runtime.calls, [])


class AnsibleConfigResolutionTest(unittest.TestCase):
    @unittest.skipUnless(
        shutil.which('ansible-inventory') and shutil.which('ansible-vault'),
        'Ansible executables are required',
    )
    def test_encrypted_inventory_resolves_vault_password_from_ansible_cwd(self):
        with tempfile.TemporaryDirectory() as directory:
            ansible_directory = Path(directory) / 'ansible'
            ansible_directory.mkdir()
            password = ansible_directory / '.vault-pass'
            password.write_text('test-vault-password\n', encoding='utf-8')
            (ansible_directory / 'ansible.cfg').write_text(
                '[defaults]\n'
                'vault_password_file = .vault-pass\n',
                encoding='utf-8',
            )
            group_vars = ansible_directory / 'group_vars'
            group_vars.mkdir()
            encrypted_vars = group_vars / 'all.yml'
            encrypted_vars.write_text('vault_probe: resolved-secret\n', encoding='utf-8')
            subprocess.run(
                [
                    'ansible-vault',
                    'encrypt',
                    str(encrypted_vars),
                ],
                cwd=ansible_directory,
                check=True,
                text=True,
                capture_output=True,
            )
            inventory = ansible_directory / 'inventory.yml'
            inventory.write_text(
                'all:\n  hosts:\n    local-test:\n      ansible_connection: local\n',
                encoding='utf-8',
            )

            class RealRuntime:
                ANSIBLE_DIRECTORY = ansible_directory

                @staticmethod
                def run(command, **kwargs):
                    completed = subprocess.run(
                        command,
                        cwd=kwargs.get('cwd'),
                        check=True,
                        text=True,
                        capture_output=kwargs.get('capture', False),
                    )
                    return completed.stdout if kwargs.get('capture', False) else ''

            payload = ansible.inventory_json(str(inventory), runtime=RealRuntime())

        self.assertEqual(
            json.loads(json.dumps(payload))['_meta']['hostvars']['local-test']['vault_probe'],
            'resolved-secret',
        )


if __name__ == "__main__":
    unittest.main()
