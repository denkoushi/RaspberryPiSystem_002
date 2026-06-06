#!/usr/bin/env python3
"""Discord life-pilot bridge for private notes, reminders, and suggestions."""

from __future__ import annotations

import asyncio
import json
from datetime import datetime
from pathlib import Path
from typing import Any

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
    return "usage: /remind <reminder>\nexample: /remind 明日の朝、燃えるごみを出す"


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


def _append_memo(root: Path, memo: str, now: datetime) -> Path:
    _ensure_storage(root)
    notes_path = root / "notes" / f"{_date_key(now)}.md"
    if not notes_path.exists():
        notes_path.write_text(f"# {_date_key(now)}\n\n", encoding="utf-8")
    with notes_path.open("a", encoding="utf-8") as handle:
        handle.write(f"## {_timestamp(now)}\n\n{memo.strip()}\n\n")
    return notes_path


def _append_reminder(root: Path, reminder: str, now: datetime) -> Path:
    _ensure_storage(root)
    reminders_path = root / "reminders" / "reminders.jsonl"
    item = {
        "createdAt": now.isoformat(timespec="seconds"),
        "text": reminder.strip(),
        "status": "pending",
    }
    with reminders_path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(item, ensure_ascii=False, sort_keys=True) + "\n")
    return reminders_path


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


def run_life_memo_bridge(
    prompt: str,
    policy: LifePilotPolicy | None = None,
    storage_root: Path | None = None,
) -> str:
    loaded_policy = policy or load_life_pilot_policy()
    validation = validate_life_prompt(prompt, loaded_policy)
    if not validation.ok:
        return f"memo rejected: {validation.reason}\n\n{render_memo_usage()}"
    now = _now()
    root = _storage_root(loaded_policy, storage_root)
    path = _append_memo(root, prompt, now)
    return f"""# Memo Saved

> {_clip_line(prompt, 180)}

{_render_debug_line(saved=_timestamp(now), path=str(path.relative_to(root)), boundary="local-only/no-tools")}
""".strip()


def run_life_remind_bridge(
    prompt: str,
    policy: LifePilotPolicy | None = None,
    storage_root: Path | None = None,
) -> str:
    loaded_policy = policy or load_life_pilot_policy()
    validation = validate_life_prompt(prompt, loaded_policy)
    if not validation.ok:
        return f"remind rejected: {validation.reason}\n\n{render_remind_usage()}"
    now = _now()
    root = _storage_root(loaded_policy, storage_root)
    path = _append_reminder(root, prompt, now)
    return f"""# Reminder Recorded

> {_clip_line(prompt, 180)}

status: pending. Automatic Discord notification scheduling is not enabled yet.

{_render_debug_line(created=_timestamp(now), path=str(path.relative_to(root)), boundary="local-only/no-tools")}
""".strip()


def run_life_digest_bridge(
    prompt: str = "",
    policy: LifePilotPolicy | None = None,
    storage_root: Path | None = None,
) -> str:
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
    reminder_lines = (
        "\n".join(f"- {_clip_line(str(item.get('text', '')))}" for item in reminders)
        if reminders
        else "- No pending reminders."
    )
    focus = _clip_line(prompt, 100) if prompt.strip() else "recent life notes"
    return f"""# Life Digest

## Focus

- {focus}

## Recent Notes

{note_lines}

## Pending Reminders

{reminder_lines}

{_render_debug_line(notes=str(len(entries)), reminders=str(len(reminders)), boundary="local-only/no-tools")}
""".strip()


def run_life_recommend_bridge(
    prompt: str = "",
    policy: LifePilotPolicy | None = None,
    storage_root: Path | None = None,
) -> str:
    loaded_policy = policy or load_life_pilot_policy()
    validation = validate_life_prompt(prompt, loaded_policy, allow_empty=True)
    if not validation.ok:
        return f"recommend rejected: {validation.reason}\n\n{render_recommend_usage()}"
    root = _storage_root(loaded_policy, storage_root)
    entries = _read_note_entries(root, limit=5)
    reminders = _read_pending_reminders(root, limit=5)
    actions: list[str] = []
    if reminders:
        actions.append(f"Choose one pending reminder to handle first: {_clip_line(str(reminders[0].get('text', '')))}")
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
    return f"""# Life Recommendation

## Focus

- {focus}

## Suggested Next Steps

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
) -> str:
    return await asyncio.to_thread(run_life_remind_bridge, prompt, policy, storage_root)


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
