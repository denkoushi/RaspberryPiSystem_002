from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
import subprocess
import shlex
import re

from model_profiles import ModelProfile


def verify_rank_stopped(name: str, target: str | None = None) -> None:
    if not re.fullmatch(r"[a-zA-Z0-9_.-]+", name):
        raise RuntimeError("business_runtime_stop_unverified")
    script = ('set -eu; names=$(docker ps --filter name=^/' + name +
              '$ --format {{.ID}}); test -z "$names"; '
              'for port in 38083 8889; do listeners=$(ss -H -ltn "sport = :$port"); test -z "$listeners"; done')
    command = ["bash", "-c", script]
    if target is not None:
        if not re.fullmatch(r"[a-zA-Z0-9_.-]+@[a-zA-Z0-9_.-]+", target):
            raise RuntimeError("business_runtime_stop_unverified")
        command = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "--", target, shlex.join(command)]
    subprocess.run(command, check=True, capture_output=True, text=True, timeout=20)


def verify_blue_stopped(marker_path: str, container: str) -> None:
    marker = json.loads(Path(marker_path).read_text())
    verify_rank_stopped(container)
    # Non-business TensorFold retains its legacy commands, followed by proof.
    name = marker.get("containerName", "dsv41-1017-exl3-tf")
    verify_rank_stopped(name, marker["sshTarget"])
    if marker.get("adapter"):
        # Inspect the private kit's own pid files without changing its commands,
        # paths or logs. An SSH failure cannot clear its recovery marker.
        clone = marker.get("cloneDir")
        if not isinstance(clone, str) or not clone.startswith("/") or "\n" in clone:
            raise RuntimeError("business_runtime_stop_unverified")
        inspect = ["bash", "-eu", "-c", 'cd "$1"; source scripts/config.sh; printf "%s" "$CONTAINER_NAME"', "bash", clone]
        actual_name = subprocess.run(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "--", marker["sshTarget"],
            shlex.join(inspect)], check=True, capture_output=True, text=True, timeout=20).stdout.strip()
        verify_rank_stopped(actual_name)
        verify_rank_stopped(actual_name, marker["sshTarget"])
        command = ["bash", "-eu", "-c", 'cd "$1"; source scripts/config.sh; source scripts/nodes.sh; '
            'test ! -e "$STATE_DIR/start.lock" || flock -n "$STATE_DIR/start.lock" true; '
            'for file in "$STATE_DIR/memguard.pid"; do if test -e "$file"; then '
            'pid=$(cat "$file"); if test -n "$pid" && kill -0 "$pid" 2>/dev/null; then exit 1; fi; fi; done; '
            'worker 1 "if test -e $MEMGUARD_REMOTE_DIR/memguard.pid; then '
            'pid=\\$(cat $MEMGUARD_REMOTE_DIR/memguard.pid); if kill -0 \\$pid 2>/dev/null; then exit 1; fi; fi"',
            "bash", clone]
        subprocess.run(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "--", marker["sshTarget"],
                        shlex.join(command)], check=True, capture_output=True, text=True, timeout=30)


def glm_business_runtime(generation: str) -> dict:
    from business_tensorfold import TARGET
    ranks = []
    for rank, (name, target) in enumerate((("system-prod-trtllm", None), ("system-prod-trtllm-rank1", TARGET))):
        script = ('set -eu; docker info >/dev/null; '
                  'names=$(docker ps --filter name=^/' + name + '$ --format {{.ID}}); running=false; if test -n "$names"; then running=true; fi; '
                  # Docker owns the container processes and their GPU contexts;
                  # private containers may legitimately keep using the GPU.
                  'released=false; if test "$running" = false; then released=true; fi; '
                  'printf "%s\\n%s\\n" "$running" "$released"')
        command = ["bash", "-c", script]
        if target:
            command = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "--", target, shlex.join(command)]
        values = subprocess.run(command, check=True, capture_output=True, text=True, timeout=20).stdout.splitlines()
        if len(values) != 2 or any(v not in {"true", "false"} for v in values):
            raise RuntimeError("business_runtime_status_unavailable")
        ranks.append({"rank": rank, "generation": generation, "running": values[0] == "true", "gpuReleased": values[1] == "true"})
    closed = subprocess.run(["ss", "-H", "-ltn", "sport = :38083"], check=True, capture_output=True, text=True, timeout=8).stdout.strip() == ""
    return {"generation": generation, "prepared": True, "ranks": ranks,
            "launcherStopped": True, "watchdogStopped": True, "apiListenerClosed": closed, "failureReason": None}


