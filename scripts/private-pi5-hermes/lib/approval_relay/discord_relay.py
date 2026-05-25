#!/usr/bin/env python3
"""Discord-facing approval relay helpers (Phase D5.1)."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Awaitable, Callable

try:
    from .models import ApprovalChoice, ApprovalRequest
except ImportError:
    from models import ApprovalChoice, ApprovalRequest


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


async def send_discord_channel_message(channel_id: str, content: str) -> bool:
    """Best-effort Discord REST send using DISCORD_BOT_TOKEN from gateway env."""
    token = (os.environ.get("DISCORD_BOT_TOKEN") or "").strip()
    if not token or not channel_id or not content:
        return False

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
            return 200 <= resp.status < 300
    except (urllib.error.URLError, TimeoutError, ValueError):
        return False


DiscordMessageSender = Callable[[str], Awaitable[bool]]
