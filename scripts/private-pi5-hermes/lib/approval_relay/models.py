#!/usr/bin/env python3
"""Approval relay domain models (Phase D5.1)."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class ApprovalChoice(str, Enum):
    """Hermes-compatible approval resolution choices."""

    ONCE = "once"
    SESSION = "session"
    ALWAYS = "always"
    DENY = "deny"

    @classmethod
    def from_text(cls, raw: str) -> ApprovalChoice | None:
        text = (raw or "").strip().lower()
        mapping = {
            "once": cls.ONCE,
            "o": cls.ONCE,
            "yes": cls.ONCE,
            "y": cls.ONCE,
            "approve": cls.ONCE,
            "ok": cls.ONCE,
            "go": cls.ONCE,
            "session": cls.SESSION,
            "s": cls.SESSION,
            "always": cls.ALWAYS,
            "a": cls.ALWAYS,
            "deny": cls.DENY,
            "d": cls.DENY,
            "no": cls.DENY,
            "n": cls.DENY,
            "cancel": cls.DENY,
        }
        return mapping.get(text)


@dataclass(frozen=True)
class ApprovalRequest:
    """Pending dangerous-command approval surfaced to Discord."""

    task_id: str
    command: str
    description: str
    pattern_key: str = ""
    pattern_keys: tuple[str, ...] = ()
    created_at: float = 0.0

    @classmethod
    def from_mapping(cls, task_id: str, data: dict[str, Any]) -> ApprovalRequest:
        keys_raw = data.get("pattern_keys") or []
        if not isinstance(keys_raw, list):
            keys_raw = []
        return cls(
            task_id=task_id,
            command=str(data.get("command") or ""),
            description=str(data.get("description") or ""),
            pattern_key=str(data.get("pattern_key") or ""),
            pattern_keys=tuple(str(k) for k in keys_raw),
            created_at=float(data.get("created_at") or 0.0),
        )

    def to_mapping(self) -> dict[str, Any]:
        return {
            "command": self.command,
            "description": self.description,
            "pattern_key": self.pattern_key,
            "pattern_keys": list(self.pattern_keys),
            "created_at": self.created_at,
        }


@dataclass(frozen=True)
class ApprovalResponse:
    """User decision written back for the tools subprocess."""

    choice: ApprovalChoice
    discord_user_id: str = ""
    decided_at: float = 0.0

    def to_mapping(self) -> dict[str, Any]:
        return {
            "choice": self.choice.value,
            "discord_user_id": self.discord_user_id,
            "decided_at": self.decided_at,
        }

    @classmethod
    def from_mapping(cls, data: dict[str, Any]) -> ApprovalResponse:
        raw = str(data.get("choice") or "deny").lower()
        try:
            choice = ApprovalChoice(raw)
        except ValueError:
            choice = ApprovalChoice.DENY
        return cls(
            choice=choice,
            discord_user_id=str(data.get("discord_user_id") or ""),
            decided_at=float(data.get("decided_at") or 0.0),
        )


@dataclass
class TaskRunContext:
    """Correlation for one /task invocation."""

    task_id: str
    discord_user_id: str = ""
    discord_channel_id: str = ""
    session_key: str = ""
    intermediate_messages: list[str] = field(default_factory=list)

    def __post_init__(self) -> None:
        if not self.session_key:
            self.session_key = f"task-bridge:{self.task_id}"
