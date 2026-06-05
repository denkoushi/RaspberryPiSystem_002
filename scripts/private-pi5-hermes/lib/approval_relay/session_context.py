#!/usr/bin/env python3
"""Gateway session context adapter for Discord /task bridge (Phase D5.1)."""

from __future__ import annotations

import os
from typing import Callable

SessionEnvGetter = Callable[[str, str], str]

_SESSION_USER_KEYS: tuple[str, ...] = ("HERMES_SESSION_USER_ID",)
_SESSION_CHANNEL_KEYS: tuple[str, ...] = (
    "HERMES_SESSION_CHAT_ID",
    "HERMES_SESSION_THREAD_ID",
)
_CHANNEL_ACTOR_PREFIX = "channel:"


def _first_non_empty(values: tuple[str, ...]) -> str:
    for value in values:
        cleaned = str(value or "").strip()
        if cleaned:
            return cleaned
    return ""


def _read_from_getter(getter: SessionEnvGetter, keys: tuple[str, ...]) -> str:
    values: list[str] = []
    for key in keys:
        try:
            values.append(getter(key, ""))
        except (TypeError, AttributeError):
            return ""
    return _first_non_empty(tuple(values))


def _read_from_os_environ(keys: tuple[str, ...]) -> str:
    return _first_non_empty(tuple(os.environ.get(key, "") for key in keys))


def _resolve_session_env_getter(
    env_getter: SessionEnvGetter | None,
) -> SessionEnvGetter | None:
    if env_getter is not None:
        return env_getter
    try:
        from gateway.session_context import get_session_env  # type: ignore[import-untyped]
    except ImportError:
        return None
    return get_session_env


def read_gateway_session_context(
    *,
    env_getter: SessionEnvGetter | None = None,
) -> tuple[str, str]:
    """Best-effort Discord user/channel ids from gateway actor stash, then session env."""
    try:
        from .gateway_actor_context import read_gateway_actor_context
    except ImportError:
        from gateway_actor_context import read_gateway_actor_context

    user_id, channel_id = read_gateway_actor_context()

    getter = _resolve_session_env_getter(env_getter)
    if getter is not None:
        try:
            if not user_id:
                user_id = _read_from_getter(getter, _SESSION_USER_KEYS)
            if not channel_id:
                channel_id = _read_from_getter(getter, _SESSION_CHANNEL_KEYS)
        except ImportError:
            getter = None
    if not user_id:
        user_id = _read_from_os_environ(_SESSION_USER_KEYS)
    if not channel_id:
        channel_id = _read_from_os_environ(_SESSION_CHANNEL_KEYS)
    return user_id, channel_id


def approval_channel_actor_id(channel_id: str) -> str:
    """Return a stable approval actor key for channel-scoped fallback binding."""
    cleaned = str(channel_id or "").strip()
    if not cleaned:
        return ""
    return f"{_CHANNEL_ACTOR_PREFIX}{cleaned}"


def approval_actor_ids(user_id: str, channel_id: str) -> list[str]:
    """User-scoped approval first, then channel fallback when user id is absent/mismatched."""
    actors: list[str] = []
    cleaned_user = str(user_id or "").strip()
    if cleaned_user:
        actors.append(cleaned_user)
    channel_actor = approval_channel_actor_id(channel_id)
    if channel_actor and channel_actor not in actors:
        actors.append(channel_actor)
    return actors


def primary_approval_actor_id(user_id: str, channel_id: str) -> str:
    """Actor id used to bind a new task when gateway user id is unavailable."""
    actors = approval_actor_ids(user_id, channel_id)
    return actors[0] if actors else ""
