#!/usr/bin/env python3
"""Send proactive Life Pilot check-ins and capture simple replies."""

from __future__ import annotations

import argparse
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta
import json
import os
import re
import tempfile
from pathlib import Path
from typing import Any, Callable, Iterator

try:
    import fcntl
except ImportError:  # pragma: no cover
    fcntl = None  # type: ignore[assignment]

try:
    from .discord_life_pilot_bridge import (
        LifePilotPolicy,
        _append_memo,
        _clip_line,
        _date_key,
        _ensure_storage,
        _parse_due_at_item,
        _read_note_entries,
        _read_pending_reminders,
        _render_debug_line,
        _storage_root,
        _timestamp,
        load_life_pilot_policy,
        validate_life_prompt,
    )
    from .life_reminder_scheduler import (
        DiscordSendResult,
        send_discord_channel_message,
    )
except ImportError:
    from discord_life_pilot_bridge import (
        LifePilotPolicy,
        _append_memo,
        _clip_line,
        _date_key,
        _ensure_storage,
        _parse_due_at_item,
        _read_note_entries,
        _read_pending_reminders,
        _render_debug_line,
        _storage_root,
        _timestamp,
        load_life_pilot_policy,
        validate_life_prompt,
    )
    from life_reminder_scheduler import (
        DiscordSendResult,
        send_discord_channel_message,
    )


CHECKIN_MODES = {"morning", "evening", "followup"}


@dataclass(frozen=True)
class ProactiveDispatchResult:
    ok: bool
    sent: int = 0
    skipped_duplicate: int = 0
    skipped_missing_channel: int = 0
    failed: int = 0
    mode: str = ""
    checkin_id: str = ""


ProactiveSender = Callable[[str, str], DiscordSendResult]


def _now() -> datetime:
    return datetime.now().astimezone()


def _context_path(root: Path) -> Path:
    return root / "context" / "discord.json"


def _checkins_path(root: Path) -> Path:
    return root / "proactive" / "checkins.jsonl"


def _replies_path(root: Path) -> Path:
    return root / "proactive" / "replies.jsonl"


def _followups_path(root: Path) -> Path:
    return root / "proactive" / "followups.jsonl"


@contextmanager
def _proactive_file_lock(root: Path) -> Iterator[None]:
    _ensure_storage(root)
    (root / "proactive").mkdir(parents=True, exist_ok=True)
    lock_path = root / "proactive" / ".proactive.lock"
    with lock_path.open("a+", encoding="utf-8") as handle:
        if fcntl is not None:
            fcntl.flock(handle, fcntl.LOCK_EX)
        try:
            yield
        finally:
            if fcntl is not None:
                fcntl.flock(handle, fcntl.LOCK_UN)


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        return []
    rows: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        if not line.strip():
            continue
        try:
            item = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(item, dict):
            rows.append(item)
    return rows


def _write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        "w",
        encoding="utf-8",
        dir=path.parent,
        delete=False,
    ) as handle:
        tmp_path = Path(handle.name)
        for item in rows:
            handle.write(json.dumps(item, ensure_ascii=False, sort_keys=True) + "\n")
    tmp_path.replace(path)


def _append_jsonl(path: Path, item: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(item, ensure_ascii=False, sort_keys=True) + "\n")


def remember_life_discord_context(
    user_id: str,
    channel_id: str,
    policy: LifePilotPolicy | None = None,
    storage_root: Path | None = None,
    *,
    now: datetime | None = None,
) -> bool:
    """Remember the latest Discord channel for proactive Life Pilot messages."""
    clean_channel = str(channel_id or "").strip()
    if not clean_channel:
        return False
    loaded_policy = policy or load_life_pilot_policy()
    root = _storage_root(loaded_policy, storage_root)
    _ensure_storage(root)
    path = _context_path(root)
    path.parent.mkdir(parents=True, exist_ok=True)
    current = now or _now()
    payload = {
        "updatedAt": current.isoformat(timespec="seconds"),
        "userId": str(user_id or "").strip(),
        "channelId": clean_channel,
    }
    path.write_text(json.dumps(payload, ensure_ascii=False, sort_keys=True) + "\n", encoding="utf-8")
    return True


