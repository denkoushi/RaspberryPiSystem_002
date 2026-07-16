"""Pi5 release stages and Blue/Green execution adapter.

Migration planning and bounded candidate-build evidence complete before the
Blue/Green executor is allowed to apply forward migrations or change runtime
routing. The five-minute post-switch stability policy remains in Phase 3.
"""
from __future__ import annotations

import re
from typing import Any, Protocol

from ..image_refs import image_matches_release


def _strict_json_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


class Runtime(Protocol):
    CANDIDATE_BUILD: Any
    CLEANUP_LOCK_CONFLICT: str
    CLEANUP_LOCK_RETRY_INTERVAL: int
    CLEANUP_LOCK_RETRY_TIMEOUT: int
    FULL_SHA_RE: Any
    PHASE3: Any
    PROJECT: Any
    json: Any
    os: Any
    re: Any
    subprocess: Any
    sys: Any
    time: Any

    def run(self, command: list[str], **kwargs: Any) -> str: ...

    def atomic_json(self, path: Any, payload: dict[str, Any]) -> None: ...

    def utc_now(self) -> str: ...

    def cleanup_after_pi5_stability(self) -> None: ...

    def read_verified_pi5_release(self, sha: str | None = None) -> dict[str, Any] | None: ...

    def release_images_for_sha(
        self, release: dict[str, Any], sha: str
    ) -> dict[str, str] | None: ...

    def phase3_matches_release_images(
        self, phase3: Any, images: dict[str, str]
    ) -> bool: ...

    def verify_pi5_live_migrations(self, sha: str) -> str: ...

    def reconcile_pi5_candidate_workload(self) -> None: ...

    def phase3_status(
        self,
        *,
        structural_only: bool = False,
        recovery_run_id: str | None = None,
    ) -> dict[str, Any]: ...

    def normalized_pi5_phase3_state(self, phase3: dict[str, Any]) -> bool: ...

    def recover_expired_pi5_handoff(self, state: Any) -> bool: ...

    def pi5_already_current(self, sha: str) -> bool: ...

    def phase3_release(self, sha: str, state: Any) -> None: ...

    def wait_for_pi5_stability(self, state: Any) -> None: ...

