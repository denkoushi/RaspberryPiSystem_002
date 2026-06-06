#!/usr/bin/env python3
"""Hermes plugin exposing Discord bridge commands."""

from __future__ import annotations

import os
from pathlib import Path

try:
    from .discord_task_bridge import (
        load_task_bridge_policy,
        render_task_usage,
        run_task_bridge_async,
    )
    from .discord_daily_pilot_bridge import (
        render_daily_usage,
        run_daily_pilot_bridge_async,
    )
    from .discord_life_pilot_bridge import (
        normalize_life_command_args,
        render_digest_usage,
        render_memo_usage,
        render_recommend_usage,
        render_remind_usage,
        load_life_pilot_policy,
        run_life_digest_bridge_async,
        run_life_memo_bridge_async,
        run_life_recommend_bridge_async,
        run_life_remind_bridge_async,
    )
    from .life_discord_inbox import (
        capture_discord_inbox_message,
        extract_discord_message_text,
        extract_attachment_names,
    )
    from .life_proactive_loop import (
        remember_life_discord_context,
        resolve_proactive_reply,
    )
    from .life_reminder_scheduler import send_discord_channel_message
    from .discord_novel_bridge import run_novel_bridge_async
    from .novel_request import NovelRequest
    from .novel_profile_runner import NovelProfilePaths, render_novel_usage
    from .task_request import TaskRequest
except ImportError:  # deployed flat under ~/.hermes/plugins/<name>/
    from discord_task_bridge import (
        load_task_bridge_policy,
        render_task_usage,
        run_task_bridge_async,
    )
    from discord_daily_pilot_bridge import (
        render_daily_usage,
        run_daily_pilot_bridge_async,
    )
    from discord_life_pilot_bridge import (
        normalize_life_command_args,
        render_digest_usage,
        render_memo_usage,
        render_recommend_usage,
        render_remind_usage,
        load_life_pilot_policy,
        run_life_digest_bridge_async,
        run_life_memo_bridge_async,
        run_life_recommend_bridge_async,
        run_life_remind_bridge_async,
    )
    from life_discord_inbox import (
        capture_discord_inbox_message,
        extract_discord_message_text,
        extract_attachment_names,
    )
    from life_proactive_loop import (
        remember_life_discord_context,
        resolve_proactive_reply,
    )
    from life_reminder_scheduler import send_discord_channel_message
    from discord_novel_bridge import run_novel_bridge_async
    from novel_request import NovelRequest
    from novel_profile_runner import NovelProfilePaths, render_novel_usage
    from task_request import TaskRequest

try:
    from .approval_relay.coordinator import DiscordApprovalRelayCoordinator, read_gateway_session_context
    from .approval_relay.discord_relay import parse_task_approve_args
    from .approval_relay.gateway_actor_context import stash_from_message_source
    from .approval_relay.models import ApprovalChoice
    from .approval_relay.session_context import approval_actor_ids
except ImportError:
    from approval_relay.coordinator import DiscordApprovalRelayCoordinator, read_gateway_session_context
    from approval_relay.discord_relay import parse_task_approve_args
    from approval_relay.gateway_actor_context import stash_from_message_source
    from approval_relay.models import ApprovalChoice
    from approval_relay.session_context import approval_actor_ids

_COORDINATOR: DiscordApprovalRelayCoordinator | None = None
_COORDINATOR_STORE_DIR: str = ""


def _plugin_dir() -> Path:
    return Path(__file__).resolve().parent


def _task_bridge_enabled() -> bool:
    """True when Ansible deployed task-bridge.policy.yaml (tools bridge on)."""
    return (_plugin_dir() / "task-bridge.policy.yaml").is_file()


def _novel_bridge_enabled() -> bool:
    """True when Ansible explicitly enabled the Discord novel bridge."""
    return (_plugin_dir() / "novel-bridge.enabled").is_file()


def _daily_pilot_enabled() -> bool:
    """True when Ansible deployed daily-pilot.policy.yaml (D6-pre)."""
    return (_plugin_dir() / "daily-pilot.policy.yaml").is_file()


def _life_pilot_enabled() -> bool:
    """True when Ansible deployed life-pilot.policy.yaml (D6-life)."""
    return (_plugin_dir() / "life-pilot.policy.yaml").is_file()


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None or str(raw).strip() == "":
        return default
    return str(raw).strip().lower() in {"1", "true", "yes", "on"}


def _life_discord_inbox_enabled() -> bool:
    return _env_bool("HERMES_LIFE_DISCORD_INBOX_ENABLED", True)


def _life_discord_inbox_capture_all() -> bool:
    return _env_bool("HERMES_LIFE_DISCORD_INBOX_CAPTURE_ALL", False)


def _life_discord_inbox_channel_ids() -> set[str]:
    raw = os.environ.get("HERMES_LIFE_DISCORD_INBOX_CHANNEL_IDS", "")
    return {item.strip() for item in raw.replace(";", ",").split(",") if item.strip()}


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


def _remember_life_context(user_id: str, channel_id: str) -> None:
    if not channel_id:
        return
    try:
        remember_life_discord_context(user_id, channel_id)
    except (OSError, ValueError, RuntimeError):
        return


