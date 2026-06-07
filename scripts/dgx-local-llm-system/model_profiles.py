from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from profile_capabilities import (
    capabilities_to_api,
    parse_declared_capabilities,
    parse_launcher_hints,
    parse_vision_requires_mmproj,
)


class ModelProfileError(Exception):
    status_code = 500
    code = "MODEL_PROFILE_ERROR"


class UnknownModelProfileError(ModelProfileError):
    status_code = 400
    code = "UNKNOWN_MODEL_PROFILE"


class DisabledModelProfileError(ModelProfileError):
    status_code = 409
    code = "DISABLED_MODEL_PROFILE"


class UnavailableModelProfileError(ModelProfileError):
    status_code = 503
    code = "UNAVAILABLE_MODEL_PROFILE"


@dataclass(frozen=True)
class ModelProfile:
    id: str
    display_name_ja: str
    backend: str
    served_alias: str
    enabled: bool
    manifest_path: str
    description_ja: str | None = None
    source_model_ref: str | None = None
    source_kind: str | None = None
    storage_location: str | None = None
    current_storage_location: str | None = None
    storage_status: str | None = None
    model_family: str | None = None
    format: str | None = None
    quantization: str | None = None
    expected_size_gb: float | None = None
    expected_cold_start_sec: int | None = None
    recommended: bool = False
    business_orchestration_eligible: bool = True
    canonical_names: tuple[str, ...] = ()
    legacy_names: tuple[str, ...] = ()
    declared_capabilities: tuple[str, ...] = ("text",)
    vision_requires_mmproj: bool = False
    launcher_hints: dict[str, str] = field(default_factory=dict)
    runtime_profile: dict[str, Any] = field(default_factory=dict)


def _string(value: Any) -> str | None:
    return value if isinstance(value, str) and value.strip() else None


def _string_list(value: Any) -> tuple[str, ...]:
    if not isinstance(value, list):
        return ()
    out: list[str] = []
    for item in value:
        if isinstance(item, str) and item.strip():
            out.append(item)
    return tuple(out)


def _number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    return None


def _int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    return None


def _object(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def load_model_profile_manifest(path: Path) -> ModelProfile:
    body = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(body, dict):
        raise ValueError(f"model profile manifest must be an object: {path}")

    profile_id = _string(body.get("modelProfileId")) or _string(body.get("id"))
    display_name = _string(body.get("displayNameJa"))
    backend = (_string(body.get("backend")) or "").lower()
    served_alias = _string(body.get("servedAlias")) or "system-prod-primary"
    if not profile_id:
        raise ValueError(f"model profile id is required: {path}")
    if not display_name:
        raise ValueError(f"displayNameJa is required: {path}")
    if backend not in {"green", "blue"}:
        raise ValueError(f"backend must be green or blue for {profile_id}: {backend}")

    vision_requires_mmproj = parse_vision_requires_mmproj(body, backend)
    declared_capabilities = parse_declared_capabilities(body, backend)
    launcher_hints = parse_launcher_hints(body)
    runtime_profile = _object(body.get("runtimeProfile"))

    return ModelProfile(
        id=profile_id,
        display_name_ja=display_name,
        backend=backend,
        served_alias=served_alias,
        enabled=bool(body.get("enabled", True)),
        manifest_path=str(path),
        description_ja=_string(body.get("descriptionJa")),
        source_model_ref=_string(body.get("sourceModelRef")),
        source_kind=_string(body.get("sourceKind")),
        storage_location=_string(body.get("storageLocation")),
        current_storage_location=_string(body.get("currentStorageLocation")),
        storage_status=_string(body.get("storageStatus")),
        model_family=_string(body.get("modelFamily")),
        format=_string(body.get("format")),
        quantization=_string(body.get("quantization")),
        expected_size_gb=_number(body.get("expectedSizeGb")),
        expected_cold_start_sec=_int(body.get("expectedColdStartSec")),
        recommended=bool(body.get("recommended", False)),
        business_orchestration_eligible=bool(body.get("businessOrchestrationEligible", True)),
        canonical_names=_string_list(body.get("canonicalNames")),
        legacy_names=_string_list(body.get("legacyNames")),
        declared_capabilities=declared_capabilities,
        vision_requires_mmproj=vision_requires_mmproj,
        launcher_hints=launcher_hints,
        runtime_profile=runtime_profile,
    )


def load_model_profiles(registry_root: str) -> list[ModelProfile]:
    root = Path(registry_root)
    if not root.exists():
        return []
    profiles: list[ModelProfile] = []
    for manifest in sorted(root.glob("*/manifest.json")):
        profiles.append(load_model_profile_manifest(manifest))
    return profiles


def find_model_profile(registry_root: str, profile_id: str) -> ModelProfile:
    for profile in load_model_profiles(registry_root):
        if profile.id == profile_id:
            return profile
    raise UnknownModelProfileError(f"unknown modelProfileId: {profile_id}")


def profile_storage_available(profile: ModelProfile) -> bool:
    candidates = [profile.current_storage_location, profile.storage_location]
    existing_candidates = [Path(p) for p in candidates if p]
    if not existing_candidates:
        return True
    return any(p.exists() for p in existing_candidates)


def validate_startable_profile(registry_root: str, profile_id: str) -> ModelProfile:
    profile = find_model_profile(registry_root, profile_id)
    if not profile.enabled:
        raise DisabledModelProfileError(f"modelProfileId is disabled: {profile_id}")
    if not profile_storage_available(profile):
        raise UnavailableModelProfileError(f"modelProfileId storage is unavailable: {profile_id}")
    return profile


def model_profile_to_api(profile: ModelProfile) -> dict[str, Any]:
    status = "available" if profile.enabled and profile_storage_available(profile) else "unavailable"
    payload: dict[str, Any] = {
        "id": profile.id,
        "displayNameJa": profile.display_name_ja,
        "backend": profile.backend,
        "servedAlias": profile.served_alias,
        "recommended": profile.recommended,
        "businessOrchestrationEligible": profile.business_orchestration_eligible,
        "enabled": profile.enabled,
        "canonicalNames": list(profile.canonical_names),
        "legacyNames": list(profile.legacy_names),
        "status": status,
    }
    payload["declaredCapabilities"] = capabilities_to_api(profile.declared_capabilities)
    payload["visionRequiresMmproj"] = profile.vision_requires_mmproj
    if profile.launcher_hints:
        payload["launcherHints"] = dict(profile.launcher_hints)
    if profile.runtime_profile:
        payload["runtimeProfile"] = dict(profile.runtime_profile)

    optional = {
        "descriptionJa": profile.description_ja,
        "sourceModelRef": profile.source_model_ref,
        "sourceKind": profile.source_kind,
        "storageLocation": profile.storage_location,
        "currentStorageLocation": profile.current_storage_location,
        "storageStatus": profile.storage_status,
        "modelFamily": profile.model_family,
        "format": profile.format,
        "quantization": profile.quantization,
        "expectedSizeGb": profile.expected_size_gb,
        "expectedColdStartSec": profile.expected_cold_start_sec,
    }
    for key, value in optional.items():
        if value is not None:
            payload[key] = value
    if status == "unavailable":
        payload["unavailableReasonJa"] = "モデルの保存先が見つからないか、無効化されています"
    return payload