def _read_context(root: Path) -> tuple[str, str]:
    path = _context_path(root)
    if not path.is_file():
        return "", ""
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return "", ""
    if not isinstance(payload, dict):
        return "", ""
    return (
        str(payload.get("userId", "") or "").strip(),
        str(payload.get("channelId", "") or "").strip(),
    )


def _latest_reminder_context(root: Path) -> tuple[str, str]:
    path = root / "reminders" / "reminders.jsonl"
    if not path.is_file():
        return "", ""
    for line in reversed(path.read_text(encoding="utf-8", errors="replace").splitlines()):
        if not line.strip():
            continue
        try:
            item = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(item, dict):
            continue
        channel_id = str(item.get("notifyChannelId", "") or "").strip()
        if channel_id:
            return str(item.get("notifyUserId", "") or "").strip(), channel_id
    return "", ""


def _resolve_context(
    root: Path,
    *,
    channel_id: str = "",
    user_id: str = "",
) -> tuple[str, str]:
    clean_channel = str(channel_id or "").strip()
    clean_user = str(user_id or "").strip()
    if clean_channel:
        return clean_user, clean_channel
    context_user, context_channel = _read_context(root)
    if context_channel:
        return context_user, context_channel
    return _latest_reminder_context(root)


def _option_rows(mode: str) -> list[dict[str, str]]:
    if mode == "morning":
        return [
            {"id": "1", "label": "これをやる"},
            {"id": "2", "label": "夕方にもう一度"},
            {"id": "3", "label": "今日は外す"},
        ]
    if mode == "followup":
        return [
            {"id": "1", "label": "やる"},
            {"id": "2", "label": "明日に回す"},
            {"id": "3", "label": "外す"},
        ]
    return [
        {"id": "1", "label": "終わった"},
        {"id": "2", "label": "明日に回す"},
        {"id": "3", "label": "メモだけ残す"},
    ]


def _format_options(mode: str) -> str:
    lines = [f"[{item['id']}] {item['label']}" for item in _option_rows(mode)]
    lines.append("ボタンで返信できます。うまく出ない時だけ /life-reply 1 を使ってください。")
    return "\n".join(lines)


def build_proactive_components(checkin_id: str, mode: str) -> list[dict[str, Any]]:
    buttons: list[dict[str, Any]] = []
    styles = {"1": 1, "2": 2, "3": 2}
    for item in _option_rows(mode):
        option_id = item["id"]
        buttons.append(
            {
                "type": 2,
                "style": styles.get(option_id, 2),
                "custom_id": f"life:reply:{checkin_id}:{option_id}",
                "label": item["label"][:80],
            }
        )
    buttons.append(
        {
            "type": 2,
            "style": 2,
            "custom_id": f"life:free:{checkin_id}",
            "label": "自由入力",
        }
    )
    return [{"type": 1, "components": buttons}]


def _scheduled_for_day(reminders: list[dict[str, Any]], now: datetime) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    today = now.date()
    for item in reminders:
        due_at = _parse_due_at_item(item)
        if due_at is not None and due_at.date() <= today:
            items.append(item)
    items.sort(key=lambda item: _parse_due_at_item(item) or datetime.max.replace(tzinfo=now.tzinfo))
    return items


def _scheduled_next(reminders: list[dict[str, Any]], now: datetime) -> list[dict[str, Any]]:
    items = [item for item in reminders if _parse_due_at_item(item) is not None]
    items.sort(key=lambda item: _parse_due_at_item(item) or datetime.max.replace(tzinfo=now.tzinfo))
    return items


