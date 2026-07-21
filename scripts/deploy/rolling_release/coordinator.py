"""Release ordering and authoritative fleet-state transitions.

The facade is injected as ``runtime`` so command adapters and durable stores
remain independently testable. The fleet record is written before the
per-run state that describes the same transition.
"""
from __future__ import annotations

import re
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from .adapter_registry import adapter_for_profile
from .activation import (
    ActivationUncertainError,
    WEB_CONSUMER_ACTIVATION_STRATEGY,
    WEB_CONSUMER_CAPABILITY_AUTHORITY,
    WEB_CONSUMER_MIGRATION_MODE,
    WEB_CONSUMER_STEADY_STATE_MODE,
)
from .cancellation import CancellationRequested, CancellationToken
from .release_claims import (
    ClaimAuthority,
    ClaimKind,
    ClaimState,
    ReleaseClaim,
    release_claims_for_host,
    validate_release_claims,
)
from .terminal_adapters import TerminalAdapter


FULL_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
RUN_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{2,79}$")


def _require_executable_target_architecture(plan: dict[str, Any]) -> None:
    # Old active runs and compatibility test runtimes do not carry Milestone 2
    # planning fields. They remain on the legacy SSH path; newly composed plans
    # always include the key and are checked strictly below.
    if "activationTargets" not in plan:
        return
    for field in (
        "mutationTargets",
        "activationTargets",
        "verificationTargets",
    ):
        if not isinstance(plan.get(field), list):
            raise RuntimeError(f"planned {field} set is malformed")
    activation_targets = plan["activationTargets"]
    if activation_targets and plan.get("activationExecutionEnabled") is not True:
        hosts = [
            target.get("host")
            for target in activation_targets
            if isinstance(target, dict) and isinstance(target.get("host"), str)
        ]
        raise RuntimeError(
            "release requires disabled activation execution before mutation: "
            + ", ".join(hosts)
        )
    mutation_hosts = {
        target.get("host")
        for target in plan["mutationTargets"]
        if isinstance(target, dict) and isinstance(target.get("host"), str)
    }
    activation_hosts = {
        target.get("host")
        for target in activation_targets
        if isinstance(target, dict) and isinstance(target.get("host"), str)
    }
    verification_only_hosts = [
        target.get("host")
        for target in plan["verificationTargets"]
        if isinstance(target, dict)
        and isinstance(target.get("host"), str)
        and target.get("host") not in mutation_hosts | activation_hosts
    ]
    if (
        verification_only_hosts
        and plan.get("verificationOnlyExecutionEnabled") is not True
    ):
        raise RuntimeError(
            "release requires disabled verification-only execution before mutation: "
            + ", ".join(verification_only_hosts)
        )


@contextmanager
def _measure_phase(state: Any, runtime: Any, name: str, *, host: str | None = None):
    """Append non-authoritative timing data without influencing control flow."""

    started_at = runtime.utc_now()
    started = time.monotonic()
    outcome = "success"
    try:
        yield
    except BaseException as error:
        outcome = type(error).__name__
        raise
    finally:
        try:
            telemetry = state.payload.setdefault("telemetry", {})
            phases = telemetry.setdefault("phases", [])
            event = {
                "name": name,
                "startedAt": started_at,
                "endedAt": runtime.utc_now(),
                "durationMs": round((time.monotonic() - started) * 1000),
                "outcome": outcome,
            }
            if host is not None:
                event["host"] = host
            phases.append(event)
        except Exception:
            # Metrics must never change a release outcome.
            pass


def _collect_ansible_timing(state: Any, runtime: Any, run_id: str) -> None:
    collector = getattr(runtime, "collect_ansible_timing", None)
    if not callable(collector):
        return
    try:
        state.payload.setdefault("telemetry", {})["ansible"] = collector(run_id)
    except Exception as error:
        state.payload.setdefault("telemetry", {})["ansible"] = {
            "state": "unavailable", "error": type(error).__name__,
        }


def _terminal_adapter(runtime: Any, profile_id: str) -> TerminalAdapter:
    resolver = getattr(runtime, "terminal_adapter", None)
    if callable(resolver):
        return resolver(profile_id)
    return adapter_for_profile(profile_id, runtime=runtime)


def _host_needs_seed(record: Any, role: str) -> bool:
    # Seed is a one-time migration of a host that has never had authoritative
    # fleet evidence.  An existing ``unknown`` can mean maintenance residue,
    # timeout, partial configuration, or failed rollback; HEAD/services alone
    # cannot safely promote it.  It must pass through executor cleanup.
    return record is None


def _seed_unverified_hosts(
    hosts: list[dict[str, str]],
    fleet_state: dict[str, Any],
    *,
    inventory: str,
    run_id: str,
    desired_sha: str,
    abandoned_run_id: str | None,
    runtime: Any,
    token: CancellationToken,
) -> tuple[dict[str, Any], list[dict[str, str]]]:
    """Seed only observations confirmed from the live host and services.

    An unreachable or malformed host remains absent/unknown and is therefore
    targeted by policy.  Observation failures are auditable but do not turn
    stale data into verified evidence.
    """

    failures: list[dict[str, str]] = []
    current_state = fleet_state
    for host_spec in hosts:
        host = host_spec["host"]
        role = host_spec["role"]
        record = (current_state.get("fleet") or {}).get(host)
        if (
            abandoned_run_id is not None
            and isinstance(record, dict)
            and record.get("lastRunId") == abandoned_run_id
        ):
            # A crashed run may have changed the host or left maintenance in
            # place. HEAD/services alone cannot prove cleanup, so suppress
            # seed promotion and force this host through the execution path.
            current_state = runtime.fleet_mark_unknown(
                host, role, desired_sha, run_id
            )
            failures.append({
                "host": host,
                "error": "prior run was interrupted; execution reconciliation required",
            })
            continue
        if not _host_needs_seed(record, role):
            continue
        token.checkpoint(f"before-evidence-seed:{host}")
        adapter = None if role == "server" else _terminal_adapter(runtime, role)
        try:
            observation = (
                runtime.observe_pi5_evidence(None)
                if role == "server"
                else adapter.observe(inventory, host, host_spec["clientId"])
            )
        except Exception as error:
            failures.append({"host": host, "error": str(error)})
            current_state = runtime.fleet_mark_unknown(
                host, role, desired_sha, run_id
            )
        else:
            current_sha = observation.get("currentSha")
            observation["releaseClaims"] = _direct_release_claims(
                role=role,
                expected_sha=current_sha,
                observed_sha=current_sha,
                run_id=run_id,
                observed_at=runtime.utc_now(),
            )
            required_claims = (
                {ClaimKind.CONTROL_PLANE_API, ClaimKind.CONTROL_PLANE_WEB}
                if role == "server"
                else {
                    ClaimKind(value)
                    for value in adapter.profile.adapter_options.required_claims
                }
            )
            if set(observation["releaseClaims"]) == {
                kind.value for kind in required_claims
            }:
                observation["releaseClaims"] = _require_verified_release_claims(
                    observation["releaseClaims"], required_claims
                )
                current_state = runtime.fleet_mark_verified(
                    host,
                    role,
                    current_sha,
                    current_sha,
                    run_id,
                    previous_sha=None,
                    observation=observation,
                )
            else:
                current_state = runtime.fleet_mark_unknown(
                    host,
                    role,
                    current_sha,
                    run_id,
                    release_claims=observation["releaseClaims"],
                )
        token.checkpoint(f"after-evidence-seed:{host}")
    return current_state, failures


def _set_host_status(
    state: Any,
    host: str,
    *,
    current_sha: str | None,
    evidence: str,
) -> None:
    for record in state.payload.get("hosts") or []:
        if record.get("host") == host:
            record["currentSha"] = current_sha
            record["evidence"] = evidence
            return
    raise KeyError(host)


def _set_host_release_claims(
    state: Any, host: str, claims: dict[str, dict[str, Any]]
) -> None:
    validated = validate_release_claims(claims)
    for record in state.payload.get("hosts") or []:
        if record.get("host") == host:
            record["releaseClaims"] = validated
            return
    raise KeyError(host)


def _claim_record(
    *,
    kind: ClaimKind,
    expected: str,
    observed: str | None,
    authority: ClaimAuthority,
    verification_id: str | None,
    observed_at: str | None,
    run_id: str,
) -> dict[str, Any]:
    return ReleaseClaim(
        kind=kind,
        expected_identity=expected,
        observed_identity=observed,
        authority=authority,
        verification_id=verification_id,
        state=(
            ClaimState.VERIFIED
            if observed is not None and observed == expected
            else ClaimState.UNKNOWN
        ),
        observed_at=observed_at,
        last_run_id=run_id,
    ).to_record()


def _require_verified_release_claims(
    claims: dict[str, dict[str, Any]], required: set[ClaimKind]
) -> dict[str, dict[str, Any]]:
    validated = validate_release_claims(claims)
    if set(validated) != {kind.value for kind in required} or any(
        claim.get("state") != ClaimState.VERIFIED.value
        or claim.get("observedIdentity") != claim.get("expectedIdentity")
        for claim in validated.values()
    ):
        raise RuntimeError("required release claim set is not fully verified")
    return validated


def _direct_release_claims(
    *, role: str, expected_sha: str, observed_sha: str, run_id: str, observed_at: str
) -> dict[str, dict[str, Any]]:
    kinds = (
        (
            (ClaimKind.CONTROL_PLANE_API, ClaimAuthority.PI5_API_IMAGE),
            (ClaimKind.CONTROL_PLANE_WEB, ClaimAuthority.PI5_WEB_IMAGE),
        )
        if role == "server"
        else (
            (
                ClaimKind.TERMINAL_REPOSITORY,
                ClaimAuthority.TERMINAL_REPOSITORY_PROBE,
            ),
        )
    )
    return {
        kind.value: _claim_record(
            kind=kind,
            expected=expected_sha,
            observed=observed_sha,
            authority=authority,
            verification_id=None,
            observed_at=observed_at,
            run_id=run_id,
        )
        for kind, authority in kinds
    }


def _pending_server_release_claims(
    *, desired_sha: str, prior_record: dict[str, Any] | None, run_id: str
) -> dict[str, dict[str, Any]]:
    prior = (
        release_claims_for_host(prior_record)
        if isinstance(prior_record, dict)
        else {}
    )
    result: dict[str, dict[str, Any]] = {}
    for kind, authority in (
        (ClaimKind.CONTROL_PLANE_API, ClaimAuthority.PI5_API_IMAGE),
        (ClaimKind.CONTROL_PLANE_WEB, ClaimAuthority.PI5_WEB_IMAGE),
    ):
        previous = prior.get(kind.value)
        if (
            isinstance(previous, dict)
            and previous.get("state") == ClaimState.VERIFIED.value
            and previous.get("expectedIdentity") == desired_sha
            and previous.get("observedIdentity") == desired_sha
        ):
            result[kind.value] = dict(previous)
        else:
            result[kind.value] = _claim_record(
                kind=kind,
                expected=desired_sha,
                observed=None,
                authority=authority,
                verification_id=None,
                observed_at=None,
                run_id=run_id,
            )
    return validate_release_claims(result)


