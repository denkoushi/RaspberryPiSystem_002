#!/usr/bin/env python3
"""Daily interest digest for private Life Pilot.

This module intentionally stores only titles, URLs, short snippets, source
metadata, and local feedback. External posts remain untrusted input.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from email.utils import parsedate_to_datetime
import hashlib
import html
import json
import os
from pathlib import Path
import re
import tempfile
from typing import Any, Callable, Iterator
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

try:
    import fcntl
except ImportError:  # pragma: no cover
    fcntl = None  # type: ignore[assignment]

try:
    from .life_discord_inbox import read_discord_inbox
    from .life_reminder_scheduler import DiscordSendResult, send_discord_channel_message
except ImportError:
    from life_discord_inbox import read_discord_inbox
    from life_reminder_scheduler import DiscordSendResult, send_discord_channel_message


USER_AGENT = "private-pi5-hermes-interest-digest/1.0"
MAX_STORED_ITEMS = 700
MAX_FEEDBACK = 1000
MAX_SEEN = 1200
MAX_WEB_SEARCH_QUERIES = 5
MAX_WEB_SEARCH_RESULTS_PER_QUERY = 3

OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
BRAVE_WEB_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search"

DEFAULT_FEED_SOURCES: tuple[dict[str, str], ...] = (
    {
        "source": "nvidia_dgx_spark_forum",
        "label": "NVIDIA DGX Spark Forum",
        "url": "https://forums.developer.nvidia.com/c/accelerated-computing/dgx-spark-gb10/719.rss",
    },
    {
        "source": "nvidia_dgx_spark_announcements",
        "label": "NVIDIA DGX Spark Announcements",
        "url": "https://forums.developer.nvidia.com/c/accelerated-computing/dgx-spark-gb10/announcements/722.rss",
    },
    {
        "source": "hermes_agent_releases",
        "label": "Hermes Agent GitHub Releases",
        "url": "https://github.com/NousResearch/hermes-agent/releases.atom",
    },
    {
        "source": "hermes_agent_issues",
        "label": "Hermes Agent GitHub Issues",
        "url": "https://github.com/NousResearch/hermes-agent/issues.atom",
    },
)

DEFAULT_POSITIVE_KEYWORDS: tuple[str, ...] = (
    "dgx",
    "spark",
    "gb10",
    "vllm",
    "nvfp4",
    "qwen",
    "local llm",
    "gateway",
    "cold start",
    "memory",
    "cron",
    "skill",
    "discord",
    "hermes agent",
    "life pilot",
    "browser",
    "x_search",
    "weather",
    "forecast",
    "天気",
    "web search",
)

DEFAULT_NEGATIVE_KEYWORDS: tuple[str, ...] = (
    "giveaway",
    "discount",
    "rumor only",
)

ACTION_LABELS: dict[str, str] = {
    "like": "興味あり",
    "save": "保存",
    "later": "あとで見る",
    "dismiss": "外す",
}

WEATHER_CODE_LABELS: dict[int, str] = {
    0: "快晴",
    1: "晴れ",
    2: "一部くもり",
    3: "くもり",
    45: "霧",
    48: "霧氷",
    51: "弱い霧雨",
    53: "霧雨",
    55: "強い霧雨",
    56: "弱い着氷性霧雨",
    57: "着氷性霧雨",
    61: "弱い雨",
    63: "雨",
    65: "強い雨",
    66: "弱い着氷性雨",
    67: "着氷性雨",
    71: "弱い雪",
    73: "雪",
    75: "強い雪",
    77: "雪粒",
    80: "弱いにわか雨",
    81: "にわか雨",
    82: "強いにわか雨",
    85: "弱いにわか雪",
    86: "にわか雪",
    95: "雷雨",
    96: "ひょうを伴う雷雨",
    99: "強いひょうを伴う雷雨",
}


def _discord_debug_lines_enabled() -> bool:
    return os.environ.get("HERMES_LIFE_DISCORD_DEBUG_LINES", "").lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def _env_bool(name: str, *, default: bool = False) -> bool:
    raw = os.environ.get(name, "")
    if not raw:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, *, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(str(os.environ.get(name, "") or "").strip())
    except ValueError:
        return default
    return max(minimum, min(maximum, value))


def _split_env_list(raw: str) -> tuple[str, ...]:
    values: list[str] = []
    for part in re.split(r"\|\||[\n\r]+", raw or ""):
        clean = _clip_line(part, 160).strip()
        if clean:
            values.append(clean)
    return tuple(values)


def _json_env_list(name: str) -> tuple[Any, ...]:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return ()
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return ()
    if not isinstance(data, list):
        return ()
    return tuple(data)


def _source_key(prefix: str, value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")
    if not slug:
        return prefix
    return _clip_line(f"{prefix}_{slug}", 80)


@dataclass(frozen=True)
class InterestItem:
    item_id: str
    source: str
    source_label: str
    title: str
    url: str
    summary: str = ""
    published_at: datetime | None = None
    captured_at: datetime | None = None
    tags: tuple[str, ...] = ()
    score: float = 0.0
    reasons: tuple[str, ...] = ()
    untrusted: bool = True


@dataclass(frozen=True)
class InterestDigestResult:
    message: str
    items: tuple[InterestItem, ...]
    fetched_count: int = 0
    errors: tuple[str, ...] = ()


@dataclass(frozen=True)
class InterestDispatchResult:
    ok: bool
    sent: int = 0
    failed: int = 0
    skipped_duplicate: int = 0
    skipped_missing_channel: int = 0
    skipped_empty: int = 0
    dispatch_id: str = ""
    error: str = ""


def _now() -> datetime:
    return datetime.now().astimezone()


def _interest_dir(root: Path) -> Path:
    return root / "interest"


def _items_path(root: Path) -> Path:
    return _interest_dir(root) / "items.jsonl"


def _feedback_path(root: Path) -> Path:
    return _interest_dir(root) / "feedback.jsonl"


def _seen_path(root: Path) -> Path:
    return _interest_dir(root) / "seen.jsonl"


def _profile_path(root: Path) -> Path:
    return _interest_dir(root) / "profile.json"


def _last_path(root: Path) -> Path:
    return _interest_dir(root) / "last.json"


def _dispatch_path(root: Path) -> Path:
    return _interest_dir(root) / "dispatch.jsonl"


def ensure_interest_storage(root: Path) -> None:
    _interest_dir(root).mkdir(parents=True, exist_ok=True)


def _clip_line(text: str, limit: int = 180) -> str:
    one_line = " ".join(html.unescape(re.sub(r"<[^>]+>", " ", text or "")).strip().split())
    if len(one_line) <= limit:
        return one_line
    return one_line[: limit - 1].rstrip() + "..."


def _timestamp(value: datetime) -> str:
    return value.strftime("%Y-%m-%d %H:%M")


def _item_id(source: str, url: str, title: str) -> str:
    seed = f"{source}\n{url}\n{title}".encode("utf-8", errors="ignore")
    return hashlib.sha256(seed).hexdigest()[:20]


def _parse_datetime(value: Any, fallback_tz: Any) -> datetime | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        try:
            parsed = parsedate_to_datetime(raw)
        except (TypeError, ValueError):
            return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=fallback_tz)
    return parsed.astimezone()


def _to_row(item: InterestItem) -> dict[str, Any]:
    return {
        "itemId": item.item_id,
        "source": item.source,
        "sourceLabel": item.source_label,
        "title": item.title,
        "url": item.url,
        "summary": item.summary,
        "publishedAt": item.published_at.isoformat(timespec="seconds") if item.published_at else "",
        "capturedAt": item.captured_at.isoformat(timespec="seconds") if item.captured_at else "",
        "tags": list(item.tags),
        "untrusted": item.untrusted,
    }


def _from_row(row: dict[str, Any], now: datetime | None = None) -> InterestItem | None:
    current = now or _now()
    title = _clip_line(str(row.get("title", "") or ""), 180)
    url = _clip_line(str(row.get("url", "") or ""), 300)
    source = _clip_line(str(row.get("source", "") or "unknown"), 80)
    if not title or not url:
        return None
    tags_raw = row.get("tags", [])
    tags = tuple(
        _clip_line(str(item or ""), 40).lower()
        for item in tags_raw
        if isinstance(item, str) and str(item).strip()
    )
    return InterestItem(
        item_id=_clip_line(str(row.get("itemId", "") or _item_id(source, url, title)), 80),
        source=source,
        source_label=_clip_line(str(row.get("sourceLabel", "") or source), 120),
        title=title,
        url=url,
        summary=_clip_line(str(row.get("summary", "") or ""), 240),
        published_at=_parse_datetime(row.get("publishedAt"), current.tzinfo),
        captured_at=_parse_datetime(row.get("capturedAt"), current.tzinfo),
        tags=tags,
        untrusted=bool(row.get("untrusted", True)),
    )


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
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as handle:
        tmp_path = Path(handle.name)
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")
    tmp_path.replace(path)


def _append_jsonl(path: Path, row: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")


class _InterestLock:
    def __init__(self, root: Path) -> None:
        self.path = _interest_dir(root) / ".interest.lock"
        self.handle: Any = None

    def __enter__(self) -> "_InterestLock":
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.handle = self.path.open("a+", encoding="utf-8")
        if fcntl is not None:
            fcntl.flock(self.handle, fcntl.LOCK_EX)
        return self

    def __exit__(self, *_exc: object) -> None:
        if self.handle is not None and fcntl is not None:
            fcntl.flock(self.handle, fcntl.LOCK_UN)
        if self.handle is not None:
            self.handle.close()


def _child_text(node: ET.Element, names: tuple[str, ...]) -> str:
    for child in list(node):
        clean = child.tag.rsplit("}", 1)[-1].lower()
        if clean in names:
            return child.text or ""
    return ""


def _entry_link(node: ET.Element) -> str:
    for child in list(node):
        clean = child.tag.rsplit("}", 1)[-1].lower()
        if clean == "link":
            href = child.attrib.get("href", "")
            if href:
                return href.strip()
            if child.text:
                return child.text.strip()
    return ""


def _keywords_for_text(text: str, candidates: Iterator[str]) -> tuple[str, ...]:
    lower = text.lower()
    found: list[str] = []
    for keyword in candidates:
        clean = keyword.strip().lower()
        if clean and clean in lower and clean not in found:
            found.append(clean)
    return tuple(found)


def parse_feed_items(
    body: str,
    *,
    source: str,
    source_label: str,
    now: datetime | None = None,
) -> list[InterestItem]:
    current = now or _now()
    try:
        root = ET.fromstring(body)
    except ET.ParseError:
        return []
    entries = [
        node
        for node in root.iter()
        if node.tag.rsplit("}", 1)[-1].lower() in {"item", "entry"}
    ]
    items: list[InterestItem] = []
    for node in entries[:30]:
        title = _clip_line(_child_text(node, ("title",)), 180)
        url = _clip_line(_entry_link(node), 300)
        summary = _clip_line(_child_text(node, ("summary", "description", "content")), 240)
        raw_date = _child_text(node, ("published", "updated", "pubdate", "date"))
        published = _parse_datetime(raw_date, current.tzinfo)
        if not title or not url:
            continue
        tags = _keywords_for_text(
            f"{title} {summary}",
            iter(DEFAULT_POSITIVE_KEYWORDS),
        )
        items.append(
            InterestItem(
                item_id=_item_id(source, url, title),
                source=source,
                source_label=source_label,
                title=title,
                url=url,
                summary=summary,
                published_at=published,
                captured_at=current,
                tags=tags,
                untrusted=True,
            )
        )
    return items


def _fetch_url_text(url: str, *, headers: dict[str, str] | None = None, timeout: int = 20) -> str:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": USER_AGENT, **(headers or {})},
        method="GET",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read().decode("utf-8", errors="replace")


def fetch_text(url: str, timeout: int = 20) -> str:
    return _fetch_url_text(
        url,
        headers={"Accept": "application/rss+xml, application/atom+xml, text/xml"},
        timeout=timeout,
    )


Fetcher = Callable[[str], str]
WebSearcher = Callable[[str, int], dict[str, Any]]


def _weather_enabled() -> bool:
    return _env_bool("LIFE_PILOT_INTEREST_WEATHER_ENABLED")


def _weather_forecast_url() -> tuple[str, str]:
    if not _weather_enabled():
        return "", ""
    latitude = str(os.environ.get("LIFE_PILOT_INTEREST_WEATHER_LATITUDE", "") or "").strip()
    longitude = str(os.environ.get("LIFE_PILOT_INTEREST_WEATHER_LONGITUDE", "") or "").strip()
    if not latitude or not longitude:
        return "", "open_meteo_weather: missing coordinates"
    timezone_name = str(
        os.environ.get("LIFE_PILOT_INTEREST_WEATHER_TIMEZONE")
        or os.environ.get("TZ")
        or "Asia/Tokyo"
    ).strip()
    endpoint = str(os.environ.get("LIFE_PILOT_INTEREST_WEATHER_ENDPOINT") or OPEN_METEO_FORECAST_URL).strip()
    params = {
        "latitude": latitude,
        "longitude": longitude,
        "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
        "timezone": timezone_name,
        "forecast_days": "1",
    }
    return f"{endpoint}?{urllib.parse.urlencode(params)}", ""


def _daily_value(daily: dict[str, Any], key: str) -> Any:
    value = daily.get(key)
    if isinstance(value, list) and value:
        return value[0]
    return value


def _format_float(value: Any, *, suffix: str = "", digits: int = 1) -> str:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return "不明"
    if number.is_integer():
        return f"{int(number)}{suffix}"
    return f"{number:.{digits}f}{suffix}"


def parse_open_meteo_weather_item(
    body: str,
    *,
    request_url: str,
    now: datetime | None = None,
) -> InterestItem | None:
    current = now or _now()
    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict):
        return None
    daily = payload.get("daily")
    if not isinstance(daily, dict):
        return None
    date_text = str(_daily_value(daily, "time") or current.strftime("%Y-%m-%d"))
    code_raw = _daily_value(daily, "weather_code")
    try:
        code = int(code_raw)
    except (TypeError, ValueError):
        code = -1
    condition = WEATHER_CODE_LABELS.get(code, f"天気コード{code}" if code >= 0 else "天気不明")
    max_temp = _format_float(_daily_value(daily, "temperature_2m_max"), suffix="C")
    min_temp = _format_float(_daily_value(daily, "temperature_2m_min"), suffix="C")
    precip = _format_float(_daily_value(daily, "precipitation_probability_max"), suffix="%")
    location = _clip_line(os.environ.get("LIFE_PILOT_INTEREST_WEATHER_LABEL", "") or "local weather", 80)
    title = f"{location} 今日の天気 ({date_text}): {condition} {min_temp}-{max_temp} / 降水確率{precip}"
    summary = f"{date_text} のOpen-Meteo日次予報。気温 {min_temp}-{max_temp}、降水確率最大 {precip}。"
    item_url = f"{request_url}#date={urllib.parse.quote(date_text)}"
    return InterestItem(
        item_id=_item_id("open_meteo_weather", item_url, title),
        source="open_meteo_weather",
        source_label=f"Open-Meteo Weather: {location}",
        title=_clip_line(title, 180),
        url=_clip_line(item_url, 300),
        summary=_clip_line(summary, 240),
        published_at=current,
        captured_at=current,
        tags=("weather", "forecast", "天気"),
        untrusted=True,
    )


def collect_weather_items(
    *,
    fetcher: Fetcher = fetch_text,
    now: datetime | None = None,
) -> tuple[list[InterestItem], tuple[str, ...]]:
    url, error = _weather_forecast_url()
    if error:
        return [], (error,)
    if not url:
        return [], ()
    try:
        body = fetcher(url)
    except (OSError, ValueError, urllib.error.URLError) as exc:
        return [], (f"open_meteo_weather: {type(exc).__name__}",)
    item = parse_open_meteo_weather_item(body, request_url=url, now=now)
    if item is None:
        return [], ("open_meteo_weather: parse_error",)
    return [item], ()


def _web_search_enabled() -> bool:
    return _env_bool("LIFE_PILOT_INTEREST_WEB_SEARCH_ENABLED")


def _configured_web_search_queries() -> tuple[str, ...]:
    queries: list[str] = []
    for item in _json_env_list("LIFE_PILOT_INTEREST_WEB_SEARCH_QUERIES_JSON"):
        if isinstance(item, str):
            clean = _clip_line(item, 160).strip()
        elif isinstance(item, dict):
            clean = _clip_line(str(item.get("query", "") or ""), 160).strip()
        else:
            clean = ""
        if clean and clean not in queries:
            queries.append(clean)
    for query in _split_env_list(os.environ.get("LIFE_PILOT_INTEREST_WEB_SEARCH_QUERIES", "")):
        if query not in queries:
            queries.append(query)
    return tuple(queries[:MAX_WEB_SEARCH_QUERIES])


def fetch_brave_web_search(query: str, count: int = MAX_WEB_SEARCH_RESULTS_PER_QUERY) -> dict[str, Any]:
    token = str(
        os.environ.get("BRAVE_SEARCH_API_KEY")
        or os.environ.get("LIFE_PILOT_INTEREST_BRAVE_SEARCH_API_KEY")
        or ""
    ).strip()
    if not token:
        raise ValueError("BRAVE_SEARCH_API_KEY missing")
    endpoint = str(os.environ.get("LIFE_PILOT_INTEREST_WEB_SEARCH_ENDPOINT") or BRAVE_WEB_SEARCH_URL).strip()
    params: dict[str, str] = {
        "q": query,
        "count": str(max(1, min(MAX_WEB_SEARCH_RESULTS_PER_QUERY, count))),
    }
    optional_env = {
        "country": "LIFE_PILOT_INTEREST_WEB_SEARCH_COUNTRY",
        "search_lang": "LIFE_PILOT_INTEREST_WEB_SEARCH_LANG",
        "ui_lang": "LIFE_PILOT_INTEREST_WEB_SEARCH_UI_LANG",
        "freshness": "LIFE_PILOT_INTEREST_WEB_SEARCH_FRESHNESS",
        "safesearch": "LIFE_PILOT_INTEREST_WEB_SEARCH_SAFESEARCH",
    }
    for param, env_name in optional_env.items():
        value = str(os.environ.get(env_name, "") or "").strip()
        if value:
            params[param] = value
    url = f"{endpoint}?{urllib.parse.urlencode(params)}"
    body = _fetch_url_text(
        url,
        headers={
            "Accept": "application/json",
            "X-Subscription-Token": token,
        },
    )
    payload = json.loads(body)
    if not isinstance(payload, dict):
        raise ValueError("Brave Search response is not a JSON object")
    return payload


def parse_brave_search_items(
    payload: dict[str, Any],
    *,
    query: str,
    now: datetime | None = None,
) -> list[InterestItem]:
    current = now or _now()
    web = payload.get("web")
    if not isinstance(web, dict):
        return []
    results = web.get("results", [])
    if not isinstance(results, list):
        return []
    clean_query = _clip_line(query, 120)
    items: list[InterestItem] = []
    for result in results[:MAX_WEB_SEARCH_RESULTS_PER_QUERY]:
        if not isinstance(result, dict):
            continue
        title = _clip_line(str(result.get("title", "") or ""), 180)
        url = _clip_line(str(result.get("url", "") or ""), 300)
        summary = _clip_line(str(result.get("description", "") or ""), 240)
        if not title or not url:
            continue
        source = _source_key("brave_web_search", clean_query)
        tags = ("web", "search") + _keywords_for_text(
            f"{clean_query} {title} {summary}",
            iter(DEFAULT_POSITIVE_KEYWORDS),
        )
        items.append(
            InterestItem(
                item_id=_item_id(source, url, title),
                source=source,
                source_label=f"Brave Search: {clean_query}",
                title=title,
                url=url,
                summary=summary,
                published_at=current,
                captured_at=current,
                tags=tuple(dict.fromkeys(tags)),
                untrusted=True,
            )
        )
    return items


def collect_web_search_items(
    *,
    searcher: WebSearcher = fetch_brave_web_search,
    queries: tuple[str, ...] | None = None,
    now: datetime | None = None,
    require_enabled: bool = True,
) -> tuple[list[InterestItem], tuple[str, ...]]:
    if require_enabled and not _web_search_enabled():
        return [], ("brave_web_search: disabled",) if queries else ()
    clean_queries = queries if queries is not None else _configured_web_search_queries()
    clean_queries = tuple(_clip_line(query, 160).strip() for query in clean_queries if str(query).strip())
    if not clean_queries:
        return [], ("brave_web_search: no queries",) if _web_search_enabled() else ()
    count = _env_int(
        "LIFE_PILOT_INTEREST_WEB_SEARCH_COUNT",
        default=MAX_WEB_SEARCH_RESULTS_PER_QUERY,
        minimum=1,
        maximum=MAX_WEB_SEARCH_RESULTS_PER_QUERY,
    )
    items: list[InterestItem] = []
    errors: list[str] = []
    for query in clean_queries[:MAX_WEB_SEARCH_QUERIES]:
        try:
            payload = searcher(query, count)
        except (OSError, ValueError, urllib.error.URLError, json.JSONDecodeError) as exc:
            errors.append(f"brave_web_search: {type(exc).__name__}")
            continue
        items.extend(parse_brave_search_items(payload, query=query, now=now))
    return items, tuple(errors)


def collect_feed_items(
    *,
    fetcher: Fetcher = fetch_text,
    now: datetime | None = None,
    sources: tuple[dict[str, str], ...] = DEFAULT_FEED_SOURCES,
) -> tuple[list[InterestItem], tuple[str, ...]]:
    current = now or _now()
    items: list[InterestItem] = []
    errors: list[str] = []
    for source in sources:
        url = source["url"]
        try:
            body = fetcher(url)
        except (OSError, ValueError, urllib.error.URLError) as exc:
            errors.append(f"{source['source']}: {type(exc).__name__}")
            continue
        items.extend(
            parse_feed_items(
                body,
                source=source["source"],
                source_label=source["label"],
                now=current,
            )
        )
    return items, tuple(errors)


def collect_shared_x_items(storage_root: Path, *, now: datetime | None = None) -> list[InterestItem]:
    current = now or _now()
    items: list[InterestItem] = []
    try:
        inbox_items = read_discord_inbox(storage_root, now=current, days=30, limit=50)
    except (OSError, ValueError, RuntimeError):
        return []
    for inbox in inbox_items:
        for url in inbox.urls:
            lowered = url.lower()
            if "://x.com/" not in lowered and "://twitter.com/" not in lowered:
                continue
            title = inbox.text or "Discordで共有したXリンク"
            summary = "あなたがDiscordへ共有したXリンクです。"
            items.append(
                InterestItem(
                    item_id=_item_id("x_shared_inbox", url, title),
                    source="x_shared_inbox",
                    source_label="Discord shared X",
                    title=_clip_line(title, 180),
                    url=_clip_line(url, 300),
                    summary=summary,
                    published_at=inbox.created_at,
                    captured_at=current,
                    tags=("x", "discord"),
                    untrusted=True,
                )
            )
    return items


def merge_interest_items(storage_root: Path, items: list[InterestItem]) -> int:
    ensure_interest_storage(storage_root)
    with _InterestLock(storage_root):
        rows = _read_jsonl(_items_path(storage_root))
        seen_keys = {
            str(row.get("url", "") or "").strip()
            or str(row.get("itemId", "") or "").strip()
            for row in rows
        }
        added = 0
        for item in items:
            key = item.url or item.item_id
            if key in seen_keys:
                continue
            rows.append(_to_row(item))
            seen_keys.add(key)
            added += 1
        rows = rows[-MAX_STORED_ITEMS:]
        _write_jsonl(_items_path(storage_root), rows)
        return added


def read_interest_items(
    storage_root: Path,
    *,
    now: datetime | None = None,
    days: int = 30,
    limit: int = 200,
) -> list[InterestItem]:
    current = now or _now()
    cutoff = current - timedelta(days=days)
    items: list[InterestItem] = []
    for row in _read_jsonl(_items_path(storage_root)):
        item = _from_row(row, now=current)
        if item is None:
            continue
        when = item.published_at or item.captured_at or current
        if when < cutoff:
            continue
        items.append(item)
    items.sort(key=lambda item: item.published_at or item.captured_at or current, reverse=True)
    return items[:limit]


def _default_profile() -> dict[str, Any]:
    return {
        "positiveKeywords": list(DEFAULT_POSITIVE_KEYWORDS),
        "negativeKeywords": list(DEFAULT_NEGATIVE_KEYWORDS),
        "sourceWeights": {},
        "keywordWeights": {},
        "mutedKeywords": {},
        "memoryCandidates": [],
    }


def read_interest_profile(storage_root: Path) -> dict[str, Any]:
    path = _profile_path(storage_root)
    if not path.is_file():
        return _default_profile()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return _default_profile()
    if not isinstance(data, dict):
        return _default_profile()
    profile = _default_profile()
    profile.update(data)
    return profile


def _write_profile(storage_root: Path, profile: dict[str, Any]) -> None:
    ensure_interest_storage(storage_root)
    _profile_path(storage_root).write_text(
        json.dumps(profile, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _score_keywords(profile: dict[str, Any]) -> tuple[list[str], list[str]]:
    positive = [
        str(item).strip().lower()
        for item in profile.get("positiveKeywords", [])
        if str(item).strip()
    ]
    negative = [
        str(item).strip().lower()
        for item in profile.get("negativeKeywords", [])
        if str(item).strip()
    ]
    keyword_weights = profile.get("keywordWeights", {})
    muted = profile.get("mutedKeywords", {})
    if isinstance(keyword_weights, dict):
        for key, value in keyword_weights.items():
            if str(key).strip() and int(value or 0) > 0 and str(key).strip().lower() not in positive:
                positive.append(str(key).strip().lower())
    if isinstance(muted, dict):
        for key, value in muted.items():
            if str(key).strip() and int(value or 0) > 0 and str(key).strip().lower() not in negative:
                negative.append(str(key).strip().lower())
    return positive, negative


def _seen_urls(storage_root: Path, *, now: datetime | None = None, days: int = 45) -> set[str]:
    current = now or _now()
    cutoff = current - timedelta(days=days)
    urls: set[str] = set()
    for row in _read_jsonl(_seen_path(storage_root)):
        seen_at = _parse_datetime(row.get("seenAt"), current.tzinfo)
        if seen_at is not None and seen_at < cutoff:
            continue
        url = str(row.get("url", "") or "").strip()
        if url:
            urls.add(url)
    return urls


def _mark_seen(storage_root: Path, items: tuple[InterestItem, ...], *, now: datetime | None = None) -> None:
    current = now or _now()
    rows = _read_jsonl(_seen_path(storage_root))
    existing = {str(row.get("url", "") or "").strip() for row in rows}
    for item in items:
        if item.url in existing:
            continue
        rows.append(
            {
                "itemId": item.item_id,
                "url": item.url,
                "source": item.source,
                "seenAt": current.isoformat(timespec="seconds"),
            }
        )
        existing.add(item.url)
    _write_jsonl(_seen_path(storage_root), rows[-MAX_SEEN:])


def rank_interest_items(
    items: list[InterestItem],
    profile: dict[str, Any],
    *,
    storage_root: Path,
    now: datetime | None = None,
    include_seen: bool = False,
) -> list[InterestItem]:
    current = now or _now()
    seen = set() if include_seen else _seen_urls(storage_root, now=current)
    positive, negative = _score_keywords(profile)
    source_weights = profile.get("sourceWeights", {})
    if not isinstance(source_weights, dict):
        source_weights = {}
    ranked: list[InterestItem] = []
    for item in items:
        if item.url in seen:
            continue
        text = f"{item.title} {item.summary} {' '.join(item.tags)}".lower()
        score = 1.0
        reasons: list[str] = []
        for keyword in positive:
            if keyword in text:
                score += 1.5
                if len(reasons) < 3:
                    reasons.append(f"{keyword} に関係")
        for keyword in negative:
            if keyword in text:
                score -= 2.0
        source_weight = int(source_weights.get(item.source, 0) or 0)
        if source_weight:
            score += source_weight * 0.5
            if source_weight > 0 and len(reasons) < 3:
                reasons.append(f"{item.source_label}をよく選んでいる")
        when = item.published_at or item.captured_at
        if when is not None:
            age_hours = max(0.0, (current - when).total_seconds() / 3600)
            if age_hours < 48:
                score += 1.0
                if len(reasons) < 3:
                    reasons.append("新しめ")
        if not reasons:
            reasons.append("登録済みの関心領域に近い")
        ranked.append(
            InterestItem(
                item_id=item.item_id,
                source=item.source,
                source_label=item.source_label,
                title=item.title,
                url=item.url,
                summary=item.summary,
                published_at=item.published_at,
                captured_at=item.captured_at,
                tags=item.tags,
                score=score,
                reasons=tuple(reasons),
                untrusted=item.untrusted,
            )
        )
    ranked.sort(key=lambda item: (item.score, item.published_at or item.captured_at or current), reverse=True)
    return ranked


def _save_last(storage_root: Path, items: tuple[InterestItem, ...], now: datetime) -> None:
    ensure_interest_storage(storage_root)
    payload = {
        "createdAt": now.isoformat(timespec="seconds"),
        "items": [_to_row(item) for item in items],
    }
    _last_path(storage_root).write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _read_last(storage_root: Path) -> list[InterestItem]:
    path = _last_path(storage_root)
    if not path.is_file():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []
    rows = data.get("items", []) if isinstance(data, dict) else []
    items: list[InterestItem] = []
    for row in rows:
        if isinstance(row, dict):
            item = _from_row(row)
            if item is not None:
                items.append(item)
    return items


def _render_item(index: int, item: InterestItem) -> str:
    reason = " / ".join(item.reasons[:2]) if item.reasons else "関心領域に近い"
    source = item.source_label
    when = item.published_at or item.captured_at
    when_text = f" · {_timestamp(when)}" if when else ""
    summary = f"\n   概要: {_clip_line(item.summary, 110)}" if item.summary else ""
    return (
        f"{index}. {source}{when_text}\n"
        f"   {item.title}{summary}\n"
        f"   理由: {reason}\n"
        f"   URL: {item.url}"
    )


def render_interest_digest(
    items: tuple[InterestItem, ...],
    *,
    fetched_count: int = 0,
    errors: tuple[str, ...] = (),
) -> str:
    if not items:
        error_line = f"\n取得エラー: {', '.join(errors)}" if errors else ""
        lines = [
            "今日の気になる投稿はまだありません。",
            "",
            f"新しい共有やフォーラム更新が入るとここに出ます。{error_line}",
            "",
            "返信: /interest refresh",
        ]
        if _discord_debug_lines_enabled():
            lines.append(
                f"-# debug: interest=digest items=0 fetched={fetched_count} "
                "boundary=read-summary-only/no-tools"
            )
        return "\n".join(lines).strip()
    lines = ["今日見るなら"]
    if errors:
        lines.append(f"一部取得失敗: {', '.join(errors)}")
    for index, item in enumerate(items, start=1):
        lines.append("")
        lines.append(_render_item(index, item))
    lines.extend(
        [
            "",
            "返信: /interest like 1 | save 1 | later 1 | dismiss 1 | more <話題> | less <話題>",
        ]
    )
    if _discord_debug_lines_enabled():
        lines.append(
            "-# debug: interest=digest "
            f"items={len(items)} fetched={fetched_count} boundary=read-summary-only/no-tools"
        )
    return "\n".join(lines).strip()


def build_interest_digest(
    storage_root: Path,
    *,
    now: datetime | None = None,
    fetch: bool = True,
    fetcher: Fetcher = fetch_text,
    web_searcher: WebSearcher = fetch_brave_web_search,
    max_items: int = 5,
    include_seen: bool = False,
    mark_seen: bool = True,
) -> InterestDigestResult:
    current = now or _now()
    ensure_interest_storage(storage_root)
    fetched_items: list[InterestItem] = []
    errors: tuple[str, ...] = ()
    if fetch:
        feed_items, feed_errors = collect_feed_items(fetcher=fetcher, now=current)
        weather_items, weather_errors = collect_weather_items(fetcher=fetcher, now=current)
        search_items, search_errors = collect_web_search_items(searcher=web_searcher, now=current)
        fetched_items = feed_items + weather_items + search_items
        errors = feed_errors + weather_errors + search_errors
    local_items = collect_shared_x_items(storage_root, now=current)
    added = merge_interest_items(storage_root, fetched_items + local_items)
    profile = read_interest_profile(storage_root)
    candidates = read_interest_items(storage_root, now=current)
    ranked = rank_interest_items(
        candidates,
        profile,
        storage_root=storage_root,
        now=current,
        include_seen=include_seen,
    )
    selected = tuple(ranked[:max_items])
    _save_last(storage_root, selected, current)
    if mark_seen:
        _mark_seen(storage_root, selected, now=current)
    return InterestDigestResult(
        message=render_interest_digest(selected, fetched_count=added, errors=errors),
        items=selected,
        fetched_count=added,
        errors=errors,
    )


def render_interest_search_digest(
    query: str,
    items: tuple[InterestItem, ...],
    *,
    fetched_count: int = 0,
    errors: tuple[str, ...] = (),
) -> str:
    clean_query = _clip_line(query, 120)
    if not items:
        error_line = f"\n取得エラー: {', '.join(errors)}" if errors else ""
        return f"""Web検索: {clean_query}

