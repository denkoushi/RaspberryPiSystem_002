#!/usr/bin/env python3
"""Capture Discord shared messages as private Life Pilot inbox context."""

from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta
import json
from pathlib import Path
import re
import tempfile
from typing import Any, Iterator

try:
    import fcntl
except ImportError:  # pragma: no cover
    fcntl = None  # type: ignore[assignment]


_URL_RE = re.compile(r"https?://[^\s<>\]\)\"']+", re.IGNORECASE)
_SENSITIVE_RE = re.compile(
    r"(?i)(\.env|api[_ -]?key|bearer\s+[a-z0-9._-]+|credential|password|secret|token)"
)
_EXPLICIT_PREFIX_RE = re.compile(r"^(?:inbox|share|共有|メモ|memo)\s*[:：]", re.IGNORECASE)
_X_HOST_RE = re.compile(r"^https?://(?:www\.)?(?:x\.com|twitter\.com)/", re.IGNORECASE)
_ATTACHMENT_PLACEHOLDER_RE = re.compile(
    r"(?i)(クリックして添付ファイルを表示|添付ファイル|attachment|attached file)"
)
_TEXT_KEYS = (
    "text",
    "content",
    "clean_content",
    "raw_text",
    "body",
    "caption",
    "message",
    "url",
)
_ID_KEYS = (
    "id",
    "message_id",
    "messageId",
)
_EMBED_TEXT_KEYS = (
    "url",
    "title",
    "description",
)
_EMBED_NESTED_KEYS = (
    "author",
    "provider",
    "image",
    "thumbnail",
    "video",
    "footer",
)


@dataclass(frozen=True)
class DiscordInboxCaptureResult:
    captured: bool
    reason: str = ""
    ack: str = ""


@dataclass(frozen=True)
class DiscordInboxItem:
    created_at: datetime
    text: str
    urls: tuple[str, ...]
    attachments: tuple[str, ...]
    channel_id: str = ""
    user_id: str = ""
    source: str = "discord"
    redacted: bool = False


def _now() -> datetime:
    return datetime.now().astimezone()


def _timestamp(value: datetime) -> str:
    return value.strftime("%Y-%m-%d %H:%M")


def _clip_line(text: str, limit: int = 160) -> str:
    one_line = " ".join((text or "").strip().split())
    if len(one_line) <= limit:
        return one_line
    return one_line[: limit - 1].rstrip() + "..."


def _field(item: Any, key: str) -> Any:
    if item is None:
        return None
    if isinstance(item, dict):
        return item.get(key)
    return getattr(item, key, None)


def _as_string(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, (int, float)):
        return str(value).strip()
    return ""


def _as_iterable(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, (str, bytes, dict)):
        return [value]
    try:
        return list(value)
    except TypeError:
        return [value]


def _event_objects(event: Any) -> tuple[Any, ...]:
    source = _field(event, "source")
    payload = _field(event, "payload")
    data = _field(event, "data")
    source_payload = _field(source, "payload")
    source_data = _field(source, "data")
    objects: list[Any] = []
    for item in (
        event,
        source,
        _field(event, "message"),
        _field(source, "message"),
        payload,
        data,
        source_payload,
        source_data,
        _field(payload, "message"),
        _field(data, "message"),
        _field(source_payload, "message"),
        _field(source_data, "message"),
        _field(payload, "d"),
        _field(data, "d"),
        _field(source_payload, "d"),
        _field(source_data, "d"),
    ):
        if item is not None and not any(item is existing for existing in objects):
            objects.append(item)
    return tuple(objects)


def _embed_objects(event: Any) -> tuple[Any, ...]:
    embeds: list[Any] = []
    for item in _event_objects(event):
        for key in ("embeds", "embed"):
            for embed in _as_iterable(_field(item, key)):
                if embed is None:
                    continue
                if not any(embed is existing for existing in embeds):
                    embeds.append(embed)
    return tuple(embeds)


def _append_unique(parts: list[str], value: Any, *, limit: int = 240) -> None:
    text = _clip_line(_as_string(value), limit)
    if not text or text in parts:
        return
    parts.append(text)


def _embed_text_parts(embed: Any) -> list[str]:
    parts: list[str] = []
    for key in _EMBED_TEXT_KEYS:
        _append_unique(parts, _field(embed, key))
    for nested_key in _EMBED_NESTED_KEYS:
        nested = _field(embed, nested_key)
        for key in ("url", "proxy_url", "name", "text"):
            _append_unique(parts, _field(nested, key))
    for field in _as_iterable(_field(embed, "fields")):
        _append_unique(parts, _field(field, "name"), limit=120)
        _append_unique(parts, _field(field, "value"))
    return parts


def extract_discord_message_text(event: Any) -> str:
    """Return user-share text even when Discord sends it as embeds instead of content."""
    parts: list[str] = []
    for item in _event_objects(event):
        for key in _TEXT_KEYS:
            _append_unique(parts, _field(item, key))
    for embed in _embed_objects(event):
        for part in _embed_text_parts(embed):
            _append_unique(parts, part)
    return _clip_line(" ".join(parts), 500)