def _claim_requirements(
    target: dict[str, Any], adapter: TerminalAdapter
) -> list[dict[str, str]] | None:
    raw = target.get("claimRequirements")
    if raw is None or raw == []:
        return None
    if not isinstance(raw, list):
        raise RuntimeError("terminal claim requirements are malformed")
    requirements: list[dict[str, str]] = []
    seen: set[ClaimKind] = set()
    for value in raw:
        if not isinstance(value, dict) or set(value) != {
            "kind",
            "expectedIdentity",
            "status",
        }:
            raise RuntimeError("terminal claim requirement is malformed")
        try:
            kind = ClaimKind(value["kind"])
        except (TypeError, ValueError) as error:
            raise RuntimeError("terminal claim kind is unsupported") from error
        expected = value["expectedIdentity"]
        if (
            kind in seen
            or not isinstance(expected, str)
            or FULL_SHA_RE.fullmatch(expected) is None
            or value["status"] not in {"current", "missing", "stale-or-unverified"}
        ):
            raise RuntimeError("terminal claim requirement identity is malformed")
        seen.add(kind)
        requirements.append({"kind": kind.value, "expectedIdentity": expected})
    required_kinds = {
        ClaimKind(value)
        for value in adapter.profile.adapter_options.required_claims
    }
    if seen != required_kinds:
        raise RuntimeError(
            "terminal claim requirements do not match the profile contract"
        )
    return requirements


def _pending_terminal_release_claims(
    adapter: TerminalAdapter,
    target: dict[str, Any],
    prior_record: dict[str, Any] | None,
    run_id: str,
) -> dict[str, dict[str, Any]] | None:
    requirements = _claim_requirements(target, adapter)
    if requirements is None:
        return None
    prior = (
        release_claims_for_host(prior_record)
        if isinstance(prior_record, dict)
        else {}
    )
    result: dict[str, dict[str, Any]] = {}
    for requirement in requirements:
        kind = ClaimKind(requirement["kind"])
        expected = requirement["expectedIdentity"]
        previous = prior.get(kind.value)
        if (
            isinstance(previous, dict)
            and previous.get("state") == ClaimState.VERIFIED.value
            and previous.get("expectedIdentity") == expected
            and previous.get("observedIdentity") == expected
        ):
            result[kind.value] = dict(previous)
            continue
        result[kind.value] = _claim_record(
            kind=kind,
            expected=expected,
            observed=None,
            authority=adapter.release_claim_authority(kind),
            verification_id=None,
            observed_at=None,
            run_id=run_id,
        )
    return validate_release_claims(result)


def _unverified_terminal_release_claims(
    adapter: TerminalAdapter,
    target: dict[str, Any],
    run_id: str,
) -> dict[str, dict[str, Any]] | None:
    """Clear every typed observation before rollback can mutate the host."""

    requirements = _claim_requirements(target, adapter)
    if requirements is None:
        return None
    return validate_release_claims(
        {
            requirement["kind"]: _claim_record(
                kind=ClaimKind(requirement["kind"]),
                expected=requirement["expectedIdentity"],
                observed=None,
                authority=adapter.release_claim_authority(
                    ClaimKind(requirement["kind"])
                ),
                verification_id=None,
                observed_at=None,
                run_id=run_id,
            )
            for requirement in requirements
        }
    )


def _terminal_observed_release_claims(
    *,
    runtime: Any,
    adapter: TerminalAdapter,
    target: dict[str, Any],
    observation: dict[str, Any],
    run_id: str,
    rollback: bool,
) -> dict[str, dict[str, Any]] | None:
    requirements = _claim_requirements(target, adapter)
    if requirements is None:
        return None
    ready_kind = adapter.ready_claim_kind()
    release_key = "rollbackReadyReleaseSha" if rollback else "readyReleaseSha"
    verification_key = (
        "rollbackReadyVerificationId" if rollback else "readyVerificationId"
    )
    timestamp = runtime.utc_now()
    claims: dict[str, dict[str, Any]] = {}
    for requirement in requirements:
        kind = ClaimKind(requirement["kind"])
        expected = requirement["expectedIdentity"]
        if rollback and kind is ClaimKind.TERMINAL_REPOSITORY:
            expected = target.get("previousSha")
            if not isinstance(expected, str) or FULL_SHA_RE.fullmatch(expected) is None:
                raise RuntimeError("rollback repository claim identity is unavailable")
        if kind is ready_kind:
            observed = target.get(release_key)
            verification_id = target.get(verification_key)
        elif kind is ClaimKind.TERMINAL_REPOSITORY:
            observed = observation.get("currentSha")
            verification_id = None
        else:
            raise RuntimeError(f"terminal ready path cannot observe {kind.value}")
        claim = _claim_record(
            kind=kind,
            expected=expected,
            observed=observed,
            authority=adapter.release_claim_authority(kind),
            verification_id=verification_id,
            observed_at=timestamp,
            run_id=run_id,
        )
        if claim["state"] != ClaimState.VERIFIED.value:
            raise RuntimeError(f"required release claim is not verified: {kind.value}")
        claims[kind.value] = claim
    return _require_verified_release_claims(
        claims, {ClaimKind(value["kind"]) for value in requirements}
    )


def _premaintenance_recovery_claims(
    *,
    record: dict[str, Any],
    expected_sha: str,
    run_id: str,
    observed_at: str,
) -> dict[str, dict[str, Any]] | None:
    if "releaseClaims" not in record:
        return None
    claims = validate_release_claims(record["releaseClaims"])
    claims[ClaimKind.TERMINAL_REPOSITORY.value] = _claim_record(
        kind=ClaimKind.TERMINAL_REPOSITORY,
        expected=expected_sha,
        observed=expected_sha,
        authority=ClaimAuthority.TERMINAL_REPOSITORY_PROBE,
        verification_id=None,
        observed_at=observed_at,
        run_id=run_id,
    )
    return validate_release_claims(claims)


def _terminal_run_targets(
    terminal_targets: list[dict[str, str]], plan: dict[str, Any]
) -> list[dict[str, Any]]:
    decisions = {
        decision["host"]: decision
        for decision in plan.get("hosts") or []
        if decision.get("role") != "server"
    }
    planned_work = {
        work["host"]: work
        for work in plan.get("terminalWork") or []
        if isinstance(work, dict) and isinstance(work.get("host"), str)
    }
    result: list[dict[str, Any]] = []
    for target in terminal_targets:
        decision = decisions[target["host"]]
        work = planned_work.get(target["host"])
        action_fields = (
            {
                "mutationRequired": work.get("mutationRequired") is True,
                "activationRequired": work.get("activationRequired") is True,
                "verificationRequired": work.get("verificationRequired") is True,
                "activationStrategyId": work.get("activationStrategyId"),
                "activationMode": work.get("activationMode"),
                "claimRequirements": [
                    dict(requirement)
                    for requirement in work.get("claimRequirements") or []
                ],
            }
            if isinstance(work, dict)
            else {
                "mutationRequired": True,
                "activationRequired": False,
                "verificationRequired": True,
                "activationStrategyId": None,
                "activationMode": None,
                "claimRequirements": [],
            }
        )
        result.append(
            {
                **target,
                "role": decision["role"],
                "desiredSha": decision["desiredSha"],
                "currentSha": decision["currentSha"],
                "evidence": decision["evidence"],
                "targetReason": decision["targetReason"],
                **action_fields,
                "state": "pending",
            }
        )
    return result


def _durable_completed_terminal_sha(
    record: dict[str, Any], *, host: str
) -> str | None:
    """Return a fully committed terminal SHA without probing the host again.

    PR 6 success records already contain the verified runtime commit and its
    completed cleanup.  An interrupted-recovery run cannot have changed that
    terminal merely by conservatively marking fleet records unknown.  Reusing
    this proof avoids turning an unrelated later recovery failure into another
    live dependency on every terminal that was already committed.

    Older success records do not have both proof objects.  They deliberately
    return ``None`` and retain the existing live-verification compatibility
    path.
    """

    if record.get("state") != "success":
        return None
    finalization = record.get("runtimeFinalization")
    cleanup = record.get("runtimeCleanup")
    if finalization is None and cleanup is None:
        return None
    current_sha = record.get("currentSha")
    previous_sha = record.get("previousSha")
    manifest = record.get("rollbackManifest")
    runtime_manifest = (
        manifest.get("runtime") if isinstance(manifest, dict) else None
    )
    already_clean = (
        cleanup.get("alreadyClean") if isinstance(cleanup, dict) else None
    )
    tag_count = cleanup.get("tagCount") if isinstance(cleanup, dict) else None
    docker_count = (
        runtime_manifest.get("dockerCount")
        if isinstance(runtime_manifest, dict)
        else None
    )
    if (
        not isinstance(finalization, dict)
        or set(finalization) != {"outcome", "verifiedSha"}
        or finalization.get("outcome") != "committed"
        or not isinstance(cleanup, dict)
        or set(cleanup)
        != {
            "cleaned",
            "alreadyClean",
            "manifestSha256",
            "tagCount",
            "outcome",
        }
        or cleanup.get("cleaned") is not True
        or type(already_clean) is not bool
        or cleanup.get("outcome") != "committed"
        or not isinstance(runtime_manifest, dict)
        or cleanup.get("manifestSha256") != runtime_manifest.get("manifestSha256")
        or SHA256_RE.fullmatch(str(cleanup.get("manifestSha256") or "")) is None
        or isinstance(tag_count, bool)
        or not isinstance(tag_count, int)
        or tag_count < 0
        or isinstance(docker_count, bool)
        or not isinstance(docker_count, int)
        or tag_count > docker_count
        or (already_clean and tag_count != 0)
        or record.get("evidence") != "verified"
        or not record.get("maintenanceStartedAt")
        or not record.get("maintenanceClearedAt")
        or not isinstance(current_sha, str)
        or FULL_SHA_RE.fullmatch(current_sha) is None
        or not isinstance(previous_sha, str)
        or FULL_SHA_RE.fullmatch(previous_sha) is None
        or record.get("newSha") != current_sha
        or record.get("desiredSha") != current_sha
        or finalization.get("verifiedSha") != current_sha
    ):
        raise RuntimeError(
            f"interrupted completed terminal proof is malformed: {host}"
        )
    return current_sha


def _terminal_ready_sha(
    state: Any,
    adapter: TerminalAdapter,
    target: dict[str, Any],
) -> str:
    return adapter.expected_ready_sha(state, target)


