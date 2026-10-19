# Repository task lifecycle automation

This ExecPlan is a living document. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` current while the work proceeds. This plan follows `.agent/PLANS.md`.

## Purpose / Big Picture

Future repository tasks should start from the current `origin/main` in a canonical linked worktree and should remove exactly their clean local worktree and branch after the corresponding pull request is merged. Unrelated dirty or diverged `main` state must be reported but must not prevent either operation. Existing unfinished branches and worktrees remain untouched.

The user-visible result is a standard-library Python command with `start`, `audit`, and `finish` subcommands. Git and GitHub remain the sources of truth; no task registry, force deletion, remote deletion API, database, service, or deployment component is introduced.

## Progress

- [x] (2026-08-21) Inspected repository rules, current worktrees and branches, GitHub merge settings, CI classifier, and available Git/`gh` contracts.
- [x] (2026-08-21) Created `feat/repository-task-lifecycle-automation` in its canonical dedicated worktree from `origin/main` at `56b6fab76b33d91b8e4ce3282a626eeaf468f177`.
- [x] (2026-08-21) Implemented the policy, Git adapter, GitHub adapter, and CLI.
- [x] (2026-08-21) Added pure and temporary-repository integration tests, including stacked PRs, dirty/diverged main, partial cleanup, PR pagination, branch reuse, fork ownership, and special index flags.
- [x] (2026-08-21) Registered the owned path as `repo_policy` without runtime deploy targets or Pi4 image matrices.
- [x] (2026-08-21) Updated agent rules, ADR, guide, and documentation index.
- [x] (2026-08-21) Ran focused verification and a read-only audit against the real repository; its HEAD, status, worktree count, and branch count were unchanged.
- [x] (2026-08-21) Reviewed the final diff and created the single implementation commit.
- [x] (2026-08-21) Removed implicit `fetch.prune` configuration writes from `start` and limited full PR pagination to explicit `audit` after final review.
- [ ] Publish the amended commit, complete PR/CI/merge, then perform the separately authorized repository-setting and lifecycle acceptance rollout.

## Surprises & Discoveries

- GitHub currently reports `deleteBranchOnMerge=false`; enabling it is deliberately deferred to a separately approved rollout step.
- The repository has no executable worktree lifecycle entrypoint. Existing rules say one task equals one branch/worktree but do not connect PR merge evidence to cleanup.
- `git branch --merged` cannot prove squash-merged pull requests, so exact GitHub PR head metadata is required before local compare-and-delete.
- The repository has 1,270 historical PRs, so `gh pr list --limit 1000` was incomplete. Explicit audits now use REST pagination through the final page.
- Treating every ignored cache as dirty classified 20 of 21 live worktrees as protected. Ignored material is now counted and warned, while ordinary changes and special index flags retain the cleanup gate; credentials remain outside disposable worktrees.
- Historical PRs with no local or remote asset created 1,249 false `MISSING_WORKTREE` records. PRs are now evidence attached only to existing worktree, local branch, or remote-tracking assets.
- `gh pr view` does not support `baseRepository`; the supported `isCrossRepository` field is used for finish ownership evidence, while REST audit records derive the same fact from nested head/base repositories.

## Decision Log

- Decision: use GitHub's native head-branch deletion plus Git/`gh` and a thin Python adapter; do not adopt Git Town, git-flow, hooks, or an unattended sweeper.
  Rationale: those tools either change the branching model, cannot observe GitHub-side merges reliably, or broaden deletion beyond one explicitly identified task.
- Decision: do not store lifecycle state in a registry.
  Rationale: worktree metadata, refs, and PR metadata already contain the required evidence and avoid a second source of truth.
- Decision: main synchronization is an independent post-cleanup result.
  Rationale: unrelated main WIP must not strand a successfully merged clean task.
- Decision: the CLI is explicit development-workstation tooling and is not referenced by deploy, Ansible, Docker build, fleet deployment, hooks, or shared CI preflight.
  Rationale: lifecycle inventory must not add recurring latency to production delivery.

## Context and Orientation

Repository-wide agent instructions live in `AGENTS.md`, `.cursor/rules/20-git-workflow.mdc`, and `.agent/PLANS.md`. CI path ownership is decided by `scripts/ci/classify_changes.py` with contracts in `scripts/ci/tests/`. The new implementation belongs under `scripts/git_lifecycle/` and has no dependency on application, deployment, database, Docker, or device code.

## Plan of Work

Implement immutable observation/result models and pure classification in `policy.py`. Put all subprocess and filesystem interaction behind `git_adapter.py` and `github_adapter.py`. Keep orchestration and stable JSON output in `cli.py`, executable as `python3 -m scripts.git_lifecycle.cli` from the main repository or a linked worktree.

`start` fetches `origin`, validates the requested branch and canonical destination, and creates the worktree directly from `origin/main`. It observes main only to report `already_current`, `updated`, `skipped_dirty`, or `skipped_diverged`; it never needs main to be clean to start the task.

`finish` validates one exact worktree, branch, same-repository PR, and head SHA, then re-observes the target immediately before removal. Ordinary changes and special index flags protect the target; ignored generated material is count-only evidence. It removes the eligible worktree without force and compare-and-deletes the matching local ref. It then independently fast-forwards a clean main when possible or reports why synchronization was skipped. Remote deletion remains GitHub's responsibility. Full PR pagination is reserved for explicit `audit`; `finish` reads only the PR number supplied by the operator.

`audit` performs no writes and classifies every observed worktree. Add deterministic tests using fake command results and temporary Git repositories. Register only `scripts/git_lifecycle` and its tests as `repo_policy`. Document the operating contract and update agent completion rules.

## Concrete Steps

Work from `/Users/tsudatakashi/RaspberryPiSystem_002-worktrees/feat--repository-task-lifecycle-automation`.

1. Add the Python modules and unit/integration tests.
2. Run `python3 -m unittest discover -s scripts/git_lifecycle/tests -p 'test_*.py'` and `python3 -m compileall -q scripts/git_lifecycle`.
3. Update and test CI classification with `python3 -m unittest scripts.ci.tests.test_classify_changes`.
4. Run the CLI's read-only audit against the real common repository and confirm it performs no mutation.
5. Run documentation links/contracts as applicable, `git diff --check`, and a final secret/cache/symlink audit.
6. Create one local commit only after the diff and evidence are complete.

## Validation and Acceptance

Acceptance requires temporary-repository proof that dirty or diverged main does not prevent `start` or cleanup of an independently valid merged task; exact PR/head mismatches and dirty target worktrees remain protected; squash-merged branches are removed only with matching expected SHA; no force or remote deletion command is issued; and unrelated refs/worktrees remain unchanged.

The actual repository audit must classify current unfinished work without changing status, refs, or worktree count. CI classification must select only `repo_policy`, with `fullSuite=false`, no deployment target, and no Pi agent matrix.

## Idempotence and Recovery

`audit` is read-only and repeatable. `start` leaves existing colliding branches or paths untouched. `finish` reports partial safe outcomes: if worktree removal succeeds but the local ref changes before compare-and-delete, it preserves the ref. A failed or skipped main synchronization never rolls back completed target cleanup and never modifies dirty main content.

## Outcomes & Retrospective

The implementation now separates pure policy, Git I/O, GitHub I/O, and CLI orchestration. Focused lifecycle tests pass 39 cases and classification/deploy-impact tests prove repository-policy-only selection with no runtime target. A real read-only audit completed with 16 `MERGED_CLEAN`, 3 `DIRTY_PROTECTED`, 311 `MISSING_WORKTREE`, 200 `NO_PR`, and one `CLOSED_UNMERGED`, while leaving repository state unchanged. The initial branch push occurred before the final review correction arrived; the correction is being folded into the same single commit before PR creation. GitHub `deleteBranchOnMerge` and repository-local `fetch.prune` rollout remain unperformed until the post-merge acceptance step.
