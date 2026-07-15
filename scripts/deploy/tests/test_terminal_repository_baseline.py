#!/usr/bin/env python3
from __future__ import annotations

import base64
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


SCRIPT = Path(__file__).parents[1] / "terminal-repository-baseline.py"
SPEC = importlib.util.spec_from_file_location("terminal_repository_baseline", SCRIPT)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("could not load terminal repository baseline helper")
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class TerminalRepositoryBaselineTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.base = Path(self.temporary.name).resolve()

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def git(self, repository: Path, *arguments: str) -> str:
        return subprocess.run(
            ["git", "-C", str(repository), *arguments],
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()

    def repository(self, name: str = "repository", *, include_docs: bool = True) -> Path:
        repository = self.base / name
        repository.mkdir()
        self.git(repository, "init", "--quiet")
        self.git(repository, "config", "user.name", "Baseline Test")
        self.git(repository, "config", "user.email", "baseline@example.invalid")
        (repository / "app.txt").write_text("release\n", encoding="utf-8")
        (repository / ".gitignore").write_text("ignored.env\n", encoding="utf-8")
        if include_docs:
            (repository / "docs" / "nested").mkdir(parents=True)
            (repository / "docs" / "guide.md").write_text("guide\n", encoding="utf-8")
            (repository / "docs" / "nested" / "runbook.md").write_text(
                "runbook\n", encoding="utf-8"
            )
            (repository / "docs" / "odd\nname.md").write_text(
                "odd path\n", encoding="utf-8"
            )
        self.git(repository, "add", ".")
        self.git(repository, "commit", "--quiet", "-m", "fixture")
        return repository

    def status_bytes(self, repository: Path) -> bytes:
        return subprocess.run(
            [
                "git",
                "-C",
                str(repository),
                "status",
                "--porcelain=v1",
                "-z",
                "--untracked-files=all",
            ],
            check=True,
            capture_output=True,
        ).stdout

    def delete_all_docs(self, repository: Path) -> None:
        shutil.rmtree(repository / "docs")

    def test_clean_repository_returns_head_without_touching_ignored_state(self):
        repository = self.repository()
        ignored = repository / "ignored.env"
        ignored.write_text("SECRET=preserve\n", encoding="utf-8")
        before = self.git(repository, "rev-parse", "HEAD")

        result = MODULE.prepare(repository)

        self.assertEqual(
            result,
            {"head": before, "repairedLegacyDocs": False, "count": 0},
        )
        self.assertEqual(ignored.read_text(encoding="utf-8"), "SECRET=preserve\n")
        self.assertEqual(self.status_bytes(repository), b"")

    def test_complete_legacy_docs_deletion_is_repaired_exactly(self):
        repository = self.repository()
        before = self.git(repository, "rev-parse", "HEAD")
        self.delete_all_docs(repository)

        result = MODULE.prepare(repository)

        self.assertEqual(result["head"], before)
        self.assertTrue(result["repairedLegacyDocs"])
        self.assertEqual(result["count"], 3)
        self.assertEqual(self.status_bytes(repository), b"")
        self.assertEqual(
            (repository / "docs" / "odd\nname.md").read_text(encoding="utf-8"),
            "odd path\n",
        )

    def test_every_non_exact_dirty_state_is_rejected_without_repair(self):
        scenarios = (
            "partial-docs",
            "docs-plus-modified",
            "staged",
            "untracked-docs",
            "modified-doc",
            "rename",
            "zero-tracked-docs",
        )
        for scenario in scenarios:
            with self.subTest(scenario=scenario):
                repository = self.repository(
                    scenario, include_docs=scenario != "zero-tracked-docs"
                )
                if scenario == "partial-docs":
                    (repository / "docs" / "guide.md").unlink()
                elif scenario == "docs-plus-modified":
                    self.delete_all_docs(repository)
                    (repository / "app.txt").write_text(
                        "operator edit\n", encoding="utf-8"
                    )
                elif scenario == "staged":
                    (repository / "app.txt").write_text("staged\n", encoding="utf-8")
                    self.git(repository, "add", "app.txt")
                elif scenario == "untracked-docs":
                    self.delete_all_docs(repository)
                    (repository / "docs").mkdir()
                    (repository / "docs" / "operator.md").write_text(
                        "operator\n", encoding="utf-8"
                    )
                elif scenario == "modified-doc":
                    (repository / "docs" / "guide.md").write_text(
                        "modified\n", encoding="utf-8"
                    )
                elif scenario == "rename":
                    self.git(repository, "mv", "app.txt", "renamed.txt")
                else:
                    (repository / "app.txt").write_text("dirty\n", encoding="utf-8")
                before = self.status_bytes(repository)

                with self.assertRaises(MODULE.BaselineError):
                    MODULE.prepare(repository)

                self.assertEqual(self.status_bytes(repository), before)

    def test_cli_marker_is_canonical_bounded_json(self):
        repository = self.repository()
        head = self.git(repository, "rev-parse", "HEAD")
        completed = subprocess.run(
            [
                sys.executable,
                str(SCRIPT),
                "--repository",
                str(repository),
                "--ansible-marker",
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        self.assertTrue(completed.stdout.startswith(MODULE.MARKER_PREFIX))
        encoded = completed.stdout.removeprefix(MODULE.MARKER_PREFIX).strip()
        decoded = base64.b64decode(encoded, altchars=b"-_", validate=True)
        self.assertEqual(
            json.loads(decoded),
            {"head": head, "repairedLegacyDocs": False, "count": 0},
        )

    def test_assume_unchanged_and_skip_worktree_are_rejected(self):
        for flag in ("--assume-unchanged", "--skip-worktree"):
            with self.subTest(flag=flag):
                repository = self.repository(flag.removeprefix("--"))
                self.git(repository, "update-index", flag, "app.txt")
                if flag == "--assume-unchanged":
                    (repository / "app.txt").write_text(
                        "hidden operator edit\n", encoding="utf-8"
                    )
                    self.assertEqual(self.status_bytes(repository), b"")

                with self.assertRaisesRegex(
                    MODULE.BaselineError, "index contains"
                ):
                    MODULE.prepare(repository)

                if flag == "--assume-unchanged":
                    self.assertEqual(
                        (repository / "app.txt").read_text(encoding="utf-8"),
                        "hidden operator edit\n",
                    )

    def test_git_environment_poisoning_cannot_redirect_repository_identity(self):
        repository = self.repository("real")
        fake = self.repository("fake")
        (repository / "app.txt").write_text("real operator edit\n", encoding="utf-8")
        before = self.status_bytes(repository)
        poisoned_index = self.base / "poisoned-index"

        with mock.patch.dict(
            os.environ,
            {
                "GIT_DIR": str(fake / ".git"),
                "GIT_WORK_TREE": str(repository),
                "GIT_INDEX_FILE": str(poisoned_index),
            },
            clear=False,
        ), self.assertRaises(MODULE.BaselineError):
            MODULE.prepare(repository)

        self.assertEqual(self.status_bytes(repository), before)
        self.assertFalse(poisoned_index.exists())

    def test_clean_check_does_not_refresh_or_rewrite_git_index(self):
        repository = self.repository()
        index = repository / ".git" / "index"
        before = index.read_bytes()
        os.utime(repository / "app.txt", None)

        MODULE.prepare(repository)

        self.assertEqual(index.read_bytes(), before)

    def test_symlinked_ancestor_repository_path_is_rejected(self):
        repository = self.repository("real")
        linked_parent = self.base / "current"
        linked_parent.symlink_to(repository.parent, target_is_directory=True)
        supplied = linked_parent / repository.name

        with self.assertRaisesRegex(
            MODULE.BaselineError, "symlink components"
        ):
            MODULE.prepare(supplied)

    def test_head_change_before_repair_never_invokes_restore(self):
        repository = self.repository()
        self.delete_all_docs(repository)
        original_head = MODULE._head(repository)
        restore_calls: list[list[str]] = []
        real_run_git = MODULE._run_git
        head_calls = 0

        def changed_head(path, arguments, **kwargs):
            nonlocal head_calls
            if arguments[:2] == ["rev-parse", "--verify"]:
                head_calls += 1
                if head_calls == 2:
                    return 0, ("f" * 40 + "\n").encode("ascii")
            if arguments and arguments[0] == "restore":
                restore_calls.append(list(arguments))
            return real_run_git(path, arguments, **kwargs)

        with mock.patch.object(MODULE, "_run_git", side_effect=changed_head), \
                self.assertRaisesRegex(MODULE.BaselineError, "HEAD changed"):
            MODULE.prepare(repository)

        self.assertEqual(restore_calls, [])
        self.assertEqual(MODULE._head(repository), original_head)
        self.assertFalse((repository / "docs").exists())


if __name__ == "__main__":
    unittest.main()
