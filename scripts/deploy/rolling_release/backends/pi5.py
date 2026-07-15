"""Pi5 execution adapter.

PR 4 moves the existing Blue/Green behavior behind this command boundary
without changing its release, migration, health, or rollback policy.  Those
behaviors are deliberately revised only in PR 6.
"""
from __future__ import annotations

import re
from typing import Any, Protocol


class Runtime(Protocol):
    CANDIDATE_BUILD: Any
    CLEANUP_LOCK_CONFLICT: str
    CLEANUP_LOCK_RETRY_INTERVAL: int
    CLEANUP_LOCK_RETRY_TIMEOUT: int
    FULL_SHA_RE: Any
    PHASE3: Any
    PI5_RELEASE_CURRENT: Any
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

    def read_pi5_release_current(self) -> dict[str, Any] | None: ...

    def marker_candidate_for_sha(
        self, marker: dict[str, Any], sha: str
    ) -> dict[str, str] | None: ...

    def phase3_matches_marker_candidate(
        self, phase3: Any, candidate: dict[str, str]
    ) -> bool: ...

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

    def record_pi5_release_current(
        self, sha: str, candidate: dict[str, Any] | None
    ) -> None: ...


def phase3_release(sha: str, state: Any, *, runtime: Runtime) -> None:
    runtime.run([str(runtime.CANDIDATE_BUILD), "--ref", sha])
    candidate = runtime.json.loads(
        (runtime.PROJECT / "logs/deploy/pi5-image-deploy-state.json").read_text(encoding="utf-8")
    )["candidate"]
    runtime.run(
        [
            str(runtime.PHASE3),
            "prepare",
            "--api-image",
            candidate["api"],
            "--web-image",
            candidate["web"],
        ]
    )
    runtime.run([str(runtime.PHASE3), "switch"])
    state.payload["pi5"] = {"candidate": candidate, "state": "stability-monitoring"}
    state.save()


def wait_for_pi5_stability(state: Any, *, runtime: Runtime) -> None:
    while True:
        phase3 = runtime.json.loads(runtime.run([str(runtime.PHASE3), "status"], capture=True))
        if phase3.get("runtimeStatus") != "consistent":
            raise RuntimeError("Pi5 Blue/Green monitor reported inconsistent state")
        stable_until = phase3.get("stableUntil")
        if not isinstance(stable_until, int) or stable_until <= int(runtime.time.time()):
            break
        runtime.time.sleep(min(5, max(1, stable_until - int(runtime.time.time()))))
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


