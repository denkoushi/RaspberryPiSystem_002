#!/usr/bin/env python3
"""Daily Interest Digest tests."""

import json
import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from lib.life_discord_inbox import capture_discord_inbox_message  # noqa: E402
from lib.life_reminder_scheduler import DiscordSendResult  # noqa: E402
from lib.life_interest_digest import (  # noqa: E402
    build_interest_digest,
    dispatch_daily_interest_digest,
    handle_interest_command,
    parse_feed_items,
    read_interest_profile,
    record_interest_feedback,
    render_interest_profile,
)


RSS_BODY = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>DGX Spark / GB10</title>
    <item>
      <title>DGX Spark vLLM cold start workaround</title>
      <link>https://forums.developer.nvidia.com/t/dgx-spark-vllm/123</link>
      <description>Discussion about NVFP4, vLLM, and startup time.</description>
      <pubDate>Sun, 07 Jun 2026 09:00:00 +0900</pubDate>
    </item>
  </channel>
</rss>
"""


ATOM_BODY = """<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Hermes Agent Releases</title>
  <entry>
    <title>Hermes Agent cron and skills update</title>
    <link href="https://github.com/NousResearch/hermes-agent/releases/tag/v1"/>
    <summary>Skills and cron improvements.</summary>
    <updated>2026-06-07T01:00:00+00:00</updated>
  </entry>
</feed>
"""


EMPTY_RSS_BODY = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Empty</title>
  </channel>
</rss>
"""


OPEN_METEO_BODY = json.dumps(
    {
        "daily": {
            "time": ["2026-06-07"],
            "weather_code": [61],
            "temperature_2m_max": [28.4],
            "temperature_2m_min": [21.1],
            "precipitation_probability_max": [70],
        }
    }
)


def brave_payload(query: str) -> dict[str, object]:
    slug = query.lower().replace(" ", "-")
    return {
        "web": {
            "results": [
                {
                    "title": f"{query} field report",
                    "url": f"https://example.com/search/{slug}",
                    "description": "A concise public web result about vLLM and local LLM operations.",
                }
            ]
        }
    }


