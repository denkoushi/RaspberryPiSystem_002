#!/usr/bin/env python3
from __future__ import annotations

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

    def run(self, command, **kwargs):
        self.calls.append((command, kwargs))
        if isinstance(self.result, BaseException):
            raise self.result
        return self.result


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

    def test_signage_ready_check_starts_the_oneshot_explicitly(self):
        runtime = Runtime("")
        ansible.trigger_signage_ready_check(
            "inventory.yml", "signage-a", runtime=runtime
        )
        command, options = runtime.calls[0]
        self.assertEqual(
            command,
            [
                "ansible",
                "-i",
                "inventory.yml",
                "signage-a",
                "-b",
                "-m",
                "command",
                "-a",
                "systemctl start signage-lite-update.service",
            ],
        )
        self.assertEqual(options["cwd"], runtime.ANSIBLE_DIRECTORY)


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
