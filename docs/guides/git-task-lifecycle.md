---
title: Git task branch and worktree lifecycle
tags: [Git, worktree, branch, operations]
audience: [developers, AI agents]
status: accepted
related:
  - ../decisions/ADR-20260821-repository-task-lifecycle-automation.md
  - ../../.cursor/rules/20-git-workflow.mdc
  - ../../AGENTS.md
---

# Git task branch and worktree lifecycle

Use the standard-library CLI from the repository root:

```bash
python3 -m scripts.git_lifecycle.cli <command>
```

The CLI operates on one task at a time. It uses Git worktree metadata, Git
refs, and GitHub pull-request data as the source of truth; it does not keep a
task registry.

## Start a task

Observe the repository before creating anything:

```bash
python3 -m scripts.git_lifecycle.cli audit --json
```

Create a task branch and linked worktree from the exact fetched `origin/main`:

```bash
python3 -m scripts.git_lifecycle.cli start --branch feat/<scope>
```

`start` first runs `git fetch --prune origin`. If that fetch or the exact
`origin/main` check fails, it creates nothing. A dirty or diverged main
worktree is left untouched; the command can still create an independent task
worktree and reports `main_sync=skipped_dirty` or
`main_sync=skipped_diverged`. Existing branch or path collisions are kept and
reported rather than overwritten.

## Finish one merged task

After the pull request is merged, pass the exact target worktree path and PR
number:

```bash
python3 -m scripts.git_lifecycle.cli finish \
  --worktree /path/to/repository-worktrees/feat--scope \
  --pr 123
```

The target is eligible only when the following observations agree:

- the PR is merged;
- the PR source is the same repository;
- the PR head branch is the local branch for the target worktree;
- the local branch tip equals the PR head SHA; and
- the target worktree has no ordinary changes or special index flags such as `assume-unchanged` and `skip-worktree`.

Ignored caches and generated files are counted and reported but do not block
cleanup of the disposable worktree. Credentials and other retained secrets
must be stored outside task worktrees.

An eligible target worktree is removed without force, then the matching local
branch is compare-and-deleted against the expected SHA. Dirty targets, open or
unmerged PRs, head-SHA mismatches, and ambiguous ownership remain protected.
The remote branch is not deleted by this command; GitHub's
`deleteBranchOnMerge` setting owns that operation. A lingering remote
tracking ref is reported for later audit.

After target cleanup, `finish` independently evaluates main synchronization:

- `updated`: clean main was fast-forwarded to `origin/main`;
- `already_current`: main already matched the fetched remote;
- `skipped_dirty`: main contains uncommitted changes;
- `skipped_diverged`: main cannot be fast-forwarded safely.

The last two outcomes preserve main and do not turn successful target cleanup
into a failure.

## Audit after completion

Run the read-only audit again:

```bash
python3 -m scripts.git_lifecycle.cli audit --json
```

The audit classifies worktrees and related refs/PRs as
`ACTIVE_OPEN_PR`, `MERGED_CLEAN`, `DIRTY_PROTECTED`, `CLOSED_UNMERGED`,
`NO_PR`, `DETACHED`, `REF_MISMATCH`, or `MISSING_WORKTREE`. Record the PR,
merge SHA, target cleanup result, `main_sync`, warnings, and protected items
in the task completion report.

Do not use wildcard cleanup, `git worktree remove --force`,
`git branch -D`, or direct remote-ref deletion. Existing unfinished branches,
dirty worktrees, and unrelated worktrees are not migration targets for this
lifecycle.

This is an explicitly invoked development-workstation command. It is not a
deploy preflight and must not be called from Ansible, Docker builds, fleet
deployment, Git hooks, or shared CI jobs. Full GitHub PR pagination therefore
runs only when an operator explicitly invokes `audit`. `finish` reads only the
PR number supplied by the operator.
