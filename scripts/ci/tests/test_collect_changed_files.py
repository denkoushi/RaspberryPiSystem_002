#!/usr/bin/env python3
from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from classify_changes import parse_name_status_z  # noqa: E402
from collect_changed_files import collect_changed_files  # noqa: E402


class CollectChangedFilesTests(unittest.TestCase):
    def git(self, repo: Path, *args: str) -> str:
        return subprocess.run(
            ["git", *args],
            cwd=repo,
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        ).stdout.strip()

    def commit_file(self, repo: Path, path: str, content: str, message: str) -> str:
        destination = repo / path
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(content, encoding="utf-8")
        self.git(repo, "add", path)
        self.git(repo, "commit", "-m", message)
        return self.git(repo, "rev-parse", "HEAD")

    def test_pull_request_uses_merge_base_when_base_branch_advances(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repo = Path(directory)
            self.git(repo, "init", "-b", "main")
            self.git(repo, "config", "user.name", "CI Test")
            self.git(repo, "config", "user.email", "ci@example.invalid")
            root = self.commit_file(repo, "root.txt", "root\n", "root")

            self.git(repo, "switch", "-c", "feature")
            head = self.commit_file(repo, "feature.txt", "feature\n", "feature")

            self.git(repo, "switch", "main")
            base_tip = self.commit_file(repo, "base-only.txt", "base\n", "base drift")

            result = parse_name_status_z(
                collect_changed_files(repo, "pull_request", base_tip, head)
            )

        self.assertEqual(
            [(change.status, change.path) for change in result],
            [("A", "feature.txt")],
        )
        self.assertNotEqual(root, base_tip)

    def test_push_uses_before_commit_as_diff_base(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repo = Path(directory)
            self.git(repo, "init", "-b", "main")
            self.git(repo, "config", "user.name", "CI Test")
            self.git(repo, "config", "user.email", "ci@example.invalid")
            before = self.commit_file(repo, "root.txt", "root\n", "root")
            head = self.commit_file(repo, "pushed.txt", "push\n", "push")

            result = parse_name_status_z(
                collect_changed_files(repo, "push", before, head)
            )

        self.assertEqual([(change.status, change.path) for change in result], [("A", "pushed.txt")])


if __name__ == "__main__":
    unittest.main()