def phase3_release(sha: str, state: Any, *, runtime: Runtime) -> None:
    run_id = state.payload.get("runId")
    if not isinstance(run_id, str) or runtime.re.fullmatch(
        r"[A-Za-z0-9][A-Za-z0-9_-]{2,79}", run_id
    ) is None:
        raise RuntimeError("Pi5 release requires a well-formed coordinator run ID")
    if not isinstance(sha, str) or runtime.FULL_SHA_RE.fullmatch(sha) is None:
        raise RuntimeError("Pi5 release requires a full desired Git SHA")

    run_directory = runtime.PROJECT / "logs/deploy/runs" / run_id
    migration_plan = run_directory / "pi5-migration-plan.json"
    resource_evidence = run_directory / "pi5-resource-evidence.json"
    migration_planner = runtime.PROJECT / "scripts/deploy/pi5-migration-plan.sh"

    state.payload["pi5"] = {"state": "migration-planning", "sha": sha}
    state.save()
    runtime.run(
        [
            str(migration_planner),
            "--ref",
            sha,
            "--run-id",
            run_id,
            "--output",
            str(migration_plan),
        ]
    )
    state.payload["pi5"] = {
        "state": "migration-plan-ready",
        "sha": sha,
        "migrationPlan": str(migration_plan),
    }
    state.save()

    runtime.run(
        [
            str(runtime.CANDIDATE_BUILD),
            "--ref",
            sha,
            "--run-id",
            run_id,
            "--resource-evidence",
            str(resource_evidence),
        ]
    )
    try:
        candidate_state = runtime.json.loads(
            (runtime.PROJECT / "logs/deploy/pi5-image-deploy-state.json").read_text(
                encoding="utf-8"
            ),
            object_pairs_hook=_strict_json_object,
        )
    except Exception as error:
        raise RuntimeError("Pi5 candidate state is unavailable or malformed") from error
    if not isinstance(candidate_state, dict):
        raise RuntimeError("Pi5 candidate state is unavailable or malformed")
    candidate = candidate_state.get("candidate")
    image_ids = candidate.get("imageIds") if isinstance(candidate, dict) else None
    evidence_reference = (
        candidate_state.get("resourceEvidence")
        if isinstance(candidate_state, dict)
        else None
    )
    if (
        candidate_state.get("event") != "prepared"
        or candidate_state.get("runId") != run_id
        or candidate_state.get("desiredSha") != sha
        or not isinstance(candidate, dict)
        or not candidate_image_matches_sha(candidate.get("api"), sha, runtime=runtime)
        or not candidate_image_matches_sha(candidate.get("web"), sha, runtime=runtime)
        or not isinstance(image_ids, dict)
        or runtime.re.fullmatch(r"sha256:[0-9a-f]{64}", str(image_ids.get("api", ""))) is None
        or runtime.re.fullmatch(r"sha256:[0-9a-f]{64}", str(image_ids.get("web", ""))) is None
        or not isinstance(evidence_reference, dict)
        or evidence_reference.get("path") != str(resource_evidence)
    ):
        raise RuntimeError("Pi5 candidate state does not match the exact release run")
    state.payload["pi5"] = {
        "state": "candidate-ready",
        "sha": sha,
        "candidate": candidate,
        "migrationPlan": str(migration_plan),
        "resourceEvidence": str(resource_evidence),
    }
    state.save()
    runtime.run(
        [
            str(runtime.PHASE3),
            "prepare",
            "--api-image",
            candidate["api"],
            "--web-image",
            candidate["web"],
            "--run-id",
            run_id,
            "--migration-plan",
            str(migration_plan),
            "--resource-evidence",
            str(resource_evidence),
        ]
    )
    state.payload["pi5"]["state"] = "switching"
    state.save()
    runtime.run([str(runtime.PHASE3), "switch"])
    state.payload["pi5"] = {
        "candidate": candidate,
        "state": "stability-monitoring",
        "sha": sha,
        "migrationPlan": str(migration_plan),
        "resourceEvidence": str(resource_evidence),
    }
    state.save()


def wait_for_pi5_stability(state: Any, *, runtime: Runtime) -> None:
    # Keep the monitor in the coordinator-owned foreground. The executor may
    # persist failure evidence, but it never decides or performs switchback.
    runtime.run([str(runtime.PHASE3), "monitor"])
    # Reaching the monitor deadline commits the workflow to forward-only,
    # resumable cleanup. A scheduler leadership change in the small interval
    # before status observation must not be reclassified as rollback failure.
    state.payload["pi5"]["state"] = "cleanup"
    state.save()
    phase3 = runtime.json.loads(
        runtime.run([str(runtime.PHASE3), "status"], capture=True)
    )
    if phase3.get("runtimeStatus") != "consistent":
        raise RuntimeError("Pi5 Blue/Green monitor reported inconsistent state")
    stable_until = phase3.get("stableUntil")
    if isinstance(stable_until, int) and stable_until > int(runtime.time.time()):
        raise RuntimeError("Pi5 Blue/Green monitor returned before the stability window ended")
    runtime.cleanup_after_pi5_stability()
    state.payload["pi5"]["state"] = "stable"
    state.save()


def cleanup_after_pi5_stability(*, runtime: Runtime) -> None:
    deadline = runtime.time.monotonic() + runtime.CLEANUP_LOCK_RETRY_TIMEOUT
    while True:
        try:
            stdout = runtime.run([str(runtime.PHASE3), "cleanup"], capture=True)
            if stdout:
                print(stdout, end="" if stdout.endswith("\n") else "\n")
            return
        except runtime.subprocess.CalledProcessError as error:
            stdout = error.stdout or ""
            stderr = error.stderr or ""
            if stdout:
                print(stdout, end="" if stdout.endswith("\n") else "\n")
            if stderr:
                print(stderr, end="" if stderr.endswith("\n") else "\n", file=runtime.sys.stderr)
            if runtime.CLEANUP_LOCK_CONFLICT not in stderr:
                raise
            if runtime.time.monotonic() >= deadline:
                raise RuntimeError(
                    f"Pi5 cleanup remained locked for {runtime.CLEANUP_LOCK_RETRY_TIMEOUT}s after stability monitoring"
                ) from error
            phase3 = runtime.json.loads(
                runtime.run([str(runtime.PHASE3), "status"], capture=True)
            )
            if phase3.get("runtimeStatus") != "consistent":
                raise RuntimeError(
                    "Pi5 Blue/Green state became inconsistent while waiting to clean up"
                ) from error
            stable_until = phase3.get("stableUntil")
            if isinstance(stable_until, int) and stable_until > int(runtime.time.time()):
                raise RuntimeError("Pi5 stability window resumed while waiting to clean up") from error
            runtime.time.sleep(
                min(
                    runtime.CLEANUP_LOCK_RETRY_INTERVAL,
                    max(1, deadline - runtime.time.monotonic()),
                )
            )


