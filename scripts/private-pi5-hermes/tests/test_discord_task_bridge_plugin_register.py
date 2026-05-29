#!/usr/bin/env python3
"""Plugin register() gates commands on deployed bridge artifacts."""

import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock

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
            ctx.register_hook.assert_called_once()


if __name__ == "__main__":
    unittest.main()