def extract_discord_message_id(event: Any) -> str:
    for item in _event_objects(event):
        for key in _ID_KEYS:
            value = _as_string(_field(item, key))
            if value:
                return _clip_line(value, 100)
    return ""


def _inbox_path(root: Path) -> Path:
    return root / "inbox" / "discord.jsonl"


@contextmanager
def _inbox_file_lock(root: Path) -> Iterator[None]:
    inbox_dir = root / "inbox"
    inbox_dir.mkdir(parents=True, exist_ok=True)
    lock_path = inbox_dir / ".discord-inbox.lock"
    with lock_path.open("a+", encoding="utf-8") as handle:
        if fcntl is not None:
            fcntl.flock(handle, fcntl.LOCK_EX)
        try:
            yield
        finally:
            if fcntl is not None:
                fcntl.flock(handle, fcntl.LOCK_UN)


def _append_jsonl(path: Path, item: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(item, ensure_ascii=False, sort_keys=True) + "\n")


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


def _normalize_url(raw: str) -> str:
    url = raw.strip().rstrip(".,、。)")
    if _SENSITIVE_RE.search(url):
        return ""
    return _clip_line(url, 240)


def extract_urls(text: str) -> tuple[str, ...]:
    urls: list[str] = []
    seen: set[str] = set()
    for match in _URL_RE.finditer(text or ""):
        url = _normalize_url(match.group(0))
        if not url or url in seen:
            continue
        seen.add(url)
        urls.append(url)
        if len(urls) >= 5:
            break
    return tuple(urls)


def sanitize_shared_text(text: str) -> tuple[str, bool]:
    clean = " ".join((text or "").strip().split())
    if not clean:
        return "", False
    if _SENSITIVE_RE.search(clean):
        return "安全のため本文は伏せました。", True
    clean = _EXPLICIT_PREFIX_RE.sub("", clean).strip()
    return _clip_line(clean, 240), False


def _attachment_name(item: Any) -> str:
    if isinstance(item, dict):
        candidates = (
            item.get("filename"),
            item.get("name"),
            item.get("title"),
            item.get("content_type"),
            item.get("url"),
        )
    else:
        candidates = (
            getattr(item, "filename", ""),
            getattr(item, "name", ""),
            getattr(item, "title", ""),
            getattr(item, "content_type", ""),
            getattr(item, "url", ""),
        )
    for value in candidates:
        clean = str(value or "").strip()
        if not clean:
            continue
        name = Path(clean).name
        if not name or _SENSITIVE_RE.search(name):
            continue
        return _clip_line(name, 100)
    return "attachment"


def extract_attachment_names(event: Any) -> tuple[str, ...]:
    names: list[str] = []
    seen: set[str] = set()
    for event_object in _event_objects(event):
        for key in ("attachments", "files", "images"):
            for item in _as_iterable(_field(event_object, key)):
                name = _attachment_name(item)
                if name in seen:
                    continue
                seen.add(name)
                names.append(name)
                if len(names) >= 6:
                    return tuple(names)
    return tuple(names)


def _channel_is_allowed(channel_id: str, allowed_channel_ids: set[str] | None) -> bool:
    if not allowed_channel_ids:
        return False
    return str(channel_id or "").strip() in allowed_channel_ids


def _ack(kind: str) -> str:
    return f"""受け取り箱に保存しました。

{_debug_line(inbox="discord", kind=kind, boundary="local-only/no-tools")}""".strip()


def should_capture_discord_inbox(
    text: str,
    *,
    attachments: tuple[str, ...] = (),
    channel_id: str = "",
    allowed_channel_ids: set[str] | None = None,
    capture_all: bool = False,
) -> bool:
    clean = " ".join((text or "").strip().split())
    if not clean and not attachments:
        return False
    if clean.startswith("/"):
        return False
    if _channel_is_allowed(channel_id, allowed_channel_ids):
        return True
    if capture_all:
        return True
    if attachments:
        return True
    if extract_urls(clean):
        return True
    if _EXPLICIT_PREFIX_RE.search(clean):
        return True
    if _ATTACHMENT_PLACEHOLDER_RE.search(clean):
        return True
    return False


