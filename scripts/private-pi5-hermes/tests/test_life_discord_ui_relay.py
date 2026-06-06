#!/usr/bin/env python3
"""Life Pilot Discord component UI relay tests."""

import json
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from lib.life_discord_ui_relay import (  # noqa: E402
    _capture_shared_message,
    _extract_modal_text,
    _message_has_share_surface,
    _resolve_reply_text,
    parse_custom_id,
)
from lib.life_proactive_loop import dispatch_proactive_checkin  # noqa: E402
from lib.life_reminder_scheduler import DiscordSendResult  # noqa: E402


class FakeUser:
    id = "user-1"
    bot = False


class FakeChannel:
    id = "channel-1"


class FakeAttachment:
    filename = "shared-image.png"


class FakeMessage:
    id = "message-1"
    content = ""
    author = FakeUser()
    channel = FakeChannel()
    attachments = [FakeAttachment()]
    embeds = []


class FakeInteraction:
    user = FakeUser()
    channel_id = "channel-1"

    def __init__(self, data: dict[str, object] | None = None) -> None:
        self.data = data or {}


class FakeSender:
    def __call__(self, channel_id: str, content: str) -> DiscordSendResult:
        return DiscordSendResult(ok=True, status_code=200)


class LifeDiscordUiRelayTests(unittest.TestCase):
    def test_parse_custom_id_accepts_life_button_ids(self) -> None:
        self.assertEqual(
            parse_custom_id("life:reply:2026-06-06-morning:1"),
            ("reply", "2026-06-06-morning", "1"),
        )
        self.assertEqual(
            parse_custom_id("life:free:2026-06-06-evening"),
            ("free", "2026-06-06-evening", ""),
        )
        self.assertEqual(
            parse_custom_id("life:modal:2026-06-06-evening"),
            ("modal", "2026-06-06-evening", ""),
        )
        self.assertEqual(parse_custom_id("other:reply:x:1"), ("", "", ""))

    def test_extract_modal_text_reads_free_text_value(self) -> None:
        interaction = FakeInteraction(
            {
                "custom_id": "life:modal:2026-06-06-morning",
                "components": [
                    {
                        "components": [
                            {
                                "custom_id": "life_free_text",
                                "value": "  今日は風呂洗いを先にやる  ",
                            }
                        ]
                    }
                ],
            }
        )

        self.assertEqual(_extract_modal_text(interaction), "今日は風呂洗いを先にやる")

    def test_button_reply_records_targeted_checkin(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            now = datetime.now(timezone(timedelta(hours=9)))
            checkin_id = f"{now.date().isoformat()}-morning"
            dispatch_proactive_checkin(
                root,
                "morning",
                now=now,
                sender=FakeSender(),
                channel_id="channel-1",
                user_id="user-1",
            )

            response = _resolve_reply_text(
                "1",
                storage_root=root,
                interaction=FakeInteraction(),
                checkin_id=checkin_id,
            )

            self.assertIn("受け取りました", response)
            checkin = json.loads(
                (root / "proactive" / "checkins.jsonl")
                .read_text(encoding="utf-8")
                .splitlines()[0]
            )
            self.assertEqual(checkin["status"], "answered")
            self.assertEqual(checkin["selectedOption"], "1")

    def test_sidecar_captures_shared_attachment_message(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            message = FakeMessage()

            self.assertTrue(_message_has_share_surface(message))
            ack = _capture_shared_message(message, root)

            self.assertIn("受け取り箱に保存しました", ack or "")
            row = json.loads(
                (root / "inbox" / "discord.jsonl")
                .read_text(encoding="utf-8")
                .splitlines()[0]
            )
            self.assertEqual(row["messageId"], "message-1")
            self.assertEqual(row["attachments"], ["shared-image.png"])
            self.assertTrue(row["untrusted"])

            duplicate = _capture_shared_message(message, root)
            self.assertIsNone(duplicate)


if __name__ == "__main__":
    unittest.main()
