"""Safe Git branch and worktree lifecycle helpers.

The package deliberately keeps GitHub and Git I/O behind adapters.  The
command line entry point is available with::

    python3 -m scripts.git_lifecycle

No state is persisted by this package; Git refs, worktrees, and pull requests
remain the sources of truth.
"""

from .policy import (
    AuditState,
    CleanupDecision,
    PullRequestObservation,
    WorktreeObservation,
    classify_observation,
    evaluate_finish,
    main_sync_decision,
    source_repository_matches,
)

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
