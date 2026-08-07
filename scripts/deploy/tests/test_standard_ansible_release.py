from __future__ import annotations

import argparse
import fcntl
import importlib.util
import io
import json
import os
import subprocess
import sys
import tempfile
import types
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

from scripts.deploy.rolling_release import bootstrap


ROOT = Path(__file__).resolve().parents[3]
DEPLOY = ROOT / "scripts/deploy"
SCRIPT = DEPLOY / "standard-ansible-release.py"
sys.path.insert(0, str(DEPLOY))
SPEC = importlib.util.spec_from_file_location("standard_ansible_release", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)

SHA = "a" * 40
RUN_ID = "20260808-010203-abcdef"


def completed(command: list[str], stdout: str = "", returncode: int = 0) -> subprocess.CompletedProcess[str]:
    return subprocess.CompletedProcess(command, returncode, stdout=stdout, stderr="")


class StandardAnsibleReleaseTests(unittest.TestCase):
    def test_parser_rejects_legacy_admission_and_implicit_mutation(self) -> None:
        with self.assertRaisesRegex(MODULE.UsageError, "unsupported"):
            MODULE.parse_arguments(["main", MODULE.DEFAULT_INVENTORY, "--approve", RUN_ID])
        with self.assertRaisesRegex(MODULE.UsageError, "explicit --limit"):
            MODULE.parse_arguments(["main", MODULE.DEFAULT_INVENTORY])

        args = MODULE.parse_arguments(
            ["--branch", "main", "--inventory", MODULE.DEFAULT_INVENTORY, "--full-fleet"]
        )
        self.assertTrue(args.full_fleet)

        with self.assertRaisesRegex(MODULE.UsageError, "internal mutation"):
            MODULE.parse_arguments(
                [
                    "--execute-standard-route", "--branch", "main",
                    "--inventory", MODULE.DEFAULT_INVENTORY, "--sha", SHA,
                    "--run-id", RUN_ID, "--profiles", "pi4",
                ]
            )

    def test_target_selection_rejects_empty_and_unsupported_hosts(self) -> None:
        with self.assertRaisesRegex(MODULE.UsageError, "matched no hosts"):
            MODULE.selected_profiles({"_meta": {"hostvars": {}}})
        with self.assertRaisesRegex(MODULE.UsageError, "outside server/kiosk/signage"):
            MODULE.selected_profiles(
                {"_meta": {"hostvars": {"other": {}}}, "other_group": {"hosts": ["other"]}}
            )

        self.assertEqual(
            MODULE.selected_profiles(
                {
                    "_meta": {"hostvars": {"pi4-b": {}, "pi4-a": {}}},
                    "kiosk": {"hosts": ["pi4-b", "pi4-a", "not-selected"]},
                }
            ),
            (("pi4", ("pi4-b", "pi4-a")),),
        )

    def test_ansible_argv_is_exact_and_contains_no_legacy_inputs(self) -> None:
        variables = {
            "release_sha": SHA,
            "release_run_id": RUN_ID,
            "release_signage_artifact_sha256": "b" * 64,
        }
        command = MODULE.ansible_argv(
            MODULE.DEFAULT_INVENTORY, "pi4-a", ("pi4",), variables
        )

        self.assertEqual(command[0], "ansible-playbook")
        self.assertEqual(command[1:3], ["-i", MODULE.DEFAULT_INVENTORY])
        self.assertIn("deploy-release-standard.yml", command[3])
        self.assertEqual(command[command.index("--tags") + 1], "pi4")
        self.assertEqual(command[-2:], ["--limit", "pi4-a"])
        payload = json.loads(command[command.index("--extra-vars") + 1])
        self.assertEqual(payload, variables)
        self.assertFalse(
            {"approve", "claims", "readiness", "fleet_state"} & set(payload)
        )

    def test_release_set_scratch_image_uses_explicit_harmless_command(self) -> None:
        commands: list[list[str]] = []
        release = types.SimpleNamespace(
            api=types.SimpleNamespace(
                repository="ghcr.io/denkoushi/raspisys-api",
                digest="sha256:" + "1" * 64,
            ),
            web=types.SimpleNamespace(
                repository="ghcr.io/denkoushi/raspisys-web",
                digest="sha256:" + "2" * 64,
            ),
        )

        def fake_run(command: list[str], **_: object) -> subprocess.CompletedProcess[str]:
            commands.append(command)
            if command[1] == "create":
                return completed(command, "release-set-container\n")
            if command[1] == "cp":
                Path(command[-1]).write_text("{}", encoding="utf-8")
            return completed(command)

        with mock.patch.object(MODULE, "config_hash", return_value="b" * 64), mock.patch.object(
            MODULE, "parse_release_set", return_value=release
        ), mock.patch.object(MODULE, "validate_release_set"), mock.patch.object(
            MODULE, "run", side_effect=fake_run
        ):
            MODULE.release_set_images(SHA, ROOT / MODULE.DEFAULT_INVENTORY)

        create = next(command for command in commands if command[1] == "create")
        self.assertEqual(create[-1], "/release-set.json")

    def test_print_plan_only_lists_ansible_hosts_and_tasks(self) -> None:
        args = argparse.Namespace(
            branch="main", limit="pi4-a", full_fleet=False
        )
        commands: list[list[str]] = []

        def fake_run(command: list[str], **_: object) -> subprocess.CompletedProcess[str]:
            commands.append(command)
            return completed(command)

        with mock.patch.object(MODULE, "run", side_effect=fake_run):
            document = MODULE.plan(
                args,
                SHA,
                ROOT / MODULE.DEFAULT_INVENTORY,
                MODULE.DEFAULT_INVENTORY,
                (("pi4", ("pi4-a",)),),
            )

        self.assertEqual(document["executionOrder"][0]["hosts"], ["pi4-a"])
        self.assertEqual(len(commands), 2)
        self.assertEqual({command[-1] for command in commands}, {"--list-hosts", "--list-tasks"})
        self.assertTrue(all(command[0] == "ansible-playbook" for command in commands))

    def test_detach_uses_existing_transient_systemd_primitive(self) -> None:
        args = argparse.Namespace(
            branch="main", inventory=MODULE.DEFAULT_INVENTORY, limit="pi4-a",
            full_fleet=False, detach=True,
        )
        command = MODULE.systemd_argv(
            args, SHA, RUN_ID, MODULE.DEFAULT_INVENTORY, ("pi4",), "pi"
        )
        rendered = " ".join(command)

        self.assertEqual(command[:4], ["/usr/bin/sudo", "-n", "/usr/bin/systemd-run", "--quiet"])
        self.assertNotIn("--wait", command)
        self.assertIn("--property=RemainAfterExit=yes", command)
        self.assertIn("--property=Type=exec", command)
        self.assertIn("git checkout --detach", rendered)
        self.assertIn("--execute-standard-route", rendered)
        self.assertNotIn("rolling-release.py", rendered)

        foreground = argparse.Namespace(**{**vars(args), "detach": False})
        foreground_command = MODULE.systemd_argv(
            foreground, SHA, RUN_ID, MODULE.DEFAULT_INVENTORY, ("pi4",), "pi"
        )
        self.assertIn("--wait", foreground_command)
        self.assertNotIn("--property=RemainAfterExit=yes", foreground_command)

    def test_standard_route_contends_with_legacy_global_lock_before_git(self) -> None:
        args = argparse.Namespace(
            branch="main", inventory=MODULE.DEFAULT_INVENTORY, limit="pi4-a",
            full_fleet=False, detach=True,
        )
        script = MODULE.remote_script(
            args, SHA, RUN_ID, MODULE.DEFAULT_INVENTORY, ("pi4",)
        )
        self.assertNotIn(".standard-ansible-release.lock", script)
        self.assertLess(
            script.index("fleet-release-state.lock"), script.index("git fetch")
        )
        self.assertIn("/usr/bin/flock -n 9", script)
        self.assertEqual(script.count('test -z "$(git status --porcelain)"'), 2)
        self.assertIn(f'test "$(git rev-parse HEAD)" = {SHA}', script)

        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory)
            lock_path = project / "logs/deploy/fleet-release-state.lock"
            lock_path.parent.mkdir(parents=True)
            descriptor = os.open(lock_path, os.O_WRONLY | os.O_CREAT, 0o600)
            marker = project / "git-was-reached"
            try:
                fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
                contender = subprocess.run(
                    [
                        sys.executable,
                        "-c",
                        "import fcntl,os,sys; "
                        "fd=os.open(sys.argv[1],os.O_WRONLY); "
                        "\ntry: fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)"
                        "\nexcept BlockingIOError: raise SystemExit(75)"
                        "\nopen(sys.argv[2],'w').close()",
                        str(lock_path),
                        str(marker),
                    ],
                    check=False,
                )
                self.assertEqual(contender.returncode, bootstrap.EX_TEMPFAIL)
                self.assertFalse(marker.exists())
            finally:
                fcntl.flock(descriptor, fcntl.LOCK_UN)
                os.close(descriptor)

    def test_status_reads_only_systemd_and_journal(self) -> None:
        args = argparse.Namespace(inventory=MODULE.DEFAULT_INVENTORY, status=RUN_ID)
        inventory = {
            "server": {"hosts": ["pi5"]},
            "_meta": {"hostvars": {"pi5": {"ansible_host": "pi5.local", "ansible_user": "pi"}}},
        }
        calls: list[list[str]] = []

        def fake_run(command: list[str], **_: object) -> subprocess.CompletedProcess[str]:
            calls.append(command)
            if "systemctl" in command[-1]:
                return completed(command, "LoadState=loaded\nActiveState=inactive\nResult=success\nExecMainStatus=0\n")
            return completed(command, "one journal line\n")

        with mock.patch.object(MODULE, "inventory_path", return_value=(Path("inventory.yml"), MODULE.DEFAULT_INVENTORY)), mock.patch.object(
            MODULE, "inventory_document", return_value=inventory
        ), mock.patch.object(MODULE, "run", side_effect=fake_run), redirect_stdout(io.StringIO()) as output:
            self.assertEqual(MODULE.status(args), 0)

        payload = json.loads(output.getvalue())
        self.assertEqual(payload["status"]["Result"], "success")
        self.assertEqual(len(calls), 2)
        self.assertIn("systemctl show", calls[0][-1])
        self.assertIn("journalctl", calls[1][-1])

    def test_status_rejects_missing_unit(self) -> None:
        args = argparse.Namespace(inventory=MODULE.DEFAULT_INVENTORY, status=RUN_ID)
        inventory = {
            "server": {"hosts": ["pi5"]},
            "_meta": {"hostvars": {"pi5": {"ansible_host": "pi5.local", "ansible_user": "pi"}}},
        }
        responses = [
            completed([], "LoadState=not-found\nActiveState=inactive\nResult=\n"),
            completed([]),
        ]
        with mock.patch.object(MODULE, "inventory_path", return_value=(Path("inventory.yml"), MODULE.DEFAULT_INVENTORY)), mock.patch.object(
            MODULE, "inventory_document", return_value=inventory
        ), mock.patch.object(MODULE, "run", side_effect=responses), redirect_stdout(io.StringIO()):
            self.assertEqual(MODULE.status(args), 1)

    def test_launch_result_status_command_preserves_custom_inventory(self) -> None:
        relative = "infrastructure/ansible/custom inventory.yml"
        args = argparse.Namespace(
            execute_standard_route=False, status=None, inventory=relative,
            branch="main", limit="pi4-b", full_fleet=False,
            print_plan=False, detach=True,
        )
        complete = {
            "server": {"hosts": ["pi5"]},
            "kiosk": {"hosts": ["pi4-b"]},
            "_meta": {
                "hostvars": {
                    "pi5": {"ansible_host": "pi5.local", "ansible_user": "pi"},
                    "pi4-b": {},
                }
            },
        }
        selected = {
            "kiosk": {"hosts": ["pi4-b"]},
            "_meta": {"hostvars": {"pi4-b": {}}},
        }
        with mock.patch.object(MODULE, "parse_arguments", return_value=args), mock.patch.object(
            MODULE, "inventory_path", return_value=(Path("inventory.yml"), relative)
        ), mock.patch.object(MODULE, "resolve_sha", return_value=SHA), mock.patch.object(
            MODULE, "inventory_document", side_effect=[complete, selected]
        ), mock.patch.object(MODULE, "new_run_id", return_value=RUN_ID), mock.patch.object(
            MODULE, "run", return_value=completed(["ssh"])
        ), redirect_stdout(io.StringIO()) as output:
            self.assertEqual(MODULE.main([]), 0)

        payload = json.loads(output.getvalue())
        self.assertEqual(
            payload["statusCommand"],
            f"scripts/update-all-clients.sh --status {RUN_ID} --inventory '{relative}'",
        )


if __name__ == "__main__":
    unittest.main()