ResourceOwner = str
ResourceStatus = str


@dataclass(frozen=True)
class DgxResourceState:
    owner: ResourceOwner
    status: ResourceStatus
    updated_at: str
    action: str
    reason: str | None = None
    model_profile_id: str | None = None
    display_name_ja: str | None = None
    backend: str | None = None
    guarantee_level: str | None = None


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def infer_owner_from_profile(profile: ModelProfile | None, reason: str | None = None) -> ResourceOwner:
    reason_l = (reason or "").lower()
    if "experiment" in reason_l:
        return "experiment"
    if "private" in reason_l or "comfy" in reason_l or "uncensored" in reason_l or "novel" in reason_l:
        return "private"
    if profile is not None:
        return "business" if profile.business_orchestration_eligible else "private"
    if "business" in reason_l or "scenario_guide" in reason_l or "readiness" in reason_l:
        return "business"
    return "unknown"


def state_to_api(state: DgxResourceState) -> dict[str, Any]:
    return {
        "owner": state.owner,
        "status": state.status,
        "updatedAt": state.updated_at,
        "action": state.action,
        "reason": state.reason,
        "modelProfileId": state.model_profile_id,
        "displayNameJa": state.display_name_ja,
        "backend": state.backend,
        "guaranteeLevel": state.guarantee_level,
    }


def write_resource_state(
    path: str,
    *,
    owner: ResourceOwner,
    status: ResourceStatus,
    action: str,
    reason: str | None = None,
    profile: ModelProfile | None = None,
    backend: str | None = None,
    guarantee_level: str | None = None,
) -> DgxResourceState:
    state = DgxResourceState(
        owner=owner,
        status=status,
        updated_at=_now_iso(),
        action=action,
        reason=reason,
        model_profile_id=profile.id if profile is not None else None,
        display_name_ja=profile.display_name_ja if profile is not None else None,
        backend=backend or (profile.backend if profile is not None else None),
        guarantee_level=guarantee_level,
    )
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(state_to_api(state), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return state


def read_resource_state(path: str) -> DgxResourceState | None:
    p = Path(path)
    if not p.exists():
        return None
    try:
        body = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(body, dict):
        return None
    owner = body.get("owner")
    status = body.get("status")
    updated_at = body.get("updatedAt")
    action = body.get("action")
    if not all(isinstance(v, str) and v.strip() for v in (owner, status, updated_at, action)):
        return None
    return DgxResourceState(
        owner=owner,
        status=status,
        updated_at=updated_at,
        action=action,
        reason=body.get("reason") if isinstance(body.get("reason"), str) else None,
        model_profile_id=body.get("modelProfileId") if isinstance(body.get("modelProfileId"), str) else None,
        display_name_ja=body.get("displayNameJa") if isinstance(body.get("displayNameJa"), str) else None,
        backend=body.get("backend") if isinstance(body.get("backend"), str) else None,
        guarantee_level=body.get("guaranteeLevel") if isinstance(body.get("guaranteeLevel"), str) else None,
    )


if __name__ == "__main__":
    import sys
    if sys.argv[1] == "verify-stop":
        verify_blue_stopped(sys.argv[2], sys.argv[3])
    elif sys.argv[1] == "verify-empty":
        from business_tensorfold import TARGET
        verify_rank_stopped(sys.argv[2])
        verify_rank_stopped("system-prod-trtllm-rank1", TARGET)
