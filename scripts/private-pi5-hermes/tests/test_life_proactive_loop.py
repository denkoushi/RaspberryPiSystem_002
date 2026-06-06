#!/usr/bin/env python3
"""Life Pilot proactive check-in tests."""

import json
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from lib.life_pilot_policy import LifePilotPolicy  # noqa: E402
from lib.life_proactive_loop import (  # noqa: E402
    build_proactive_checkin_message,
    build_proactive_components,
    dispatch_proactive_checkin,
    remember_life_discord_context,
    resolve_proactive_reply,
)
from lib.life_reminder_scheduler import DiscordSendResult  # noqa: E402


def _policy() -> LifePilotPolicy:
    return LifePilotPolicy.from_mapping(
        {
            "phase": "life_pilot_v0",
            "model_route": "spark_localai",
            "output_mode": "private_life_log",
            "storage_root": "/home/hermes/.hermes-life",
            "max_prompt_chars": 2000,
            "cursor_codex_auto_run": False,
            "terminal_enabled": False,
            "git_enabled": False,
            "deploy_enabled": False,
            "secret_access_enabled": False,
            "external_web_enabled": False,
            "homeassistant_enabled": False,
            "allowed_task_classes": [
                "record_life_memo",
                "summarize_life_notes",
                "record_life_reminder",
                "suggest_life_next_actions",
            ],
            "deferred_task_classes": [
                "run_cursor_or_codex_cli",
                "edit_production_repo",
                "git_commit_push_merge",
                "deploy_or_restart_services",
                "read_secrets_or_tokens",
                "terminal_shell_execution",
                "tailnet_or_lan_scan",
                "external_web_research",
                "homeassistant_or_camera_control",
            ],
            "deny_prompt_substrings": [".env", "token", "secret"],
            "deny_prompt_patterns": [
                r"\b(run|execute|start|invoke|use|launch)\b.*\b(codex|cursor)\b",
                r"\bgit\s+(commit|push|merge|reset|checkout|rebase)\b",
            ],
        }
    )


class FakeSender:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []

    def __call__(self, channel_id: str, content: str) -> DiscordSendResult:
        self.calls.append((channel_id, content))
        return DiscordSendResult(ok=True, status_code=200)