def capture_discord_inbox_message(
    storage_root: Path,
    text: str,
    *,
    user_id: str = "",
    channel_id: str = "",
    attachments: tuple[str, ...] = (),
    message_id: str = "",
    now: datetime | None = None,
    allowed_channel_ids: set[str] | None = None,
    capture_all: bool = False,
) -> DiscordInboxCaptureResult:
    if not should_capture_discord_inbox(
        text,
        attachments=attachments,
        channel_id=channel_id,
        allowed_channel_ids=allowed_channel_ids,
        capture_all=capture_all,
    ):
        return DiscordInboxCaptureResult(False, "not-share-like")
    current = now or _now()
    clean_text, redacted = sanitize_shared_text(text)
    urls = extract_urls(clean_text if not redacted else text)
    clean_message_id = _clip_line(str(message_id or "").strip(), 100)
    record = {
        "createdAt": current.isoformat(timespec="seconds"),
        "source": "discord",
        "userId": str(user_id or "").strip(),
        "channelId": str(channel_id or "").strip(),
        "messageId": clean_message_id,
        "text": clean_text,
        "urls": list(urls),
        "attachments": list(attachments),
        "redacted": redacted,
        "untrusted": True,
        "status": "new",
    }
    kind = "link" if urls else "attachment" if attachments else "text"
    with _inbox_file_lock(storage_root):
        if clean_message_id:
            for row in _read_jsonl(_inbox_path(storage_root)):
                if str(row.get("messageId", "") or "").strip() == clean_message_id:
                    return DiscordInboxCaptureResult(True, "duplicate", _ack(kind))
        _append_jsonl(_inbox_path(storage_root), record)
    return DiscordInboxCaptureResult(True, kind, _ack(kind))


def _parse_created_at(value: str, fallback_tz: Any) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=fallback_tz)
    return parsed


def read_discord_inbox(
    storage_root: Path,
    *,
    now: datetime | None = None,
    days: int = 7,
    limit: int = 5,
) -> list[DiscordInboxItem]:
    current = now or _now()
    cutoff = current - timedelta(days=days)
    items: list[DiscordInboxItem] = []
    for row in _read_jsonl(_inbox_path(storage_root)):
        created_at = _parse_created_at(str(row.get("createdAt", "") or ""), current.tzinfo)
        if created_at is None or created_at < cutoff:
            continue
        urls = tuple(
            _normalize_url(str(url or ""))
            for url in row.get("urls", [])
            if _normalize_url(str(url or ""))
        )
        attachments = tuple(
            _clip_line(str(item or ""), 100)
            for item in row.get("attachments", [])
            if str(item or "").strip()
        )
        items.append(
            DiscordInboxItem(
                created_at=created_at,
                text=_clip_line(str(row.get("text", "") or ""), 240),
                urls=urls,
                attachments=attachments,
                channel_id=str(row.get("channelId", "") or "").strip(),
                user_id=str(row.get("userId", "") or "").strip(),
                source=str(row.get("source", "discord") or "discord"),
                redacted=bool(row.get("redacted")),
            )
        )
    items.sort(key=lambda item: item.created_at, reverse=True)
    return items[:limit]


def _item_label(item: DiscordInboxItem) -> str:
    if item.urls:
        first = item.urls[0]
        if _X_HOST_RE.search(first):
            prefix = "Xリンク"
        else:
            prefix = "リンク"
        if item.text and item.text != first:
            return f"{prefix}: {item.text}"
        return f"{prefix}: {first}"
    if item.attachments:
        return f"添付: {', '.join(item.attachments[:2])}"
    if item.text:
        return f"共有メモ: {item.text}"
    return "共有メモ"


def format_discord_inbox_lines(
    items: list[DiscordInboxItem],
    empty: str = "共有メモの新着はありません。",
    *,
    limit: int = 3,
) -> str:
    if not items:
        return f"- {empty}"
    return "\n".join(
        f"- {_timestamp(item.created_at)}: {_clip_line(_item_label(item), 120)}"
        for item in items[:limit]
    )


def discord_inbox_candidate_text(items: list[DiscordInboxItem]) -> str:
    if not items:
        return ""
    return _clip_line(f"共有メモを見返す: {_item_label(items[0])}", 90)


def discord_inbox_has_low_energy_signal(items: list[DiscordInboxItem]) -> bool:
    keywords = (
        "疲れ",
        "つかれ",
        "しんど",
        "だる",
        "眠い",
        "寝不足",
        "体調悪",
        "頭痛",
        "風邪",
        "休みたい",
    )
    for item in items:
        text = _item_label(item)
        if any(keyword in text for keyword in keywords):
            return True
    return False


def prune_discord_inbox(
    storage_root: Path,
    *,
    now: datetime | None = None,
    keep_days: int = 30,
    keep_latest: int = 500,
) -> int:
    current = now or _now()
    cutoff = current - timedelta(days=keep_days)
    path = _inbox_path(storage_root)
    with _inbox_file_lock(storage_root):
        rows = _read_jsonl(path)
        kept: list[dict[str, Any]] = []
        for row in rows:
            created_at = _parse_created_at(str(row.get("createdAt", "") or ""), current.tzinfo)
            if created_at is None or created_at >= cutoff:
                kept.append(row)
        kept = kept[-keep_latest:]
        if len(kept) != len(rows):
            _write_jsonl(path, kept)
        return len(rows) - len(kept)


def _debug_line(**items: str) -> str:
    details = " ".join(f"{key}={value}" for key, value in items.items())
    return f"-# debug: {details}"
