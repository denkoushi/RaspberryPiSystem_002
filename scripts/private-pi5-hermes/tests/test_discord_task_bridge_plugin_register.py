#!/usr/bin/env python3
"""Plugin register() gates commands on deployed bridge artifacts."""

import asyncio
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from lib import discord_task_bridge_plugin as plugin


class PluginRegisterTests(unittest.TestCase):
    def test_register_novel_only_when_policy_missing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            plugin_dir = Path(tmp)
            (plugin_dir / "novel-bridge.enabled").write_text("enabled=true\n", encoding="utf-8")
            with unittest.mock.patch.object(plugin, "_plugin_dir", return_value=plugin_dir):
                ctx = MagicMock()
                plugin.register(ctx)

            registered = [c[0][0] for c in ctx.register_command.call_args_list]
            self.assertEqual(registered, ["novel"])
            novel_call = ctx.register_command.call_args_list[0]
            self.assertEqual(novel_call[1].get("args_hint"), "<creative prompt>")
            self.assertIn("Arguments", novel_call[1].get("description", ""))
            ctx.register_hook.assert_not_called()

    def test_register_nothing_when_no_bridge_markers_present(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            plugin_dir = Path(tmp)
            with unittest.mock.patch.object(plugin, "_plugin_dir", return_value=plugin_dir):
                ctx = MagicMock()
                plugin.register(ctx)

            ctx.register_command.assert_not_called()
            ctx.register_hook.assert_not_called()

    def test_register_task_commands_when_policy_present(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            plugin_dir = Path(tmp)
            (plugin_dir / "task-bridge.policy.yaml").write_text(
                "version: 1\n", encoding="utf-8"
            )
            with unittest.mock.patch.object(
                plugin,
                "_plugin_dir",
                return_value=plugin_dir,
            ), unittest.mock.patch.object(
                plugin,
                "_novel_bridge_enabled",
                return_value=False,
            ):
                ctx = MagicMock()
                plugin.register(ctx)

            registered = [c[0][0] for c in ctx.register_command.call_args_list]
            self.assertEqual(registered, ["task", "task-approve", "task-deny"])
            task_call = ctx.register_command.call_args_list[0]
            self.assertEqual(task_call[1].get("args_hint"), "<task instruction>")
            ctx.register_hook.assert_called_once()

    def test_register_daily_command_when_policy_present(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            plugin_dir = Path(tmp)
            (plugin_dir / "daily-pilot.policy.yaml").write_text(
                "phase: daily_pilot_v0\n", encoding="utf-8"
            )
            with unittest.mock.patch.object(plugin, "_plugin_dir", return_value=plugin_dir):
                ctx = MagicMock()
                plugin.register(ctx)

            registered = [c[0][0] for c in ctx.register_command.call_args_list]
            self.assertEqual(registered, ["daily"])
            daily_call = ctx.register_command.call_args_list[0]
            self.assertEqual(daily_call[1].get("args_hint"), "<memo or request>")
            ctx.register_hook.assert_not_called()

    def test_register_life_commands_when_policy_present(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            plugin_dir = Path(tmp)
            (plugin_dir / "life-pilot.policy.yaml").write_text(
                "phase: life_pilot_v0\n", encoding="utf-8"
            )
            with unittest.mock.patch.object(plugin, "_plugin_dir", return_value=plugin_dir):
                ctx = MagicMock()
                plugin.register(ctx)

            registered = [c[0][0] for c in ctx.register_command.call_args_list]
            self.assertEqual(registered, ["memo", "digest", "remind", "recommend", "life-reply"])
            memo_call = ctx.register_command.call_args_list[0]
            self.assertEqual(memo_call[1].get("args_hint"), "<life note>")
            remind_call = ctx.register_command.call_args_list[2]
            self.assertEqual(remind_call[1].get("args_hint"), "<when and reminder>")
            recommend_call = ctx.register_command.call_args_list[3]
            self.assertEqual(recommend_call[1].get("args_hint"), "[focus]")
            reply_call = ctx.register_command.call_args_list[4]
            self.assertEqual(reply_call[1].get("args_hint"), "<1|2|3|free text>")
            ctx.register_hook.assert_called_once()

    def test_task_approve_returns_expired_message_without_failed_prefix(self) -> None:
        with unittest.mock.patch.object(
            plugin,
            "_coordinator",
        ) as coord_mock, unittest.mock.patch.object(
            plugin,
            "read_gateway_session_context",
            return_value=("user-1", "chan-1"),
        ):
            coord = MagicMock()
            coord.resolve_for_user.return_value = (
                False,
                "承認期限切れ。もう一度 `/task` を実行してください。",
            )
            coord_mock.return_value = coord

            result = asyncio.run(plugin._handle_task_approve(""))

        self.assertEqual(result, "承認期限切れ。もう一度 `/task` を実行してください。")

    def test_task_deny_returns_expired_message_without_failed_prefix(self) -> None:
        with unittest.mock.patch.object(
            plugin,
            "_coordinator",
        ) as coord_mock, unittest.mock.patch.object(
            plugin,
            "read_gateway_session_context",
            return_value=("user-1", "chan-1"),
        ):
            coord = MagicMock()
            coord.resolve_for_user.return_value = (
                False,
                "承認期限切れ。もう一度 `/task` を実行してください。",
            )
            coord_mock.return_value = coord

            result = asyncio.run(plugin._handle_task_deny(""))

        self.assertEqual(result, "承認期限切れ。もう一度 `/task` を実行してください。")

    def test_pre_gateway_dispatch_handles_life_proactive_reply(self) -> None:
        class Source:
            user_id = "user-1"
            platform = "discord"
            chat_id = "channel-1"

        class Event:
            text = "1"
            source = Source()
            internal = False

        class Adapter:
            def __init__(self) -> None:
                self.messages = []

            def send(self, chat_id: str, message: str) -> None:
                self.messages.append((chat_id, message))

        adapter = Adapter()

        class Gateway:
            adapters = {"discord": adapter}

        with unittest.mock.patch.object(
            plugin,
            "_coordinator",
            return_value=None,
        ), unittest.mock.patch.object(
            plugin,
            "_life_pilot_enabled",
            return_value=True,
        ), unittest.mock.patch.object(
            plugin,
            "resolve_proactive_reply",
            return_value="受け取りました",
        ):
            result = plugin._handle_pre_gateway_dispatch(Event(), Gateway())

        self.assertEqual(result, {"action": "skip", "reason": "life-proactive-reply"})
        self.assertEqual(adapter.messages, [("channel-1", "受け取りました")])

    def test_pre_gateway_dispatch_captures_discord_inbox_link(self) -> None:
        class Source:
            user_id = "user-1"
            platform = "discord"
            chat_id = "channel-1"

        class Event:
            text = "あとで読む https://x.com/example/status/123"
            source = Source()
            internal = False

        class Adapter:
            def __init__(self) -> None:
                self.messages = []

            def send(self, chat_id: str, message: str) -> None:
                self.messages.append((chat_id, message))

        adapter = Adapter()

        class Gateway:
            adapters = {"discord": adapter}

        with tempfile.TemporaryDirectory() as tmp, unittest.mock.patch.object(
            plugin,
            "_coordinator",
            return_value=None,
        ), unittest.mock.patch.object(
            plugin,
            "_life_pilot_enabled",
            return_value=True,
        ), unittest.mock.patch.object(
            plugin,
            "resolve_proactive_reply",
            return_value=None,
        ), unittest.mock.patch.object(
            plugin,
            "load_life_pilot_policy",
            return_value=MagicMock(storage_root=tmp),
        ):
            result = plugin._handle_pre_gateway_dispatch(Event(), Gateway())
            rows = [
                json.loads(line)
                for line in (Path(tmp) / "inbox" / "discord.jsonl")
                .read_text(encoding="utf-8")
                .splitlines()
            ]

        self.assertEqual(result, {"action": "skip", "reason": "life-discord-inbox"})
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["urls"], ["https://x.com/example/status/123"])
        self.assertTrue(rows[0]["untrusted"])
        self.assertEqual(adapter.messages[0][0], "channel-1")
        self.assertIn("受け取り箱に保存しました", adapter.messages[0][1])
        self.assertIn("boundary=local-only/no-tools", adapter.messages[0][1])

    def test_pre_gateway_dispatch_leaves_regular_chat_unhandled(self) -> None:
        class Source:
            user_id = "user-1"
            platform = "discord"
            chat_id = "channel-1"

        class Event:
            text = "今日はどうすればいいかな"
            source = Source()
            internal = False

        with tempfile.TemporaryDirectory() as tmp, unittest.mock.patch.object(
            plugin,
            "_coordinator",
            return_value=None,
        ), unittest.mock.patch.object(
            plugin,
            "_life_pilot_enabled",
            return_value=True,
        ), unittest.mock.patch.object(
            plugin,
            "resolve_proactive_reply",
            return_value=None,
        ), unittest.mock.patch.object(
            plugin,
            "load_life_pilot_policy",
            return_value=MagicMock(storage_root=tmp),
        ):
            result = plugin._handle_pre_gateway_dispatch(Event())

        self.assertIsNone(result)
        self.assertFalse((Path(tmp) / "inbox" / "discord.jsonl").exists())

    def test_life_reply_command_returns_proactive_reply(self) -> None:
        with unittest.mock.patch.object(
            plugin,
            "read_gateway_session_context",
            return_value=("user-1", "channel-1"),
        ), unittest.mock.patch.object(
            plugin,
            "resolve_proactive_reply",
            return_value="受け取りました: まず1つやる",
        ):
            result = asyncio.run(plugin._handle_life_reply_command("1"))

        self.assertEqual(result, "受け取りました: まず1つやる")

    def test_life_reply_command_reports_no_pending_checkin(self) -> None:
        with unittest.mock.patch.object(
            plugin,
            "read_gateway_session_context",
            return_value=("user-1", "channel-1"),
        ), unittest.mock.patch.object(
            plugin,
            "resolve_proactive_reply",
            return_value=None,
        ):
            result = asyncio.run(plugin._handle_life_reply_command("1"))

        self.assertIn("返信待ちの朝晩確認がありません", result)


if __name__ == "__main__":
    unittest.main()