候補を取得できませんでした。{error_line}

設定: LIFE_PILOT_INTEREST_WEB_SEARCH_ENABLED=true と BRAVE_SEARCH_API_KEY が必要です。
返信: /interest search <調べたいこと>""".strip()
    lines = [f"Web検索: {clean_query}"]
    if errors:
        lines.append(f"一部取得失敗: {', '.join(errors)}")
    for index, item in enumerate(items, start=1):
        lines.append("")
        lines.append(_render_item(index, item))
    lines.extend(
        [
            "",
            "返信: /interest like 1 | save 1 | later 1 | dismiss 1 | more <話題> | less <話題>",
        ]
    )
    if _discord_debug_lines_enabled():
        lines.append(
            "-# debug: interest=web-search "
            f"items={len(items)} fetched={fetched_count} boundary=read-summary-only/no-tools"
        )
    return "\n".join(lines).strip()


def build_interest_search_digest(
    storage_root: Path,
    query: str,
    *,
    now: datetime | None = None,
    web_searcher: WebSearcher = fetch_brave_web_search,
    max_items: int = 5,
) -> InterestDigestResult:
    current = now or _now()
    ensure_interest_storage(storage_root)
    items, errors = collect_web_search_items(
        searcher=web_searcher,
        queries=(_clip_line(query, 160),),
        now=current,
        require_enabled=True,
    )
    added = merge_interest_items(storage_root, items)
    profile = read_interest_profile(storage_root)
    ranked = rank_interest_items(
        items,
        profile,
        storage_root=storage_root,
        now=current,
        include_seen=True,
    )
    selected = tuple(ranked[:max_items])
    _save_last(storage_root, selected, current)
    return InterestDigestResult(
        message=render_interest_search_digest(query, selected, fetched_count=added, errors=errors),
        items=selected,
        fetched_count=added,
        errors=errors,
    )


InterestSender = Callable[[str, str], DiscordSendResult]


def _read_context(storage_root: Path) -> tuple[str, str]:
    path = storage_root / "context" / "discord.json"
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


def _latest_reminder_context(storage_root: Path) -> tuple[str, str]:
    path = storage_root / "reminders" / "reminders.jsonl"
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


def _resolve_dispatch_context(
    storage_root: Path,
    *,
    channel_id: str = "",
    user_id: str = "",
) -> tuple[str, str]:
    clean_channel = str(channel_id or "").strip()
    clean_user = str(user_id or "").strip()
    if clean_channel:
        return clean_user, clean_channel
    context_user, context_channel = _read_context(storage_root)
    if context_channel:
        return context_user, context_channel
    return _latest_reminder_context(storage_root)


def _dispatch_id(now: datetime) -> str:
    return f"daily-interest-{now.strftime('%Y-%m-%d')}"


def _env_sender() -> InterestSender:
    token = os.environ.get("DISCORD_BOT_TOKEN", "")

    def _send(channel_id: str, content: str) -> DiscordSendResult:
        return send_discord_channel_message(token, channel_id, content)

    return _send


def dispatch_daily_interest_digest(
    storage_root: Path,
    *,
    now: datetime | None = None,
    sender: InterestSender | None = None,
    channel_id: str = "",
    user_id: str = "",
    fetch: bool = True,
    fetcher: Fetcher = fetch_text,
    web_searcher: WebSearcher = fetch_brave_web_search,
) -> InterestDispatchResult:
    current = now or _now()
    ensure_interest_storage(storage_root)
    dispatch_id = _dispatch_id(current)
    context_user, context_channel = _resolve_dispatch_context(
        storage_root,
        channel_id=channel_id,
        user_id=user_id,
    )
    if not context_channel:
        return InterestDispatchResult(
            ok=True,
            skipped_missing_channel=1,
            dispatch_id=dispatch_id,
        )
    with _InterestLock(storage_root):
        for row in _read_jsonl(_dispatch_path(storage_root)):
            if row.get("id") == dispatch_id and row.get("status") == "sent":
                return InterestDispatchResult(
                    ok=True,
                    skipped_duplicate=1,
                    dispatch_id=dispatch_id,
                )

    digest = build_interest_digest(
        storage_root,
        now=current,
        fetch=fetch,
        fetcher=fetcher,
        web_searcher=web_searcher,
        mark_seen=False,
    )
    if not digest.items:
        return InterestDispatchResult(
            ok=True,
            skipped_empty=1,
            dispatch_id=dispatch_id,
        )
    send = sender or _env_sender()
    result = send(context_channel, digest.message)
    row: dict[str, Any] = {
        "id": dispatch_id,
        "createdAt": current.isoformat(timespec="seconds"),
        "channelId": context_channel,
        "userId": context_user,
        "itemIds": [item.item_id for item in digest.items],
        "status": "sent" if result.ok else "send_failed",
    }
    if result.ok:
        row["sentAt"] = current.isoformat(timespec="seconds")
        _mark_seen(storage_root, digest.items, now=current)
    else:
        row["lastSendError"] = result.error or f"HTTP {result.status_code}"
    with _InterestLock(storage_root):
        rows = [item for item in _read_jsonl(_dispatch_path(storage_root)) if item.get("id") != dispatch_id]
        rows.append(row)
        _write_jsonl(_dispatch_path(storage_root), rows[-MAX_FEEDBACK:])
    return InterestDispatchResult(
        ok=result.ok,
        sent=1 if result.ok else 0,
        failed=0 if result.ok else 1,
        dispatch_id=dispatch_id,
        error="" if result.ok else row.get("lastSendError", ""),
    )


def _select_last_item(storage_root: Path, selector: str) -> InterestItem | None:
    try:
        position = int(str(selector or "").strip())
    except ValueError:
        return None
    if position < 1:
        return None
    items = _read_last(storage_root)
    if position > len(items):
        return None
    return items[position - 1]


def _extract_feedback_keywords(item: InterestItem) -> tuple[str, ...]:
    candidates = list(DEFAULT_POSITIVE_KEYWORDS) + list(item.tags)
    return _keywords_for_text(f"{item.title} {item.summary} {' '.join(item.tags)}", iter(candidates))


def _bump(mapping: dict[str, Any], key: str, amount: int) -> None:
    clean = _clip_line(key, 60).lower()
    if not clean:
        return
    mapping[clean] = max(-20, min(20, int(mapping.get(clean, 0) or 0) + amount))


def _memory_candidate(profile: dict[str, Any]) -> str:
    weights = profile.get("keywordWeights", {})
    muted = profile.get("mutedKeywords", {})
    if not isinstance(weights, dict) or not isinstance(muted, dict):
        return ""
    liked = [key for key, value in sorted(weights.items(), key=lambda kv: int(kv[1] or 0), reverse=True) if int(value or 0) >= 3]
    disliked = [key for key, value in sorted(muted.items(), key=lambda kv: int(kv[1] or 0), reverse=True) if int(value or 0) >= 3]
    parts: list[str] = []
    if liked:
        parts.append(f"Daily Interest Digest should prioritize: {', '.join(liked[:5])}.")
    if disliked:
        parts.append(f"Daily Interest Digest should downrank: {', '.join(disliked[:5])}.")
    return " ".join(parts)


def record_interest_feedback(
    storage_root: Path,
    action: str,
    *,
    selector: str = "",
    topic: str = "",
    now: datetime | None = None,
) -> str:
    current = now or _now()
    clean_action = str(action or "").strip().lower()
    ensure_interest_storage(storage_root)
    if clean_action in {"more", "less"}:
        clean_topic = _clip_line(topic, 80).lower()
        if not clean_topic:
            return "話題を指定してください。\n例: /interest more vLLM"
        profile = read_interest_profile(storage_root)
        target = "keywordWeights" if clean_action == "more" else "mutedKeywords"
        if not isinstance(profile.get(target), dict):
            profile[target] = {}
        _bump(profile[target], clean_topic, 2)
        candidate = _memory_candidate(profile)
        if candidate:
            profile["memoryCandidates"] = [candidate]
        _write_profile(storage_root, profile)
        _append_jsonl(
            _feedback_path(storage_root),
            {
                "createdAt": current.isoformat(timespec="seconds"),
                "action": clean_action,
                "topic": clean_topic,
            },
        )
        return f"""好みに反映しました: {clean_topic}

