#!/usr/bin/env python3
"""Life Pilot proactive check-in tests."""

import json
import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from lib.life_pilot_policy import LifePilotPolicy  # noqa: E402
from lib.life_proactive_loop import (  # noqa: E402
    build_followup_checkin_message,
    build_proactive_checkin_message,
    build_proactive_components,
    dispatch_due_followups,
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


def _write_reminder(root: Path, item: dict[str, object]) -> None:
    path = root / "reminders" / "reminders.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(item, ensure_ascii=False, sort_keys=True) + "\n")


def _write_note(root: Path, day: str, when: str, body: str) -> None:
    path = root / "notes" / f"{day}.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        path.write_text(f"# {day}\n\n", encoding="utf-8")
    with path.open("a", encoding="utf-8") as handle:
        handle.write(f"## {when}\n\n{body}\n\n")


def _write_checkin(root: Path, item: dict[str, object]) -> None:
    path = root / "proactive" / "checkins.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(item, ensure_ascii=False, sort_keys=True) + "\n")


def _write_obsidian_note(root: Path, relpath: str, body: str, mtime: datetime) -> Path:
    path = root / "obsidian" / "HermesLife" / relpath
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body, encoding="utf-8")
    os.utime(path, (mtime.timestamp(), mtime.timestamp()))
    return path


def _write_obsidian_attachment(root: Path, relpath: str, mtime: datetime) -> Path:
    path = root / "obsidian" / "HermesLife" / relpath
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"\x89PNG\r\n\x1a\n")
    os.utime(path, (mtime.timestamp(), mtime.timestamp()))
    return path