def read_pi5_release_current(*, runtime: Runtime) -> dict[str, Any] | None:
    try:
        payload = runtime.json.loads(runtime.PI5_RELEASE_CURRENT.read_text(encoding="utf-8"))
    except (OSError, runtime.json.JSONDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


def read_plan_pi5_release_current(*, runtime: Runtime) -> tuple[dict[str, Any] | None, list[str]]:
    host = runtime.os.environ.get("RASPI_SERVER_HOST")
    if not host:
        return None, ["Pi5 release marker unavailable: RASPI_SERVER_HOST is required for classification"]
    try:
        result = runtime.subprocess.run(
            [
                "ssh",
                host,
                "cat /opt/RaspberryPiSystem_002/logs/deploy/pi5-release-current.json",
            ],
            check=True,
            text=True,
            capture_output=True,
        )
        payload = runtime.json.loads(result.stdout)
    except Exception as error:
        return None, [f"Pi5 release marker unavailable: {error}"]
    if not isinstance(payload, dict):
        return None, ["Pi5 release marker unavailable: marker is not an object"]
    return payload, []


def record_pi5_release_current(
    sha: str, candidate: dict[str, Any] | None, *, runtime: Runtime
) -> None:
    runtime.atomic_json(
        runtime.PI5_RELEASE_CURRENT,
        {"sha": sha, "candidate": candidate or {}, "completedAt": runtime.utc_now()},
    )


def candidate_image_matches_sha(image: Any, sha: str, *, runtime: Runtime) -> bool:
    if not isinstance(image, str) or not isinstance(sha, str):
        return False
    repository, separator, tag = image.rpartition(":")
    return bool(
        repository
        and separator
        and runtime.FULL_SHA_RE.fullmatch(sha)
        and runtime.re.fullmatch(runtime.re.escape(sha) + r"-[0-9a-f]{12}", tag)
    )


def marker_candidate_for_sha(
    marker: dict[str, Any], sha: str, *, runtime: Runtime
) -> dict[str, str] | None:
    candidate = marker.get("candidate")
    if not isinstance(candidate, dict):
        return None
    api, web = candidate.get("api"), candidate.get("web")
    if not candidate_image_matches_sha(api, sha, runtime=runtime) or not candidate_image_matches_sha(
        web, sha, runtime=runtime
    ):
        return None
    return {"api": api, "web": web}


def phase3_matches_marker_candidate(phase3: Any, candidate: dict[str, str]) -> bool:
    if (
        not isinstance(phase3, dict)
        or phase3.get("runtimeStatus") != "consistent"
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
    return (
        isinstance(images, dict)
        and images.get("api") == candidate["api"]
        and images.get("web") == candidate["web"]
    )


def pi5_already_current(sha: str, *, runtime: Runtime) -> bool:
    if not isinstance(sha, str) or not runtime.FULL_SHA_RE.fullmatch(sha):
        return False
    marker = runtime.read_pi5_release_current()
    if not isinstance(marker, dict) or marker.get("sha") != sha:
        return False
    candidate = runtime.marker_candidate_for_sha(marker, sha)
    if candidate is None:
        return False
    try:
        phase3 = runtime.json.loads(runtime.run([str(runtime.PHASE3), "status"], capture=True))
    except Exception:
        return False
    return runtime.phase3_matches_marker_candidate(phase3, candidate)


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
    return bool(
        phase3.get("runtimeStatus") == "consistent"
        and active in {"blue", "green"}
        and phase3.get("previousSlot") is None
        and phase3.get("candidateSlot") is None
        and phase3.get("stableUntil") is None
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
    )


def recover_expired_pi5_handoff(state: Any, *, runtime: Runtime) -> bool:
    # A new checkout/config convergence may intentionally differ from the old
    # active container.  Prior-release handoff recovery therefore proves only
    # image, scheduler, Web, gateway, and durable-state structure.  Candidate
    # readiness and final fleet evidence still require exact live config.
    recovery_run_id = state.payload.get("runId")
    recovery_environment = _prior_handoff_recovery_environment(
        recovery_run_id, runtime=runtime
    )
    phase3 = runtime.phase3_status(
        structural_only=True, recovery_run_id=recovery_run_id
    )
    if phase3.get("state") == "not-initialized":
        return False
    if phase3.get("runtimeStatus") != "consistent":
        raise RuntimeError("Pi5 Blue/Green state is not consistent before release preflight")

    active = phase3.get("activeSlot")
    previous = phase3.get("previousSlot")
    candidate = phase3.get("candidateSlot")
    stable_until = phase3.get("stableUntil")
    has_prior_handoff = previous is not None or candidate is not None or stable_until is not None
    if not has_prior_handoff:
        if runtime.normalized_pi5_phase3_state(phase3):
            return False
        raise RuntimeError("Pi5 Phase 3 state is not normalized before release preflight")

    gateway = phase3.get("gateway")
    monitor = phase3.get("monitor")
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
    if stable_until > int(runtime.time.time()):
        raise RuntimeError("Pi5 prior stability window is still active; refusing new release preflight")

    print("Pi5 prior handoff is expired and consistent; completing cleanup before new candidate build")
    runtime.run(
        [str(runtime.PHASE3), "cleanup"], env=recovery_environment
    )
    if not runtime.normalized_pi5_phase3_state(
        runtime.phase3_status(
            structural_only=True, recovery_run_id=recovery_run_id
        )
    ):
        raise RuntimeError("Pi5 cleanup did not produce a normalized Phase 3 state")
    state.payload["pi5HandoffRecovery"] = {
        "state": "expired-handoff-cleaned",
        "activeSlot": active,
        "previousSlot": previous,
        "completedAt": runtime.utc_now(),
    }
    state.save()
    return True


def ensure_pi5_release(sha: str, state: Any, *, runtime: Runtime) -> None:
    runtime.recover_expired_pi5_handoff(state)
    if runtime.pi5_already_current(sha):
        state.payload["pi5"] = {"state": "already-current", "sha": sha}
        state.save()
        return
    runtime.phase3_release(sha, state)
    runtime.wait_for_pi5_stability(state)
