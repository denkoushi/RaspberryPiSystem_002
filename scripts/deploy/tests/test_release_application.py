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

    @staticmethod
    def build_print_plan(
        _branch,
        _inventory,
        _limit,
        *,
        full_fleet=False,
        reverify_selected=False,
    ):
        return {
            "sha": SHA,
            "classificationComponents": ["neutral"],
            "pi5Required": False,
            "fullFleet": full_fleet,
            "reverifySelected": reverify_selected,
            "typedTargetPlanningEnabled": True,
            "activationExecutionEnabled": True,
            "verificationOnlyExecutionEnabled": True,
            "mutationTargets": [],
            "activationTargets": [],
            "verificationTargets": [],
            "terminalWork": [],
        }


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


def terminal_passed_result(*hosts: str) -> CommandResult:
    return CommandResult(
        ("terminal-preflight",),
        0,
        stdout=json.dumps(
            {
                "version": 2,
                "probe": "terminal",
                "capability": "terminal.selected-prerequisites",
                "status": "passed",
                "proofs": ["terminal.exact-work-target-prerequisites"],
                "issues": [],
                "warnings": [],
                "targets": [
                    {
                        "host": host,
                        "profile": "kiosk",
                        "status": "passed",
                        "issues": [],
                    }
                    for host in hosts
                ],
            }
        ),
    )