def candidate_image_matches_sha(image: Any, sha: str, *, runtime: Runtime) -> bool:
    return bool(
        isinstance(sha, str)
        and runtime.FULL_SHA_RE.fullmatch(sha)
        and image_matches_release(image, sha)
    )


def release_images_for_sha(
    release: dict[str, Any], sha: str, *, runtime: Runtime
) -> dict[str, str] | None:
    images = release.get("images")
    if not isinstance(images, dict):
        return None
    api, web = images.get("api"), images.get("web")
    if not candidate_image_matches_sha(api, sha, runtime=runtime) or not candidate_image_matches_sha(
        web, sha, runtime=runtime
    ):
        return None
    return {"api": api, "web": web}


def phase3_matches_release_images(phase3: Any, release_images: dict[str, str]) -> bool:
    if (
        not isinstance(phase3, dict)
        or phase3.get("runtimeStatus") != "consistent"
        or phase3.get("liveHealthStatus") != "verified"
        or phase3.get("runtimeConfigStatus") != "verified"
        or not isinstance(phase3.get("runtimeConfigDigest"), str)
        or re.fullmatch(
            r"sha256:[0-9a-f]{64}", phase3["runtimeConfigDigest"]
        )
        is None
    ):
        return False
    active_slot = phase3.get("activeSlot")
    if active_slot not in {"blue", "green"}:
        return False
    gateway = phase3.get("gateway")
    if (
        not isinstance(gateway, dict)
        or gateway.get("mode") != "application"
        or gateway.get("slot") != active_slot
    ):
        return False
    slots = phase3.get("slots")
    active = slots.get(active_slot) if isinstance(slots, dict) else None
    images = active.get("images") if isinstance(active, dict) else None
    image_ids = active.get("imageIds") if isinstance(active, dict) else None
    return (
        isinstance(images, dict)
        and images.get("api") == release_images["api"]
        and images.get("web") == release_images["web"]
        and isinstance(image_ids, dict)
        and re.fullmatch(r"sha256:[0-9a-f]{64}", str(image_ids.get("api", ""))) is not None
        and re.fullmatch(r"sha256:[0-9a-f]{64}", str(image_ids.get("web", ""))) is not None
    )


def phase3_migration_matches_release(phase3: Any, sha: str) -> bool:
    migration = phase3.get("migration") if isinstance(phase3, dict) else None
    return bool(
        isinstance(migration, dict)
        and migration.get("status") == "applied"
        and migration.get("candidateCommit") == sha
        and isinstance(migration.get("appliedAt"), str)
        and migration.get("appliedAt")
    )


def pi5_already_current(sha: str, *, runtime: Runtime) -> bool:
    if not isinstance(sha, str) or not runtime.FULL_SHA_RE.fullmatch(sha):
        return False
    release = runtime.read_verified_pi5_release(sha)
    if not isinstance(release, dict) or release.get("sha") != sha:
        return False
    release_images = runtime.release_images_for_sha(release, sha)
    if release_images is None:
        return False
    try:
        phase3 = runtime.json.loads(runtime.run([str(runtime.PHASE3), "status"], capture=True))
        if not runtime.phase3_matches_release_images(phase3, release_images):
            return False
        if not phase3_migration_matches_release(phase3, sha):
            return False
        migration_digest = runtime.verify_pi5_live_migrations(sha)
    except Exception:
        return False
    return re.fullmatch(r"sha256:[0-9a-f]{64}", migration_digest) is not None