class LifeInterestDigestTests(unittest.TestCase):
    def setUp(self) -> None:
        self.env_patcher = patch.dict(
            os.environ,
            {
                "BRAVE_SEARCH_API_KEY": "",
                "LIFE_PILOT_INTEREST_BRAVE_SEARCH_API_KEY": "",
                "LIFE_PILOT_INTEREST_WEATHER_ENABLED": "",
                "LIFE_PILOT_INTEREST_WEB_SEARCH_ENABLED": "",
                "LIFE_PILOT_INTEREST_WEB_SEARCH_QUERIES": "",
                "LIFE_PILOT_INTEREST_WEB_SEARCH_QUERIES_JSON": "",
            },
            clear=False,
        )
        self.env_patcher.start()

    def tearDown(self) -> None:
        self.env_patcher.stop()

    def test_parse_rss_and_atom_items(self) -> None:
        now = datetime(2026, 6, 7, 10, 0, tzinfo=timezone(timedelta(hours=9)))

        rss_items = parse_feed_items(
            RSS_BODY,
            source="nvidia_dgx_spark_forum",
            source_label="NVIDIA DGX Spark Forum",
            now=now,
        )
        atom_items = parse_feed_items(
            ATOM_BODY,
            source="hermes_agent_releases",
            source_label="Hermes Agent GitHub Releases",
            now=now,
        )

        self.assertEqual(len(rss_items), 1)
        self.assertIn("vLLM", rss_items[0].title)
        self.assertIn("vllm", rss_items[0].tags)
        self.assertEqual(len(atom_items), 1)
        self.assertIn("cron", atom_items[0].tags)

    def test_digest_includes_discord_shared_x_link_without_fetch(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            now = datetime(2026, 6, 7, 10, 0, tzinfo=timezone(timedelta(hours=9)))
            capture_discord_inbox_message(
                root,
                "あとで見る https://x.com/example/status/123",
                now=now,
            )

            digest = build_interest_digest(root, now=now, fetch=False)

        self.assertIn("今日見るなら", digest.message)
        self.assertIn("Discord shared X", digest.message)
        self.assertIn("https://x.com/example/status/123", digest.message)
        self.assertNotIn("boundary=read-summary-only/no-tools", digest.message)

    def test_fetcher_items_are_stored_and_ranked(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            now = datetime(2026, 6, 7, 10, 0, tzinfo=timezone(timedelta(hours=9)))

            def fetcher(url: str) -> str:
                return RSS_BODY if "nvidia" in url else ATOM_BODY

            digest = build_interest_digest(root, now=now, fetch=True, fetcher=fetcher)
            rows = [
                json.loads(line)
                for line in (root / "interest" / "items.jsonl")
                .read_text(encoding="utf-8")
                .splitlines()
            ]

        self.assertGreaterEqual(len(rows), 2)
        self.assertIn("vLLM", digest.message)
        self.assertIn("Hermes Agent", digest.message)

    def test_weather_env_source_is_stored_as_untrusted_digest_item(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            now = datetime(2026, 6, 7, 10, 0, tzinfo=timezone(timedelta(hours=9)))

            def fetcher(url: str) -> str:
                if "open-meteo.com" in url:
                    return OPEN_METEO_BODY
                return EMPTY_RSS_BODY

            with patch.dict(
                os.environ,
                {
                    "LIFE_PILOT_INTEREST_WEATHER_ENABLED": "true",
                    "LIFE_PILOT_INTEREST_WEATHER_LATITUDE": "35.6812",
                    "LIFE_PILOT_INTEREST_WEATHER_LONGITUDE": "139.7671",
                    "LIFE_PILOT_INTEREST_WEATHER_LABEL": "東京",
                    "LIFE_PILOT_INTEREST_WEATHER_TIMEZONE": "Asia/Tokyo",
                },
                clear=False,
            ):
                digest = build_interest_digest(root, now=now, fetch=True, fetcher=fetcher)
            rows = [
                json.loads(line)
                for line in (root / "interest" / "items.jsonl")
                .read_text(encoding="utf-8")
                .splitlines()
            ]

        self.assertIn("東京 今日の天気", digest.message)
        weather_rows = [row for row in rows if row["source"] == "open_meteo_weather"]
        self.assertEqual(len(weather_rows), 1)
        self.assertTrue(weather_rows[0]["untrusted"])
        self.assertIn("#date=2026-06-07", weather_rows[0]["url"])

    def test_configured_brave_search_queries_are_stored_and_ranked(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            now = datetime(2026, 6, 7, 10, 0, tzinfo=timezone(timedelta(hours=9)))
            calls: list[tuple[str, int]] = []

            def searcher(query: str, count: int) -> dict[str, object]:
                calls.append((query, count))
                return brave_payload(query)

            with patch.dict(
                os.environ,
                {
                    "LIFE_PILOT_INTEREST_WEB_SEARCH_ENABLED": "true",
                    "LIFE_PILOT_INTEREST_WEB_SEARCH_QUERIES": "DGX Spark||local LLM operations",
                },
                clear=False,
            ):
                digest = build_interest_digest(
                    root,
                    now=now,
                    fetch=True,
                    fetcher=lambda _url: EMPTY_RSS_BODY,
                    web_searcher=searcher,
                )

        self.assertEqual(calls, [("DGX Spark", 3), ("local LLM operations", 3)])
        self.assertIn("Brave Search: DGX Spark", digest.message)
        self.assertIn("local LLM operations field report", digest.message)

    def test_interest_search_runs_one_shot_web_search(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            now = datetime(2026, 6, 7, 10, 0, tzinfo=timezone(timedelta(hours=9)))

            with patch.dict(
                os.environ,
                {
                    "LIFE_PILOT_INTEREST_WEB_SEARCH_ENABLED": "true",
                },
                clear=False,
            ):
                message = handle_interest_command(
                    root,
                    "search vLLM NVFP4",
                    now=now,
                    web_searcher=lambda query, _count: brave_payload(query),
                )

        self.assertIn("Web検索: vLLM NVFP4", message)
        self.assertIn("vLLM NVFP4 field report", message)
        self.assertIn("URL: https://example.com/search/vllm-nvfp4", message)

    def test_feedback_updates_profile_and_memory_candidate(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            now = datetime(2026, 6, 7, 10, 0, tzinfo=timezone(timedelta(hours=9)))
            build_interest_digest(root, now=now, fetch=True, fetcher=lambda _url: RSS_BODY)

            for _ in range(3):
                message = record_interest_feedback(root, "like", selector="1", now=now)
            profile = read_interest_profile(root)
            rendered = render_interest_profile(root)

        self.assertIn("興味ありとして記録しました", message)
        self.assertGreaterEqual(int(profile["keywordWeights"]["vllm"]), 3)
        self.assertIn("Memory候補", rendered)

    def test_more_and_less_topics_update_profile(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)

            more = handle_interest_command(root, "more NVFP4")
            less = handle_interest_command(root, "less 価格だけの話")
            profile = read_interest_profile(root)

        self.assertIn("好みに反映しました", more)
        self.assertIn("好みに反映しました", less)
        self.assertEqual(profile["keywordWeights"]["nvfp4"], 2)
        self.assertEqual(profile["mutedKeywords"]["価格だけの話"], 2)

    def test_daily_dispatch_sends_once_and_marks_seen_after_success(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "context").mkdir(parents=True)
            (root / "context" / "discord.json").write_text(
                json.dumps({"userId": "user-1", "channelId": "channel-1"}) + "\n",
                encoding="utf-8",
            )
            now = datetime(2026, 6, 7, 10, 0, tzinfo=timezone(timedelta(hours=9)))
            sent: list[tuple[str, str]] = []

            def sender(channel_id: str, content: str) -> DiscordSendResult:
                sent.append((channel_id, content))
                return DiscordSendResult(ok=True, status_code=200)

            first = dispatch_daily_interest_digest(
                root,
                now=now,
                sender=sender,
                fetcher=lambda _url: RSS_BODY,
            )
            second = dispatch_daily_interest_digest(
                root,
                now=now,
                sender=sender,
                fetcher=lambda _url: RSS_BODY,
            )
            seen_rows = [
                json.loads(line)
                for line in (root / "interest" / "seen.jsonl")
                .read_text(encoding="utf-8")
                .splitlines()
            ]

        self.assertTrue(first.ok)
        self.assertEqual(first.sent, 1)
        self.assertEqual(second.skipped_duplicate, 1)
        self.assertEqual(len(sent), 1)
        self.assertEqual(sent[0][0], "channel-1")
        self.assertIn("今日見るなら", sent[0][1])
        self.assertGreaterEqual(len(seen_rows), 1)

    def test_daily_dispatch_empty_digest_skips_without_sending(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "context").mkdir(parents=True)
            (root / "context" / "discord.json").write_text(
                json.dumps({"userId": "user-1", "channelId": "channel-1"}) + "\n",
                encoding="utf-8",
            )
            now = datetime(2026, 6, 7, 10, 0, tzinfo=timezone(timedelta(hours=9)))
            sent: list[tuple[str, str]] = []

            result = dispatch_daily_interest_digest(
                root,
                now=now,
                sender=lambda channel_id, content: sent.append((channel_id, content))
                or DiscordSendResult(ok=True),
                fetch=False,
            )

        self.assertTrue(result.ok)
        self.assertEqual(result.skipped_empty, 1)
        self.assertEqual(sent, [])

    def test_daily_dispatch_without_channel_skips(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            now = datetime(2026, 6, 7, 10, 0, tzinfo=timezone(timedelta(hours=9)))

            result = dispatch_daily_interest_digest(
                root,
                now=now,
                sender=lambda _channel_id, _content: DiscordSendResult(ok=True),
                fetcher=lambda _url: RSS_BODY,
            )
            seen_exists = (root / "interest" / "seen.jsonl").exists()

        self.assertTrue(result.ok)
        self.assertEqual(result.skipped_missing_channel, 1)
        self.assertFalse(seen_exists)

    def test_daily_dispatch_failed_send_does_not_mark_seen(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "context").mkdir(parents=True)
            (root / "context" / "discord.json").write_text(
                json.dumps({"userId": "user-1", "channelId": "channel-1"}) + "\n",
                encoding="utf-8",
            )
            now = datetime(2026, 6, 7, 10, 0, tzinfo=timezone(timedelta(hours=9)))

            result = dispatch_daily_interest_digest(
                root,
                now=now,
                sender=lambda _channel_id, _content: DiscordSendResult(ok=False, error="nope"),
                fetcher=lambda _url: RSS_BODY,
            )

            self.assertFalse(result.ok)
            self.assertEqual(result.failed, 1)
            self.assertFalse((root / "interest" / "seen.jsonl").exists())


if __name__ == "__main__":
    unittest.main()
