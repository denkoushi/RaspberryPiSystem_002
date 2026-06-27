#!/usr/bin/env python3
"""Research request parsing tests."""

import unittest
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from lib.research_request import ResearchRequest  # noqa: E402


class ResearchRequestTests(unittest.TestCase):
    def test_from_text_strips_ask_prefix(self) -> None:
        request = ResearchRequest.from_text("/ask 今日のニュースを調べて")
        self.assertEqual(request.prompt, "今日のニュースを調べて")

    def test_from_text_empty_after_prefix(self) -> None:
        request = ResearchRequest.from_text("/ask")
        self.assertEqual(request.prompt, "")


if __name__ == "__main__":
    unittest.main()