def route_passed_result(*, external: bool = False) -> CommandResult:
    required = (
        list(application.BUILD_EXTERNAL_DEPENDENCY_IDS) if external else []
    )
    return CommandResult(
        ("route-preflight",),
        0,
        stdout=json.dumps(
            {
                "version": 2,
                "probe": "route",
                "status": "passed",
                "proofs": ["pi5.bootstrap-readiness"],
                "issues": [],
                "warnings": [],
                "metrics": {},
                "externalDependencies": {
                    "required": required,
                    "rounds": 3,
                    "successes": {value: 3 for value in required},
                },
            }
        ),
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
        self.preflight_result = preflight_result or CommandResult(
            ("migration-preflight",),
            0,
            stdout=(
                '{"version":2,"probe":"migration",'
                '"capability":"migration.production-ledger","host":"pi5",'
                '"status":"passed","proofs":["migration.production-ledger"],'
                '"issues":[],"warnings":[]}'
            ),
        )
        self.terminal_preflight_result = terminal_preflight_result or CommandResult(
            ("terminal-preflight",),
            0,
            stdout=(
                '{"version":2,"probe":"terminal",'
                '"capability":"terminal.selected-prerequisites",'
                '"status":"passed","proofs":[],"issues":[],"warnings":[],'
                '"targets":[]}'
            ),
        )
        self.route_preflight_result = route_preflight_result or CommandResult(
            ("route-preflight",),
            0,
            stdout=(
                '{"version":2,"probe":"route","status":"passed",'
                '"proofs":["pi5.bootstrap-readiness"],"issues":[],"warnings":[],'
                '"metrics":{},"externalDependencies":{"required":[],"rounds":3,"successes":{}}}'
            ),
        )
        self.events = []
        self.start_specs = []
        self.route_external_dependencies = []

    def preflight_migrations(self, spec):
        self.events.append(("migration-preflight", spec.run_id))
        return self.preflight_result

    def preflight_terminals(self, spec, targets):
        self.events.append(("terminal-preflight", spec.run_id, len(targets)))
        return self.terminal_preflight_result

    def preflight_route(self, spec, required_external_dependencies=()):
        self.events.append(("route-preflight", spec.run_id))
        self.route_external_dependencies.append(
            tuple(required_external_dependencies)
        )
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
        self.assertIsNotNone(systemd.start_specs[0].readiness_admission)
        self.assertRegex(
            systemd.start_specs[0].readiness_admission["scopeDigest"],
            r"^sha256:[0-9a-f]{64}$",
        )
        self.assertEqual(
            systemd.events,
            [
                ("migration-preflight", RUN_ID),
                ("route-preflight", RUN_ID),
                ("start", RUN_ID, False),
            ],
        )

    def test_terminal_preflight_uses_only_six_exact_kiosk_work_hosts(self):
        terminal_report = {
            "version": 2,
            "probe": "terminal",
            "capability": "terminal.selected-prerequisites",
            "status": "passed",
            "proofs": ["terminal.exact-work-target-prerequisites"],
            "issues": [],
            "warnings": [],
            "targets": [
                {
                    "host": f"kiosk-{index}",
                    "profile": "kiosk",
                    "status": "passed",
                    "issues": [],
                }
                for index in range(1, 7)
            ],
        }
        systemd = FakeSystemd(
            terminal_preflight_result=CommandResult(
                ("terminal-preflight",),
                0,
                stdout=json.dumps(terminal_report),
            )
        )
        control = FakeControl()
        terminal_work = [
            {
                "host": f"kiosk-{index}",
                "role": "kiosk",
                "mutationRequired": True,
                "activationRequired": False,
                "verificationRequired": True,
                "activationStrategyId": None,
                "activationMode": None,
                "claimRequirements": [{"kind": "terminalRepository"}],
            }
            for index in range(1, 7)
        ]
        snapshot = {
            **Runtime.build_print_plan("main", "inventory.yml", ""),
            "classificationComponents": ["torque-agent"],
            "terminalWork": terminal_work,
        }
        runtime = type(
            "SixKioskRuntime",
            (Runtime,),
            {"build_print_plan": staticmethod(lambda *_args, **_kwargs: snapshot)},
        )
        captured = Mock(
            return_value=[
                {"host": f"kiosk-{index}"} for index in range(1, 7)
            ]
        )
        with patch.object(
            application, "_require_clean_worktree"
        ), patch.object(
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
            application, "build_target_contracts", captured
        ), patch(
            "sys.stdout", new_callable=io.StringIO
        ):
            outcome = application.launch(
                release_args(preflight_only=True), runtime=runtime
            )

        self.assertEqual(outcome, 0)
        target_roles = captured.call_args.args[1]
        self.assertEqual(
            [target["host"] for target in target_roles],
            [f"kiosk-{index}" for index in range(1, 7)],
        )
        self.assertNotIn("raspberrypi3-signage", json.dumps(target_roles))
        self.assertIn(("terminal-preflight", RUN_ID, 6), systemd.events)

    def test_production_ledger_preflight_failure_stops_before_unit_submission(self):
        systemd = FakeSystemd(
            preflight_result=CommandResult(
                ("migration-preflight",),
                78,
                stdout=(
                    '{"version":2,"probe":"migration",'
                    '"capability":"migration.production-ledger","host":"pi5",'
                    '"status":"blocked","proofs":[],"warnings":[],'
                    '"issues":[{"code":"migration.production-ledger-rejected",'
                    '"host":"pi5","capability":"migration.production-ledger"}]}'
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
            with self.assertRaisesRegex(RuntimeError, "was not submitted"):
                application.launch(release_args(), runtime=Runtime)
        self.assertEqual(
            systemd.events,
            [
                ("migration-preflight", RUN_ID),
                ("route-preflight", RUN_ID),
            ],
        )

    def test_external_route_failure_stops_before_unit_submission(self):
        systemd = FakeSystemd(
            route_preflight_result=CommandResult(
                ("route-preflight",),
                78,
                stdout=json.dumps(
                    {
                        "version": 2,
                        "probe": "route",
                        "status": "blocked",
                        "proofs": [],
                        "issues": ["pi5.external-tls:docker-auth"],
                        "warnings": [],
                        "metrics": {},
                        "externalDependencies": {
                            "required": list(
                                application.BUILD_EXTERNAL_DEPENDENCY_IDS
                            ),
                            "rounds": 3,
                            "successes": {
                                dependency: (
                                    2 if dependency == "docker-auth" else 3
                                )
                                for dependency in application.BUILD_EXTERNAL_DEPENDENCY_IDS
                            },
                        },
                    }
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
        server_runtime = type(
            "ServerRuntime",
            (Runtime,),
            {
                "build_print_plan": staticmethod(
                    lambda *_args, **_kwargs: {
                        **Runtime.build_print_plan(
                            "main",
                            "inventory.yml",
                            "",
                        ),
                        "classificationComponents": ["server-app"],
                        "pi5Required": True,
                    }
                )
            },
        )
        with patches[0], patches[1], patches[2], patches[3], patches[4]:
            with self.assertRaisesRegex(RuntimeError, "aggregate preflight blocked"):
                application.launch(release_args(), runtime=server_runtime)

        self.assertNotIn("start", [event[0] for event in systemd.events])
        self.assertEqual(
            systemd.route_external_dependencies,
            [application.BUILD_EXTERNAL_DEPENDENCY_IDS],
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
            None,
        )
        self.assertEqual(
            payload["routeCoverage"],
            [stage.id for stage in application.ROUTE_STAGES],
        )
        self.assertEqual(payload["readinessReview"]["status"], "passed")
        self.assertEqual(payload["readinessReview"]["gateCount"], 8)
        gates = {
            gate["id"]: gate for gate in payload["readinessReview"]["gates"]
        }
        self.assertFalse(gates["route.external-server-build"]["applies_now"])
        self.assertFalse(gates["terminal.selected-prerequisites"]["applies_now"])
        self.assertFalse(gates["architecture.activation-executor"]["applies_now"])
        self.assertEqual(
            systemd.route_external_dependencies,
            [()],
        )
        self.assertEqual(
            systemd.events,
            [
                ("migration-preflight", RUN_ID),
                ("route-preflight", RUN_ID),
            ],
        )

    def test_preflight_only_returns_json_when_local_preparation_fails(self):
        with patch.object(
            application,
            "_require_clean_worktree",
            side_effect=RuntimeError("raw local detail must not escape"),
        ), patch("sys.stdout", new_callable=io.StringIO) as stdout:
            outcome = application.launch(
                release_args(preflight_only=True), runtime=Runtime
            )

        self.assertEqual(outcome, 70)
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["status"], "incomplete")
        self.assertFalse(payload["releaseSubmitted"])
        self.assertEqual(payload["sha"], None)
        self.assertEqual(
            payload["probes"],
            [
                {
                    "probe": "local",
                    "status": "incomplete",
                    "exitCode": 70,
                    "issues": ["local.source-and-scope.incomplete"],
                }
            ],
        )
        self.assertNotIn("raw local detail", stdout.getvalue())
        self.assertTrue(
            next(
                gate
                for gate in payload["readinessReview"]["gates"]
                if gate["id"] == "local.source-and-scope"
            )["applies_now"]
        )

    def test_preflight_only_exposes_the_canonical_provisional_target_snapshot(self):
        systemd = FakeSystemd(
            route_preflight_result=route_passed_result(external=True)
        )
        control = FakeControl()
        target = {
            "host": "raspberrypi5",
            "role": "server",
            "requiredClaims": ["controlPlaneApi", "controlPlaneWeb"],
            "reason": "server impact: server-app",
        }
        snapshot = {
            "sha": SHA,
            "classificationComponents": ["server-app"],
            "pi5Required": True,
            "fullFleet": False,
            "reverifySelected": False,
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
        self.assertEqual(
            systemd.route_external_dependencies,
            [application.BUILD_EXTERNAL_DEPENDENCY_IDS],
        )

    def test_external_build_probe_is_selected_by_registry_components(self):
        registry = application.readiness_policy.load_registry()
        for components, expected in (
            (["neutral"], False),
            (["migration", "neutral"], False),
            (["unknown"], True),
            (["server-app"], True),
        ):
            current = Runtime.build_print_plan("main", "inventory.yml", "")
            current["classificationComponents"] = components
            selection = application.readiness_policy.select_readiness(
                registry,
                application.readiness_policy.facts_from_plan(current),
            )
            self.assertEqual(
                "route.external-server-build"
                in {request.capability for request in selection.probes},
                expected,
            )

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
        migration = FakeSystemd().preflight_result
        terminal = terminal_passed_result("kiosk-a")
        route = CommandResult(
            ("route-preflight",),
            0,
            stdout=(
                '{"version":2,"probe":"route","status":"passed",'
                '"proofs":[],"issues":[],"warnings":[],"metrics":{},'
                '"externalDependencies":{"required":[],"rounds":3,"successes":{}}}'
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
            "activationStrategyId": "kiosk-web-activation-v1",
            "activationMode": "steady-state",
            "claimRequirements": [
                {"kind": "controlPlaneWeb"},
                {"kind": "terminalRepository"},
            ],
        }
        snapshot = {
            "sha": SHA,
            "classificationComponents": ["neutral"],
            "pi5Required": False,
            "fullFleet": False,
            "reverifySelected": False,
            "typedTargetPlanningEnabled": True,
            "activationExecutionEnabled": False,
            "verificationOnlyExecutionEnabled": True,
            "mutationTargets": [],
            "activationTargets": [activation],
            "verificationTargets": [activation],
            "terminalWork": [activation_work],
        }
        registry = application.readiness_policy.load_registry()
        selection = application.readiness_policy.select_readiness(
            registry,
            application.readiness_policy.facts_from_plan(snapshot),
        )
        outcome, report = application._preflight_report(
            spec,
            registry=registry,
            selection=selection,
            migration_result=migration,
            route_result=route,
            terminal_result=terminal,
            selected_hosts=["raspberrypi5", "kiosk-a"],
            terminal_count=1,
            planning_snapshot=snapshot,
        )

        self.assertEqual(outcome, 78)
        self.assertEqual(report["status"], "blocked")
        self.assertIsNone(report["effectiveExecutor"])
        activation_gate = next(
            gate
            for gate in report["readinessReview"]["gates"]
            if gate["id"] == "architecture.activation-executor"
        )
        self.assertEqual(activation_gate["status"], "blocked")
        self.assertEqual(
            activation_gate["issues"],
            ["activation-architecture.execution-disabled"],
        )

        verification_work = {
            **activation_work,
            "activationRequired": False,
        }
        verification_snapshot = {
            **snapshot,
            "activationTargets": [],
            "terminalWork": [verification_work],
            "verificationOnlyExecutionEnabled": False,
        }
        verification_selection = application.readiness_policy.select_readiness(
            registry,
            application.readiness_policy.facts_from_plan(verification_snapshot),
        )
        verification_outcome, verification_report = application._preflight_report(
            spec,
            registry=registry,
            selection=verification_selection,
            migration_result=migration,
            route_result=route,
            terminal_result=terminal,
            selected_hosts=["raspberrypi5", "kiosk-a"],
            terminal_count=1,
            planning_snapshot=verification_snapshot,
        )
        self.assertEqual(verification_outcome, 78)
        self.assertEqual(
            next(
                gate
                for gate in verification_report["readinessReview"]["gates"]
                if gate["id"] == "architecture.verification-executor"
            )["status"],
            "blocked",
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
        migration = FakeSystemd().preflight_result
        terminal = terminal_passed_result("kiosk-a")
        route = CommandResult(
            ("route-preflight",),
            0,
            stdout=(
                '{"version":2,"probe":"route","status":"passed",'
                '"proofs":[],"issues":[],"warnings":[],"metrics":{},'
                '"externalDependencies":{"required":[],"rounds":3,"successes":{}}}'
            ),
        )
        activation = {
            "host": "kiosk-a",
            "role": "kiosk",
            "requiredClaims": ["controlPlaneWeb", "terminalRepository"],
            "reason": "controlPlaneWeb claim is stale-or-unverified",
            "activationStrategyId": "kiosk-web-activation-v1",
        }
        snapshot = {
            "sha": SHA,
            "classificationComponents": ["neutral"],
            "pi5Required": False,
            "fullFleet": False,
            "reverifySelected": False,
            "typedTargetPlanningEnabled": True,
            "activationExecutionEnabled": True,
            "verificationOnlyExecutionEnabled": True,
            "mutationTargets": [],
            "activationTargets": [activation],
            "verificationTargets": [activation],
            "terminalWork": [
                {
                    "host": "kiosk-a",
                    "role": "kiosk",
                    "mutationRequired": False,
                    "activationRequired": True,
                    "verificationRequired": True,
                    "activationStrategyId": "kiosk-web-activation-v1",
                    "activationMode": "steady-state",
                    "claimRequirements": [
                        {"kind": "controlPlaneWeb"},
                        {"kind": "terminalRepository"},
                    ],
                }
            ],
        }
        registry = application.readiness_policy.load_registry()
        selection = application.readiness_policy.select_readiness(
            registry,
            application.readiness_policy.facts_from_plan(snapshot),
        )
        outcome, report = application._preflight_report(
            spec,
            registry=registry,
            selection=selection,
            migration_result=migration,
            route_result=route,
            terminal_result=terminal,
            selected_hosts=["raspberrypi5", "kiosk-a"],
            terminal_count=1,
            planning_snapshot=snapshot,
        )

        self.assertEqual(outcome, 0)
        self.assertEqual(report["status"], "passed")
        self.assertEqual(report["requestedExecutor"], "ssh-ansible")
        self.assertEqual(report["provisionalExecutor"], "ssh-ansible")
        self.assertEqual(report["effectiveExecutor"], "ssh-ansible")
        self.assertIsNone(report["fallbackReason"])
        self.assertEqual(
            [probe["probe"] for probe in report["probes"]],
            ["migration", "route", "terminal"],
        )

    def test_aggregate_terminal_preflight_failure_stops_before_unit_submission(self):
        systemd = FakeSystemd(
            terminal_preflight_result=CommandResult(
                ("terminal-preflight",),
                78,
                stdout=(
                    '{"version":2,"probe":"terminal",'
                    '"capability":"terminal.selected-prerequisites",'
                    '"status":"blocked","proofs":[],"warnings":[],'
                    '"issues":['
                    '{"code":"terminal.unit.pcscd.socket.active",'
                    '"host":"kiosk-a","capability":"terminal.selected-prerequisites"},'
                    '{"code":"terminal.package.pcsc-tools",'
                    '"host":"kiosk-a","capability":"terminal.selected-prerequisites"}'
                    '],"targets":[{"host":"kiosk-a","profile":"kiosk",'
                    '"status":"blocked","issues":['
                    '"terminal.unit.pcscd.socket.active",'
                    '"terminal.package.pcsc-tools"]}]}'
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
        terminal_plan = Runtime.build_print_plan("main", "inventory.yml", "")
        terminal_plan.update(
            {
                "classificationComponents": ["client-role"],
                "terminalWork": [
                    {
                        "host": "kiosk-a",
                        "role": "kiosk",
                        "mutationRequired": True,
                        "activationRequired": False,
                        "verificationRequired": True,
                        "activationStrategyId": None,
                        "activationMode": None,
                        "claimRequirements": [
                            {"kind": "terminalRepository"}
                        ],
                    }
                ],
            }
        )
        terminal_runtime = type(
            "TerminalRuntime",
            (Runtime,),
            {"build_print_plan": staticmethod(lambda *_args, **_kwargs: terminal_plan)},
        )
        with patches[0], patches[1], patches[2], patches[3], patches[4], patch.object(
            application,
            "build_target_contracts",
            return_value=[{"host": "kiosk-a"}],
        ):
            with self.assertRaisesRegex(RuntimeError, "aggregate preflight blocked"):
                application.launch(release_args(), runtime=terminal_runtime)
        self.assertEqual(
            systemd.events,
            [
                ("migration-preflight", RUN_ID),
                ("route-preflight", RUN_ID),
                ("terminal-preflight", RUN_ID, 1),
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
                        ("start", RUN_ID, True),
                    ],
                )

    def test_preflight_only_aggregates_blockers_and_incomplete_probes(self):
        systemd = FakeSystemd(
            preflight_result=CommandResult(
                ("migration-preflight",),
                78,
                stdout=(
                    '{"version":2,"probe":"migration",'
                    '"capability":"migration.production-ledger","host":"pi5",'
                    '"status":"blocked","proofs":[],"warnings":[],'
                    '"issues":[{"code":"migration.production-ledger-rejected",'
                    '"host":"pi5","capability":"migration.production-ledger"}]}'
                ),
            ),
            route_preflight_result=CommandResult(
                ("route-preflight",),
                70,
                stdout=(
                    '{"version":2,"probe":"route","status":"incomplete",'
                    '"proofs":[],"issues":["route.internal-error"],"warnings":[],'
                    '"metrics":{},"externalDependencies":{"required":[],"rounds":3,"successes":{}}}'
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
            ["blocked", "incomplete"],
        )
        self.assertEqual(
            systemd.events,
            [
                ("migration-preflight", RUN_ID),
                ("route-preflight", RUN_ID),
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


class CanaryApprovalActionTest(unittest.TestCase):
    def waiting_status(self) -> dict[str, object]:
        return {
            "runId": RUN_ID,
            "state": "running",
            "phase": "waiting-approval",
            "canaryHold": {
                "state": "waiting-verification",
                "canary": "raspi4-kensaku-stonebase01",
                "profile": "kiosk",
                "since": "2026-07-29T01:15:28Z",
                "expiresAt": 2_000,
            },
        }

    def test_waiting_gate_exposes_one_run_scoped_operator_action(self):
        action = application.canary_approval_action(
            self.waiting_status(),
            run_id=RUN_ID,
            now_epoch=1_250,
        )
        self.assertEqual(
            action,
            {
                "type": "canary-approval",
                "runId": RUN_ID,
                "canary": "raspi4-kensaku-stonebase01",
                "openedAt": "2026-07-29T01:15:28Z",
                "expiresAt": 2_000,
                "remainingSeconds": 750,
                "command": f"scripts/update-all-clients.sh --approve {RUN_ID}",
            },
        )

    def test_action_is_absent_outside_a_live_unexpired_waiting_gate(self):
        cases = [
            {"state": "failed"},
            {"phase": "deploying"},
            {"canaryHold": {"state": "approved"}},
            {"canaryHold": {"state": "expired"}},
            {"canaryHold": {"state": "waiting-verification", "expiresAt": 1_250}},
            {"canaryHold": {"state": "waiting-verification", "expiresAt": True}},
        ]
        for changes in cases:
            with self.subTest(changes=changes):
                status = self.waiting_status()
                status.update(changes)
                self.assertIsNone(
                    application.canary_approval_action(
                        status,
                        run_id=RUN_ID,
                        now_epoch=1_250,
                    )
                )

    def test_observe_replaces_stale_remote_action_with_local_projection(self):
        status = self.waiting_status()
        status["actionRequired"] = {"type": "unsafe-remote-command"}
        projected = {"type": "canary-approval", "runId": RUN_ID}
        systemd = Mock()
        systemd.show.return_value = object()
        control = Mock()
        control.snapshot.return_value = (object(), object())

        with patch.object(
            application,
            "reconcile_status",
            return_value=status,
        ), patch.object(
            application,
            "canary_approval_action",
            return_value=projected,
        ) as derive:
            observed = application.observe(
                RUN_ID,
                systemd=systemd,
                control=control,
            )

        self.assertEqual(observed["actionRequired"], projected)
        derive.assert_called_once()
        self.assertEqual(derive.call_args.kwargs["run_id"], RUN_ID)


if __name__ == "__main__":
    unittest.main()
