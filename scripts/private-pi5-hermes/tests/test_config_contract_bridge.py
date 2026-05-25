#!/usr/bin/env python3
"""Chat config bridge contract tests."""

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from lib.config_contract import (  # noqa: E402
    validate_chat_config_bridge_alignment,
)


class ChatBridgeConfigContractTests(unittest.TestCase):
    def test_bridge_enabled_requires_plugin_enabled(self) -> None:
        config = """
plugins:
  enabled:
    - private-pi5-discord-task-bridge
agent:
  disabled_toolsets:
    - file
    - web
    - browser
    - delegation
"""
        errors = validate_chat_config_bridge_alignment(
            config,
            bridge_enabled=True,
            plugin_name="private-pi5-discord-task-bridge",
        )
        self.assertEqual(errors, [])

    def test_bridge_disabled_rejects_plugin_enabled(self) -> None:
        config = """
plugins:
  enabled:
    - private-pi5-discord-task-bridge
"""
        errors = validate_chat_config_bridge_alignment(
            config,
            bridge_enabled=False,
            plugin_name="private-pi5-discord-task-bridge",
        )
        self.assertTrue(errors)


if __name__ == "__main__":
    unittest.main()