-# debug: interest=feedback action={clean_action} boundary=local-only/no-tools""".strip()

    if clean_action not in ACTION_LABELS:
        return render_interest_usage()
    item = _select_last_item(storage_root, selector)
    if item is None:
        return f"""番号が見つかりません: {selector or "(未指定)"}

先に /interest を実行してください。""".strip()
    profile = read_interest_profile(storage_root)
    if not isinstance(profile.get("sourceWeights"), dict):
        profile["sourceWeights"] = {}
    if not isinstance(profile.get("keywordWeights"), dict):
        profile["keywordWeights"] = {}
    if not isinstance(profile.get("mutedKeywords"), dict):
        profile["mutedKeywords"] = {}
    source_delta = 1 if clean_action in {"like", "save", "later"} else -1
    _bump(profile["sourceWeights"], item.source, source_delta)
    for keyword in _extract_feedback_keywords(item):
        _bump(
            profile["keywordWeights"] if source_delta > 0 else profile["mutedKeywords"],
            keyword,
            1,
        )
    candidate = _memory_candidate(profile)
    if candidate:
        profile["memoryCandidates"] = [candidate]
    _write_profile(storage_root, profile)
    rows = _read_jsonl(_feedback_path(storage_root))
    rows.append(
        {
            "createdAt": current.isoformat(timespec="seconds"),
            "action": clean_action,
            "itemId": item.item_id,
            "source": item.source,
            "title": item.title,
            "url": item.url,
            "untrusted": True,
        }
    )
    _write_jsonl(_feedback_path(storage_root), rows[-MAX_FEEDBACK:])
    memory_line = f"\nMemory候補: {candidate}" if candidate else ""
    return f"""{ACTION_LABELS[clean_action]}として記録しました: {_clip_line(item.title, 90)}
{memory_line}

-# debug: interest=feedback action={clean_action} boundary=local-only/no-tools""".strip()


