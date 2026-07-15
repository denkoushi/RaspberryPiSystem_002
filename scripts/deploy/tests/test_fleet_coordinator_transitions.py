import argparse
import copy
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace


DEPLOY_DIR = Path(__file__).resolve().parents[1]
if str(DEPLOY_DIR) not in sys.path:
    sys.path.insert(0, str(DEPLOY_DIR))

from rolling_release import coordinator  # noqa: E402
from rolling_release.cancellation import CancellationRequested  # noqa: E402


OLD_SHA = "1" * 40
NEW_SHA = "2" * 40
UNSET = object()


def host_record(role, sha):
    record = {
        "role": role,
        "desiredSha": sha,
        "currentSha": sha,
        "previousSha": None,
        "evidence": "verified",
        "verifiedAt": "2026-07-15T00:00:00Z",
        "lastRunId": "prior-run",
    }
    if role == "server":
        record.update(
            {
                "activeSlot": "blue",
                "apiImage": f"api:{sha}-aaaaaaaaaaaa",
                "webImage": f"web:{sha}-bbbbbbbbbbbb",
                "configDigest": "sha256:" + "a" * 64,
                "migrationDigest": "sha256:" + "b" * 64,
            }
        )
    return record


def decision(host, role, *, current=OLD_SHA, targeted=True, reason="role impact"):
    return {
        "host": host,
        "role": role,
        "desiredSha": NEW_SHA if targeted else current,
        "currentSha": current,
        "evidence": "verified",
        "targetReason": reason,
        "targeted": targeted,
    }


class FakeToken:
    def __init__(self, events, cancel_at=None):
        self.events = events
        self.cancel_at = cancel_at

    def checkpoint(self, name):
        self.events.append(f"checkpoint:{name}")
        if name == self.cancel_at:
            raise CancellationRequested("operator stop", name)


class FakeReleaseState:
    def __init__(self, runtime, _path, payload):
        self.runtime = runtime
        self.payload = payload

    def save(self, *, before_terminal_persist=None):
        effective_state = self.payload.get("state")
        if effective_state == "success" and self.runtime.cancel_at_finish:
            effective_state = "cancelled"
        if before_terminal_persist is not None:
            self.payload.update(before_terminal_persist(effective_state) or {})
        self.payload["state"] = effective_state
        targets = ",".join(
            f"{target['host']}={target['state']}"
            for target in self.payload.get("targets") or []
        )
        self.runtime.events.append(
            "legacy:save:"
            f"{self.payload.get('state')}:{self.payload.get('phase')}:{targets}"
        )

    def target(self, host):
        return next(
            target for target in self.payload["targets"] if target["host"] == host
        )


