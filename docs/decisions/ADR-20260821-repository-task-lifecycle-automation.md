---
id: ADR-20260821-repository-task-lifecycle-automation
title: Isolate task worktrees and make merged-task cleanup independent of main state
status: accepted
date: 2026-08-21
source_of_truth: true
scope: Git branch/worktree lifecycle for repository tasks
related_code:
  - scripts/git_lifecycle/policy.py
  - scripts/git_lifecycle/git_adapter.py
  - scripts/git_lifecycle/github_adapter.py
  - scripts/git_lifecycle/cli.py
  - scripts/ci/classify_changes.py
related_docs:
  - ../guides/git-task-lifecycle.md
  - ../../AGENTS.md
  - ../../.cursor/rules/20-git-workflow.mdc
validation: focused policy tests, temporary Git repository integration tests, and read-only repository audit
open_items:
  - GitHub deleteBranchOnMerge setting requires separate repository administration approval
---

# ADR-20260821: Isolate task worktrees and make merged-task cleanup independent of main state

## Status

Accepted for implementation. This decision does not authorize pushing,
merging, repository administration changes, or production deployment.

## Context

The old lifecycle treated the main worktree as a prerequisite for every task.
Unrelated uncommitted files or a local main history that had diverged from
`origin/main` could therefore block creation of a new worktree and cleanup of
an already merged task. That global refusal allowed harmless WIP to create
cleanup backlog, while the task's own branch, worktree, and pull request had
enough evidence for a safe independent decision.

## Decision

Use `python3 -m scripts.git_lifecycle.cli` as the standard entrypoint for
`start`, `audit`, and `finish`.

`start` fetches `origin` and requires the exact fetched `origin/main` before it
creates a task worktree. It never cleans, resets, stashes, or checks out main.
Dirty or diverged main is reported as a warning and does not prevent an
independent worktree from being created; a failed fetch does prevent creation.

`audit` is read-only. It observes worktrees, local and remote-tracking refs,
and related pull requests, then reports stable protection classifications. It
does not infer ownership from a persistent registry and does not delete
anything.

`finish` accepts one exact worktree path and PR number. It requires a merged
same-repository PR, matching head branch and SHA, and a
target with no ordinary changes or special index flags. Ignored caches and
generated files are counted but do not block disposable-worktree cleanup;
credentials remain outside task worktrees.
Only then does it remove that worktree without force and
compare-and-delete the expected local branch. GitHub's merge setting, rather
than a local command, owns remote branch deletion.

Target cleanup completes before an independent main synchronization attempt.
A clean fast-forward updates main; an already-current main is reported as
`already_current`; dirty and diverged main are retained and reported as
`skipped_dirty` and `skipped_diverged`. A skipped main synchronization never
rolls back successful target cleanup. Unsafe or ambiguous target observations
remain protected.

The path `scripts/git_lifecycle` and its tests are owned by the `repo_policy`
CI category. The classifier therefore runs focused policy validation only:
`fullSuite=false`, no deployment target, and no Pi4 agent image matrix.
The CLI is never invoked by deploy, Ansible, Docker build, fleet deployment,
Git hooks, or shared CI preflight; full PR pagination is limited to explicit
development-workstation lifecycle commands.

## Alternatives

Requiring a clean, fast-forwarded main before every task was rejected because
unrelated WIP and divergence are not evidence that the target task is unsafe.
Cleaning or stashing main automatically was rejected because it changes user
state outside the target task. A persistent task registry was rejected because
Git refs, worktree metadata, and PR data already provide the required evidence.
Force deletion and direct remote-ref deletion were rejected because they can
hide unreviewed local changes or bypass GitHub's merge policy.

## Consequences

New tasks and merged-task cleanup can proceed while unrelated main WIP remains
visible and protected. Operators must follow the structured lifecycle commands
and record `main_sync` separately from target cleanup. A stale main that is
reported as skipped remains an explicit follow-up item; it is not silently
treated as synchronized.

## Validation

Focused classifier tests prove that `scripts/git_lifecycle/**` selects only
`repo_policy`. Lifecycle tests must prove exact `origin/main` anchoring,
dirty/diverged-main isolation, fetch-failure refusal, merged-clean target
cleanup, SHA and ownership protection, squash-merge handling, no-force/no
remote-delete behavior, and all `main_sync` outcomes. A read-only audit of the
existing repository must leave unrelated dirty worktrees, branches, and refs
unchanged.

## Supersedes / Superseded By

- Supersedes: implicit main-clean/main-fast-forward prerequisite in the Git workflow rules.
- Superseded by: none.
