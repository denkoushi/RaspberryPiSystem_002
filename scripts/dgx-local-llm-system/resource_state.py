from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from model_profiles import ModelProfile


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
