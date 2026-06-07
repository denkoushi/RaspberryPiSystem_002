#!/usr/bin/env python3
"""Discord inbox triage helpers tests."""

import json
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from lib.life_discord_inbox import (  # noqa: E402
    build_discord_inbox_reference_context,
    capture_discord_inbox_message,
    mark_discord_inbox_suggested,
    read_discord_inbox,
    render_discord_inbox_list,
    select_discord_inbox_item,
    should_attach_discord_inbox_reference_context,
    update_discord_inbox_item_status,
)


def _write_row(root: Path, item: dict[str, object]) -> None:
    path = root / "inbox" / "discord.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(item, ensure_ascii=False, sort_keys=True) + "\n")


class LifeDiscordInboxTests(unittest.TestCase):
    def test_capture_adds_stable_item_id_and_active_status(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            now = datetime(2026, 6, 7, 9, 0, tzinfo=timezone(timedelta(hours=9)))

            result = capture_discord_inbox_message(
                root,
                "あとで読む https://example.com/article",
                message_id="message-1",
                now=now,
            )
            item = read_discord_inbox(root, now=now)[0]
            row = json.loads((root / "inbox" / "discord.jsonl").read_text(encoding="utf-8").splitlines()[0])

        self.assertTrue(result.captured)
        self.assertEqual(row["itemId"], "discord-message-1")
        self.assertEqual(item.item_id, "discord-message-1")
        self.assertEqual(item.status, "new")

    def test_done_item_is_hidden_from_active_list(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            now = datetime(2026, 6, 7, 9, 0, tzinfo=timezone(timedelta(hours=9)))
            _write_row(
                root,
                {
                    "createdAt": now.isoformat(timespec="seconds"),
                    "status": "new",
                    "text": "読むリンク https://example.com/a",
                    "urls": ["https://example.com/a"],
                    "attachments": [],
                },
            )

            item = select_discord_inbox_item(root, "1", now=now)
            self.assertIsNotNone(item)
            update_discord_inbox_item_status(root, item, "done", now=now)

            self.assertEqual(read_discord_inbox(root, now=now), [])
            self.assertIn("未処理の共有はありません", render_discord_inbox_list(root, now=now))

    def test_mark_suggested_records_personalization_hints(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            now = datetime(2026, 6, 7, 9, 0, tzinfo=timezone(timedelta(hours=9)))
            _write_row(
                root,
                {
                    "itemId": "discord-share-1",
                    "createdAt": now.isoformat(timespec="seconds"),
                    "status": "new",
                    "text": "買い物メモ",
                    "urls": [],
                    "attachments": [],
                },
            )

            self.assertTrue(
                mark_discord_inbox_suggested(
                    root,
                    "discord-share-1",
                    now=now,
                    checkin_id="2026-06-07-morning",
                )
            )
            row = json.loads((root / "inbox" / "discord.jsonl").read_text(encoding="utf-8").splitlines()[0])
            item = read_discord_inbox(root, now=now)[0]

        self.assertEqual(row["suggestedCount"], 1)
        self.assertEqual(row["lastSuggestedCheckinId"], "2026-06-07-morning")
        self.assertEqual(item.suggested_count, 1)
        self.assertIsNotNone(item.last_suggested_at)

    def test_reference_context_requires_explicit_reference(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            now = datetime.now().astimezone()
            _write_row(
                root,
                {
                    "createdAt": now.isoformat(timespec="seconds"),
                    "status": "new",
                    "text": "あとで読む https://example.com/a",
                    "urls": ["https://example.com/a"],
                    "attachments": [],
                },
            )

            self.assertFalse(should_attach_discord_inbox_reference_context("おはよう"))
            self.assertFalse(should_attach_discord_inbox_reference_context("画像を整理したい"))
            self.assertTrue(
                should_attach_discord_inbox_reference_context("さっき共有したリンクを見て")
            )
            context = build_discord_inbox_reference_context(root, "さっき共有したリンクを見て", now=now)

        self.assertIn("Hermes private context", context)
        self.assertIn("リンク", context)


if __name__ == "__main__":
    unittest.main()
