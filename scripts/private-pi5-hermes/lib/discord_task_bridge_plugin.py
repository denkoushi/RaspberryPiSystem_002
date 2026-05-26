#!/usr/bin/env python3
"""Hermes plugin exposing `/task` and approval relay commands (Phase D5 / D5.1)."""

from __future__ import annotations

try:
    from .discord_task_bridge import (
        load_task_bridge_policy,
        render_task_usage,
        run_task_bridge_async,
    )
    from .task_request import TaskRequest
except ImportError:  # deployed flat under ~/.hermes/plugins/<name>/
    from discord_task_bridge import (
        load_task_bridge_policy,
        render_task_usage,
        run_task_bridge_async,
    )
    from task_request import TaskRequest

try:
    from .approval_relay.coordinator import DiscordApprovalRelayCoordinator, read_gateway_session_context
    from .approval_relay.discord_relay import parse_task_approve_args
    from .approval_relay.gateway_actor_context import stash_from_message_source
    from .approval_relay.models import ApprovalChoice
except ImportError:
    from approval_relay.coordinator import DiscordApprovalRelayCoordinator, read_gateway_session_context
    from approval_relay.discord_relay import parse_task_approve_args
    from approval_relay.gateway_actor_context import stash_from_message_source
    from approval_relay.models import ApprovalChoice

_COORDINATOR: DiscordApprovalRelayCoordinator | None = None
_COORDINATOR_STORE_DIR: str = ""


def _coordinator() -> DiscordApprovalRelayCoordinator | None:
    global _COORDINATOR, _COORDINATOR_STORE_DIR
    try:
        policy = load_task_bridge_policy()
    except (OSError, ValueError, RuntimeError):
        return None
    if not policy.approval_relay.enabled:
        return None
    if (
        _COORDINATOR is None
        or _COORDINATOR_STORE_DIR != policy.approval_relay.store_dir
    ):
        _COORDINATOR = DiscordApprovalRelayCoordinator(policy.approval_relay)
        _COORDINATOR_STORE_DIR = policy.approval_relay.store_dir
    return _COORDINATOR


async def _handle_task_command(raw_args: str) -> str:
    """Run tools profile work off the Discord gateway asyncio loop."""
    request = TaskRequest.from_text(raw_args)
    if not request.prompt:
        return render_task_usage()
    policy = load_task_bridge_policy()
    return await run_task_bridge_async(request, policy)


async def _handle_task_approve(raw_args: str) -> str:
    coord = _coordinator()
    if coord is None:
        return "task approval relay is disabled"
    user_id, _ = read_gateway_session_context()
    if not user_id:
        return "could not resolve Discord user for approval"
    choice = parse_task_approve_args(raw_args)
    ok, message = coord.resolve_for_user(user_id, choice)
    return message if ok else f"task approve failed: {message}"


async def _handle_task_deny(_raw_args: str) -> str:
    coord = _coordinator()
    if coord is None:
        return "task approval relay is disabled"
    user_id, _ = read_gateway_session_context()
    if not user_id:
        return "could not resolve Discord user for denial"
    ok, message = coord.resolve_for_user(user_id, ApprovalChoice.DENY)
    return message if ok else f"task deny failed: {message}"


def _handle_pre_gateway_dispatch(event, gateway=None, **kwargs):
    """Intercept yes/no text when a /task approval is pending (Phase D5.1)."""
    del kwargs
    source = getattr(event, "source", None)
    if not bool(getattr(event, "internal", False)):
        stash_from_message_source(source)

    coord = _coordinator()
    if coord is None:
        return None
    user_id = str(getattr(source, "user_id", "") or "").strip()
    if not user_id:
        user_id, _channel_id = read_gateway_session_context()
    text = str(getattr(event, "text", "") or "").strip()
    if not user_id or not text or text.startswith("/"):
        return None
    resolved = coord.try_resolve_text(user_id, text)
    if resolved is None:
        return None
    ok, message = resolved
    if gateway is not None and source is not None:
        platform = str(getattr(source, "platform", "") or "").strip()
        chat_id = str(getattr(source, "chat_id", "") or "").strip()
        adapters = getattr(gateway, "adapters", None) or {}
        adapter = adapters.get(platform) if isinstance(adapters, dict) else None
        send = getattr(adapter, "send", None)
        if callable(send) and chat_id:
            try:
                send(chat_id, message if ok else f"task approval: {message}")
            except Exception:
                pass
    return {"action": "skip", "reason": "task-approval-text"}


def register(ctx) -> None:
    """Register `/task` and D5.1 approval commands for gateway sessions."""
    ctx.register_command(
        "task",
        handler=_handle_task_command,
        description="Run a task on the isolated tools profile",
    )
    ctx.register_command(
        "task-approve",
        handler=_handle_task_approve,
        description="Approve the pending /task dangerous operation",
    )
    ctx.register_command(
        "task-deny",
        handler=_handle_task_deny,
        description="Deny the pending /task dangerous operation",
    )
    if hasattr(ctx, "register_hook"):
        ctx.register_hook("pre_gateway_dispatch", _handle_pre_gateway_dispatch)