class LifeProactiveLoopTests(unittest.TestCase):
    def test_morning_checkin_message_offers_choice_and_free_text(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            now = datetime(2026, 6, 6, 7, 30, tzinfo=timezone(timedelta(hours=9)))

            message = build_proactive_checkin_message("morning", root, now=now)

            self.assertIn("おはようございます", message)
            self.assertIn("[1] まず1つやる", message)
            self.assertIn("[2] あとで見る", message)
            self.assertIn("[3] 今日は外す", message)
            self.assertIn("ボタンで返信できます", message)
            self.assertIn("/life-reply 1", message)
            self.assertIn("boundary=local-only/no-tools", message)

    def test_morning_checkin_components_offer_buttons_and_free_text(self) -> None:
        components = build_proactive_components("2026-06-06-morning", "morning")

        self.assertEqual(len(components), 1)
        buttons = components[0]["components"]
        self.assertEqual(
            [button["custom_id"] for button in buttons],
            [
                "life:reply:2026-06-06-morning:1",
                "life:reply:2026-06-06-morning:2",
                "life:reply:2026-06-06-morning:3",
                "life:free:2026-06-06-morning",
            ],
        )
        self.assertEqual(
            [button["label"] for button in buttons],
            ["まず1つやる", "あとで見る", "今日は外す", "自由入力"],
        )

    def test_dispatch_records_pending_checkin_and_skips_duplicate(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            now = datetime(2026, 6, 6, 7, 30, tzinfo=timezone(timedelta(hours=9)))
            sender = FakeSender()

            result = dispatch_proactive_checkin(
                root,
                "morning",
                now=now,
                sender=sender,
                channel_id="channel-1",
                user_id="user-1",
            )
            duplicate = dispatch_proactive_checkin(
                root,
                "morning",
                now=now,
                sender=sender,
                channel_id="channel-1",
                user_id="user-1",
            )

            self.assertTrue(result.ok)
            self.assertEqual(result.sent, 1)
            self.assertEqual(duplicate.skipped_duplicate, 1)
            self.assertEqual(len(sender.calls), 1)
            checkins = [
                json.loads(line)
                for line in (root / "proactive" / "checkins.jsonl")
                .read_text(encoding="utf-8")
                .splitlines()
            ]
            self.assertEqual(checkins[0]["status"], "pending_reply")
            self.assertEqual(checkins[0]["channelId"], "channel-1")

    def test_remembered_context_can_be_used_for_dispatch(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            now = datetime(2026, 6, 6, 21, 30, tzinfo=timezone(timedelta(hours=9)))
            sender = FakeSender()

            self.assertTrue(
                remember_life_discord_context("user-1", "channel-1", _policy(), root, now=now)
            )
            result = dispatch_proactive_checkin(root, "evening", now=now, sender=sender)

            self.assertTrue(result.ok)
            self.assertEqual(result.sent, 1)
            self.assertEqual(sender.calls[0][0], "channel-1")
            self.assertIn("こんばんは", sender.calls[0][1])

    def test_choice_reply_answers_checkin_and_records_memo(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            now = datetime(2026, 6, 6, 7, 30, tzinfo=timezone(timedelta(hours=9)))
            sender = FakeSender()
            dispatch_proactive_checkin(
                root,
                "morning",
                now=now,
                sender=sender,
                channel_id="channel-1",
                user_id="user-1",
            )

            response = resolve_proactive_reply(
                "1",
                _policy(),
                root,
                user_id="user-1",
                channel_id="channel-1",
                now=now + timedelta(minutes=5),
            )

            self.assertIsNotNone(response)
            self.assertIn("受け取りました", response or "")
            self.assertIn("method=choice", response or "")
            checkin = json.loads(
                (root / "proactive" / "checkins.jsonl")
                .read_text(encoding="utf-8")
                .splitlines()[0]
            )
            self.assertEqual(checkin["status"], "answered")
            self.assertEqual(checkin["selectedOption"], "1")
            notes = list((root / "notes").glob("*.md"))
            self.assertEqual(len(notes), 1)
            self.assertIn("まず1つやる", notes[0].read_text(encoding="utf-8"))

    def test_manual_reply_records_free_text(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            now = datetime(2026, 6, 6, 21, 30, tzinfo=timezone(timedelta(hours=9)))
            sender = FakeSender()
            dispatch_proactive_checkin(
                root,
                "evening",
                now=now,
                sender=sender,
                channel_id="channel-1",
                user_id="user-1",
            )

            response = resolve_proactive_reply(
                "風呂洗いは終わった。明日は買い物。",
                _policy(),
                root,
                user_id="user-1",
                channel_id="channel-1",
                now=now + timedelta(minutes=3),
            )

            self.assertIn("method=manual", response or "")
            replies = [
                json.loads(line)
                for line in (root / "proactive" / "replies.jsonl")
                .read_text(encoding="utf-8")
                .splitlines()
            ]
            self.assertEqual(replies[0]["response"], "風呂洗いは終わった。明日は買い物。")
            self.assertEqual(replies[0]["method"], "manual")

    def test_reply_can_target_specific_checkin_id(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            morning = datetime(2026, 6, 6, 7, 30, tzinfo=timezone(timedelta(hours=9)))
            evening = datetime(2026, 6, 6, 21, 30, tzinfo=timezone(timedelta(hours=9)))
            sender = FakeSender()
            dispatch_proactive_checkin(
                root,
                "morning",
                now=morning,
                sender=sender,
                channel_id="channel-1",
                user_id="user-1",
            )
            dispatch_proactive_checkin(
                root,
                "evening",
                now=evening,
                sender=sender,
                channel_id="channel-1",
                user_id="user-1",
            )

            response = resolve_proactive_reply(
                "2",
                _policy(),
                root,
                user_id="user-1",
                channel_id="channel-1",
                checkin_id="2026-06-06-morning",
                now=evening + timedelta(minutes=2),
            )

            self.assertIn("あとで見る", response or "")
            checkins = [
                json.loads(line)
                for line in (root / "proactive" / "checkins.jsonl")
                .read_text(encoding="utf-8")
                .splitlines()
            ]
            statuses = {item["id"]: item["status"] for item in checkins}
            self.assertEqual(statuses["2026-06-06-morning"], "answered")
            self.assertEqual(statuses["2026-06-06-evening"], "pending_reply")


if __name__ == "__main__":
    unittest.main()
