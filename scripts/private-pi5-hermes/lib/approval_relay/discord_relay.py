#!/usr/bin/env python3
"""Discord-facing approval relay helpers (Phase D5.1)."""

from __future__ import annotations

import json
import logging
import os
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Awaitable, Callable

try:
    from .models import ApprovalChoice, ApprovalRequest
except ImportError:
    from models import ApprovalChoice, ApprovalRequest

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class DiscordSendResult:
    ok: bool
    status_code: int = 0
    error: str = ""
    body_preview: str = ""


def format_approval_prompt(request: ApprovalRequest) -> str:
    """Short Discord message for a pending approval."""
    command = request.command.strip() or "(unknown command)"
    description = request.description.strip() or "potentially dangerous operation"
    return (
        "⚠️ **承認が必要です** (task approval required)\n"
        f"- 理由: {description}\n"
        f"- コマンド:\n```\n{command}\n```\n"
        "返信: `yes` / `no` または `/task-approve` / `/task-deny`"
    )


def parse_approval_text(raw: str) -> ApprovalChoice | None:
    return ApprovalChoice.from_text(raw)


def parse_task_approve_args(raw_args: str) -> ApprovalChoice:
    text = (raw_args or "").strip().lower()
    if not text:
        return ApprovalChoice.ONCE
    choice = ApprovalChoice.from_text(text)
    if choice in {ApprovalChoice.ONCE, ApprovalChoice.SESSION, ApprovalChoice.ALWAYS}:
        return choice
    if text in {"session", "s"}:
        return ApprovalChoice.SESSION
    if text in {"always", "a"}:
        return ApprovalChoice.ALWAYS
    return ApprovalChoice.ONCE


async def send_discord_channel_message(channel_id: str, content: str) -> DiscordSendResult:
    """Best-effort Discord REST send using DISCORD_BOT_TOKEN from gateway env."""
    token = (os.environ.get("DISCORD_BOT_TOKEN") or "").strip()
    if not token:
        result = DiscordSendResult(ok=False, error="DISCORD_BOT_TOKEN is not set")
        logger.error("discord approval notify failed: %s", result.error)
        return result
    if not channel_id:
        result = DiscordSendResult(ok=False, error="discord channel_id is empty")
        logger.error("discord approval notify failed: %s", result.error)
        return result
    if not content:
        result = DiscordSendResult(ok=False, error="message content is empty")
        logger.error("discord approval notify failed: %s", result.error)
        return result

    body = json.dumps({"content": content[:2000]}, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        f"https://discord.com/api/v10/channels/{channel_id}/messages",
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bot {token}",
            "Content-Type": "application/json",
        },
    )

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            status = int(resp.status)
            raw = resp.read().decode("utf-8", errors="replace")[:500]
            if 200 <= status < 300:
                logger.info(
                    "discord approval notify sent channel=%s status=%s",
                    channel_id,
                    status,
                )
                return DiscordSendResult(ok=True, status_code=status, body_preview=raw)
            result = DiscordSendResult(
                ok=False,
                status_code=status,
                error=f"unexpected HTTP status {status}",
                body_preview=raw,
            )
            logger.error(
                "discord approval notify failed channel=%s status=%s body=%s",
                channel_id,
                status,
                raw,
            )
            return result
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")[:500]
        result = DiscordSendResult(
            ok=False,
            status_code=int(exc.code),
            error=str(exc.reason or exc),
            body_preview=raw,
        )
        logger.error(
            "discord approval notify HTTP error channel=%s status=%s body=%s",
            channel_id,
            exc.code,
            raw,
        )
        return result
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        result = DiscordSendResult(ok=False, error=str(exc))
        logger.error(
            "discord approval notify failed channel=%s error=%s",
            channel_id,
            exc,
        )
        return result


DiscordMessageSender = Callable[[str], Awaitable[DiscordSendResult]]
