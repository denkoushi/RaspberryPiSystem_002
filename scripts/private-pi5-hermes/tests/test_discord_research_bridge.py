#!/usr/bin/env python3
"""Discord /ask bridge tests."""

import asyncio
import sys
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from lib.discord_research_bridge import run_research_bridge, run_research_bridge_async  # noqa: E402
from lib.research_profile_runner import ResearchProfileRunResult  # noqa: E402
from lib.research_request import ResearchRequest  # noqa: E402


class DiscordResearchBridgeTests(unittest.TestCase):
    def test_empty_prompt_returns_usage(self) -> None:
        result = run_research_bridge(ResearchRequest(""))
        self.assertIn("usage: /ask", result)

    @mock.patch(
        "lib.discord_research_bridge.run_research_profile_prompt",
        return_value=ResearchProfileRunResult(ok=True, exit_code=0, output="answer"),
    )
    def test_bridge_returns_research_output(self, run_mock: mock.MagicMock) -> None:
        result = run_research_bridge(ResearchRequest("調べて"))
        self.assertEqual(result, "answer")
        run_mock.assert_called_once()

    @mock.patch(
        "lib.discord_research_bridge.run_research_profile_prompt",
        return_value=ResearchProfileRunResult(
            ok=False,
            exit_code=3,
            output="",
            error_hint="research DGX runtime not ready",
        ),
    )
    def test_bridge_formats_failure(self, _run_mock: mock.MagicMock) -> None:
        result = run_research_bridge(ResearchRequest("調べて"))
        self.assertEqual(result, "ask failed: research DGX runtime not ready")

    @mock.patch(
        "lib.discord_research_bridge.run_research_bridge",
        return_value="answer",
    )
    def test_async_bridge_uses_sync_contract(self, run_mock: mock.MagicMock) -> None:
        result = asyncio.run(run_research_bridge_async(ResearchRequest("調べて")))
        self.assertEqual(result, "answer")
        run_mock.assert_called_once()


if __name__ == "__main__":
    unittest.main()