def _rollback_ready_sha(
    state: Any,
    adapter: TerminalAdapter,
    target: dict[str, Any],
) -> str:
    return adapter.expected_rollback_ready_sha(state, target)


def _interrupted_rollback_ready_sha(
    fleet_state: dict[str, Any],
    adapter: TerminalAdapter | dict[str, str],
    previous_sha: str,
) -> str:
    """Return the artifact identity rendered after an interrupted rollback."""

    if isinstance(adapter, dict):
        adapter = adapter_for_profile(adapter["terminalType"], runtime=None)
    return adapter.interrupted_rollback_ready_sha(fleet_state, previous_sha)


def _verify_terminal_ready(
    *,
    runtime: Any,
    state: Any,
    inventory: str,
    run_id: str,
    target_spec: dict[str, str],
    adapter: TerminalAdapter,
    target: dict[str, Any],
    expected_sha: str,
    rollback: bool,
) -> None:
    target["state"] = "rollback-verifying" if rollback else "verifying"
    expected_key = "expectedRollbackReadySha" if rollback else "expectedReadySha"
    target[expected_key] = expected_sha
    state.payload["phase"] = "rolling-back" if rollback else "verifying"
    state.save()
    command = [
        "set-phase",
        "--run-id",
        run_id,
        "--client",
        target_spec["clientId"],
        "--phase",
        "verifying",
        "--desired-release-sha",
        expected_sha,
    ]
    if rollback:
        command.append("--rollback")
    runtime.state_command(*command)
    verification_id = runtime.active_verification_id(
        run_id,
        target_spec["clientId"],
        release_sha=expected_sha,
        rollback=rollback,
    )
    expected_verification_key = (
        "expectedRollbackReadyVerificationId"
        if rollback
        else "expectedReadyVerificationId"
    )
    target[expected_verification_key] = verification_id
    state.save()
    adapter.prove_ready(
        inventory,
        target_spec,
        run_id,
        expected_sha,
        verification_id,
    )
    wait_options = {
        "phase": "ready",
        "release_sha": expected_sha,
        "verification_id": verification_id,
        **({"cancellable": False} if rollback else {}),
    }
    if not runtime.wait_for_ack(
        run_id,
        target_spec["clientId"],
        runtime.READY_ACK_TIMEOUT_SECONDS,
        **wait_options,
    ):
        qualifier = "rollback " if rollback else ""
        raise RuntimeError(
            f"{qualifier}ready acknowledgement timed out for {target_spec['host']}"
        )
    ready_record = runtime.acknowledgement_record(
        run_id, target_spec["clientId"]
    )
    ready = ready_record.get("ready") if isinstance(ready_record, dict) else None
    if (
        not isinstance(ready, dict)
        or ready.get("releaseSha") != expected_sha
        or ready.get("verificationId") != verification_id
        or not isinstance(ready.get("acknowledgedAt"), str)
    ):
        qualifier = "rollback " if rollback else ""
        raise RuntimeError(
            f"{qualifier}ready acknowledgement disappeared for {target_spec['host']}"
        )
    release_key = "rollbackReadyReleaseSha" if rollback else "readyReleaseSha"
    verification_key = (
        "rollbackReadyVerificationId" if rollback else "readyVerificationId"
    )
    acknowledged_key = (
        "rollbackReadyAcknowledgedAt" if rollback else "readyAcknowledgedAt"
    )
    target[release_key] = ready["releaseSha"]
    target[verification_key] = ready["verificationId"]
    target[acknowledged_key] = ready["acknowledgedAt"]
    state.save()


def _activation_capability_proof(
    runtime: Any,
    target: dict[str, Any],
    run_id: str,
    *,
    rollback: bool,
) -> dict[str, str] | None:
    if target.get("activationRequired") is not True:
        return None
    release_key = "rollbackReadyReleaseSha" if rollback else "readyReleaseSha"
    verification_key = (
        "rollbackReadyVerificationId" if rollback else "readyVerificationId"
    )
    release_sha = target.get(release_key)
    verification_id = target.get(verification_key)
    if (
        not isinstance(release_sha, str)
        or FULL_SHA_RE.fullmatch(release_sha) is None
        or not isinstance(verification_id, str)
        or re.fullmatch(r"[0-9a-f]{32}", verification_id) is None
    ):
        raise RuntimeError("activation capability ACK identity is malformed")
    return {
        "strategyId": WEB_CONSUMER_ACTIVATION_STRATEGY,
        "releaseSha": release_sha,
        "verificationId": verification_id,
        "proofAuthority": WEB_CONSUMER_CAPABILITY_AUTHORITY,
        "verifiedAt": runtime.utc_now(),
        "lastRunId": run_id,
    }


def _finalize_terminal_display(
    *,
    runtime: Any,
    state: Any,
    inventory: str,
    run_id: str,
    target_spec: dict[str, str],
    adapter: TerminalAdapter,
    target: dict[str, Any],
    observation: dict[str, Any],
) -> None:
    adapter.finalize_after_maintenance(
        state,
        inventory,
        target_spec,
        target,
        run_id,
        observation,
    )


def _validated_interrupted_rollback_preflight(
    *,
    adapter: TerminalAdapter,
    inventory: str,
    target_spec: dict[str, str],
    record: dict[str, Any],
    authority_run_id: str,
) -> dict[str, Any]:
    preflight = adapter.preflight_rollback(
        inventory, target_spec, record, authority_run_id
    )
    if (
        not isinstance(preflight, dict)
        or type(preflight.get("ready")) is not bool
        or not isinstance(preflight.get("runtimeHealth"), dict)
        or not isinstance(preflight.get("issues"), list)
        or any(
            not isinstance(issue, str) or not issue
            for issue in preflight.get("issues", [])
        )
        or preflight["ready"] != (not preflight["issues"])
    ):
        raise RuntimeError("rollback preflight result is malformed")
    return preflight


