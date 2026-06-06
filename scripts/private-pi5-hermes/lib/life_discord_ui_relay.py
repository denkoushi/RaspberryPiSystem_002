#!/usr/bin/env python3
"""Discord component UI relay for Hermes Life Pilot."""

from __future__ import annotations

import argparse
import asyncio
import os
from pathlib import Path
from typing import Any

try:
    import discord
except ImportError:  # pragma: no cover - validated on Pi5 runtime.
    discord = None  # type: ignore[assignment]

try:
    from .life_discord_inbox import (
        capture_discord_inbox_message,
        extract_attachment_names,
        extract_discord_message_id,
        extract_discord_message_text,
    )
    from .life_proactive_loop import remember_life_discord_context, resolve_proactive_reply
except ImportError:
    from life_discord_inbox import (
        capture_discord_inbox_message,
        extract_attachment_names,
        extract_discord_message_id,
        extract_discord_message_text,
    )
    from life_proactive_loop import remember_life_discord_context, resolve_proactive_reply


CUSTOM_PREFIX = "life:"


def parse_custom_id(custom_id: str) -> tuple[str, str, str]:
    """Return (action, checkin_id, option_id) for Life Pilot component ids."""
    parts = str(custom_id or "").split(":")
    if len(parts) == 4 and parts[0] == "life" and parts[1] == "reply":
        return "reply", parts[2], parts[3]
    if len(parts) == 3 and parts[0] == "life" and parts[1] == "free":
        return "free", parts[2], ""
    if len(parts) == 3 and parts[0] == "life" and parts[1] == "modal":
        return "modal", parts[2], ""
    return "", "", ""


def _allowed_users_from_env() -> set[str]:
    raw = os.environ.get("DISCORD_ALLOWED_USERS", "")
    return {item.strip() for item in raw.replace(",", " ").split() if item.strip()}


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None or str(raw).strip() == "":
        return default
    return str(raw).strip().lower() in {"1", "true", "yes", "on"}


def _interaction_user_id(interaction: Any) -> str:
    user = getattr(interaction, "user", None)
    return str(getattr(user, "id", "") or "").strip()


def _interaction_channel_id(interaction: Any) -> str:
    channel = getattr(interaction, "channel", None)
    channel_id = str(getattr(interaction, "channel_id", "") or "").strip()
    if channel_id:
        return channel_id
    return str(getattr(channel, "id", "") or "").strip()


def _message_user_id(message: Any) -> str:
    author = getattr(message, "author", None)
    return str(getattr(author, "id", "") or "").strip()


def _message_channel_id(message: Any) -> str:
    channel = getattr(message, "channel", None)
    return str(getattr(channel, "id", "") or "").strip()


def _message_is_bot(message: Any) -> bool:
    author = getattr(message, "author", None)
    return bool(getattr(author, "bot", False))


def _message_has_embeds(message: Any) -> bool:
    try:
        return bool(list(getattr(message, "embeds", []) or []))
    except TypeError:
        return bool(getattr(message, "embeds", None))


def _message_has_share_surface(message: Any) -> bool:
    text = extract_discord_message_text(message)
    lower = text.lower()
    return (
        bool(extract_attachment_names(message))
        or _message_has_embeds(message)
        or "添付ファイル" in text
        or "attachment" in lower
    )


def _capture_shared_message(message: Any, storage_root: Path) -> str | None:
    if not _env_bool("HERMES_LIFE_DISCORD_INBOX_ENABLED", True):
        return None
    if not _message_has_share_surface(message):
        return None
    user_id = _message_user_id(message)
    channel_id = _message_channel_id(message)
    try:
        result = capture_discord_inbox_message(
            storage_root,
            extract_discord_message_text(message),
            user_id=user_id,
            channel_id=channel_id,
            attachments=extract_attachment_names(message),
            message_id=extract_discord_message_id(message),
        )
    except (OSError, ValueError, RuntimeError):
        return None
    if not result.captured:
        return None
    if channel_id:
        try:
            remember_life_discord_context(user_id, channel_id, storage_root=storage_root)
        except (OSError, ValueError, RuntimeError):
            pass
    return result.ack


