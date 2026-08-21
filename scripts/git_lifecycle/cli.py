"""Command-line orchestration for the Git lifecycle policy."""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path
from typing import Any, Sequence, TextIO

try:
    from .git_adapter import (
        CleanupSafety,
        GitAdapter,
        GitAdapterError,
        GitWorktree,
        MainObservation,
        worktree_path_for_branch,
    )
    from .github_adapter import (
        GitHubAdapter,
        GitHubAdapterError,
        choose_pull_request,
    )
    from .policy import (
        AuditState,
        PullRequestObservation,
        WorktreeObservation,
        classify_observation,
        evaluate_finish,
    )
except ImportError:  # pragma: no cover - direct script execution
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    from scripts.git_lifecycle.git_adapter import (
        CleanupSafety,
        GitAdapter,
        GitAdapterError,
        GitWorktree,
        MainObservation,
        worktree_path_for_branch,
    )
    from scripts.git_lifecycle.github_adapter import (
        GitHubAdapter,
        GitHubAdapterError,
        choose_pull_request,
    )
    from scripts.git_lifecycle.policy import (
        AuditState,
        PullRequestObservation,
        WorktreeObservation,
        classify_observation,
        evaluate_finish,
    )


EXIT_OK = 0
EXIT_USAGE = 2
EXIT_PROTECTED = 3
EXIT_OPERATION = 4


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="git-lifecycle",
        description="Safely start, audit, and finish one Git worktree task.",
    )
    parser.add_argument(
        "--repo", dest="global_repo", type=Path, default=None, help="repository or worktree path"
    )
    commands = parser.add_subparsers(dest="command", required=True)

    start = commands.add_parser("start", help="create a task worktree from origin/main")
    start.add_argument("--branch", required=True, help="new local branch name")
    start.add_argument("--repo", dest="command_repo", type=Path, default=None, help=argparse.SUPPRESS)

    audit = commands.add_parser("audit", help="read and classify current worktrees")
    audit.add_argument("--json", action="store_true", help="emit the structured JSON report")
    audit.add_argument("--repo", dest="command_repo", type=Path, default=None, help=argparse.SUPPRESS)

    finish = commands.add_parser("finish", help="clean one merged task worktree")
    finish.add_argument("--worktree", required=True, type=Path, help="exact registered worktree path")
    finish.add_argument("--pr", required=True, type=_positive_integer, help="merged pull request number")
    finish.add_argument("--repo", dest="command_repo", type=Path, default=None, help=argparse.SUPPRESS)
    return parser


