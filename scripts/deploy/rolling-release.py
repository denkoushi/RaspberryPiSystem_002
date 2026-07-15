#!/usr/bin/env python3
"""Compatible entry point for the single rolling-release coordinator."""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


SCRIPT_DIRECTORY = Path(__file__).resolve().parent
if str(SCRIPT_DIRECTORY) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIRECTORY))

# The historical unit suite loads this file as ``rolling_release``.  Make that
# dynamic module package-capable while retaining the hyphenated executable.
if __name__ == "rolling_release" and "__path__" not in globals():
    __path__ = [str(SCRIPT_DIRECTORY / "rolling_release")]

from terminal_notice import (
    NOTICE_ACK_TIMEOUT_SECONDS,
    NOTICE_DURATION_SECONDS,
    should_issue_terminal_notice,
    terminal_notice_skip_reason,
)
from rolling_release import application as release_application
from rolling_release import cli as release_cli
from rolling_release import coordinator as release_coordinator
from rolling_release import planner as release_planner
from rolling_release import policy as release_policy
from rolling_release.backends import ansible as ansible_backend
from rolling_release.backends import evidence as evidence_backend
from rolling_release.backends import pi5 as pi5_backend
from rolling_release.backends import systemd as systemd_backend
from rolling_release.cancellation import CancellationToken, token_from_environment
from rolling_release.fleet_state import (
    FleetLease,
    FleetStateStore,
    empty_fleet_state,
    parse_fleet_state_json,
)
from rolling_release.lock import (
    validate_inherited_fleet_lock,
    validate_inherited_release_lock,
)
from rolling_release.models import unit_name_for
from rolling_release.state import RunStateStore, TERMINAL_STATES


PROJECT = Path(__file__).resolve().parents[2]
REMOTE_PROJECT = Path("/opt/RaspberryPiSystem_002")
ANSIBLE_DIRECTORY = PROJECT / "infrastructure/ansible"
STATUS_TOOL = PROJECT / "scripts/deploy/deploy-status-state.py"
PHASE3 = PROJECT / "scripts/deploy/pi5-blue-green.sh"
CANDIDATE_BUILD = PROJECT / "scripts/deploy/pi5-candidate-build.sh"
RUN_DIRECTORY = PROJECT / "logs/deploy/release-runs"
PI5_RELEASE_CURRENT = PROJECT / "logs/deploy/pi5-release-current.json"
FLEET_RELEASE_STATE = PROJECT / "logs/deploy/fleet-release-state.json"
FLEET_RELEASE_LOCK = PROJECT / "logs/deploy/fleet-release-state.lock"
OPERATOR_CANARY_APPROVAL_CLIENT = "operator-canary-approval"
DEFAULT_CANARY_HOLD_TIMEOUT = release_cli.DEFAULT_CANARY_HOLD_TIMEOUT
FULL_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
VERIFICATION_ID_RE = re.compile(r"^[0-9a-f]{32}$")
CLEANUP_LOCK_CONFLICT = "another Pi5 Blue/Green operation is running"
CLEANUP_LOCK_RETRY_TIMEOUT = 30
CLEANUP_LOCK_RETRY_INTERVAL = 2
READY_ACK_TIMEOUT_SECONDS = 90
KIOSK_SCOPE_COMPONENTS = release_policy.KIOSK_SCOPE_COMPONENTS
_ACTIVE_CANCELLATION_TOKEN: CancellationToken | None = None
_ACTIVE_FLEET_LEASE: FleetLease | None = None
_PREVIOUS_SHA_UNSET = object()


def _runtime() -> Any:
    return sys.modules[__name__]


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def run(
    command: list[str],
    *,
    cwd: Path = PROJECT,
    capture: bool = False,
    env: dict[str, str] | None = None,
) -> str:
    result = subprocess.run(
        command,
        cwd=cwd,
        check=True,
        text=True,
        capture_output=capture,
        env=env,
    )
    return result.stdout if capture else ""


def atomic_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + f".{os.getpid()}.tmp")
    temporary.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    os.replace(temporary, path)


def release_targets(
    inventory: dict[str, Any], selected: Iterable[str] | None = None
) -> list[dict[str, str]]:
    return release_policy.release_targets(inventory, selected)


def should_hold_after_canary(
    targets: list[dict[str, str]], index: int, *, skip: bool
) -> bool:
    return release_policy.should_hold_after_canary(targets, index, skip=skip)


def apply_auto_minimize(
    targets: list[dict[str, str]],
    inventory: dict[str, Any],
    classification: dict[str, Any] | None,
) -> tuple[list[dict[str, str]], dict[str, Any]]:
    return release_policy.apply_auto_minimize(targets, inventory, classification)


def release_hosts(
    inventory: dict[str, Any], selected: Iterable[str] | None = None
) -> list[dict[str, str]]:
    return release_policy.release_hosts(inventory, selected)


