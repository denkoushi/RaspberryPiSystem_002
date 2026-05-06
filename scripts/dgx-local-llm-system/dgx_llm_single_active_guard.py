"""
DGX LocalLLM: green / blue のどちらか一方のみが実稼働するよう補助するユーティリティ。

control-server.py の HTTP 責務から分離し、ポリシー（単一アクティブ）を単体テストしやすくする。
"""

from __future__ import annotations

import os
from typing import Literal

BackendId = Literal["green", "blue"]


def single_active_guard_enabled() -> bool:
    raw = (os.environ.get("DGX_LLM_SINGLE_ACTIVE_GUARD") or "true").strip().lower()
    return raw not in {"0", "false", "no", "off"}


def inactive_backend(active: str) -> BackendId:
    if active not in {"green", "blue"}:
        raise ValueError(f"invalid active backend: {active}")
    return "blue" if active == "green" else "green"


def resolve_hard_stop_for_backend(
    backend: BackendId,
    *,
    green_stop_cmd: str,
    blue_stop_cmd: str,
    legacy_stop_cmd: str,
) -> str:
    """
    blue の keep_warm に関係なく、指定 backend の実停止コマンドを返す。
    legacy_stop_cmd は backend 別 CMD が空のときのフォールバック。
    """
    if backend == "green":
        resolved = (green_stop_cmd or legacy_stop_cmd).strip()
    else:
        resolved = (blue_stop_cmd or legacy_stop_cmd).strip()
    if not resolved:
        raise SystemExit(
            f"stop command is required for backend={backend} "
            "(set GREEN_LLM_RUNTIME_STOP_CMD / BLUE_LLM_RUNTIME_STOP_CMD or legacy LLM_RUNTIME_STOP_CMD)"
        )
    return resolved


def validate_both_backend_stops_configured(
    *,
    green_stop_cmd: str,
    blue_stop_cmd: str,
    legacy_stop_cmd: str,
) -> None:
    """単一アクティブガード有効時、両 backend の hard-stop が解決できることを起動時検証する。"""
    resolve_hard_stop_for_backend("green", green_stop_cmd=green_stop_cmd, blue_stop_cmd=blue_stop_cmd, legacy_stop_cmd=legacy_stop_cmd)
    resolve_hard_stop_for_backend("blue", green_stop_cmd=green_stop_cmd, blue_stop_cmd=blue_stop_cmd, legacy_stop_cmd=legacy_stop_cmd)
