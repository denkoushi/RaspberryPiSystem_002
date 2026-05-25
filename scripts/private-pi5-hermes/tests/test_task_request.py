#!/usr/bin/env python3
"""Task request parsing tests."""

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from lib.task_request import TaskRequest  # noqa: E402


class TaskRequestTests(unittest.TestCase):
    def test_from_argv(self) -> None:
        req = TaskRequest.from_argv(["list", "workspace"])
        self.assertEqual(req.prompt, "list workspace")

    def test_from_text_strips_prefix(self) -> None:
        req = TaskRequest.from_text("/task summarize notes")
        self.assertEqual(req.prompt, "summarize notes")


if __name__ == "__main__":
    unittest.main()
