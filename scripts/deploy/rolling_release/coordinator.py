"""Release ordering and authoritative fleet-state transitions.

The facade is injected as ``runtime`` so command adapters and durable stores
remain independently testable.  The fleet record is always written before a
legacy run snapshot or compatibility marker that describes the same
transition.
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from .cancellation import CancellationRequested, CancellationToken


FULL_SHA_RE = re.compile(r"^[0-9a-f]{40}$")


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
        try:
            observation = (
                runtime.observe_pi5_evidence(None)
                if role == "server"
                else runtime.observe_terminal_evidence(
                    inventory, host, role, host_spec["clientId"]
                )
            )
        except Exception as error:
            failures.append({"host": host, "error": str(error)})
            current_state = runtime.fleet_mark_unknown(
                host, role, desired_sha, run_id
            )
        else:
            current_sha = observation.get("currentSha")
            current_state = runtime.fleet_mark_verified(
                host,
                role,
                current_sha,
                current_sha,
                run_id,
                previous_sha=None,
                observation=observation,
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


def _terminal_run_targets(
    terminal_targets: list[dict[str, str]], plan: dict[str, Any]
) -> list[dict[str, Any]]:
    decisions = {
        decision["host"]: decision
        for decision in plan.get("hosts") or []
        if decision.get("targeted") and decision.get("role") in {"kiosk", "signage"}
    }
    result: list[dict[str, Any]] = []
    for target in terminal_targets:
        decision = decisions[target["host"]]
        result.append(
            {
                **target,
                "role": decision["role"],
                "desiredSha": decision["desiredSha"],
                "currentSha": decision["currentSha"],
                "evidence": decision["evidence"],
                "targetReason": decision["targetReason"],
                "state": "pending",
            }
        )
    return result


def _pi5_marker_candidate(observation: dict[str, Any]) -> dict[str, Any]:
    """Build the compatibility marker only from verified live evidence."""

    return {
        "api": observation.get("apiImage"),
        "web": observation.get("webImage"),
    }


def _terminal_ready_sha(
    state: Any,
    target_spec: dict[str, str],
    target: dict[str, Any],
) -> str:
    """Return the immutable artifact SHA the terminal must actually render."""

    if target_spec["terminalType"] == "signage":
        expected = target.get("desiredSha")
    else:
        server = next(
            (
                record
                for record in state.payload.get("hosts") or []
                if record.get("role") == "server"
            ),
            None,
        )
        if not isinstance(server, dict) or server.get("evidence") != "verified":
            raise RuntimeError("Kiosk Web release has no verified Pi5 evidence")
        expected = server.get("currentSha")
    if not isinstance(expected, str) or FULL_SHA_RE.fullmatch(expected) is None:
        raise RuntimeError("terminal ready release SHA is unavailable")
    return expected


def _rollback_ready_sha(
    state: Any,
    target_spec: dict[str, str],
    target: dict[str, Any],
) -> str:
    if target_spec["terminalType"] == "signage":
        expected = target.get("previousSha")
        if not isinstance(expected, str) or FULL_SHA_RE.fullmatch(expected) is None:
            raise RuntimeError("signage rollback release SHA is unavailable")
        return expected
    return _terminal_ready_sha(state, target_spec, target)


def _verify_terminal_ready(
    *,
    runtime: Any,
    state: Any,
    inventory: str,
    run_id: str,
    target_spec: dict[str, str],
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
    if target_spec["terminalType"] == "signage":
        runtime.trigger_signage_ready_check(inventory, target_spec["host"])
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


def execute(args: Any, *, runtime: Any, token: CancellationToken) -> int:
    inventory = str(
        Path(args.inventory)
        if Path(args.inventory).is_absolute()
        else runtime.ANSIBLE_DIRECTORY / args.inventory
    )
    state = None
    fleet_started = False
    fleet_finished = False

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
        token.checkpoint("state-initialized")

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
            auto_minimize_alias=bool(getattr(args, "auto_minimize", False)),
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
            fleet_state = runtime.fleet_mark_unknown(
                server["host"], "server", server["desiredSha"], args.run_id
            )
            _set_host_status(
                state, server["host"], current_sha=None, evidence="unknown"
            )
            state.payload["fleetGeneration"] = fleet_state["generation"]
            state.save()

            # Converge host-owned configuration before candidate build,
            # migration, or Blue/Green switching.  The adapter selects the
            # server role's host-config-only mode, whose runtime executors are
            # all fail-closed behind explicit guards.
            runtime.converge_server_config(
                inventory,
                server["host"],
                server["desiredSha"],
                args.run_id,
            )
            token.checkpoint("after-pi5-host-config")

            # The five-minute Blue/Green switch monitor and cleanup form one
            # atomic safety window. Cancellation is observed only after it.
            runtime.ensure_pi5_release(server["desiredSha"], state)
            observation = runtime.observe_pi5_evidence(server["desiredSha"])
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
            # Compatibility marker dual-write is deliberately second.
            runtime.record_pi5_release_current(
                server["desiredSha"], _pi5_marker_candidate(observation)
            )
            _set_host_status(
                state,
                server["host"],
                current_sha=observation["currentSha"],
                evidence="verified",
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
            token.checkpoint(f"before-terminal:{host}")
            target = state.target(host)

            # An unreachable terminal must become unknown even if the first
            # read-only HEAD probe fails.  This precedes notices, maintenance,
            # Ansible, and their legacy snapshots.
            fleet_state = runtime.fleet_mark_unknown(
                host, role, target["desiredSha"], args.run_id
            )
            target["currentSha"] = None
            target["evidence"] = "unknown"
            _set_host_status(state, host, current_sha=None, evidence="unknown")
            state.payload["fleetGeneration"] = fleet_state["generation"]
            state.save()

            target["previousSha"] = runtime.remote_previous_sha(inventory, host)
            if runtime.should_issue_terminal_notice(
                terminal_type=target_spec["terminalType"],
                emergency_override=args.emergency_override,
            ):
                runtime.deliver_terminal_notice(
                    state, target_spec, target, args.run_id
                )
            else:
                target["notice"] = {
                    "state": "skipped",
                    "reason": runtime.terminal_notice_skip_reason(
                        terminal_type=target_spec["terminalType"],
                        emergency_override=args.emergency_override,
                    ),
                    "skippedAt": runtime.utc_now(),
                }
                state.save()
            token.checkpoint(f"after-notice:{host}")

            target["state"] = "maintenance-requested"
            target["maintenanceStartedAt"] = runtime.utc_now()
            state.payload["phase"] = "deploying"
            state.save()
            runtime.state_command(
                "put",
                "--run-id",
                args.run_id,
                "--clients",
                target_spec["clientId"],
                "--terminal-type",
                target_spec["terminalType"],
            )
            token.checkpoint(f"after-maintenance:{host}")
            if target_spec["terminalType"] == "signage":
                runtime.prestage_signage_maintenance(
                    inventory, host, args.run_id, target_spec["clientId"]
                )
            if not runtime.wait_for_ack(
                args.run_id, target_spec["clientId"], phase="maintenance"
            ):
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
            try:
                # Ansible is not killed mid-operation.  Verification happens
                # before the next cancellation checkpoint.
                runtime.playbook(
                    inventory, host, target["desiredSha"], args.run_id
                )
                expected_ready_sha = _terminal_ready_sha(
                    state, target_spec, target
                )
                _verify_terminal_ready(
                    runtime=runtime,
                    state=state,
                    inventory=inventory,
                    run_id=args.run_id,
                    target_spec=target_spec,
                    target=target,
                    expected_sha=expected_ready_sha,
                    rollback=False,
                )
                observation = runtime.observe_terminal_evidence(
                    inventory,
                    host,
                    role,
                    target_spec["clientId"],
                )
                if observation.get("currentSha") != target["desiredSha"]:
                    raise RuntimeError(
                        f"terminal HEAD does not match desired release: {host}"
                    )
            except Exception as error:
                # Rollback is itself a mutation, so it gets a fresh unknown
                # transition even if target verification had just succeeded.
                fleet_state = runtime.fleet_mark_unknown(
                    host, role, target["desiredSha"], args.run_id
                )
                target["currentSha"] = None
                target["evidence"] = "unknown"
                target["state"] = "rolling-back"
                target["failure"] = str(error)
                _set_host_status(state, host, current_sha=None, evidence="unknown")
                state.payload["fleetGeneration"] = fleet_state["generation"]
                state.payload["phase"] = "rolling-back"
                state.save()

                # Rollback wins over cancellation and is never interrupted.
                try:
                    rollback_ok = runtime.rollback_terminal(
                        inventory, target_spec, target, args.run_id
                    )
                except Exception as rollback_error:
                    rollback_ok = False
                    target["rollback"] = f"failed: {rollback_error}"
                if rollback_ok:
                    try:
                        rollback_ready_sha = _rollback_ready_sha(
                            state, target_spec, target
                        )
                        _verify_terminal_ready(
                            runtime=runtime,
                            state=state,
                            inventory=inventory,
                            run_id=args.run_id,
                            target_spec=target_spec,
                            target=target,
                            expected_sha=rollback_ready_sha,
                            rollback=True,
                        )
                        rollback_observation = runtime.observe_terminal_evidence(
                            inventory,
                            host,
                            role,
                            target_spec["clientId"],
                        )
                        if (
                            rollback_observation.get("currentSha")
                            != target["previousSha"]
                        ):
                            raise RuntimeError(
                                f"rollback HEAD does not match previous release: {host}"
                            )
                        # Cleanup is part of rollback evidence.  Never promote
                        # a host while maintenance remains active.
                        runtime.state_command(
                            "remove-client",
                            "--run-id",
                            args.run_id,
                            "--client",
                            target_spec["clientId"],
                        )
                        target["maintenanceClearedAt"] = runtime.utc_now()
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
                        state.payload["fleetGeneration"] = fleet_state["generation"]
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
                runtime.state_command(
                    "remove-client",
                    "--run-id",
                    args.run_id,
                    "--client",
                    target_spec["clientId"],
                )
                target["maintenanceClearedAt"] = runtime.utc_now()
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
                    state, args.run_id, host, args.canary_hold_timeout
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
        state.payload["cancellation"] = {
            "reason": cancellation.reason,
            "checkpoint": cancellation.checkpoint,
            "cancelledAt": runtime.utc_now(),
        }
        state.payload["cancellationCleanup"] = cleanup
        if cleanup_failed:
            state.payload["failure"] = (
                f"cancellation cleanup failed: {cleanup.get('error') or fleet_finish_error}"
            )
        state.save()
        return 1 if cleanup_failed else 130
    except Exception as error:
        fleet_finish_error: Exception | None = None
        try:
            finished = finish_fleet("failed")
        except Exception as finish_error:
            fleet_finish_error = finish_error
            finished = None
        if state is not None:
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
