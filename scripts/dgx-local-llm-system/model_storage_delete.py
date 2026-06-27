from __future__ import annotations

import hashlib
import json
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from model_profiles import ModelProfile


DEFAULT_MODEL_STORAGE_DELETE_ALLOWED_ROOTS = (
    "/srv/dgx/shared-models",
    "/srv/dgx/hf-cache",
    "/srv/dgx/.cache/huggingface",
    "/home/dgx/.cache/huggingface",
    "/root/.cache/huggingface",
)


@dataclass(frozen=True)
class DeleteBlockReason:
    code: str
    detail_ja: str


@dataclass(frozen=True)
class ModelStorageDeletePlan:
    model_profile_id: str
    display_name_ja: str
    storage_path: str | None
    resolved_storage_path: str | None
    can_delete: bool
    blocked_reasons: tuple[DeleteBlockReason, ...]
    required_confirmation: str
    plan_fingerprint: str | None = None
    size_bytes: int | None = None
    file_count: int | None = None
    directory_count: int | None = None


class ModelStorageDeleteError(Exception):
    status_code = 400
    code = "MODEL_STORAGE_DELETE_ERROR"


class ModelStorageDeleteBlockedError(ModelStorageDeleteError):
    status_code = 409
    code = "MODEL_STORAGE_DELETE_BLOCKED"


class ModelStorageDeleteFingerprintMismatchError(ModelStorageDeleteError):
    status_code = 409
    code = "MODEL_STORAGE_DELETE_FINGERPRINT_MISMATCH"


class ModelStorageDeleteConfirmationError(ModelStorageDeleteError):
    status_code = 400
    code = "MODEL_STORAGE_DELETE_CONFIRMATION_REQUIRED"


def parse_allowed_roots(raw: str | None) -> tuple[str, ...]:
    if not raw or not raw.strip():
        return DEFAULT_MODEL_STORAGE_DELETE_ALLOWED_ROOTS
    roots = [part.strip() for part in raw.split(":") if part.strip()]
    return tuple(roots) if roots else DEFAULT_MODEL_STORAGE_DELETE_ALLOWED_ROOTS


def _candidate_storage_path(profile: ModelProfile) -> str | None:
    return profile.current_storage_location or profile.storage_location


