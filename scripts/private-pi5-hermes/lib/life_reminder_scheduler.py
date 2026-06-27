#!/usr/bin/env python3
"""Dispatch due Life Pilot reminders to Discord."""

from __future__ import annotations

import argparse
import json
import os
import tempfile
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

try:
    from .discord_life_pilot_bridge import (
        _clip_line,
        _parse_due_at_item,
        _reminder_file_lock,
        _render_debug_line,
        _timestamp,
    )
except ImportError:
    from discord_life_pilot_bridge import (
        _clip_line,
        _parse_due_at_item,
        _reminder_file_lock,
        _render_debug_line,
        _timestamp,
    )

DISCORD_API_BASE = "https://discord.com/api/v10"
DISCORD_USER_AGENT = (
    "DiscordBot (https://github.com/denkoushi/RaspberryPiSystem_002, 1.0)"
)


@dataclass(frozen=True)
class DiscordSendResult:
    ok: bool
    status_code: int = 0
    error: str = ""


@dataclass(frozen=True)
class ReminderDispatchResult:
    ok: bool
    sent: int = 0
    failed: int = 0
    skipped_missing_channel: int = 0
    scanned: int = 0


ReminderSender = Callable[[str, str], DiscordSendResult]


def _discord_debug_lines_enabled() -> bool:
    return os.environ.get("HERMES_LIFE_DISCORD_DEBUG_LINES", "").lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def _reminders_path(storage_root: Path) -> Path:
    return storage_root / "reminders" / "reminders.jsonl"


def _read_jsonl(path: Path) -> list[tuple[dict[str, Any] | None, str]]:
    if not path.is_file():
        return []
    rows: list[tuple[dict[str, Any] | None, str]] = []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        if not line.strip():
            continue
        try:
            item = json.loads(line)
        except json.JSONDecodeError:
            rows.append((None, line))
            continue
        if isinstance(item, dict):
            rows.append((item, ""))
        else:
            rows.append((None, line))
    return rows


def _write_jsonl(path: Path, rows: list[tuple[dict[str, Any] | None, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        "w",
        encoding="utf-8",
        dir=path.parent,
        delete=False,
    ) as handle:
        tmp_path = Path(handle.name)
        for item, raw in rows:
            if item is None:
                handle.write(raw.rstrip("\n") + "\n")
            else:
                handle.write(json.dumps(item, ensure_ascii=False, sort_keys=True) + "\n")
    tmp_path.replace(path)


def format_reminder_notification(item: dict[str, Any]) -> str:
    text = _clip_line(str(item.get("text", "") or ""), 700)
    due_at = _parse_due_at_item(item)
    due = _timestamp(due_at) if due_at is not None else "unknown"
    if not _discord_debug_lines_enabled():
        return text
    return f"""{text}

{_render_debug_line(reminder="due", due=due, boundary="local-only/no-tools")}
""".strip()


def send_discord_channel_message(
    token: str,
    channel_id: str,
    content: str,
    *,
    base_url: str = DISCORD_API_BASE,
    components: list[dict[str, Any]] | None = None,
) -> DiscordSendResult:
    cleaned_token = token.strip()
    cleaned_channel = channel_id.strip()
    if not cleaned_token:
        return DiscordSendResult(ok=False, error="DISCORD_BOT_TOKEN is not set")
    if not cleaned_channel:
        return DiscordSendResult(ok=False, error="notify channel is empty")
    if not content.strip():
        return DiscordSendResult(ok=False, error="message content is empty")

    payload: dict[str, Any] = {"content": content[:2000]}
    if components:
        payload["components"] = components
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        f"{base_url.rstrip('/')}/channels/{cleaned_channel}/messages",
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bot {cleaned_token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": DISCORD_USER_AGENT,
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            status = int(response.getcode())
            return DiscordSendResult(ok=200 <= status < 300, status_code=status)
    except urllib.error.HTTPError as exc:
        return DiscordSendResult(ok=False, status_code=int(exc.code), error=str(exc.reason))
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        return DiscordSendResult(ok=False, error=str(exc))


def _env_sender() -> ReminderSender:
    token = os.environ.get("DISCORD_BOT_TOKEN", "")

    def _send(channel_id: str, content: str) -> DiscordSendResult:
        return send_discord_channel_message(token, channel_id, content)

    return _send


def dispatch_due_reminders(
    storage_root: Path,
    *,
    now: datetime | None = None,
    sender: ReminderSender | None = None,
) -> ReminderDispatchResult:
    current = now or datetime.now().astimezone()
    reminders_path = _reminders_path(storage_root)
    send = sender or _env_sender()
    sent = 0
    failed = 0
    skipped = 0
    scanned = 0
    changed = False

    with _reminder_file_lock(storage_root):
        rows = _read_jsonl(reminders_path)
        for item, _raw in rows:
            if item is None or item.get("status") != "pending" or item.get("notifiedAt"):
                continue
            due_at = _parse_due_at_item(item)
            if due_at is None or due_at > current:
                continue
            scanned += 1
            channel_id = str(item.get("notifyChannelId", "") or "").strip()
            if not channel_id:
                skipped += 1
                continue
            result = send(channel_id, format_reminder_notification(item))
            if result.ok:
                item["status"] = "notified"
                item["notifiedAt"] = current.isoformat(timespec="seconds")
                item["notification"] = "sent"
                sent += 1
                changed = True
            else:
                item["lastNotifyAttemptAt"] = current.isoformat(timespec="seconds")
                item["lastNotifyError"] = result.error or f"HTTP {result.status_code}"
                failed += 1
                changed = True
        if changed:
            _write_jsonl(reminders_path, rows)

    return ReminderDispatchResult(
        ok=failed == 0,
        sent=sent,
        failed=failed,
        skipped_missing_channel=skipped,
        scanned=scanned,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--storage-root",
        default=os.environ.get("LIFE_PILOT_STORAGE_ROOT", "/home/hermes/.hermes-life"),
    )
    args = parser.parse_args()
    result = dispatch_due_reminders(Path(args.storage_root))
    print(
        json.dumps(
            {
                "ok": result.ok,
                "sent": result.sent,
                "failed": result.failed,
                "skipped_missing_channel": result.skipped_missing_channel,
                "scanned": result.scanned,
            },
            sort_keys=True,
        )
    )
    return 0 if result.ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