def _unscheduled(reminders: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [item for item in reminders if _parse_due_at_item(item) is None]


def _candidate_text(item: dict[str, Any]) -> str:
    return _clip_line(str(item.get("text", "") or ""), 90)


def _choose_morning_candidate(
    reminders: list[dict[str, Any]],
    entries: list[tuple[str, str]],
    now: datetime,
) -> dict[str, str]:
    today_items = _scheduled_for_day(reminders, now)
    if today_items:
        return {"source": "due_today", "text": _candidate_text(today_items[0])}
    unscheduled = _unscheduled(reminders)
    if unscheduled:
        return {"source": "unscheduled", "text": _candidate_text(unscheduled[0])}
    next_items = _scheduled_next(reminders, now)
    if next_items:
        return {"source": "scheduled", "text": _candidate_text(next_items[0])}
    if entries:
        return {"source": "recent_note", "text": f"最近のメモを見返す: {_clip_line(entries[0][1], 70)}"}
    return {"source": "empty", "text": ""}


def _remaining_candidate_lines(
    reminders: list[dict[str, Any]],
    candidate_text: str,
    now: datetime,
    *,
    limit: int = 4,
) -> str:
    ordered = _scheduled_for_day(reminders, now) + _unscheduled(reminders) + _scheduled_next(reminders, now)
    lines: list[str] = []
    seen: set[str] = set()
    for item in ordered:
        text = _candidate_text(item)
        if not text or text == candidate_text or text in seen:
            continue
        seen.add(text)
        lines.append(f"- {text}")
        if len(lines) >= limit:
            break
    if not lines:
        return "- ほかの未処理用事はありません。"
    return "\n".join(lines)


def _reminder_lines(items: list[dict[str, Any]], empty: str, limit: int = 4) -> str:
    if not items:
        return f"- {empty}"
    lines: list[str] = []
    for item in items[:limit]:
        due_at = _parse_due_at_item(item)
        text = _clip_line(str(item.get("text", "") or ""), 90)
        if due_at is None:
            lines.append(f"- {text}")
        else:
            lines.append(f"- {_timestamp(due_at)}: {text}")
    return "\n".join(lines)


def _note_lines(entries: list[tuple[str, str]], empty: str, limit: int = 3) -> str:
    if not entries:
        return f"- {empty}"
    return "\n".join(f"- {when}: {_clip_line(body, 90)}" for when, body in entries[:limit])


def _latest_daily_candidate(root: Path, now: datetime) -> str:
    today_prefix = f"{_date_key(now)}-"
    rows = _read_jsonl(_checkins_path(root))
    for item in reversed(rows):
        if str(item.get("mode", "") or "") not in {"morning", "followup"}:
            continue
        if not str(item.get("id", "") or "").startswith(today_prefix):
            continue
        candidate = str(item.get("candidateText", "") or "").strip()
        if candidate:
            return candidate
    return ""


def build_followup_checkin_message(
    candidate_text: str,
    *,
    now: datetime | None = None,
) -> str:
    candidate = _clip_line(candidate_text, 180) or "さっきの用事"
    return f"""さっきの確認です。

今ならこれだけ見ますか:
{candidate}

返信:
{_format_options("followup")}

{_render_debug_line(checkin="followup", boundary="local-only/no-tools")}
""".strip()


def build_proactive_checkin_message(
    mode: str,
    storage_root: Path,
    *,
    now: datetime | None = None,
) -> str:
    current = now or _now()
    reminders = _read_pending_reminders(storage_root, limit=20)
    entries = _read_note_entries(storage_root, limit=8)
    if mode == "morning":
        today_items = _scheduled_for_day(reminders, current)
        unscheduled = _unscheduled(reminders)
        candidate = _choose_morning_candidate(reminders, entries, current)
        candidate_text = candidate["text"]
        candidate_display = candidate_text or "今日は急ぎの候補はありません。"
        return f"""おはようございます。今日の確認です。

今日まず見るなら:
{candidate_display}

ほかに残っているもの:
{_remaining_candidate_lines(reminders, candidate_text, current, limit=3)}

今日見るもの:
{_reminder_lines(today_items, "今日までの予定はありません。")}

日時がない用事:
{_reminder_lines(unscheduled, "日時なしの用事はありません。", limit=3)}

最近のメモ:
{_note_lines(entries, "まだメモがありません。", limit=2)}

返信:
{_format_options(mode)}

{_render_debug_line(checkin=mode, boundary="local-only/no-tools")}
""".strip()

    today_key = _date_key(current)
    today_entries = [entry for entry in entries if entry[0].startswith(today_key)]
    next_items = _scheduled_next(reminders, current)
    daily_candidate = _latest_daily_candidate(storage_root, current)
    candidate_block = (
        f"\n朝に見ていたもの:\n{_clip_line(daily_candidate, 180)}\n"
        if daily_candidate
        else ""
    )
    return f"""こんばんは。今日の片付けです。
{candidate_block}

今日のメモ:
{_note_lines(today_entries, "今日のメモはまだありません。", limit=4)}

残っている用事:
{_reminder_lines(next_items, "日時つきの未処理用事はありません。", limit=4)}

返信:
{_format_options(mode)}

{_render_debug_line(checkin=mode, boundary="local-only/no-tools")}
""".strip()


def _checkin_candidate(mode: str, storage_root: Path, now: datetime) -> dict[str, str]:
    if mode == "morning":
        return _choose_morning_candidate(
            _read_pending_reminders(storage_root, limit=20),
            _read_note_entries(storage_root, limit=8),
            now,
        )
    if mode == "evening":
        text = _latest_daily_candidate(storage_root, now)
        return {"source": "daily_candidate", "text": text} if text else {"source": "empty", "text": ""}
    return {"source": "empty", "text": ""}


def _checkin_id(mode: str, now: datetime) -> str:
    return f"{_date_key(now)}-{mode}"


def _env_sender(
    *,
    checkin_id: str = "",
    mode: str = "",
) -> ProactiveSender:
    token = os.environ.get("DISCORD_BOT_TOKEN", "")

    def _send(channel_id: str, content: str) -> DiscordSendResult:
        components = build_proactive_components(checkin_id, mode) if checkin_id and mode else None
        return send_discord_channel_message(token, channel_id, content, components=components)

    return _send


def dispatch_proactive_checkin(
    storage_root: Path,
    mode: str,
    *,
    now: datetime | None = None,
    sender: ProactiveSender | None = None,
    channel_id: str = "",
    user_id: str = "",
) -> ProactiveDispatchResult:
    if mode not in CHECKIN_MODES:
        raise ValueError(f"unsupported proactive mode: {mode}")
    if mode == "followup":
        return dispatch_due_followups(
            storage_root,
            now=now,
            sender=sender,
            channel_id=channel_id,
            user_id=user_id,
        )
    current = now or _now()
    checkin_id = _checkin_id(mode, current)
    send = sender or _env_sender(checkin_id=checkin_id, mode=mode)
    context_user, context_channel = _resolve_context(
        storage_root,
        channel_id=channel_id,
        user_id=user_id,
    )
    if not context_channel:
        return ProactiveDispatchResult(
            ok=True,
            skipped_missing_channel=1,
            mode=mode,
            checkin_id=checkin_id,
        )
    content = build_proactive_checkin_message(mode, storage_root, now=current)
    candidate = _checkin_candidate(mode, storage_root, current)
    with _proactive_file_lock(storage_root):
        rows = _read_jsonl(_checkins_path(storage_root))
        for item in rows:
            if item.get("id") == checkin_id and item.get("status") != "send_failed":
                return ProactiveDispatchResult(
                    ok=True,
                    skipped_duplicate=1,
                    mode=mode,
                    checkin_id=checkin_id,
                )
        result = send(context_channel, content)
        record = {
            "id": checkin_id,
            "createdAt": current.isoformat(timespec="seconds"),
            "mode": mode,
            "channelId": context_channel,
            "userId": context_user,
            "options": _option_rows(mode),
            "status": "pending_reply" if result.ok else "send_failed",
        }
        if candidate["text"]:
            record["candidateText"] = candidate["text"]
            record["candidateSource"] = candidate["source"]
        if result.ok:
            record["sentAt"] = current.isoformat(timespec="seconds")
            sent = 1
            failed = 0
        else:
            record["lastSendError"] = result.error or f"HTTP {result.status_code}"
            sent = 0
            failed = 1
        rows = [item for item in rows if item.get("id") != checkin_id]
        rows.append(record)
        _write_jsonl(_checkins_path(storage_root), rows)
    return ProactiveDispatchResult(
        ok=failed == 0,
        sent=sent,
        failed=failed,
        mode=mode,
        checkin_id=checkin_id,
    )


def _parse_iso_datetime(value: str, fallback_tz: Any) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=fallback_tz)
    return parsed