class FakeRuntime:
    ANSIBLE_DIRECTORY = Path("/ansible")

    def __init__(self, *, fleet, hosts, plan, targets):
        self.events = []
        self.os = SimpleNamespace(environ={})
        self.fleet = {
            "generation": 0,
            "activeRun": None,
            "lastRun": None,
            "fleet": copy.deepcopy(fleet),
        }
        self.hosts = hosts
        self.plan = plan
        self.targets = targets
        self.states = []
        self.scope_kwargs = None
        self.playbook_error = None
        self.rollback_ok = True
        self.terminal_observation_error = None
        self.host_config_error = None
        self.deployed_sha = {}
        self.pi5_release_sha = None
        self.pi5_marker_sha = None
        self.cancel_at_finish = False

    def _snapshot(self):
        return copy.deepcopy(self.fleet)

    def _bump(self):
        self.fleet["generation"] += 1
        return self._snapshot()

    def fleet_begin_run(self, run_id, sha, inventory):
        self.events.append("fleet:begin")
        self.fleet["activeRun"] = {
            "runId": run_id,
            "desiredSha": sha,
            "inventory": inventory,
        }
        return self._bump(), None

    def fleet_finish_run(self, run_id, status):
        self.events.append(f"fleet:finish:{status}")
        self.fleet["lastRun"] = {"runId": run_id, "status": status}
        self.fleet["activeRun"] = None
        return self._bump()

    def fleet_mark_unknown(self, host, role, desired_sha, run_id):
        self.events.append(f"fleet:unknown:{host}")
        prior = self.fleet["fleet"].get(host) or {}
        prior_current = prior.get("currentSha")
        self.fleet["fleet"][host] = {
            "role": role,
            "desiredSha": desired_sha,
            "currentSha": None,
            "previousSha": (
                prior_current
                if prior_current and prior_current != desired_sha
                else prior.get("previousSha")
            ),
            "evidence": "unknown",
            "verifiedAt": None,
            "lastRunId": run_id,
        }
        return self._bump()

    def fleet_mark_verified(
        self,
        host,
        role,
        desired_sha,
        current_sha,
        run_id,
        *,
        previous_sha=UNSET,
        observation=None,
    ):
        self.events.append(f"fleet:verified:{host}:{current_sha}")
        prior = self.fleet["fleet"].get(host) or {}
        if previous_sha is UNSET:
            previous_sha = prior.get("currentSha") or prior.get("previousSha")
        self.fleet["fleet"][host] = {
            "role": role,
            "desiredSha": desired_sha,
            "currentSha": current_sha,
            "previousSha": previous_sha,
            "evidence": "verified",
            "verifiedAt": "2026-07-15T00:00:00Z",
            "lastRunId": run_id,
            **(
                {
                    "activeSlot": observation.get("activeSlot"),
                    "apiImage": observation.get("apiImage"),
                    "webImage": observation.get("webImage"),
                    "configDigest": observation.get("configDigest"),
                    "migrationDigest": observation.get("migrationDigest"),
                }
                if role == "server"
                else {}
            ),
        }
        return self._bump()

    def ReleaseState(self, path, payload):
        state = FakeReleaseState(self, path, payload)
        self.states.append(state)
        return state

    def status_file(self, run_id):
        return Path("/unused") / f"{run_id}.json"

    def utc_now(self):
        return "2026-07-15T00:00:00Z"

    def inventory_json(self, inventory):
        self.events.append(f"inventory:{inventory}")
        return {"inventory": True}

    def inventory_server_identity(self, _inventory):
        return {"host": "pi5", "clientId": "raspberrypi5-server"}

    def selected_hosts(self, _inventory, _limit):
        return None

    def release_hosts(self, _inventory):
        return copy.deepcopy(self.hosts)

    def build_fleet_scope(self, **kwargs):
        self.scope_kwargs = kwargs
        return copy.deepcopy(self.plan), copy.deepcopy(self.targets), {}, []

    def observe_pi5_evidence(self, expected_sha):
        self.events.append(f"observe:server:{expected_sha}")
        sha = expected_sha if expected_sha is not None else OLD_SHA
        return {
            "currentSha": sha,
            "activeSlot": "green",
            "apiImage": f"api:{sha}-aaaaaaaaaaaa",
            "webImage": f"web:{sha}-bbbbbbbbbbbb",
            "configDigest": "sha256:" + "c" * 64,
            "migrationDigest": "sha256:" + "d" * 64,
        }

    def observe_terminal_evidence(self, _inventory, host, _role):
        self.events.append(f"observe:terminal:{host}")
        if self.terminal_observation_error is not None:
            raise self.terminal_observation_error
        current = (
            OLD_SHA
            if any(event == f"rollback:{host}" for event in self.events)
            else self.deployed_sha.get(host, NEW_SHA)
        )
        return {"currentSha": current, "services": ["required.service"]}

    def converge_server_config(self, _inventory, host, sha, _run_id):
        self.events.append(f"pi5:host-config:{host}:{sha}")
        if self.host_config_error is not None:
            raise self.host_config_error

    def ensure_pi5_release(self, sha, state):
        self.events.append("pi5:ensure")
        self.pi5_release_sha = sha
        state.payload["pi5"] = {
            "state": "stable",
            "candidate": {
                "api": f"api:{sha}-aaaaaaaaaaaa",
                "web": f"web:{sha}-bbbbbbbbbbbb",
            },
        }

    def record_pi5_release_current(self, sha, _candidate):
        self.events.append("legacy:pi5-marker")
        self.pi5_marker_sha = sha

    def remote_previous_sha(self, _inventory, host):
        self.events.append(f"terminal:previous:{host}")
        return OLD_SHA

    def should_issue_terminal_notice(self, **_kwargs):
        return False

    def terminal_notice_skip_reason(self, **_kwargs):
        return "test"

    def state_command(self, *arguments):
        self.events.append("status:" + ":".join(arguments))

    def prestage_signage_maintenance(self, *_args):
        self.events.append("signage:prestage")

    def wait_for_ack(self, *_args, **_kwargs):
        return True

    def playbook(self, _inventory, host, sha, _run_id):
        self.events.append(f"playbook:{host}")
        if self.playbook_error is not None:
            raise self.playbook_error
        self.deployed_sha[host] = sha

    def rollback_terminal(self, _inventory, target_spec, _target, _run_id):
        self.events.append(f"rollback:{target_spec['host']}")
        return self.rollback_ok

    def should_hold_after_canary(self, *_args, **_kwargs):
        return False

    def wait_for_canary_hold(self, *_args):
        raise AssertionError("unexpected canary hold")


