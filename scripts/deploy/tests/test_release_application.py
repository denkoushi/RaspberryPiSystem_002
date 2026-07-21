#!/usr/bin/env python3
from __future__ import annotations

import argparse
import io
import json
import re
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from scripts.deploy.rolling_release import application
from scripts.deploy.rolling_release import policy
from scripts.deploy.rolling_release.backends.command import CommandResult


RUN_ID = "20260715-123456-a1b2c3"
SHA = "a" * 40


class Runtime:
    PROJECT = Path("/tmp/project")
    ANSIBLE_DIRECTORY = PROJECT / "infrastructure/ansible"
    FULL_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
    os = SimpleNamespace(environ={"RASPI_SERVER_HOST": "pi5.example"})
    subprocess = SimpleNamespace(run=lambda *_args, **_kwargs: SimpleNamespace(returncode=0))
    release_hosts = staticmethod(policy.release_hosts)

    @staticmethod
    def run(command, *, capture=False):
        return SHA if capture and "rev-parse" in command else ""

    @staticmethod
    def read_only_inventory_json(_inventory):
        return {
            "server": {"hosts": ["raspberrypi5"]},
            "clients": {"children": []},
            "kiosk": {"hosts": []},
            "signage": {"hosts": []},
            "kiosk_canary": {"hosts": []},
            "signage_canary": {"hosts": []},
            "_meta": {
                "hostvars": {
                    "raspberrypi5": {
                        "status_agent_client_id": "raspberrypi5-server"
                    }
                }
            },
        }

    @staticmethod
    def read_only_selected_hosts(_inventory, limit):
        return ["raspberrypi5"] if limit else None

    @staticmethod
    def inventory_json(_inventory):
        raise AssertionError("local launch must not use the mutating inventory adapter")

    @staticmethod
    def selected_hosts(_inventory, _limit):
        raise AssertionError("local launch must not use the mutating host selector")


def release_args(
    *,
    detach=False,
    preflight_only=False,
    limit="",
    reverify_selected=False,
):
    return argparse.Namespace(
        branch="main",
        inventory="infrastructure/ansible/inventory.yml",
        limit=limit,
        canary_hold_timeout=1800,
        emergency_override=False,
        reason=None,
        skip_canary_hold=False,
        full_fleet=False,
        reverify_selected=reverify_selected,
        detach=detach,
        preflight_only=preflight_only,
    )


class FakeSystemd:
    def __init__(
        self,
        start_result=None,
        preflight_result=None,
        terminal_preflight_result=None,
        route_preflight_result=None,
    ):
        self.start_result = start_result or CommandResult(("systemd-run",), 0)
        self.preflight_result = preflight_result or CommandResult(("migration-preflight",), 0)
        self.terminal_preflight_result = terminal_preflight_result or CommandResult(
            ("terminal-preflight",), 0
        )
        self.route_preflight_result = route_preflight_result or CommandResult(
            ("route-preflight",),
            0,
            stdout=(
                '{"version":1,"probe":"route","status":"passed",'
                '"proofs":["pi5.bootstrap-readiness"],"issues":[],"warnings":[],"metrics":{}}'
            ),
        )
        self.events = []
        self.start_specs = []

    def preflight_migrations(self, spec):
        self.events.append(("migration-preflight", spec.run_id))
        return self.preflight_result

    def preflight_terminals(self, spec, targets):
        self.events.append(("terminal-preflight", spec.run_id, len(targets)))
        return self.terminal_preflight_result

    def preflight_route(self, spec):
        self.events.append(("route-preflight", spec.run_id))
        return self.route_preflight_result

    def start(self, spec, *, wait):
        self.start_specs.append(spec)
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


class RecordingCommandRunner:
    def __init__(self):
        self.argv = None

    def run(self, argv, **_kwargs):
        self.argv = tuple(argv)
        return CommandResult(self.argv, 0, stdout="{}")