def _prior_handoff_recovery_environment(
    run_id: Any, *, runtime: Runtime
) -> dict[str, str]:
    if not isinstance(run_id, str) or runtime.re.fullmatch(
        r"[A-Za-z0-9][A-Za-z0-9_-]{2,79}", run_id
    ) is None:
        raise RuntimeError("prior-handoff recovery run ID is malformed")
    environment = runtime.os.environ.copy()
    environment["PI5_PRIOR_HANDOFF_RECOVERY_RUN_ID"] = run_id
    return environment


def phase3_status(
    *,
    runtime: Runtime,
    structural_only: bool = False,
    recovery_run_id: str | None = None,
) -> dict[str, Any]:
    command = [str(runtime.PHASE3), "status"]
    options: dict[str, Any] = {"capture": True}
    if structural_only:
        options["env"] = _prior_handoff_recovery_environment(
            recovery_run_id, runtime=runtime
        )
    elif recovery_run_id is not None:
        raise RuntimeError("recovery run ID is valid only for structural status")
    payload = runtime.json.loads(runtime.run(command, **options))
    if not isinstance(payload, dict):
        raise RuntimeError("Pi5 Blue/Green status is malformed")
    return payload


def normalized_pi5_phase3_state(phase3: dict[str, Any]) -> bool:
    active = phase3.get("activeSlot")
    gateway = phase3.get("gateway")
    monitor = phase3.get("monitor")
    slots = phase3.get("slots")
    active_state = slots.get(active) if isinstance(slots, dict) and isinstance(active, str) else None
    images = active_state.get("images") if isinstance(active_state, dict) else None
    image_ids = active_state.get("imageIds") if isinstance(active_state, dict) else None
    return bool(
        phase3.get("runtimeStatus") == "consistent"
        and phase3.get("liveHealthStatus") == "verified"
        and active in {"blue", "green"}
        and phase3.get("previousSlot") is None
        and phase3.get("candidateSlot") is None
        and phase3.get("stableUntil") is None
        and phase3.get("retiredImages") is None
        and isinstance(gateway, dict)
        and gateway.get("mode") == "application"
        and gateway.get("slot") == active
        and isinstance(monitor, dict)
        and monitor.get("activeSlot") is None
        and monitor.get("rollbackSlot") is None
        and isinstance(images, dict)
        and isinstance(images.get("api"), str)
        and bool(images.get("api"))
        and isinstance(images.get("web"), str)
        and bool(images.get("web"))
        and isinstance(image_ids, dict)
        and re.fullmatch(r"sha256:[0-9a-f]{64}", str(image_ids.get("api", ""))) is not None
        and re.fullmatch(r"sha256:[0-9a-f]{64}", str(image_ids.get("web", ""))) is not None
    )


