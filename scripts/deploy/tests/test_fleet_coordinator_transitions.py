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
FORWARD_VERIFICATION_ID = "a" * 32
ROLLBACK_VERIFICATION_ID = "b" * 32
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
    READY_ACK_TIMEOUT_SECONDS = 90

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
        self.ready_acknowledgements = {}
        self.ready_ack_error = None
        self.ready_ack_release_override = None
        self.ready_ack_verification_override = None
        self.active_verification_ids = {}
        self.fleet_verified_error_host = None
        self.manifest_capture_error = None
        self.prestage_error = None
        self.maintenance_ack = True
        self.abandoned_run_id = None
        self.prior_runs = {}

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
        return self._bump(), self.abandoned_run_id

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
        if host == self.fleet_verified_error_host:
            raise RuntimeError("fleet persistence unavailable")
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

    def read_release_run(self, run_id):
        self.events.append(f"legacy:read:{run_id}")
        return copy.deepcopy(self.prior_runs.get(run_id))

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

    def observe_terminal_evidence(self, _inventory, host, _role, client_id):
        self.events.append(f"observe:terminal:{host}")
        if self.terminal_observation_error is not None:
            raise self.terminal_observation_error
        current = (
            OLD_SHA
            if any(event == f"rollback:{host}" for event in self.events)
            else self.deployed_sha.get(host, NEW_SHA)
        )
        return {
            "currentSha": current,
            "services": ["required.service"],
            "authenticatedEndpoint": True,
            "statusClientId": client_id,
        }

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

    def capture_terminal_manifest(
        self, _inventory, target_spec, run_id, previous_sha
    ):
        host = target_spec["host"]
        self.events.append(f"manifest:capture:{host}:{previous_sha}")
        if self.manifest_capture_error is not None:
            raise self.manifest_capture_error
        return {
            "path": f"/var/lib/raspi-release/rollback-manifests/{run_id}/{host}/manifest.json",
            "manifestSha256": "c" * 64,
            "count": 12,
        }

    def should_issue_terminal_notice(self, **_kwargs):
        return False

    def terminal_notice_skip_reason(self, **_kwargs):
        return "test"

    def state_command(self, *arguments):
        self.events.append("status:" + ":".join(arguments))

    def prestage_signage_maintenance(self, *_args):
        self.events.append("signage:prestage")
        if self.prestage_error is not None:
            raise self.prestage_error

    def prove_signage_ready(
        self,
        _inventory,
        host,
        run_id,
        client_id,
        release_sha,
        verification_id,
    ):
        self.events.append(
            "signage:ready-proof:"
            f"{host}:{run_id}:{client_id}:{release_sha}:{verification_id}"
        )

    def active_verification_id(
        self, run_id, client_id, *, release_sha, rollback
    ):
        verification_id = (
            ROLLBACK_VERIFICATION_ID if rollback else FORWARD_VERIFICATION_ID
        )
        self.active_verification_ids[(run_id, client_id)] = verification_id
        self.events.append(
            f"status:verification:{client_id}:{release_sha}:{verification_id}"
        )
        return verification_id

    def wait_for_ack(self, run_id, client_id, *_args, **kwargs):
        if kwargs.get("phase") == "ready":
            if (
                self.ready_ack_error is not None
                and kwargs.get("cancellable", True)
            ):
                raise self.ready_ack_error
            self.ready_acknowledgements[(run_id, client_id)] = {
                "ready": {
                    "acknowledgedAt": "2026-07-15T00:00:00Z",
                    "releaseSha": (
                        self.ready_ack_release_override
                        or kwargs["release_sha"]
                    ),
                    "verificationId": (
                        self.ready_ack_verification_override
                        or kwargs["verification_id"]
                    ),
                }
            }
        elif kwargs.get("phase") == "maintenance":
            return self.maintenance_ack
        return True

    def acknowledgement_record(self, run_id, client_id):
        return copy.deepcopy(
            self.ready_acknowledgements.get((run_id, client_id))
        )

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
            {"host": "kiosk-a", "role": "kiosk", "clientId": "a"},
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
        hosts = [{"host": "kiosk-a", "role": "kiosk", "clientId": "a"}]
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
        hosts = [{"host": "kiosk-a", "role": "kiosk", "clientId": "a"}]
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
            runtime.events.index("terminal:previous:kiosk-a"),
            runtime.events.index(f"manifest:capture:kiosk-a:{OLD_SHA}"),
        )
        self.assertLess(
            runtime.events.index(f"manifest:capture:kiosk-a:{OLD_SHA}"),
            runtime.events.index("playbook:kiosk-a"),
        )
        self.assertLess(
            runtime.events.index("playbook:kiosk-a"),
            runtime.events.index(
                "status:set-phase:--run-id:run-1:--client:a:--phase:verifying:"
                f"--desired-release-sha:{NEW_SHA}"
            ),
        )
        self.assertLess(
            runtime.events.index(
                "status:set-phase:--run-id:run-1:--client:a:--phase:verifying:"
                f"--desired-release-sha:{NEW_SHA}"
            ),
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
        target_state = runtime.states[-1].target("kiosk-a")
        self.assertEqual(target_state["readyReleaseSha"], NEW_SHA)
        self.assertEqual(target_state["expectedReadySha"], NEW_SHA)
        self.assertEqual(
            target_state["expectedReadyVerificationId"],
            FORWARD_VERIFICATION_ID,
        )
        self.assertEqual(
            target_state["readyVerificationId"], FORWARD_VERIFICATION_ID
        )
        self.assertEqual(
            target_state["rollbackManifest"],
            {
                "path": (
                    "/var/lib/raspi-release/rollback-manifests/"
                    "run-1/kiosk-a/manifest.json"
                ),
                "manifestSha256": "c" * 64,
                "count": 12,
            },
        )

    def test_manifest_capture_failure_precedes_every_terminal_mutation(self):
        terminal = {
            "host": "kiosk-a",
            "role": "kiosk",
            "terminalType": "kiosk",
            "clientId": "a",
        }
        runtime = FakeRuntime(
            fleet={
                "pi5": host_record("server", OLD_SHA),
                "kiosk-a": host_record("kiosk", OLD_SHA),
            },
            hosts=[{"host": "pi5", "role": "server"}, terminal],
            plan={
                "pi5Required": False,
                "hosts": [
                    decision("pi5", "server", targeted=False),
                    decision("kiosk-a", "kiosk"),
                ],
            },
            targets=[terminal],
        )
        runtime.manifest_capture_error = RuntimeError("manifest unavailable")

        with self.assertRaisesRegex(RuntimeError, "manifest unavailable"):
            coordinator.execute(
                args(), runtime=runtime, token=FakeToken(runtime.events)
            )

        self.assertLess(
            runtime.events.index(f"manifest:capture:kiosk-a:{OLD_SHA}"),
            runtime.events.index("fleet:finish:failed"),
        )
        for forbidden in (
            "playbook:kiosk-a",
            "rollback:kiosk-a",
            "signage:prestage",
        ):
            self.assertNotIn(forbidden, runtime.events)
        self.assertFalse(
            any(event.startswith("status:") for event in runtime.events)
        )
        target = runtime.states[-1].target("kiosk-a")
        self.assertNotIn("maintenanceStartedAt", target)
        self.assertNotIn("rollbackManifest", target)
        self.assertEqual(target["evidence"], "unknown")

    def test_signage_prestage_failure_restores_the_sealed_manifest(self):
        terminal = {
            "host": "signage-a",
            "role": "signage",
            "terminalType": "signage",
            "clientId": "s1",
        }
        runtime = FakeRuntime(
            fleet={
                "pi5": host_record("server", OLD_SHA),
                "signage-a": host_record("signage", OLD_SHA),
            },
            hosts=[{"host": "pi5", "role": "server"}, terminal],
            plan={
                "pi5Required": False,
                "hosts": [
                    decision("pi5", "server", targeted=False),
                    decision("signage-a", "signage"),
                ],
            },
            targets=[terminal],
        )
        runtime.prestage_error = RuntimeError("staging failed")

        with self.assertRaisesRegex(RuntimeError, "rollout stopped"):
            coordinator.execute(
                args(), runtime=runtime, token=FakeToken(runtime.events)
            )

        self.assertLess(
            runtime.events.index(f"manifest:capture:signage-a:{OLD_SHA}"),
            runtime.events.index("signage:prestage"),
        )
        self.assertLess(
            runtime.events.index("signage:prestage"),
            runtime.events.index("rollback:signage-a"),
        )
        self.assertNotIn("playbook:signage-a", runtime.events)
        self.assertIn(
            "signage:ready-proof:signage-a:run-1:s1:"
            f"{OLD_SHA}:{ROLLBACK_VERIFICATION_ID}",
            runtime.events,
        )
        target = runtime.states[-1].target("signage-a")
        self.assertEqual(target["rollbackEvidence"], "verified")
        self.assertIn("maintenanceClearedAt", target)

    def test_cancel_after_maintenance_restores_before_run_cancels(self):
        terminal = {
            "host": "kiosk-a",
            "role": "kiosk",
            "terminalType": "kiosk",
            "clientId": "a",
        }
        runtime = FakeRuntime(
            fleet={
                "pi5": host_record("server", OLD_SHA),
                "kiosk-a": host_record("kiosk", OLD_SHA),
            },
            hosts=[{"host": "pi5", "role": "server"}, terminal],
            plan={
                "pi5Required": False,
                "hosts": [
                    decision("pi5", "server", targeted=False),
                    decision("kiosk-a", "kiosk"),
                ],
            },
            targets=[terminal],
        )

        result = coordinator.execute(
            args(),
            runtime=runtime,
            token=FakeToken(runtime.events, cancel_at="after-maintenance:kiosk-a"),
        )

        self.assertEqual(result, 130)
        self.assertLess(
            runtime.events.index("rollback:kiosk-a"),
            runtime.events.index("fleet:finish:cancelled"),
        )
        self.assertNotIn("playbook:kiosk-a", runtime.events)
        target = runtime.states[-1].target("kiosk-a")
        self.assertEqual(target["rollbackEvidence"], "verified")
        self.assertEqual(target["currentSha"], OLD_SHA)
        self.assertEqual(
            runtime.states[-1].payload["cancellation"]["checkpoint"],
            "after-maintenance:kiosk-a",
        )

    def test_maintenance_ack_timeout_is_manifest_rollback_owned(self):
        terminal = {
            "host": "kiosk-a",
            "role": "kiosk",
            "terminalType": "kiosk",
            "clientId": "a",
        }
        runtime = FakeRuntime(
            fleet={
                "pi5": host_record("server", OLD_SHA),
                "kiosk-a": host_record("kiosk", OLD_SHA),
            },
            hosts=[{"host": "pi5", "role": "server"}, terminal],
            plan={
                "pi5Required": False,
                "hosts": [
                    decision("pi5", "server", targeted=False),
                    decision("kiosk-a", "kiosk"),
                ],
            },
            targets=[terminal],
        )
        runtime.maintenance_ack = False

        with self.assertRaisesRegex(RuntimeError, "rollout stopped"):
            coordinator.execute(
                args(), runtime=runtime, token=FakeToken(runtime.events)
            )

        self.assertIn("rollback:kiosk-a", runtime.events)
        self.assertNotIn("playbook:kiosk-a", runtime.events)
        target = runtime.states[-1].target("kiosk-a")
        self.assertIn("maintenance acknowledgement timed out", target["failure"])
        self.assertEqual(target["rollbackEvidence"], "verified")

    def test_terminal_only_kiosk_acks_the_verified_web_release(self):
        terminal = {
            "host": "kiosk-a",
            "role": "kiosk",
            "terminalType": "kiosk",
            "clientId": "a",
        }
        runtime = FakeRuntime(
            fleet={
                "pi5": host_record("server", OLD_SHA),
                "kiosk-a": host_record("kiosk", OLD_SHA),
            },
            hosts=[{"host": "pi5", "role": "server"}, terminal],
            plan={
                "pi5Required": False,
                "hosts": [
                    decision("pi5", "server", targeted=False),
                    decision("kiosk-a", "kiosk"),
                ],
            },
            targets=[terminal],
        )

        self.assertEqual(
            coordinator.execute(
                args(), runtime=runtime, token=FakeToken(runtime.events)
            ),
            0,
        )

        target = runtime.states[-1].target("kiosk-a")
        self.assertEqual(target["newSha"], NEW_SHA)
        self.assertEqual(target["expectedReadySha"], OLD_SHA)
        self.assertEqual(target["readyReleaseSha"], OLD_SHA)
        self.assertEqual(target["readyVerificationId"], FORWARD_VERIFICATION_ID)
        self.assertIn(
            "status:set-phase:--run-id:run-1:--client:a:--phase:verifying:"
            f"--desired-release-sha:{OLD_SHA}",
            runtime.events,
        )

    def test_post_health_fleet_failure_never_rolls_the_exposed_terminal_back(self):
        terminal = {
            "host": "kiosk-a",
            "role": "kiosk",
            "terminalType": "kiosk",
            "clientId": "a",
        }
        runtime = FakeRuntime(
            fleet={
                "pi5": host_record("server", OLD_SHA),
                "kiosk-a": host_record("kiosk", OLD_SHA),
            },
            hosts=[{"host": "pi5", "role": "server"}, terminal],
            plan={
                "pi5Required": False,
                "hosts": [
                    decision("pi5", "server", targeted=False),
                    decision("kiosk-a", "kiosk"),
                ],
            },
            targets=[terminal],
        )
        runtime.fleet_verified_error_host = "kiosk-a"

        with self.assertRaisesRegex(RuntimeError, "terminal finalization failed"):
            coordinator.execute(
                args(), runtime=runtime, token=FakeToken(runtime.events)
            )

        self.assertIn(
            "status:remove-client:--run-id:run-1:--client:a", runtime.events
        )
        self.assertNotIn("rollback:kiosk-a", runtime.events)
        target = runtime.states[-1].target("kiosk-a")
        self.assertIn("maintenanceClearedAt", target)
        self.assertEqual(target["evidence"], "unknown")
        self.assertIn("fleet persistence unavailable", target["finalizationFailure"])
        self.assertEqual(runtime.fleet["fleet"]["kiosk-a"]["evidence"], "unknown")
        self.assertIn("fleet:finish:failed", runtime.events)

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
        self.assertIn(
            "status:set-phase:--run-id:run-1:--client:a:--phase:verifying:"
            f"--desired-release-sha:{OLD_SHA}:--rollback",
            runtime.events,
        )
        self.assertEqual(runtime.fleet["fleet"]["kiosk-a"]["currentSha"], OLD_SHA)
        self.assertEqual(runtime.fleet["fleet"]["kiosk-a"]["evidence"], "verified")
        target = runtime.states[-1].target("kiosk-a")
        self.assertEqual(target["expectedRollbackReadySha"], OLD_SHA)
        self.assertEqual(target["rollbackReadyReleaseSha"], OLD_SHA)
        self.assertEqual(
            target["expectedRollbackReadyVerificationId"],
            ROLLBACK_VERIFICATION_ID,
        )
        self.assertEqual(
            target["rollbackReadyVerificationId"], ROLLBACK_VERIFICATION_ID
        )
        self.assertIn("maintenanceClearedAt", target)
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
        self.assertNotIn("maintenanceClearedAt", target)
        self.assertNotIn(
            "status:remove-client:--run-id:run-1:--client:a",
            runtime.events,
        )
        self.assertIn("fleet:finish:failed", runtime.events)

    def test_cancel_during_ready_wait_rolls_back_before_cancel_finishes(self):
        terminal = {
            "host": "kiosk-a",
            "role": "kiosk",
            "terminalType": "kiosk",
            "clientId": "a",
        }
        runtime = FakeRuntime(
            fleet={
                "pi5": host_record("server", OLD_SHA),
                "kiosk-a": host_record("kiosk", OLD_SHA),
            },
            hosts=[{"host": "pi5", "role": "server"}, terminal],
            plan={
                "pi5Required": False,
                "hosts": [
                    decision("pi5", "server", targeted=False),
                    decision("kiosk-a", "kiosk"),
                ],
            },
            targets=[terminal],
        )
        runtime.ready_ack_error = CancellationRequested(
            "operator stop", "wait-ready-ack:a"
        )

        result = coordinator.execute(
            args(), runtime=runtime, token=FakeToken(runtime.events)
        )

        self.assertEqual(result, 130)
        target = runtime.states[-1].target("kiosk-a")
        self.assertEqual(target["rollbackEvidence"], "verified")
        self.assertEqual(target["currentSha"], OLD_SHA)
        self.assertEqual(target["rollbackReadyReleaseSha"], OLD_SHA)
        self.assertEqual(
            target["rollbackReadyVerificationId"], ROLLBACK_VERIFICATION_ID
        )
        self.assertNotEqual(
            target["expectedReadyVerificationId"],
            target["rollbackReadyVerificationId"],
        )
        self.assertIn("maintenanceClearedAt", target)
        self.assertIn(
            "status:set-phase:--run-id:run-1:--client:a:--phase:verifying:"
            f"--desired-release-sha:{OLD_SHA}:--rollback",
            runtime.events,
        )
        self.assertLess(
            runtime.events.index("rollback:kiosk-a"),
            runtime.events.index("fleet:finish:cancelled"),
        )
        self.assertIn(
            "status:remove-run:--run-id:run-1", runtime.events
        )
        self.assertEqual(
            runtime.states[-1].payload["cancellation"]["checkpoint"],
            "wait-ready-ack:a",
        )

    def test_cancel_with_unknown_rollback_keeps_terminal_maintenance(self):
        terminal = {
            "host": "kiosk-a",
            "role": "kiosk",
            "terminalType": "kiosk",
            "clientId": "a",
        }
        runtime = FakeRuntime(
            fleet={
                "pi5": host_record("server", OLD_SHA),
                "kiosk-a": host_record("kiosk", OLD_SHA),
            },
            hosts=[{"host": "pi5", "role": "server"}, terminal],
            plan={
                "pi5Required": False,
                "hosts": [
                    decision("pi5", "server", targeted=False),
                    decision("kiosk-a", "kiosk"),
                ],
            },
            targets=[terminal],
        )
        runtime.ready_ack_error = CancellationRequested(
            "operator stop", "wait-ready-ack:a"
        )
        runtime.terminal_observation_error = RuntimeError("health unavailable")

        result = coordinator.execute(
            args(), runtime=runtime, token=FakeToken(runtime.events)
        )

        self.assertEqual(result, 130)
        target = runtime.states[-1].target("kiosk-a")
        self.assertIn("health unavailable", target["rollbackEvidence"])
        self.assertNotIn("maintenanceClearedAt", target)
        self.assertEqual(
            runtime.states[-1].payload["cancellationCleanup"]["state"],
            "retained",
        )
        self.assertNotIn(
            "status:remove-run:--run-id:run-1", runtime.events
        )
        self.assertEqual(runtime.fleet["fleet"]["kiosk-a"]["evidence"], "unknown")

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
        hosts = [{"host": "kiosk-a", "role": "kiosk", "clientId": "a"}]
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

    def test_new_run_restores_interrupted_terminal_before_planning(self):
        terminal = {
            "host": "kiosk-a",
            "role": "kiosk",
            "terminalType": "kiosk",
            "clientId": "a",
        }
        interrupted = host_record("kiosk", OLD_SHA)
        interrupted.update(
            {
                "desiredSha": NEW_SHA,
                "currentSha": None,
                "previousSha": OLD_SHA,
                "evidence": "unknown",
                "verifiedAt": None,
                "lastRunId": "crashed-run",
            }
        )
        runtime = FakeRuntime(
            fleet={
                "pi5": host_record("server", NEW_SHA),
                "kiosk-a": interrupted,
            },
            hosts=[{"host": "pi5", "role": "server"}, terminal],
            plan={
                "pi5Required": False,
                "hosts": [
                    decision("pi5", "server", current=NEW_SHA, targeted=False),
                    decision("kiosk-a", "kiosk", targeted=False),
                ],
            },
            targets=[],
        )
        runtime.abandoned_run_id = "crashed-run"
        runtime.prior_runs["crashed-run"] = {
            "version": 1,
            "runId": "crashed-run",
            "state": "running",
            "targets": [
                {
                    **terminal,
                    "desiredSha": NEW_SHA,
                    "previousSha": OLD_SHA,
                    "currentSha": None,
                    "evidence": "unknown",
                    "state": "deploying",
                    "maintenanceStartedAt": "2026-07-14T23:59:00Z",
                    "rollbackManifest": {
                        "path": (
                            "/var/lib/raspi-release/rollback-manifests/"
                            "crashed-run/kiosk-a/manifest.json"
                        ),
                        "manifestSha256": "d" * 64,
                        "count": 12,
                    },
                }
            ],
        }

        self.assertEqual(
            coordinator.execute(
                args(), runtime=runtime, token=FakeToken(runtime.events)
            ),
            0,
        )

        self.assertLess(
            runtime.events.index("legacy:read:crashed-run"),
            runtime.events.index("rollback:kiosk-a"),
        )
        self.assertLess(
            runtime.events.index("rollback:kiosk-a"),
            runtime.events.index(f"fleet:verified:kiosk-a:{OLD_SHA}"),
        )
        self.assertNotIn(f"manifest:capture:kiosk-a:{OLD_SHA}", runtime.events)
        record = runtime.fleet["fleet"]["kiosk-a"]
        self.assertEqual(record["currentSha"], OLD_SHA)
        self.assertEqual(record["evidence"], "verified")
        recovery = runtime.states[-1].payload["interruptedRecovery"]
        self.assertEqual(recovery["runId"], "crashed-run")
        self.assertEqual(recovery["targets"][0]["recovery"], "manifest-restored")
        self.assertIn(
            "status:remove-client:--run-id:crashed-run:--client:a",
            runtime.events,
        )

    def test_interrupted_target_without_run_record_fails_closed(self):
        terminal = {
            "host": "kiosk-a",
            "role": "kiosk",
            "terminalType": "kiosk",
            "clientId": "a",
        }
        interrupted = host_record("kiosk", OLD_SHA)
        interrupted.update(
            {
                "currentSha": None,
                "previousSha": OLD_SHA,
                "evidence": "unknown",
                "lastRunId": "crashed-run",
            }
        )
        runtime = FakeRuntime(
            fleet={"kiosk-a": interrupted},
            hosts=[{"host": "pi5", "role": "server"}, terminal],
            plan={},
            targets=[],
        )
        runtime.abandoned_run_id = "crashed-run"

        with self.assertRaisesRegex(
            RuntimeError, "refusing to capture a partial host"
        ):
            coordinator.execute(
                args(), runtime=runtime, token=FakeToken(runtime.events)
            )

        self.assertIn("legacy:read:crashed-run", runtime.events)
        self.assertNotIn("rollback:kiosk-a", runtime.events)
        self.assertFalse(
            any(event.startswith("manifest:capture:") for event in runtime.events)
        )
        self.assertIn("fleet:finish:failed", runtime.events)

    def test_completed_terminal_in_abandoned_run_is_live_verified_not_reverted(self):
        terminal = {
            "host": "kiosk-a",
            "role": "kiosk",
            "terminalType": "kiosk",
            "clientId": "a",
        }
        completed = host_record("kiosk", NEW_SHA)
        completed["lastRunId"] = "crashed-run"
        runtime = FakeRuntime(
            fleet={
                "pi5": host_record("server", NEW_SHA),
                "kiosk-a": completed,
            },
            hosts=[{"host": "pi5", "role": "server"}, terminal],
            plan={
                "pi5Required": False,
                "hosts": [
                    decision("pi5", "server", current=NEW_SHA, targeted=False),
                    decision(
                        "kiosk-a", "kiosk", current=NEW_SHA, targeted=False
                    ),
                ],
            },
            targets=[],
        )
        runtime.abandoned_run_id = "crashed-run"
        runtime.prior_runs["crashed-run"] = {
            "version": 1,
            "runId": "crashed-run",
            "state": "running",
            "targets": [
                {
                    **terminal,
                    "desiredSha": NEW_SHA,
                    "currentSha": NEW_SHA,
                    "newSha": NEW_SHA,
                    "previousSha": OLD_SHA,
                    "evidence": "verified",
                    "state": "success",
                    "maintenanceStartedAt": "2026-07-14T23:58:00Z",
                    "maintenanceClearedAt": "2026-07-14T23:59:00Z",
                }
            ],
        }

        self.assertEqual(
            coordinator.execute(
                args(), runtime=runtime, token=FakeToken(runtime.events)
            ),
            0,
        )

        self.assertNotIn("rollback:kiosk-a", runtime.events)
        self.assertNotIn(
            "status:remove-client:--run-id:crashed-run:--client:a",
            runtime.events,
        )
        self.assertEqual(
            runtime.states[-1].payload["interruptedRecovery"]["targets"][0][
                "recovery"
            ],
            "completed-live-verified",
        )
        self.assertEqual(
            runtime.fleet["fleet"]["kiosk-a"]["currentSha"], NEW_SHA
        )

    def test_interrupted_manifest_restore_failure_keeps_unknown_and_stops(self):
        terminal = {
            "host": "kiosk-a",
            "role": "kiosk",
            "terminalType": "kiosk",
            "clientId": "a",
        }
        interrupted = host_record("kiosk", OLD_SHA)
        interrupted.update(
            {
                "currentSha": None,
                "previousSha": OLD_SHA,
                "evidence": "unknown",
                "lastRunId": "crashed-run",
            }
        )
        runtime = FakeRuntime(
            fleet={"kiosk-a": interrupted},
            hosts=[{"host": "pi5", "role": "server"}, terminal],
            plan={},
            targets=[],
        )
        runtime.abandoned_run_id = "crashed-run"
        runtime.rollback_ok = False
        runtime.prior_runs["crashed-run"] = {
            "version": 1,
            "runId": "crashed-run",
            "state": "interrupted",
            "targets": [
                {
                    **terminal,
                    "desiredSha": NEW_SHA,
                    "previousSha": OLD_SHA,
                    "state": "deploying",
                    "maintenanceStartedAt": "2026-07-14T23:59:00Z",
                    "rollbackManifest": {
                        "path": "sealed",
                        "manifestSha256": "d" * 64,
                        "count": 1,
                    },
                }
            ],
        }

        with self.assertRaisesRegex(RuntimeError, "manifest restore failed"):
            coordinator.execute(
                args(), runtime=runtime, token=FakeToken(runtime.events)
            )

        self.assertIn("rollback:kiosk-a", runtime.events)
        self.assertEqual(runtime.fleet["fleet"]["kiosk-a"]["evidence"], "unknown")
        self.assertNotIn(
            "status:remove-client:--run-id:crashed-run:--client:a",
            runtime.events,
        )

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