def _recover_interrupted_terminals(
    *,
    runtime: Any,
    state: Any,
    inventory: str,
    run_id: str,
    desired_sha: str,
    abandoned_run_id: str | None,
    all_hosts: list[dict[str, str]],
    fleet_state: dict[str, Any],
) -> dict[str, Any]:
    """Reconcile an orphaned run before a partial host becomes a baseline.

    The prior run record is the only controller-side authority that binds a
    terminal to its sealed remote manifest.  Completed terminals are observed
    in place; terminals that crossed the durable maintenance boundary are
    restored from that exact manifest.  Recovery is deliberately
    non-cancellable and finishes before ordinary planning.
    """

    if abandoned_run_id is None:
        return fleet_state
    terminal_specs = {
        host["host"]: host
        for host in all_hosts
        if host.get("role") != "server"
    }
    recovery_run_id = abandoned_run_id
    seen_run_ids: set[str] = set()
    while True:
        if recovery_run_id in seen_run_ids or len(seen_run_ids) >= 16:
            raise RuntimeError("interrupted terminal recovery chain is cyclic")
        seen_run_ids.add(recovery_run_id)
        affected = [
            (host, record)
            for host, record in (fleet_state.get("fleet") or {}).items()
            if host in terminal_specs
            and isinstance(record, dict)
            and record.get("lastRunId") == recovery_run_id
        ]
        if affected:
            break
        linked_run = runtime.read_release_run(recovery_run_id)
        linked_id = (
            linked_run.get("abandonedFleetRunId")
            if isinstance(linked_run, dict)
            else None
        )
        if linked_id is None:
            return fleet_state
        if not isinstance(linked_id, str) or RUN_ID_RE.fullmatch(linked_id) is None:
            raise RuntimeError("interrupted terminal recovery chain is malformed")
        recovery_run_id = linked_id

    prior = runtime.read_release_run(recovery_run_id)
    if not isinstance(prior, dict):
        raise RuntimeError(
            "interrupted terminal run record is unavailable; refusing to "
            "capture a partial host as the new rollback baseline"
        )
    prior_targets = prior.get("targets")
    if not isinstance(prior_targets, list):
        raise RuntimeError("interrupted terminal run has malformed target state")
    indexed: dict[str, dict[str, Any]] = {}
    for candidate in prior_targets:
        if not isinstance(candidate, dict) or not isinstance(candidate.get("host"), str):
            raise RuntimeError("interrupted terminal run has malformed target state")
        host = candidate["host"]
        if host in indexed:
            raise RuntimeError("interrupted terminal run contains duplicate targets")
        indexed[host] = candidate

    recovery_records: list[dict[str, Any]] = []
    work_items: list[
        tuple[str, dict[str, Any], dict[str, str], dict[str, Any], str]
    ] = []
    for host, fleet_record in affected:
        target_spec = terminal_specs[host]
        prior_target = indexed.get(host)
        if not isinstance(prior_target, dict):
            raise RuntimeError(
                f"interrupted terminal target state is missing for {host}"
            )
        if (
            prior_target.get("role") != target_spec.get("role")
            or prior_target.get("terminalType") != target_spec.get("terminalType")
            or prior_target.get("clientId") != target_spec.get("clientId")
        ):
            raise RuntimeError(
                f"interrupted terminal identity no longer matches inventory: {host}"
            )
        authority_run_id = prior_target.get(
            "rollbackAuthorityRunId", recovery_run_id
        )
        if (
            not isinstance(authority_run_id, str)
            or RUN_ID_RE.fullmatch(authority_run_id) is None
        ):
            raise RuntimeError(
                f"interrupted terminal rollback authority is malformed: {host}"
            )
        record = dict(prior_target)
        record["rollbackAuthorityRunId"] = authority_run_id
        recovery_records.append(record)
        work_items.append(
            (host, fleet_record, target_spec, record, authority_run_id)
        )

    state.payload["phase"] = "recovering-interrupted-run"
    state.payload["interruptedRecovery"] = {
        "runId": recovery_run_id,
        "targets": recovery_records,
    }
    # Keep the recovery journal in the ordinary target field as well. If this
    # coordinator crashes, the next run can recover this run in turn without
    # losing the original manifest authority.
    state.payload["targets"] = recovery_records
    state.save()

    rollback_ready_shas: dict[str, str] = {}
    preflight_records: list[dict[str, Any]] = []
    preflight_issues: list[str] = []
    for host, _fleet_record, target_spec, record, authority_run_id in work_items:
        adapter = _terminal_adapter(runtime, target_spec["terminalType"])
        maintenance_needs_cleanup = bool(
            record.get("maintenanceStartedAt")
            and not record.get("maintenanceClearedAt")
        )
        # A pre-mutation capture can still own Docker rollback tags and the
        # exact runtime-health baseline even though maintenance never began.
        # Preflight every persisted manifest so recovery and its later live
        # observation consume the same sealed authority. A truly pre-capture
        # crash has no manifest and is recaptured idempotently below.
        if not maintenance_needs_cleanup and "rollbackManifest" not in record:
            continue
        host_issues: list[str] = []
        rollback_ready_sha: str | None = None
        preflight: dict[str, Any] | None = None
        if maintenance_needs_cleanup:
            try:
                previous_sha = record.get("previousSha")
                if (
                    not isinstance(previous_sha, str)
                    or FULL_SHA_RE.fullmatch(previous_sha) is None
                ):
                    raise RuntimeError("sealed previous release SHA is unavailable")
                rollback_ready_sha = _interrupted_rollback_ready_sha(
                    fleet_state, adapter, previous_sha
                )
                rollback_ready_shas[host] = rollback_ready_sha
            except Exception as error:
                host_issues.append(f"rollback ready identity: {error}")
        try:
            preflight = _validated_interrupted_rollback_preflight(
                adapter=adapter,
                inventory=inventory,
                target_spec=target_spec,
                record=record,
                authority_run_id=authority_run_id,
            )
            record["rollbackRuntimeHealth"] = preflight["runtimeHealth"]
            host_issues.extend(preflight["issues"])
        except Exception as error:
            preflight = None
            host_issues.append(f"rollback manifests: {error}")
        preflight_records.append(
            {
                "host": host,
                "ready": not host_issues,
                "rollbackReadySha": rollback_ready_sha,
                "fileManifestReady": (
                    preflight.get("fileManifestReady") if preflight else None
                ),
                "runtimeManifestReady": (
                    preflight.get("runtimeManifestReady") if preflight else None
                ),
                "restoredReceipt": (
                    preflight.get("restoredReceipt") if preflight else None
                ),
                "requiresRuntimeReconciliation": (
                    preflight.get("requiresRuntimeReconciliation")
                    if preflight
                    else None
                ),
                "issues": host_issues,
            }
        )
        preflight_issues.extend(f"{host}: {issue}" for issue in host_issues)
    state.payload["interruptedRecoveryPreflight"] = {
        "state": "failed" if preflight_issues else "success",
        "targets": preflight_records,
        "issues": preflight_issues,
        "completedAt": runtime.utc_now(),
    }
    state.save()
    if preflight_issues:
        raise RuntimeError(
            "interrupted terminal recovery preflight failed: "
            + "; ".join(preflight_issues)
        )

    current_state = fleet_state
    for host, fleet_record, target_spec, record, authority_run_id in work_items:
        adapter = _terminal_adapter(runtime, target_spec["terminalType"])
        prior_target = record

        durable_completed_sha = _durable_completed_terminal_sha(
            prior_target, host=host
        )
        if durable_completed_sha is not None:
            carried_observation: dict[str, Any] = {}
            if "releaseClaims" in prior_target:
                carried_claims = validate_release_claims(
                    prior_target["releaseClaims"]
                )
                requirements = _claim_requirements(prior_target, adapter)
                if requirements is not None:
                    carried_claims = _require_verified_release_claims(
                        carried_claims,
                        {ClaimKind(value["kind"]) for value in requirements},
                    )
                carried_observation["releaseClaims"] = carried_claims
            capability = prior_target.get("activationCapabilityProof")
            if isinstance(capability, dict):
                carried_observation["activationCapabilities"] = {
                    WEB_CONSUMER_ACTIVATION_STRATEGY: dict(capability)
                }
            current_state = runtime.fleet_mark_verified(
                host,
                target_spec["role"],
                durable_completed_sha,
                durable_completed_sha,
                run_id,
                previous_sha=prior_target.get("previousSha"),
                observation=carried_observation,
            )
            record["recovery"] = "durable-success-carried-forward"
            record["recoveryCarriedAt"] = runtime.utc_now()
            state.payload["fleetGeneration"] = current_state["generation"]
            state.save()
            continue

        # Only the host whose recovery is about to execute becomes unknown.
        # A failure on this host must not erase verified evidence for later,
        # untouched terminals in the same abandoned run.
        recovery_claims = (
            validate_release_claims(record["releaseClaims"])
            if "releaseClaims" in record
            else None
        )
        if recovery_claims is None:
            current_state = runtime.fleet_mark_unknown(
                host, target_spec["role"], desired_sha, run_id
            )
        else:
            current_state = runtime.fleet_mark_unknown(
                host,
                target_spec["role"],
                desired_sha,
                run_id,
                release_claims=recovery_claims,
            )
        state.payload["fleetGeneration"] = current_state["generation"]
        state.save()

        maintenance_needs_cleanup = bool(
            prior_target.get("maintenanceStartedAt")
            and not prior_target.get("maintenanceClearedAt")
        )
        if maintenance_needs_cleanup:
            previous_sha = prior_target.get("previousSha")
            manifest = prior_target.get("rollbackManifest")
            if (
                not isinstance(previous_sha, str)
                or FULL_SHA_RE.fullmatch(previous_sha) is None
                or not isinstance(manifest, dict)
            ):
                raise RuntimeError(
                    f"interrupted terminal has no sealed rollback authority: {host}"
                )
            record["state"] = "rolling-back"
            state.save()
            # The old coordinator may have crashed after persisting the
            # maintenance boundary but before `put`, or after `remove-client`
            # but before persisting maintenanceClearedAt. Reasserting the exact
            # entry is idempotent and gives rollback verification a durable
            # status target in both ambiguous windows.
            runtime.state_command(
                "put",
                "--run-id",
                authority_run_id,
                "--clients",
                target_spec["clientId"],
                "--terminal-type",
                target_spec["terminalType"],
                "--phase",
                "failed",
            )
            record["recoveryMaintenanceReassertedAt"] = runtime.utc_now()
            state.save()
            if not adapter.rollback(
                inventory, target_spec, record, authority_run_id
            ):
                raise RuntimeError(
                    f"interrupted terminal manifest restore failed: {host}"
                )
            rollback_ready_sha = rollback_ready_shas[host]
            _verify_terminal_ready(
                runtime=runtime,
                state=state,
                inventory=inventory,
                run_id=authority_run_id,
                target_spec=target_spec,
                adapter=adapter,
                target=record,
                expected_sha=rollback_ready_sha,
                rollback=True,
            )
            rollback_capability = _activation_capability_proof(
                runtime, record, authority_run_id, rollback=True
            )
            if rollback_capability is not None:
                record["rollbackActivationCapabilityProof"] = rollback_capability
                state.save()
            expected_sha = previous_sha
            recovered = "manifest-restored"
            cleanup_outcome = "restored"
        else:
            # No uncleared maintenance boundary means either the terminal was
            # fully committed or no device mutation had begun.  Prove the
            # corresponding durable SHA instead of guessing from HEAD alone.
            if prior_target.get("maintenanceClearedAt"):
                finalization = prior_target.get("runtimeFinalization")
                if isinstance(finalization, dict):
                    if set(finalization) != {"outcome", "verifiedSha"} or finalization.get(
                        "outcome"
                    ) not in {"committed", "restored"}:
                        raise RuntimeError(
                            f"interrupted terminal finalization is malformed: {host}"
                        )
                    expected_sha = finalization.get("verifiedSha")
                    cleanup_outcome = finalization["outcome"]
                else:
                    raise RuntimeError(
                        f"interrupted terminal finalization is missing: {host}"
                    )
                recovered = (
                    "restored-finalization-live-verified"
                    if cleanup_outcome == "restored"
                    else "completed-live-verified"
                )
            else:
                expected_sha = prior_target.get("previousSha") or fleet_record.get(
                    "previousSha"
                )
                recovered = "pre-mutation-live-verified"
                cleanup_outcome = "committed"
                if (
                    (not isinstance(expected_sha, str) or FULL_SHA_RE.fullmatch(expected_sha) is None)
                    and not prior_target.get("maintenanceStartedAt")
                    and "rollbackManifest" not in record
                ):
                    # SIGKILL can land immediately before or after the clean
                    # repository baseline command, before its result reaches
                    # durable state. That command is idempotent and performs
                    # only the exact allowlisted legacy-doc repair, so rerun it
                    # under the original rollback authority before capture.
                    repository_baseline = adapter.prepare_repository(
                        inventory, host
                    )
                    expected_sha = repository_baseline.get("head")
                    if (
                        not isinstance(expected_sha, str)
                        or FULL_SHA_RE.fullmatch(expected_sha) is None
                    ):
                        raise RuntimeError(
                            f"interrupted terminal repository baseline is malformed: {host}"
                        )
                    record["previousSha"] = expected_sha
                    record["repositoryBaseline"] = repository_baseline
                    record["recoveryRepositoryBaselineAt"] = runtime.utc_now()
                    state.save()
            if (
                not isinstance(expected_sha, str)
                or FULL_SHA_RE.fullmatch(expected_sha) is None
            ):
                raise RuntimeError(
                    f"interrupted terminal has no provable live SHA: {host}"
                )
            if (
                not prior_target.get("maintenanceStartedAt")
                and "rollbackManifest" not in record
            ):
                # Capture is idempotent for this exact abandoned run. This
                # recovers a lost capture result without accepting a partial
                # or different baseline.
                record["rollbackManifest"] = adapter.capture_manifest(
                    inventory,
                    target_spec,
                    authority_run_id,
                    expected_sha,
                )
                recaptured_preflight = _validated_interrupted_rollback_preflight(
                    adapter=adapter,
                    inventory=inventory,
                    target_spec=target_spec,
                    record=record,
                    authority_run_id=authority_run_id,
                )
                if not recaptured_preflight["ready"]:
                    raise RuntimeError(
                        "interrupted terminal recaptured manifest is not restorable: "
                        + "; ".join(recaptured_preflight["issues"])
                    )
                record["rollbackRuntimeHealth"] = recaptured_preflight[
                    "runtimeHealth"
                ]
                state.save()

            notice = record.get("notice")
            if (
                not prior_target.get("maintenanceStartedAt")
                and isinstance(notice, dict)
                and notice.get("state") != "skipped"
                and not record.get("noticeClearedAt")
            ):
                # deliver_terminal_notice persists `requested` before its
                # idempotent put. A crash on either side is therefore
                # ambiguous. Removing only this proven run/client authority is
                # safe in both cases and prevents a superseded notice from
                # surviving a subsequent no-op plan.
                adapter.clear_maintenance(target_spec, authority_run_id)
                record["noticeClearedAt"] = runtime.utc_now()
                state.save()

        observation = adapter.observe(
            inventory,
            host,
            target_spec["clientId"],
            runtime_health=record.get("rollbackRuntimeHealth"),
        )
        if observation.get("currentSha") != expected_sha:
            raise RuntimeError(
                f"interrupted terminal recovery HEAD does not match: {host}"
            )
        if maintenance_needs_cleanup:
            recovered_claims = _terminal_observed_release_claims(
                runtime=runtime,
                adapter=adapter,
                target=record,
                observation=observation,
                run_id=authority_run_id,
                rollback=True,
            )
        elif "releaseClaims" in record and prior_target.get(
            "maintenanceClearedAt"
        ):
            recovered_claims = validate_release_claims(record["releaseClaims"])
            requirements = _claim_requirements(record, adapter)
            if requirements is not None:
                recovered_claims = _require_verified_release_claims(
                    recovered_claims,
                    {ClaimKind(value["kind"]) for value in requirements},
                )
            repository_claim = recovered_claims.get(
                ClaimKind.TERMINAL_REPOSITORY.value
            )
            if (
                not isinstance(repository_claim, dict)
                or repository_claim.get("state") != ClaimState.VERIFIED.value
                or repository_claim.get("observedIdentity") != expected_sha
            ):
                raise RuntimeError(
                    f"interrupted terminal release claims do not match: {host}"
                )
        else:
            recovered_claims = _premaintenance_recovery_claims(
                record=record,
                expected_sha=expected_sha,
                run_id=run_id,
                observed_at=runtime.utc_now(),
            )
        requirements = _claim_requirements(record, adapter)
        claims_complete = requirements is None
        if recovered_claims is not None:
            record["releaseClaims"] = recovered_claims
            observation["releaseClaims"] = recovered_claims
            if requirements is not None:
                try:
                    _require_verified_release_claims(
                        recovered_claims,
                        {
                            ClaimKind(value["kind"])
                            for value in requirements
                        },
                    )
                    claims_complete = True
                except RuntimeError:
                    claims_complete = False
            state.save()
        rollback_capability = record.get("rollbackActivationCapabilityProof")
        if isinstance(rollback_capability, dict):
            observation["activationCapabilities"] = {
                WEB_CONSUMER_ACTIVATION_STRATEGY: dict(rollback_capability)
            }
        # Persist the proven live outcome before removing maintenance.  A
        # crash after remove-client can then resume finalization without
        # guessing whether the live runtime was committed or restored.
        record["runtimeFinalization"] = {
            "outcome": cleanup_outcome,
            "verifiedSha": expected_sha,
        }
        state.save()
        if maintenance_needs_cleanup:
            activation_cleanup = adapter.cleanup_activation(
                inventory, target_spec, record, authority_run_id
            )
            if activation_cleanup is not None:
                record["activationCleanup"] = activation_cleanup
                state.save()
            adapter.clear_maintenance(target_spec, authority_run_id)
            record["maintenanceClearedAt"] = runtime.utc_now()
            state.save()
        _finalize_terminal_display(
            runtime=runtime,
            state=state,
            inventory=inventory,
            run_id=authority_run_id,
            target_spec=target_spec,
            adapter=adapter,
            target=record,
            observation=observation,
        )
        record["runtimeCleanup"] = adapter.cleanup(
            inventory,
            target_spec,
            record,
            authority_run_id,
            cleanup_outcome,
        )
        state.save()
        if claims_complete:
            current_state = runtime.fleet_mark_verified(
                host,
                target_spec["role"],
                desired_sha,
                expected_sha,
                run_id,
                previous_sha=fleet_record.get("previousSha"),
                observation=observation,
            )
            record["state"] = "recovered"
            record["currentSha"] = expected_sha
            record["evidence"] = "verified"
        else:
            current_state = runtime.fleet_mark_unknown(
                host,
                target_spec["role"],
                desired_sha,
                run_id,
                release_claims=recovered_claims,
            )
            record["state"] = "recovered-claims-incomplete"
            record["recoveryObservedSha"] = expected_sha
            record["currentSha"] = None
            record["evidence"] = "unknown"
        record["recovery"] = recovered
        state.payload["fleetGeneration"] = current_state["generation"]
        state.save()
    return current_state