def _followup_due_at(now: datetime) -> datetime:
    due_at = now.replace(hour=17, minute=0, second=0, microsecond=0)
    if due_at <= now:
        due_at = now + timedelta(hours=2)
    return due_at


def _next_followup_id(rows: list[dict[str, Any]], source_checkin_id: str) -> str:
    prefix = f"{source_checkin_id}-followup-"
    used: set[int] = set()
    for item in rows:
        item_id = str(item.get("id", "") or "")
        if not item_id.startswith(prefix):
            continue
        suffix = item_id.removeprefix(prefix)
        if suffix.isdigit():
            used.add(int(suffix))
    index = 1
    while index in used:
        index += 1
    return f"{prefix}{index}"


def _schedule_followup(
    root: Path,
    checkin: dict[str, Any],
    now: datetime,
    *,
    reason: str,
) -> dict[str, Any] | None:
    candidate = str(checkin.get("candidateText", "") or "").strip()
    if not candidate:
        return None
    rows = _read_jsonl(_followups_path(root))
    source_checkin_id = str(checkin.get("id", "") or "").strip()
    followup = {
        "id": _next_followup_id(rows, source_checkin_id),
        "sourceCheckinId": source_checkin_id,
        "createdAt": now.isoformat(timespec="seconds"),
        "dueAt": _followup_due_at(now).isoformat(timespec="seconds"),
        "status": "pending",
        "channelId": str(checkin.get("channelId", "") or "").strip(),
        "userId": str(checkin.get("userId", "") or "").strip(),
        "reason": reason,
        "candidateText": candidate,
    }
    rows.append(followup)
    _write_jsonl(_followups_path(root), rows)
    return followup