def render_interest_profile(storage_root: Path) -> str:
    profile = read_interest_profile(storage_root)
    positive, negative = _score_keywords(profile)
    memory_candidates = profile.get("memoryCandidates", [])
    if not isinstance(memory_candidates, list):
        memory_candidates = []
    source_weights = profile.get("sourceWeights", {})
    if not isinstance(source_weights, dict):
        source_weights = {}
    top_sources = [
        f"{key}:{value}"
        for key, value in sorted(source_weights.items(), key=lambda kv: int(kv[1] or 0), reverse=True)[:5]
    ]
    memory_line = f"\nMemory候補:\n- {memory_candidates[0]}" if memory_candidates else ""
    return f"""Interest Profile

優先キーワード: {', '.join(positive[:12])}
下げるキーワード: {', '.join(negative[:8])}
source重み: {', '.join(top_sources) if top_sources else '(未記録)'}{memory_line}

-# debug: interest=profile boundary=local-only/no-tools""".strip()


def render_interest_usage() -> str:
    return (
        "usage: /interest [refresh|search <query>|profile|like N|save N|later N|dismiss N|more <topic>|less <topic>]\n"
        "examples:\n"
        "- /interest\n"
        "- /interest search 今日の天気\n"
        "- /interest like 1\n"
        "- /interest more vLLM\n"
        "- /interest less 価格だけの話"
    )


def handle_interest_command(
    storage_root: Path,
    raw_args: str,
    *,
    now: datetime | None = None,
    fetcher: Fetcher = fetch_text,
    web_searcher: WebSearcher = fetch_brave_web_search,
) -> str:
    text = " ".join((raw_args or "").strip().split())
    if text.startswith("/interest "):
        text = text[len("/interest ") :].strip()
    if not text or text in {"refresh", "run", "today"}:
        return build_interest_digest(storage_root, now=now, fetch=True, fetcher=fetcher).message
    if text == "profile":
        return render_interest_profile(storage_root)
    parts = text.split(maxsplit=1)
    action = parts[0].strip().lower()
    rest = parts[1].strip() if len(parts) > 1 else ""
    if action == "search":
        if not rest:
            return "検索語を指定してください。\n例: /interest search 今日の天気"
        return build_interest_search_digest(
            storage_root,
            rest,
            now=now,
            web_searcher=web_searcher,
        ).message
    if action in {"like", "save", "later", "dismiss"}:
        return record_interest_feedback(storage_root, action, selector=rest, now=now)
    if action in {"more", "less"}:
        return record_interest_feedback(storage_root, action, topic=rest, now=now)
    return render_interest_usage()