def inventory_server_identity(inventory: dict[str, Any]) -> dict[str, str]:
    return release_policy.server_identity(inventory)


def validate_print_plan_checkout(sha: str) -> None:
    release_application.require_checkout_sha(sha, runtime=_runtime())


def validate_print_plan_server_identity(
    inventory: dict[str, Any],
) -> dict[str, str]:
    return release_application.validate_remote_server_identity(
        inventory, runtime=_runtime()
    )


def canonical_print_plan_inventory(inventory: str) -> str:
    relative = release_application._remote_inventory(inventory, runtime=_runtime())
    return str(ANSIBLE_DIRECTORY / relative)


def plan_target_decisions(
    targets: list[dict[str, Any]],
    fleet: dict[str, Any],
    release_sha: str,
    classifications_by_sha: dict[str, dict[str, Any] | None],
    inventory: dict[str, Any],
    *,
    full_fleet: bool,
) -> list[dict[str, Any]]:
    return release_policy.plan_target_decisions(
        targets,
        fleet,
        release_sha,
        classifications_by_sha,
        inventory,
        full_fleet=full_fleet,
    )


def _fleet_store() -> FleetStateStore:
    return FleetStateStore(FLEET_RELEASE_STATE, lock_path=FLEET_RELEASE_LOCK)


def _fleet_lease() -> FleetLease:
    if _ACTIVE_FLEET_LEASE is None:
        raise RuntimeError("authoritative fleet lease is not active")
    return _ACTIVE_FLEET_LEASE


def read_fleet_release_state() -> dict[str, Any]:
    return _fleet_store().read_only()


def read_plan_fleet_release_state() -> tuple[dict[str, Any], list[str]]:
    try:
        _remote_user, transport = release_application.build_server_transport(_runtime())
        result = transport.run(
            ["cat", "/opt/RaspberryPiSystem_002/logs/deploy/fleet-release-state.json"]
        )
        if result.returncode != 0:
            detail = (result.stderr or result.stdout or "remote read failed").strip()
            raise RuntimeError(detail)
        return parse_fleet_state_json(result.stdout, source="remote fleet state"), []
    except Exception as error:
        return empty_fleet_state(), [f"fleet state unavailable: {error}"]


def fleet_begin_run(run_id: str, desired_sha: str, inventory: str) -> tuple[dict[str, Any], str | None]:
    store = _fleet_store()
    state = store.read_only()
    abandoned: str | None = None
    active = state.get("activeRun")
    if isinstance(active, dict):
        active_id = active.get("runId")
        if isinstance(active_id, str):
            state = store.abandon_active_run(
                active_id,
                expected_generation=state["generation"],
                lease=_fleet_lease(),
            )
            abandoned = active_id
    state = store.begin_run(
        run_id,
        desired_sha,
        inventory,
        expected_generation=state["generation"],
        kind="release",
        lease=_fleet_lease(),
    )
    return state, abandoned


def fleet_mark_unknown(host: str, role: str, desired_sha: str, run_id: str) -> dict[str, Any]:
    store = _fleet_store()
    state = store.read_only()
    return store.mark_host_unknown(
        host,
        role,
        desired_sha,
        run_id,
        expected_generation=state["generation"],
        lease=_fleet_lease(),
    )


def fleet_mark_verified(
    host: str,
    role: str,
    desired_sha: str,
    current_sha: str,
    run_id: str,
    *,
    previous_sha: str | None | object = _PREVIOUS_SHA_UNSET,
    observation: dict[str, Any] | None = None,
) -> dict[str, Any]:
    store = _fleet_store()
    state = store.read_only()
    observed = observation or {}
    options: dict[str, Any] = {
        "active_slot": observed.get("activeSlot"),
        "api_image": observed.get("apiImage"),
        "web_image": observed.get("webImage"),
        "config_digest": observed.get("configDigest"),
        "migration_digest": observed.get("migrationDigest"),
        "expected_generation": state["generation"],
        "lease": _fleet_lease(),
    }
    if previous_sha is not _PREVIOUS_SHA_UNSET:
        options["previous_sha"] = previous_sha
    return store.mark_host_verified(
        host,
        role,
        desired_sha,
        current_sha,
        run_id,
        **options,
    )


def fleet_finish_run(run_id: str, status: str) -> dict[str, Any]:
    store = _fleet_store()
    state = store.read_only()
    return store.finish_run(
        run_id,
        status,
        expected_generation=state["generation"],
        lease=_fleet_lease(),
    )


def observe_terminal_evidence(
    inventory: str, host: str, role: str, client_id: str
) -> dict[str, Any]:
    return evidence_backend.observe_terminal(
        inventory, host, role, client_id, runtime=_runtime()
    )


def observe_pi5_evidence(expected_sha: str | None) -> dict[str, Any]:
    return evidence_backend.observe_pi5(expected_sha, runtime=_runtime())