def dispatch_due_followups(
    storage_root: Path,
    *,
    now: datetime | None = None,
    sender: ProactiveSender | None = None,
    channel_id: str = "",
    user_id: str = "",
) -> ProactiveDispatchResult:
    current = now or _now()
    sent = 0
    failed = 0
    skipped_missing = 0
    last_checkin_id = ""
    with _proactive_file_lock(storage_root):
        followups = _read_jsonl(_followups_path(storage_root))
        checkins = _read_jsonl(_checkins_path(storage_root))
        changed = False
        for followup in followups:
            if followup.get("status") != "pending":
                continue
            due_at = _parse_iso_datetime(str(followup.get("dueAt", "") or ""), current.tzinfo)
            if due_at is None or due_at > current:
                continue
            followup_channel = str(channel_id or followup.get("channelId", "") or "").strip()
            followup_user = str(user_id or followup.get("userId", "") or "").strip()
            if not followup_channel:
                followup["lastSendAttemptAt"] = current.isoformat(timespec="seconds")
                followup["lastSendError"] = "notify channel is empty"
                skipped_missing += 1
                changed = True
                continue
            checkin_id = str(followup.get("id", "") or "").strip()
            if any(
                item.get("id") == checkin_id and item.get("status") != "send_failed"
                for item in checkins
            ):
                followup["status"] = "sent"
                followup["sentAt"] = current.isoformat(timespec="seconds")
                changed = True
                continue
            candidate = str(followup.get("candidateText", "") or "").strip()
            send = sender or _env_sender(checkin_id=checkin_id, mode="followup")
            result = send(followup_channel, build_followup_checkin_message(candidate, now=current))
            followup["lastSendAttemptAt"] = current.isoformat(timespec="seconds")
            if result.ok:
                followup["status"] = "sent"
                followup["sentAt"] = current.isoformat(timespec="seconds")
                checkins.append(
                    {
                        "id": checkin_id,
                        "createdAt": current.isoformat(timespec="seconds"),
                        "sentAt": current.isoformat(timespec="seconds"),
                        "mode": "followup",
                        "sourceCheckinId": followup.get("sourceCheckinId", ""),
                        "followupReason": followup.get("reason", ""),
                        "candidateText": candidate,
                        "candidateSource": "followup",
                        "channelId": followup_channel,
                        "userId": followup_user,
                        "options": _option_rows("followup"),
                        "status": "pending_reply",
                    }
                )
                sent += 1
                last_checkin_id = checkin_id
            else:
                followup["lastSendError"] = result.error or f"HTTP {result.status_code}"
                failed += 1
            changed = True
        if changed:
            _write_jsonl(_followups_path(storage_root), followups)
            _write_jsonl(_checkins_path(storage_root), checkins)
    return ProactiveDispatchResult(
        ok=failed == 0,
        sent=sent,
        skipped_missing_channel=skipped_missing,
        failed=failed,
        mode="followup",
        checkin_id=last_checkin_id,
    )


