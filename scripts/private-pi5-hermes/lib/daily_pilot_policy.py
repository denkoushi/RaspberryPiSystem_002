#!/usr/bin/env python3
"""Policy for the safe daily-use Hermes pilot (D6-pre)."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class DailyPilotPolicy:
    """Allow/deny rules before Cursor/Codex worker automation exists."""

    phase: str
    model_route: str
    output_mode: str
    workspace_root: str
    max_prompt_chars: int
    cursor_codex_auto_run: bool
    terminal_enabled: bool
    git_enabled: bool
    deploy_enabled: bool
    secret_access_enabled: bool
    allowed_task_classes: tuple[str, ...]
    deferred_task_classes: tuple[str, ...]
    deny_prompt_substrings: tuple[str, ...]
    deny_prompt_patterns: tuple[str, ...]

    @classmethod
    def from_mapping(cls, data: dict[str, Any]) -> DailyPilotPolicy:
        def _str(key: str) -> str:
            value = str(data.get(key, "")).strip()
            if not value:
                raise ValueError(f"{key} is required")
            return value

        def _bool(key: str) -> bool:
            value = data.get(key)
            if not isinstance(value, bool):
                raise ValueError(f"{key} must be a boolean")
            return value

        def _positive_int(key: str) -> int:
            value = data.get(key)
            if not isinstance(value, int) or value <= 0:
                raise ValueError(f"{key} must be a positive integer")
            return value

        def _str_tuple(key: str) -> tuple[str, ...]:
            raw = data.get(key) or []
            if not isinstance(raw, list):
                raise ValueError(f"{key} must be a list")
            items = tuple(str(item).strip() for item in raw if str(item).strip())
            if key in {"allowed_task_classes", "deferred_task_classes"} and not items:
                raise ValueError(f"{key} must not be empty")
            return items

        phase = _str("phase")
        if phase != "daily_pilot_v0":
            raise ValueError("phase must be daily_pilot_v0")

        output_mode = _str("output_mode")
        if output_mode != "markdown_only":
            raise ValueError("output_mode must be markdown_only for D6-pre")

        deny_patterns = _str_tuple("deny_prompt_patterns")
        for pattern in deny_patterns:
            try:
                re.compile(pattern)
            except re.error as exc:
                raise ValueError(f"invalid deny_prompt_patterns entry {pattern!r}: {exc}") from exc

        return cls(
            phase=phase,
            model_route=_str("model_route"),
            output_mode=output_mode,
            workspace_root=_str("workspace_root"),
            max_prompt_chars=_positive_int("max_prompt_chars"),
            cursor_codex_auto_run=_bool("cursor_codex_auto_run"),
            terminal_enabled=_bool("terminal_enabled"),
            git_enabled=_bool("git_enabled"),
            deploy_enabled=_bool("deploy_enabled"),
            secret_access_enabled=_bool("secret_access_enabled"),
            allowed_task_classes=_str_tuple("allowed_task_classes"),
            deferred_task_classes=_str_tuple("deferred_task_classes"),
            deny_prompt_substrings=_str_tuple("deny_prompt_substrings"),
            deny_prompt_patterns=deny_patterns,
        )


@dataclass(frozen=True)
class DailyPromptValidationResult:
    ok: bool
    reason: str = ""


def validate_daily_pilot_document(data: dict[str, Any]) -> list[str]:
    """Return human-readable errors; empty means valid."""
    errors: list[str] = []
    try:
        policy = DailyPilotPolicy.from_mapping(data)
    except ValueError as exc:
        return [str(exc)]

    hard_gates = {
        "cursor_codex_auto_run": policy.cursor_codex_auto_run,
        "terminal_enabled": policy.terminal_enabled,
        "git_enabled": policy.git_enabled,
        "deploy_enabled": policy.deploy_enabled,
        "secret_access_enabled": policy.secret_access_enabled,
    }
    for key, value in hard_gates.items():
        if value:
            errors.append(f"{key} must be false for D6-pre")

    required_deferred = {
        "run_cursor_or_codex_cli",
        "git_commit_push_merge",
        "deploy_or_restart_services",
        "read_secrets_or_tokens",
        "terminal_shell_execution",
    }
    missing = sorted(required_deferred - set(policy.deferred_task_classes))
    if missing:
        errors.append(f"deferred_task_classes missing required gates: {missing!r}")

    if not policy.workspace_root.startswith("/home/hermes/.hermes-daily/"):
        errors.append("workspace_root must stay under /home/hermes/.hermes-daily/")

    return errors


def validate_daily_prompt(
    prompt: str,
    policy: DailyPilotPolicy,
) -> DailyPromptValidationResult:
    """Reject prompts that try to turn the daily pilot into an executor."""
    text = (prompt or "").strip()
    if not text:
        return DailyPromptValidationResult(False, "empty prompt")
    if len(text) > policy.max_prompt_chars:
        return DailyPromptValidationResult(
            False,
            f"prompt exceeds max length ({policy.max_prompt_chars} chars)",
        )
    lowered = text.lower()
    for needle in policy.deny_prompt_substrings:
        if needle.lower() in lowered:
            return DailyPromptValidationResult(False, f"prompt contains forbidden phrase: {needle!r}")
    for pattern in policy.deny_prompt_patterns:
        if re.search(pattern, text, re.IGNORECASE):
            return DailyPromptValidationResult(
                False,
                f"prompt matches deferred task pattern: {pattern!r}",
            )
    return DailyPromptValidationResult(True, "ok")


def daily_pilot_emission_json(policy: DailyPilotPolicy) -> dict[str, object]:
    """Small contract emitted by validate_boundary_policy.py."""
    return {
        "phase": policy.phase,
        "model_route": policy.model_route,
        "output_mode": policy.output_mode,
        "workspace_root": policy.workspace_root,
        "cursor_codex_auto_run": policy.cursor_codex_auto_run,
        "terminal_enabled": policy.terminal_enabled,
        "git_enabled": policy.git_enabled,
        "deploy_enabled": policy.deploy_enabled,
        "secret_access_enabled": policy.secret_access_enabled,
        "allowed_task_classes": list(policy.allowed_task_classes),
        "deferred_task_classes": list(policy.deferred_task_classes),
    }