@dataclass
class ReleaseState:
    path: Path
    payload: dict[str, Any]

    def save(self, *, before_terminal_persist: Any | None = None) -> None:
        run_id = str(self.payload.get("runId") or self.path.stem)
        self.payload.setdefault("runId", run_id)
        self.payload.setdefault("version", 1)
        store = RunStateStore(self.path.parent, clock=utc_now)
        current = store.read_state(run_id)
        requested_state = self.payload.get("state")
        if current is None:
            saved = store.create_state(run_id, self.payload)
        elif requested_state in TERMINAL_STATES:
            changes = {key: value for key, value in self.payload.items() if key != "state"}
            saved = store.finish_state(
                run_id,
                requested_state,
                changes=changes,
                before_persist=before_terminal_persist,
            )
        else:
            saved = store.update_state(run_id, lambda _current: self.payload)
        # Keep the payload object graph stable. Helpers retain a target
        # reference across several saves; replacing this deep-copied mapping
        # would make later target mutations invisible on disk.
        persistence_fields = {
            "version",
            "runId",
            "state",
            "updatedAt",
            "completedAt",
            "endedAt",
            "exitCode",
        }
        for key, value in saved.items():
            if key in persistence_fields or key not in self.payload:
                self.payload[key] = value

    def target(self, host: str) -> dict[str, Any]:
        for target in self.payload["targets"]:
            if target["host"] == host:
                return target
        raise KeyError(host)


def status_file(run_id: str) -> Path:
    return RUN_DIRECTORY / f"{run_id}.json"


def read_release_run(run_id: str) -> dict[str, Any] | None:
    return RunStateStore(RUN_DIRECTORY, clock=utc_now).read_state(run_id)


def inventory_json(path: str) -> dict[str, Any]:
    return ansible_backend.inventory_json(path, runtime=_runtime())


def selected_hosts(path: str, limit: str) -> list[str] | None:
    return ansible_backend.selected_hosts(path, limit, runtime=_runtime())


def state_command(*arguments: str) -> None:
    run(
        [
            "python3",
            str(STATUS_TOOL),
            "--file",
            str(PROJECT / "config/deploy-status.json"),
            *arguments,
        ]
    )


def _cancellation_checkpoint(name: str) -> None:
    if _ACTIVE_CANCELLATION_TOKEN is not None:
        _ACTIVE_CANCELLATION_TOKEN.checkpoint(name)


def acknowledgement_record(run_id: str, client_id: str) -> dict[str, Any] | None:
    try:
        value = json.loads(
            (PROJECT / "config/deploy-status.json").read_text(encoding="utf-8")
        )
    except (FileNotFoundError, json.JSONDecodeError):
        return None
    record = ((value.get("acknowledgements") or {}).get(run_id) or {}).get(client_id)
    return record if isinstance(record, dict) else None


def active_verification_id(
    run_id: str,
    client_id: str,
    *,
    release_sha: str,
    rollback: bool,
) -> str:
    """Read the exact verification challenge installed by the state writer."""

    if FULL_SHA_RE.fullmatch(release_sha) is None:
        raise ValueError("active verification requires an immutable release SHA")
    try:
        value = json.loads(
            (PROJECT / "config/deploy-status.json").read_text(encoding="utf-8")
        )
    except (FileNotFoundError, json.JSONDecodeError) as error:
        raise RuntimeError("active terminal verification is unavailable") from error
    entry = ((value.get("kioskByClient") or {}).get(client_id) or {})
    expected_mode = "rollback" if rollback else "release"
    verification_id = entry.get("verificationId")
    if (
        entry.get("runId") != run_id
        or entry.get("maintenance") is not True
        or entry.get("phase") != "verifying"
        or entry.get("desiredReleaseSha") != release_sha
        or entry.get("verificationMode") != expected_mode
        or not isinstance(verification_id, str)
        or VERIFICATION_ID_RE.fullmatch(verification_id) is None
    ):
        raise RuntimeError("active terminal verification does not match the rollout")
    return verification_id


def acknowledgement_received(
    run_id: str,
    client_id: str,
    *,
    phase: str = "maintenance",
    release_sha: str | None = None,
    verification_id: str | None = None,
) -> bool:
    if phase == "ready" and (
        release_sha is None or FULL_SHA_RE.fullmatch(release_sha) is None
        or verification_id is None
        or VERIFICATION_ID_RE.fullmatch(verification_id) is None
    ):
        raise ValueError(
            "ready acknowledgement requires an immutable release SHA and verification ID"
        )
    record = acknowledgement_record(run_id, client_id)
    if record is None:
        return False
    if phase == "maintenance" and isinstance(record.get("acknowledgedAt"), str):
        return True
    phase_record = record.get(phase)
    if not isinstance(phase_record, dict) or not isinstance(
        phase_record.get("acknowledgedAt"), str
    ):
        return False
    return phase != "ready" or (
        phase_record.get("releaseSha") == release_sha
        and phase_record.get("verificationId") == verification_id
    )