def recover_expired_pi5_handoff(state: Any, *, runtime: Runtime) -> bool:
    """Take over every durable, non-terminal Phase 3 boundary.

    A new checkout/config convergence may intentionally differ from the old
    active container. Recovery therefore uses structural runtime evidence, but
    never treats an unobserved part of the five-minute window as successful.
    """
    recovery_run_id = state.payload.get("runId")
    recovery_environment = _prior_handoff_recovery_environment(
        recovery_run_id, runtime=runtime
    )
    # Candidate validation and signage pause ownership live outside the
    # Blue/Green state. Reconcile them even when Phase 3 itself is normalized.
    runtime.reconcile_pi5_candidate_workload()
    # PR6 adds immutable Docker image IDs to the existing schema-v2 state. The
    # one-time mutating adapter verifies every referenced live slot against its
    # durable tag before sealing IDs, so the following observation can remain
    # strictly fail-closed without making `status` itself write state.
    runtime.run(
        [str(runtime.PHASE3), "seal-image-ids"], env=recovery_environment
    )

    def recovery_status() -> dict[str, Any]:
        observed = _switchback_status(state, runtime=runtime)
        if observed is None:
            raise RuntimeError("Pi5 Blue/Green recovery status is unavailable or malformed")
        return observed

    def record_recovery(
        recovery_state: str,
        *,
        active_slot: Any,
        previous_slot: Any = None,
    ) -> None:
        evidence: dict[str, Any] = {
            "state": recovery_state,
            "activeSlot": active_slot,
            "completedAt": runtime.utc_now(),
        }
        if previous_slot is not None:
            evidence["previousSlot"] = previous_slot
        state.payload["pi5HandoffRecovery"] = evidence
        state.save()

    def cleanup_and_verify(
        recovery_state: str,
        *,
        active_slot: Any,
        previous_slot: Any = None,
    ) -> bool:
        runtime.run([str(runtime.PHASE3), "cleanup"], env=recovery_environment)
        if not runtime.normalized_pi5_phase3_state(recovery_status()):
            raise RuntimeError(
                "Pi5 recovery cleanup did not produce a normalized Phase 3 state"
            )
        record_recovery(
            recovery_state,
            active_slot=active_slot,
            previous_slot=previous_slot,
        )
        return True

    def recover_switchback(current: dict[str, Any], source_event: str) -> bool:
        authority, target = _switchback_authority(current)
        if authority == "required" and target in {"blue", "green"}:
            reason = f"coordinator takeover after interrupted {source_event}"
            runtime.run(
                [str(runtime.PHASE3), "rollback", "--reason", reason],
                env=recovery_environment,
            )
        elif authority != "already-complete" or target not in {"blue", "green"}:
            raise RuntimeError(
                "Pi5 interrupted handoff lacks complete durable switchback authority"
            )
        rolled_back = recovery_status()
        gateway = rolled_back.get("gateway")
        if (
            rolled_back.get("event") != "rolled-back"
            or rolled_back.get("runtimeStatus") != "consistent"
            or rolled_back.get("activeSlot") != target
            or rolled_back.get("stableUntil") is not None
            or not isinstance(gateway, dict)
            or gateway.get("mode") != "application"
            or gateway.get("slot") != target
        ):
            raise RuntimeError("Pi5 takeover switchback lacks exact live evidence")
        return cleanup_and_verify(
            "interrupted-handoff-rolled-back",
            active_slot=target,
            previous_slot=rolled_back.get("previousSlot"),
        )

    phase3 = recovery_status()
    if phase3.get("state") == "not-initialized":
        return False

    active = phase3.get("activeSlot")
    previous = phase3.get("previousSlot")
    candidate = phase3.get("candidateSlot")
    stable_until = phase3.get("stableUntil")
    event = phase3.get("event")
    gateway = phase3.get("gateway")
    monitor = phase3.get("monitor")

    if event in {"bootstrap-preparing", "bootstrapping", "bootstrap-failed"}:
        runtime.run(
            [str(runtime.PHASE3), "reconcile"], env=recovery_environment
        )
        phase3 = recovery_status()
        event = phase3.get("event")
        gateway = phase3.get("gateway")
    if event == "legacy-restored":
        legacy = phase3.get("legacy")
        legacy_api = legacy.get("api") if isinstance(legacy, dict) else None
        legacy_web = legacy.get("web") if isinstance(legacy, dict) else None
        if (
            phase3.get("activeSlot") is not None
            or phase3.get("candidateSlot") is not None
            or phase3.get("previousSlot") is not None
            or not isinstance(gateway, dict)
            or gateway.get("mode") != "offline"
            or gateway.get("slot") is not None
            or not isinstance(legacy_api, dict)
            or legacy_api.get("removed") is not False
            or legacy_api.get("quarantined") is not False
            or not isinstance(legacy_web, dict)
            or legacy_web.get("removed") is not False
            or legacy_web.get("quarantined") is not False
            or legacy_web.get("maintenance") is not False
        ):
            raise RuntimeError(
                "Pi5 interrupted bootstrap did not restore exact legacy authority"
            )
        record_recovery("interrupted-bootstrap-restored", active_slot="legacy")
        raise RuntimeError(
            "Pi5 interrupted bootstrap restored legacy runtime; explicit bootstrap approval is required"
        )

    if event in {"switching", "switch-failed", "monitor-failed", "rolled-back"}:
        return recover_switchback(phase3, str(event))

    if event in {"preparing", "prepare-failed", "prepared", "candidate-prepared"}:
        if (
            phase3.get("runtimeStatus") != "consistent"
            or active not in {"blue", "green"}
            or candidate not in {"blue", "green"}
            or candidate == active
            or previous is not None
            or stable_until is not None
            or not isinstance(gateway, dict)
            or gateway.get("mode") != "application"
            or gateway.get("slot") != active
            or not isinstance(monitor, dict)
            or monitor.get("activeSlot") is not None
            or monitor.get("rollbackSlot") is not None
        ):
            raise RuntimeError("Pi5 prepared candidate recovery state is incomplete or unsafe")
        print("Pi5 candidate preparation was interrupted; discarding it before new planning")
        return cleanup_and_verify(
            "prepared-candidate-discarded", active_slot=active
        )

    if event == "cleanup-handoff":
        if (
            phase3.get("runtimeStatus") != "consistent"
            or phase3.get("liveHealthStatus") != "verified"
            or active not in {"blue", "green"}
            or previous not in {"blue", "green"}
            or candidate != previous
            or previous == active
            or stable_until is not None
            or not isinstance(gateway, dict)
            or gateway.get("mode") != "application"
            or gateway.get("slot") != active
            or not isinstance(monitor, dict)
            or monitor.get("activeSlot") is not None
            or monitor.get("rollbackSlot") is not None
        ):
            raise RuntimeError("Pi5 resumable cleanup handoff is malformed")
        print("Pi5 cleanup handoff is incomplete; resuming idempotent cleanup")
        return cleanup_and_verify(
            "cleanup-handoff-resumed",
            active_slot=active,
            previous_slot=previous,
        )

    has_prior_handoff = previous is not None or candidate is not None or stable_until is not None
    if not has_prior_handoff:
        if phase3.get("runtimeStatus") != "consistent":
            raise RuntimeError("Pi5 Blue/Green state is not consistent before release preflight")
        if runtime.normalized_pi5_phase3_state(phase3):
            return False
        raise RuntimeError("Pi5 Phase 3 state is not normalized before release preflight")

    if (
        active not in {"blue", "green"}
        or previous not in {"blue", "green"}
        or candidate != previous
        or previous == active
        or not isinstance(stable_until, int)
        or not isinstance(gateway, dict)
        or gateway.get("mode") != "application"
        or gateway.get("slot") != active
        or not isinstance(monitor, dict)
        or monitor.get("activeSlot") != active
        or monitor.get("rollbackSlot") != previous
    ):
        raise RuntimeError("Pi5 prior handoff state is incomplete or unsafe; refusing preflight cleanup")
    if event == "monitor-passed":
        if (
            phase3.get("runtimeStatus") != "consistent"
            or phase3.get("liveHealthStatus") != "verified"
        ):
            raise RuntimeError(
                "Pi5 completed monitor state lacks exact live cleanup authority"
            )
        if stable_until > int(runtime.time.time()):
            raise RuntimeError("Pi5 monitor completion predates its stability deadline")
        print("Pi5 durable stability evidence is complete; resuming cleanup")
        return cleanup_and_verify(
            "monitor-passed-cleaned",
            active_slot=active,
            previous_slot=previous,
        )

    if event not in {"active", "reconciled"}:
        raise RuntimeError("Pi5 prior handoff event has no safe recovery policy")
    if phase3.get("runtimeStatus") != "consistent":
        return recover_switchback(phase3, str(event))

    print("Pi5 stability monitor was interrupted; restarting a continuous five-minute hold")
    runtime.run([str(runtime.PHASE3), "restart-monitor"], env=recovery_environment)
    try:
        runtime.run([str(runtime.PHASE3), "monitor"], env=recovery_environment)
    except Exception:
        failed = recovery_status()
        if failed.get("event") == "monitor-failed":
            return recover_switchback(failed, "monitor-failed")
        raise
    completed = recovery_status()
    if (
        completed.get("event") != "monitor-passed"
        or completed.get("runtimeStatus") != "consistent"
        or completed.get("activeSlot") != active
        or completed.get("previousSlot") != previous
    ):
        raise RuntimeError("Pi5 restarted monitor lacks durable completion evidence")
    return cleanup_and_verify(
        "interrupted-window-reverified",
        active_slot=active,
        previous_slot=previous,
    )


