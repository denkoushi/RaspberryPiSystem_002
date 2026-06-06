#!/usr/bin/env python3
"""Discord life-pilot bridge for private notes, reminders, and suggestions."""

from __future__ import annotations

import asyncio
from contextlib import contextmanager
from dataclasses import dataclass
import json
import re
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Iterator

try:
    import fcntl
except ImportError:  # pragma: no cover
    fcntl = None  # type: ignore[assignment]

try:
    import yaml
except ImportError:  # pragma: no cover
    yaml = None  # type: ignore[assignment]

try:
    from .life_pilot_policy import (
        LifePilotPolicy,
        validate_life_pilot_document,
        validate_life_prompt,
    )
except ImportError:
    from life_pilot_policy import (
        LifePilotPolicy,
        validate_life_pilot_document,
        validate_life_prompt,
    )


def _default_policy_path() -> Path:
    plugin_dir = Path(__file__).resolve().parent
    deployed = plugin_dir / "life-pilot.policy.yaml"
    if deployed.is_file():
        return deployed
    repo_policy = plugin_dir.parent / "config" / "life-pilot.policy.yaml"
    if repo_policy.is_file():
        return repo_policy
    return Path(__file__).resolve().parent.parent / "config" / "life-pilot.policy.yaml"


def load_life_pilot_policy(path: Path | None = None) -> LifePilotPolicy:
    policy_path = path or _default_policy_path()
    if yaml is None:
        raise RuntimeError("PyYAML is required to load life pilot policy")
    data = yaml.safe_load(policy_path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("life pilot policy root must be a mapping")
    errors = validate_life_pilot_document(data)
    if errors:
        raise ValueError("; ".join(errors))
    return LifePilotPolicy.from_mapping(data)


def render_memo_usage() -> str:
    return "usage: /memo <life note>\nexample: /memo 今日は病院の予約を入れた。来週火曜10時。"


def render_digest_usage() -> str:
    return "usage: /digest [focus]\nexample: /digest 今週の備忘録を短くまとめて"


def render_remind_usage() -> str:
    return (
        "usage: /remind <when and reminder>\n"
        "examples:\n"
        "- /remind 明日の朝、燃えるごみを出す\n"
        "- /remind 2026-06-07 08:00 薬を飲む"
    )


def render_recommend_usage() -> str:
    return "usage: /recommend [focus]\nexample: /recommend 今日の優先順位"


def _storage_root(policy: LifePilotPolicy, storage_root: Path | None) -> Path:
    return storage_root or Path(policy.storage_root)


def _ensure_storage(root: Path) -> None:
    (root / "notes").mkdir(parents=True, exist_ok=True)
    (root / "reminders").mkdir(parents=True, exist_ok=True)


def _now() -> datetime:
    return datetime.now().astimezone()


def _timestamp(value: datetime) -> str:
    return value.strftime("%Y-%m-%d %H:%M")


def _date_key(value: datetime) -> str:
    return value.strftime("%Y-%m-%d")


def _clip_line(text: str, limit: int = 120) -> str:
    one_line = " ".join((text or "").strip().split())
    if len(one_line) <= limit:
        return one_line
    return one_line[: limit - 1].rstrip() + "..."


def _render_debug_line(**items: str) -> str:
    """Render compact Discord subtext for operator diagnostics."""
    details = " ".join(f"{key}={value}" for key, value in items.items())
    return f"-# debug: {details}"


@dataclass(frozen=True)
class ParsedReminder:
    text: str
    due_at: datetime | None
    due_source: str = ""


@dataclass(frozen=True)
class ReminderRecordResult:
    path: Path
    text: str
    due_at: datetime | None
    notification: str


_WEEKDAYS: dict[str, int] = {
    "月": 0,
    "月曜": 0,
    "月曜日": 0,
    "火": 1,
    "火曜": 1,
    "火曜日": 1,
    "水": 2,
    "水曜": 2,
    "水曜日": 2,
    "木": 3,
    "木曜": 3,
    "木曜日": 3,
    "金": 4,
    "金曜": 4,
    "金曜日": 4,
    "土": 5,
    "土曜": 5,
    "土曜日": 5,
    "日": 6,
    "日曜": 6,
    "日曜日": 6,
}

_TIME_KEYWORDS: tuple[tuple[str, tuple[int, int]], ...] = (
    ("朝", (8, 0)),
    ("午前", (9, 0)),
    ("昼", (12, 0)),
    ("午後", (15, 0)),
    ("夕方", (18, 0)),
    ("夜", (20, 0)),
)


def normalize_life_command_args(raw_args: str, command_name: str = "") -> str:
    """Accept common slash/raw-text prefixes before validation."""
    text = " ".join((raw_args or "").strip().split())
    if not text:
        return ""
    command = command_name.strip().lstrip("/")
    if command and text.startswith(f"/{command} "):
        text = text[len(command) + 2 :].strip()
    for prefix in ("args:", "args=", "Arguments:", "Arguments="):
        if text.startswith(prefix):
            return text[len(prefix) :].strip()
    return text


def _combine_date_time(now: datetime, days: int, hour: int, minute: int) -> datetime:
    target_date = (now + timedelta(days=days)).date()
    return datetime(
        target_date.year,
        target_date.month,
        target_date.day,
        hour,
        minute,
        tzinfo=now.tzinfo,
    )


def _default_time(text: str) -> tuple[int, int]:
    for keyword, value in _TIME_KEYWORDS:
        if keyword in text:
            return value
    return (9, 0)


def _extract_time(text: str, default: tuple[int, int]) -> tuple[int, int]:
    pattern = re.compile(
        r"(午前|午後)?\s*(\d{1,2})(?::|時)(\d{2})?(?:分)?",
    )
    match = pattern.search(text)
    if not match:
        return default
    meridiem = match.group(1) or ""
    hour = int(match.group(2))
    minute = int(match.group(3) or "0")
    if meridiem == "午後" and hour < 12:
        hour += 12
    if meridiem == "午前" and hour == 12:
        hour = 0
    if hour > 23 or minute > 59:
        return default
    return hour, minute


def _next_weekday(now: datetime, weekday: int) -> int:
    days = (weekday - now.weekday()) % 7
    return days or 7


def _clean_reminder_text(raw: str) -> str:
    text = raw.strip()
    patterns = (
        r"^\d{4}-\d{1,2}-\d{1,2}(?:[ T]\d{1,2}:\d{2})?\s*",
        r"^(?:\d{4}年)?\d{1,2}月\d{1,2}日(?:\s*\d{1,2}(?:時|:)\d{0,2}(?:分)?)?\s*",
        r"^\d{1,2}/\d{1,2}(?:\s*\d{1,2}(?:時|:)\d{0,2}(?:分)?)?\s*",
        r"^(?:今日|明日|明後日|あさって)(?:の)?(?:朝|午前|昼|午後|夕方|夜)?\s*",
        r"^(?:来週|次の)?(?:月曜日|月曜|月|火曜日|火曜|火|水曜日|水曜|水|木曜日|木曜|木|金曜日|金曜|金|土曜日|土曜|土|日曜日|日曜|日)\s*",
        r"^(?:午前|午後)?\d{1,2}(?:時|:)\d{0,2}(?:分)?\s*",
    )
    for pattern in patterns:
        text = re.sub(pattern, "", text).strip()
    return text.lstrip("、,。 にまでで-:：").strip() or raw.strip()


def parse_reminder_text(prompt: str, now: datetime | None = None) -> ParsedReminder:
    """Parse common Japanese/ISO reminder times without external services."""
    current = now or _now()
    raw = normalize_life_command_args(prompt, "remind")
    if not raw:
        return ParsedReminder("", None)

    default_hour, default_minute = _default_time(raw)
    hour, minute = _extract_time(raw, (default_hour, default_minute))

    iso_match = re.search(
        r"\b(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?",
        raw,
    )
    if iso_match:
        parsed_hour = int(iso_match.group(4) or hour)
        parsed_minute = int(iso_match.group(5) or minute)
        try:
            due_at = datetime(
                int(iso_match.group(1)),
                int(iso_match.group(2)),
                int(iso_match.group(3)),
                parsed_hour,
                parsed_minute,
                tzinfo=current.tzinfo,
            )
        except ValueError:
            return ParsedReminder(raw, None)
        return ParsedReminder(_clean_reminder_text(raw), due_at, "absolute-date")

    jp_date = re.search(r"(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日", raw)
    if jp_date:
        year = int(jp_date.group(1) or current.year)
        month = int(jp_date.group(2))
        day = int(jp_date.group(3))
        try:
            due_at = datetime(year, month, day, hour, minute, tzinfo=current.tzinfo)
        except ValueError:
            return ParsedReminder(raw, None)
        if jp_date.group(1) is None and due_at < current:
            due_at = due_at.replace(year=current.year + 1)
        return ParsedReminder(_clean_reminder_text(raw), due_at, "absolute-date")

    slash_date = re.search(r"(?<!\d)(\d{1,2})/(\d{1,2})(?!\d)", raw)
    if slash_date:
        try:
            due_at = datetime(
                current.year,
                int(slash_date.group(1)),
                int(slash_date.group(2)),
                hour,
                minute,
                tzinfo=current.tzinfo,
            )
        except ValueError:
            return ParsedReminder(raw, None)
        if due_at < current:
            due_at = due_at.replace(year=current.year + 1)
        return ParsedReminder(_clean_reminder_text(raw), due_at, "absolute-date")

    if "明後日" in raw or "あさって" in raw:
        return ParsedReminder(
            _clean_reminder_text(raw),
            _combine_date_time(current, 2, hour, minute),
            "relative-date",
        )
    if "明日" in raw:
        return ParsedReminder(
            _clean_reminder_text(raw),
            _combine_date_time(current, 1, hour, minute),
            "relative-date",
        )
    if "今日" in raw:
        return ParsedReminder(
            _clean_reminder_text(raw),
            _combine_date_time(current, 0, hour, minute),
            "relative-date",
        )

    weekday_match = re.search(
        r"(?:来週|次の)?(月曜日|月曜|月|火曜日|火曜|火|水曜日|水曜|水|木曜日|木曜|木|金曜日|金曜|金|土曜日|土曜|土|日曜日|日曜|日)",
        raw,
    )
    if weekday_match:
        weekday = _WEEKDAYS[weekday_match.group(1)]
        return ParsedReminder(
            _clean_reminder_text(raw),
            _combine_date_time(current, _next_weekday(current, weekday), hour, minute),
            "weekday",
        )

    return ParsedReminder(raw, None)


@contextmanager
def _reminder_file_lock(root: Path) -> Iterator[None]:
    _ensure_storage(root)
    lock_path = root / "reminders" / ".reminders.lock"
    with lock_path.open("a+", encoding="utf-8") as handle:
        if fcntl is not None:
            fcntl.flock(handle, fcntl.LOCK_EX)
        try:
            yield
        finally:
            if fcntl is not None:
                fcntl.flock(handle, fcntl.LOCK_UN)


def _append_memo(root: Path, memo: str, now: datetime) -> Path:
    _ensure_storage(root)
    notes_path = root / "notes" / f"{_date_key(now)}.md"
    if not notes_path.exists():
        notes_path.write_text(f"# {_date_key(now)}\n\n", encoding="utf-8")
    with notes_path.open("a", encoding="utf-8") as handle:
        handle.write(f"## {_timestamp(now)}\n\n{memo.strip()}\n\n")
    return notes_path


def _append_reminder(
    root: Path,
    reminder: str,
    now: datetime,
    *,
    notify_channel_id: str = "",
    notify_user_id: str = "",
) -> ReminderRecordResult:
    parsed = parse_reminder_text(reminder, now)
    reminders_path = root / "reminders" / "reminders.jsonl"
    item = {
        "createdAt": now.isoformat(timespec="seconds"),
        "text": parsed.text.strip(),
        "status": "pending",
    }
    if parsed.text.strip() != reminder.strip():
        item["rawText"] = reminder.strip()
    notification = "needs-time"
    if parsed.due_at is not None:
        item["dueAt"] = parsed.due_at.isoformat(timespec="seconds")
        item["dueSource"] = parsed.due_source
        if notify_channel_id:
            item["notifyChannelId"] = notify_channel_id
            item["notifyUserId"] = notify_user_id
            notification = "scheduled"
        else:
            notification = "needs-channel"
    with _reminder_file_lock(root):
        with reminders_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(item, ensure_ascii=False, sort_keys=True) + "\n")
    return ReminderRecordResult(
        path=reminders_path,
        text=item["text"],
        due_at=parsed.due_at,
        notification=notification,
    )


