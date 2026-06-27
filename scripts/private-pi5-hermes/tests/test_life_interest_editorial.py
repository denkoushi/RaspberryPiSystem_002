#!/usr/bin/env python3
"""Daily Interest Digest editorial renderer tests."""

import json
import os
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from lib.life_interest_digest import (  # noqa: E402
    InterestItem,
    build_interest_digest,
)
from lib.life_interest_editorial import (  # noqa: E402
    EditorialDigestConfig,
    parse_editorial_draft,
    render_editorial_interest_digest,
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


class FakeEditorialClient:
    def __init__(self, raw: str | Exception) -> None:
        self.raw = raw
        self.calls: list[dict[str, object]] = []

    def generate(self, payload: dict[str, object]) -> str:
        self.calls.append(payload)
        if isinstance(self.raw, Exception):
            raise self.raw
        return self.raw


def _raw_editorial(**updates: object) -> str:
    payload: dict[str, object] = {
        "main_story": "DGX Spark運用は、vLLMの起動安定化とローカルLLM活用の話がかなり実務寄りに進んでいます。",
        "latest": "直近では cold start と NVFP4 の扱いが話題で、運用で詰まりそうな場所を先回りで見られます。",
        "item_notes": ["起動待ちで時間を溶かしたくないなら、先に見ておく価値があります。"],
    }
    payload.update(updates)
    return json.dumps(payload, ensure_ascii=False)


def _item() -> InterestItem:
    now = datetime(2026, 6, 7, 10, 0, tzinfo=timezone(timedelta(hours=9)))
    return InterestItem(
        item_id="item-1",
        source="nvidia_dgx_spark_forum",
        source_label="NVIDIA DGX Spark Forum",
        title="DGX Spark vLLM cold start workaround",
        url="https://forums.developer.nvidia.com/t/dgx-spark-vllm/123",
        summary="Discussion about NVFP4, vLLM, and startup time.",
        published_at=now,
        captured_at=now,
        tags=("dgx", "spark", "vllm"),
        reasons=("vllm に関係", "新しめ"),
    )


class LifeInterestEditorialTests(unittest.TestCase):
    def setUp(self) -> None:
        self.env_patcher = patch.dict(
            os.environ,
            {
                "LIFE_PILOT_INTEREST_EDITORIAL_ENABLED": "",
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

    def test_editorial_disabled_returns_no_message_and_does_not_call_client(self) -> None:
        client = FakeEditorialClient(AssertionError("must not be called"))

        result = render_editorial_interest_digest(
            (_item(),),
            config=EditorialDigestConfig(enabled=False),
            client=client,
        )

        self.assertFalse(result.ok)
        self.assertEqual(result.fallback_reason, "editorial_disabled")
        self.assertEqual(client.calls, [])

    def test_fake_llm_success_renders_japanese_story_latest_original_url_and_feedback(self) -> None:
        client = FakeEditorialClient(_raw_editorial())

        result = render_editorial_interest_digest(
            (_item(),),
            fetched_count=1,
            config=EditorialDigestConfig(enabled=True, max_chars=1800),
            client=client,
        )

        self.assertTrue(result.ok)
        self.assertIn("主筋", result.message)
        self.assertIn("最新", result.message)
        self.assertIn("DGX Spark運用", result.message)
        self.assertIn("見どころ:", result.message)
        self.assertIn("https://forums.developer.nvidia.com/t/dgx-spark-vllm/123", result.message)
        self.assertIn("/interest like 1", result.message)
        self.assertEqual(client.calls[0]["items"][0]["number"], 1)
        self.assertNotIn("url", client.calls[0]["items"][0])
        contract_text = " ".join(str(value) for value in client.calls[0]["contract"])
        self.assertIn("casual", contract_text)
        self.assertIn("want to open", contract_text)
        self.assertEqual(client.calls[0]["style_guide"]["tone"], "friendly, curious, concise, lightly conversational")

    def test_build_digest_uses_editorial_when_enabled(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            digest = build_interest_digest(
                Path(tmp),
                now=datetime(2026, 6, 7, 10, 0, tzinfo=timezone(timedelta(hours=9))),
                fetch=True,
                fetcher=lambda _url: RSS_BODY,
                editorial_enabled=True,
                editorial_client=FakeEditorialClient(_raw_editorial()),
            )

        self.assertEqual(digest.render_mode, "editorial")
        self.assertEqual(digest.fallback_reason, "")
        self.assertIn("主筋", digest.message)

    def test_invalid_json_falls_back_to_deterministic_digest(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            digest = build_interest_digest(
                Path(tmp),
                now=datetime(2026, 6, 7, 10, 0, tzinfo=timezone(timedelta(hours=9))),
                fetch=True,
                fetcher=lambda _url: RSS_BODY,
                editorial_enabled=True,
                editorial_client=FakeEditorialClient("not json"),
            )

        self.assertEqual(digest.render_mode, "deterministic")
        self.assertIn("JSONDecodeError", digest.fallback_reason)
        self.assertNotIn("主筋", digest.message)
        self.assertIn("理由:", digest.message)

    def test_dgx_not_ready_falls_back_to_deterministic_digest(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            digest = build_interest_digest(
                Path(tmp),
                now=datetime(2026, 6, 7, 10, 0, tzinfo=timezone(timedelta(hours=9))),
                fetch=True,
                fetcher=lambda _url: RSS_BODY,
                editorial_enabled=True,
                editorial_client=FakeEditorialClient(RuntimeError("editorial DGX runtime not ready")),
            )

        self.assertEqual(digest.render_mode, "deterministic")
        self.assertIn("RuntimeError", digest.fallback_reason)
        self.assertIn("DGX Spark vLLM", digest.message)

    def test_too_long_output_falls_back(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            digest = build_interest_digest(
                Path(tmp),
                now=datetime(2026, 6, 7, 10, 0, tzinfo=timezone(timedelta(hours=9))),
                fetch=True,
                fetcher=lambda _url: RSS_BODY,
                editorial_enabled=True,
                editorial_client=FakeEditorialClient("{" + ("x" * 6100) + "}"),
            )

        self.assertEqual(digest.render_mode, "deterministic")
        self.assertIn("too long", digest.fallback_reason)

    def test_llm_urls_are_rejected_and_original_url_is_kept(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            digest = build_interest_digest(
                Path(tmp),
                now=datetime(2026, 6, 7, 10, 0, tzinfo=timezone(timedelta(hours=9))),
                fetch=True,
                fetcher=lambda _url: RSS_BODY,
                editorial_enabled=True,
                editorial_client=FakeEditorialClient(
                    _raw_editorial(main_story="詳しくは https://evil.example を見てください。")
                ),
            )

        self.assertEqual(digest.render_mode, "deterministic")
        self.assertNotIn("evil.example", digest.message)
        self.assertIn("https://forums.developer.nvidia.com/t/dgx-spark-vllm/123", digest.message)

    def test_editorial_disabled_flag_does_not_call_client(self) -> None:
        client = FakeEditorialClient(AssertionError("must not be called"))

        with tempfile.TemporaryDirectory() as tmp:
            digest = build_interest_digest(
                Path(tmp),
                now=datetime(2026, 6, 7, 10, 0, tzinfo=timezone(timedelta(hours=9))),
                fetch=True,
                fetcher=lambda _url: RSS_BODY,
                editorial_enabled=False,
                editorial_client=client,
            )

        self.assertEqual(digest.render_mode, "deterministic")
        self.assertEqual(digest.fallback_reason, "")
        self.assertEqual(client.calls, [])

    def test_cli_no_editorial_renders_deterministic_digest(self) -> None:
        now = datetime(2026, 6, 7, 10, 0, tzinfo=timezone(timedelta(hours=9)))
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            interest_dir = root / "interest"
            interest_dir.mkdir(parents=True)
            (interest_dir / "items.jsonl").write_text(
                json.dumps(
                    {
                        "itemId": "item-1",
                        "source": "nvidia_dgx_spark_forum",
                        "sourceLabel": "NVIDIA DGX Spark Forum",
                        "title": "DGX Spark vLLM cold start workaround",
                        "url": "https://forums.developer.nvidia.com/t/dgx-spark-vllm/123",
                        "summary": "Discussion about NVFP4, vLLM, and startup time.",
                        "publishedAt": now.isoformat(timespec="seconds"),
                        "capturedAt": now.isoformat(timespec="seconds"),
                        "tags": ["dgx", "spark", "vllm"],
                        "untrusted": True,
                    },
                    ensure_ascii=False,
                    sort_keys=True,
                )
                + "\n",
                encoding="utf-8",
            )
            env = {
                **os.environ,
                "LIFE_PILOT_INTEREST_EDITORIAL_ENABLED": "true",
                "PYTHONPATH": str(ROOT),
            }
            completed = subprocess.run(
                [
                    sys.executable,
                    str(ROOT / "hermes-life-interest-digest"),
                    "--storage-root",
                    str(root),
                    "--no-fetch",
                    "--no-editorial",
                ],
                capture_output=True,
                text=True,
                check=False,
                env=env,
            )

        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertIn("今日見るなら", completed.stdout)
        self.assertIn("理由:", completed.stdout)
        self.assertNotIn("主筋", completed.stdout)

    def test_parse_editorial_draft_accepts_json_fence(self) -> None:
        draft = parse_editorial_draft(f"```json\n{_raw_editorial()}\n```", item_count=1)

        self.assertIn("DGX Spark", draft.main_story)
        self.assertEqual(len(draft.item_notes), 1)


if __name__ == "__main__":
    unittest.main()