class ReleaseApplicationTest(unittest.TestCase):
    def test_local_preflight_promotes_effective_executor_and_fallback(self):
        bootstrap_observation = {
            "schemaVersion": 1,
            "attemptId": "1" * 32,
            "status": "failed",
            "phase": "python-packages",
            "failureCode": "python-packages-failed",
            "cleanup": "complete",
            "runtimeVersion": "cpython-3.11.15-20260510-ansible-core-2.19.4",
            "lockSha256": "sha256:" + "d" * 64,
            "observedAt": "2026-07-21T12:00:00Z",
        }
        executor = {
            "requestedExecutor": "stonebase-local-ansible-poc",
            "effectiveExecutor": "ssh-ansible",
            "fallbackReason": "candidate-requires-ssh-configuration",
            "runtime": None,
            "bootstrapObservation": bootstrap_observation,
        }
        terminal = CommandResult(
            ("terminal-preflight",),
            0,
            stdout=json.dumps(
                {
                    "version": 1,
                    "probe": "terminal",
                    "status": "passed",
                    "issues": [],
                    "executor": executor,
                    "targetCount": 1,
                },
                separators=(",", ":"),
            ),
        )
        route = CommandResult(
            ("route-preflight",),
            0,
            stdout=(
                '{"version":1,"probe":"route","status":"passed",'
                '"proofs":[],"issues":[],"warnings":[],"metrics":{}}'
            ),
        )
        outcome, report = application._preflight_report(
            SimpleNamespace(
                run_id=RUN_ID,
                sha=SHA,
                inventory="inventory.yml",
                limit="raspberrypi5:raspi4-kensaku-stonebase01",
                stonebase_local_ansible_poc=True,
            ),
            migration_result=CommandResult(("migration-preflight",), 0),
            route_result=route,
            terminal_result=terminal,
            selected_hosts=["raspberrypi5", "raspi4-kensaku-stonebase01"],
            selected_target_roles=[
                {"host": "raspberrypi5", "role": "server"},
                {"host": "raspi4-kensaku-stonebase01", "role": "kiosk"},
            ],
            terminal_count=1,
            planning_snapshot=None,
        )

        self.assertEqual(outcome, 0)
        self.assertEqual(report["requestedExecutor"], executor["requestedExecutor"])
        self.assertEqual(report["effectiveExecutor"], executor["effectiveExecutor"])
        self.assertEqual(report["fallbackReason"], executor["fallbackReason"])
        self.assertIsNone(report["runtimeEvidence"])
        self.assertEqual(
            report["runtimeBootstrapObservation"], bootstrap_observation
        )
        self.assertFalse(report["releaseSubmitted"])

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
                "validate_remote_server_identity",
                return_value={
                    "host": "raspberrypi5",
                    "clientId": "raspberrypi5-server",
                },
            ),
            patch.object(
                application,
                "observe",
                side_effect=observe_error,
                return_value=observed or {"runId": RUN_ID, "state": "success"},
            ),
        )
        with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patch(
            "sys.stdout", new_callable=io.StringIO
        ) as stdout:
            outcome = application.launch(release_args(detach=detach), runtime=Runtime)
        return outcome, stdout.getvalue(), systemd, control

    def test_branch_advance_after_plan_stops_before_unit_submission(self):
        systemd = FakeSystemd()
        control = FakeControl()
        runtime = type(
            "AdvancedRuntime",
            (Runtime,),
            {
                "run": staticmethod(
                    lambda command, capture=False: (
                        SHA
                        if capture and command[-1] == "origin/main"
                        else ("b" * 40 if capture and command[-1] == "HEAD" else "")
                    )
                )
            },
        )
        with patch.object(application, "_require_clean_worktree"), patch.object(
            application, "_remote_inventory", return_value="inventory.yml"
        ), patch.object(application, "build_backends", return_value=(systemd, control)):
            with self.assertRaisesRegex(RuntimeError, "local HEAD does not match"):
                application.launch(release_args(), runtime=runtime)
        self.assertEqual(systemd.events, [])

    def test_selected_reverification_is_bound_into_the_launch_spec(self):
        systemd = FakeSystemd()
        control = FakeControl()
        with patch.object(application, "_require_clean_worktree"), patch.object(
            application, "_remote_inventory", return_value="inventory.yml"
        ), patch.object(
            application, "new_run_id", return_value=RUN_ID
        ), patch.object(
            application, "build_backends", return_value=(systemd, control)
        ), patch.object(
            application,
            "validate_remote_server_identity",
            return_value={
                "host": "raspberrypi5",
                "clientId": "raspberrypi5-server",
            },
        ), patch.object(
            application,
            "observe",
            return_value={"runId": RUN_ID, "state": "success"},
        ):
            outcome = application.launch(
                release_args(
                    limit="raspberrypi5",
                    reverify_selected=True,
                ),
                runtime=Runtime,
            )

        self.assertEqual(outcome, 0)
        self.assertEqual(len(systemd.start_specs), 1)
        self.assertTrue(systemd.start_specs[0].reverify_selected)
        self.assertEqual(systemd.start_specs[0].limit, "raspberrypi5")

    def test_wrong_remote_site_stops_before_systemd_submission(self):
        systemd = FakeSystemd()
        control = FakeControl()
        with patch.object(application, "_require_clean_worktree"), patch.object(
            application, "_remote_inventory", return_value="inventory.yml"
        ), patch.object(
            application,
            "read_remote_server_client_id",
            return_value="talkplaza-pi5-server",
        ), patch.object(
            application, "build_backends", return_value=(systemd, control)
        ) as backends:
            with self.assertRaisesRegex(RuntimeError, "does not match"):
                application.launch(release_args(), runtime=Runtime)

        backends.assert_not_called()
        self.assertEqual(systemd.events, [])

    def test_static_candidate_migration_failure_stops_before_any_ssh(self):
        identity = Mock()
        backends = Mock()
        with patch.object(application, "_require_clean_worktree"), patch.object(
            application, "_remote_inventory", return_value="inventory.yml"
        ), patch.object(
            application,
            "validate_candidate_migrations",
            side_effect=RuntimeError("candidate SQL rejected"),
        ), patch.object(
            application, "validate_remote_server_identity", identity
        ), patch.object(application, "build_backends", backends):
            with self.assertRaisesRegex(RuntimeError, "candidate SQL rejected"):
                application.launch(release_args(), runtime=Runtime)

        identity.assert_not_called()
        backends.assert_not_called()

    def test_invalid_terminal_topology_stops_before_ssh_and_submission(self):
        class InvalidRuntime(Runtime):
            @staticmethod
            def read_only_inventory_json(_inventory):
                value = Runtime.read_only_inventory_json(_inventory)
                value["clients"] = {"children": ["unregistered_type"]}
                return value

        identity = Mock()
        backends = Mock()
        with patch.object(application, "_require_clean_worktree"), patch.object(
            application, "_remote_inventory", return_value="inventory.yml"
        ), patch.object(
            application, "validate_remote_server_identity", identity
        ), patch.object(application, "build_backends", backends):
            with self.assertRaisesRegex(RuntimeError, "unregistered"):
                application.launch(release_args(), runtime=InvalidRuntime)

        identity.assert_not_called()
        backends.assert_not_called()

    def test_local_launch_uses_only_read_only_inventory_adapters(self):
        systemd = FakeSystemd()
        control = FakeControl()
        read_inventory = Mock(
            side_effect=Runtime.read_only_inventory_json
        )
        read_selection = Mock(return_value=["raspberrypi5"])
        runtime = type(
            "ReadOnlyRuntime",
            (Runtime,),
            {
                "read_only_inventory_json": staticmethod(read_inventory),
                "read_only_selected_hosts": staticmethod(read_selection),
            },
        )
        patches = (
            patch.object(application, "_require_clean_worktree"),
            patch.object(application, "_remote_inventory", return_value="inventory.yml"),
            patch.object(application, "new_run_id", return_value=RUN_ID),
            patch.object(application, "build_backends", return_value=(systemd, control)),
            patch.object(
                application,
                "validate_remote_server_identity",
                return_value={
                    "host": "raspberrypi5",
                    "clientId": "raspberrypi5-server",
                },
            ),
        )
        with patches[0], patches[1], patches[2], patches[3], patches[4], patch(
            "sys.stdout", new_callable=io.StringIO
        ):
            outcome = application.launch(
                release_args(preflight_only=True, limit="raspberrypi5"),
                runtime=runtime,
            )

        self.assertEqual(outcome, 0)
        read_inventory.assert_called_once_with(
            str(Runtime.ANSIBLE_DIRECTORY / "inventory.yml")
        )
        read_selection.assert_called_once_with(
            str(Runtime.ANSIBLE_DIRECTORY / "inventory.yml"), "raspberrypi5"
        )
        self.assertEqual(
            systemd.events,
            [
                ("migration-preflight", RUN_ID),
                ("route-preflight", RUN_ID),
                ("terminal-preflight", RUN_ID, 0),
            ],
        )

    def test_remote_identity_probe_returns_only_client_id_and_never_requests_key(self):
        transport = SimpleNamespace(
            run=Mock(
                return_value=CommandResult(
                    ("ssh",), 0, stdout="raspberrypi5-server\n"
                )
            )
        )
        with patch.object(
            application,
            "build_server_transport",
            return_value=("denkon5sd02", transport),
        ):
            value = application.read_remote_server_client_id(runtime=Runtime)

        self.assertEqual(value, "raspberrypi5-server")
        command = transport.run.call_args.args[0]
        self.assertNotIn("CLIENT_KEY", "\n".join(command))
        self.assertNotIn("cat", command)

    def test_detach_returns_run_id_after_unit_acceptance(self):
        outcome, output, systemd, _control = self.launch(detach=True)
        self.assertEqual(outcome, 0)
        self.assertIn(RUN_ID, output)
        self.assertEqual(
            systemd.events,
            [
                ("migration-preflight", RUN_ID),
                ("route-preflight", RUN_ID),
                ("terminal-preflight", RUN_ID, 0),
                ("start", RUN_ID, False),
            ],
        )

    def test_production_ledger_preflight_failure_stops_before_unit_submission(self):
        systemd = FakeSystemd(
            preflight_result=CommandResult(
                ("migration-preflight",), 78, stderr="disallowed candidate SQL"
            )
        )
        control = FakeControl()
        patches = (
            patch.object(application, "_require_clean_worktree"),
            patch.object(application, "_remote_inventory", return_value="inventory.yml"),
            patch.object(application, "new_run_id", return_value=RUN_ID),
            patch.object(application, "build_backends", return_value=(systemd, control)),
            patch.object(
                application,
                "validate_remote_server_identity",
                return_value={
                    "host": "raspberrypi5",
                    "clientId": "raspberrypi5-server",
                },
            ),
        )
        with patches[0], patches[1], patches[2], patches[3], patches[4]:
            with self.assertRaisesRegex(RuntimeError, "was not submitted"):
                application.launch(release_args(), runtime=Runtime)
        self.assertEqual(
            systemd.events,
            [
                ("migration-preflight", RUN_ID),
                ("route-preflight", RUN_ID),
                ("terminal-preflight", RUN_ID, 0),
            ],
        )

    def test_preflight_only_never_submits_a_release_unit(self):
        systemd = FakeSystemd()
        control = FakeControl()
        patches = (
            patch.object(application, "_require_clean_worktree"),
            patch.object(application, "_remote_inventory", return_value="inventory.yml"),
            patch.object(application, "new_run_id", return_value=RUN_ID),
            patch.object(application, "build_backends", return_value=(systemd, control)),
            patch.object(
                application,
                "validate_remote_server_identity",
                return_value={
                    "host": "raspberrypi5",
                    "clientId": "raspberrypi5-server",
                },
            ),
        )
        with patches[0], patches[1], patches[2], patches[3], patches[4], patch(
            "sys.stdout", new_callable=io.StringIO
        ) as stdout:
            outcome = application.launch(
                release_args(preflight_only=True), runtime=Runtime
            )

        self.assertEqual(outcome, 0)
        payload = json.loads(stdout.getvalue())
        self.assertFalse(payload["releaseSubmitted"])
        self.assertEqual(payload["selectedHosts"], ["raspberrypi5"])
        self.assertEqual(payload["requestedExecutor"], "ssh-ansible")
        self.assertEqual(payload["provisionalExecutor"], "ssh-ansible")
        self.assertEqual(payload["effectiveExecutor"], "ssh-ansible")
        self.assertIsNone(payload["fallbackReason"])
        self.assertEqual(
            payload["targetPlanning"]["selectedClaimRequirements"],
            [
                {
                    "host": "raspberrypi5",
                    "role": "server",
                    "requiredClaims": ["controlPlaneApi", "controlPlaneWeb"],
                    "reason": (
                        "aggregate preflight scope; locked coordinator determines actions"
                    ),
                }
            ],
        )
        self.assertEqual(
            payload["routeCoverage"],
            [stage.id for stage in application.ROUTE_STAGES],
        )
        self.assertEqual(
            systemd.events,
            [
                ("migration-preflight", RUN_ID),
                ("route-preflight", RUN_ID),
                ("terminal-preflight", RUN_ID, 0),
            ],
        )

    def test_preflight_only_exposes_the_canonical_provisional_target_snapshot(self):
        systemd = FakeSystemd()
        control = FakeControl()
        target = {
            "host": "raspberrypi5",
            "role": "server",
            "requiredClaims": ["controlPlaneApi", "controlPlaneWeb"],
            "reason": "server impact: server-app",
        }
        snapshot = {
            "sha": SHA,
            "typedTargetPlanningEnabled": True,
            "activationExecutionEnabled": False,
            "verificationOnlyExecutionEnabled": False,
            "mutationTargets": [target],
            "activationTargets": [],
            "verificationTargets": [target],
            "terminalWork": [],
        }
        patches = (
            patch.object(application, "_require_clean_worktree"),
            patch.object(application, "_remote_inventory", return_value="inventory.yml"),
            patch.object(application, "new_run_id", return_value=RUN_ID),
            patch.object(application, "build_backends", return_value=(systemd, control)),
            patch.object(
                application,
                "validate_remote_server_identity",
                return_value={
                    "host": "raspberrypi5",
                    "clientId": "raspberrypi5-server",
                },
            ),
            patch.object(Runtime, "build_print_plan", return_value=snapshot, create=True),
        )
        with (
            patches[0],
            patches[1],
            patches[2],
            patches[3],
            patches[4],
            patches[5] as build_plan,
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            outcome = application.launch(
                release_args(preflight_only=True), runtime=Runtime
            )

        self.assertEqual(outcome, 0)
        payload = json.loads(stdout.getvalue())
        self.assertEqual(
            payload["targetPlanning"],
            {
                "status": "provisional-read-only-snapshot",
                "typedTargetPlanningEnabled": True,
                "activationExecutionEnabled": False,
                "verificationOnlyExecutionEnabled": False,
                "mutationTargets": [target],
                "activationTargets": [],
                "verificationTargets": [target],
                "terminalWork": [],
                "selectedClaimRequirements": None,
            },
        )
        build_plan.assert_called_once_with(
            "main",
            "infrastructure/ansible/inventory.yml",
            "",
            full_fleet=False,
            reverify_selected=False,
        )
        self.assertNotIn("start", [event[0] for event in systemd.events])

    def test_disabled_activation_blocks_preflight_and_executor_promotion(self):
        spec = application.LaunchSpec(
            run_id=RUN_ID,
            branch="main",
            sha=SHA,
            inventory="inventory.yml",
            expected_server_client_id="raspberrypi5-server",
            limit="",
            canary_hold_timeout=1800,
            emergency_override=False,
            reason=None,
            skip_canary_hold=False,
            full_fleet=False,
            reverify_selected=False,
        ).validate()
        passed = CommandResult(("preflight",), 0)
        route = CommandResult(
            ("route-preflight",),
            0,
            stdout=(
                '{"version":1,"probe":"route","status":"passed",'
                '"proofs":[],"issues":[],"warnings":[],"metrics":{}}'
            ),
        )
        activation = {
            "host": "kiosk-a",
            "role": "kiosk",
            "requiredClaims": ["controlPlaneWeb", "terminalRepository"],
            "reason": "controlPlaneWeb claim is stale-or-unverified",
            "activationStrategyId": "kiosk-web-activation-v1",
        }
        activation_work = {
            "host": "kiosk-a",
            "role": "kiosk",
            "mutationRequired": False,
            "activationRequired": True,
            "verificationRequired": True,
        }

        outcome, report = application._preflight_report(
            spec,
            migration_result=passed,
            route_result=route,
            terminal_result=passed,
            selected_hosts=["raspberrypi5", "kiosk-a"],
            selected_target_roles=[
                {"host": "raspberrypi5", "role": "server"},
                {"host": "kiosk-a", "role": "kiosk"},
            ],
            terminal_count=1,
            planning_snapshot={
                "typedTargetPlanningEnabled": True,
                "activationExecutionEnabled": False,
                "verificationOnlyExecutionEnabled": False,
                "mutationTargets": [],
                "activationTargets": [activation],
                "verificationTargets": [activation],
                "terminalWork": [activation_work],
            },
        )

        self.assertEqual(outcome, 78)
        self.assertEqual(report["status"], "blocked")
        self.assertIsNone(report["effectiveExecutor"])
        self.assertEqual(
            report["probes"][-1],
            {
                "probe": "activation-architecture",
                "status": "blocked",
                "exitCode": 78,
                "issues": ["activation-architecture.execution-disabled"],
            },
        )

        verification_outcome, verification_report = application._preflight_report(
            spec,
            migration_result=passed,
            route_result=route,
            terminal_result=passed,
            selected_hosts=["raspberrypi5", "kiosk-a"],
            selected_target_roles=[
                {"host": "raspberrypi5", "role": "server"},
                {"host": "kiosk-a", "role": "kiosk"},
            ],
            terminal_count=1,
            planning_snapshot={
                "typedTargetPlanningEnabled": True,
                "activationExecutionEnabled": False,
                "verificationOnlyExecutionEnabled": False,
                "mutationTargets": [],
                "activationTargets": [],
                "verificationTargets": [activation],
                "terminalWork": [
                    {
                        **activation_work,
                        "activationRequired": False,
                    }
                ],
            },
        )
        self.assertEqual(verification_outcome, 78)
        self.assertEqual(
            verification_report["probes"][-1]["probe"],
            "verification-architecture",
        )
        self.assertIsNone(verification_report["effectiveExecutor"])

    def test_enabled_typed_terminal_work_promotes_only_the_ssh_executor(self):
        spec = application.LaunchSpec(
            run_id=RUN_ID,
            branch="main",
            sha=SHA,
            inventory="inventory.yml",
            expected_server_client_id="raspberrypi5-server",
            limit="",
            canary_hold_timeout=1800,
            emergency_override=False,
            reason=None,
            skip_canary_hold=False,
            full_fleet=False,
            reverify_selected=False,
        ).validate()
        passed = CommandResult(("preflight",), 0)
        route = CommandResult(
            ("route-preflight",),
            0,
            stdout=(
                '{"version":1,"probe":"route","status":"passed",'
                '"proofs":[],"issues":[],"warnings":[],"metrics":{}}'
            ),
        )
        activation = {
            "host": "kiosk-a",
            "role": "kiosk",
            "requiredClaims": ["controlPlaneWeb", "terminalRepository"],
            "reason": "controlPlaneWeb claim is stale-or-unverified",
            "activationStrategyId": "kiosk-web-activation-v1",
        }
        activation_work = {
            "host": "kiosk-a",
            "role": "kiosk",
            "mutationRequired": False,
            "activationRequired": True,
            "verificationRequired": True,
        }

        outcome, report = application._preflight_report(
            spec,
            migration_result=passed,
            route_result=route,
            terminal_result=passed,
            selected_hosts=["raspberrypi5", "kiosk-a"],
            selected_target_roles=[
                {"host": "raspberrypi5", "role": "server"},
                {"host": "kiosk-a", "role": "kiosk"},
            ],
            terminal_count=1,
            planning_snapshot={
                "typedTargetPlanningEnabled": True,
                "activationExecutionEnabled": True,
                "verificationOnlyExecutionEnabled": True,
                "mutationTargets": [],
                "activationTargets": [activation],
                "verificationTargets": [activation],
                "terminalWork": [activation_work],
            },
        )

        self.assertEqual(outcome, 0)
        self.assertEqual(report["status"], "passed")
        self.assertEqual(report["requestedExecutor"], "ssh-ansible")
        self.assertEqual(report["provisionalExecutor"], "ssh-ansible")
        self.assertEqual(report["effectiveExecutor"], "ssh-ansible")
        self.assertIsNone(report["fallbackReason"])
        self.assertEqual(
            report["routeContract"]["scenarioId"],
            "stale-browser-activation",
        )
        self.assertIn(
            "terminal.web-activation",
            report["routeContract"]["stageIds"],
        )
        self.assertEqual(
            [probe["probe"] for probe in report["probes"]],
            ["migration", "route", "terminal"],
        )

    def test_aggregate_terminal_preflight_failure_stops_before_unit_submission(self):
        systemd = FakeSystemd(
            terminal_preflight_result=CommandResult(
                ("terminal-preflight",),
                78,
                stderr=(
                    "- kiosk-a: unit.pcscd.socket.active\n"
                    "- kiosk-a: package.pcsc-tools\n"
                ),
            )
        )
        control = FakeControl()
        patches = (
            patch.object(application, "_require_clean_worktree"),
            patch.object(application, "_remote_inventory", return_value="inventory.yml"),
            patch.object(application, "new_run_id", return_value=RUN_ID),
            patch.object(application, "build_backends", return_value=(systemd, control)),
            patch.object(
                application,
                "validate_remote_server_identity",
                return_value={
                    "host": "raspberrypi5",
                    "clientId": "raspberrypi5-server",
                },
            ),
        )
        with patches[0], patches[1], patches[2], patches[3], patches[4]:
            with self.assertRaisesRegex(RuntimeError, "aggregate preflight blocked"):
                application.launch(release_args(), runtime=Runtime)
        self.assertEqual(
            systemd.events,
            [
                ("migration-preflight", RUN_ID),
                ("route-preflight", RUN_ID),
                ("terminal-preflight", RUN_ID, 0),
            ],
        )

    def test_foreground_maps_reconciled_terminal_states(self):
        for state, expected in (("success", 0), ("cancelled", 130), ("failed", 1)):
            with self.subTest(state=state):
                outcome, _output, systemd, _control = self.launch(
                    observed={"runId": RUN_ID, "state": state}
                )
                self.assertEqual(outcome, expected)
                self.assertEqual(
                    systemd.events,
                    [
                        ("migration-preflight", RUN_ID),
                        ("route-preflight", RUN_ID),
                        ("terminal-preflight", RUN_ID, 0),
                        ("start", RUN_ID, True),
                    ],
                )

    def test_preflight_only_aggregates_blockers_and_incomplete_probes(self):
        systemd = FakeSystemd(
            preflight_result=CommandResult(
                ("migration-preflight",), 78, stderr="migration.blocked"
            ),
            terminal_preflight_result=CommandResult(
                ("terminal-preflight",), 78, stderr="terminal.blocked"
            ),
            route_preflight_result=CommandResult(
                ("route-preflight",),
                70,
                stdout=(
                    '{"version":1,"probe":"route","status":"incomplete",'
                    '"proofs":[],"issues":["route.internal-error"],"warnings":[],"metrics":{}}'
                ),
            ),
        )
        control = FakeControl()
        patches = (
            patch.object(application, "_require_clean_worktree"),
            patch.object(application, "_remote_inventory", return_value="inventory.yml"),
            patch.object(application, "new_run_id", return_value=RUN_ID),
            patch.object(application, "build_backends", return_value=(systemd, control)),
            patch.object(
                application,
                "validate_remote_server_identity",
                return_value={
                    "host": "raspberrypi5",
                    "clientId": "raspberrypi5-server",
                },
            ),
        )
        with patches[0], patches[1], patches[2], patches[3], patches[4], patch(
            "sys.stdout", new_callable=io.StringIO
        ) as stdout:
            outcome = application.launch(
                release_args(preflight_only=True), runtime=Runtime
            )

        payload = json.loads(stdout.getvalue())
        self.assertEqual(outcome, 70)
        self.assertEqual(payload["status"], "incomplete")
        self.assertIsNone(payload["effectiveExecutor"])
        self.assertEqual(
            [probe["status"] for probe in payload["probes"]],
            ["blocked", "incomplete", "blocked"],
        )
        self.assertEqual(
            systemd.events,
            [
                ("migration-preflight", RUN_ID),
                ("route-preflight", RUN_ID),
                ("terminal-preflight", RUN_ID, 0),
            ],
        )

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

    def test_server_transport_normalizes_ip_and_honors_configured_options(self):
        runtime = SimpleNamespace(
            os=SimpleNamespace(
                environ={
                    "RASPI_SERVER_HOST": "100.64.1.2",
                    "RASPI_SERVER_SSH_OPTS": "-o ServerAliveInterval=7 -p 2222",
                }
            )
        )
        runner = RecordingCommandRunner()

        remote_user, transport = application.build_server_transport(
            runtime, runner=runner
        )
        transport.run(["cat", "/tmp/state.json"])

        self.assertEqual(remote_user, application.DEFAULT_REMOTE_USER)
        self.assertEqual(
            runner.argv,
            (
                "ssh",
                "-o",
                "BatchMode=yes",
                "-o",
                "ConnectTimeout=15",
                "-o",
                "ServerAliveInterval=7",
                "-p",
                "2222",
                "--",
                f"{application.DEFAULT_REMOTE_USER}@100.64.1.2",
                "cat /tmp/state.json",
            ),
        )


if __name__ == "__main__":
    unittest.main()