class LifeProactiveLoopTests(unittest.TestCase):
    def test_morning_checkin_message_offers_choice_and_free_text(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            now = datetime(2026, 6, 6, 7, 30, tzinfo=timezone(timedelta(hours=9)))

            message = build_proactive_checkin_message("morning", root, now=now)

            self.assertIn("おはようございます", message)
            self.assertIn("今日まず見るなら", message)
            self.assertIn("[1] これをやる", message)
            self.assertIn("[2] 夕方にもう一度", message)
            self.assertIn("[3] 今日は外す", message)
            self.assertIn("ボタンで返信できます", message)
            self.assertIn("/life-reply 1", message)
            self.assertIn("boundary=local-only/no-tools", message)

    def test_morning_checkin_message_selects_one_candidate(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            now = datetime(2026, 6, 6, 7, 30, tzinfo=timezone(timedelta(hours=9)))
            _write_reminder(
                root,
                {
                    "createdAt": now.isoformat(timespec="seconds"),
                    "dueAt": datetime(2026, 6, 6, 8, 0, tzinfo=now.tzinfo).isoformat(
                        timespec="seconds"
                    ),
                    "status": "pending",
                    "text": "燃えるごみを出す",
                },
            )
            _write_reminder(
                root,
                {
                    "createdAt": now.isoformat(timespec="seconds"),
                    "status": "pending",
                    "text": "ラズパイシステムのデモ準備",
                },
            )

            message = build_proactive_checkin_message("morning", root, now=now)

            self.assertIn("今日まず見るなら:\n燃えるごみを出す", message)
            self.assertIn("ほかに残っているもの:\n- ラズパイシステムのデモ準備", message)

    def test_morning_checkin_softens_when_recent_notes_look_tired(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            now = datetime(2026, 6, 6, 7, 30, tzinfo=timezone(timedelta(hours=9)))
            _write_note(root, "2026-06-05", "2026-06-05 21:00", "今日は疲れて眠い。")

            message = build_proactive_checkin_message("morning", root, now=now)

            self.assertIn(
                "今日の見方:\n最近の体調メモが少し重めです。今日は軽く1つだけ見ます。",
                message,
            )

    def test_morning_checkin_remembers_recently_snoozed_candidate(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            now = datetime(2026, 6, 6, 7, 30, tzinfo=timezone(timedelta(hours=9)))
            previous = datetime(2026, 6, 5, 7, 30, tzinfo=timezone(timedelta(hours=9)))
            _write_checkin(
                root,
                {
                    "id": "2026-06-05-morning",
                    "createdAt": previous.isoformat(timespec="seconds"),
                    "answeredAt": (previous + timedelta(minutes=5)).isoformat(timespec="seconds"),
                    "mode": "morning",
                    "status": "answered",
                    "selectedOption": "2",
                    "candidateText": "風呂洗い",
                },
            )
            _write_reminder(
                root,
                {
                    "createdAt": now.isoformat(timespec="seconds"),
                    "status": "pending",
                    "text": "買い物リストを見る",
                },
            )

            message = build_proactive_checkin_message("morning", root, now=now)
            dispatch_proactive_checkin(
                root,
                "morning",
                now=now,
                sender=FakeSender(),
                channel_id="channel-1",
                user_id="user-1",
            )

            self.assertIn("今日の見方:\n前に後回しにしたものを、もう一度だけ出します。", message)
            self.assertIn("今日まず見るなら:\n風呂洗い", message)
            checkins = [
                json.loads(line)
                for line in (root / "proactive" / "checkins.jsonl")
                .read_text(encoding="utf-8")
                .splitlines()
            ]
            today = [item for item in checkins if item["id"] == "2026-06-06-morning"][0]
            self.assertEqual(today["candidateSource"], "carried_forward")
            self.assertEqual(today["briefing"], "前に後回しにしたものを、もう一度だけ出します。")

    def test_dispatch_records_morning_context_hints(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            now = datetime(2026, 6, 6, 7, 30, tzinfo=timezone(timedelta(hours=9)))
            _write_note(root, "2026-06-05", "2026-06-05 21:00", "寝不足でしんどい。")
            for index in range(3):
                _write_reminder(
                    root,
                    {
                        "createdAt": now.isoformat(timespec="seconds"),
                        "status": "pending",
                        "text": f"未処理 {index + 1}",
                    },
                )

            dispatch_proactive_checkin(
                root,
                "morning",
                now=now,
                sender=FakeSender(),
                channel_id="channel-1",
                user_id="user-1",
            )

            checkin = json.loads(
                (root / "proactive" / "checkins.jsonl")
                .read_text(encoding="utf-8")
                .splitlines()[0]
            )
            self.assertEqual(
                checkin["briefing"],
                "最近の体調メモが少し重めで、残りも多めです。今日は1つだけ見ます。",
            )
            self.assertEqual(
                checkin["contextHints"],
                {
                    "lowEnergy": True,
                    "obsidianAttachments": 0,
                    "obsidianItems": 0,
                    "pendingCount": 3,
                    "pressure": "medium",
                },
            )

    def test_morning_checkin_uses_recent_obsidian_note_as_candidate(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            now = datetime(2026, 6, 6, 7, 30, tzinfo=timezone(timedelta(hours=9)))
            _write_obsidian_note(
                root,
                "00_Inbox/today.md",
                "# 今日のメモ\n\n今日は少し眠い。買い物リストを見直す。\n",
                now - timedelta(minutes=10),
            )

            message = build_proactive_checkin_message("morning", root, now=now)
            dispatch_proactive_checkin(
                root,
                "morning",
                now=now,
                sender=FakeSender(),
                channel_id="channel-1",
                user_id="user-1",
            )

            self.assertIn("Obsidian新着:", message)
            self.assertIn("今日のメモ: 今日は少し眠い。買い物リストを見直す。", message)
            self.assertIn("今日まず見るなら:\nObsidian新着を見返す", message)
            self.assertIn("今日は軽く1つだけ見ます", message)
            checkin = json.loads(
                (root / "proactive" / "checkins.jsonl")
                .read_text(encoding="utf-8")
                .splitlines()[0]
            )
            self.assertEqual(checkin["candidateSource"], "obsidian_inbox")
            self.assertEqual(checkin["contextHints"]["obsidianItems"], 1)

    def test_morning_checkin_mentions_obsidian_attachment_without_reading_image(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            now = datetime(2026, 6, 6, 7, 30, tzinfo=timezone(timedelta(hours=9)))
            _write_obsidian_attachment(
                root,
                "90_Attachments/screenshot-shopping.png",
                now - timedelta(minutes=2),
            )

            message = build_proactive_checkin_message("morning", root, now=now)

            self.assertIn("Obsidian新着:", message)
            self.assertIn("画像: screenshot-shopping", message)
            self.assertIn("今日まず見るなら:\nObsidian新着画像を確認: screenshot-shopping", message)

    def test_obsidian_sensitive_lines_are_not_shown_in_morning_checkin(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            now = datetime(2026, 6, 6, 7, 30, tzinfo=timezone(timedelta(hours=9)))
            _write_obsidian_note(
                root,
                "00_Inbox/secret.md",
                "# 認証メモ\n\ntoken=abc123\n\n明日は軽く掃除する。\n",
                now - timedelta(minutes=1),
            )

            message = build_proactive_checkin_message("morning", root, now=now)

            self.assertNotIn("abc123", message)
            self.assertNotIn("token", message.lower())
            self.assertIn("明日は軽く掃除する", message)

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
            ["これをやる", "夕方にもう一度", "今日は外す", "自由入力"],
        )

    def test_followup_components_offer_short_buttons(self) -> None:
        components = build_proactive_components("2026-06-06-morning-followup-1", "followup")

        buttons = components[0]["components"]
        self.assertEqual(
            [button["label"] for button in buttons],
            ["やる", "明日に回す", "外す", "自由入力"],
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
            self.assertIn("これをやる", notes[0].read_text(encoding="utf-8"))

    def test_snooze_reply_schedules_followup(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            now = datetime(2026, 6, 6, 7, 30, tzinfo=timezone(timedelta(hours=9)))
            _write_reminder(
                root,
                {
                    "createdAt": now.isoformat(timespec="seconds"),
                    "status": "pending",
                    "text": "風呂洗い",
                },
            )
            dispatch_proactive_checkin(
                root,
                "morning",
                now=now,
                sender=FakeSender(),
                channel_id="channel-1",
                user_id="user-1",
            )

            response = resolve_proactive_reply(
                "2",
                _policy(),
                root,
                user_id="user-1",
                channel_id="channel-1",
                now=now + timedelta(minutes=5),
            )

            self.assertIn("夕方にもう一度聞きます: 2026-06-06 17:00", response or "")
            followups = [
                json.loads(line)
                for line in (root / "proactive" / "followups.jsonl")
                .read_text(encoding="utf-8")
                .splitlines()
            ]
            self.assertEqual(followups[0]["status"], "pending")
            self.assertEqual(followups[0]["sourceCheckinId"], "2026-06-06-morning")
            self.assertEqual(followups[0]["dueAt"], "2026-06-06T17:00:00+09:00")
            self.assertEqual(followups[0]["candidateText"], "風呂洗い")

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

            self.assertIn("夕方にもう一度", response or "")
            checkins = [
                json.loads(line)
                for line in (root / "proactive" / "checkins.jsonl")
                .read_text(encoding="utf-8")
                .splitlines()
            ]
            statuses = {item["id"]: item["status"] for item in checkins}
            self.assertEqual(statuses["2026-06-06-morning"], "answered")
            self.assertEqual(statuses["2026-06-06-evening"], "pending_reply")

    def test_due_followup_sends_once_and_creates_pending_checkin(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            morning = datetime(2026, 6, 6, 7, 30, tzinfo=timezone(timedelta(hours=9)))
            due = datetime(2026, 6, 6, 17, 0, tzinfo=timezone(timedelta(hours=9)))
            _write_reminder(
                root,
                {
                    "createdAt": morning.isoformat(timespec="seconds"),
                    "status": "pending",
                    "text": "風呂洗い",
                },
            )
            dispatch_proactive_checkin(
                root,
                "morning",
                now=morning,
                sender=FakeSender(),
                channel_id="channel-1",
                user_id="user-1",
            )
            resolve_proactive_reply(
                "2",
                _policy(),
                root,
                user_id="user-1",
                channel_id="channel-1",
                now=morning + timedelta(minutes=5),
            )
            sender = FakeSender()

            result = dispatch_proactive_checkin(root, "followup", now=due, sender=sender)
            duplicate = dispatch_proactive_checkin(
                root,
                "followup",
                now=due + timedelta(minutes=5),
                sender=sender,
            )

            self.assertTrue(result.ok)
            self.assertEqual(result.sent, 1)
            self.assertEqual(duplicate.sent, 0)
            self.assertEqual(len(sender.calls), 1)
            self.assertIn("さっきの確認です", sender.calls[0][1])
            self.assertIn("風呂洗い", sender.calls[0][1])
            followup = json.loads(
                (root / "proactive" / "followups.jsonl")
                .read_text(encoding="utf-8")
                .splitlines()[0]
            )
            self.assertEqual(followup["status"], "sent")
            checkins = [
                json.loads(line)
                for line in (root / "proactive" / "checkins.jsonl")
                .read_text(encoding="utf-8")
                .splitlines()
            ]
            followup_checkin = checkins[-1]
            self.assertEqual(followup_checkin["id"], "2026-06-06-morning-followup-1")
            self.assertEqual(followup_checkin["mode"], "followup")
            self.assertEqual(followup_checkin["status"], "pending_reply")

    def test_followup_reply_records_followup_mode(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            due = datetime(2026, 6, 6, 17, 0, tzinfo=timezone(timedelta(hours=9)))
            (root / "proactive").mkdir(parents=True, exist_ok=True)
            (root / "proactive" / "followups.jsonl").write_text(
                json.dumps(
                    {
                        "id": "2026-06-06-morning-followup-1",
                        "sourceCheckinId": "2026-06-06-morning",
                        "createdAt": due.isoformat(timespec="seconds"),
                        "dueAt": due.isoformat(timespec="seconds"),
                        "status": "pending",
                        "channelId": "channel-1",
                        "userId": "user-1",
                        "reason": "snooze",
                        "candidateText": "風呂洗い",
                    },
                    ensure_ascii=False,
                    sort_keys=True,
                )
                + "\n",
                encoding="utf-8",
            )
            dispatch_due_followups(root, now=due, sender=FakeSender())

            response = resolve_proactive_reply(
                "1",
                _policy(),
                root,
                user_id="user-1",
                channel_id="channel-1",
                checkin_id="2026-06-06-morning-followup-1",
                now=due + timedelta(minutes=2),
            )

            self.assertIn("受け取りました: やる", response or "")
            self.assertIn("mode=followup", response or "")
            notes = list((root / "notes").glob("*.md"))
            self.assertIn("Hermes再確認への返信: やる", notes[0].read_text(encoding="utf-8"))

    def test_followup_message_mentions_single_candidate(self) -> None:
        message = build_followup_checkin_message("風呂洗い")

        self.assertIn("今ならこれだけ見ますか:\n風呂洗い", message)
        self.assertIn("[1] やる", message)
        self.assertIn("boundary=local-only/no-tools", message)


if __name__ == "__main__":
    unittest.main()
