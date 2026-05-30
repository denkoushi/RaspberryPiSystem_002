#!/usr/bin/env python3
"""Discord approval relay coordinator tests (Phase D5.1)."""

import asyncio
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from lib.approval_relay.coordinator import DiscordApprovalRelayCoordinator  # noqa: E402
from lib.approval_relay.models import ApprovalChoice  # noqa: E402
from lib.approval_relay.policy import ApprovalRelayPolicy  # noqa: E402
from lib.approval_relay.store import FileApprovalStore  # noqa: E402


def _relay_policy(store_dir: Path) -> ApprovalRelayPolicy:
    return ApprovalRelayPolicy(
        enabled=True,
        store_dir=str(store_dir),
        request_timeout_seconds=30,
        poll_interval_seconds=0.05,
    )


class CoordinatorTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.store_dir = Path(self.tmp.name)
        self.coord = DiscordApprovalRelayCoordinator(_relay_policy(self.store_dir))

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_resolve_for_user_without_active_task(self) -> None:
        ok, message = self.coord.resolve_for_user("user-1", ApprovalChoice.ONCE)
        self.assertFalse(ok)
        self.assertIn("no active", message)

    def test_resolve_for_user_writes_response(self) -> None:
        ctx = self.coord.new_task_context(discord_user_id="user-1")
        store = FileApprovalStore(self.store_dir, ctx.task_id)
        store.write_request({"command": "touch x", "description": "write"})
        ok, message = self.coord.resolve_for_user("user-1", ApprovalChoice.ONCE)
        self.assertTrue(ok)
        self.assertIn("approved", message)
        self.assertEqual(store.read_response().choice, ApprovalChoice.ONCE)

    def test_try_resolve_text_without_pending_does_not_clear_running_binding(self) -> None:
        ctx = self.coord.new_task_context(discord_user_id="user-1")
        self.assertIsNone(self.coord.try_resolve_text("user-1", "yes"))
        self.assertEqual(
            FileApprovalStore.user_binding_task_id(self.store_dir, "user-1"),
            ctx.task_id,
        )

    def test_early_yes_then_pending_request_still_resolves(self) -> None:
        ctx = self.coord.new_task_context(discord_user_id="user-1")
        self.assertIsNone(self.coord.try_resolve_text("user-1", "yes"))
        store = FileApprovalStore(self.store_dir, ctx.task_id)
        store.write_request({"command": "touch x", "description": "write"})
        result = self.coord.try_resolve_text("user-1", "yes")
        self.assertIsNotNone(result)
        assert result is not None
        ok, _message = result
        self.assertTrue(ok)
        self.assertEqual(store.read_response().choice, ApprovalChoice.ONCE)

    def test_new_task_context_rejects_concurrent_task_for_same_user(self) -> None:
        self.coord.new_task_context(discord_user_id="user-1")
        with self.assertRaises(RuntimeError):
            self.coord.new_task_context(discord_user_id="user-1")

    def test_try_resolve_text_resolves_pending(self) -> None:
        ctx = self.coord.new_task_context(discord_user_id="user-1")
        store = FileApprovalStore(self.store_dir, ctx.task_id)
        store.write_request({"command": "touch x", "description": "write"})
        result = self.coord.try_resolve_text("user-1", "no")
        self.assertIsNotNone(result)
        assert result is not None
        ok, _message = result
        self.assertTrue(ok)
        self.assertEqual(store.read_response().choice, ApprovalChoice.DENY)

    async def test_watch_task_collects_intermediate_messages(self) -> None:
        ctx = self.coord.new_task_context(discord_user_id="user-1")
        stop = asyncio.Event()

        async def _emit_later() -> None:
            await asyncio.sleep(0.05)
            store = FileApprovalStore(self.store_dir, ctx.task_id)
            store.write_request({"command": "rm x", "description": "delete"})
            await asyncio.sleep(0.05)
            stop.set()

        async def _notifier(message: str) -> None:
            ctx.intermediate_messages.append(message)

        asyncio.create_task(_emit_later())
        await self.coord.watch_task(ctx, notifier=_notifier, stop_event=stop)
        self.assertTrue(ctx.intermediate_messages)

    def test_finish_without_grace_allows_immediate_retry(self) -> None:
        ctx = self.coord.new_task_context(discord_user_id="user-1")
        self.coord.finish_task_context(ctx, enter_grace=False)
        self.assertIsNone(FileApprovalStore.user_binding_task_id(self.store_dir, "user-1"))
        retry = self.coord.new_task_context(discord_user_id="user-1")
        self.assertNotEqual(retry.task_id, ctx.task_id)

    def test_finish_with_grace_does_not_block_new_task(self) -> None:
        ctx = self.coord.new_task_context(discord_user_id="user-1")
        self.coord.finish_task_context(ctx, enter_grace=True)
        self.assertIsNone(FileApprovalStore.running_task_id(self.store_dir, "user-1"))
        retry = self.coord.new_task_context(discord_user_id="user-1")
        self.assertNotEqual(retry.task_id, ctx.task_id)

    def test_try_resolve_text_after_grace_finish_reports_expired(self) -> None:
        ctx = self.coord.new_task_context(discord_user_id="user-1")
        store = FileApprovalStore(self.store_dir, ctx.task_id)
        store.write_request({"command": "touch x", "description": "write"})
        store.clear_pending_files()
        self.coord.finish_task_context(ctx, enter_grace=True)
        result = self.coord.try_resolve_text("user-1", "yes")
        self.assertIsNotNone(result)
        assert result is not None
        ok, message = result
        self.assertFalse(ok)
        self.assertIn("承認期限切れ", message)