def main(
    argv: Sequence[str] | None = None,
    *,
    git_adapter: GitAdapter | None = None,
    github_adapter: GitHubAdapter | None = None,
    stdout: TextIO | None = None,
    stderr: TextIO | None = None,
) -> int:
    """Run one public command and emit one structured JSON object."""

    parser = build_parser()
    args = parser.parse_args(argv)
    out = stdout or sys.stdout
    err = stderr or sys.stderr
    repo_argument = getattr(args, "command_repo", None) or getattr(args, "global_repo", None)
    try:
        git = git_adapter or GitAdapter.discover(repo_argument)
        github = github_adapter or GitHubAdapter(git.repo_root)
        if args.command == "start":
            payload, code = _start(git, args.branch)
        elif args.command == "finish":
            payload, code = _finish(git, github, args.worktree, args.pr)
        elif args.command == "audit":
            payload, code = _audit(git, github)
        else:  # pragma: no cover - argparse enforces this
            raise LifecycleError(f"unsupported command: {args.command}")
    except (GitAdapterError, GitHubAdapterError, LifecycleError, OSError, ValueError) as error:
        operation = str(getattr(args, "command", "unknown"))
        payload = _base_payload(operation)
        payload["warnings"] = [str(error)]
        payload["exit_code"] = EXIT_OPERATION
        code = EXIT_OPERATION
    payload["exit_code"] = code
    print(json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")), file=out)
    if code and err is not out:
        # Keep stderr quiet for normal JSON consumers.  The parameter is
        # accepted so embedding callers can pass their own streams and still
        # receive a stable return code.
        _ = err
    return code


class LifecycleError(RuntimeError):
    """An operation could not safely proceed."""


def _start(git: GitAdapter, branch: str) -> tuple[dict[str, Any], int]:
    path = worktree_path_for_branch(git.repo_root, branch)
    payload = _base_payload("start", branch=branch, worktree=str(path))
    warnings: list[str] = []
    payload["target_cleanup"] = "not_applicable"
    payload["remote_branch"] = branch
    payload["remote_branch_state"] = "not_checked"
    payload["origin_main_sha"] = None
    payload["main_sync"] = "not_attempted"

    # This is intentionally the first repository operation.  A stale local
    # origin/main is never an acceptable starting point.
    origin_sha = git.fetch_origin()
    payload["origin_main_sha"] = origin_sha

    main = git.observe_main(origin_sha=origin_sha)
    main_sync, main_warnings = _start_main_status(main)
    payload["main_sync"] = main_sync
    warnings.extend(main_warnings)

    if git.has_local_branch(branch):
        payload["warnings"] = [*warnings, f"local branch already exists; preserving it: {branch}"]
        return payload, EXIT_PROTECTED
    if git.worktree_for_branch(branch) is not None:
        payload["warnings"] = [*warnings, f"worktree branch already exists; preserving it: {branch}"]
        return payload, EXIT_PROTECTED
    if git.remote_branch_exists(branch):
        payload["remote_branch_state"] = "present"
        payload["warnings"] = [*warnings, f"remote branch already exists; preserving it: {branch}"]
        return payload, EXIT_PROTECTED
    if git.worktree_for_path(path) is not None or path.exists():
        payload["warnings"] = [*warnings, f"worktree path already exists; preserving it: {path}"]
        return payload, EXIT_PROTECTED

    # The ref was resolved immediately after fetch.  Confirm it has not been
    # moved by another process before adding the new worktree.
    if git.resolve_commit("refs/remotes/origin/main") != origin_sha:
        raise LifecycleError("origin/main moved after fetch; no worktree was created")
    git.add_worktree_from_origin_main(branch, path)
    created = git.worktree_for_path(path)
    if created is None or created.branch != branch or created.head_sha != origin_sha:
        raise LifecycleError("created worktree did not match fetched origin/main")
    payload["warnings"] = warnings
    payload["worktree_created"] = True
    return payload, EXIT_OK


def _finish(
    git: GitAdapter,
    github: GitHubAdapter,
    worktree_path: Path,
    pr_number: int,
) -> tuple[dict[str, Any], int]:
    payload = _base_payload("finish", worktree=str(worktree_path), pr=pr_number)
    payload["target_cleanup"] = "protected"
    payload["worktree_removed"] = False
    payload["local_branch_deleted"] = False
    payload["remote_branch"] = None
    payload["remote_branch_state"] = "not_checked"
    payload["merge_sha"] = None
    payload["main_sync"] = "not_attempted"
    warnings: list[str] = []

    pull_request = github.view_pull_request(pr_number)
    payload["branch"] = pull_request.head_branch
    payload["remote_branch"] = pull_request.head_branch
    payload["merge_sha"] = pull_request.merge_sha

    observed = git.worktree_for_path(worktree_path)
    if observed is None:
        warnings.append("target_worktree_not_registered")
        payload["warnings"] = warnings
        return payload, EXIT_PROTECTED
    if observed.branch is None:
        warnings.append("target_worktree_detached")
        payload["warnings"] = warnings
        return payload, EXIT_PROTECTED
    branch = observed.branch
    if observed.branch == "main":
        warnings.append("main_worktree_protected")
        payload["warnings"] = warnings
        return payload, EXIT_PROTECTED
    if not observed.path.exists():
        warnings.append("target_worktree_path_missing")
        payload["warnings"] = warnings
        return payload, EXIT_PROTECTED

    local_sha = git.branch_sha(observed.branch)
    try:
        cleanup_safety = git.cleanup_safety(observed.path)
    except GitAdapterError as error:
        warnings.append(f"target_worktree_status_failed: {error}")
        payload["warnings"] = warnings
        return payload, EXIT_PROTECTED
    warnings.extend(_cleanup_safety_warnings(cleanup_safety, scope="target"))
    observation = WorktreeObservation(
        path=str(observed.path),
        branch=observed.branch,
        head_sha=observed.head_sha,
        clean=cleanup_safety.safe,
        detached=observed.detached,
    )
    decision = evaluate_finish(
        pull_request,
        observation,
        local_branch=observed.branch,
        local_sha=local_sha,
    )
    if not decision.eligible:
        warnings.extend(decision.reasons)
        payload["warnings"] = warnings
        return payload, EXIT_PROTECTED

    # Re-observe immediately before removal.  This is intentionally a local
    # race check rather than a claim of a cross-process transaction.
    latest = git.worktree_for_path(worktree_path)
    if (
        latest is None
        or latest.branch != observed.branch
        or latest.head_sha != observed.head_sha
    ):
        warnings.append("target_worktree_changed_before_remove")
        payload["warnings"] = warnings
        return payload, EXIT_PROTECTED
    try:
        latest_safety = git.cleanup_safety(latest.path)
    except GitAdapterError as error:
        warnings.append(f"target_cleanup_safety_recheck_failed: {error}")
        payload["warnings"] = warnings
        return payload, EXIT_PROTECTED
    warnings.extend(_cleanup_safety_warnings(latest_safety, scope="target_recheck"))
    if not latest_safety.safe:
        warnings.append("target_cleanup_unsafe_before_remove")
        payload["warnings"] = warnings
        return payload, EXIT_PROTECTED
    observed = latest

    expected_sha = pull_request.head_sha
    if expected_sha is None:  # evaluate_finish already protects this
        warnings.append("pr_head_sha_missing")
        payload["warnings"] = warnings
        return payload, EXIT_PROTECTED
    try:
        git.remove_worktree(observed)
    except GitAdapterError as error:
        payload["target_cleanup"] = "failed"
        warnings.append(f"worktree_remove_failed: {error}")
        payload["warnings"] = warnings
        return payload, EXIT_OPERATION
    payload["worktree_removed"] = True
    try:
        git.delete_local_branch_if_at(branch, expected_sha)
    except GitAdapterError as error:
        payload["target_cleanup"] = "partial"
        warnings.append(f"local_branch_preserved_after_compare_failure: {error}")
        payload["warnings"] = warnings
        return payload, EXIT_OPERATION
    payload["local_branch_deleted"] = True
    payload["target_cleanup"] = "completed"

    # Main synchronization is deliberately after and independent from target
    # cleanup.  A dirty/diverged main therefore cannot strand this task.
    main_sync, sync_warnings = _sync_main(git)
    payload["main_sync"] = main_sync
    warnings.extend(sync_warnings)
    if pull_request.head_branch:
        try:
            present = git.remote_branch_exists(pull_request.head_branch)
        except GitAdapterError as error:
            payload["remote_branch_state"] = "unknown"
            warnings.append(f"remote_branch_observation_failed: {error}")
        else:
            payload["remote_branch_state"] = "present" if present else "absent"
            if present:
                warnings.append("remote_branch_retained_by_github")
    payload["warnings"] = warnings
    return payload, EXIT_OK


def _audit(git: GitAdapter, github: GitHubAdapter) -> tuple[dict[str, Any], int]:
    payload = _base_payload("audit")
    warnings: list[str] = []
    try:
        worktrees = git.list_worktrees()
        local_branches = git.local_branches()
        remote_branches = git.remote_branches()
        pull_requests = github.list_pull_requests()
    except (GitAdapterError, GitHubAdapterError) as error:
        payload["warnings"] = [str(error)]
        payload["records"] = []
        payload["summary"] = {"counts": {}, "protected_count": 0}
        return payload, EXIT_OPERATION

    records: list[dict[str, Any]] = []
    represented_branches: set[str] = set()
    for worktree in worktrees:
        branch = worktree.branch
        if branch:
            represented_branches.add(branch)
        local_sha = local_branches.get(branch) if branch else None
        pr = (
            choose_pull_request(
                pull_requests,
                branch,
                expected_sha=local_sha or worktree.head_sha,
            )
            if branch
            else None
        )
        cleanup_safety: CleanupSafety | None = None
        if not worktree.detached and worktree.path.exists():
            try:
                cleanup_safety = git.cleanup_safety(worktree.path)
                warnings.extend(_cleanup_safety_warnings(cleanup_safety, scope="audit"))
            except GitAdapterError as error:
                warnings.append(f"cleanup_safety_observation_failed:{error}")
        clean = cleanup_safety.safe if cleanup_safety is not None else False
        observation = WorktreeObservation(
            path=str(worktree.path),
            branch=branch,
            head_sha=worktree.head_sha,
            clean=clean,
            detached=worktree.detached,
        )
        state = classify_observation(
            observation,
            pr,
            local_sha=local_sha,
            local_branch=branch,
        )
        records.append(
            _audit_record(
                state,
                worktree=worktree,
                cleanup_safety=cleanup_safety,
                clean=clean,
                local_sha=local_sha,
                pull_request=pr,
                remote_sha=remote_branches.get(branch) if branch else None,
            )
        )

    # A local branch with an associated PR but no registered worktree is
    # exactly the kind of residue audit must report.  Branches with no PR are
    # included as NO_PR for an honest read-only inventory, never deleted.
    for branch, local_sha in sorted(local_branches.items()):
        if branch in represented_branches:
            continue
        represented_branches.add(branch)
        pr = choose_pull_request(pull_requests, branch, expected_sha=local_sha)
        state = AuditState.MISSING_WORKTREE if pr else AuditState.NO_PR
        records.append(
            _audit_record(
                state,
                branch=branch,
                local_sha=local_sha,
                pull_request=pr,
                remote_sha=remote_branches.get(branch),
            )
        )

    # Remote-only refs are assets too.  A PR-only historical head with no
    # worktree, local branch, or remote-tracking ref is intentionally omitted:
    # the PR is evidence for an asset, not an asset registry of its own.
    for branch, remote_sha in sorted(remote_branches.items()):
        if branch in represented_branches:
            continue
        represented_branches.add(branch)
        pr = choose_pull_request(pull_requests, branch, expected_sha=remote_sha)
        state = AuditState.MISSING_WORKTREE if pr else AuditState.NO_PR
        records.append(
            _audit_record(
                state,
                branch=branch,
                pull_request=pr,
                remote_sha=remote_sha,
            )
        )

    counts = Counter(record["state"] for record in records)
    protected_states = {
        AuditState.ACTIVE_OPEN_PR.value,
        AuditState.DIRTY_PROTECTED.value,
        AuditState.CLOSED_UNMERGED.value,
        AuditState.DETACHED.value,
        AuditState.REF_MISMATCH.value,
        AuditState.MISSING_WORKTREE.value,
        AuditState.NO_PR.value,
    }
    protected = [record for record in records if record["state"] in protected_states]
    payload["records"] = records
    payload["warnings"] = warnings
    payload["summary"] = {
        "counts": dict(sorted(counts.items())),
        "protected_count": len(protected),
        "cleanable_count": counts.get(AuditState.MERGED_CLEAN.value, 0),
        "remote_branch_count": len(remote_branches),
    }
    return payload, EXIT_OK


def _sync_main(git: GitAdapter) -> tuple[str, list[str]]:
    warnings: list[str] = []
    try:
        origin_sha = git.fetch_origin()
    except GitAdapterError as error:
        return "skipped_diverged", [f"main_sync_fetch_failed: {error}"]
    main = git.observe_main(origin_sha=origin_sha)
    if main.worktree is None or main.clean is None:
        return "skipped_diverged", ["main_sync_skipped_diverged: main_worktree_unavailable"]
    if not main.clean:
        return "skipped_dirty", [
            "main_sync_skipped_dirty: main_cleanup_unsafe",
            *_cleanup_safety_warnings(main.cleanup_safety, scope="main"),
        ]
    if main.relation == "equal":
        return "already_current", warnings
    if main.relation != "behind":
        return "skipped_diverged", ["main_sync_skipped_diverged: main_ref_not_fast_forwardable"]
    try:
        git.fast_forward_main()
    except GitAdapterError as error:
        # A race can turn a clean/behind observation into dirty or diverged;
        # preserve main and report the conservative result.
        refreshed = git.observe_main(origin_sha=origin_sha)
        if refreshed.clean is False:
            return "skipped_dirty", [
                f"main_sync_skipped_dirty: {error}",
                *_cleanup_safety_warnings(refreshed.cleanup_safety, scope="main"),
            ]
        return "skipped_diverged", [f"main_sync_failed: {error}"]
    return "updated", warnings


def _start_main_status(main: MainObservation) -> tuple[str, list[str]]:
    if main.worktree is None or main.clean is None:
        return "skipped_diverged", ["main_sync_skipped_diverged: main_worktree_unavailable"]
    if not main.clean:
        return "skipped_dirty", [
            "main_sync_skipped_dirty: main_cleanup_unsafe",
            *_cleanup_safety_warnings(main.cleanup_safety, scope="main"),
        ]
    if main.relation in {"ahead", "diverged"}:
        return "skipped_diverged", ["main_sync_skipped_diverged: main_ref_diverged"]
    return "not_attempted", []


def _audit_record(
    state: AuditState,
    *,
    worktree: GitWorktree | None = None,
    branch: str | None = None,
    clean: bool | None = None,
    cleanup_safety: CleanupSafety | None = None,
    local_sha: str | None = None,
    pull_request: PullRequestObservation | None = None,
    remote_sha: str | None = None,
) -> dict[str, Any]:
    actual_branch = branch if branch is not None else (worktree.branch if worktree else None)
    return {
        "state": state.value,
        "branch": actual_branch,
        "worktree": str(worktree.path) if worktree else None,
        "worktree_head_sha": worktree.head_sha if worktree else None,
        "worktree_clean": clean,
        "ignored_material_count": (
            cleanup_safety.ignored_count if cleanup_safety is not None else 0
        ),
        "special_index_flag_count": (
            cleanup_safety.special_index_count if cleanup_safety is not None else 0
        ),
        "local_sha": local_sha,
        "remote_sha": remote_sha,
        "pr": _pr_payload(pull_request),
        "protected": state != AuditState.MERGED_CLEAN,
    }


def _cleanup_safety_warnings(
    safety: CleanupSafety | None,
    *,
    scope: str,
) -> list[str]:
    """Report only non-secret cleanup-safety classifications and counts."""

    if safety is None:
        return []
    warnings: list[str] = []
    if not safety.status_clean:
        warnings.append(f"{scope}_status_dirty")
    if safety.ignored_count:
        warnings.append(f"{scope}_ignored_material_count:{safety.ignored_count}")
    if safety.special_index_count:
        warnings.append(f"{scope}_special_index_flag_count:{safety.special_index_count}")
    return warnings


def _pr_payload(pr: PullRequestObservation | None) -> dict[str, Any] | None:
    if pr is None:
        return None
    return {
        "number": pr.number,
        "state": pr.state,
        "base_branch": pr.base_branch,
        "head_branch": pr.head_branch,
        "head_sha": pr.head_sha,
        "merged_at": pr.merged_at,
        "merge_sha": pr.merge_sha,
        "head_repository": pr.head_repository,
        "base_repository": pr.base_repository,
        "cross_repository": pr.cross_repository,
    }


def _base_payload(
    operation: str,
    *,
    branch: str | None = None,
    worktree: str | None = None,
    pr: int | None = None,
) -> dict[str, Any]:
    return {
        "operation": operation,
        "branch": branch,
        "worktree": worktree,
        "pr": pr,
        "target_cleanup": "not_attempted",
        "worktree_removed": False,
        "local_branch_deleted": False,
        "remote_branch": None,
        "main_sync": "not_attempted",
        "warnings": [],
    }


def _positive_integer(value: str) -> int:
    try:
        number = int(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError("must be a positive integer") from error
    if number <= 0:
        raise argparse.ArgumentTypeError("must be a positive integer")
    return number


__all__ = [
    "EXIT_OK",
    "EXIT_OPERATION",
    "EXIT_PROTECTED",
    "EXIT_USAGE",
    "build_parser",
    "main",
]


if __name__ == "__main__":  # pragma: no cover - exercised by the shell entry point
    raise SystemExit(main())