def _extract_modal_text(interaction: Any) -> str:
    data = getattr(interaction, "data", None)
    if not isinstance(data, dict):
        return ""
    for row in data.get("components", []):
        if not isinstance(row, dict):
            continue
        for component in row.get("components", []):
            if isinstance(component, dict) and component.get("custom_id") == "life_free_text":
                return str(component.get("value", "") or "").strip()
    return ""


def _resolve_reply_text(
    text: str,
    *,
    storage_root: Path,
    interaction: Any,
    checkin_id: str,
) -> str:
    result = resolve_proactive_reply(
        text,
        storage_root=storage_root,
        user_id=_interaction_user_id(interaction),
        channel_id=_interaction_channel_id(interaction),
        checkin_id=checkin_id,
    )
    if result is None:
        return "返信待ちの朝晩確認がありません。次の確認が届いたらボタンで返してください。"
    return result


async def _send_interaction_message(interaction: Any, content: str) -> None:
    content = content[:2000]
    response = getattr(interaction, "response", None)
    if response is not None and not response.is_done():
        await response.send_message(content)
        return
    followup = getattr(interaction, "followup", None)
    if followup is not None:
        await followup.send(content)


def _make_free_text_modal(checkin_id: str):
    if discord is None:
        raise RuntimeError("discord.py is required")

    class LifeFreeTextModal(discord.ui.Modal):
        reply = discord.ui.TextInput(
            label="返信",
            custom_id="life_free_text",
            style=discord.TextStyle.paragraph,
            max_length=500,
            required=True,
        )

        def __init__(self) -> None:
            super().__init__(title="Hermesへ返信", custom_id=f"life:modal:{checkin_id}")

    return LifeFreeTextModal()


def build_client(storage_root: Path):
    if discord is None:
        raise RuntimeError("discord.py is required for Life Pilot Discord UI relay")
    intents = discord.Intents.default()
    intents.message_content = True
    intents.messages = True
    intents.dm_messages = True
    client = discord.Client(intents=intents)
    allowed_users = _allowed_users_from_env()

    @client.event
    async def on_ready() -> None:
        user = getattr(client, "user", None)
        print(f"life_discord_ui_relay ready user={user}", flush=True)

    @client.event
    async def on_message(message: Any) -> None:
        if _message_is_bot(message):
            return
        user_id = _message_user_id(message)
        if allowed_users and user_id not in allowed_users:
            return
        ack = _capture_shared_message(message, storage_root)
        if not ack:
            return
        channel = getattr(message, "channel", None)
        send = getattr(channel, "send", None)
        if callable(send):
            await send(ack[:2000])

    @client.event
    async def on_interaction(interaction: Any) -> None:
        data = getattr(interaction, "data", None)
        if not isinstance(data, dict):
            return
        custom_id = str(data.get("custom_id", "") or "")
        if not custom_id.startswith(CUSTOM_PREFIX):
            return
        user_id = _interaction_user_id(interaction)
        if allowed_users and user_id not in allowed_users:
            await _send_interaction_message(interaction, "このLife Pilot操作は許可ユーザーのみです。")
            return
        action, checkin_id, option_id = parse_custom_id(custom_id)
        if action == "reply":
            content = _resolve_reply_text(
                option_id,
                storage_root=storage_root,
                interaction=interaction,
                checkin_id=checkin_id,
            )
            await _send_interaction_message(interaction, content)
            return
        if action == "free":
            await interaction.response.send_modal(_make_free_text_modal(checkin_id))
            return
        if action == "modal":
            text = _extract_modal_text(interaction)
            content = _resolve_reply_text(
                text,
                storage_root=storage_root,
                interaction=interaction,
                checkin_id=checkin_id,
            )
            await _send_interaction_message(interaction, content)

    return client


async def run_ui_relay(token: str, storage_root: Path) -> None:
    client = build_client(storage_root)
    await client.start(token)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--storage-root",
        default=os.environ.get("LIFE_PILOT_STORAGE_ROOT", "/home/hermes/.hermes-life"),
    )
    args = parser.parse_args()
    token = os.environ.get("DISCORD_BOT_TOKEN", "").strip()
    if not token:
        raise SystemExit("DISCORD_BOT_TOKEN is not set")
    asyncio.run(run_ui_relay(token, Path(args.storage_root)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
