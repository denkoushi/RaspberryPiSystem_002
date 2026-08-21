"""Pure lifecycle policy.

This module contains no subprocess, filesystem, or GitHub calls.  Keeping the
eligibility rules here makes the dangerous part of cleanup easy to test and
keeps the adapters focused on observation and mutation.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any, Mapping


class AuditState(StrEnum):
    """Stable classifications emitted by ``audit``."""

    ACTIVE_OPEN_PR = "ACTIVE_OPEN_PR"
    MERGED_CLEAN = "MERGED_CLEAN"
    DIRTY_PROTECTED = "DIRTY_PROTECTED"
    CLOSED_UNMERGED = "CLOSED_UNMERGED"
    NO_PR = "NO_PR"
    DETACHED = "DETACHED"
    REF_MISMATCH = "REF_MISMATCH"
    MISSING_WORKTREE = "MISSING_WORKTREE"


@dataclass(frozen=True)
class PullRequestObservation:
    """The small, non-secret part of a pull request needed by this tool."""

    number: int
    state: str
    base_branch: str | None
    head_branch: str | None
    head_sha: str | None
    merged_at: str | None = None
    merge_sha: str | None = None
    head_repository: str | None = None
    base_repository: str | None = None
    cross_repository: bool | None = None

    @property
    def merged(self) -> bool:
        state = self.state.upper()
        return state == "MERGED" or bool(self.merged_at)

    @property
    def open(self) -> bool:
        return self.state.upper() == "OPEN" and not self.merged

    @property
    def closed_unmerged(self) -> bool:
        return self.state.upper() == "CLOSED" and not self.merged

    @classmethod
    def from_mapping(cls, value: Mapping[str, Any]) -> "PullRequestObservation":
        """Build an observation from either ``gh`` camelCase or Python keys."""

        def get(*names: str) -> Any:
            for name in names:
                if name in value:
                    return value[name]
            return None

        merge_commit = get("mergeCommit", "merge_commit", "merge_commit_sha")
        if isinstance(merge_commit, Mapping):
            merge_sha = merge_commit.get("oid") or merge_commit.get("sha")
        else:
            merge_sha = merge_commit
        number = get("number", "pr")
        try:
            number = int(number)
        except (TypeError, ValueError) as error:
            raise ValueError("pull request number is required") from error
        head = get("head")
        base = get("base")
        head_branch = get("headRefName", "head_branch", "headRef")
        head_sha = get("headRefOid", "head_sha", "headSha")
        base_branch = get("baseRefName", "base_branch", "baseRef")
        head_repository = get("headRepository", "head_repository", "headRepo")
        base_repository = get("baseRepository", "base_repository", "baseRepo")
        if isinstance(head, Mapping):
            head_branch = head_branch or head.get("ref")
            head_sha = head_sha or head.get("sha")
            head_repository = head_repository or head.get("repo")
        if isinstance(base, Mapping):
            base_branch = base_branch or base.get("ref")
            base_repository = base_repository or base.get("repo")
        cross_repository = _optional_bool(
            get("isCrossRepository", "cross_repository", "is_cross_repository")
        )
        normalized_head_repository = _repository_identity(head_repository)
        normalized_base_repository = _repository_identity(base_repository)
        if (
            cross_repository is None
            and normalized_head_repository is not None
            and normalized_base_repository is not None
        ):
            cross_repository = (
                normalized_head_repository.casefold()
                != normalized_base_repository.casefold()
            )
        return cls(
            number=number,
            state=str(get("state") or "UNKNOWN"),
            base_branch=_optional_string(base_branch),
            head_branch=_optional_string(head_branch),
            head_sha=_optional_string(head_sha),
            merged_at=_optional_string(get("mergedAt", "merged_at")),
            merge_sha=_optional_string(merge_sha),
            head_repository=normalized_head_repository,
            base_repository=normalized_base_repository,
            cross_repository=cross_repository,
        )


@dataclass(frozen=True)
class WorktreeObservation:
    """Read-only observation of one registered worktree."""

    path: str
    branch: str | None
    head_sha: str | None
    clean: bool
    detached: bool = False


@dataclass(frozen=True)
class CleanupDecision:
    """Result of the finish precondition policy."""

    eligible: bool
    reasons: tuple[str, ...] = field(default_factory=tuple)


def _repository_identity(value: Any) -> str | None:
    """Normalize gh/REST repository objects to a comparable full name."""

    if value is None:
        return None
    if isinstance(value, Mapping):
        full_name = value.get("full_name") or value.get("nameWithOwner")
        if full_name:
            return str(full_name)
        owner = value.get("owner") or value.get("organization")
        name = value.get("name")
        if isinstance(owner, Mapping):
            owner = owner.get("login") or owner.get("name")
        if owner and name:
            return f"{owner}/{name}"
        if owner:
            return str(owner)
        if name:
            return str(name)
        return None
    text = str(value)
    return text if text else None


def source_repository_matches(pull_request: PullRequestObservation) -> bool:
    """Return whether PR source evidence identifies the same repository.

    Older injected observations may omit both fields; real gh/REST adapter
    observations include them.  A known cross-repository source is never
    eligible for local cleanup.
    """

    if pull_request.cross_repository is True:
        return False
    if pull_request.cross_repository is False:
        return True
    if pull_request.head_repository is None and pull_request.base_repository is None:
        return True
    if pull_request.head_repository is None or pull_request.base_repository is None:
        return False
    return pull_request.head_repository.casefold() == pull_request.base_repository.casefold()


def _optional_string(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value)
    return text if text else None


def _optional_bool(value: Any) -> bool | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().casefold()
        if normalized in {"true", "1", "yes"}:
            return True
        if normalized in {"false", "0", "no"}:
            return False
    return bool(value)


def evaluate_finish(
    pull_request: PullRequestObservation,
    worktree: WorktreeObservation,
    *,
    local_branch: str | None,
    local_sha: str | None,
) -> CleanupDecision:
    """Return whether one exact target is safe to clean up.

    All checks are deliberately conjunctive.  In particular, a clean
    worktree does not compensate for a stale local ref, and a merged PR does
    not compensate for an unrelated branch or worktree.
    """

    reasons: list[str] = []
    if not pull_request.merged:
        reasons.append("pr_not_merged")
    # The base branch is retained as evidence, but is intentionally not an
    # eligibility gate.  A merged stacked PR can be cleaned just as safely as
    # a PR based directly on main when its exact head/ref/worktree evidence
    # matches.
    if not pull_request.head_branch:
        reasons.append("pr_head_branch_missing")
    if not source_repository_matches(pull_request):
        reasons.append("pr_source_repository_mismatch")
    if local_branch != pull_request.head_branch:
        reasons.append("branch_mismatch")
    if worktree.detached or not worktree.branch:
        reasons.append("worktree_detached")
    if worktree.branch != local_branch:
        reasons.append("worktree_branch_mismatch")
    if not worktree.clean:
        reasons.append("worktree_dirty")
    if not pull_request.head_sha:
        reasons.append("pr_head_sha_missing")
    if worktree.head_sha != pull_request.head_sha:
        reasons.append("worktree_head_sha_mismatch")
    if local_sha != pull_request.head_sha:
        reasons.append("head_sha_mismatch")
    return CleanupDecision(not reasons, tuple(reasons))


def classify_observation(
    worktree: WorktreeObservation | None,
    pull_request: PullRequestObservation | None,
    *,
    local_sha: str | None = None,
    local_branch: str | None = None,
) -> AuditState:
    """Classify one worktree/PR pair without performing any I/O.

    The order intentionally protects dirty and detached worktrees before
    interpreting PR state.  A dirty merged worktree must remain protected,
    never be presented as immediately cleanable.
    """

    if worktree is None:
        return AuditState.MISSING_WORKTREE
    if worktree.detached or not worktree.branch:
        return AuditState.DETACHED
    if not worktree.clean:
        return AuditState.DIRTY_PROTECTED
    if pull_request is None:
        return AuditState.NO_PR
    if pull_request.head_branch != worktree.branch:
        return AuditState.REF_MISMATCH
    if local_branch is not None and local_branch != pull_request.head_branch:
        return AuditState.REF_MISMATCH
    if not source_repository_matches(pull_request):
        return AuditState.REF_MISMATCH
    if pull_request.open:
        return AuditState.ACTIVE_OPEN_PR
    if pull_request.closed_unmerged:
        return AuditState.CLOSED_UNMERGED
    if pull_request.merged:
        if (
            not pull_request.head_sha
            or local_sha != pull_request.head_sha
            or worktree.head_sha != pull_request.head_sha
        ):
            return AuditState.REF_MISMATCH
        return AuditState.MERGED_CLEAN
    return AuditState.REF_MISMATCH


def main_sync_decision(
    *,
    clean: bool,
    relation: str | None,
) -> str:
    """Map a main worktree/ref observation to the public sync result."""

    if not clean:
        return "skipped_dirty"
    if relation == "equal":
        return "already_current"
    if relation == "behind":
        return "updated"
    return "skipped_diverged"


__all__ = [
    "AuditState",
    "CleanupDecision",
    "PullRequestObservation",
    "WorktreeObservation",
    "classify_observation",
    "evaluate_finish",
    "main_sync_decision",
    "source_repository_matches",
]