def _switchback_status(state: Any, *, runtime: Runtime) -> dict[str, Any] | None:
    run_id = state.payload.get("runId")
    try:
        environment = _prior_handoff_recovery_environment(run_id, runtime=runtime)
        raw = runtime.run(
            [str(runtime.PHASE3), "status"], capture=True, env=environment
        )
    except runtime.subprocess.CalledProcessError as error:
        # status deliberately exits non-zero when live runtime disagrees with
        # durable state. Its validated JSON still carries switchback authority.
        raw = error.stdout or error.output or ""
    except Exception:
        return None
    try:
        payload = runtime.json.loads(raw, object_pairs_hook=_strict_json_object)
    except Exception:
        return None
    return payload if isinstance(payload, dict) else None


def _switchback_authority(phase3: dict[str, Any]) -> tuple[str, str | None]:
    event = phase3.get("event")
    if event in {"preparing", "prepare-failed", "prepared", "candidate-prepared"}:
        return "not-required", None
    if event == "cleanup-handoff":
        # The five-minute gate completed and scheduler handoff cleanup is a
        # forward-only, resumable transaction. A previous slot may already be
        # stopped or absent and must not be presented as rollback authority.
        return "not-required", None
    if event == "rolled-back":
        active = phase3.get("activeSlot")
        return ("already-complete", active) if active in {"blue", "green"} else ("unknown", None)

    active = phase3.get("activeSlot")
    candidate = phase3.get("candidateSlot")
    previous = phase3.get("previousSlot")
    gateway = phase3.get("gateway")
    slots = phase3.get("slots")
    if (
        active not in {"blue", "green"}
        or candidate not in {"blue", "green"}
        or previous not in {"blue", "green"}
        or active == candidate
        or not isinstance(gateway, dict)
        or gateway.get("mode") != "application"
        or gateway.get("slot") not in {active, candidate, previous}
        or not isinstance(slots, dict)
    ):
        return "unknown", None
    for slot in {active, candidate, previous}:
        record = slots.get(slot)
        images = record.get("images") if isinstance(record, dict) else None
        image_ids = record.get("imageIds") if isinstance(record, dict) else None
        if (
            not isinstance(images, dict)
            or not isinstance(images.get("api"), str)
            or not images.get("api")
            or not isinstance(images.get("web"), str)
            or not images.get("web")
            or not isinstance(image_ids, dict)
            or re.fullmatch(r"sha256:[0-9a-f]{64}", str(image_ids.get("api", ""))) is None
            or re.fullmatch(r"sha256:[0-9a-f]{64}", str(image_ids.get("web", ""))) is None
        ):
            return "unknown", None

    if event in {"switching", "switch-failed"}:
        if previous != active:
            return "unknown", None
        return "required", active
    if event in {"active", "monitor-failed", "reconciled"}:
        if candidate != previous or previous == active:
            return "unknown", None
        return "required", previous
    return "unknown", None