def _recover_interrupted_server_config(
    *,
    runtime: Any,
    state: Any,
    inventory: str,
    inventory_name: str,
    server_host: str,
    abandoned_run_id: str | None,
) -> None:
    """Restore an uncommitted Pi5 host-config transaction before planning.

    The prior run record is the controller authority for the run-scoped
    manifest.  A crash can occur before the capture result is persisted, so a
    ``capture-pending`` transaction first repeats the immutable capture under
    the original run ID.  Only ``converged`` is a forward commit; every other
    incomplete state is restored non-cancellably before live evidence may be
    accepted as a baseline.
    """

    if abandoned_run_id is None:
        return
    recovery_run_id = abandoned_run_id
    seen_run_ids: set[str] = set()
    while True:
        if recovery_run_id in seen_run_ids or len(seen_run_ids) >= 16:
            raise RuntimeError("interrupted server config recovery chain is cyclic")
        seen_run_ids.add(recovery_run_id)
        prior = runtime.read_release_run(recovery_run_id)
        if not isinstance(prior, dict):
            return
        server_config = prior.get("serverConfig")
        if server_config is not None:
            if not isinstance(server_config, dict):
                raise RuntimeError("interrupted server config state is malformed")
            config_state = server_config.get("state")
            if config_state in {"converged", "restored"}:
                return
            if config_state not in {
                "capture-pending",
                "captured",
                "restore-failed",
            }:
                raise RuntimeError("interrupted server config state is malformed")
            authority_run_id = server_config.get("authorityRunId")
            if (
                not isinstance(authority_run_id, str)
                or RUN_ID_RE.fullmatch(authority_run_id) is None
                or authority_run_id != recovery_run_id
                or server_config.get("host") != server_host
                or not isinstance(server_config.get("sha"), str)
                or FULL_SHA_RE.fullmatch(server_config["sha"]) is None
            ):
                raise RuntimeError("interrupted server config identity is malformed")
            if prior.get("inventory") != inventory_name:
                raise RuntimeError(
                    "interrupted server config belongs to a different inventory"
                )

            recovery = {
                "state": config_state,
                "authorityRunId": authority_run_id,
                "host": server_host,
                "sha": server_config["sha"],
            }
            manifest = server_config.get("rollbackManifest")
            if config_state == "capture-pending":
                state.payload["phase"] = "recovering-server-config"
                state.payload["interruptedServerConfig"] = recovery
                state.save()
                manifest = runtime.capture_server_config_manifest(
                    inventory, server_host, authority_run_id
                )
                recovery["rollbackManifest"] = manifest
                recovery["state"] = "captured"
                state.save()
            elif not isinstance(manifest, dict):
                raise RuntimeError(
                    "interrupted server config rollback manifest is unavailable"
                )
            else:
                recovery["rollbackManifest"] = manifest
                state.payload["phase"] = "recovering-server-config"
                state.payload["interruptedServerConfig"] = recovery
                state.save()

            try:
                restored = runtime.restore_server_config_manifest(
                    inventory, server_host, authority_run_id, manifest
                )
            except Exception as restore_error:
                recovery["state"] = "restore-failed"
                recovery["failure"] = str(restore_error)
                state.save()
                raise RuntimeError(
                    "interrupted server config restore failed"
                ) from restore_error
            recovery["state"] = "restored"
            recovery["restoredAt"] = runtime.utc_now()
            recovery["restoreEvidence"] = restored
            state.save()
            return

        linked_run = prior.get("abandonedFleetRunId")
        if linked_run is None:
            return
        if not isinstance(linked_run, str) or RUN_ID_RE.fullmatch(linked_run) is None:
            raise RuntimeError("interrupted server config recovery chain is malformed")
        recovery_run_id = linked_run