def args(**overrides):
    values = {
        "inventory": "inventory.yml",
        "limit": "",
        "run_id": "run-1",
        "branch": "main",
        "sha": NEW_SHA,
        "emergency_override": False,
        "reason": None,
        "skip_canary_hold": True,
        "canary_hold_timeout": 60,
        "auto_minimize": False,
        "full_fleet": False,
        "expected_server_client_id": "raspberrypi5-server",
    }
    values.update(overrides)
    return argparse.Namespace(**values)


class FleetCoordinatorTransitionTest(unittest.TestCase):
    def test_target_inventory_identity_mismatch_precedes_fleet_and_devices(self):
        runtime = FakeRuntime(fleet={}, hosts=[], plan={}, targets=[])

        with self.assertRaisesRegex(RuntimeError, "does not match target inventory"):
            coordinator.execute(
                args(expected_server_client_id="talkplaza-pi5-server"),
                runtime=runtime,
                token=FakeToken(runtime.events),
            )

        self.assertEqual(runtime.events, ["inventory:/ansible/inventory.yml"])
        self.assertEqual(runtime.states, [])
        self.assertIsNone(runtime.fleet["activeRun"])

    def test_noop_finishes_fleet_before_legacy_success(self):
        hosts = [
            {"host": "pi5", "role": "server"},
            {
                "host": "kiosk-a",
                "role": "kiosk",
                "terminalType": "kiosk",
                "clientId": "a",
            },
        ]
        plan = {
            "pi5Required": False,
            "hosts": [
                decision("pi5", "server", current=NEW_SHA, targeted=False),
                decision("kiosk-a", "kiosk", current=NEW_SHA, targeted=False),
            ],
        }
        runtime = FakeRuntime(
            fleet={
                "pi5": host_record("server", NEW_SHA),
                "kiosk-a": host_record("kiosk", NEW_SHA),
            },
            hosts=hosts,
            plan=plan,
            targets=[],
        )

        result = coordinator.execute(
            args(), runtime=runtime, token=FakeToken(runtime.events)
        )

        self.assertEqual(result, 0)
        self.assertTrue(runtime.events[0].startswith("inventory:"))
        self.assertEqual(runtime.events[1], "fleet:begin")
        self.assertFalse(any(event.startswith("observe:") for event in runtime.events))
        finish = runtime.events.index("fleet:finish:success")
        self.assertLess(finish, len(runtime.events) - 1)
        self.assertTrue(runtime.events[-1].startswith("legacy:save:success:completed"))

    def test_seed_promotes_only_successful_live_observation(self):
        hosts = [
            {"host": "pi5", "role": "server"},
            {"host": "kiosk-a", "role": "kiosk"},
        ]
        runtime = FakeRuntime(fleet={}, hosts=hosts, plan={}, targets=[])
        original_observer = runtime.observe_terminal_evidence

        def unavailable(*_args):
            runtime.events.append("observe:terminal:kiosk-a")
            raise RuntimeError("unreachable")

        runtime.observe_terminal_evidence = unavailable
        state, failures = coordinator._seed_unverified_hosts(
            hosts,
            runtime._snapshot(),
            inventory="inventory.yml",
            run_id="run-1",
            desired_sha=NEW_SHA,
            abandoned_run_id=None,
            runtime=runtime,
            token=FakeToken(runtime.events),
        )
        runtime.observe_terminal_evidence = original_observer

        self.assertEqual(state["fleet"]["pi5"]["evidence"], "verified")
        self.assertEqual(state["fleet"]["kiosk-a"]["evidence"], "unknown")
        self.assertEqual(state["fleet"]["kiosk-a"]["desiredSha"], NEW_SHA)
        self.assertEqual(failures, [{"host": "kiosk-a", "error": "unreachable"}])
        self.assertLess(
            runtime.events.index("observe:server:None"),
            runtime.events.index(f"fleet:verified:pi5:{OLD_SHA}"),
        )

    def test_seed_never_repromotes_an_existing_authoritative_record(self):
        stale = host_record("kiosk", OLD_SHA)
        stale["desiredSha"] = NEW_SHA
        hosts = [{"host": "kiosk-a", "role": "kiosk"}]
        runtime = FakeRuntime(
            fleet={"kiosk-a": stale}, hosts=hosts, plan={}, targets=[]
        )
        runtime.deployed_sha["kiosk-a"] = OLD_SHA

        state, failures = coordinator._seed_unverified_hosts(
            hosts,
            runtime._snapshot(),
            inventory="inventory.yml",
            run_id="run-1",
            desired_sha=NEW_SHA,
            abandoned_run_id=None,
            runtime=runtime,
            token=FakeToken(runtime.events),
        )

        self.assertEqual(failures, [])
        record = state["fleet"]["kiosk-a"]
        self.assertEqual(record["currentSha"], OLD_SHA)
        self.assertEqual(record["desiredSha"], NEW_SHA)
        self.assertEqual(record["evidence"], "verified")
        self.assertNotIn("observe:terminal:kiosk-a", runtime.events)

    def test_seed_never_promotes_existing_unknown_after_failed_cleanup(self):
        unknown = host_record("kiosk", OLD_SHA)
        unknown.update(
            {
                "desiredSha": NEW_SHA,
                "currentSha": None,
                "evidence": "unknown",
                "verifiedAt": None,
                "lastRunId": "failed-maintenance-run",
            }
        )
        hosts = [{"host": "kiosk-a", "role": "kiosk"}]
        runtime = FakeRuntime(
            fleet={"kiosk-a": unknown}, hosts=hosts, plan={}, targets=[]
        )

        state, failures = coordinator._seed_unverified_hosts(
            hosts,
            runtime._snapshot(),
            inventory="inventory.yml",
            run_id="retry-run",
            desired_sha=NEW_SHA,
            abandoned_run_id=None,
            runtime=runtime,
            token=FakeToken(runtime.events),
        )

        self.assertEqual(failures, [])
        self.assertEqual(state["fleet"]["kiosk-a"]["evidence"], "unknown")
        self.assertNotIn("observe:terminal:kiosk-a", runtime.events)

    def test_full_release_orders_authoritative_writes_before_compatibility(self):
        terminal = {
            "host": "kiosk-a",
            "role": "kiosk",
            "terminalType": "kiosk",
            "clientId": "a",
        }
        plan = {
            "pi5Required": True,
            "hosts": [
                decision("pi5", "server"),
                decision("kiosk-a", "kiosk"),
            ],
        }
        runtime = FakeRuntime(
            fleet={
                "pi5": host_record("server", OLD_SHA),
                "kiosk-a": host_record("kiosk", OLD_SHA),
            },
            hosts=[{"host": "pi5", "role": "server"}, terminal],
            plan=plan,
            targets=[terminal],
        )

        result = coordinator.execute(
            args(full_fleet=True),
            runtime=runtime,
            token=FakeToken(runtime.events),
        )

        self.assertEqual(result, 0)
        self.assertTrue(runtime.scope_kwargs["full_fleet"])
        self.assertLess(
            runtime.events.index("fleet:unknown:pi5"),
            runtime.events.index(f"pi5:host-config:pi5:{NEW_SHA}"),
        )
        self.assertLess(
            runtime.events.index(f"pi5:host-config:pi5:{NEW_SHA}"),
            runtime.events.index("pi5:ensure"),
        )
        unknown = runtime.events.index("fleet:unknown:pi5")
        host_config = runtime.events.index(f"pi5:host-config:pi5:{NEW_SHA}")
        self.assertTrue(
            any(
                event.startswith("legacy:save:running:preparing")
                for event in runtime.events[unknown + 1 : host_config]
            )
        )
        self.assertLess(
            runtime.events.index(f"fleet:verified:pi5:{NEW_SHA}"),
            runtime.events.index("legacy:pi5-marker"),
        )
        self.assertLess(
            runtime.events.index("fleet:unknown:kiosk-a"),
            runtime.events.index("terminal:previous:kiosk-a"),
        )
        self.assertLess(
            runtime.events.index("playbook:kiosk-a"),
            runtime.events.index("observe:terminal:kiosk-a"),
        )
        self.assertLess(
            runtime.events.index("observe:terminal:kiosk-a"),
            runtime.events.index("status:remove-client:--run-id:run-1:--client:a"),
        )
        self.assertLess(
            runtime.events.index("status:remove-client:--run-id:run-1:--client:a"),
            runtime.events.index(f"fleet:verified:kiosk-a:{NEW_SHA}"),
        )
        self.assertLess(
            runtime.events.index("fleet:finish:success"),
            len(runtime.events) - 1,
        )
        self.assertEqual(runtime.fleet["fleet"]["kiosk-a"]["evidence"], "verified")

    def test_pi5_host_config_failure_stops_before_candidate_and_terminals(self):
        terminal = {
            "host": "kiosk-a",
            "role": "kiosk",
            "terminalType": "kiosk",
            "clientId": "a",
        }
        server = decision("pi5", "server")
        runtime = FakeRuntime(
            fleet={
                "pi5": host_record("server", OLD_SHA),
                "kiosk-a": host_record("kiosk", OLD_SHA),
            },
            hosts=[{"host": "pi5", "role": "server"}, terminal],
            plan={
                "pi5Required": True,
                "hosts": [server, decision("kiosk-a", "kiosk")],
            },
            targets=[terminal],
        )
        runtime.host_config_error = RuntimeError("host config failed")

        with self.assertRaisesRegex(RuntimeError, "host config failed"):
            coordinator.execute(
                args(), runtime=runtime, token=FakeToken(runtime.events)
            )

        self.assertIn(f"pi5:host-config:pi5:{NEW_SHA}", runtime.events)
        self.assertNotIn("pi5:ensure", runtime.events)
        self.assertFalse(
            any(event.startswith("observe:server:") for event in runtime.events)
        )
        self.assertEqual(runtime.fleet["fleet"]["pi5"]["evidence"], "unknown")
        self.assertEqual(
            runtime.fleet["fleet"]["kiosk-a"], host_record("kiosk", OLD_SHA)
        )
        target = runtime.states[-1].target("kiosk-a")
        self.assertEqual(target["state"], "pending")
        self.assertEqual(target["currentSha"], OLD_SHA)
        self.assertEqual(target["evidence"], "verified")
        for forbidden in (
            "fleet:unknown:kiosk-a",
            "terminal:previous:kiosk-a",
            "playbook:kiosk-a",
            "observe:terminal:kiosk-a",
            "rollback:kiosk-a",
            "signage:prestage",
        ):
            self.assertNotIn(forbidden, runtime.events)
        self.assertFalse(any(event.startswith("status:") for event in runtime.events))
        self.assertNotIn("kiosk-a", runtime.deployed_sha)
        self.assertIn("fleet:finish:failed", runtime.events)

    def test_cancel_after_pi5_host_config_never_starts_candidate_or_terminals(self):
        terminal = {
            "host": "kiosk-a",
            "role": "kiosk",
            "terminalType": "kiosk",
            "clientId": "a",
        }
        server = decision("pi5", "server")
        runtime = FakeRuntime(
            fleet={
                "pi5": host_record("server", OLD_SHA),
                "kiosk-a": host_record("kiosk", OLD_SHA),
            },
            hosts=[{"host": "pi5", "role": "server"}, terminal],
            plan={
                "pi5Required": True,
                "hosts": [server, decision("kiosk-a", "kiosk")],
            },
            targets=[terminal],
        )

        result = coordinator.execute(
            args(),
            runtime=runtime,
            token=FakeToken(runtime.events, cancel_at="after-pi5-host-config"),
        )

        self.assertEqual(result, 130)
        self.assertIn(f"pi5:host-config:pi5:{NEW_SHA}", runtime.events)
        self.assertNotIn("pi5:ensure", runtime.events)
        self.assertEqual(
            runtime.fleet["fleet"]["kiosk-a"], host_record("kiosk", OLD_SHA)
        )
        target = runtime.states[-1].target("kiosk-a")
        self.assertEqual(target["state"], "pending")
        self.assertEqual(target["currentSha"], OLD_SHA)
        self.assertEqual(target["evidence"], "verified")
        for forbidden in (
            "fleet:unknown:kiosk-a",
            "terminal:previous:kiosk-a",
            "playbook:kiosk-a",
            "observe:terminal:kiosk-a",
            "rollback:kiosk-a",
            "signage:prestage",
        ):
            self.assertNotIn(forbidden, runtime.events)
        status_events = [
            event for event in runtime.events if event.startswith("status:")
        ]
        self.assertEqual(
            status_events, ["status:remove-run:--run-id:run-1"]
        )
        self.assertNotIn("kiosk-a", runtime.deployed_sha)
        self.assertIn("fleet:finish:cancelled", runtime.events)

    def test_verified_rollback_is_observed_then_run_finishes_failed(self):
        terminal = {
            "host": "kiosk-a",
            "role": "kiosk",
            "terminalType": "kiosk",
            "clientId": "a",
        }
        plan = {
            "pi5Required": False,
            "hosts": [
                decision("pi5", "server", targeted=False),
                decision("kiosk-a", "kiosk"),
            ],
        }
        runtime = FakeRuntime(
            fleet={
                "pi5": host_record("server", OLD_SHA),
                "kiosk-a": host_record("kiosk", OLD_SHA),
            },
            hosts=[{"host": "pi5", "role": "server"}, terminal],
            plan=plan,
            targets=[terminal],
        )
        runtime.playbook_error = RuntimeError("deploy failed")

        with self.assertRaisesRegex(RuntimeError, "rollout stopped"):
            coordinator.execute(
                args(), runtime=runtime, token=FakeToken(runtime.events)
            )

        self.assertEqual(runtime.events.count("fleet:unknown:kiosk-a"), 2)
        self.assertLess(
            runtime.events.index("rollback:kiosk-a"),
            runtime.events.index("observe:terminal:kiosk-a"),
        )
        self.assertEqual(runtime.fleet["fleet"]["kiosk-a"]["currentSha"], OLD_SHA)
        self.assertEqual(runtime.fleet["fleet"]["kiosk-a"]["evidence"], "verified")
        self.assertIn("fleet:finish:failed", runtime.events)

    def test_execution_uses_each_hosts_role_specific_desired_sha(self):
        terminal = {
            "host": "kiosk-a",
            "role": "kiosk",
            "terminalType": "kiosk",
            "clientId": "a",
        }
        stale_desired = decision("kiosk-a", "kiosk")
        stale_desired.update(
            {
                "desiredSha": OLD_SHA,
                "targetReason": "desired SHA differs from role-specific plan",
            }
        )
        plan = {
            "pi5Required": False,
            "hosts": [
                decision("pi5", "server", targeted=False),
                stale_desired,
            ],
        }
        runtime = FakeRuntime(
            fleet={
                "pi5": host_record("server", OLD_SHA),
                "kiosk-a": host_record("kiosk", OLD_SHA),
            },
            hosts=[{"host": "pi5", "role": "server"}, terminal],
            plan=plan,
            targets=[terminal],
        )

        result = coordinator.execute(
            args(), runtime=runtime, token=FakeToken(runtime.events)
        )

        self.assertEqual(result, 0)
        self.assertEqual(runtime.deployed_sha["kiosk-a"], OLD_SHA)
        record = runtime.fleet["fleet"]["kiosk-a"]
        self.assertEqual(record["desiredSha"], OLD_SHA)
        self.assertEqual(record["currentSha"], OLD_SHA)

    def test_pi5_execution_and_marker_use_server_specific_desired_sha(self):
        server = decision("pi5", "server")
        server.update(
            {
                "desiredSha": OLD_SHA,
                "targetReason": "desired SHA differs from role-specific plan",
            }
        )
        plan = {"pi5Required": True, "hosts": [server]}
        runtime = FakeRuntime(
            fleet={"pi5": host_record("server", OLD_SHA)},
            hosts=[{"host": "pi5", "role": "server"}],
            plan=plan,
            targets=[],
        )

        result = coordinator.execute(
            args(), runtime=runtime, token=FakeToken(runtime.events)
        )

        self.assertEqual(result, 0)
        self.assertEqual(runtime.pi5_release_sha, OLD_SHA)
        self.assertEqual(runtime.pi5_marker_sha, OLD_SHA)
        record = runtime.fleet["fleet"]["pi5"]
        self.assertEqual(record["desiredSha"], OLD_SHA)
        self.assertEqual(record["currentSha"], OLD_SHA)

    def test_unverifiable_rollback_remains_unknown(self):
        terminal = {
            "host": "kiosk-a",
            "role": "kiosk",
            "terminalType": "kiosk",
            "clientId": "a",
        }
        plan = {
            "pi5Required": False,
            "hosts": [
                decision("pi5", "server", targeted=False),
                decision("kiosk-a", "kiosk"),
            ],
        }
        runtime = FakeRuntime(
            fleet={
                "pi5": host_record("server", OLD_SHA),
                "kiosk-a": host_record("kiosk", OLD_SHA),
            },
            hosts=[{"host": "pi5", "role": "server"}, terminal],
            plan=plan,
            targets=[terminal],
        )
        runtime.playbook_error = RuntimeError("deploy failed")
        runtime.terminal_observation_error = RuntimeError("host unreachable")

        with self.assertRaisesRegex(RuntimeError, "rollout stopped"):
            coordinator.execute(
                args(), runtime=runtime, token=FakeToken(runtime.events)
            )

        self.assertEqual(runtime.fleet["fleet"]["kiosk-a"]["evidence"], "unknown")
        target = runtime.states[-1].target("kiosk-a")
        self.assertIn("host unreachable", target["rollbackEvidence"])
        self.assertIn("fleet:finish:failed", runtime.events)

    def test_cancellation_finishes_fleet_before_legacy_terminal_state(self):
        plan = {
            "pi5Required": False,
            "hosts": [decision("pi5", "server", targeted=False)],
        }
        runtime = FakeRuntime(
            fleet={"pi5": host_record("server", OLD_SHA)},
            hosts=[{"host": "pi5", "role": "server"}],
            plan=plan,
            targets=[],
        )

        result = coordinator.execute(
            args(),
            runtime=runtime,
            token=FakeToken(runtime.events, cancel_at="plan-complete"),
        )

        self.assertEqual(result, 130)
        finish = runtime.events.index("fleet:finish:cancelled")
        final_save = max(
            index
            for index, event in enumerate(runtime.events)
            if event.startswith("legacy:save:cancelled:completed")
        )
        self.assertLess(finish, final_save)
        self.assertIsNone(runtime.fleet["activeRun"])

    def test_late_cancel_finishes_both_formats_as_cancelled(self):
        plan = {
            "pi5Required": False,
            "hosts": [decision("pi5", "server", targeted=False)],
        }
        runtime = FakeRuntime(
            fleet={"pi5": host_record("server", OLD_SHA)},
            hosts=[{"host": "pi5", "role": "server"}],
            plan=plan,
            targets=[],
        )
        runtime.cancel_at_finish = True

        result = coordinator.execute(
            args(), runtime=runtime, token=FakeToken(runtime.events)
        )

        self.assertEqual(result, 130)
        self.assertEqual(runtime.fleet["lastRun"]["status"], "cancelled")
        self.assertTrue(
            runtime.events[-1].startswith("legacy:save:cancelled:completed")
        )

    def test_abandoned_run_hosts_are_not_seed_promoted(self):
        stranded = host_record("kiosk", NEW_SHA)
        stranded["lastRunId"] = "abandoned-run"
        hosts = [{"host": "kiosk-a", "role": "kiosk"}]
        runtime = FakeRuntime(
            fleet={"kiosk-a": stranded}, hosts=hosts, plan={}, targets=[]
        )

        state, failures = coordinator._seed_unverified_hosts(
            hosts,
            runtime._snapshot(),
            inventory="inventory.yml",
            run_id="run-2",
            desired_sha=NEW_SHA,
            abandoned_run_id="abandoned-run",
            runtime=runtime,
            token=FakeToken(runtime.events),
        )

        self.assertEqual(state["fleet"]["kiosk-a"]["evidence"], "unknown")
        self.assertNotIn("observe:terminal:kiosk-a", runtime.events)
        self.assertIn("interrupted", failures[0]["error"])

    def test_unknown_pi5_success_preserves_last_confirmed_sha(self):
        unknown = host_record("server", OLD_SHA)
        unknown.update({
            "desiredSha": NEW_SHA,
            "currentSha": None,
            "previousSha": OLD_SHA,
            "evidence": "unknown",
            "verifiedAt": None,
        })
        server = decision("pi5", "server")
        server.update({"currentSha": None, "evidence": "unknown"})
        runtime = FakeRuntime(
            fleet={"pi5": unknown},
            hosts=[{"host": "pi5", "role": "server"}],
            plan={"pi5Required": True, "hosts": [server]},
            targets=[],
        )

        self.assertEqual(
            coordinator.execute(args(), runtime=runtime, token=FakeToken(runtime.events)),
            0,
        )
        self.assertEqual(runtime.fleet["fleet"]["pi5"]["previousSha"], OLD_SHA)

    def test_full_fleet_same_sha_preserves_real_previous_sha(self):
        current = host_record("server", NEW_SHA)
        current["previousSha"] = OLD_SHA
        server = decision("pi5", "server", current=NEW_SHA)
        runtime = FakeRuntime(
            fleet={"pi5": current},
            hosts=[{"host": "pi5", "role": "server"}],
            plan={"pi5Required": True, "hosts": [server]},
            targets=[],
        )

        self.assertEqual(
            coordinator.execute(
                args(full_fleet=True), runtime=runtime, token=FakeToken(runtime.events)
            ),
            0,
        )
        self.assertEqual(runtime.fleet["fleet"]["pi5"]["previousSha"], OLD_SHA)
        self.assertIn(f"pi5:host-config:pi5:{NEW_SHA}", runtime.events)


if __name__ == "__main__":
    unittest.main()