def wait_for_ack(
    run_id: str,
    client_id: str,
    timeout: int = 30,
    *,
    phase: str = "maintenance",
    release_sha: str | None = None,
    verification_id: str | None = None,
    cancellable: bool = True,
) -> bool:
    if phase == "ready" and (
        release_sha is None or FULL_SHA_RE.fullmatch(release_sha) is None
        or verification_id is None
        or VERIFICATION_ID_RE.fullmatch(verification_id) is None
    ):
        raise ValueError(
            "ready acknowledgement requires an immutable release SHA and verification ID"
        )
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if cancellable:
            _cancellation_checkpoint(f"wait-{phase}-ack:{client_id}")
        if acknowledgement_received(
            run_id,
            client_id,
            phase=phase,
            release_sha=release_sha,
            verification_id=verification_id,
        ):
            return True
        time.sleep(5)
    if cancellable:
        _cancellation_checkpoint(f"wait-{phase}-ack:{client_id}")
    return acknowledgement_received(
        run_id,
        client_id,
        phase=phase,
        release_sha=release_sha,
        verification_id=verification_id,
    )


def notice_scheduled_at(run_id: str, client_id: str) -> str | None:
    try:
        value = json.loads(
            (PROJECT / "config/deploy-status.json").read_text(encoding="utf-8")
        )
    except (FileNotFoundError, json.JSONDecodeError):
        return None
    entry = ((value.get("kioskByClient") or {}).get(client_id) or {})
    scheduled_at = entry.get("scheduledAt") if entry.get("runId") == run_id else None
    return scheduled_at if isinstance(scheduled_at, str) else None


def wait_for_notice_deadline(scheduled_at: str) -> None:
    try:
        deadline = datetime.fromisoformat(scheduled_at.replace("Z", "+00:00")).timestamp()
    except ValueError as error:
        raise RuntimeError(f"notice schedule is invalid: {scheduled_at!r}") from error
    while True:
        _cancellation_checkpoint("terminal-notice")
        remaining = deadline - time.time()
        if remaining <= 0:
            return
        time.sleep(min(5, max(1, remaining)))


def deliver_terminal_notice(
    state: ReleaseState,
    target_spec: dict[str, str],
    target: dict[str, Any],
    run_id: str,
) -> None:
    target["notice"] = {
        "state": "requested",
        "requestedAt": utc_now(),
        "durationSeconds": NOTICE_DURATION_SECONDS,
    }
    state.save()
    state_command(
        "put-notice",
        "--run-id",
        run_id,
        "--clients",
        target_spec["clientId"],
        "--terminal-type",
        "kiosk",
        "--duration-seconds",
        str(NOTICE_DURATION_SECONDS),
    )
    try:
        if not wait_for_ack(
            run_id,
            target_spec["clientId"],
            NOTICE_ACK_TIMEOUT_SECONDS,
            phase="notice",
        ):
            raise RuntimeError(
                f'pre-deploy notice acknowledgement timed out for {target_spec["host"]}'
            )
        scheduled_at = notice_scheduled_at(run_id, target_spec["clientId"])
        if not scheduled_at:
            raise RuntimeError(
                f'pre-deploy notice schedule is missing for {target_spec["host"]}'
            )
        target["notice"].update(
            {"state": "acknowledged", "acknowledgedAt": utc_now(), "scheduledAt": scheduled_at}
        )
        state.save()
        wait_for_notice_deadline(scheduled_at)
        target["notice"].update({"state": "completed", "completedAt": utc_now()})
        state.save()
    except Exception:
        state_command(
            "remove-client", "--run-id", run_id, "--client", target_spec["clientId"]
        )
        target["notice"].update({"state": "failed", "failedAt": utc_now()})
        state.save()
        raise


def canary_hold_record(run_id: str) -> dict[str, Any]:
    output = run(
        [
            "python3",
            str(STATUS_TOOL),
            "--file",
            str(PROJECT / "config/deploy-status.json"),
            "canary-hold-state",
            "--run-id",
            run_id,
        ],
        capture=True,
    )
    record = json.loads(output)
    if not isinstance(record, dict):
        raise RuntimeError("canary hold state is malformed")
    return record


def wait_for_canary_approval(run_id: str, timeout: int) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    while True:
        _cancellation_checkpoint("canary-approval")
        record = canary_hold_record(run_id)
        _cancellation_checkpoint("canary-approval-observed")
        gate_state = record.get("state")
        if gate_state == "approved":
            return record
        if gate_state == "expired":
            raise RuntimeError(f"canary hold timed out after {timeout}s waiting for operator approval")
        if gate_state != "waiting-verification":
            raise RuntimeError(f"canary hold entered unexpected state: {gate_state!r}")
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            state_command("expire-canary-hold", "--run-id", run_id)
            record = canary_hold_record(run_id)
            if record.get("state") == "approved":
                return record
            raise RuntimeError(f"canary hold timed out after {timeout}s waiting for operator approval")
        time.sleep(min(5, max(1, remaining)))