class PluginSlashActorBindTests(unittest.TestCase):
    def tearDown(self) -> None:
        from lib.approval_relay.gateway_actor_context import clear_gateway_actor_context  # noqa: E402

        clear_gateway_actor_context()

    def test_pre_gateway_stash_enables_task_bind_for_slash_flow(self) -> None:
        from lib.approval_relay.session_context import read_gateway_session_context  # noqa: E402
        from lib import discord_task_bridge_plugin as plugin  # noqa: E402

        with tempfile.TemporaryDirectory() as tmp:
            store_dir = Path(tmp)
            relay = ApprovalRelayPolicy(
                enabled=True,
                store_dir=str(store_dir),
                request_timeout_seconds=30,
                poll_interval_seconds=0.05,
            )
            coord = DiscordApprovalRelayCoordinator(relay)

            class Platform:
                value = "discord"

            class Source:
                user_id = "1507987368462782638"
                chat_id = "1508026887568490656"
                platform = Platform()

            class SlashEvent:
                text = "/task Create file.txt in workspace"
                source = Source()
                internal = False

            with mock.patch.object(plugin, "_coordinator", return_value=coord):
                plugin._handle_pre_gateway_dispatch(SlashEvent())

            user_id, channel_id = read_gateway_session_context()
            self.assertEqual(user_id, "1507987368462782638")
            self.assertEqual(channel_id, "1508026887568490656")

            ctx = coord.new_task_context(
                discord_user_id=user_id,
                discord_channel_id=channel_id,
            )
            index = store_dir / "by-user" / f"{user_id}.json"
            self.assertTrue(index.is_file(), "by-user index should exist after bind")
            self.assertEqual(ctx.discord_user_id, user_id)


class PluginTextApprovalTests(unittest.TestCase):
    def test_pre_gateway_dispatch_skips_on_yes_with_pending_request(self) -> None:
        from lib import discord_task_bridge_plugin as plugin  # noqa: E402

        with tempfile.TemporaryDirectory() as tmp:
            store_dir = Path(tmp)
            relay = ApprovalRelayPolicy(
                enabled=True,
                store_dir=str(store_dir),
                request_timeout_seconds=30,
                poll_interval_seconds=0.05,
            )
            coord = DiscordApprovalRelayCoordinator(relay)
            ctx = coord.new_task_context(discord_user_id="user-99")
            store = FileApprovalStore(store_dir, ctx.task_id)
            store.write_request({"command": "touch x", "description": "write"})

            class Source:
                user_id = "user-99"
                platform = "discord"
                chat_id = "chan-1"

            class Event:
                text = "yes"
                source = Source()
                internal = False

            with mock.patch.object(plugin, "_coordinator", return_value=coord):
                result = plugin._handle_pre_gateway_dispatch(Event())
            self.assertEqual(result, {"action": "skip", "reason": "task-approval-text"})
            self.assertEqual(store.read_response().choice, ApprovalChoice.ONCE)

    def test_pre_gateway_dispatch_passthrough_for_chat(self) -> None:
        from lib import discord_task_bridge_plugin as plugin  # noqa: E402

        class Source:
            user_id = "user-99"

        class Event:
            text = "hello there"
            source = Source()
            internal = False

        with mock.patch.object(plugin, "_coordinator", return_value=None):
            self.assertIsNone(plugin._handle_pre_gateway_dispatch(Event()))


if __name__ == "__main__":
    unittest.main()
