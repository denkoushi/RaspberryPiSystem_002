#!/usr/bin/env python3
"""Life Pilot reminder scheduler tests."""

import json
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from lib.life_reminder_scheduler import (  # noqa: E402
    DiscordSendResult,
    dispatch_due_reminders,
)


class LifeReminderSchedulerTests(unittest.TestCase):
    def test_dispatch_due_reminder_once(self) -> None:
        now = datetime(2026, 6, 7, 8, 1, tzinfo=timezone(timedelta(hours=9)))
        sent: list[tuple[str, str]] = []

        def sender(channel_id: str, content: str) -> DiscordSendResult:
            sent.append((channel_id, content))
            return DiscordSendResult(ok=True, status_code=200)

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            reminders = root / "reminders" / "reminders.jsonl"
            reminders.parent.mkdir(parents=True)
            reminders.write_text(
                json.dumps(
                    {
                        "createdAt": "2026-06-06T12:00:00+09:00",
                        "dueAt": "2026-06-07T08:00:00+09:00",
                        "notifyChannelId": "channel-1",
                        "status": "pending",
                        "text": "燃えるごみを出す",
                    },
                    ensure_ascii=False,
                )
                + "\n",
                encoding="utf-8",
            )

            result = dispatch_due_reminders(root, now=now, sender=sender)
            second = dispatch_due_reminders(root, now=now, sender=sender)
            item = json.loads(reminders.read_text(encoding="utf-8").splitlines()[0])

        self.assertTrue(result.ok)
        self.assertEqual(result.sent, 1)
        self.assertEqual(second.sent, 0)
        self.assertEqual(sent[0][0], "channel-1")
        self.assertTrue(sent[0][1].startswith("燃えるごみを出す"))
        self.assertIn("-# debug:", sent[0][1])
        self.assertEqual(item["status"], "notified")
        self.assertIn("notifiedAt", item)

    def test_dispatch_skips_future_and_missing_channel(self) -> None:
        now = datetime(2026, 6, 7, 8, 1, tzinfo=timezone(timedelta(hours=9)))
        sent: list[tuple[str, str]] = []

        def sender(channel_id: str, content: str) -> DiscordSendResult:
            sent.append((channel_id, content))
            return DiscordSendResult(ok=True, status_code=200)

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            reminders = root / "reminders" / "reminders.jsonl"
            reminders.parent.mkdir(parents=True)
            rows = [
                {
                    "createdAt": "2026-06-06T12:00:00+09:00",
                    "dueAt": "2026-06-07T08:00:00+09:00",
                    "status": "pending",
                    "text": "送信先なし",
                },
                {
                    "createdAt": "2026-06-06T12:00:00+09:00",
                    "dueAt": "2026-06-07T09:00:00+09:00",
                    "notifyChannelId": "channel-1",
                    "status": "pending",
                    "text": "未来の予定",
                },
            ]
            reminders.write_text(
                "\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n",
                encoding="utf-8",
            )

            result = dispatch_due_reminders(root, now=now, sender=sender)

        self.assertTrue(result.ok)
        self.assertEqual(result.sent, 0)
        self.assertEqual(result.skipped_missing_channel, 1)
        self.assertEqual(sent, [])


if __name__ == "__main__":
    unittest.main()