def rollback_pi5_runtime(state: Any, reason: str, *, runtime: Runtime) -> str:
    pi5_state = state.payload.get("pi5")
    if not isinstance(pi5_state, dict):
        pi5_state = {}
        state.payload["pi5"] = pi5_state
    if pi5_state.get("rollbackAttempted") is True:
        raise RuntimeError("Pi5 runtime switchback was already attempted for this run")

    phase3 = _switchback_status(state, runtime=runtime)
    if phase3 is None:
        pi5_state.update(
            {"state": "rollback-authority-unknown", "rollbackEvidence": "unknown"}
        )
        state.save()
        raise RuntimeError("Pi5 switchback authority is unavailable or malformed")
    authority, target = _switchback_authority(phase3)
    if authority == "not-required":
        pi5_state.update(
            {"state": "switch-failed-before-cutover", "rollbackEvidence": "not-required"}
        )
        state.save()
        return authority
    if authority == "already-complete":
        pi5_state.update(
            {"state": "rolled-back", "rollbackEvidence": "verified", "rollbackTarget": target}
        )
        state.save()
        return authority
    if authority != "required" or target not in {"blue", "green"}:
        pi5_state.update(
            {"state": "rollback-authority-unknown", "rollbackEvidence": "unknown"}
        )
        state.save()
        raise RuntimeError("Pi5 durable state does not provide complete switchback authority")

    safe_reason = " ".join(str(reason).split())[:240] or "Pi5 release failure"
    pi5_state.update(
        {
            "state": "rolling-back",
            "rollbackAttempted": True,
            "rollbackTarget": target,
            "rollbackEvidence": "pending",
        }
    )
    state.save()
    try:
        runtime.run([str(runtime.PHASE3), "rollback", "--reason", safe_reason])
    except Exception as error:
        pi5_state.update({"state": "rollback-failed", "rollbackEvidence": "unknown"})
        state.save()
        raise RuntimeError("Pi5 runtime switchback command failed") from error

    verified = _switchback_status(state, runtime=runtime)
    gateway = verified.get("gateway") if isinstance(verified, dict) else None
    if (
        not isinstance(verified, dict)
        or verified.get("event") != "rolled-back"
        or verified.get("runtimeStatus") != "consistent"
        or verified.get("activeSlot") != target
        or verified.get("stableUntil") is not None
        or not isinstance(gateway, dict)
        or gateway.get("mode") != "application"
        or gateway.get("slot") != target
    ):
        pi5_state.update({"state": "rollback-unverified", "rollbackEvidence": "unknown"})
        state.save()
        raise RuntimeError("Pi5 runtime switchback completed without exact live evidence")
    try:
        runtime.run([str(runtime.PHASE3), "cleanup"])
    except Exception as error:
        pi5_state.update({"state": "rollback-cleanup-failed", "rollbackEvidence": "unknown"})
        state.save()
        raise RuntimeError("Pi5 runtime switchback cleanup failed") from error
    normalized = _switchback_status(state, runtime=runtime)
    normalized_gateway = (
        normalized.get("gateway") if isinstance(normalized, dict) else None
    )
    if (
        not isinstance(normalized, dict)
        or normalized.get("event") != "rollback-cleaned"
        or normalized.get("runtimeStatus") != "consistent"
        or normalized.get("activeSlot") != target
        or normalized.get("candidateSlot") is not None
        or normalized.get("previousSlot") is not None
        or normalized.get("stableUntil") is not None
        or not isinstance(normalized_gateway, dict)
        or normalized_gateway.get("mode") != "application"
        or normalized_gateway.get("slot") != target
    ):
        pi5_state.update({"state": "rollback-cleanup-unverified", "rollbackEvidence": "unknown"})
        state.save()
        raise RuntimeError("Pi5 runtime switchback cleanup lacks exact live evidence")
    pi5_state.update({"state": "rolled-back", "rollbackEvidence": "verified"})
    state.save()
    return "verified"


def ensure_pi5_release(sha: str, state: Any, *, runtime: Runtime) -> None:
    runtime.recover_expired_pi5_handoff(state)
    if runtime.pi5_already_current(sha):
        state.payload["pi5"] = {"state": "already-current", "sha": sha}
        state.save()
        return
    try:
        runtime.phase3_release(sha, state)
        runtime.wait_for_pi5_stability(state)
    except Exception as release_error:
        pi5_state = state.payload.get("pi5")
        stage = pi5_state.get("state") if isinstance(pi5_state, dict) else None
        if stage not in {"switching", "stability-monitoring"}:
            raise
        try:
            outcome = rollback_pi5_runtime(
                state, f"Pi5 release failure: {release_error}", runtime=runtime
            )
        except Exception as rollback_error:
            raise RuntimeError(
                f"Pi5 release failed and runtime switchback is unverified: {rollback_error}"
            ) from release_error
        if outcome == "not-required":
            raise RuntimeError(
                f"Pi5 release failed before public cutover: {release_error}"
            ) from release_error
        raise RuntimeError(
            f"Pi5 release failed; runtime switchback is verified: {release_error}"
        ) from release_error