def wait_for_canary_hold(
    state: ReleaseState, run_id: str, canary_host: str, timeout: int
) -> None:
    if timeout <= 0:
        raise RuntimeError("canary hold timeout must be greater than zero")
    expires_at = int(time.time()) + timeout
    state.payload["canaryHold"] = {
        "state": "waiting-verification",
        "canary": canary_host,
        "since": utc_now(),
        "expiresAt": expires_at,
    }
    state.save()
    state_command(
        "open-canary-hold",
        "--run-id",
        run_id,
        "--canary",
        canary_host,
        "--expires-at",
        str(expires_at),
    )
    print(
        f"Canary verification pending. Approve with: scripts/update-all-clients.sh --approve {run_id}",
        flush=True,
    )
    try:
        record = wait_for_canary_approval(run_id, timeout)
    except Exception:
        # Mirror the authoritative gate transition (notably ``expired``) into
        # the durable run record before the coordinator records failure.
        try:
            state.payload["canaryHold"].update(canary_hold_record(run_id))
            state.save()
        except Exception:
            pass
        raise
    state.payload["canaryHold"].update(record)
    state.save()


def prestage_signage_maintenance(
    inventory: str, host: str, run_id: str, client_id: str
) -> None:
    return ansible_backend.prestage_signage_maintenance(
        inventory, host, run_id, client_id, runtime=_runtime()
    )


def remote_previous_sha(inventory: str, host: str) -> str:
    return ansible_backend.remote_previous_sha(inventory, host, runtime=_runtime())


def capture_terminal_manifest(
    inventory: str,
    target_spec: dict[str, str],
    run_id: str,
    previous_sha: str,
) -> dict[str, Any]:
    return ansible_backend.capture_terminal_manifest(
        inventory,
        target_spec,
        run_id,
        previous_sha,
        runtime=_runtime(),
    )


def probe_terminal_identity(
    inventory: str, host: str, client_id: str
) -> dict[str, Any]:
    return ansible_backend.probe_terminal_identity(
        inventory, host, client_id, runtime=_runtime()
    )


def trigger_signage_ready_check(inventory: str, host: str) -> None:
    return ansible_backend.trigger_signage_ready_check(
        inventory, host, runtime=_runtime()
    )


def prove_signage_ready(
    inventory: str,
    host: str,
    run_id: str,
    client_id: str,
    release_sha: str,
    verification_id: str,
) -> None:
    return ansible_backend.prove_signage_ready(
        inventory,
        host,
        run_id,
        client_id,
        release_sha,
        verification_id,
        runtime=_runtime(),
    )


def converge_server_config(
    inventory: str, host: str, revision: str, run_id: str
) -> None:
    return ansible_backend.converge_server_config(
        inventory, host, revision, run_id, runtime=_runtime()
    )


def playbook(
    inventory: str,
    host: str,
    revision: str,
    run_id: str,
    *,
    rollback: bool = False,
) -> None:
    return ansible_backend.playbook(
        inventory, host, revision, run_id, rollback=rollback, runtime=_runtime()
    )


def rollback_terminal(
    inventory: str,
    target_spec: dict[str, str],
    target: dict[str, Any],
    run_id: str,
) -> bool:
    return ansible_backend.rollback_terminal(
        inventory, target_spec, target, run_id, runtime=_runtime()
    )


def phase3_release(sha: str, state: ReleaseState) -> None:
    return pi5_backend.phase3_release(sha, state, runtime=_runtime())


def wait_for_pi5_stability(state: ReleaseState) -> None:
    return pi5_backend.wait_for_pi5_stability(state, runtime=_runtime())


def cleanup_after_pi5_stability() -> None:
    return pi5_backend.cleanup_after_pi5_stability(runtime=_runtime())


