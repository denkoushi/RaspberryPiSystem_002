#!/usr/bin/env python3
"""Novel request parsing tests."""

import unittest

from lib.novel_request import NovelRequest


class NovelRequestTests(unittest.TestCase):
    def test_from_text_strips_novel_prefix(self) -> None:
        request = NovelRequest.from_text("/novel Write chapter one")
        self.assertEqual(request.prompt, "Write chapter one")

    def test_from_text_empty_after_prefix(self) -> None:
        request = NovelRequest.from_text("/novel")
        self.assertEqual(request.prompt, "")


if __name__ == "__main__":
    unittest.main()