def _send_gateway_reply(gateway, source, message: str) -> bool:
    if source is None:
        return False
    platform = str(getattr(source, "platform", "") or "").strip()
    chat_id = str(getattr(source, "chat_id", "") or "").strip()
    if not chat_id:
        chat_id = str(getattr(source, "thread_id", "") or "").strip()
    if gateway is not None:
        adapters = getattr(gateway, "adapters", None) or {}
        adapter = adapters.get(platform) if isinstance(adapters, dict) else None
        send = getattr(adapter, "send", None)
        if callable(send) and chat_id:
            try:
                send(chat_id, message)
                return True
            except Exception:
                pass
    token = os.environ.get("DISCORD_BOT_TOKEN", "")
    if platform and platform != "discord":
        return False
    if not token or not chat_id:
        return False
    result = send_discord_channel_message(token, chat_id, message)
    if not result.ok:
        return False
    return True


def _capture_life_discord_inbox(
    event,
    *,
    user_id: str,
    channel_id: str,
    text: str,
) -> str | None:
    if not _life_discord_inbox_enabled():
        return None
    try:
        policy = load_life_pilot_policy()
        result = capture_discord_inbox_message(
            Path(policy.storage_root),
            text,
            user_id=user_id,
            channel_id=channel_id,
            attachments=extract_attachment_names(event),
            allowed_channel_ids=_life_discord_inbox_channel_ids(),
            capture_all=_life_discord_inbox_capture_all(),
        )
    except (OSError, ValueError, RuntimeError):
        return None
    if not result.captured:
        return None
    _remember_life_context(user_id, channel_id)
    return result.ack


def _render_life_reply_usage() -> str:
    return "usage: /life-reply <1|2|3|free text>\nexample: /life-reply 1"


async def _handle_task_command(raw_args: str) -> str:
    """Run tools profile work off the Discord gateway asyncio loop."""
    request = TaskRequest.from_text(raw_args)
    if not request.prompt:
        return render_task_usage()
    policy = load_task_bridge_policy()
    return await run_task_bridge_async(request, policy)


async def _handle_novel_command(raw_args: str) -> str:
    """Run novel profile creative work off the Discord gateway asyncio loop."""
    request = NovelRequest.from_text(raw_args)
    if not request.prompt:
        return render_novel_usage()
    return await run_novel_bridge_async(request)


async def _handle_daily_command(raw_args: str) -> str:
    """Render a safe Markdown handoff without invoking workers or tools."""
    prompt = (raw_args or "").strip()
    if not prompt:
        return render_daily_usage()
    return await run_daily_pilot_bridge_async(prompt)


async def _handle_memo_command(raw_args: str) -> str:
    """Record a private life memo without invoking workers or tools."""
    prompt = normalize_life_command_args(raw_args or "", "memo")
    if not prompt:
        return render_memo_usage()
    user_id, channel_id = read_gateway_session_context()
    _remember_life_context(user_id, channel_id)
    return await run_life_memo_bridge_async(prompt)


async def _handle_digest_command(raw_args: str) -> str:
    """Summarize local Life Pilot notes without external access."""
    user_id, channel_id = read_gateway_session_context()
    _remember_life_context(user_id, channel_id)
    return await run_life_digest_bridge_async(
        normalize_life_command_args(raw_args or "", "digest")
    )


async def _handle_remind_command(raw_args: str) -> str:
    """Record a private reminder request and schedule Discord notification when possible."""
    prompt = normalize_life_command_args(raw_args or "", "remind")
    if not prompt:
        return render_remind_usage()
    user_id, channel_id = read_gateway_session_context()
    _remember_life_context(user_id, channel_id)
    return await run_life_remind_bridge_async(
        prompt,
        notify_channel_id=channel_id,
        notify_user_id=user_id,
    )


async def _handle_recommend_command(raw_args: str) -> str:
    """Suggest small next steps from local Life Pilot notes only."""
    user_id, channel_id = read_gateway_session_context()
    _remember_life_context(user_id, channel_id)
    return await run_life_recommend_bridge_async(
        normalize_life_command_args(raw_args or "", "recommend")
    )


async def _handle_life_reply_command(raw_args: str) -> str:
    """Record a reply to the latest proactive Life Pilot check-in."""
    prompt = normalize_life_command_args(raw_args or "", "life-reply")
    if not prompt:
        return _render_life_reply_usage()
    user_id, channel_id = read_gateway_session_context()
    _remember_life_context(user_id, channel_id)
    try:
        reply = resolve_proactive_reply(
            prompt,
            user_id=user_id,
            channel_id=channel_id,
        )
    except (OSError, ValueError, RuntimeError) as exc:
        return f"life reply failed: {exc}"
    if reply is None:
        return (
            "返信待ちの朝晩確認がありません。\n"
            "Hermesからの確認が届いた後に /life-reply 1 または /life-reply <文章> で返してください。"
        )
    return reply