def read_pi5_release_current() -> dict[str, Any] | None:
    # Fleet evidence is authoritative. The legacy marker remains an explicit
    # compatibility fallback until PR 8 removes it after production acceptance.
    fleet_state = read_fleet_release_state()
    fleet = fleet_state.get("fleet") or {}
    servers = [
        record
        for record in fleet.values()
        if isinstance(record, dict) and record.get("role") == "server"
    ]
    if len(servers) > 1:
        # Inventory planning names the current server authority. This legacy
        # compatibility read has no inventory argument, so competing/stale
        # records cannot safely prove an idempotent skip. Return no marker and
        # let the normal live Pi5 execution/verification path repair evidence.
        return None
    if servers and servers[0].get("evidence") == "verified":
        record = servers[0]
        return {
            "sha": record.get("currentSha"),
            "candidate": {
                "api": record.get("apiImage"),
                "web": record.get("webImage"),
            },
            "completedAt": record.get("verifiedAt"),
            "compatibility": {"source": "fleet-release-state"},
        }
    # The marker may seed the migration only before fleet state exists. Once
    # any durable fleet transition or host record exists, absence of verified
    # server evidence is authoritative and must not be overwritten by it.
    if not (
        fleet_state.get("generation") == 0
        and fleet_state.get("activeRun") is None
        and fleet_state.get("lastRun") is None
        and not fleet
    ):
        return None
    marker = pi5_backend.read_pi5_release_current(runtime=_runtime())
    if isinstance(marker, dict):
        marker = dict(marker)
        marker["compatibility"] = {"source": "pi5-release-current"}
    return marker


def read_plan_pi5_release_current() -> tuple[dict[str, Any] | None, list[str]]:
    return pi5_backend.read_plan_pi5_release_current(runtime=_runtime())


def record_pi5_release_current(sha: str, candidate: dict[str, Any] | None) -> None:
    return pi5_backend.record_pi5_release_current(sha, candidate, runtime=_runtime())


def candidate_image_matches_sha(image: Any, sha: str) -> bool:
    return pi5_backend.candidate_image_matches_sha(image, sha, runtime=_runtime())


def marker_candidate_for_sha(
    marker: dict[str, Any], sha: str
) -> dict[str, str] | None:
    return pi5_backend.marker_candidate_for_sha(marker, sha, runtime=_runtime())


def phase3_matches_marker_candidate(
    phase3: Any, candidate: dict[str, str]
) -> bool:
    return pi5_backend.phase3_matches_marker_candidate(phase3, candidate)


def pi5_already_current(sha: str) -> bool:
    return pi5_backend.pi5_already_current(sha, runtime=_runtime())


def phase3_status(
    *,
    structural_only: bool = False,
    recovery_run_id: str | None = None,
) -> dict[str, Any]:
    return pi5_backend.phase3_status(
        runtime=_runtime(),
        structural_only=structural_only,
        recovery_run_id=recovery_run_id,
    )


def normalized_pi5_phase3_state(phase3: dict[str, Any]) -> bool:
    return pi5_backend.normalized_pi5_phase3_state(phase3)


def recover_expired_pi5_handoff(state: ReleaseState) -> bool:
    return pi5_backend.recover_expired_pi5_handoff(state, runtime=_runtime())


def ensure_pi5_release(sha: str, state: ReleaseState) -> None:
    return pi5_backend.ensure_pi5_release(sha, state, runtime=_runtime())


def resolve_release_sha(branch: str) -> tuple[str | None, list[str]]:
    try:
        output = run(
            ["git", "-C", str(PROJECT), "ls-remote", "origin", branch], capture=True
        ).strip()
        sha = output.split()[0] if output else ""
        if sha:
            return sha, []
    except Exception:
        pass
    try:
        sha = run(
            ["git", "-C", str(PROJECT), "rev-parse", f"origin/{branch}"], capture=True
        ).strip()
        if sha:
            return sha, [f"used local origin/{branch} ref; remote unreachable"]
        return None, [f"could not resolve SHA for branch {branch}"]
    except Exception as error:
        return None, [f"could not resolve SHA for branch {branch}: {error}"]


def classify_release_impact(
    sha: str, release_marker: dict[str, Any] | None
) -> tuple[dict[str, Any] | None, list[str]]:
    base = (release_marker or {}).get("sha")
    if not isinstance(base, str) or not FULL_SHA_RE.fullmatch(base):
        return None, [
            "classification unavailable: last-successful Pi5 release SHA is missing or invalid"
        ]
    if base == sha:
        return {
            "server": False,
            "kiosk": False,
            "signage": False,
            "migration": False,
            "paths": [],
            "components": ["neutral"],
        }, []
    try:
        run(
            ["git", "-C", str(PROJECT), "merge-base", "--is-ancestor", base, sha],
            capture=True,
        )
        result = json.loads(
            run(
                [
                    "python3",
                    str(PROJECT / "scripts/deploy/classify-deploy-impact.py"),
                    "--base",
                    base,
                    "--head",
                    sha,
                ],
                capture=True,
            )
        )
        return result, []
    except Exception as error:
        return None, [
            "classification unavailable: last-successful Pi5 release SHA is not an ancestor "
            f"of target: {error}"
        ]


def pi5_release_required(sha: str) -> bool:
    classification, _ = classify_release_impact(sha, read_pi5_release_current())
    return release_policy.requires_pi5_release(classification)


def resolve_terminal_targets(
    inventory: str, limit: str
) -> tuple[list[dict[str, str]] | None, list[str]]:
    try:
        return release_targets(
            inventory_json(inventory), selected_hosts(inventory, limit)
        ), []
    except Exception:
        return None, ["ansible-inventory unavailable"]


