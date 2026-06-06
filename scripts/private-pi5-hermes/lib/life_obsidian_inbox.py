#!/usr/bin/env python3
"""Read a local Obsidian vault as private Life Pilot inbox context."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
import os
from pathlib import Path
import re


DEFAULT_OBSIDIAN_VAULT_NAME = "HermesLife"
OBSIDIAN_VAULT_ENV = "HERMES_LIFE_OBSIDIAN_VAULT"

_ATTACHMENT_SUFFIXES = {
    ".gif",
    ".heic",
    ".jpeg",
    ".jpg",
    ".pdf",
    ".png",
    ".webp",
}
_IGNORED_DIRS = {
    ".git",
    ".obsidian",
    ".stfolder",
    ".stversions",
    ".trash",
    "node_modules",
}
_SENSITIVE_RE = re.compile(
    r"(?i)(\.env|api[_ -]?key|bearer\s+[a-z0-9._-]+|credential|password|secret|token)"
)
_TAG_RE = re.compile(r"(?<!\w)#([\w\-/\u3040-\u30ff\u3400-\u9fff]+)")
_WIKI_LINK_RE = re.compile(r"\[\[([^\]|]+)(?:\|([^\]]+))?\]\]")
_MARKDOWN_LINK_RE = re.compile(r"\[([^\]]+)\]\([^)]+\)")
_EMBED_RE = re.compile(r"!\[\[([^\]]+)\]\]|!\[[^\]]*\]\(([^)]+)\)")


@dataclass(frozen=True)
class ObsidianInboxItem:
    kind: str
    title: str
    relpath: str
    modified_at: datetime
    snippet: str = ""
    tags: tuple[str, ...] = ()
    attachments: tuple[str, ...] = ()


def _clip_line(text: str, limit: int = 120) -> str:
    one_line = " ".join((text or "").strip().split())
    if len(one_line) <= limit:
        return one_line
    return one_line[: limit - 1].rstrip() + "..."


def default_obsidian_vault_path(storage_root: Path) -> Path:
    default_path = storage_root / "obsidian" / DEFAULT_OBSIDIAN_VAULT_NAME
    configured = os.environ.get(OBSIDIAN_VAULT_ENV, "").strip()
    if configured:
        candidate = Path(configured)
        try:
            candidate.resolve().relative_to((storage_root / "obsidian").resolve())
        except ValueError:
            return default_path
        return candidate
    return default_path


def _safe_relpath(path: Path, vault: Path) -> str:
    try:
        return path.relative_to(vault).as_posix()
    except ValueError:
        return path.name


def _safe_text(text: str) -> str:
    if _SENSITIVE_RE.search(text):
        return ""
    text = _EMBED_RE.sub("", text)
    text = _WIKI_LINK_RE.sub(lambda match: match.group(2) or match.group(1), text)
    text = _MARKDOWN_LINK_RE.sub(lambda match: match.group(1), text)
    text = re.sub(r"[*_`~>|]+", " ", text)
    return _clip_line(text)


def _read_text_head(path: Path, *, max_bytes: int = 65536) -> str:
    with path.open("rb") as handle:
        raw = handle.read(max_bytes)
    return raw.decode("utf-8", errors="replace")


def _markdown_title(path: Path, lines: list[str]) -> str:
    for line in lines:
        clean = line.strip()
        if clean.startswith("# "):
            title = _safe_text(clean[2:].strip())
            if title:
                return _clip_line(title, 80)
    fallback = _safe_text(path.stem)
    return _clip_line(fallback or "Obsidianメモ", 80)


def _markdown_snippet(lines: list[str]) -> str:
    in_frontmatter = False
    in_code = False
    for index, raw_line in enumerate(lines):
        line = raw_line.strip()
        if index == 0 and line == "---":
            in_frontmatter = True
            continue
        if in_frontmatter:
            if line == "---":
                in_frontmatter = False
            continue
        if line.startswith("```"):
            in_code = not in_code
            continue
        if in_code or not line or line.startswith("#"):
            continue
        clean = _safe_text(line)
        if clean:
            return _clip_line(clean, 110)
    return ""


def _markdown_tags(text: str) -> tuple[str, ...]:
    tags: list[str] = []
    seen: set[str] = set()
    for match in _TAG_RE.finditer(text):
        tag = match.group(1).strip()
        if not tag or _SENSITIVE_RE.search(tag) or tag in seen:
            continue
        seen.add(tag)
        tags.append(tag)
        if len(tags) >= 6:
            break
    return tuple(tags)


def _markdown_attachments(text: str) -> tuple[str, ...]:
    attachments: list[str] = []
    seen: set[str] = set()
    for match in _EMBED_RE.finditer(text):
        raw = (match.group(1) or match.group(2) or "").strip()
        if not raw:
            continue
        name = Path(raw.split("|", 1)[0]).name
        if not name or _SENSITIVE_RE.search(name) or name in seen:
            continue
        seen.add(name)
        attachments.append(name)
        if len(attachments) >= 4:
            break
    return tuple(attachments)


def _iter_vault_files(vault: Path) -> list[Path]:
    if not vault.is_dir() or vault.is_symlink():
        return []
    files: list[Path] = []
    for dirpath, dirnames, filenames in os.walk(vault, followlinks=False):
        current = Path(dirpath)
        dirnames[:] = [
            name
            for name in dirnames
            if name not in _IGNORED_DIRS
            and not name.startswith(".")
            and not (current / name).is_symlink()
        ]
        for filename in filenames:
            if filename.startswith("."):
                continue
            path = current / filename
            if path.is_symlink():
                continue
            suffix = path.suffix.lower()
            if suffix != ".md" and suffix not in _ATTACHMENT_SUFFIXES:
                continue
            files.append(path)
    return files


def read_obsidian_inbox(
    storage_root: Path,
    *,
    now: datetime | None = None,
    vault_path: Path | None = None,
    days: int = 7,
    limit: int = 5,
) -> list[ObsidianInboxItem]:
    current = now or datetime.now().astimezone()
    vault = vault_path or default_obsidian_vault_path(storage_root)
    cutoff = current - timedelta(days=days)
    items: list[ObsidianInboxItem] = []
    for path in _iter_vault_files(vault):
        try:
            stat = path.stat()
        except OSError:
            continue
        modified_at = datetime.fromtimestamp(stat.st_mtime, tz=current.tzinfo)
        if modified_at < cutoff:
            continue
        suffix = path.suffix.lower()
        relpath = _safe_relpath(path, vault)
        if suffix == ".md":
            try:
                text = _read_text_head(path)
            except OSError:
                continue
            lines = text.splitlines()
            title = _markdown_title(path, lines)
            snippet = _markdown_snippet(lines)
            if not snippet and _SENSITIVE_RE.search(text):
                snippet = "安全のため本文は伏せました。"
            items.append(
                ObsidianInboxItem(
                    kind="note",
                    title=title,
                    relpath=relpath,
                    modified_at=modified_at,
                    snippet=snippet,
                    tags=_markdown_tags(text),
                    attachments=_markdown_attachments(text),
                )
            )
            continue
        title = _safe_text(path.stem) or "Obsidian添付"
        kind = "pdf" if suffix == ".pdf" else "image"
        items.append(
            ObsidianInboxItem(
                kind=kind,
                title=_clip_line(title, 80),
                relpath=relpath,
                modified_at=modified_at,
            )
        )
    items.sort(key=lambda item: (item.modified_at, item.relpath), reverse=True)
    return items[:limit]


def format_obsidian_inbox_lines(
    items: list[ObsidianInboxItem],
    empty: str = "Obsidianの新着はありません。",
    *,
    limit: int = 3,
) -> str:
    if not items:
        return f"- {empty}"
    lines: list[str] = []
    for item in items[:limit]:
        stamp = item.modified_at.strftime("%Y-%m-%d %H:%M")
        if item.kind == "note":
            body = f"{item.title}: {item.snippet}" if item.snippet else item.title
            if item.attachments:
                body = f"{body}（添付: {', '.join(item.attachments[:2])}）"
        elif item.kind == "pdf":
            body = f"PDF: {item.title}"
        else:
            body = f"画像: {item.title}"
        lines.append(f"- {stamp}: {_clip_line(body, 120)}")
    return "\n".join(lines)


def obsidian_candidate_text(items: list[ObsidianInboxItem]) -> str:
    for item in items:
        if item.kind != "note":
            continue
        if item.snippet:
            return _clip_line(f"Obsidian新着を見返す: {item.title} - {item.snippet}", 90)
        return _clip_line(f"Obsidian新着を見返す: {item.title}", 90)
    for item in items:
        if item.kind == "image":
            return _clip_line(f"Obsidian新着画像を確認: {item.title}", 90)
        if item.kind == "pdf":
            return _clip_line(f"Obsidian新着PDFを確認: {item.title}", 90)
    return ""


def obsidian_attachment_count(items: list[ObsidianInboxItem]) -> int:
    count = 0
    for item in items:
        if item.kind in {"image", "pdf"}:
            count += 1
        count += len(item.attachments)
    return count


def obsidian_has_low_energy_signal(items: list[ObsidianInboxItem]) -> bool:
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
        text = f"{item.title} {item.snippet}"
        if any(keyword in text for keyword in keywords):
            return True
    return False