def _is_relative_to(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def _resolve_allowed_roots(allowed_roots: tuple[str, ...]) -> tuple[Path, ...]:
    roots: list[Path] = []
    for root in allowed_roots:
        try:
            roots.append(Path(root).expanduser().resolve(strict=False))
        except OSError:
            continue
    return tuple(roots)


def _path_within_allowed_roots(path: Path, allowed_roots: tuple[str, ...]) -> bool:
    resolved_roots = _resolve_allowed_roots(allowed_roots)
    return any(_is_relative_to(path, root) for root in resolved_roots)


def _shared_storage_profile_ids(
    profile: ModelProfile,
    all_profiles: list[ModelProfile],
    resolved_path: Path,
) -> tuple[str, ...]:
    shared: list[str] = []
    for other in all_profiles:
        if other.id == profile.id:
            continue
        raw = _candidate_storage_path(other)
        if not raw:
            continue
        try:
            if Path(raw).expanduser().resolve(strict=False) == resolved_path:
                shared.append(other.id)
        except OSError:
            continue
    return tuple(sorted(shared))


def _collect_storage_size(path: Path) -> tuple[int, int, int]:
    if path.is_file():
        return path.stat().st_size, 1, 0
    size_bytes = 0
    file_count = 0
    directory_count = 0
    for child in path.rglob("*"):
        try:
            if child.is_symlink():
                continue
            if child.is_dir():
                directory_count += 1
                continue
            if child.is_file():
                file_count += 1
                size_bytes += child.stat().st_size
        except OSError:
            continue
    return size_bytes, file_count, directory_count


def _fingerprint_payload(plan: ModelStorageDeletePlan) -> dict[str, Any]:
    return {
        "modelProfileId": plan.model_profile_id,
        "storagePath": plan.storage_path,
        "resolvedStoragePath": plan.resolved_storage_path,
        "sizeBytes": plan.size_bytes,
        "fileCount": plan.file_count,
        "directoryCount": plan.directory_count,
        "requiredConfirmation": plan.required_confirmation,
    }


def _fingerprint(plan: ModelStorageDeletePlan) -> str:
    payload = json.dumps(_fingerprint_payload(plan), ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def build_model_storage_delete_plan(
    profile: ModelProfile,
    *,
    all_profiles: list[ModelProfile],
    active_profile_id: str | None,
    allowed_roots: tuple[str, ...],
    include_size: bool,
) -> ModelStorageDeletePlan:
    blocked: list[DeleteBlockReason] = []
    storage_path = _candidate_storage_path(profile)
    resolved_storage_path: str | None = None

    if active_profile_id == profile.id:
        blocked.append(DeleteBlockReason("active_profile", "現在 active なモデルは削除できません"))

    if not storage_path:
        blocked.append(DeleteBlockReason("no_storage_location", "保存先が manifest にありません"))
    else:
        raw_path = Path(storage_path).expanduser()
        try:
            resolved_path = raw_path.resolve(strict=False)
            resolved_storage_path = str(resolved_path)
            if raw_path.exists() and raw_path.is_symlink() and not _path_within_allowed_roots(resolved_path, allowed_roots):
                blocked.append(DeleteBlockReason("symlink_outside_allowed_roots", "symlink の実体が許可root外です"))
            if not resolved_path.exists():
                blocked.append(DeleteBlockReason("storage_missing", "保存先が存在しません"))
            elif not _path_within_allowed_roots(resolved_path, allowed_roots):
                blocked.append(DeleteBlockReason("outside_allowed_roots", "保存先が削除許可root外です"))
            shared_ids = _shared_storage_profile_ids(profile, all_profiles, resolved_path)
            if shared_ids:
                blocked.append(
                    DeleteBlockReason(
                        "shared_storage",
                        f"他profileと保存先を共有しています: {', '.join(shared_ids)}",
                    )
                )
        except OSError as exc:
            blocked.append(DeleteBlockReason("path_resolve_failed", f"保存先を解決できません: {exc}"))

    size_bytes: int | None = None
    file_count: int | None = None
    directory_count: int | None = None
    if include_size and not blocked and resolved_storage_path:
        size_bytes, file_count, directory_count = _collect_storage_size(Path(resolved_storage_path))

    plan = ModelStorageDeletePlan(
        model_profile_id=profile.id,
        display_name_ja=profile.display_name_ja,
        storage_path=storage_path,
        resolved_storage_path=resolved_storage_path,
        can_delete=len(blocked) == 0,
        blocked_reasons=tuple(blocked),
        required_confirmation=f"DELETE {profile.id}",
        size_bytes=size_bytes,
        file_count=file_count,
        directory_count=directory_count,
    )
    return ModelStorageDeletePlan(
        **{
            **plan.__dict__,
            "plan_fingerprint": _fingerprint(plan) if plan.can_delete and include_size else None,
        }
    )


def delete_protection_to_api(plan: ModelStorageDeletePlan) -> dict[str, Any]:
    return {
        "canDelete": plan.can_delete,
        "protected": not plan.can_delete,
        "reasons": [reason.code for reason in plan.blocked_reasons],
        "reasonJa": " / ".join(reason.detail_ja for reason in plan.blocked_reasons) if plan.blocked_reasons else None,
        "storagePath": plan.storage_path,
        "resolvedStoragePath": plan.resolved_storage_path,
    }


def delete_preview_to_api(plan: ModelStorageDeletePlan) -> dict[str, Any]:
    payload = {
        "ok": True,
        "modelProfileId": plan.model_profile_id,
        "displayNameJa": plan.display_name_ja,
        "canDelete": plan.can_delete,
        "blockedReasons": [
            {"code": reason.code, "detailJa": reason.detail_ja}
            for reason in plan.blocked_reasons
        ],
        "storagePath": plan.storage_path,
        "resolvedStoragePath": plan.resolved_storage_path,
        "requiredConfirmation": plan.required_confirmation,
        "planFingerprint": plan.plan_fingerprint,
    }
    if plan.size_bytes is not None:
        payload["sizeBytes"] = plan.size_bytes
        payload["sizeGiB"] = round(plan.size_bytes / (1024.0**3), 3)
    if plan.file_count is not None:
        payload["fileCount"] = plan.file_count
    if plan.directory_count is not None:
        payload["directoryCount"] = plan.directory_count
    return payload


def execute_model_storage_delete(
    plan: ModelStorageDeletePlan,
    *,
    plan_fingerprint: str,
    confirmation: str,
) -> dict[str, Any]:
    if not plan.can_delete or not plan.resolved_storage_path:
        raise ModelStorageDeleteBlockedError("model storage delete is blocked")
    if plan.plan_fingerprint != plan_fingerprint:
        raise ModelStorageDeleteFingerprintMismatchError("model storage delete fingerprint mismatch")
    if confirmation != plan.required_confirmation:
        raise ModelStorageDeleteConfirmationError("model storage delete confirmation mismatch")

    target = Path(plan.resolved_storage_path)
    if target.is_dir():
        shutil.rmtree(target)
    elif target.exists():
        target.unlink()
    else:
        raise ModelStorageDeleteBlockedError("model storage path no longer exists")

    return {
        "ok": True,
        "modelProfileId": plan.model_profile_id,
        "displayNameJa": plan.display_name_ja,
        "deletedStoragePath": plan.resolved_storage_path,
        "sizeBytes": plan.size_bytes,
        "sizeGiB": round((plan.size_bytes or 0) / (1024.0**3), 3),
        "fileCount": plan.file_count,
        "directoryCount": plan.directory_count,
    }