def classify_fleet_baselines(
    sha: str, fleet_state: dict[str, Any]
) -> tuple[dict[str, dict[str, Any] | None], list[str]]:
    classifications: dict[str, dict[str, Any] | None] = {}
    warnings: list[str] = []
    fleet = fleet_state.get("fleet") if isinstance(fleet_state, dict) else {}
    if not isinstance(fleet, dict):
        return classifications, ["fleet evidence is malformed"]
    for host, record in fleet.items():
        if not isinstance(record, dict) or record.get("evidence") != "verified":
            continue
        current = record.get("currentSha")
        if not isinstance(current, str) or not FULL_SHA_RE.fullmatch(current):
            continue
        if current in classifications:
            continue
        classification, current_warnings = classify_release_impact(sha, {"sha": current})
        classifications[current] = classification
        warnings.extend(f"{host}: {warning}" for warning in current_warnings)
    return classifications, warnings


def build_fleet_scope(
    *,
    sha: str,
    inventory_data: dict[str, Any],
    fleet_state: dict[str, Any],
    selected: list[str] | None,
    limit: str,
    full_fleet: bool,
    auto_minimize_alias: bool,
) -> tuple[dict[str, Any], list[dict[str, str]], dict[str, dict[str, Any] | None], list[str]]:
    all_hosts = release_hosts(inventory_data)
    classifications, warnings = classify_fleet_baselines(sha, fleet_state)
    decisions = plan_target_decisions(
        all_hosts,
        fleet_state.get("fleet") or {},
        sha,
        classifications,
        inventory_data,
        full_fleet=full_fleet,
    )

    if selected is not None:
        if not selected:
            raise RuntimeError(f"--limit selected no hosts: {limit}")
        # Validate that the Ansible limit cannot smuggle a non-release host
        # into the deployment candidate universe.
        release_hosts(inventory_data, selected)
        selected_set = set(selected)
        server = next(decision for decision in decisions if decision["role"] == "server")
        if server["targeted"] and server["host"] not in selected_set:
            raise RuntimeError(
                f"--limit excludes required Pi5 server host {server['host']}: {limit}"
            )
        unknown_outside = [
            decision["host"]
            for decision in decisions
            if decision["targeted"]
            and decision["evidence"] != "verified"
            and decision["host"] not in selected_set
        ]
        if unknown_outside:
            raise RuntimeError(
                "--limit excludes required unknown-evidence hosts: "
                + ", ".join(unknown_outside)
            )
        for decision in decisions:
            if decision["host"] not in selected_set:
                decision["targeted"] = False
                decision["targetReason"] = "outside explicit --limit"

    plan = release_planner.build_fleet_plan_payload(
        release_sha=sha,
        decisions=decisions,
        full_fleet=full_fleet,
        limit=limit,
        canary_hold_policy=should_hold_after_canary,
    )
    target_by_host = {target["host"]: target for target in all_hosts}
    terminal_targets = [
        target_by_host[decision["host"]]
        for decision in decisions
        if decision["targeted"] and decision["role"] in {"kiosk", "signage"}
    ]
    plan["terminalTargets"] = terminal_targets
    plan["autoMinimize"] = auto_minimize_alias
    components = {
        component
        for classification in classifications.values()
        if isinstance(classification, dict)
        for component in classification.get("components") or []
        if isinstance(component, str)
    }
    plan["classificationComponents"] = sorted(components) if components else None
    return plan, terminal_targets, classifications, warnings


def build_print_plan(
    branch: str,
    inventory: str,
    limit: str,
    *,
    auto_minimize: bool = False,
    full_fleet: bool = False,
) -> dict[str, Any]:
    warnings: list[str] = []
    sha, current_warnings = resolve_release_sha(branch)
    warnings.extend(current_warnings)
    if not isinstance(sha, str) or not FULL_SHA_RE.fullmatch(sha):
        detail = "; ".join(current_warnings) or f"could not resolve SHA for branch {branch}"
        raise RuntimeError(detail)
    validate_print_plan_checkout(sha)
    local_inventory = canonical_print_plan_inventory(inventory)
    inventory_data = inventory_json(local_inventory)
    selected = selected_hosts(local_inventory, limit)
    server_identity = validate_print_plan_server_identity(inventory_data)
    fleet_state, fleet_warnings = read_plan_fleet_release_state()
    warnings.extend(fleet_warnings)
    active_run = fleet_state.get("activeRun")
    if isinstance(active_run, dict):
        active_id = active_run.get("runId")
        warnings.append(
            "fleet state has an active run"
            + (f" {active_id}" if isinstance(active_id, str) else "")
            + "; treating every inventory host as unknown"
        )
        # A live run can still change every record, while a stale run must be
        # reconciled by the next lock-owning execution.  A read-only plan stays
        # useful and safe by widening to the complete unknown fleet.  The
        # kernel fleet lock prevents a concurrent launch from reaching Git.
        fleet_state = empty_fleet_state()
    scope, _terminal_targets, classifications, scope_warnings = build_fleet_scope(
        sha=sha,
        inventory_data=inventory_data,
        fleet_state=fleet_state,
        selected=selected,
        limit=limit,
        full_fleet=full_fleet,
        auto_minimize_alias=auto_minimize,
    )
    warnings.extend(scope_warnings)
    server_record = next(
        (
            record
            for record in (fleet_state.get("fleet") or {}).values()
            if isinstance(record, dict) and record.get("role") == "server"
        ),
        None,
    )
    server_sha = server_record.get("currentSha") if isinstance(server_record, dict) else None
    classification = classifications.get(server_sha) if isinstance(server_sha, str) else None
    payload = release_planner.build_print_plan_payload(
        branch=branch,
        inventory=inventory,
        limit=limit,
        sha=sha,
        classification=classification,
        pi5_required=scope.get("pi5Required"),
        terminal_scope=scope,
        warnings=warnings,
    )
    payload["serverIdentity"] = server_identity
    return payload


