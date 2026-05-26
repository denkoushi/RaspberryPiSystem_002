#!/usr/bin/env python3
"""Gateway session context adapter tests (Phase D5.1)."""

import os
import sys
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from lib.approval_relay.gateway_actor_context import (  # noqa: E402
    clear_gateway_actor_context,
    stash_from_message_source,
)
from lib.approval_relay.session_context import read_gateway_session_context  # noqa: E402


class SessionContextTests(unittest.TestCase):
    def tearDown(self) -> None:
        clear_gateway_actor_context()

    def test_actor_stash_takes_priority_over_env_getter(self) -> None:
        class Source:
            user_id = "actor-user"
            chat_id = "actor-chan"
            platform = "discord"

        stash_from_message_source(Source())

        def getter(name: str, default: str = "") -> str:
            values = {
                "HERMES_SESSION_USER_ID": "env-user",
                "HERMES_SESSION_CHAT_ID": "env-chan",
            }
            return values.get(name, default)

        user_id, channel_id = read_gateway_session_context(env_getter=getter)
        self.assertEqual(user_id, "actor-user")
        self.assertEqual(channel_id, "actor-chan")

    def test_reads_user_and_channel_from_env_getter(self) -> None:
        def getter(name: str, default: str = "") -> str:
            values = {
                "HERMES_SESSION_USER_ID": "user-42",
                "HERMES_SESSION_CHAT_ID": "chan-99",
            }
            return values.get(name, default)

        user_id, channel_id = read_gateway_session_context(env_getter=getter)
        self.assertEqual(user_id, "user-42")
        self.assertEqual(channel_id, "chan-99")

    def test_channel_prefers_chat_id_over_thread_id(self) -> None:
        def getter(name: str, default: str = "") -> str:
            values = {
                "HERMES_SESSION_CHAT_ID": "chat-primary",
                "HERMES_SESSION_THREAD_ID": "thread-secondary",
            }
            return values.get(name, default)

        _user_id, channel_id = read_gateway_session_context(env_getter=getter)
        self.assertEqual(channel_id, "chat-primary")

    def test_channel_falls_back_to_thread_id(self) -> None:
        def getter(name: str, default: str = "") -> str:
            values = {
                "HERMES_SESSION_THREAD_ID": "thread-only",
            }
            return values.get(name, default)

        _user_id, channel_id = read_gateway_session_context(env_getter=getter)
        self.assertEqual(channel_id, "thread-only")

    def test_typeerror_from_env_getter_falls_back_to_os_environ(self) -> None:
        def bad_getter(_name: str, _default: str = "") -> str:
            raise TypeError("get_session_env() missing 1 required positional argument: 'name'")

        with mock.patch.dict(
            os.environ,
            {
                "HERMES_SESSION_USER_ID": "env-user",
                "HERMES_SESSION_CHAT_ID": "env-chan",
            },
            clear=False,
        ):
            user_id, channel_id = read_gateway_session_context(env_getter=bad_getter)
        self.assertEqual(user_id, "env-user")
        self.assertEqual(channel_id, "env-chan")

    def test_import_error_from_gateway_falls_back_to_os_environ(self) -> None:
        with mock.patch(
            "lib.approval_relay.session_context._resolve_session_env_getter",
            return_value=None,
        ):
            with mock.patch.dict(
                os.environ,
                {
                    "HERMES_SESSION_USER_ID": "fallback-user",
                    "HERMES_SESSION_CHAT_ID": "fallback-chan",
                },
                clear=False,
            ):
                user_id, channel_id = read_gateway_session_context()
        self.assertEqual(user_id, "fallback-user")
        self.assertEqual(channel_id, "fallback-chan")

    def test_returns_empty_when_nothing_set(self) -> None:
        with mock.patch(
            "lib.approval_relay.session_context._resolve_session_env_getter",
            return_value=None,
        ):
            with mock.patch.dict(os.environ, {}, clear=True):
                user_id, channel_id = read_gateway_session_context()
        self.assertEqual(user_id, "")
        self.assertEqual(channel_id, "")

    def test_coordinator_reexports_read_gateway_session_context(self) -> None:
        from lib.approval_relay.coordinator import read_gateway_session_context as from_coord  # noqa: E402

        self.assertIs(from_coord, read_gateway_session_context)


if __name__ == "__main__":
    unittest.main()
