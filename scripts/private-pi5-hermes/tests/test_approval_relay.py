#!/usr/bin/env python3
"""Approval relay store and policy tests (Phase D5.1)."""

import sys
import tempfile
import threading
import time
import unittest
from unittest import mock
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from lib.approval_relay.discord_relay import (  # noqa: E402
    DiscordSendResult,
    format_approval_prompt,
    parse_task_approve_args,
    send_discord_channel_message,
)
from lib.approval_relay.models import ApprovalChoice, ApprovalRequest  # noqa: E402
from lib.approval_relay.policy import ApprovalRelayPolicy  # noqa: E402
from lib.approval_relay.store import FileApprovalStore  # noqa: E402


class ApprovalRelayPolicyTests(unittest.TestCase):
    def test_disabled_without_store_dir(self) -> None:
        policy = ApprovalRelayPolicy.from_mapping({"enabled": False})
        self.assertFalse(policy.enabled)

    def test_enabled_requires_store_dir(self) -> None:
        with self.assertRaises(ValueError):
            ApprovalRelayPolicy.from_mapping({"enabled": True})


class FileApprovalStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.store_dir = Path(self.tmp.name)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_roundtrip_request_response(self) -> None:
        store = FileApprovalStore(self.store_dir, "task-1")
        store.write_request(
            {
                "command": "echo hi",
                "description": "write test",
                "pattern_key": "exec",
            }
        )
        request = store.read_request()
        self.assertIsNotNone(request)
        assert request is not None
        self.assertEqual(request.command, "echo hi")

        store.write_response(ApprovalChoice.ONCE, discord_user_id="user-1")
        response = store.read_response()
        self.assertIsNotNone(response)
        assert response is not None
        self.assertEqual(response.choice, ApprovalChoice.ONCE)

    def test_active_task_binding(self) -> None:
        FileApprovalStore.bind_active_task(self.store_dir, "user-42", "task-abc")
        self.assertEqual(
            FileApprovalStore.active_task_id(self.store_dir, "user-42"),
            "task-abc",
        )
        FileApprovalStore.clear_active_task(self.store_dir, "user-42")
        self.assertIsNone(FileApprovalStore.active_task_id(self.store_dir, "user-42"))

    def test_wait_for_response_times_out(self) -> None:
        store = FileApprovalStore(self.store_dir, "task-timeout")
        result = store.wait_for_response(timeout_seconds=0.2, poll_interval_seconds=0.05)
        self.assertIsNone(result)

    def test_wait_for_response_reads_later_write(self) -> None:
        store = FileApprovalStore(self.store_dir, "task-later")

        def _write() -> None:
            time.sleep(0.05)
            store.write_response(ApprovalChoice.ONCE, discord_user_id="user-1")

        thread = threading.Thread(target=_write, daemon=True)
        thread.start()
        result = store.wait_for_response(timeout_seconds=0.5, poll_interval_seconds=0.05)
        thread.join(timeout=0.2)
        self.assertIsNotNone(result)
        assert result is not None
        self.assertEqual(result.choice, ApprovalChoice.ONCE)

    def test_concurrent_tasks_isolated(self) -> None:
        store_a = FileApprovalStore(self.store_dir, "task-a")
        store_b = FileApprovalStore(self.store_dir, "task-b")
        store_a.write_request({"command": "a", "description": "a"})
        store_b.write_request({"command": "b", "description": "b"})
        self.assertEqual(store_a.read_request().command, "a")
        self.assertEqual(store_b.read_request().command, "b")

    def test_purge_stale_tasks(self) -> None:
        store = FileApprovalStore(self.store_dir, "old-task")
        store.write_request({"command": "x", "description": "x", "created_at": 0.0})
        request_path = store.task_dir / FileApprovalStore.REQUEST_FILE
        old = time.time() - 7200
        request_path.touch()
        import os

        os.utime(request_path, (old, old))
        removed = FileApprovalStore.purge_stale_tasks(
            self.store_dir,
            max_age_seconds=3600,
        )
        self.assertEqual(removed, 1)


class ApprovalRelayParseTests(unittest.TestCase):
    def test_format_prompt_contains_command(self) -> None:
        request = ApprovalRequest(
            task_id="t1",
            command="rm file.txt",
            description="delete file",
        )
        text = format_approval_prompt(request)
        self.assertIn("rm file.txt", text)
        self.assertIn("承認", text)

    def test_parse_task_approve_args(self) -> None:
        self.assertEqual(parse_task_approve_args(""), ApprovalChoice.ONCE)
        self.assertEqual(parse_task_approve_args("session"), ApprovalChoice.SESSION)
        self.assertEqual(parse_task_approve_args("always"), ApprovalChoice.ALWAYS)

    def test_choice_from_text(self) -> None:
        self.assertEqual(ApprovalChoice.from_text("yes"), ApprovalChoice.ONCE)
        self.assertEqual(ApprovalChoice.from_text("no"), ApprovalChoice.DENY)
        self.assertIsNone(ApprovalChoice.from_text("hello"))

    def test_wait_for_response_aborts_on_delivery_failed(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = FileApprovalStore(Path(tmp), "task-delivery")
            store.write_request({"command": "write_file path=x", "description": "write"})
            store.write_delivery_failed("token missing")
            started = time.time()
            result = store.wait_for_response(
                timeout_seconds=5.0,
                poll_interval_seconds=0.05,
            )
            elapsed = time.time() - started
        self.assertIsNone(result)
        self.assertLess(elapsed, 1.0)

    def test_discord_send_result_shape(self) -> None:
        result = DiscordSendResult(ok=False, status_code=401, error="unauthorized")
        self.assertFalse(result.ok)
        self.assertEqual(result.status_code, 401)

    def test_discord_send_uses_discordbot_user_agent(self) -> None:
        import asyncio

        captured = {}

        class DummyResponse:
            status = 200

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

            def read(self) -> bytes:
                return b"{}"

        def fake_urlopen(req, timeout=0):
            captured["user_agent"] = req.get_header("User-agent")
            captured["accept"] = req.get_header("Accept")
            return DummyResponse()

        with mock.patch.dict("os.environ", {"DISCORD_BOT_TOKEN": "token"}):
            with mock.patch("urllib.request.urlopen", side_effect=fake_urlopen):
                result = asyncio.run(send_discord_channel_message("channel-1", "ok"))

        self.assertTrue(result.ok)
        self.assertEqual(captured["accept"], "application/json")
        self.assertTrue(captured["user_agent"].startswith("DiscordBot ("))


if __name__ == "__main__":
    unittest.main()
