from __future__ import annotations

import io
import json
import subprocess
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path

from scripts.git_lifecycle.cli import EXIT_OK, EXIT_OPERATION, EXIT_PROTECTED, main
from scripts.git_lifecycle.git_adapter import (
    CleanupSafety,
    GitAdapter,
    GitAdapterError,
    GitWorktree,
    worktree_path_for_branch,
)
from scripts.git_lifecycle.github_adapter import choose_pull_request
from scripts.git_lifecycle.github_adapter import GitHubAdapter
from scripts.git_lifecycle.policy import (
    AuditState,
    PullRequestObservation,
    WorktreeObservation,
    classify_observation,
    evaluate_finish,
    main_sync_decision,
)


def run_git(cwd: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        ["git", *args], cwd=cwd, text=True, capture_output=True, check=False
    )
    if check and result.returncode:
        raise AssertionError(f"git {' '.join(args)} failed: {result.stderr}")
    return result


class FakeGitHub:
    def __init__(self, *pull_requests: PullRequestObservation) -> None:
        self.pull_requests = pull_requests

    def view_pull_request(self, number: int) -> PullRequestObservation:
        for pull_request in self.pull_requests:
            if pull_request.number == number:
                return pull_request
        raise AssertionError(f"unexpected PR {number}")

    def list_pull_requests(self) -> tuple[PullRequestObservation, ...]:
        return self.pull_requests

class FailingFetchGitAdapter(GitAdapter):
    def fetch_origin(self) -> str:
        raise GitAdapterError("fetch unavailable")


class FailingDeleteGitAdapter(GitAdapter):
    def delete_local_branch_if_at(self, branch: str, expected_sha: str) -> None:
        raise GitAdapterError("compare-and-delete race")


class FailingRemoveGitAdapter(GitAdapter):
    def remove_worktree(self, worktree: GitWorktree) -> None:
        raise GitAdapterError("worktree remove failed")


class ChangedHeadOnRecheckGitAdapter(GitAdapter):
    def __init__(self, repo_root: Path) -> None:
        super().__init__(repo_root)
        self.path_observations = 0

    def worktree_for_path(self, path: Path) -> GitWorktree | None:
        worktree = super().worktree_for_path(path)
        self.path_observations += 1
        if worktree is not None and self.path_observations == 2:
            return replace(worktree, head_sha="c" * 40)
        return worktree


class UnsafeOnRecheckGitAdapter(GitAdapter):
    def __init__(self, repo_root: Path) -> None:
        super().__init__(repo_root)
        self.safety_observations = 0

    def cleanup_safety(self, path: Path) -> CleanupSafety:
        safety = super().cleanup_safety(path)
        self.safety_observations += 1
        if self.safety_observations == 2:
            return replace(safety, special_index_count=1)
        return safety


