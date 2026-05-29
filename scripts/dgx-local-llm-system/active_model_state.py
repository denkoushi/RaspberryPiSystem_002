from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from model_profiles import ModelProfile
from profile_capabilities import capabilities_to_api


@dataclass(frozen=True)
class ActiveModelState:
    model_profile_id: str
    display_name_ja: str
    backend: str
    served_alias: str
    source_model_ref: str | None
    model_family: str | None
    updated_at: str
    declared_capabilities: tuple[str, ...] = ("text",)
    runtime_ready_capabilities: tuple[str, ...] = ("text",)
    vision_ready_reason: str | None = None


def state_from_profile(
    profile: ModelProfile,
    *,
    runtime_ready_capabilities: tuple[str, ...] | None = None,
    vision_ready_reason: str | None = None,
) -> ActiveModelState:
    ready = runtime_ready_capabilities if runtime_ready_capabilities is not None else profile.declared_capabilities
    return ActiveModelState(
        model_profile_id=profile.id,
        display_name_ja=profile.display_name_ja,
        backend=profile.backend,
        served_alias=profile.served_alias,
        source_model_ref=profile.source_model_ref,
        model_family=profile.model_family,
        updated_at=datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        declared_capabilities=profile.declared_capabilities,
        runtime_ready_capabilities=ready,
        vision_ready_reason=vision_ready_reason,
    )


def active_model_state_to_api(state: ActiveModelState) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "activeProfileId": state.model_profile_id,
        "modelProfileId": state.model_profile_id,
        "displayNameJa": state.display_name_ja,
        "backend": state.backend,
        "servedAlias": state.served_alias,
        "stateUpdatedAt": state.updated_at,
        "declaredCapabilities": capabilities_to_api(state.declared_capabilities),
        "runtimeReadyCapabilities": capabilities_to_api(state.runtime_ready_capabilities),
    }
    if state.source_model_ref:
        payload["sourceModelRef"] = state.source_model_ref
    if state.model_family:
        payload["modelFamily"] = state.model_family
    if state.vision_ready_reason:
        payload["visionReadyReason"] = state.vision_ready_reason
    return payload


def write_active_model_state(
    path: str,
    profile: ModelProfile,
    *,
    runtime_ready_capabilities: tuple[str, ...] | None = None,
    vision_ready_reason: str | None = None,
) -> ActiveModelState:
    state = state_from_profile(
        profile,
        runtime_ready_capabilities=runtime_ready_capabilities,
        vision_ready_reason=vision_ready_reason,
    )
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_suffix(target.suffix + ".tmp")
    tmp.write_text(json.dumps(active_model_state_to_api(state), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(target)
    return state


def _parse_capabilities_list(value: Any) -> tuple[str, ...]:
    if not isinstance(value, list):
        return ("text",)
    out: list[str] = []
    for item in value:
        if isinstance(item, str) and item.strip() and item not in out:
            out.append(item.strip())
    return tuple(out) if out else ("text",)


def read_active_model_state(path: str) -> ActiveModelState | None:
    target = Path(path)
    if not target.exists():
        return None
    body = json.loads(target.read_text(encoding="utf-8"))
    if not isinstance(body, dict):
        return None
    profile_id = body.get("modelProfileId") or body.get("activeProfileId")
    display_name = body.get("displayNameJa")
    backend = body.get("backend")
    served_alias = body.get("servedAlias")
    updated_at = body.get("stateUpdatedAt") or body.get("updatedAt")
    if not all(isinstance(v, str) and v for v in [profile_id, display_name, backend, served_alias, updated_at]):
        return None
    if backend not in {"green", "blue"}:
        return None
    declared = _parse_capabilities_list(body.get("declaredCapabilities"))
    runtime_ready = _parse_capabilities_list(body.get("runtimeReadyCapabilities"))
    if body.get("runtimeReadyCapabilities") is None:
        runtime_ready = declared
    vision_reason = body.get("visionReadyReason")
    return ActiveModelState(
        model_profile_id=profile_id,
        display_name_ja=display_name,
        backend=backend,
        served_alias=served_alias,
        source_model_ref=body.get("sourceModelRef") if isinstance(body.get("sourceModelRef"), str) else None,
        model_family=body.get("modelFamily") if isinstance(body.get("modelFamily"), str) else None,
        updated_at=updated_at,
        declared_capabilities=declared,
        runtime_ready_capabilities=runtime_ready,
        vision_ready_reason=vision_reason if isinstance(vision_reason, str) and vision_reason else None,
    )