def execute(args: Any, *, runtime: Any, token: CancellationToken) -> int:
    inventory = str(
        Path(args.inventory)
        if Path(args.inventory).is_absolute()
        else runtime.ANSIBLE_DIRECTORY / args.inventory
    )
    state = None
    fleet_started = False
    fleet_finished = False
    interrupted_recovery_pending = False

    def finish_fleet(status: str) -> dict[str, Any] | None:
        nonlocal fleet_finished
        if not fleet_started or fleet_finished:
            return None
        result = runtime.fleet_finish_run(args.run_id, status)
        fleet_finished = True
        return result

    def save_success() -> int:
        """Arbitrate late cancellation once, then finalize both state formats."""

        assert state is not None
        _collect_ansible_timing(state, runtime, args.run_id)
        state.payload["phase"] = "completed"
        state.payload["state"] = "success"

        def finish_authoritative(effective_state: str) -> dict[str, Any]:
            finished = finish_fleet(effective_state)
            return (
                {"fleetGeneration": finished["generation"]}
                if finished is not None
                else {}
            )

        state.save(before_terminal_persist=finish_authoritative)
        return 0 if state.payload["state"] == "success" else 130

    try:
        # Validate the target-tree inventory and the physical Pi5 identity
        # before the first fleet-state write or any device mutation.
        inventory_data = runtime.inventory_json(inventory)
        identity = runtime.inventory_server_identity(inventory_data)
        if identity["clientId"] != args.expected_server_client_id:
            raise RuntimeError(
                "remote Pi5 identity does not match target inventory server"
            )
        selected = runtime.selected_hosts(inventory, args.limit)
        if args.limit and selected == []:
            raise RuntimeError(f"--limit selected no hosts: {args.limit}")
        all_hosts = runtime.release_hosts(inventory_data)

        # A hard-killed prior run can leave run-labelled validation workload
        # or a paused terminal scheduler even when fleet evidence
        # would otherwise produce a no-op plan.  Reconcile that executor-owned
        # residue before cancellation, evidence seeding, or a new active-run
        # record can hide the abandoned authority.
        runtime.reconcile_pi5_candidate_workload()

        # This is the first durable write.  Any lock-orphaned active run is
        # recorded as interrupted before the new active run is installed.
        fleet_state, abandoned_run_id = runtime.fleet_begin_run(
            args.run_id, args.sha, args.inventory
        )
        fleet_started = True
        token.checkpoint("coordinator-start")

        initial = {
            "version": 1,
            "runId": args.run_id,
            "branch": args.branch,
            "inventory": args.inventory,
            "limitHosts": args.limit or "",
            "fullFleet": bool(getattr(args, "full_fleet", False)),
            "reverifySelected": bool(getattr(args, "reverify_selected", False)),
            "releaseSha": args.sha,
            "unitName": runtime.os.environ.get("ROLLING_RELEASE_UNIT"),
            "runner": "systemd-run",
            "startedAt": runtime.utc_now(),
            "state": "running",
            "phase": "planning",
            "targets": [],
            "fleetGeneration": fleet_state["generation"],
        }
        if abandoned_run_id is not None:
            initial["abandonedFleetRunId"] = abandoned_run_id
        state = runtime.ReleaseState(runtime.status_file(args.run_id), initial)
        state.save()
        interrupted_recovery_pending = abandoned_run_id is not None
        token.checkpoint("state-initialized")

        # An abandoned host-config-only Ansible run may have replaced one or
        # more environment files without reaching its durable commit record.
        # Restore that exact run manifest before terminal recovery, evidence
        # seeding, or no-op planning can accept the partial config as current.
        _recover_interrupted_server_config(
            runtime=runtime,
            state=state,
            inventory=inventory,
            inventory_name=args.inventory,
            server_host=identity["host"],
            abandoned_run_id=abandoned_run_id,
        )

        # A process crash can leave a terminal between checkout and health.
        # Reconcile its old, sealed authority before evidence seeding or a new
        # manifest capture can accept that partial state as a baseline.
        fleet_state = _recover_interrupted_terminals(
            runtime=runtime,
            state=state,
            inventory=inventory,
            run_id=args.run_id,
            desired_sha=args.sha,
            abandoned_run_id=abandoned_run_id,
            all_hosts=all_hosts,
            fleet_state=fleet_state,
        )
        interrupted_recovery_pending = False

        fleet_state, seed_failures = _seed_unverified_hosts(
            all_hosts,
            fleet_state,
            inventory=inventory,
            run_id=args.run_id,
            desired_sha=args.sha,
            abandoned_run_id=abandoned_run_id,
            runtime=runtime,
            token=token,
        )
        plan, targets, _classifications, plan_warnings = runtime.build_fleet_scope(
            sha=args.sha,
            inventory_data=inventory_data,
            fleet_state=fleet_state,
            selected=selected,
            limit=args.limit,
            full_fleet=bool(getattr(args, "full_fleet", False)),
            reverify_selected=bool(getattr(args, "reverify_selected", False)),
            executor_preflight_passed=True,
        )
        if plan_warnings:
            plan["warnings"] = list(plan_warnings)
        if seed_failures:
            state.payload["evidenceSeedFailures"] = seed_failures
        state.payload["hosts"] = [dict(record) for record in plan["hosts"]]
        state.payload["targets"] = _terminal_run_targets(targets, plan)
        state.payload["plan"] = plan
        state.payload["fleetGeneration"] = fleet_state["generation"]
        state.save()
        _require_executable_target_architecture(plan)
        token.checkpoint("plan-complete")

        pi5_required = bool(plan["pi5Required"])
        server = next(record for record in plan["hosts"] if record["role"] == "server")
        if not state.payload["targets"] and not pi5_required:
            state.payload["pi5"] = {"state": "not-required"}
            return save_success()

        state.payload["phase"] = "preparing"
        token.checkpoint("before-pi5")
        if pi5_required:
            # Unknown is authoritative before Phase 3 or any legacy progress
            # snapshot can describe the server as changing.
            pending_server_claims = _pending_server_release_claims(
                desired_sha=server["desiredSha"],
                prior_record=(fleet_state.get("fleet") or {}).get(server["host"]),
                run_id=args.run_id,
            )
            fleet_state = runtime.fleet_mark_unknown(
                server["host"],
                "server",
                server["desiredSha"],
                args.run_id,
                release_claims=pending_server_claims,
            )
            _set_host_status(
                state, server["host"], current_sha=None, evidence="unknown"
            )
            _set_host_release_claims(
                state, server["host"], pending_server_claims
            )
            state.payload["fleetGeneration"] = fleet_state["generation"]
            state.save()

            # Converge host-owned configuration before candidate build,
            # migration, or Blue/Green switching.  The adapter selects the
            # server role's host-config-only mode, whose runtime executors are
            # all fail-closed behind explicit guards.
            server_config = {
                "state": "capture-pending",
                "authorityRunId": args.run_id,
                "host": server["host"],
                "sha": server["desiredSha"],
            }
            state.payload["serverConfig"] = server_config
            interrupted_recovery_pending = True
            state.save()
            with _measure_phase(
                state, runtime, "server-config-manifest-capture", host=server["host"]
            ):
                manifest = runtime.capture_server_config_manifest(
                    inventory, server["host"], args.run_id
                )
            server_config["rollbackManifest"] = manifest
            server_config["state"] = "captured"
            state.save()
            try:
                with _measure_phase(
                    state, runtime, "server-config-apply", host=server["host"]
                ):
                    runtime.converge_server_config(
                        inventory,
                        server["host"],
                        server["desiredSha"],
                        args.run_id,
                        manifest,
                    )
            except Exception as config_error:
                try:
                    restored = runtime.restore_server_config_manifest(
                        inventory, server["host"], args.run_id, manifest
                    )
                except Exception as restore_error:
                    server_config["state"] = "restore-failed"
                    server_config["failure"] = str(config_error)
                    server_config["restoreFailure"] = str(restore_error)
                    state.save()
                    raise RuntimeError(
                        "Pi5 server config convergence and restore failed"
                    ) from restore_error
                server_config["state"] = "restored"
                server_config["failure"] = str(config_error)
                server_config["restoredAt"] = runtime.utc_now()
                server_config["restoreEvidence"] = restored
                interrupted_recovery_pending = False
                state.save()
                raise
            server_config["state"] = "converged"
            server_config["convergedAt"] = runtime.utc_now()
            interrupted_recovery_pending = False
            state.save()
            token.checkpoint("after-pi5-host-config")

            # The five-minute Blue/Green switch monitor and cleanup form one
            # atomic safety window. Cancellation is observed only after it.
            with _measure_phase(
                state, runtime, "pi5-release-and-stability", host=server["host"]
            ):
                runtime.ensure_pi5_release(server["desiredSha"], state)
            with _measure_phase(state, runtime, "pi5-evidence", host=server["host"]):
                observation = runtime.observe_pi5_evidence(server["desiredSha"])
            observation["releaseClaims"] = _direct_release_claims(
                role="server",
                expected_sha=server["desiredSha"],
                observed_sha=observation["currentSha"],
                run_id=args.run_id,
                observed_at=runtime.utc_now(),
            )
            observation["releaseClaims"] = _require_verified_release_claims(
                observation["releaseClaims"],
                {ClaimKind.CONTROL_PLANE_API, ClaimKind.CONTROL_PLANE_WEB},
            )
            verification_options = {"observation": observation}
            prior_server_sha = server.get("currentSha")
            if (
                isinstance(prior_server_sha, str)
                and prior_server_sha != observation["currentSha"]
            ):
                verification_options["previous_sha"] = prior_server_sha
            fleet_state = runtime.fleet_mark_verified(
                server["host"],
                "server",
                server["desiredSha"],
                observation["currentSha"],
                args.run_id,
                **verification_options,
            )
            _set_host_status(
                state,
                server["host"],
                current_sha=observation["currentSha"],
                evidence="verified",
            )
            _set_host_release_claims(
                state, server["host"], observation["releaseClaims"]
            )
            state.payload["fleetGeneration"] = fleet_state["generation"]
            state.save()
        else:
            state.payload["pi5"] = {"state": "not-required"}
            state.save()
        token.checkpoint("after-pi5-stability")

        for index, target_spec in enumerate(targets):
            host = target_spec["host"]
            role = target_spec["role"]
            adapter = _terminal_adapter(runtime, target_spec["terminalType"])
            token.checkpoint(f"before-terminal:{host}")
            target = state.target(host)

            # An unreachable terminal must become unknown even if the first
            # read-only HEAD probe fails.  This precedes notices, maintenance,
            # Ansible, and their per-run progress records.
            pending_claims = _pending_terminal_release_claims(
                adapter,
                target,
                (fleet_state.get("fleet") or {}).get(host),
                args.run_id,
            )
            target["currentSha"] = None
            target["evidence"] = "unknown"
            if pending_claims is not None:
                target["releaseClaims"] = pending_claims
            _set_host_status(state, host, current_sha=None, evidence="unknown")
            if pending_claims is not None:
                _set_host_release_claims(state, host, pending_claims)
                fleet_state = runtime.fleet_mark_unknown(
                    host,
                    role,
                    target["desiredSha"],
                    args.run_id,
                    release_claims=pending_claims,
                )
            else:
                fleet_state = runtime.fleet_mark_unknown(
                    host, role, target["desiredSha"], args.run_id
                )
            state.payload["fleetGeneration"] = fleet_state["generation"]
            state.save()

            if target.get("mutationRequired") is True:
                # Only the forward Ansible executor uses SSH pipelining. A
                # Web-consumer activation retains the manifest and evidence
                # transports but never pretends to be an Ansible apply.
                with _measure_phase(
                    state,
                    runtime,
                    "terminal-ansible-pipelining-preflight",
                    host=host,
                ):
                    runtime.preflight_terminal_ansible_pipelining(inventory, host)
                token.checkpoint(
                    f"after-terminal-ansible-pipelining-preflight:{host}"
                )

            with _measure_phase(state, runtime, "terminal-repository-baseline", host=host):
                repository_baseline = adapter.prepare_repository(inventory, host)
            target["previousSha"] = repository_baseline["head"]
            target["repositoryBaseline"] = repository_baseline
            # Persist the verified pre-mutation HEAD before the remote manifest
            # call. If result delivery is interrupted, the next coordinator can
            # still prove this host remained at its prior clean release.
            state.save()
            # Seal every release-owned destination and the exact repository
            # HEAD before notices, maintenance, prestaging, checkout, or
            # service changes.  A capture failure is therefore mutation-free.
            try:
                with _measure_phase(
                    state, runtime, "terminal-manifest-capture", host=host
                ):
                    target["rollbackManifest"] = adapter.capture_manifest(
                        inventory,
                        target_spec,
                        args.run_id,
                        target["previousSha"],
                    )
            except Exception as capture_error:
                # The remote helper may have sealed state even if result
                # delivery failed. Keep this run active so the next
                # coordinator retries the exact run identity before planning.
                interrupted_recovery_pending = True
                target["manifestCaptureFailure"] = str(capture_error)
                state.save()
                raise
            state.save()
            try:
                if adapter.should_issue_notice(
                    emergency_override=args.emergency_override
                ):
                    with _measure_phase(state, runtime, "terminal-notice", host=host):
                        adapter.deliver_notice(
                            state, target_spec, target, args.run_id
                        )
                else:
                    target["notice"] = {
                        "state": "skipped",
                        "reason": adapter.notice_skip_reason(
                            emergency_override=args.emergency_override
                        ),
                        "skippedAt": runtime.utc_now(),
                    }
                    state.save()
                token.checkpoint(f"after-notice:{host}")
            except Exception as pre_mutation_error:
                # Runtime capture can retain run-scoped Docker image tags even
                # though no terminal release mutation has begun. Seal and
                # durably clean that lifecycle before propagating notice
                # failures or cancellation.
                target["runtimeFinalization"] = {
                    "outcome": "committed",
                    "verifiedSha": target["previousSha"],
                }
                state.save()
                try:
                    target["runtimeCleanup"] = adapter.cleanup(
                        inventory,
                        target_spec,
                        target,
                        args.run_id,
                        "committed",
                    )
                    target["preMutationFailure"] = str(pre_mutation_error)
                    state.save()
                except Exception as cleanup_error:
                    interrupted_recovery_pending = True
                    target["runtimeCleanupFailure"] = str(cleanup_error)
                    target["state"] = "failed"
                    target["completedAt"] = runtime.utc_now()
                    state.save()
                    raise RuntimeError(
                        f"terminal pre-mutation cleanup failed for {host}"
                    ) from cleanup_error
                raise

            try:
                # From this point a failed command may have changed remote
                # state even when its transport reports an error.  Every
                # failure and cancellation therefore passes through the one
                # manifest-owned rollback below.
                target["state"] = "maintenance-requested"
                target["maintenanceStartedAt"] = runtime.utc_now()
                state.payload["phase"] = "deploying"
                state.save()
                with _measure_phase(
                    state, runtime, "terminal-maintenance-enter", host=host
                ):
                    adapter.enter_maintenance(inventory, target_spec, args.run_id)
                token.checkpoint(f"after-maintenance:{host}")
                adapter.prestage_maintenance(inventory, target_spec, args.run_id)
                with _measure_phase(
                    state, runtime, "terminal-maintenance-ack", host=host
                ):
                    maintenance_acknowledged = runtime.wait_for_ack(
                        args.run_id, target_spec["clientId"], phase="maintenance"
                    )
                if not maintenance_acknowledged:
                    if not args.emergency_override:
                        raise RuntimeError(
                            f"maintenance acknowledgement timed out for {host}"
                        )
                    target["ackOverrideReason"] = args.reason
                target["acknowledgedAt"] = runtime.utc_now()
                token.checkpoint(f"before-playbook:{host}")

                target["state"] = "deploying"
                state.save()
                runtime.state_command(
                    "set-phase",
                    "--run-id",
                    args.run_id,
                    "--client",
                    target_spec["clientId"],
                    "--phase",
                    "deploying",
                )
                if target.get("mutationRequired") is True:
                    # Ansible is not killed mid-operation. Verification happens
                    # before the next cancellation checkpoint.
                    with _measure_phase(
                        state, runtime, "terminal-ansible-apply", host=host
                    ):
                        adapter.apply(
                            inventory, host, target["desiredSha"], args.run_id
                        )
                if target.get("activationRequired") is True:
                    activation_mode = target.get("activationMode")
                    if (
                        target.get("activationStrategyId")
                        != WEB_CONSUMER_ACTIVATION_STRATEGY
                        or activation_mode
                        not in {
                            WEB_CONSUMER_MIGRATION_MODE,
                            WEB_CONSUMER_STEADY_STATE_MODE,
                        }
                    ):
                        raise RuntimeError(
                            f"terminal activation contract is invalid: {host}"
                        )
                    target["activation"] = {
                        "strategyId": WEB_CONSUMER_ACTIVATION_STRATEGY,
                        "mode": activation_mode,
                        "state": (
                            "submission-pending"
                            if activation_mode == WEB_CONSUMER_MIGRATION_MODE
                            else "challenge-pending"
                        ),
                        "startedAt": runtime.utc_now(),
                    }
                    state.save()
                    if activation_mode == WEB_CONSUMER_MIGRATION_MODE:
                        with _measure_phase(
                            state, runtime, "terminal-web-activation", host=host
                        ):
                            activation_result = adapter.activate(
                                inventory, target_spec, target, args.run_id
                            )
                        target["activation"].update(
                            {
                                "state": "succeeded",
                                "operationUnit": activation_result[
                                    "operationUnit"
                                ],
                                "completedAt": runtime.utc_now(),
                            }
                        )
                        state.save()
                expected_ready_sha = _terminal_ready_sha(
                    state, adapter, target
                )
                with _measure_phase(state, runtime, "terminal-ready-ack", host=host):
                    _verify_terminal_ready(
                        runtime=runtime,
                        state=state,
                        inventory=inventory,
                        run_id=args.run_id,
                        target_spec=target_spec,
                        adapter=adapter,
                        target=target,
                        expected_sha=expected_ready_sha,
                        rollback=False,
                    )
                if target.get("activationRequired") is True:
                    capability = _activation_capability_proof(
                        runtime, target, args.run_id, rollback=False
                    )
                    if capability is None:
                        raise RuntimeError("activation capability proof is missing")
                    target["activationCapabilityProof"] = capability
                    target["activation"]["state"] = "verified"
                    state.save()
                with _measure_phase(state, runtime, "terminal-evidence", host=host):
                    observation = adapter.observe(
                        inventory, host, target_spec["clientId"]
                    )
                if observation.get("currentSha") != target["desiredSha"]:
                    raise RuntimeError(
                        f"terminal HEAD does not match desired release: {host}"
                    )
                release_claims = _terminal_observed_release_claims(
                    runtime=runtime,
                    adapter=adapter,
                    target=target,
                    observation=observation,
                    run_id=args.run_id,
                    rollback=False,
                )
                if release_claims is not None:
                    target["releaseClaims"] = release_claims
                    observation["releaseClaims"] = release_claims
                    _set_host_release_claims(state, host, release_claims)
                if target.get("activationRequired") is True:
                    observation["activationCapabilities"] = {
                        WEB_CONSUMER_ACTIVATION_STRATEGY: dict(
                            target["activationCapabilityProof"]
                        )
                    }
                target["runtimeFinalization"] = {
                    "outcome": "committed",
                    "verifiedSha": observation["currentSha"],
                }
                state.save()
            except Exception as error:
                # Rollback is itself a mutation, so it gets a fresh unknown
                # transition even if target verification had just succeeded.
                rollback_pending_claims = _unverified_terminal_release_claims(
                    adapter, target, args.run_id
                )
                if rollback_pending_claims is None:
                    fleet_state = runtime.fleet_mark_unknown(
                        host, role, target["desiredSha"], args.run_id
                    )
                else:
                    target["releaseClaims"] = rollback_pending_claims
                    fleet_state = runtime.fleet_mark_unknown(
                        host,
                        role,
                        target["desiredSha"],
                        args.run_id,
                        release_claims=rollback_pending_claims,
                    )
                    _set_host_release_claims(
                        state, host, rollback_pending_claims
                    )
                target["currentSha"] = None
                target["evidence"] = "unknown"
                target["state"] = "rolling-back"
                target["failure"] = str(error)
                _set_host_status(state, host, current_sha=None, evidence="unknown")
                state.payload["fleetGeneration"] = fleet_state["generation"]
                state.payload["phase"] = "rolling-back"
                state.save()

                if isinstance(error, ActivationUncertainError):
                    # The deterministic activation unit may still own a
                    # browser restart. Unknown activation and rollback must
                    # never run concurrently. A later canonical recovery first
                    # reconciles this exact unit through the sealed manifest.
                    interrupted_recovery_pending = True
                    target["state"] = "activation-uncertain"
                    target["activationReconciliation"] = "unknown"
                    target["completedAt"] = runtime.utc_now()
                    state.payload["phase"] = "activation-reconciliation-required"
                    state.save()
                    raise RuntimeError(
                        f"rollout stopped with unresolved activation for {host}"
                    ) from error

                if (
                    target.get("activationRequired") is True
                    and target.get("activationMode")
                    == WEB_CONSUMER_MIGRATION_MODE
                ):
                    try:
                        activation_reconciliation = adapter.reconcile_activation(
                            inventory, target_spec, target, args.run_id
                        )
                    except Exception:
                        interrupted_recovery_pending = True
                        target["state"] = "activation-uncertain"
                        # Persist only the bounded state. Transport exception
                        # text can contain environment-specific details and is
                        # never part of release evidence.
                        target["activationReconciliation"] = "unknown"
                        state.payload["phase"] = (
                            "activation-reconciliation-required"
                        )
                        state.save()
                        raise RuntimeError(
                            f"rollout stopped with unresolved activation for {host}"
                        ) from error
                    if (
                        not isinstance(activation_reconciliation, dict)
                        or activation_reconciliation.get("state")
                        not in {"absent", "succeeded", "failed"}
                    ):
                        interrupted_recovery_pending = True
                        target["state"] = "activation-uncertain"
                        target["activationReconciliation"] = "unknown"
                        state.payload["phase"] = (
                            "activation-reconciliation-required"
                        )
                        state.save()
                        raise RuntimeError(
                            f"rollout stopped with unresolved activation for {host}"
                        ) from error
                    target["activationReconciliation"] = activation_reconciliation
                    state.save()

                # Rollback wins over cancellation and is never interrupted.
                rollback_reconciled = False
                try:
                    with _measure_phase(
                        state, runtime, "terminal-rollback", host=host
                    ):
                        rollback_ok = adapter.rollback(
                            inventory, target_spec, target, args.run_id
                        )
                except Exception as rollback_error:
                    rollback_ok = False
                    target["rollback"] = f"failed: {rollback_error}"
                if rollback_ok:
                    try:
                        rollback_runtime_health = target.get(
                            "rollbackRuntimeHealth"
                        )
                        if not isinstance(rollback_runtime_health, dict):
                            raise RuntimeError(
                                "rollback runtime health authority is missing"
                            )
                        rollback_ready_sha = _rollback_ready_sha(
                            state, adapter, target
                        )
                        _verify_terminal_ready(
                            runtime=runtime,
                            state=state,
                            inventory=inventory,
                            run_id=args.run_id,
                            target_spec=target_spec,
                            adapter=adapter,
                            target=target,
                            expected_sha=rollback_ready_sha,
                            rollback=True,
                        )
                        rollback_capability = _activation_capability_proof(
                            runtime, target, args.run_id, rollback=True
                        )
                        if rollback_capability is not None:
                            target[
                                "rollbackActivationCapabilityProof"
                            ] = rollback_capability
                            state.save()
                        with _measure_phase(
                            state, runtime, "terminal-rollback-evidence", host=host
                        ):
                            rollback_observation = adapter.observe(
                                inventory,
                                host,
                                target_spec["clientId"],
                                runtime_health=rollback_runtime_health,
                            )
                        if (
                            rollback_observation.get("currentSha")
                            != target["previousSha"]
                        ):
                            raise RuntimeError(
                                f"rollback HEAD does not match previous release: {host}"
                            )
                        rollback_claims = _terminal_observed_release_claims(
                            runtime=runtime,
                            adapter=adapter,
                            target=target,
                            observation=rollback_observation,
                            run_id=args.run_id,
                            rollback=True,
                        )
                        if rollback_claims is not None:
                            target["releaseClaims"] = rollback_claims
                            rollback_observation[
                                "releaseClaims"
                            ] = rollback_claims
                        if rollback_capability is not None:
                            rollback_observation["activationCapabilities"] = {
                                WEB_CONSUMER_ACTIVATION_STRATEGY: dict(
                                    rollback_capability
                                )
                            }
                        target["runtimeFinalization"] = {
                            "outcome": "restored",
                            "verifiedSha": rollback_observation["currentSha"],
                        }
                        state.save()
                        activation_cleanup = adapter.cleanup_activation(
                            inventory, target_spec, target, args.run_id
                        )
                        if activation_cleanup is not None:
                            target["activationCleanup"] = activation_cleanup
                            state.save()
                        # Cleanup is part of rollback evidence.  Never promote
                        # a host while maintenance remains active.
                        with _measure_phase(
                            state,
                            runtime,
                            "terminal-rollback-maintenance-clear",
                            host=host,
                        ):
                            adapter.clear_maintenance(target_spec, args.run_id)
                        target["maintenanceClearedAt"] = runtime.utc_now()
                        state.save()
                        _finalize_terminal_display(
                            runtime=runtime,
                            state=state,
                            inventory=inventory,
                            run_id=args.run_id,
                            target_spec=target_spec,
                            adapter=adapter,
                            target=target,
                            observation=rollback_observation,
                        )
                        with _measure_phase(
                            state, runtime, "terminal-rollback-cleanup", host=host
                        ):
                            target["runtimeCleanup"] = adapter.cleanup(
                                inventory,
                                target_spec,
                                target,
                                args.run_id,
                                "restored",
                            )
                        state.save()
                        fleet_state = runtime.fleet_mark_verified(
                            host,
                            role,
                            target["desiredSha"],
                            rollback_observation["currentSha"],
                            args.run_id,
                            previous_sha=target["previousSha"],
                            observation=rollback_observation,
                        )
                        target["currentSha"] = rollback_observation["currentSha"]
                        target["evidence"] = "verified"
                        target["rollbackEvidence"] = "verified"
                        _set_host_status(
                            state,
                            host,
                            current_sha=rollback_observation["currentSha"],
                            evidence="verified",
                        )
                        if rollback_claims is not None:
                            _set_host_release_claims(
                                state, host, rollback_claims
                            )
                        state.payload["fleetGeneration"] = fleet_state["generation"]
                        rollback_reconciled = True
                    except Exception as rollback_evidence_error:
                        target["rollbackEvidence"] = (
                            f"unknown: {rollback_evidence_error}"
                        )
                        try:
                            runtime.state_command(
                                "set-phase",
                                "--run-id",
                                args.run_id,
                                "--client",
                                target_spec["clientId"],
                                "--phase",
                                "failed",
                            )
                        except Exception as phase_error:
                            target["rollbackPhaseError"] = str(phase_error)
                else:
                    try:
                        runtime.state_command(
                            "set-phase",
                            "--run-id",
                            args.run_id,
                            "--client",
                            target_spec["clientId"],
                            "--phase",
                            "failed",
                        )
                    except Exception as phase_error:
                        target["rollbackPhaseError"] = str(phase_error)
                if not rollback_reconciled:
                    interrupted_recovery_pending = True
                target["state"] = "failed"
                target["completedAt"] = runtime.utc_now()
                state.save()
                if isinstance(error, CancellationRequested):
                    raise error
                raise RuntimeError(
                    f"rollout stopped after {host} failed"
                ) from error

            # Health and exact ready evidence are complete. Finalization is a
            # commit boundary, not another deployment operation: if cleanup or
            # durable fleet persistence fails, stop with conservative evidence
            # and never mutate the healthy terminal again via rollback.
            fleet_promoted = False
            try:
                with _measure_phase(
                    state, runtime, "terminal-activation-cleanup", host=host
                ):
                    activation_cleanup = adapter.cleanup_activation(
                        inventory, target_spec, target, args.run_id
                    )
                if activation_cleanup is not None:
                    target["activationCleanup"] = activation_cleanup
                    state.save()
                with _measure_phase(
                    state, runtime, "terminal-maintenance-clear", host=host
                ):
                    adapter.clear_maintenance(target_spec, args.run_id)
                target["maintenanceClearedAt"] = runtime.utc_now()
                state.save()
                _finalize_terminal_display(
                    runtime=runtime,
                    state=state,
                    inventory=inventory,
                    run_id=args.run_id,
                    target_spec=target_spec,
                    adapter=adapter,
                    target=target,
                    observation=observation,
                )
                with _measure_phase(state, runtime, "terminal-cleanup", host=host):
                    target["runtimeCleanup"] = adapter.cleanup(
                        inventory,
                        target_spec,
                        target,
                        args.run_id,
                        "committed",
                    )
                state.save()
                fleet_state = runtime.fleet_mark_verified(
                    host,
                    role,
                    target["desiredSha"],
                    observation["currentSha"],
                    args.run_id,
                    previous_sha=target["previousSha"],
                    observation=observation,
                )
                fleet_promoted = True
                target["newSha"] = observation["currentSha"]
                target["currentSha"] = observation["currentSha"]
                target["evidence"] = "verified"
                target["state"] = "success"
                target["completedAt"] = runtime.utc_now()
                _set_host_status(
                    state,
                    host,
                    current_sha=observation["currentSha"],
                    evidence="verified",
                )
                state.payload["fleetGeneration"] = fleet_state["generation"]
                state.save()
            except Exception as finalization_error:
                if not fleet_promoted:
                    interrupted_recovery_pending = True
                target["state"] = "failed"
                target["completedAt"] = runtime.utc_now()
                target["finalizationFailure"] = str(finalization_error)
                if not fleet_promoted:
                    target["currentSha"] = None
                    target["evidence"] = "unknown"
                    _set_host_status(
                        state, host, current_sha=None, evidence="unknown"
                    )
                if "maintenanceClearedAt" not in target:
                    try:
                        runtime.state_command(
                            "set-phase",
                            "--run-id",
                            args.run_id,
                            "--client",
                            target_spec["clientId"],
                            "--phase",
                            "failed",
                        )
                    except Exception as phase_error:
                        target["finalizationPhaseError"] = str(phase_error)
                state.payload["phase"] = "terminal-finalization-failed"
                try:
                    state.save()
                except Exception as state_error:
                    target["finalizationStateError"] = str(state_error)
                raise RuntimeError(
                    f"terminal finalization failed for {host}"
                ) from finalization_error

            token.checkpoint(f"after-playbook:{host}")
            if runtime.should_hold_after_canary(
                targets, index, skip=args.skip_canary_hold
            ):
                state.payload["phase"] = "waiting-approval"
                state.save()
                runtime.wait_for_canary_hold(
                    state,
                    args.run_id,
                    host,
                    args.canary_hold_timeout,
                    profile_id=target_spec["terminalType"],
                )
                token.checkpoint("after-canary-approval")

        token.checkpoint("before-success")
        return save_success()
    except CancellationRequested as cancellation:
        # Removing deploy-status entries is safe only at a phase boundary;
        # Blue/Green, Ansible, and rollback return before reaching one.
        cleanup: dict[str, Any]
        unresolved_maintenance = bool(
            state is not None
            and any(
                target.get("maintenanceStartedAt")
                and not target.get("maintenanceClearedAt")
                and target.get("state") in {"rolling-back", "failed"}
                for target in state.payload.get("targets") or []
            )
        )
        if unresolved_maintenance:
            # A failed or unverifiable rollback must remain visibly in
            # maintenance even though the operator-requested run is cancelled.
            cleanup = {
                "state": "retained",
                "reason": "terminal rollback evidence is unknown",
                "completedAt": runtime.utc_now(),
            }
        else:
            try:
                runtime.state_command("remove-run", "--run-id", args.run_id)
                cleanup = {"state": "success", "completedAt": runtime.utc_now()}
            except Exception as cleanup_error:
                cleanup = {
                    "state": "failed",
                    "failedAt": runtime.utc_now(),
                    "error": str(cleanup_error),
                }
        cleanup_failed = cleanup["state"] == "failed"
        terminal_state = "failed" if cleanup_failed else "cancelled"
        fleet_finish_error: Exception | None = None
        if interrupted_recovery_pending:
            finished = None
            cleanup["fleetStateRetained"] = "interrupted recovery remains active"
        else:
            try:
                finished = finish_fleet(terminal_state)
            except Exception as error:
                fleet_finish_error = error
                cleanup_failed = True
                terminal_state = "failed"
                cleanup["fleetStateError"] = str(error)
                finished = None

        if state is None:
            state = runtime.ReleaseState(
                runtime.status_file(args.run_id),
                {
                    "version": 1,
                    "runId": args.run_id,
                    "branch": args.branch,
                    "inventory": args.inventory,
                    "limitHosts": args.limit or "",
                    "fullFleet": bool(getattr(args, "full_fleet", False)),
                    "reverifySelected": bool(getattr(args, "reverify_selected", False)),
                    "releaseSha": args.sha,
                    "unitName": runtime.os.environ.get("ROLLING_RELEASE_UNIT"),
                    "runner": "systemd-run",
                    "startedAt": runtime.utc_now(),
                    "targets": [],
                    "state": terminal_state,
                    "phase": "completed",
                },
            )
        else:
            state.payload["state"] = terminal_state
            state.payload["phase"] = "completed"
        if finished is not None:
            state.payload["fleetGeneration"] = finished["generation"]
        canary_hold = state.payload.get("canaryHold")
        if isinstance(canary_hold, dict):
            canary_hold.update(
                {"state": "cancelled", "cancelledAt": runtime.utc_now()}
            )
        approval_gates = state.payload.get("approvalGates")
        if isinstance(approval_gates, list) and approval_gates:
            latest_gate = approval_gates[-1]
            if isinstance(latest_gate, dict) and latest_gate.get("state") == "waiting-verification":
                latest_gate.update(
                    {"state": "cancelled", "cancelledAt": runtime.utc_now()}
                )
        state.payload["cancellation"] = {
            "reason": cancellation.reason,
            "checkpoint": cancellation.checkpoint,
            "cancelledAt": runtime.utc_now(),
        }
        state.payload["cancellationCleanup"] = cleanup
        _collect_ansible_timing(state, runtime, args.run_id)
        if cleanup_failed:
            state.payload["failure"] = (
                f"cancellation cleanup failed: {cleanup.get('error') or fleet_finish_error}"
            )
        state.save()
        return 1 if cleanup_failed else 130
    except Exception as error:
        fleet_finish_error: Exception | None = None
        if interrupted_recovery_pending:
            finished = None
        else:
            try:
                finished = finish_fleet("failed")
            except Exception as finish_error:
                fleet_finish_error = finish_error
                finished = None
        if state is not None:
            _collect_ansible_timing(state, runtime, args.run_id)
            state.payload["state"] = "failed"
            state.payload["phase"] = "completed"
            state.payload["failure"] = str(error)
            if finished is not None:
                state.payload["fleetGeneration"] = finished["generation"]
            if fleet_finish_error is not None:
                state.payload["fleetStateFailure"] = str(fleet_finish_error)
            state.save()
        if fleet_finish_error is not None:
            raise RuntimeError(
                f"release failed and fleet finalization failed: {fleet_finish_error}"
            ) from error
        raise