class PolicyTest(unittest.TestCase):
    def setUp(self) -> None:
        self.sha = "a" * 40
        self.pr = PullRequestObservation(
            number=17,
            state="MERGED",
            base_branch="feature/parent",
            head_branch="feature/child",
            head_sha=self.sha,
            merged_at="2026-08-21T00:00:00Z",
        )
        self.worktree = WorktreeObservation(
            path="/tmp/task with spaces",
            branch="feature/child",
            head_sha=self.sha,
            clean=True,
        )

    def test_non_main_base_is_evidence_not_a_cleanup_gate(self) -> None:
        decision = evaluate_finish(
            self.pr,
            self.worktree,
            local_branch="feature/child",
            local_sha=self.sha,
        )
        self.assertTrue(decision.eligible)
        self.assertEqual(
            classify_observation(
                self.worktree,
                self.pr,
                local_branch="feature/child",
                local_sha=self.sha,
            ),
            AuditState.MERGED_CLEAN,
        )

    def test_cross_repository_observation_is_not_cleanup_eligible(self) -> None:
        cross_pr = PullRequestObservation(
            number=18,
            state="MERGED",
            base_branch="main",
            head_branch="feature/child",
            head_sha=self.sha,
            merged_at="2026-08-21T00:00:00Z",
            head_repository="fork/project",
            base_repository="owner/project",
            cross_repository=True,
        )
        decision = evaluate_finish(
            cross_pr,
            self.worktree,
            local_branch="feature/child",
            local_sha=self.sha,
        )
        self.assertFalse(decision.eligible)
        self.assertIn("pr_source_repository_mismatch", decision.reasons)

    def test_gh_and_rest_repository_mapping_uses_cross_repository_evidence(self) -> None:
        gh = PullRequestObservation.from_mapping(
            {
                "number": 19,
                "state": "MERGED",
                "isCrossRepository": False,
                "headRepository": {"nameWithOwner": "owner/project"},
                "headRefName": "feature/child",
                "headRefOid": self.sha,
                "baseRefName": "main",
            }
        )
        rest = PullRequestObservation.from_mapping(
            {
                "number": 20,
                "state": "closed",
                "merged_at": "2026-08-21T00:00:00Z",
                "head": {
                    "ref": "feature/child",
                    "sha": self.sha,
                    "repo": {"full_name": "fork/project"},
                },
                "base": {
                    "ref": "main",
                    "repo": {"full_name": "owner/project"},
                },
            }
        )
        self.assertFalse(gh.cross_repository)
        self.assertTrue(rest.cross_repository)

    def test_finish_requires_clean_exact_head_and_branch(self) -> None:
        dirty = WorktreeObservation(**{**self.worktree.__dict__, "clean": False})
        decision = evaluate_finish(
            self.pr,
            dirty,
            local_branch="feature/child",
            local_sha=self.sha,
        )
        self.assertFalse(decision.eligible)
        self.assertIn("worktree_dirty", decision.reasons)
        mismatch = evaluate_finish(
            self.pr,
            self.worktree,
            local_branch="feature/other",
            local_sha="b" * 40,
        )
        self.assertFalse(mismatch.eligible)
        self.assertIn("branch_mismatch", mismatch.reasons)
        self.assertIn("head_sha_mismatch", mismatch.reasons)

    def test_main_sync_classification(self) -> None:
        self.assertEqual(main_sync_decision(clean=False, relation="behind"), "skipped_dirty")
        self.assertEqual(main_sync_decision(clean=True, relation="diverged"), "skipped_diverged")
        self.assertEqual(main_sync_decision(clean=True, relation="behind"), "updated")
        self.assertEqual(main_sync_decision(clean=True, relation="equal"), "already_current")

    def test_detached_and_ref_mismatch_are_not_cleanable(self) -> None:
        detached = WorktreeObservation(
            path=self.worktree.path,
            branch=None,
            head_sha=self.sha,
            clean=True,
            detached=True,
        )
        self.assertFalse(
            evaluate_finish(self.pr, detached, local_branch=None, local_sha=self.sha).eligible
        )
        self.assertEqual(
            classify_observation(
                self.worktree,
                self.pr,
                local_branch="feature/other",
                local_sha=self.sha,
            ),
            AuditState.REF_MISMATCH,
        )

    def test_pull_request_selection_does_not_filter_stacked_bases(self) -> None:
        self.assertIs(choose_pull_request([self.pr], "feature/child"), self.pr)

    def test_pull_request_selection_prefers_open_then_exact_asset_sha(self) -> None:
        old_merged = self.pr
        newer_closed = PullRequestObservation(
            18, "CLOSED", "main", "feature/child", "b" * 40
        )
        open_pr = PullRequestObservation(
            19, "OPEN", "main", "feature/child", "c" * 40
        )
        self.assertIs(
            choose_pull_request(
                [old_merged, newer_closed],
                "feature/child",
                expected_sha=self.sha,
            ),
            old_merged,
        )
        self.assertIs(
            choose_pull_request(
                [old_merged, newer_closed, open_pr],
                "feature/child",
                expected_sha=self.sha,
            ),
            open_pr,
        )

    def test_worktree_porcelain_parser_preserves_nul_safe_space_path(self) -> None:
        sha = "d" * 40
        path = "/tmp/worktree with spaces"

        def runner(command: tuple[str, ...], **_: object) -> subprocess.CompletedProcess[bytes]:
            self.assertEqual(command[1:4], ("worktree", "list", "--porcelain"))
            output = (
                f"worktree {path}\0HEAD {sha}\0branch refs/heads/feat/path\0\0".encode()
            )
            return subprocess.CompletedProcess(command, 0, output, b"")

        adapter = GitAdapter(Path("/tmp/repository"), runner=runner)
        worktrees = adapter.list_worktrees()
        self.assertEqual(len(worktrees), 1)
        self.assertEqual(worktrees[0].path, Path(path))
        self.assertEqual(worktrees[0].branch, "feat/path")
        self.assertEqual(worktrees[0].head_sha, sha)

    def test_cleanup_safety_counts_ignored_directories_without_expanding_them(self) -> None:
        def runner(command: tuple[str, ...], **_: object) -> subprocess.CompletedProcess[bytes]:
            if command[1:3] == ("status", "--porcelain=v1"):
                if "--ignored=matching" in command:
                    self.assertIn("--untracked-files=normal", command)
                    return subprocess.CompletedProcess(command, 0, b"!! node_modules/\x00", b"")
                return subprocess.CompletedProcess(command, 0, b"", b"")
            if command[1:3] == ("ls-files", "-v"):
                return subprocess.CompletedProcess(command, 0, b"H README.md\x00", b"")
            raise AssertionError(command)

        adapter = GitAdapter(Path("/tmp/repository"), runner=runner)
        safety = adapter.cleanup_safety(Path("/tmp/worktree"))
        self.assertTrue(safety.status_clean)
        self.assertEqual(safety.ignored_count, 1)
        self.assertTrue(safety.safe)

    def test_github_api_pagination_keeps_prs_past_one_thousand(self) -> None:
        def pull_request(number: int) -> dict[str, object]:
            sha = f"{number:040x}"
            return {
                "number": number,
                "state": "closed",
                "merged_at": "2026-08-21T00:00:00Z",
                "merge_commit_sha": sha,
                "base": {"ref": "main"},
                "head": {"ref": f"feat/task-{number}", "sha": sha},
            }

        pages = [[pull_request(number) for number in range(1, 501)], [pull_request(number) for number in range(501, 1002)]]

        def runner(command: tuple[str, ...], **_: object) -> subprocess.CompletedProcess[bytes]:
            self.assertEqual(command[1:4], ("api", "--paginate", "--slurp"))
            self.assertIn("per_page=100", command[4])
            return subprocess.CompletedProcess(command, 0, json.dumps(pages).encode(), b"")

        adapter = GitHubAdapter(Path("/tmp/repository"), runner=runner)
        observations = adapter.list_pull_requests()
        self.assertEqual(len(observations), 1001)
        self.assertEqual(observations[0].number, 1)
        self.assertEqual(observations[-1].number, 1001)
        self.assertEqual(observations[-1].head_branch, "feat/task-1001")

    def test_gh_view_contract_uses_supported_cross_repository_field(self) -> None:
        sha = "e" * 40

        def runner(command: tuple[str, ...], **_: object) -> subprocess.CompletedProcess[bytes]:
            self.assertEqual(command[:5], ("gh", "pr", "view", "1270", "--json"))
            fields = command[5]
            self.assertIn("headRepository", fields)
            self.assertIn("isCrossRepository", fields)
            self.assertNotIn("baseRepository", fields)
            payload = {
                "number": 1270,
                "state": "MERGED",
                "mergedAt": "2026-08-21T00:00:00Z",
                "baseRefName": "main",
                "headRefName": "feat/task",
                "headRefOid": sha,
                "mergeCommit": {"oid": "f" * 40},
                "headRepository": {"nameWithOwner": "owner/project"},
                "isCrossRepository": False,
            }
            return subprocess.CompletedProcess(command, 0, json.dumps(payload).encode(), b"")

        adapter = GitHubAdapter(Path("/tmp/repository"), runner=runner)
        observation = adapter.view_pull_request(1270)
        self.assertFalse(observation.cross_repository)
        self.assertEqual(observation.head_repository, "owner/project")


class LifecycleIntegrationTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory(prefix="git lifecycle ")
        self.root = Path(self.temp_dir.name)
        self.origin = self.root / "origin.git"
        self.repo = self.root / "Raspberry Pi System 002"
        run_git(self.root, "init", "--bare", str(self.origin))
        run_git(self.root, "clone", str(self.origin), str(self.repo))
        run_git(self.repo, "checkout", "-b", "main")
        run_git(self.repo, "config", "user.name", "Lifecycle Test")
        run_git(self.repo, "config", "user.email", "lifecycle@example.invalid")
        (self.repo / "README.md").write_text("initial\n", encoding="utf-8")
        run_git(self.repo, "add", "README.md")
        run_git(self.repo, "commit", "-m", "initial")
        run_git(self.repo, "push", "-u", "origin", "main")
        self.git = GitAdapter(self.repo)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def output(self, args: list[str], *, github: object | None = None) -> tuple[int, dict[str, object]]:
        stream = io.StringIO()
        code = main(
            [*args, "--repo", str(self.repo)],
            git_adapter=self.git,
            github_adapter=github,  # type: ignore[arg-type]
            stdout=stream,
        )
        return code, json.loads(stream.getvalue())

    def cleanup_task(self, branch: str) -> None:
        worktree = self.git.worktree_for_branch(branch)
        if worktree is not None:
            self.git.remove_worktree(worktree)
        sha = self.git.branch_sha(branch)
        if sha:
            self.git.delete_local_branch_if_at(branch, sha)

    def push_remote_main_commit(self, filename: str = "remote.txt") -> str:
        remote_clone = self.root / f"remote update {filename}"
        run_git(self.root, "clone", str(self.origin), str(remote_clone))
        run_git(remote_clone, "checkout", "-b", "main", "origin/main")
        run_git(remote_clone, "config", "user.name", "Remote Test")
        run_git(remote_clone, "config", "user.email", "remote@example.invalid")
        (remote_clone / filename).write_text("remote\n", encoding="utf-8")
        run_git(remote_clone, "add", filename)
        run_git(remote_clone, "commit", "-m", "remote main")
        run_git(remote_clone, "push", "origin", "main")
        return run_git(remote_clone, "rev-parse", "HEAD").stdout.strip()

    def test_start_uses_origin_main_without_touching_dirty_main(self) -> None:
        dirty = self.repo / "main-wip.txt"
        dirty.write_text("keep this WIP\n", encoding="utf-8")
        branch = "feat/task-path"
        code, payload = self.output(["start", "--branch", branch])
        self.assertEqual(code, EXIT_OK)
        target = Path(str(payload["worktree"]))
        self.assertEqual(target, worktree_path_for_branch(self.repo, branch))
        self.assertTrue(target.exists())
        self.assertEqual((target / "README.md").read_text(encoding="utf-8"), "initial\n")
        self.assertEqual(dirty.read_text(encoding="utf-8"), "keep this WIP\n")
        self.assertEqual(payload["main_sync"], "skipped_dirty")
        self.assertTrue(self.git.is_clean(target))
        self.cleanup_task(branch)

    def test_start_does_not_persist_fetch_prune_configuration(self) -> None:
        branch = "feat/no-config-mutation"
        before = run_git(
            self.repo, "config", "--local", "--get", "fetch.prune", check=False
        )
        self.assertEqual(before.returncode, 1)
        code, payload = self.output(["start", "--branch", branch])
        self.assertEqual(code, EXIT_OK)
        after = run_git(
            self.repo, "config", "--local", "--get", "fetch.prune", check=False
        )
        self.assertEqual(after.returncode, 1)
        self.cleanup_task(branch)

    def test_start_fetch_failure_does_not_create_worktree(self) -> None:
        branch = "feat/fetch-failure"
        failing = FailingFetchGitAdapter(self.repo)
        stream = io.StringIO()
        code = main(
            ["start", "--branch", branch, "--repo", str(self.repo)],
            git_adapter=failing,
            stdout=stream,
        )
        self.assertNotEqual(code, EXIT_OK)
        self.assertFalse(worktree_path_for_branch(self.repo, branch).exists())

    def test_start_uses_origin_main_when_main_is_diverged(self) -> None:
        local_file = self.repo / "local-only.txt"
        local_file.write_text("local\n", encoding="utf-8")
        run_git(self.repo, "add", "local-only.txt")
        run_git(self.repo, "commit", "-m", "local main")
        local_sha = run_git(self.repo, "rev-parse", "main").stdout.strip()
        remote_sha = self.push_remote_main_commit("remote-start.txt")
        branch = "feat/diverged-start"
        code, payload = self.output(["start", "--branch", branch])
        self.assertEqual(code, EXIT_OK)
        self.assertEqual(payload["main_sync"], "skipped_diverged")
        target = Path(str(payload["worktree"]))
        self.assertEqual(run_git(target, "rev-parse", "HEAD").stdout.strip(), remote_sha)
        self.assertEqual(run_git(self.repo, "rev-parse", "main").stdout.strip(), local_sha)
        self.cleanup_task(branch)

    def test_start_preserves_existing_remote_branch(self) -> None:
        branch = "feat/remote-collision"
        run_git(self.repo, "push", "origin", f"HEAD:refs/heads/{branch}")
        code, payload = self.output(["start", "--branch", branch])
        self.assertNotEqual(code, EXIT_OK)
        self.assertEqual(payload["remote_branch_state"], "present")
        self.assertFalse(worktree_path_for_branch(self.repo, branch).exists())

    def test_finish_cleans_one_merged_stacked_pr_and_preserves_remote(self) -> None:
        branch = "feat/stacked-finish"
        code, started = self.output(["start", "--branch", branch])
        self.assertEqual(code, EXIT_OK)
        target = Path(str(started["worktree"]))
        run_git(target, "config", "user.name", "Lifecycle Test")
        run_git(target, "config", "user.email", "lifecycle@example.invalid")
        (target / "task.txt").write_text("done\n", encoding="utf-8")
        run_git(target, "add", "task.txt")
        run_git(target, "commit", "-m", "task")
        head_sha = run_git(target, "rev-parse", "HEAD").stdout.strip()
        run_git(target, "push", "-u", "origin", branch)
        github = FakeGitHub(
            PullRequestObservation(
                number=42,
                state="MERGED",
                base_branch="feature/parent",
                head_branch=branch,
                head_sha=head_sha,
                merged_at="2026-08-21T00:00:00Z",
                merge_sha="b" * 40,
                head_repository="owner/project",
                base_repository="owner/project",
                cross_repository=False,
            )
        )
        code, payload = self.output(
            ["finish", "--worktree", str(target), "--pr", "42"], github=github
        )
        self.assertEqual(code, EXIT_OK)
        self.assertEqual(payload["target_cleanup"], "completed")
        self.assertTrue(payload["worktree_removed"])
        self.assertTrue(payload["local_branch_deleted"])
        self.assertEqual(payload["main_sync"], "already_current")
        self.assertEqual(payload["merge_sha"], "b" * 40)
        self.assertEqual(payload["remote_branch_state"], "present")
        self.assertFalse(target.exists())
        self.assertIsNone(self.git.branch_sha(branch))
        self.assertIn(branch, self.git.remote_branches())

    def test_finish_cleanup_survives_dirty_main(self) -> None:
        branch = "feat/dirty-main-finish"
        code, started = self.output(["start", "--branch", branch])
        self.assertEqual(code, EXIT_OK)
        target = Path(str(started["worktree"]))
        run_git(target, "config", "user.name", "Lifecycle Test")
        run_git(target, "config", "user.email", "lifecycle@example.invalid")
        (target / "task.txt").write_text("done\n", encoding="utf-8")
        run_git(target, "add", "task.txt")
        run_git(target, "commit", "-m", "task")
        head_sha = run_git(target, "rev-parse", "HEAD").stdout.strip()
        run_git(target, "push", "-u", "origin", branch)
        wip = self.repo / "main-wip.txt"
        wip.write_text("preserve\n", encoding="utf-8")
        github = FakeGitHub(
            PullRequestObservation(43, "MERGED", "main", branch, head_sha, "now")
        )
        code, payload = self.output(
            ["finish", "--worktree", str(target), "--pr", "43"], github=github
        )
        self.assertEqual(code, EXIT_OK)
        self.assertEqual(payload["target_cleanup"], "completed")
        self.assertEqual(payload["main_sync"], "skipped_dirty")
        self.assertEqual(wip.read_text(encoding="utf-8"), "preserve\n")

    def test_finish_holds_cross_repository_pr(self) -> None:
        branch = "feat/cross-repository"
        code, started = self.output(["start", "--branch", branch])
        self.assertEqual(code, EXIT_OK)
        target = Path(str(started["worktree"]))
        head_sha = run_git(target, "rev-parse", "HEAD").stdout.strip()
        github = FakeGitHub(
            PullRequestObservation(
                53,
                "MERGED",
                "main",
                branch,
                head_sha,
                "now",
                head_repository="fork/project",
                base_repository="owner/project",
                cross_repository=True,
            )
        )
        code, payload = self.output(
            ["finish", "--worktree", str(target), "--pr", "53"], github=github
        )
        self.assertEqual(code, EXIT_PROTECTED)
        self.assertEqual(payload["target_cleanup"], "protected")
        self.assertIn("pr_source_repository_mismatch", payload["warnings"])
        self.assertTrue(target.exists())
        self.cleanup_task(branch)

    def test_finish_does_not_scan_all_prs_or_block_on_reused_branch_name(self) -> None:
        branch = "feat/reused-branch-name"
        code, started = self.output(["start", "--branch", branch])
        self.assertEqual(code, EXIT_OK)
        target = Path(str(started["worktree"]))
        head_sha = run_git(target, "rev-parse", "HEAD").stdout.strip()
        github = FakeGitHub(
            PullRequestObservation(54, "MERGED", "main", branch, head_sha, "now"),
            PullRequestObservation(55, "OPEN", "feature/parent", branch, head_sha),
        )
        code, payload = self.output(
            ["finish", "--worktree", str(target), "--pr", "54"], github=github
        )
        self.assertEqual(code, EXIT_OK)
        self.assertEqual(payload["target_cleanup"], "completed")
        self.assertFalse(target.exists())

    def test_finish_rechecks_worktree_head_before_remove(self) -> None:
        branch = "feat/head-recheck"
        code, started = self.output(["start", "--branch", branch])
        self.assertEqual(code, EXIT_OK)
        target = Path(str(started["worktree"]))
        head_sha = run_git(target, "rev-parse", "HEAD").stdout.strip()
        github = FakeGitHub(PullRequestObservation(56, "MERGED", "main", branch, head_sha, "now"))
        racing = ChangedHeadOnRecheckGitAdapter(self.repo)
        stream = io.StringIO()
        code = main(
            ["finish", "--worktree", str(target), "--pr", "56", "--repo", str(self.repo)],
            git_adapter=racing,
            github_adapter=github,  # type: ignore[arg-type]
            stdout=stream,
        )
        payload = json.loads(stream.getvalue())
        self.assertEqual(code, EXIT_PROTECTED)
        self.assertIn("target_worktree_changed_before_remove", payload["warnings"])
        self.assertTrue(target.exists())
        self.cleanup_task(branch)

    def test_finish_rechecks_cleanup_safety_before_remove(self) -> None:
        branch = "feat/safety-recheck"
        code, started = self.output(["start", "--branch", branch])
        self.assertEqual(code, EXIT_OK)
        target = Path(str(started["worktree"]))
        head_sha = run_git(target, "rev-parse", "HEAD").stdout.strip()
        github = FakeGitHub(PullRequestObservation(57, "MERGED", "main", branch, head_sha, "now"))
        racing = UnsafeOnRecheckGitAdapter(self.repo)
        stream = io.StringIO()
        code = main(
            ["finish", "--worktree", str(target), "--pr", "57", "--repo", str(self.repo)],
            git_adapter=racing,
            github_adapter=github,  # type: ignore[arg-type]
            stdout=stream,
        )
        payload = json.loads(stream.getvalue())
        self.assertEqual(code, EXIT_PROTECTED)
        self.assertIn("target_cleanup_unsafe_before_remove", payload["warnings"])
        self.assertTrue(target.exists())
        self.cleanup_task(branch)

    def test_finish_warns_but_completes_with_ignored_material(self) -> None:
        (self.repo / ".gitignore").write_text("ignored-material.txt\n", encoding="utf-8")
        run_git(self.repo, "add", ".gitignore")
        run_git(self.repo, "commit", "-m", "ignore material")
        run_git(self.repo, "push", "origin", "main")
        branch = "feat/ignored-material"
        code, started = self.output(["start", "--branch", branch])
        self.assertEqual(code, EXIT_OK)
        target = Path(str(started["worktree"]))
        (target / "ignored-material.txt").write_text("keep\n", encoding="utf-8")
        safety = self.git.cleanup_safety(target)
        self.assertTrue(safety.status_clean)
        self.assertEqual(safety.ignored_count, 1)
        head_sha = run_git(target, "rev-parse", "HEAD").stdout.strip()
        github = FakeGitHub(PullRequestObservation(58, "MERGED", "main", branch, head_sha, "now"))
        code, payload = self.output(
            ["finish", "--worktree", str(target), "--pr", "58"], github=github
        )
        self.assertEqual(code, EXIT_OK)
        self.assertEqual(payload["target_cleanup"], "completed")
        self.assertIn("target_ignored_material_count:1", payload["warnings"])
        self.assertFalse(target.exists())

    def test_finish_holds_assume_unchanged_and_skip_worktree_flags(self) -> None:
        for index, (flag, clear_flag) in enumerate(
            (("--assume-unchanged", "--no-assume-unchanged"), ("--skip-worktree", "--no-skip-worktree")),
            start=59,
        ):
            branch = f"feat/index-flag-{index}"
            code, started = self.output(["start", "--branch", branch])
            self.assertEqual(code, EXIT_OK)
            target = Path(str(started["worktree"]))
            run_git(target, "update-index", flag, "README.md")
            safety = self.git.cleanup_safety(target)
            self.assertGreaterEqual(safety.special_index_count, 1)
            head_sha = run_git(target, "rev-parse", "HEAD").stdout.strip()
            github = FakeGitHub(PullRequestObservation(index, "MERGED", "main", branch, head_sha, "now"))
            code, payload = self.output(
                ["finish", "--worktree", str(target), "--pr", str(index)], github=github
            )
            self.assertEqual(code, EXIT_PROTECTED)
            self.assertTrue(
                any("target_special_index_flag_count:" in warning for warning in payload["warnings"])
            )
            self.assertTrue(target.exists())
            run_git(target, "update-index", clear_flag, "README.md")
            self.cleanup_task(branch)

    def test_main_sync_ignores_ignored_material_and_target_cleanup_succeeds(self) -> None:
        (self.repo / ".gitignore").write_text("main-ignored.txt\n", encoding="utf-8")
        run_git(self.repo, "add", ".gitignore")
        run_git(self.repo, "commit", "-m", "ignore main material")
        run_git(self.repo, "push", "origin", "main")
        (self.repo / "main-ignored.txt").write_text("preserve\n", encoding="utf-8")
        branch = "feat/main-ignored-sync"
        code, started = self.output(["start", "--branch", branch])
        self.assertEqual(code, EXIT_OK)
        target = Path(str(started["worktree"]))
        run_git(target, "config", "user.name", "Lifecycle Test")
        run_git(target, "config", "user.email", "lifecycle@example.invalid")
        (target / "task.txt").write_text("done\n", encoding="utf-8")
        run_git(target, "add", "task.txt")
        run_git(target, "commit", "-m", "task")
        head_sha = run_git(target, "rev-parse", "HEAD").stdout.strip()
        run_git(target, "push", "-u", "origin", branch)
        github = FakeGitHub(PullRequestObservation(60, "MERGED", "main", branch, head_sha, "now"))
        code, payload = self.output(
            ["finish", "--worktree", str(target), "--pr", "60"], github=github
        )
        self.assertEqual(code, EXIT_OK)
        self.assertEqual(payload["target_cleanup"], "completed")
        self.assertEqual(payload["main_sync"], "already_current")
        self.assertTrue((self.repo / "main-ignored.txt").exists())

    def test_finish_syncs_clean_behind_main_after_target_cleanup(self) -> None:
        self.push_remote_main_commit("remote-behind.txt")
        branch = "feat/main-behind-finish"
        code, started = self.output(["start", "--branch", branch])
        self.assertEqual(code, EXIT_OK)
        target = Path(str(started["worktree"]))
        run_git(target, "config", "user.name", "Lifecycle Test")
        run_git(target, "config", "user.email", "lifecycle@example.invalid")
        (target / "task.txt").write_text("done\n", encoding="utf-8")
        run_git(target, "add", "task.txt")
        run_git(target, "commit", "-m", "task")
        head_sha = run_git(target, "rev-parse", "HEAD").stdout.strip()
        run_git(target, "push", "-u", "origin", branch)
        github = FakeGitHub(PullRequestObservation(46, "MERGED", "main", branch, head_sha, "now"))
        code, payload = self.output(
            ["finish", "--worktree", str(target), "--pr", "46"], github=github
        )
        self.assertEqual(code, EXIT_OK)
        self.assertEqual(payload["target_cleanup"], "completed")
        self.assertEqual(payload["main_sync"], "updated")
        self.assertEqual(
            run_git(self.repo, "rev-parse", "main").stdout.strip(),
            run_git(self.repo, "rev-parse", "origin/main").stdout.strip(),
        )

    def test_finish_sync_skips_diverged_main_after_target_cleanup(self) -> None:
        local_file = self.repo / "local-main.txt"
        local_file.write_text("local\n", encoding="utf-8")
        run_git(self.repo, "add", "local-main.txt")
        run_git(self.repo, "commit", "-m", "local main")
        remote_sha = self.push_remote_main_commit("remote-diverged.txt")
        self.assertNotEqual(run_git(self.repo, "rev-parse", "main").stdout.strip(), remote_sha)
        branch = "feat/diverged-main-finish"
        code, started = self.output(["start", "--branch", branch])
        self.assertEqual(code, EXIT_OK)
        target = Path(str(started["worktree"]))
        run_git(target, "config", "user.name", "Lifecycle Test")
        run_git(target, "config", "user.email", "lifecycle@example.invalid")
        (target / "task.txt").write_text("done\n", encoding="utf-8")
        run_git(target, "add", "task.txt")
        run_git(target, "commit", "-m", "task")
        head_sha = run_git(target, "rev-parse", "HEAD").stdout.strip()
        run_git(target, "push", "-u", "origin", branch)
        github = FakeGitHub(PullRequestObservation(47, "MERGED", "main", branch, head_sha, "now"))
        code, payload = self.output(
            ["finish", "--worktree", str(target), "--pr", "47"], github=github
        )
        self.assertEqual(code, EXIT_OK)
        self.assertEqual(payload["target_cleanup"], "completed")
        self.assertEqual(payload["main_sync"], "skipped_diverged")
        self.assertTrue((self.repo / "local-main.txt").exists())

    def test_finish_holds_open_closed_and_sha_mismatch_targets(self) -> None:
        cases = (("OPEN", 48, "open"), ("CLOSED", 49, "closed"), ("MERGED", 50, "sha"))
        for state, number, suffix in cases:
            branch = f"feat/hold-{suffix}"
            code, started = self.output(["start", "--branch", branch])
            self.assertEqual(code, EXIT_OK)
            target = Path(str(started["worktree"]))
            head_sha = run_git(target, "rev-parse", "HEAD").stdout.strip()
            pr_sha = ("b" * 40) if suffix == "sha" else head_sha
            github = FakeGitHub(PullRequestObservation(number, state, "main", branch, pr_sha))
            code, payload = self.output(
                ["finish", "--worktree", str(target), "--pr", str(number)], github=github
            )
            self.assertEqual(code, EXIT_PROTECTED)
            self.assertEqual(payload["target_cleanup"], "protected")
            self.assertTrue(target.exists())
            self.assertIsNotNone(self.git.branch_sha(branch))
            self.cleanup_task(branch)

    def test_compare_and_delete_keeps_branch_when_expected_sha_is_stale(self) -> None:
        branch = "feat/compare-race"
        code, started = self.output(["start", "--branch", branch])
        self.assertEqual(code, EXIT_OK)
        actual_sha = self.git.branch_sha(branch)
        self.assertIsNotNone(actual_sha)
        with self.assertRaises(GitAdapterError):
            self.git.delete_local_branch_if_at(branch, "c" * 40)
        self.assertEqual(self.git.branch_sha(branch), actual_sha)
        self.cleanup_task(branch)

    def test_finish_reports_partial_when_branch_delete_races_after_worktree_remove(self) -> None:
        branch = "feat/partial-cleanup"
        code, started = self.output(["start", "--branch", branch])
        self.assertEqual(code, EXIT_OK)
        target = Path(str(started["worktree"]))
        head_sha = run_git(target, "rev-parse", "HEAD").stdout.strip()
        github = FakeGitHub(PullRequestObservation(51, "MERGED", "main", branch, head_sha, "now"))
        failing = FailingDeleteGitAdapter(self.repo)
        stream = io.StringIO()
        code = main(
            ["finish", "--worktree", str(target), "--pr", "51", "--repo", str(self.repo)],
            git_adapter=failing,
            github_adapter=github,  # type: ignore[arg-type]
            stdout=stream,
        )
        payload = json.loads(stream.getvalue())
        self.assertNotEqual(code, EXIT_OK)
        self.assertEqual(payload["target_cleanup"], "partial")
        self.assertTrue(payload["worktree_removed"])
        self.assertFalse(payload["local_branch_deleted"])
        self.assertFalse(target.exists())
        self.assertIsNotNone(self.git.branch_sha(branch))
        self.cleanup_task(branch)

    def test_finish_preserves_context_when_worktree_remove_fails(self) -> None:
        branch = "feat/remove-failure"
        code, started = self.output(["start", "--branch", branch])
        self.assertEqual(code, EXIT_OK)
        target = Path(str(started["worktree"]))
        head_sha = run_git(target, "rev-parse", "HEAD").stdout.strip()
        github = FakeGitHub(
            PullRequestObservation(61, "MERGED", "main", branch, head_sha, "now")
        )
        stream = io.StringIO()
        code = main(
            ["finish", "--worktree", str(target), "--pr", "61", "--repo", str(self.repo)],
            git_adapter=FailingRemoveGitAdapter(self.repo),
            github_adapter=github,  # type: ignore[arg-type]
            stdout=stream,
        )
        payload = json.loads(stream.getvalue())
        self.assertEqual(code, EXIT_OPERATION)
        self.assertEqual(payload["branch"], branch)
        self.assertEqual(payload["pr"], 61)
        self.assertEqual(payload["worktree"], str(target))
        self.assertEqual(payload["target_cleanup"], "failed")
        self.assertFalse(payload["worktree_removed"])
        self.assertFalse(payload["local_branch_deleted"])
        self.assertTrue(target.exists())
        self.cleanup_task(branch)

    def test_audit_no_pr_is_protected_and_summary_matches_records(self) -> None:
        branch = "feat/audit-no-pr"
        code, started = self.output(["start", "--branch", branch])
        self.assertEqual(code, EXIT_OK)
        target = Path(str(started["worktree"]))
        code, payload = self.output(["audit", "--json"], github=FakeGitHub())
        self.assertEqual(code, EXIT_OK)
        record = next(item for item in payload["records"] if item["branch"] == branch)
        self.assertEqual(record["state"], AuditState.NO_PR.value)
        self.assertTrue(record["protected"])
        protected_count = sum(1 for item in payload["records"] if item["protected"])
        self.assertEqual(payload["summary"]["protected_count"], protected_count)
        self.assertTrue(target.exists())
        self.cleanup_task(branch)

    def test_audit_omits_historical_pr_only_heads(self) -> None:
        historical = PullRequestObservation(
            901,
            "MERGED",
            "main",
            "feat/historical-only",
            "a" * 40,
            "now",
        )
        code, payload = self.output(["audit", "--json"], github=FakeGitHub(historical))
        self.assertEqual(code, EXIT_OK)
        self.assertNotIn(
            "feat/historical-only", {record["branch"] for record in payload["records"]}
        )

    def test_audit_includes_remote_only_refs_with_or_without_pr(self) -> None:
        without_pr = "feat/remote-only-no-pr"
        with_pr = "feat/remote-only-with-pr"
        run_git(self.repo, "push", "origin", f"HEAD:refs/heads/{without_pr}")
        run_git(self.repo, "push", "origin", f"HEAD:refs/heads/{with_pr}")
        run_git(self.repo, "fetch", "--prune", "origin")
        remote_sha = self.git.remote_branches()[with_pr]
        github = FakeGitHub(
            PullRequestObservation(902, "MERGED", "main", with_pr, remote_sha, "now")
        )
        code, payload = self.output(["audit", "--json"], github=github)
        self.assertEqual(code, EXIT_OK)
        records = {record["branch"]: record for record in payload["records"]}
        self.assertEqual(records[without_pr]["state"], AuditState.NO_PR.value)
        self.assertEqual(records[without_pr]["local_sha"], None)
        self.assertEqual(records[without_pr]["worktree"], None)
        self.assertEqual(records[with_pr]["state"], AuditState.MISSING_WORKTREE.value)
        self.assertEqual(records[with_pr]["remote_sha"], remote_sha)

    def test_audit_associates_pr_past_one_thousand_with_existing_local_branch(self) -> None:
        branch = "feat/old-local-branch"
        run_git(self.repo, "branch", branch)
        local_sha = self.git.branch_sha(branch)
        self.assertIsNotNone(local_sha)
        historical = [
            PullRequestObservation(number, "MERGED", "main", f"feat/historical-{number}", "b" * 40, "now")
            for number in range(1, 1001)
        ]
        historical.append(
            PullRequestObservation(1001, "MERGED", "main", branch, local_sha, "now")
        )
        code, payload = self.output(["audit", "--json"], github=FakeGitHub(*historical))
        self.assertEqual(code, EXIT_OK)
        records = {record["branch"]: record for record in payload["records"]}
        self.assertEqual(records[branch]["state"], AuditState.MISSING_WORKTREE.value)
        self.assertEqual(records[branch]["pr"]["number"], 1001)
        self.assertNotIn("feat/historical-1", records)

    def test_finish_protects_dirty_target(self) -> None:
        branch = "feat/dirty-target"
        code, started = self.output(["start", "--branch", branch])
        self.assertEqual(code, EXIT_OK)
        target = Path(str(started["worktree"]))
        (target / "uncommitted.txt").write_text("keep\n", encoding="utf-8")
        head_sha = run_git(target, "rev-parse", "HEAD").stdout.strip()
        github = FakeGitHub(PullRequestObservation(44, "MERGED", "main", branch, head_sha, "now"))
        code, payload = self.output(
            ["finish", "--worktree", str(target), "--pr", "44"], github=github
        )
        self.assertEqual(code, EXIT_PROTECTED)
        self.assertEqual(payload["target_cleanup"], "protected")
        self.assertFalse(payload["worktree_removed"])
        self.assertTrue(target.exists())
        self.assertIn("worktree_dirty", payload["warnings"])
        (target / "uncommitted.txt").unlink()
        self.cleanup_task(branch)

    def test_finish_never_treats_main_as_a_task_target(self) -> None:
        main_sha = run_git(self.repo, "rev-parse", "main").stdout.strip()
        github = FakeGitHub(PullRequestObservation(52, "MERGED", "main", "main", main_sha, "now"))
        code, payload = self.output(
            ["finish", "--worktree", str(self.repo), "--pr", "52"], github=github
        )
        self.assertEqual(code, EXIT_PROTECTED)
        self.assertEqual(payload["target_cleanup"], "protected")
        self.assertIn("main_worktree_protected", payload["warnings"])
        self.assertTrue(self.repo.exists())
        self.assertEqual(self.git.branch_sha("main"), main_sha)

    def test_audit_is_read_only_and_reports_dirty_and_open(self) -> None:
        branch = "feat/audit-open"
        code, started = self.output(["start", "--branch", branch])
        self.assertEqual(code, EXIT_OK)
        target = Path(str(started["worktree"]))
        (target / "uncommitted.txt").write_text("keep\n", encoding="utf-8")
        head_sha = run_git(target, "rev-parse", "HEAD").stdout.strip()
        github = FakeGitHub(PullRequestObservation(45, "OPEN", "main", branch, head_sha))
        code, payload = self.output(["audit", "--json"], github=github)
        self.assertEqual(code, EXIT_OK)
        record = next(item for item in payload["records"] if item["branch"] == branch)
        self.assertEqual(record["state"], AuditState.DIRTY_PROTECTED.value)
        self.assertFalse(record["worktree_clean"])
        self.assertTrue(target.exists())
        self.assertIsNotNone(self.git.branch_sha(branch))
        (target / "uncommitted.txt").unlink()
        self.cleanup_task(branch)


if __name__ == "__main__":
    unittest.main()