def _read_note_entries(root: Path, limit: int = 8) -> list[tuple[str, str]]:
    notes_dir = root / "notes"
    if not notes_dir.is_dir():
        return []
    entries: list[tuple[str, str]] = []
    for path in sorted(notes_dir.glob("*.md"), reverse=True):
        text = path.read_text(encoding="utf-8", errors="replace")
        for raw in text.split("\n## ")[::-1]:
            block = raw.strip()
            if not block or block.startswith("# "):
                continue
            lines = block.splitlines()
            if not lines:
                continue
            when = lines[0].removeprefix("## ").strip()
            body = "\n".join(lines[1:]).strip()
            if body:
                entries.append((when, body))
            if len(entries) >= limit:
                return entries
    return entries


def _read_pending_reminders(root: Path, limit: int = 8) -> list[dict[str, Any]]:
    path = root / "reminders" / "reminders.jsonl"
    if not path.is_file():
        return []
    pending: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        if not line.strip():
            continue
        try:
            item = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(item, dict) and item.get("status") == "pending":
            pending.append(item)
    return pending[-limit:][::-1]


def _parse_due_at_item(item: dict[str, Any]) -> datetime | None:
    due_at = str(item.get("dueAt", "") or "").strip()
    if not due_at:
        return None
    try:
        parsed = datetime.fromisoformat(due_at)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=_now().tzinfo)
    return parsed