def _match_pending_checkin(
    rows: list[dict[str, Any]],
    *,
    user_id: str = "",
    channel_id: str = "",
    checkin_id: str = "",
    now: datetime,
) -> dict[str, Any] | None:
    clean_user = str(user_id or "").strip()
    clean_channel = str(channel_id or "").strip()
    cutoff = now - timedelta(hours=36)
    for item in reversed(rows):
        if item.get("status") != "pending_reply":
            continue
        if checkin_id and str(item.get("id", "") or "") != checkin_id:
            continue
        item_channel = str(item.get("channelId", "") or "").strip()
        item_user = str(item.get("userId", "") or "").strip()
        if clean_channel and item_channel and clean_channel != item_channel:
            continue
        if clean_user and item_user and clean_user != item_user:
            continue
        try:
            sent_at = datetime.fromisoformat(str(item.get("sentAt") or item.get("createdAt")))
        except ValueError:
            sent_at = now
        if sent_at.tzinfo is None:
            sent_at = sent_at.replace(tzinfo=now.tzinfo)
        if sent_at < cutoff:
            continue
        return item
    return None


def _parse_reply(text: str, checkin: dict[str, Any]) -> tuple[str, str, str]:
    clean = " ".join((text or "").strip().split())
    match = re.match(r"^([1-3])(?:[.)、:：\s]|$)(.*)$", clean)
    options = {
        str(item.get("id", "")): str(item.get("label", ""))
        for item in checkin.get("options", [])
        if isinstance(item, dict)
    }
    if match and match.group(1) in options:
        selected = match.group(1)
        detail = match.group(2).strip()
        label = options[selected]
        response = f"{label}: {detail}" if detail else label
        return "choice", selected, response
    return "manual", "", clean


