#!/usr/bin/env python3
"""Gateway actor context stash tests (Phase D5.1)."""

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from lib.approval_relay.gateway_actor_context import (  # noqa: E402
    clear_gateway_actor_context,
    read_gateway_actor_context,
    stash_from_message_source,
)


class GatewayActorContextTests(unittest.TestCase):
    def tearDown(self) -> None:
        clear_gateway_actor_context()

    def test_stash_and_read_user_and_channel(self) -> None:
        class Platform:
            value = "discord"

        class Source:
            user_id = "1507987368462782638"
            chat_id = "1508026887568490656"
            platform = Platform()

        stash_from_message_source(Source())
        user_id, channel_id = read_gateway_actor_context()
        self.assertEqual(user_id, "1507987368462782638")
        self.assertEqual(channel_id, "1508026887568490656")

    def test_channel_falls_back_to_thread_id(self) -> None:
        class Source:
            user_id = "user-1"
            chat_id = ""
            thread_id = "thread-42"
            platform = "discord"

        stash_from_message_source(Source())
        _user_id, channel_id = read_gateway_actor_context()
        self.assertEqual(channel_id, "thread-42")

    def test_empty_source_does_not_stash(self) -> None:
        stash_from_message_source(None)
        user_id, channel_id = read_gateway_actor_context()
        self.assertEqual(user_id, "")
        self.assertEqual(channel_id, "")

    def test_read_without_stash_returns_empty(self) -> None:
        user_id, channel_id = read_gateway_actor_context()
        self.assertEqual(user_id, "")
        self.assertEqual(channel_id, "")


if __name__ == "__main__":
    unittest.main()
