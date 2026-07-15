#!/usr/bin/env python3
from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path

from scripts.deploy.rolling_release import remote_control


RUN_ID = "20260715-123456-a1b2c3"


def result(returncode=0, stdout="", stderr=""):
    return subprocess.CompletedProcess((), returncode, stdout=stdout, stderr=stderr)


def active_result():
    return result(0, "LoadState=loaded\nActiveState=active\n")


class RemoteControlTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.project = Path(self.temporary.name)

    def tearDown(self):
        self.temporary.cleanup()

    def test_snapshot_of_unknown_run_is_read_only(self):
        self.assertEqual(
            remote_control.snapshot(self.project, RUN_ID),
            {"state": None, "control": None},
        )
        self.assertFalse((self.project / "logs").exists())

    def test_unlocked_pre_pr4_run_state_remains_readable_without_mutation(self):
        state_path, _control_path, lock_path = remote_control.paths(self.project, RUN_ID)
        state_path.parent.mkdir(parents=True)
        state_path.write_text(
            json.dumps({"runId": RUN_ID, "state": "success", "exitCode": "0"}),
            encoding="utf-8",
        )

        snapshot = remote_control.snapshot(self.project, RUN_ID)

        self.assertEqual(snapshot["state"]["state"], "success")
        self.assertEqual(
            snapshot["state"]["compatibility"]["source"],
            "unlocked-release-run-state",
        )
        self.assertFalse(lock_path.exists())

    def test_legacy_shell_status_snapshot_is_an_explicit_read_only_fallback(self):
        path = remote_control.legacy_shell_state_path(self.project, RUN_ID)
        path.parent.mkdir(parents=True)
        path.write_text(
            json.dumps({"runId": RUN_ID, "state": "failed", "exitCode": "1"}),
            encoding="utf-8",
        )

        snapshot = remote_control.snapshot(self.project, RUN_ID)

        self.assertEqual(snapshot["state"]["state"], "failed")
        self.assertEqual(
            snapshot["state"]["compatibility"]["source"],
            "ansible-update-status",
        )
        self.assertFalse(remote_control.paths(self.project, RUN_ID)[2].exists())

    def test_control_without_lock_never_uses_the_legacy_fallback(self):
        _state_path, control_path, _lock_path = remote_control.paths(self.project, RUN_ID)
        control_path.parent.mkdir(parents=True)
        control_path.write_text(json.dumps({"runId": RUN_ID}), encoding="utf-8")

        with self.assertRaisesRegex(remote_control.RemoteControlError, "without its per-run lock"):
            remote_control.snapshot(self.project, RUN_ID)

    def test_locked_current_records_are_strictly_validated(self):
        state_path, control_path, lock_path = remote_control.paths(self.project, RUN_ID)
        state_path.parent.mkdir(parents=True)
        lock_path.touch()
        state_path.write_text(
            json.dumps({"runId": RUN_ID, "state": "success"}),
            encoding="utf-8",
        )
        with self.assertRaisesRegex(remote_control.RemoteControlError, "state is malformed"):
            remote_control.snapshot(self.project, RUN_ID)

        state_path.write_text(
            json.dumps({"version": 1, "runId": RUN_ID, "state": "running"}),
            encoding="utf-8",
        )
        control_path.write_text(
            json.dumps({"version": 1, "runId": RUN_ID, "reason": "stop"}),
            encoding="utf-8",
        )
        with self.assertRaisesRegex(remote_control.RemoteControlError, "control record is malformed"):
            remote_control.snapshot(self.project, RUN_ID)

    def test_cancel_uses_system_manager_and_keeps_first_reason(self):
        commands = []

        def run_command(argv):
            commands.append(tuple(argv))
            return active_result()

        first = remote_control.request_cancel(
            self.project, RUN_ID, "first reason", run_command=run_command
        )
        second = remote_control.request_cancel(
            self.project, RUN_ID, "replacement", run_command=run_command
        )

        self.assertTrue(first["created"])
        self.assertFalse(second["created"])
        self.assertEqual(second["record"]["reason"], "first reason")
        self.assertTrue(commands)
        self.assertEqual(
            commands[0][:3],
            (remote_control.SUDO, "-n", remote_control.SYSTEMCTL),
        )

    def test_terminal_state_rejects_late_cancel(self):
        state_path, _control_path, lock_path = remote_control.paths(self.project, RUN_ID)
        state_path.parent.mkdir(parents=True)
        lock_path.touch()
        state_path.write_text(
            json.dumps({"version": 1, "runId": RUN_ID, "state": "success"}),
            encoding="utf-8",
        )

        with self.assertRaisesRegex(remote_control.RemoteControlError, "already terminal"):
            remote_control.request_cancel(
                self.project, RUN_ID, "too late", run_command=lambda _argv: active_result()
            )
        self.assertFalse(remote_control.paths(self.project, RUN_ID)[1].exists())

    def test_cancel_wins_before_approval_and_helper_is_not_called(self):
        helper_called = []

        def run_command(argv):
            if remote_control.SYSTEMCTL in argv:
                return active_result()
            helper_called.append(tuple(argv))
            return result()

        remote_control.request_cancel(
            self.project, RUN_ID, "safe stop", run_command=run_command
        )
        with self.assertRaisesRegex(remote_control.RemoteControlError, "cancellation is already recorded"):
            remote_control.approve(
                self.project,
                RUN_ID,
                remote_control.OPERATOR_CANARY_APPROVAL_CLIENT,
                run_command=run_command,
            )
        self.assertEqual(helper_called, [])

    def test_approval_first_is_linearized_before_later_cancel(self):
        commands = []

        def run_command(argv):
            commands.append(tuple(argv))
            if remote_control.SYSTEMCTL in argv:
                return active_result()
            return result()

        approved = remote_control.approve(
            self.project,
            RUN_ID,
            remote_control.OPERATOR_CANARY_APPROVAL_CLIENT,
            run_command=run_command,
        )
        cancelled = remote_control.request_cancel(
            self.project, RUN_ID, "stop after approval", run_command=run_command
        )

        self.assertTrue(approved["approved"])
        self.assertTrue(cancelled["created"])
        helper = [command for command in commands if remote_control.SYSTEMCTL not in command]
        self.assertEqual(len(helper), 1)
        self.assertIn("deploy-status-state.py", helper[0][1])


if __name__ == "__main__":
    unittest.main()
