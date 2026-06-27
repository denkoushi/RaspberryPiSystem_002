#!/usr/bin/env python3
"""Plugin register() gates commands on deployed bridge artifacts."""

import asyncio
import json
import sys
import tempfile
import unittest
from datetime import datetime
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

    def test_register_research_command_when_marker_present(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            plugin_dir = Path(tmp)
            (plugin_dir / "research-bridge.enabled").write_text("enabled=true\n", encoding="utf-8")
            with unittest.mock.patch.object(plugin, "_plugin_dir", return_value=plugin_dir):
                ctx = MagicMock()
                plugin.register(ctx)

            registered = [c[0][0] for c in ctx.register_command.call_args_list]
            self.assertEqual(registered, ["ask"])
            ask_call = ctx.register_command.call_args_list[0]
            self.assertEqual(ask_call[1].get("args_hint"), "<question>")
            self.assertIn("built-in web", ask_call[1].get("description", ""))
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
            self.assertEqual(
                registered,
                ["memo", "inbox", "interest", "digest", "remind", "recommend", "life-reply"],
            )
            memo_call = ctx.register_command.call_args_list[0]
            self.assertEqual(memo_call[1].get("args_hint"), "<life note>")
            inbox_call = ctx.register_command.call_args_list[1]
            self.assertEqual(
                inbox_call[1].get("args_hint"),
                "[list|memo N|remind N|done N|dismiss N|delete N|prune]",
            )
            interest_call = ctx.register_command.call_args_list[2]
            self.assertIn("like N", interest_call[1].get("args_hint"))
            self.assertIn("search <query>", interest_call[1].get("args_hint"))
            remind_call = ctx.register_command.call_args_list[4]
            self.assertEqual(remind_call[1].get("args_hint"), "<when and reminder>")
            recommend_call = ctx.register_command.call_args_list[5]
            self.assertEqual(recommend_call[1].get("args_hint"), "[focus]")
            reply_call = ctx.register_command.call_args_list[6]
            self.assertEqual(reply_call[1].get("args_hint"), "<1|2|3|free text>")
            ctx.register_hook.assert_called_once()

    def test_handle_ask_command_delegates_to_research_bridge(self) -> None:
        with unittest.mock.patch.object(
            plugin,
            "run_research_bridge_async",
            return_value="調査結果",
        ) as bridge_mock:
            result = asyncio.run(plugin._handle_ask_command("Hermes Agentを調べて"))

        self.assertEqual(result, "調査結果")
        request = bridge_mock.call_args.args[0]
        self.assertEqual(request.prompt, "Hermes Agentを調べて")

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
        ) as reply_mock:
            result = plugin._handle_pre_gateway_dispatch(Event(), Gateway())

        self.assertEqual(result, {"action": "skip", "reason": "life-proactive-reply"})
        self.assertEqual(adapter.messages, [("channel-1", "受け取りました")])
        reply_mock.assert_called_once_with("1", user_id="user-1", channel_id="channel-1")

    def test_pre_gateway_dispatch_handles_fullwidth_life_proactive_reply(self) -> None:
        class Source:
            user_id = "user-1"
            platform = "discord"
            chat_id = "channel-1"

        class Event:
            text = "１"
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
        ) as reply_mock:
            result = plugin._handle_pre_gateway_dispatch(Event(), Gateway())

        self.assertEqual(result, {"action": "skip", "reason": "life-proactive-reply"})
        self.assertEqual(adapter.messages, [("channel-1", "受け取りました")])
        reply_mock.assert_called_once_with("1", user_id="user-1", channel_id="channel-1")

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

    def test_pre_gateway_dispatch_captures_embed_only_android_share(self) -> None:
        class Source:
            user_id = "user-1"
            platform = "discord"
            chat_id = "channel-1"

        class Event:
            text = ""
            source = Source()
            internal = False
            embeds = [
                {
                    "url": "https://x.com/example/status/456",
                    "title": "X post",
                    "description": "あとで読みたい共有",
                }
            ]

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
        ) as reply_mock, unittest.mock.patch.object(
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
        self.assertEqual(rows[0]["urls"], ["https://x.com/example/status/456"])
        self.assertIn("X post", rows[0]["text"])
        self.assertIn("受け取り箱に保存しました", adapter.messages[0][1])
        reply_mock.assert_not_called()

    def test_pre_gateway_dispatch_sends_ack_with_token_when_gateway_missing(self) -> None:
        class Source:
            user_id = "user-1"
            platform = "Discord"
            chat_id = "channel-1"

        class Event:
            text = ""
            content = "https://x.com/example/status/789"
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
        ), unittest.mock.patch.object(
            plugin,
            "send_discord_channel_message",
            return_value=MagicMock(ok=True),
        ) as send_mock, unittest.mock.patch.dict(
            plugin.os.environ,
            {"DISCORD_BOT_TOKEN": "token-1"},
            clear=False,
        ):
            result = plugin._handle_pre_gateway_dispatch(Event(), None)

        self.assertEqual(result, {"action": "skip", "reason": "life-discord-inbox"})
        send_mock.assert_called_once()
        self.assertEqual(send_mock.call_args.args[0], "token-1")
        self.assertEqual(send_mock.call_args.args[1], "channel-1")
        self.assertIn("受け取り箱に保存しました", send_mock.call_args.args[2])

    def test_pre_gateway_dispatch_captures_attachment_placeholder_text(self) -> None:
        class Source:
            user_id = "user-1"
            platform = "discord"
            chat_id = "channel-1"

        class Event:
            id = "message-attachment-1"
            text = "クリックして添付ファイルを表示"
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
        self.assertEqual(rows[0]["messageId"], "message-attachment-1")
        self.assertIn("添付ファイル", rows[0]["text"])
        self.assertIn("受け取り箱に保存しました", adapter.messages[0][1])

    def test_pre_gateway_dispatch_captures_blank_discord_share(self) -> None:
        class Source:
            user_id = "user-1"
            platform = "discord"
            chat_id = "channel-1"

        class Event:
            id = "message-blank-share-1"
            text = ""
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
        ) as reply_mock, unittest.mock.patch.object(
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
        self.assertEqual(rows[0]["messageId"], "message-blank-share-1")
        self.assertIn("Discord投稿", rows[0]["text"])
        self.assertIn("受け取り箱に保存しました", adapter.messages[0][1])
        reply_mock.assert_not_called()

    def test_pre_gateway_dispatch_captures_nested_attachment_metadata(self) -> None:
        class Source:
            user_id = "user-1"
            platform = "discord"
            chat_id = "channel-1"
            metadata = {
                "message": {
                    "id": "nested-attachment-1",
                    "attachments": [{"filename": "shared-nested-image.png"}],
                }
            }

        class Event:
            text = ""
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
        self.assertEqual(rows[0]["messageId"], "nested-attachment-1")
        self.assertEqual(rows[0]["attachments"], ["shared-nested-image.png"])
        self.assertIn("受け取り箱に保存しました", adapter.messages[0][1])

    def test_pre_gateway_dispatch_captures_discord_media_urls(self) -> None:
        class Source:
            user_id = "user-1"
            platform = "discord"
            chat_id = "channel-1"

        class Event:
            text = "(The user sent a message with no text content)"
            message_type = "photo"
            media_urls = ["/home/hermes/.hermes/cache/images/img_discord_share.png"]
            media_types = ["image/png"]
            source = Source()
            message_id = "discord-media-url-1"
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
        ) as reply_mock, unittest.mock.patch.object(
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
        self.assertEqual(rows[0]["messageId"], "discord-media-url-1")
        self.assertEqual(rows[0]["attachments"], ["img_discord_share.png"])
        self.assertIn("Discord投稿", rows[0]["text"])
        self.assertIn("受け取り箱に保存しました", adapter.messages[0][1])
        reply_mock.assert_not_called()

    def test_pre_gateway_dispatch_captures_share_filename_text(self) -> None:
        class Source:
            user_id = "user-1"
            platform = "discord"
            chat_id = "channel-1"

        class Event:
            id = "filename-only-1"
            text = "Screenshot_20260606-123456.png"
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
        self.assertEqual(rows[0]["messageId"], "filename-only-1")
        self.assertIn("Screenshot_20260606-123456.png", rows[0]["text"])
        self.assertIn("受け取り箱に保存しました", adapter.messages[0][1])

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
        ) as reply_mock, unittest.mock.patch.object(
            plugin,
            "load_life_pilot_policy",
            return_value=MagicMock(storage_root=tmp),
        ):
            result = plugin._handle_pre_gateway_dispatch(Event())

        self.assertIsNone(result)
        self.assertFalse((Path(tmp) / "inbox" / "discord.jsonl").exists())
        reply_mock.assert_not_called()

    def test_pre_gateway_dispatch_attaches_inbox_context_for_explicit_reference(self) -> None:
        class Source:
            user_id = "user-1"
            platform = "discord"
            chat_id = "channel-1"

        class Event:
            text = "さっき共有したURLについてどう思う？"
            source = Source()
            internal = False

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "inbox").mkdir(parents=True, exist_ok=True)
            (root / "inbox" / "discord.jsonl").write_text(
                json.dumps(
                    {
                        "createdAt": datetime.now().astimezone().isoformat(timespec="seconds"),
                        "source": "discord",
                        "status": "new",
                        "text": "あとで読む https://x.com/example/status/123",
                        "urls": ["https://x.com/example/status/123"],
                        "attachments": [],
                        "untrusted": True,
                    },
                    ensure_ascii=False,
                    sort_keys=True,
                )
                + "\n",
                encoding="utf-8",
            )
            event = Event()
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
                return_value=None,
            ), unittest.mock.patch.object(
                plugin,
                "load_life_pilot_policy",
                return_value=MagicMock(storage_root=tmp),
            ):
                result = plugin._handle_pre_gateway_dispatch(event)

        self.assertIsNone(result)
        self.assertIn("Hermes private context", event.text)
        self.assertIn("Xリンク", event.text)

    def test_inbox_command_lists_saved_discord_shares(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "inbox").mkdir(parents=True, exist_ok=True)
            (root / "inbox" / "discord.jsonl").write_text(
                json.dumps(
                    {
                        "createdAt": datetime.now().astimezone().isoformat(timespec="seconds"),
                        "source": "discord",
                        "status": "new",
                        "text": "あとで読む https://x.com/example/status/123",
                        "urls": ["https://x.com/example/status/123"],
                        "attachments": [],
                        "untrusted": True,
                    },
                    ensure_ascii=False,
                    sort_keys=True,
                )
                + "\n",
                encoding="utf-8",
            )
            with unittest.mock.patch.object(
                plugin,
                "read_gateway_session_context",
                return_value=("user-1", "channel-1"),
            ), unittest.mock.patch.object(
                plugin,
                "load_life_pilot_policy",
                return_value=MagicMock(storage_root=tmp),
            ), unittest.mock.patch.object(plugin, "_remember_life_context"):
                result = asyncio.run(plugin._handle_inbox_command(""))

        self.assertIn("受け取り箱（未処理）", result)
        self.assertIn("Xリンク", result)
        self.assertIn("/inbox memo 1", result)

    def test_inbox_command_memo_marks_item_memoed(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "inbox").mkdir(parents=True, exist_ok=True)
            (root / "inbox" / "discord.jsonl").write_text(
                json.dumps(
                    {
                        "createdAt": datetime.now().astimezone().isoformat(timespec="seconds"),
                        "source": "discord",
                        "status": "new",
                        "text": "牛乳の特売 https://example.com/milk",
                        "urls": ["https://example.com/milk"],
                        "attachments": [],
                        "untrusted": True,
                    },
                    ensure_ascii=False,
                    sort_keys=True,
                )
                + "\n",
                encoding="utf-8",
            )
            memo_mock = unittest.mock.AsyncMock(return_value="保存しました")
            with unittest.mock.patch.object(
                plugin,
                "read_gateway_session_context",
                return_value=("user-1", "channel-1"),
            ), unittest.mock.patch.object(
                plugin,
                "load_life_pilot_policy",
                return_value=MagicMock(storage_root=tmp),
            ), unittest.mock.patch.object(plugin, "_remember_life_context"), unittest.mock.patch.object(
                plugin,
                "run_life_memo_bridge_async",
                memo_mock,
            ):
                result = asyncio.run(plugin._handle_inbox_command("memo 1 買い物候補"))
            row = json.loads((root / "inbox" / "discord.jsonl").read_text(encoding="utf-8").splitlines()[0])

        self.assertIn("メモにしました", result)
        self.assertEqual(row["status"], "memoed")
        self.assertIn("買い物候補", row["memoText"])
        memo_mock.assert_awaited_once()

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