def resolve_proactive_reply(
    text: str,
    policy: LifePilotPolicy | None = None,
    storage_root: Path | None = None,
    *,
    user_id: str = "",
    channel_id: str = "",
    checkin_id: str = "",
    now: datetime | None = None,
) -> str | None:
    clean = " ".join((text or "").strip().split())
    if not clean or clean.startswith("/"):
        return None
    loaded_policy = policy or load_life_pilot_policy()
    root = _storage_root(loaded_policy, storage_root)
    current = now or _now()
    with _proactive_file_lock(root):
        rows = _read_jsonl(_checkins_path(root))
        checkin = _match_pending_checkin(
            rows,
            user_id=user_id,
            channel_id=channel_id,
            checkin_id=checkin_id,
            now=current,
        )
        if checkin is None:
            return None
        method, selected, response = _parse_reply(clean, checkin)
        validation = validate_life_prompt(response, loaded_policy)
        if not validation.ok:
            return f"reply rejected: {validation.reason}"
        scheduled_followup = None
        if checkin.get("mode") == "morning" and selected == "2":
            scheduled_followup = _schedule_followup(root, checkin, current, reason="snooze")
        reply = {
            "checkinId": checkin.get("id", ""),
            "mode": checkin.get("mode", ""),
            "repliedAt": current.isoformat(timespec="seconds"),
            "method": method,
            "selectedOption": selected,
            "rawText": clean,
            "response": response,
            "channelId": str(channel_id or checkin.get("channelId", "") or "").strip(),
            "userId": str(user_id or checkin.get("userId", "") or "").strip(),
        }
        if scheduled_followup is not None:
            reply["followupId"] = scheduled_followup.get("id", "")
            reply["followupDueAt"] = scheduled_followup.get("dueAt", "")
        _append_jsonl(_replies_path(root), reply)
        for item in rows:
            if item.get("id") == checkin.get("id"):
                item["status"] = "answered"
                item["answeredAt"] = current.isoformat(timespec="seconds")
                item["answerMethod"] = method
                item["answerText"] = response
                if selected:
                    item["selectedOption"] = selected
                if scheduled_followup is not None:
                    item["followupId"] = scheduled_followup.get("id", "")
                    item["followupDueAt"] = scheduled_followup.get("dueAt", "")
                break
        _write_jsonl(_checkins_path(root), rows)
        mode = str(checkin.get("mode", "") or "")
        if mode == "followup":
            memo_label = "Hermes再確認への返信"
        else:
            mode_labels = {"morning": "朝", "evening": "夜"}
            memo_label = f"Hermes{mode_labels.get(mode, '確認')}確認への返信"
        _append_memo(root, f"{memo_label}: {response}", current)
    followup_line = ""
    if scheduled_followup is not None:
        due_at = _parse_iso_datetime(str(scheduled_followup.get("dueAt", "") or ""), current.tzinfo)
        due_label = _timestamp(due_at) if due_at is not None else str(scheduled_followup.get("dueAt", ""))
        followup_line = f"\n夕方にもう一度聞きます: {due_label}\n"
    return f"""受け取りました: {_clip_line(response, 180)}
{followup_line}

次も 1/2/3 か、文章でそのまま返せます。

{_render_debug_line(checkin="answered", mode=str(checkin.get("mode", "")), method=method, boundary="local-only/no-tools")}
""".strip()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=sorted(CHECKIN_MODES), required=True)
    parser.add_argument(
        "--storage-root",
        default=os.environ.get("LIFE_PILOT_STORAGE_ROOT", "/home/hermes/.hermes-life"),
    )
    parser.add_argument(
        "--channel-id",
        default=os.environ.get("LIFE_PILOT_PROACTIVE_CHANNEL_ID", ""),
    )
    parser.add_argument(
        "--user-id",
        default=os.environ.get("LIFE_PILOT_PROACTIVE_USER_ID", ""),
    )
    args = parser.parse_args()
    result = dispatch_proactive_checkin(
        Path(args.storage_root),
        args.mode,
        channel_id=args.channel_id,
        user_id=args.user_id,
    )
    print(
        json.dumps(
            {
                "ok": result.ok,
                "sent": result.sent,
                "failed": result.failed,
                "skipped_duplicate": result.skipped_duplicate,
                "skipped_missing_channel": result.skipped_missing_channel,
                "mode": result.mode,
                "checkin_id": result.checkin_id,
            },
            sort_keys=True,
        )
    )
    return 0 if result.ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