async def _handle_task_approve(raw_args: str) -> str:
    coord = _coordinator()
    if coord is None:
        return "task approval relay is disabled"
    user_id, channel_id = read_gateway_session_context()
    actors = approval_actor_ids(user_id, channel_id)
    if not actors:
        return "could not resolve Discord user for approval"
    choice = parse_task_approve_args(raw_args)
    message = "no active /task awaiting approval"
    for actor_id in actors:
        ok, message = coord.resolve_for_user(actor_id, choice)
        if ok or "承認期限切れ" in message:
            return message
    return f"task approve failed: {message}"


async def _handle_task_deny(_raw_args: str) -> str:
    coord = _coordinator()
    if coord is None:
        return "task approval relay is disabled"
    user_id, channel_id = read_gateway_session_context()
    actors = approval_actor_ids(user_id, channel_id)
    if not actors:
        return "could not resolve Discord user for denial"
    message = "no active /task awaiting approval"
    for actor_id in actors:
        ok, message = coord.resolve_for_user(actor_id, ApprovalChoice.DENY)
        if ok or "承認期限切れ" in message:
            return message
    return f"task deny failed: {message}"


def _handle_pre_gateway_dispatch(event, gateway=None, **kwargs):
    """Intercept lightweight text replies for task approval or Life Pilot check-ins."""
    del kwargs
    source = getattr(event, "source", None)
    if not bool(getattr(event, "internal", False)):
        stash_from_message_source(source)

    user_id = str(getattr(source, "user_id", "") or "").strip()
    channel_id = str(getattr(source, "chat_id", "") or "").strip()
    if not channel_id:
        channel_id = str(getattr(source, "thread_id", "") or "").strip()
    if not user_id or not channel_id:
        fallback_user_id, fallback_channel_id = read_gateway_session_context()
        user_id = user_id or fallback_user_id
        channel_id = channel_id or fallback_channel_id
    raw_text = str(getattr(event, "text", "") or "").strip()
    text = extract_discord_message_text(event)
    if not text:
        text = raw_text
    attachments = extract_attachment_names(event)
    if not text and not attachments:
        return None
    if raw_text.startswith("/") or text.startswith("/"):
        return None
    resolved = None
    coord = _coordinator()
    if coord is not None and raw_text:
        for actor_id in approval_actor_ids(user_id, channel_id):
            resolved = coord.try_resolve_text(actor_id, raw_text)
            if resolved is not None:
                break
    if resolved is None:
        if _life_pilot_enabled():
            reply = None
            if raw_text:
                try:
                    reply = resolve_proactive_reply(
                        raw_text,
                        user_id=user_id,
                        channel_id=channel_id,
                    )
                except (OSError, ValueError, RuntimeError):
                    reply = None
            if reply is not None:
                _send_gateway_reply(gateway, source, reply)
                return {"action": "skip", "reason": "life-proactive-reply"}
            ack = _capture_life_discord_inbox(
                event,
                user_id=user_id,
                channel_id=channel_id,
                text=text,
            )
            if ack is not None:
                _send_gateway_reply(gateway, source, ack)
                return {"action": "skip", "reason": "life-discord-inbox"}
        return None
    ok, message = resolved
    _send_gateway_reply(gateway, source, message if ok else f"task approval: {message}")
    return {"action": "skip", "reason": "task-approval-text"}


def register(ctx) -> None:
    """Register bridge commands matching deployed capabilities (policy / novel .env)."""
    life_enabled = _life_pilot_enabled()
    task_enabled = _task_bridge_enabled()
    if _daily_pilot_enabled():
        ctx.register_command(
            "daily",
            handler=_handle_daily_command,
            description="Draft a safe daily-use Markdown handoff without execution",
            args_hint="<memo or request>",
        )
    if life_enabled:
        ctx.register_command(
            "memo",
            handler=_handle_memo_command,
            description="Record a private Life Pilot memo without execution",
            args_hint="<life note>",
        )
        ctx.register_command(
            "digest",
            handler=_handle_digest_command,
            description="Summarize private Life Pilot notes and reminders",
            args_hint="[focus]",
        )
        ctx.register_command(
            "remind",
            handler=_handle_remind_command,
            description="Schedule a private Life Pilot reminder notification",
            args_hint="<when and reminder>",
        )
        ctx.register_command(
            "recommend",
            handler=_handle_recommend_command,
            description="Suggest small next steps from Life Pilot notes only",
            args_hint="[focus]",
        )
        ctx.register_command(
            "life-reply",
            handler=_handle_life_reply_command,
            description="Reply to the latest Life Pilot check-in",
            args_hint="<1|2|3|free text>",
        )
    if _novel_bridge_enabled():
        ctx.register_command(
            "novel",
            handler=_handle_novel_command,
            description="Creative writing — enter your prompt in the Arguments field",
            args_hint="<creative prompt>",
        )
    if task_enabled:
        ctx.register_command(
            "task",
            handler=_handle_task_command,
            description="Run a task on the isolated tools profile",
            args_hint="<task instruction>",
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
    if (life_enabled or task_enabled) and hasattr(ctx, "register_hook"):
        ctx.register_hook("pre_gateway_dispatch", _handle_pre_gateway_dispatch)
