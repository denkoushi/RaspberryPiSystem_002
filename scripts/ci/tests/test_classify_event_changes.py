#!/usr/bin/env python3
from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from classify_event_changes import classify_event  # noqa: E402


class ClassifyEventChangesTests(unittest.TestCase):
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

    def new_repo(self, directory: str) -> Path:
        repo = Path(directory)
        self.git(repo, "init", "-b", "main")
        self.git(repo, "config", "user.name", "CI Test")
        self.git(repo, "config", "user.email", "ci@example.invalid")
        return repo

    def test_docs_only_main_push_is_change_aware(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repo = self.new_repo(directory)
            before = self.commit_file(repo, "README.md", "before\n", "before")
            head = self.commit_file(repo, "docs/guide.md", "docs\n", "docs")
            result = classify_event(repo, "push", before, head)

        self.assertFalse(result["fullSuite"])
        self.assertEqual(
            result["categories"],
            {
                "repo_policy": True,
                "workspace_quality": False,
                "api": False,
                "web": False,
                "db_infra": False,
                "deploy_contract": False,
                "client": False,
                "e2e": False,
                "kiosk_sop": False,
                "docker_security": False,
                "signage_artifact": False,
            },
        )
        self.assertFalse(result["codeql"])

    def test_pull_request_uses_same_classifier(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repo = self.new_repo(directory)
            base = self.commit_file(repo, "README.md", "before\n", "before")
            head = self.commit_file(repo, "apps/web/src/main.tsx", "x\n", "web")
            result = classify_event(repo, "pull_request", base, head)

        self.assertTrue(result["categories"]["web"])
        self.assertTrue(result["codeql"])
        self.assertFalse(result["fullSuite"])

    def test_main_push_completes_artifacts_without_expanding_pr_checks(self) -> None:
        cases = (
            "scripts/deploy/standard-ansible-release.py",
            "scripts/ci/classify_changes.py",
        )
        for path in cases:
            with self.subTest(path=path), tempfile.TemporaryDirectory() as directory:
                repo = self.new_repo(directory)
                base = self.commit_file(repo, "README.md", "base\n", "base")
                head = self.commit_file(repo, path, "changed\n", "change")

                pull_request = classify_event(repo, "pull_request", base, head)
                main_push = classify_event(repo, "push", base, head)

                self.assertFalse(pull_request["categories"]["signage_artifact"])
                self.assertEqual(pull_request["pi4AgentMatrix"], [])
                self.assertTrue(main_push["categories"]["signage_artifact"])
                self.assertEqual(len(main_push["pi4AgentMatrix"]), 6)
                self.assertFalse(main_push["fullSuite"])

    def test_manual_schedule_merge_group_and_unstable_push_fail_closed(self) -> None:
        for event in ("workflow_dispatch", "schedule", "merge_group"):
            with self.subTest(event=event):
                result = classify_event(Path.cwd(), event, "", "head")
                self.assertTrue(result["fullSuite"])
                self.assertTrue(result["codeql"])
                self.assertTrue(result["dockerApi"])
                self.assertTrue(result["dockerWeb"])

        zero = classify_event(Path.cwd(), "push", "0" * 40, "head")
        self.assertTrue(zero["fullSuite"])
        self.assertIn("stable diff base", zero["failClosedReasons"][0])

    def test_nonancestor_push_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repo = self.new_repo(directory)
            self.commit_file(repo, "root.txt", "root\n", "root")
            self.git(repo, "switch", "-c", "other")
            unrelated = self.commit_file(repo, "other.txt", "other\n", "other")
            self.git(repo, "switch", "main")
            head = self.commit_file(repo, "main.txt", "main\n", "main")
            result = classify_event(repo, "push", unrelated, head)

        self.assertTrue(result["fullSuite"])
        self.assertIn("not an ancestor", result["failClosedReasons"][0])


if __name__ == "__main__":
    unittest.main()
