#!/usr/bin/env python3
"""Gate Hermes write_file/patch tool calls through file IPC approval (Phase D5.1)."""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any

try:
    from .models import ApprovalChoice
    from .pending_approval import wait_for_discord_approval
    from .store import FileApprovalStore
except ImportError:
    from models import ApprovalChoice
    from pending_approval import wait_for_discord_approval
    from store import FileApprovalStore

logger = logging.getLogger(__name__)

GUARDED_TOOL_NAMES = frozenset({"write_file", "patch"})

_BLOCKED_MESSAGE = (
    "BLOCKED: User denied this file write. Do NOT retry unless the user explicitly asks again."
)
_TIMEOUT_MESSAGE = (
    "BLOCKED: File write approval timed out. Ask the user to retry /task or reply yes when prompted."
)


def _relay_enabled() -> bool:
    return os.environ.get("HERMES_TASK_APPROVAL_RELAY", "").strip() in {
        "1",
        "true",
        "yes",
        "on",
    }


def _guard_tool_writes_enabled() -> bool:
    raw = os.environ.get("HERMES_TASK_APPROVAL_GUARD_WRITES", "1").strip().lower()
    return raw not in {"0", "false", "no", "off"}


def summarize_tool_call(tool_name: str, args: dict[str, Any] | None) -> tuple[str, str]:
    """Build approval request command/description for Discord display."""
    payload = args if isinstance(args, dict) else {}
    if tool_name == "write_file":
        path = str(payload.get("path") or "(unknown path)")
        content = payload.get("content")
        if isinstance(content, str):
            preview = content if len(content) <= 120 else content[:120] + "..."
            command = f"write_file path={path}\ncontent={preview}"
        else:
            command = f"write_file path={path}"
        return command, f"write file: {path}"
    if tool_name == "patch":
        path = str(payload.get("path") or "(unknown path)")
        mode = str(payload.get("mode") or "replace")
        command = f"patch mode={mode} path={path}"
        return command, f"patch file: {path}"
    command = f"{tool_name} {json.dumps(payload, ensure_ascii=False)[:200]}"
    return command, f"tool call: {tool_name}"


def _should_guard_tool(tool_name: str) -> bool:
    return tool_name in GUARDED_TOOL_NAMES


def build_pre_tool_call_handler(
    *,
    store_dir: Path,
    task_id: str,
    request_timeout_seconds: float,
    poll_interval_seconds: float,
):
    """Factory for Hermes ``pre_tool_call`` hook callbacks."""

    store = FileApprovalStore(store_dir, task_id)

    def _handler(
        tool_name: str,
        args: dict[str, Any] | None = None,
        **_kwargs: Any,
    ) -> dict[str, str] | None:
        del _kwargs
        if not _should_guard_tool(tool_name):
            return None
        command, description = summarize_tool_call(tool_name, args)
        choice = wait_for_discord_approval(
            store,
            {
                "command": command,
                "description": description,
                "pattern_key": f"tool:{tool_name}",
                "pattern_keys": [f"tool:{tool_name}"],
            },
            timeout_seconds=request_timeout_seconds,
            poll_interval_seconds=poll_interval_seconds,
        )
        if choice is None:
            return {"action": "block", "message": _TIMEOUT_MESSAGE}
        if choice == ApprovalChoice.DENY:
            return {"action": "block", "message": _BLOCKED_MESSAGE}
        logger.debug("tool write approved via relay: %s", tool_name)
        return None

    return _handler


def install_tool_write_approval_relay(
    *,
    store_dir: Path,
    task_id: str,
    request_timeout_seconds: float,
    poll_interval_seconds: float,
) -> None:
    """Register ``pre_tool_call`` hook after Hermes plugin discovery."""
    if not _relay_enabled() or not _guard_tool_writes_enabled():
        return

    handler = build_pre_tool_call_handler(
        store_dir=store_dir,
        task_id=task_id,
        request_timeout_seconds=request_timeout_seconds,
        poll_interval_seconds=poll_interval_seconds,
    )

    try:
        from hermes_cli.plugins import _ensure_plugins_discovered, get_plugin_manager  # type: ignore[import-untyped]
    except ImportError as exc:
        raise RuntimeError(f"hermes_cli.plugins unavailable: {exc}") from exc

    _ensure_plugins_discovered(force=True)
    manager = get_plugin_manager()
    manager._hooks.setdefault("pre_tool_call", []).append(handler)
    logger.debug(
        "registered tool write approval relay for task %s (tools: %s)",
        task_id,
        ", ".join(sorted(GUARDED_TOOL_NAMES)),
    )
