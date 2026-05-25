#!/usr/bin/env python3
"""Discord /task bridge policy (Phase D5)."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class TaskBridgePolicy:
    """Allow/deny rules for Discord → tools profile delegation."""

    require_tools_phase: str
    max_prompt_chars: int
    max_output_chars: int
    runner_timeout_seconds: int
    allowed_toolsets: tuple[str, ...]
    deny_prompt_substrings: tuple[str, ...]
    bridge_executable_basename: str

    @classmethod
    def from_mapping(cls, data: dict[str, Any]) -> TaskBridgePolicy:
        def _positive_int(key: str) -> int:
            raw = data.get(key)
            if not isinstance(raw, int) or raw <= 0:
                raise ValueError(f"{key} must be a positive integer")
            return raw

        def _str_tuple(key: str) -> tuple[str, ...]:
            raw = data.get(key) or []
            if not isinstance(raw, list):
                raise ValueError(f"{key} must be a list")
            items = tuple(str(item).strip() for item in raw if str(item).strip())
            if not items and key in {"allowed_toolsets", "deny_prompt_substrings"}:
                if key == "allowed_toolsets":
                    raise ValueError(f"{key} must not be empty")
            return items

        phase = str(data.get("require_tools_phase", "")).strip().lower()
        if phase not in {"d4"}:
            raise ValueError("require_tools_phase must be d4 for Phase D5 bridge")

        allowed = _str_tuple("allowed_toolsets")
        expected = ("file", "web", "browser")
        if allowed != expected:
            raise ValueError(f"allowed_toolsets must be exactly {expected!r}, got {allowed!r}")

        basename = str(data.get("bridge_executable_basename", "")).strip()
        if not basename:
            raise ValueError("bridge_executable_basename is required")

        return cls(
            require_tools_phase=phase,
            max_prompt_chars=_positive_int("max_prompt_chars"),
            max_output_chars=_positive_int("max_output_chars"),
            runner_timeout_seconds=_positive_int("runner_timeout_seconds"),
            allowed_toolsets=allowed,
            deny_prompt_substrings=_str_tuple("deny_prompt_substrings"),
            bridge_executable_basename=basename,
        )


@dataclass
class TaskPromptValidationResult:
    ok: bool
    reason: str = ""


def validate_task_bridge_document(data: dict[str, Any]) -> list[str]:
    """Structural validation for task-bridge.policy.yaml."""
    errors: list[str] = []
    try:
        TaskBridgePolicy.from_mapping(data)
    except ValueError as exc:
        errors.append(str(exc))
    return errors


def validate_task_prompt(prompt: str, policy: TaskBridgePolicy) -> TaskPromptValidationResult:
    """Validate user prompt before invoking tools profile runner."""
    text = (prompt or "").strip()
    if not text:
        return TaskPromptValidationResult(False, "empty task prompt")
    if len(text) > policy.max_prompt_chars:
        return TaskPromptValidationResult(
            False,
            f"prompt exceeds max length ({policy.max_prompt_chars} chars)",
        )
    lowered = text.lower()
    for needle in policy.deny_prompt_substrings:
        if needle.lower() in lowered:
            return TaskPromptValidationResult(False, f"prompt contains forbidden phrase: {needle!r}")
    if re.search(r"https?://", text, re.IGNORECASE):
        return TaskPromptValidationResult(
            False,
            "prompt must not contain http(s) URLs; use workspace paths or ask for DGX healthz via tools agent",
        )
    return TaskPromptValidationResult(True, "")


def toolsets_cli_argument(policy: TaskBridgePolicy) -> str:
    """Hermes CLI --toolsets value (comma-separated)."""
    return ",".join(policy.allowed_toolsets)