def _remote_run(args: argparse.Namespace) -> int:
    global _ACTIVE_CANCELLATION_TOKEN
    token = CancellationToken(
        args.run_id, RUN_DIRECTORY / f"{args.run_id}.control.json"
    )
    previous = _ACTIVE_CANCELLATION_TOKEN
    _ACTIVE_CANCELLATION_TOKEN = token
    try:
        with token:
            return release_coordinator.execute(args, runtime=_runtime(), token=token)
    finally:
        _ACTIVE_CANCELLATION_TOKEN = previous


def remote_run(args: argparse.Namespace) -> int:
    global _ACTIVE_FLEET_LEASE
    fleet_lease = validate_inherited_fleet_lock(PROJECT)
    descriptor: int | None = None
    previous_fleet_lease = _ACTIVE_FLEET_LEASE
    _ACTIVE_FLEET_LEASE = fleet_lease
    try:
        descriptor = validate_inherited_release_lock(PROJECT)
        if os.environ.get("ROLLING_RELEASE_PROTOCOL") != "2":
            raise RuntimeError("rolling-release protocol identity is missing")
        expected_unit = unit_name_for(args.run_id)
        if os.environ.get("ROLLING_RELEASE_UNIT") != expected_unit:
            raise RuntimeError("release unit identity does not match run ID")
        invocation_id = os.environ.get("INVOCATION_ID", "")
        if not re.fullmatch(r"[0-9a-fA-F]{32}", invocation_id):
            raise RuntimeError("systemd invocation identity is missing or malformed")
        systemd_backend.validate_current_execution_identity(args.run_id, invocation_id)
        token_from_environment(PROJECT, args.run_id)
        return _remote_run(args)
    finally:
        _ACTIVE_FLEET_LEASE = previous_fleet_lease
        if descriptor is not None:
            os.close(descriptor)
        fleet_lease.release()


def local_approve(run_id: str) -> int:
    return release_application.approve(run_id, runtime=_runtime())


def local_cancel(args: argparse.Namespace) -> int:
    return release_application.cancel(args.cancel, args.reason, runtime=_runtime())


def local_run(args: argparse.Namespace) -> int:
    if args.status:
        return release_application.status(args.status, runtime=_runtime())
    if args.approve:
        return local_approve(args.approve)
    if args.cancel:
        return local_cancel(args)
    if args.auto_minimize:
        print(
            "[WARN] --auto-minimize is a compatibility alias; "
            "target minimization is now the default",
            file=sys.stderr,
        )
    if args.print_plan:
        print(
            json.dumps(
                build_print_plan(
                    args.branch,
                    args.inventory,
                    args.limit or "",
                    auto_minimize=args.auto_minimize,
                    full_fleet=args.full_fleet,
                ),
                ensure_ascii=False,
            )
        )
        return 0
    return release_application.launch(args, runtime=_runtime())


def parser() -> argparse.ArgumentParser:
    return release_cli.parser()


def normalize_arguments(args: argparse.Namespace) -> argparse.Namespace:
    return release_cli.normalize_arguments(args)


def main() -> int:
    args, unknown = parser().parse_known_args()
    if unknown:
        raise release_cli.UsageError(
            f'unsupported options in rolling release: {" ".join(unknown)}'
        )
    args = normalize_arguments(args)
    return remote_run(args) if args.remote_run else local_run(args)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except release_cli.UsageError as error:
        print(f"[ERROR] {error}", file=sys.stderr)
        raise SystemExit(2)
    except Exception as error:
        print(f"[ERROR] {error}", file=sys.stderr)
        raise SystemExit(1)