def _format_reminder_line(item: dict[str, Any]) -> str:
    text = _clip_line(str(item.get("text", "")))
    due_at = _parse_due_at_item(item)
    if due_at is None:
        return f"- {text} (no time)"
    return f"- {_timestamp(due_at)}: {text}"


def run_life_memo_bridge(
    prompt: str,
    policy: LifePilotPolicy | None = None,
    storage_root: Path | None = None,
) -> str:
    prompt = normalize_life_command_args(prompt, "memo")
    loaded_policy = policy or load_life_pilot_policy()
    validation = validate_life_prompt(prompt, loaded_policy)
    if not validation.ok:
        return f"memo rejected: {validation.reason}\n\n{render_memo_usage()}"
    now = _now()
    root = _storage_root(loaded_policy, storage_root)
    path = _append_memo(root, prompt, now)
    return f"""{_clip_line(prompt, 180)}

{_render_debug_line(saved=_timestamp(now), path=str(path.relative_to(root)), boundary="local-only/no-tools")}
""".strip()


def run_life_remind_bridge(
    prompt: str,
    policy: LifePilotPolicy | None = None,
    storage_root: Path | None = None,
    *,
    notify_channel_id: str = "",
    notify_user_id: str = "",
) -> str:
    prompt = normalize_life_command_args(prompt, "remind")
    loaded_policy = policy or load_life_pilot_policy()
    validation = validate_life_prompt(prompt, loaded_policy)
    if not validation.ok:
        return f"remind rejected: {validation.reason}\n\n{render_remind_usage()}"
    now = _now()
    root = _storage_root(loaded_policy, storage_root)
    record = _append_reminder(
        root,
        prompt,
        now,
        notify_channel_id=notify_channel_id,
        notify_user_id=notify_user_id,
    )
    if record.due_at is None:
        schedule_line = "not scheduled: 日時を読み取れませんでした。例: /remind 明日の朝、燃えるごみを出す"
    elif record.notification == "needs-channel":
        schedule_line = f"scheduled: {_timestamp(record.due_at)} (notification channel unavailable)"
    else:
        schedule_line = f"scheduled: {_timestamp(record.due_at)}"
    return f"""{_clip_line(prompt, 180)}
{schedule_line}

{_render_debug_line(status="pending", notification=record.notification, created=_timestamp(now), path=str(record.path.relative_to(root)), boundary="local-only/no-tools")}
""".strip()


