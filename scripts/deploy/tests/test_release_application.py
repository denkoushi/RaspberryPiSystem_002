#!/usr/bin/env python3
from __future__ import annotations

import argparse
import io
import re
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from scripts.deploy.rolling_release import application
from scripts.deploy.rolling_release.backends.command import CommandResult


RUN_ID = "20260715-123456-a1b2c3"
SHA = "a" * 40


class Runtime:
    PROJECT = Path("/tmp/project")
    ANSIBLE_DIRECTORY = PROJECT / "infrastructure/ansible"
    FULL_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
    os = SimpleNamespace(environ={"RASPI_SERVER_HOST": "pi5.example"})
    subprocess = SimpleNamespace(run=lambda *_args, **_kwargs: SimpleNamespace(returncode=0))

    @staticmethod
    def run(command, *, capture=False):
        return SHA if capture and "rev-parse" in command else ""


def release_args(*, detach=False):
    return argparse.Namespace(
        branch="main",
        inventory="infrastructure/ansible/inventory.yml",
        limit="",
        canary_hold_timeout=1800,
        emergency_override=False,
        reason=None,
        skip_canary_hold=False,
        auto_minimize=False,
        detach=detach,
    )


class FakeSystemd:
    def __init__(self, start_result=None):
        self.start_result = start_result or CommandResult(("systemd-run",), 0)
        self.events = []

    def start(self, spec, *, wait):
        self.events.append(("start", spec.run_id, wait))
        return self.start_result

    def signal_cancel(self, run_id):
        self.events.append(("signal", run_id))
        return CommandResult(("systemctl",), 0)


class FakeControl:
    def __init__(self):
        self.events = []

    def request_cancel(self, run_id, reason):
        self.events.append(("control", run_id, reason))
        return {"created": True, "record": {"reason": reason}}

    def approve(self, run_id, client):
        self.events.append(("approve", run_id, client))
        return {"runId": run_id, "approved": True}


class ReleaseApplicationTest(unittest.TestCase):
    def launch(self, *, detach=False, start_result=None, observed=None, observe_error=None):
        systemd = FakeSystemd(start_result)
        control = FakeControl()
        patches = (
            patch.object(application, "_require_clean_worktree"),
            patch.object(application, "_remote_inventory", return_value="inventory.yml"),
            patch.object(application, "new_run_id", return_value=RUN_ID),
            patch.object(application, "build_backends", return_value=(systemd, control)),
            patch.object(
                application,
                "observe",
                side_effect=observe_error,
                return_value=observed or {"runId": RUN_ID, "state": "success"},
            ),
        )
        with patches[0], patches[1], patches[2], patches[3], patches[4], patch(
            "sys.stdout", new_callable=io.StringIO
        ) as stdout:
            outcome = application.launch(release_args(detach=detach), runtime=Runtime)
        return outcome, stdout.getvalue(), systemd, control

    def test_detach_returns_run_id_after_unit_acceptance(self):
        outcome, output, systemd, _control = self.launch(detach=True)
        self.assertEqual(outcome, 0)
        self.assertIn(RUN_ID, output)
        self.assertEqual(systemd.events, [("start", RUN_ID, False)])

    def test_foreground_maps_reconciled_terminal_states(self):
        for state, expected in (("success", 0), ("cancelled", 130), ("failed", 1)):
            with self.subTest(state=state):
                outcome, _output, systemd, _control = self.launch(
                    observed={"runId": RUN_ID, "state": state}
                )
                self.assertEqual(outcome, expected)
                self.assertEqual(systemd.events, [("start", RUN_ID, True)])

    def test_uncertain_submission_and_observation_errors_always_name_run_id(self):
        rejected = CommandResult(("ssh",), 255, stderr="connection lost")
        with self.assertRaisesRegex(RuntimeError, RUN_ID):
            self.launch(detach=True, start_result=rejected)
        with self.assertRaisesRegex(RuntimeError, RUN_ID):
            self.launch(observe_error=RuntimeError("systemd unavailable"))

    def test_cancel_records_control_before_signalling(self):
        systemd = FakeSystemd()
        control = FakeControl()
        events = []
        control.request_cancel = lambda run_id, reason: (
            events.append("control")
            or {"created": True, "record": {"reason": reason}}
        )
        systemd.signal_cancel = lambda run_id: (
            events.append("signal") or CommandResult(("systemctl",), 0)
        )
        with patch.object(application, "build_backends", return_value=(systemd, control)), patch.object(
            application,
            "observe",
            return_value={"runId": RUN_ID, "state": "running", "phase": "deploying"},
        ), patch("sys.stdout", new_callable=io.StringIO):
            self.assertEqual(application.cancel(RUN_ID, "safe stop", runtime=Runtime), 0)
        self.assertEqual(events, ["control", "signal"])


if __name__ == "__main__":
    unittest.main()
