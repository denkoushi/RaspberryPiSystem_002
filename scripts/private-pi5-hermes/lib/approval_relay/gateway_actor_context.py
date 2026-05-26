#!/usr/bin/env python3
"""Stash Discord actor ids from gateway MessageEvent.source (Phase D5.1)."""

from __future__ import annotations

from contextvars import ContextVar
from dataclasses import dataclass
from typing import Any

_UNSET = object()

_actor_context: ContextVar[Any] = ContextVar("hermes_task_bridge_gateway_actor", default=_UNSET)


@dataclass(frozen=True)
class GatewayActorContext:
    """Discord user/channel ids captured before slash command handlers run."""

    user_id: str = ""
    channel_id: str = ""
    platform: str = ""


def _normalize_id(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _platform_value(platform: Any) -> str:
    if platform is None:
        return ""
    value_attr = getattr(platform, "value", None)
    if value_attr is not None:
        return _normalize_id(value_attr)
    return _normalize_id(platform)


def stash_from_message_source(source: Any) -> None:
    """Capture user/channel from a gateway message source for the current async task."""
    if source is None:
        return
    user_id = _normalize_id(getattr(source, "user_id", None))
    channel_id = _normalize_id(getattr(source, "chat_id", None))
    if not channel_id:
        channel_id = _normalize_id(getattr(source, "thread_id", None))
    platform = _platform_value(getattr(source, "platform", None))
    if not user_id and not channel_id and not platform:
        return
    _actor_context.set(
        GatewayActorContext(
            user_id=user_id,
            channel_id=channel_id,
            platform=platform,
        )
    )


def read_gateway_actor_context() -> tuple[str, str]:
    """Return stashed (user_id, channel_id) for the current async task, or empty strings."""
    current = _actor_context.get(_UNSET)
    if current is _UNSET or not isinstance(current, GatewayActorContext):
        return "", ""
    return current.user_id, current.channel_id


def clear_gateway_actor_context() -> None:
    """Reset stashed actor context (tests only)."""
    _actor_context.set(_UNSET)