def run_life_digest_bridge(
    prompt: str = "",
    policy: LifePilotPolicy | None = None,
    storage_root: Path | None = None,
) -> str:
    prompt = normalize_life_command_args(prompt, "digest")
    loaded_policy = policy or load_life_pilot_policy()
    validation = validate_life_prompt(prompt, loaded_policy, allow_empty=True)
    if not validation.ok:
        return f"digest rejected: {validation.reason}\n\n{render_digest_usage()}"
    root = _storage_root(loaded_policy, storage_root)
    entries = _read_note_entries(root)
    reminders = _read_pending_reminders(root)
    note_lines = (
        "\n".join(f"- {when}: {_clip_line(body)}" for when, body in entries)
        if entries
        else "- No life memos yet."
    )
    scheduled = [item for item in reminders if _parse_due_at_item(item) is not None]
    unscheduled = [item for item in reminders if _parse_due_at_item(item) is None]
    scheduled.sort(key=lambda item: _parse_due_at_item(item) or datetime.max)
    scheduled_lines = (
        "\n".join(_format_reminder_line(item) for item in scheduled[:5])
        if scheduled
        else "- No scheduled reminders."
    )
    unscheduled_lines = (
        "\n".join(_format_reminder_line(item) for item in unscheduled[:5])
        if unscheduled
        else "- No pending reminders without time."
    )
    focus = _clip_line(prompt, 100) if prompt.strip() else "recent life notes"
    return f"""Focus: {focus}

Recent notes:
{note_lines}

Scheduled reminders:
{scheduled_lines}

Pending without time:
{unscheduled_lines}

{_render_debug_line(notes=str(len(entries)), reminders=str(len(reminders)), boundary="local-only/no-tools")}
""".strip()


def run_life_recommend_bridge(
    prompt: str = "",
    policy: LifePilotPolicy | None = None,
    storage_root: Path | None = None,
) -> str:
    prompt = normalize_life_command_args(prompt, "recommend")
    loaded_policy = policy or load_life_pilot_policy()
    validation = validate_life_prompt(prompt, loaded_policy, allow_empty=True)
    if not validation.ok:
        return f"recommend rejected: {validation.reason}\n\n{render_recommend_usage()}"
    root = _storage_root(loaded_policy, storage_root)
    entries = _read_note_entries(root, limit=5)
    reminders = _read_pending_reminders(root, limit=5)
    actions: list[str] = []
    now = _now()
    scheduled = [item for item in reminders if _parse_due_at_item(item) is not None]
    unscheduled = [item for item in reminders if _parse_due_at_item(item) is None]
    scheduled.sort(key=lambda item: _parse_due_at_item(item) or datetime.max)
    due_now = [
        item
        for item in scheduled
        if (_parse_due_at_item(item) or datetime.max.replace(tzinfo=now.tzinfo)) <= now
    ]
    if due_now:
        actions.append(f"Handle the due reminder first: {_clip_line(str(due_now[0].get('text', '')))}")
    elif scheduled:
        due_at = _parse_due_at_item(scheduled[0])
        due_label = _timestamp(due_at) if due_at is not None else "unknown time"
        actions.append(
            f"Prepare for the next scheduled reminder ({due_label}): "
            f"{_clip_line(str(scheduled[0].get('text', '')))}"
        )
    if unscheduled:
        actions.append(f"Add a date/time to this reminder: {_clip_line(str(unscheduled[0].get('text', '')))}")
    if not entries:
        actions.append("Add one short /memo so Hermes has context for future suggestions.")
    else:
        actions.append(f"Review the latest memo and decide whether it needs a calendar entry: {_clip_line(entries[0][1])}")
    if len(entries) >= 3:
        actions.append("Look for a repeated theme across the recent notes and make one concrete next step.")
    if not actions:
        actions.append("Keep the next action small enough to finish today.")
    action_lines = "\n".join(f"- {item}" for item in actions[:4])
    focus = _clip_line(prompt, 100) if prompt.strip() else "next small action"
    return f"""Focus: {focus}

Suggested next steps:
{action_lines}

{_render_debug_line(notes=str(len(entries)), reminders=str(len(reminders)), boundary="local-only/no-tools")}
""".strip()


async def run_life_memo_bridge_async(
    prompt: str,
    policy: LifePilotPolicy | None = None,
    storage_root: Path | None = None,
) -> str:
    return await asyncio.to_thread(run_life_memo_bridge, prompt, policy, storage_root)


async def run_life_remind_bridge_async(
    prompt: str,
    policy: LifePilotPolicy | None = None,
    storage_root: Path | None = None,
    *,
    notify_channel_id: str = "",
    notify_user_id: str = "",
) -> str:
    return await asyncio.to_thread(
        run_life_remind_bridge,
        prompt,
        policy,
        storage_root,
        notify_channel_id=notify_channel_id,
        notify_user_id=notify_user_id,
    )


async def run_life_digest_bridge_async(
    prompt: str = "",
    policy: LifePilotPolicy | None = None,
    storage_root: Path | None = None,
) -> str:
    return await asyncio.to_thread(run_life_digest_bridge, prompt, policy, storage_root)


async def run_life_recommend_bridge_async(
    prompt: str = "",
    policy: LifePilotPolicy | None = None,
    storage_root: Path | None = None,
) -> str:
    return await asyncio.to_thread(run_life_recommend_bridge, prompt, policy, storage_root)
