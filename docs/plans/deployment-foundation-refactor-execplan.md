---
id: deployment-foundation-refactor-program
title: Refactor the deployment foundation through eight gated pull requests
status: in-progress
scope: Migration safety, GitHub Actions, release coordination, fleet state, Pi5 Blue/Green, terminal rollout, health verification, rollback, and deployment documentation
date: 2026-07-15
source_of_truth: docs/plans/deployment-foundation-refactor-execplan.md
related_code:
  - scripts/update-all-clients.sh
  - scripts/deploy/rolling-release.py
  - scripts/deploy/pi5-blue-green.sh
  - scripts/deploy/pi5-image-deploy.sh
  - scripts/deploy/pi5-candidate-build.sh
  - scripts/deploy/deploy-status-state.py
  - scripts/deploy/classify-deploy-impact.py
  - scripts/deploy/validate-expand-only-migrations.py
  - infrastructure/ansible/inventory.yml
  - infrastructure/ansible/inventory-talkplaza.yml
  - infrastructure/ansible/playbooks/deploy-staged.yml
  - infrastructure/ansible/tasks/rollback-configs.yml
  - apps/api/src/routes/system/deploy-status.ts
  - .github/workflows/ci.yml
  - .github/workflows/codeql.yml
  - .github/workflows/gitleaks.yml
related_docs:
  - ./rolling-terminal-bluegreen-deploy.md
  - ./pi5-blue-green-phase3.md
  - ../decisions/ADR-20260712-rolling-terminal-release-orchestration.md
  - ../decisions/ADR-20260712-deploy-target-minimization-canary-hold.md
  - ../guides/deployment.md
  - ../runbooks/pi5-blue-green-deploy.md
validation:
  - isolated unit, shell, inventory, Ansible, API, and fault-injection tests
  - hosted GitHub Actions with one stable ci-required aggregate check
  - read-only plans for both production inventories before any approved release
  - one explicitly approved full-fleet acceptance per inventory, followed by a same-SHA no-op plan
open_items:
  - review and merge draft PR 1004 after all required checks pass
  - complete and publish PR 2 and PR 3 from independent origin/main worktrees
  - implement PR 4 through PR 8 only in sequence from the updated origin/main
  - obtain separate per-inventory approval before any production mutation
  - reintroduce the deferred product work only after deployment-foundation production acceptance
supersedes: []
superseded_by: null
---

# Refactor the deployment foundation through eight gated pull requests

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be updated whenever work stops, a pull request changes state, or production evidence changes. Maintain this document in accordance with `.agent/PLANS.md` from the repository root.

The accepted current behavior remains documented in `docs/plans/rolling-terminal-bluegreen-deploy.md`. That plan records prior production evidence and is not rewritten here. This document is the sole active source of truth for the refactor program. Until PR 8 completes, this plan does not supersede the accepted behavior or its historical evidence.

The program baseline is immutable commit `38e72080969631ababc7c595ef67daca067d327f` on `origin/main`. Each implementation pull request starts from the latest merged `origin/main`, not from Draft PR #1003 and not from another unmerged implementation branch.

## Purpose / Big Picture

After this program, an operator will still use `scripts/update-all-clients.sh`, but the command will have one coordinator, one durable release record, one rollback owner, and a small documented option set. A read-only plan will explain why each host is included or excluded. Unknown or unverifiable hosts will be included rather than silently skipped. The Pi5 server will complete its immutable image, configuration, and migration checks before kiosks and signage update one at a time. A release will not remove maintenance mode until the device proves that it is ready at the requested release SHA.

The change is observable without touching production. Pull requests will exercise migration history, locking before checkout, cancellation, inventory-to-playbook consistency, rollback manifests, Blue/Green state, terminal acknowledgements, and CI path classification in isolated tests. `--print-plan` will be read-only and will show target reasons. Production proof comes later, only after hosted CI and read-only plans pass and the user explicitly approves each inventory. The first accepted production run uses `--full-fleet`; a second plan for the same SHA must be a no-op.

This work exists because the current release path has accumulated two coordinators, options with ambiguous behavior, checkout-before-lock races, duplicated health/load decisions, and CI work that runs twice or runs unrelated jobs. The intended outcome is faster feedback and a simpler recovery model without weakening the five-minute Pi5 stability observation, the sixty-second terminal notification, Expand-only database policy, or serial terminal rollout.

## Progress

- [x] (2026-07-14 21:31Z) Recorded the user-approved eight-PR sequence, production freeze, public interfaces, acceptance gates, and PR #1003 supersession policy in this ExecPlan.
- [x] (2026-07-14 21:31Z) Established `origin/main` commit `38e72080969631ababc7c595ef67daca067d327f` as the initial baseline and confirmed that the remote has no `develop` branch.
- [x] (2026-07-14 21:31Z) Published PR 1 as Draft PR #1004, `fix(deploy): restore migration ledger safety`, from `agent/deploy-migration-ledger`; it contains four intentionally scoped commits and remains unmerged pending complete hosted CI and review.
- [ ] (2026-07-14 21:31Z) Complete PR 2 on `agent/ci-deploy-contract-shadow` (completed: workflow and classifier implementation is in progress from the clean baseline; remaining: finish tests, review the diff, run hosted checks, and publish a Draft PR).
- [ ] (2026-07-14 21:31Z) Complete PR 3 on `agent/deploy-safety-contracts` (completed: Talkplaza inventory correction is in progress from the clean baseline; remaining: rollback, lock, cancel contracts, regression tests, review, hosted checks, and Draft PR publication).
- [ ] Merge PR 1, PR 2, and PR 3 in dependency-safe order after their checks pass, refreshing each later branch from the latest `origin/main` without force-pushing PR #1003.
- [ ] Implement and publish PR 4, the single coordinator and execution backend.
- [ ] Implement and publish PR 5, durable fleet state and default target minimization.
- [ ] Implement and publish PR 6, unified Pi5 and terminal executors, health checks, acknowledgements, and rollback.
- [ ] Implement and publish PR 7, conditional CI enforcement and the `main` ruleset.
- [ ] Complete the separately approved production acceptance sequence, including the initial full fleet and the same-SHA no-op proof.
- [ ] Implement PR 8 only after production acceptance, then remove compatibility fallbacks and shorten the deployment and recovery documentation.
- [ ] Reconstruct the deferred product changes as three new pull requests only after deployment-foundation production acceptance.
- [ ] Comment on and close PR #1003 as superseded only after all replacement pull requests are open; retain its source branch until every replacement is merged.

## Surprises & Discoveries

- Observation: `origin/main` is currently `38e72080`, while the mixed Draft PR #1003 contains both deployment and product work. The safe base is therefore `origin/main`, with only named behavior reconstructed or selected commits transplanted.
  Evidence: `git log -1 origin/main` reports `38e72080`; `git show -s` identifies the requested source commits individually.
- Observation: there is no remote `develop` branch even though all three current workflows name it.
  Evidence: `git ls-remote --heads origin develop` returns no ref, while `.github/workflows/ci.yml`, `.github/workflows/codeql.yml`, and `.github/workflows/gitleaks.yml` include `develop` triggers.
- Observation: the requested client lifecycle test does not exist on `origin/main`; its behavior first appears in the later client-lifecycle source changes intended for PR 6.
  Evidence: `rg --files scripts infrastructure apps | rg 'client-agent-lifecycle'` returns no path on the baseline, while commits `85fe6198` and `1f64d5b4` contain the later behavior to reconstruct.
- Observation: the public shell entry point contains a hidden legacy coordinator behind `ROLLING_RELEASE_V2`, so two implementations and two option interpretations coexist.
  Evidence: `scripts/update-all-clients.sh` executes `scripts/deploy/rolling-release.py` only when `ROLLING_RELEASE_V2` is `1`, then retains more than two thousand lines of legacy shell behavior.
- Observation: the current remote command fetches and checks out the target SHA before the remote Python coordinator owns its release lock.
  Evidence: `scripts/deploy/rolling-release.py` builds a remote command containing `git fetch` and `git checkout --detach` before `--remote-run`; the remote-run lock is acquired afterward.
- Observation: Talkplaza places terminals directly under `clients.hosts`, but the staged playbook targets the `kiosk` and `signage` groups.
  Evidence: `infrastructure/ansible/inventory-talkplaza.yml` and the `hosts: kiosk` / `hosts: signage` plays in `infrastructure/ansible/playbooks/deploy-staged.yml` do not currently share a canonical group hierarchy.
- Observation: the service rollback destination removes only a trailing numeric suffix, not the actual `YYYYMMDD_HHMMSS` backup suffix, and it iterates every matching backup.
  Evidence: `infrastructure/ansible/tasks/rollback-configs.yml` uses `regex_replace('\\.[0-9]+$', '')` over every `*.service.*` file sorted by modification time.
- Observation: PR 1 can restore migration safety without importing the unrelated recovery, load-gate, lifecycle, and product behavior in `c5d8a4da`.
  Evidence: Draft PR #1004 contains selected source behavior as commits `e1e4f29b`, `b9b6c7d1`, `4b57a494`, and the focused no-new-migration implementation `a06658fb`.

## Decision Log

- Decision: Deliver the program as eight small, ordered pull requests based on the latest merged `origin/main`.
  Rationale: each safety contract remains reviewable and reversible, and later architecture work cannot hide urgent ledger, CI, or lock corrections.
  Date/Author: 2026-07-15 / User and Codex
- Decision: Freeze ordinary product deployment until the safety foundation passes production acceptance.
  Rationale: mixing new product behavior into a changing deployment path would make failures harder to attribute and increase recovery time.
  Date/Author: 2026-07-15 / User
- Decision: Keep Draft PR #1003 unchanged as a reference; never merge it, force-push it, or delete its branch during replacement.
  Rationale: it is useful provenance, but its mixed history is not a safe integration unit.
  Date/Author: 2026-07-15 / User
- Decision: Preserve `scripts/update-all-clients.sh` as the public entry point and replace its internals with one strict Python coordinator.
  Rationale: operators keep a familiar command while hidden coordinator selection and inconsistent options disappear.
  Date/Author: 2026-07-15 / User
- Decision: Treat uncertainty as deployment scope, not as permission to exclude a host.
  Rationale: a false-positive target costs time; a false-negative target can leave a fleet on incompatible versions.
  Date/Author: 2026-07-15 / User
- Decision: Keep terminal deployment serial, the five-minute Blue/Green stability window, and the sixty-second notice interval.
  Rationale: these are accepted safety and shop-floor behavior; this program removes duplicated work without shortening the observation or operator warning.
  Date/Author: 2026-07-15 / User
- Decision: Defer the hosted client lifecycle test connection from PR 2 to PR 6 because the executable lifecycle contract is absent on the baseline.
  Rationale: inventing a static placeholder, skip, or expected failure in PR 2 would create a green check with no protected behavior. PR 6 must reconstruct the real final behavior and add the test to hosted CI immediately.
  Date/Author: 2026-07-15 / Codex
- Decision: Make the coordinator the only rollback decision-maker and prohibit database down migrations.
  Rationale: nested rollback obscures final state, while rolling a database schema backward can make already-running API versions unsafe. Only backward-compatible Expand-only migrations are allowed.
  Date/Author: 2026-07-15 / User
- Decision: Make `ci-required` the only conditional-CI aggregate required check, while `codeql` and `gitleaks` remain separately required.
  Rationale: path-specific jobs can be skipped legitimately, but the fixed aggregate name gives the ruleset a stable contract.
  Date/Author: 2026-07-15 / User
- Decision: Stop after CI and read-only planning and request explicit approval separately for each inventory before any production mutation.
  Rationale: repository implementation approval does not implicitly authorize changing either physical fleet.
  Date/Author: 2026-07-15 / User

## Outcomes & Retrospective

The program is in progress. The durable outcome so far is a scoped migration-safety Draft PR and an executable sequence that separates urgent repairs from coordinator redesign. No production host, service, database, fleet state, Git checkout, or maintenance flag has been changed by this program.

PR 1 demonstrates the intended integration style: named migration commits were transplanted in order, one narrow behavior was reimplemented instead of cherry-picking a mixed commit, and local migration/Blue-Green tests passed before publication. PR 2 and PR 3 are isolated on independent worktrees so their diffs cannot contaminate PR #1003 or each other.

At each major merge, update this section with the observable behavior delivered, the checks that passed, any time saved or regression found, and the remaining risk. After the seven-day CI observation, compare actual latency and runner-minute evidence against the thresholds in `Validation and Acceptance`. After PR 8, state whether the old marker, lock, and run formats were fully removed and whether the accepted same-SHA plan is a no-op.

## Context and Orientation

The repository is a pnpm monorepo with a Fastify API in `apps/api`, a Web application in `apps/web`, Raspberry Pi client software under `clients`, release scripts under `scripts/deploy`, Ansible inventories and playbooks under `infrastructure/ansible`, and GitHub Actions under `.github/workflows`.

`scripts/update-all-clients.sh` is the operator-facing release command. On the baseline, it normally delegates to `scripts/deploy/rolling-release.py`, but an environment variable can reveal a second large shell coordinator. The Python coordinator resolves a Git revision, remotely checks out the code on the Pi5, optionally performs Pi5 Blue/Green, then updates kiosks and signage. `infrastructure/ansible/playbooks/deploy-staged.yml` applies server, kiosk, and signage roles. The accepted current behavior is one terminal at a time with a canary hold and per-terminal maintenance state.

Two inventories are production-relevant: `infrastructure/ansible/inventory.yml` and `infrastructure/ansible/inventory-talkplaza.yml`. An inventory is an Ansible file that maps host names into groups and supplies connection and role variables. A play targets a group by name. If inventory and playbook group names disagree, a host can be silently omitted even though it has the right role variables.

The Pi5 Blue/Green design runs two named application slots, Blue and Green, behind one gateway. A candidate is built in the inactive slot, checked, switched into service, and observed for five minutes while the old slot remains available. A canary is the first kiosk updated before the remaining terminals. An acknowledgement, abbreviated ACK, is evidence returned by a terminal that it entered or left a release phase. The sixty-second notice is the maintenance message displayed before an update.

An immutable SHA is the full Git commit identifier selected for a release. A migration ledger is the database table and repository directory that together record which schema migrations were applied. A checksum proves that an applied migration file has not changed. Expand-only means a schema change adds compatible structures without removing or redefining structures still needed by the old API. Fail-closed means uncertainty stops the operation or expands its checks and targets; it never silently assumes safety.

A release coordinator decides what to deploy, in what order, and when to stop or roll back. An adapter is a small boundary that translates coordinator decisions into Pi5 or Ansible commands. A transient systemd unit is a run-specific Linux service created with `systemd-run`; systemd records its process and exit state without requiring a permanent unit file. A kernel `flock` is an operating-system file lock released automatically when its owning process exits. The lock must be obtained before any remote fetch or checkout so a later run cannot alter the repository or state of an active run.

Fleet state is the durable JSON record introduced in PR 5. It is not merely a log. It is the sole authority for whether a host is already at a release. Evidence is `verified` only after live Git, service, API/Web image, configuration, migration, and device acknowledgement checks appropriate to that host have passed. Missing, stale, timed-out, unreachable, partially rolled back, or otherwise ambiguous evidence is `unknown` and keeps the host in scope.

PR #1003 is a mixed draft used only as source evidence. The following source commits are named because the program reconstructs their final behavior selectively: `4a5d64a8`, `01999607`, `284e0bc5`, `c5d8a4da`, `19ccd48e`, `99cd44a6`, `85fe6198`, `1f64d5b4`, `de8dcdd7`, and `0f19936a`. Commit-level transplantation is allowed only where a milestone explicitly names it.

## Safety Boundary and Pull Request Discipline

Ordinary product releases remain frozen until the production acceptance in this plan succeeds. Repository tests, hosted CI, fixture-based fault injection, read-only GitHub inspection, and `--print-plan` are allowed. Do not run the deployment command in a mutating mode, execute Ansible against a production host, SSH to change a host, apply a migration to production, toggle maintenance, create production fleet state, or exercise rollback on a real device without the later per-inventory approval.

Each pull request must contain only its milestone. Start it from the latest merged `origin/main`, keep an intentional commit history, run `git diff --check`, and publish it as a draft before review. Do not merge or force-push PR #1003. Do not pull product commit `de8dcdd7` into any of PR 1 through PR 8.

Before a later milestone begins, its prerequisites must be merged or the branch must be demonstrably independent. PR 1, PR 2, and PR 3 may be prepared in parallel from baseline `38e72080` because their owned files and contracts are deliberately separated. PR 4 and later must wait for the applicable earlier merges, then start from the refreshed main branch.

## Plan of Work

### Milestone 1: Restore the migration ledger in PR 1

PR 1 is already published as Draft PR #1004 from `agent/deploy-migration-ledger`. Preserve its focused four-commit structure. The first three commits transplant only source commits `4a5d64a8`, then `01999607`, then `284e0bc5`, in that order. They restore two migration files known to have been applied, teach reconciliation to accept the restored history, and apply pending Expand-only migrations before status is trusted.

The fourth commit reimplements only the `c5d8a4da` behavior that validates every applied migration and checksum even when there are zero new migrations. It must not import the rest of `c5d8a4da`. `scripts/deploy/validate-expand-only-migrations.py` must accept an empty list of new migration paths while still checking the full repository history supplied by the caller. `scripts/deploy/pi5-blue-green.sh` must never return early merely because the candidate introduces no new migration.

Tests in `scripts/deploy/tests/test-pi5-blue-green.sh` must cover a restored applied migration, an applied ledger entry missing from the repository, a checksum mismatch, a non-Expand-only new migration, and a release with zero new migrations. The implementation must never execute a down migration. SQL that is not compatible with the old API must fail before candidate activation.

Acceptance for this milestone is Draft PR #1004 with only migration-related diffs, all hosted checks green, and a reviewer able to trace every imported hunk to the named source behavior. After merge, refresh `origin/main` before basing dependent work.

### Milestone 2: Establish the CI baseline and deploy-contract shadow in PR 2

On branch `agent/ci-deploy-contract-shadow`, change feature, fix, refactor, and chore branch validation from duplicate `push` plus `pull_request` runs to `pull_request` only. Keep full `push` validation on `main`. Remove `develop` from `ci.yml`, `codeql.yml`, and `gitleaks.yml` because the branch does not exist. Preserve manual execution.

Create the pure standard-library classifier at `scripts/ci/classify_changes.py` with tests under `scripts/ci/tests`. It must classify the PR diff and publish the result in the GitHub Actions step summary, but PR 2 must not conditionally skip any existing job. This is shadow mode: classification is observable while the old full PR suite remains authoritative. Record enough output to distinguish docs/root Markdown, API, Web, shared packages, migrations, deployment/Ansible, clients, Docker/security, workflows/CI, unknown paths, and rename/delete events.

Connect the existing `scripts/deploy/tests/test-pi5-image-deploy.sh` to hosted CI. Parse both `infrastructure/ansible/inventory.yml` and `infrastructure/ansible/inventory-talkplaza.yml`, and syntax-check `infrastructure/ansible/playbooks/deploy-staged.yml` in the hosted environment. Do not invent a skipped or static client lifecycle check: that executable behavior does not exist on `origin/main`; PR 6 will add its real test and connect it immediately.

Add an always-present `ci-required` job. It must depend on every current PR job, use `if: always()`, inspect dependency results, and fail if any job unexpectedly failed or was cancelled. In shadow mode all existing jobs still run, so a skipped result is unexpected unless the workflow itself explicitly documents it. The check name must remain exactly `ci-required` from this PR onward.

Simplify CodeQL to the official JavaScript/TypeScript analysis flow. Remove the pnpm workspace setup, Prisma generation, API build, Web build, and explicit package builds that do not contribute to CodeQL extraction. Name the job exactly `codeql`, with no matrix suffix in the required-check name. Keep `gitleaks` named exactly `gitleaks`.

Acceptance is one PR run, not a branch-push duplicate, with classifier output in Summary, every pre-existing job still executed, deploy-contract checks executed on a hosted runner, and fixed check names `ci-required`, `codeql`, and `gitleaks`.

### Milestone 3: Repair critical safety contracts in PR 3

On branch `agent/deploy-safety-contracts`, change `infrastructure/ansible/inventory-talkplaza.yml` so `clients.children.kiosk` and `clients.children.signage` are the canonical terminal groups. The coordinator, both inventories, and `deploy-staged.yml` must select the same group names. Add a fixture-based regression that proves every release target belongs to exactly one actual play group and no release host is lost or duplicated.

Correct `infrastructure/ansible/tasks/rollback-configs.yml` so service restoration selects only the newest backup belonging to the current run. Strip exactly one `YYYYMMDD_HHMMSS` suffix from the backup basename to reconstruct the original `.service` filename. Do not loop over historical backups. Tests must use real-looking names such as `kiosk-browser.service.20260715_063000` and prove that the destination is `/etc/systemd/system/kiosk-browser.service`.

Move the remote non-waiting kernel `flock` ahead of every Pi5 `git fetch`, `git checkout`, and release-state mutation. A later run must fail immediately and must leave remote HEAD, state files, and services unchanged. Use an isolated temporary Git repository and stubbed adapters to prove two concurrent runs cannot both reach checkout.

Add an internal cooperative cancel contract now, even though PR 4 exposes the final public `--cancel` CLI. Every phase must check cancellation before a mutating transition. A run already marked for cancellation must not fetch or check out a new revision. A regression must snapshot HEAD, request cancellation, execute the runner, and prove HEAD is identical afterward.

Acceptance is passing inventory/playbook consistency, exact backup-name, concurrent-run, and cancel-with-unchanged-HEAD tests. No test may require an actual Raspberry Pi or production inventory connection.

### Milestone 4: Replace the dual coordinator with one coordinator and execution backend in PR 4

Reduce `scripts/update-all-clients.sh` to argument-preserving setup followed by strict `exec` into the Python coordinator. Delete the more-than-two-thousand-line legacy implementation and remove `ROLLING_RELEASE_V2`; there must be no hidden path capable of selecting a second coordinator.

Keep `scripts/deploy/rolling-release.py` as the compatible Python entry point, but move implementation into a `scripts/deploy/rolling_release/` package. Separate the CLI parser, plan and policy decisions, durable state and locking, and execution adapters. Suggested modules are `cli.py`, `planner.py`, `policy.py`, `state.py`, `lock.py`, `backends/pi5.py`, and `backends/ansible.py`. Policy modules return decisions and reasons; adapters execute commands but do not decide scope or rollback.

Unify remote execution around one transient systemd unit named from the run ID. The unit must own the non-waiting `flock`, then fetch and check out the immutable SHA, then `exec` the Python remote runner. A normal invocation starts the unit and waits for terminal state. `--detach` returns the run ID after systemd accepts the unit. `--status`, `--approve`, and `--cancel --reason` read both the unit state and release state so a crashed process cannot look successful.

Reject `--follow`, `--foreground`, `--profile`, `--job`, and `--attach` with exit status 2 and a concise replacement. Omitting `--foreground` is the replacement for foreground behavior; `--detach` replaces `--job`; `--status RUN_ID` replaces `--follow` and `--attach`; normal GitHub Actions and systemd timing replace the unsupported profile mode. There must be no compatibility fallback that silently accepts these options.

Allow `--skip-canary-hold` only when `--emergency-override --reason TEXT` is also present. Validate this before contacting a remote host. Cancellation must be cooperative: record the reason, signal the unit through the defined cancellation boundary, and let the coordinator stop between phases without a fetch, checkout, direct lock deletion, or untracked kill procedure.

Acceptance includes CLI contract tests for every retained and retired option, systemd command construction, foreground wait, detached run ID, status reconciliation, approval, cancellation reason, emergency override, and proof that the shell contains no `ROLLING_RELEASE_V2` or legacy coordinator body.

### Milestone 5: Introduce durable fleet state and make minimization standard in PR 5

Create `logs/deploy/fleet-release-state.json` as the only release-decision source of truth. The persisted schema has top-level `generation`, `activeRun`, `lastRun`, and `fleet`. `generation` is a monotonically increasing integer used to reject stale writers. `activeRun` is either null or the current run summary. `lastRun` retains the most recently terminal run. `fleet` maps inventory host names to evidence.

Every host record contains `role`, `desiredSha`, `currentSha`, `previousSha`, `evidence`, `verifiedAt`, and `lastRunId`. The Pi5 record additionally contains `activeSlot`, `apiImage`, `webImage`, `configDigest`, and `migrationDigest`. Use atomic temporary-file replacement under the common fleet lock. Only live verification may set `evidence` to `verified`. Unreachable hosts, timeouts, interrupted runs, partial success, and failed rollback must set or retain `unknown`.

Seed state only for a host whose live Git HEAD and required services were checked. For the Pi5, also check the active Blue/Green slot, API/Web image identities, configuration digest, migration digest, and authenticated readiness. Never seed from inventory declarations, old log text, or an assumed branch. `--print-plan` is strictly read-only and must not create or update the fleet state file.

Make target minimization the default. Exclude a host only when its durable evidence is `verified` for the desired release and role-specific digests. Add `--full-fleet` to force every inventory host into scope. Keep `--auto-minimize` temporarily as a warning-emitting alias for default behavior; remove it after successful production acceptance in PR 8. Do not transplant `--client-only-compatible` from PR #1003. If a Pi5-required difference is present and `--limit` excludes Pi5, fail closed before execution.

During the compatibility interval, dual-write the old Pi5 release marker and old run snapshot after the new state write succeeds. Reads prefer the new fleet state and use legacy data only through an explicit compatibility adapter. Pi4 recovery must acquire the same fleet lock and update the same fleet state so recovery cannot race a release.

Acceptance includes tests for an unknown baseline, verified exclusion, no-op planning, partial success, timeout, rollback success and failure, crash between atomic writes, reboot with `activeRun`, stale generation, and print-plan non-mutation. A same input and same observed state must produce the same ordered plan and reasons.

### Milestone 6: Unify Pi5 and terminal execution, health, acknowledgements, and rollback in PR 6

Split Pi5 execution into four explicit coordinator stages: host configuration convergence, migration plan, candidate image build, and Blue/Green switch. Ansible configuration changes to the server are not satisfied merely because an image changed. Each stage records evidence that the next stage consumes.

Move migration guarding under the coordinator and leave exactly one implementation. Reconstruct the final Pi5 behavior from `c5d8a4da`, `19ccd48e`, and `99cd44a6`; do not cherry-pick any of those commits as a unit. Preserve the migration ledger work already merged from PR 1, first-signage control behavior, and the image dependency-cache behavior without importing unrelated code.

Reconstruct the final client lifecycle behavior from `c5d8a4da`, `85fe6198`, and `1f64d5b4`, again at behavior level rather than commit level. Add `scripts/deploy/tests/test-client-agent-lifecycle-selection.py` or an equivalently named executable contract and connect it to hosted CI in this PR. The test must prove that agent changes are classified before repository synchronization destroys the previous-diff evidence and that only the intended client lifecycle runs.

Record the post-candidate-build load evidence and let Phase 3 reuse it. This removes one duplicate load wait and should reduce the load-gate portion from roughly 120 seconds to roughly 80 seconds. Do not shorten the five-minute post-switch stability observation or the sixty-second terminal notice.

Remove automatic rollback from inside Ansible blocks. Before changing a host, write a run-specific manifest that records every source, destination, and checksum. The coordinator alone decides rollback and restores only entries from that manifest. A successful rollback sets observed evidence from a fresh health check; a failed or unverifiable rollback sets the host to `unknown` and stops later terminals.

Terminal health requires the expected remote Git HEAD, every required systemd service active, and an authenticated endpoint that returns success. HTTP 401 is failure. An Ansible task using `failed_when: false` may collect diagnostics but cannot contribute successful release evidence.

Extend the existing deploy-status GET response backward-compatibly with a `verifying` phase and `desiredReleaseSha`. Keep all existing fields. Extend ACK handling so existing notice and maintenance acknowledgements continue to work, but a `ready` ACK requires `releaseSha`. A kiosk returns the loaded Web bundle SHA. Signage returns its updated repository SHA. The coordinator removes maintenance only when the ACK SHA equals the desired immutable SHA and terminal health passes.

The Pi5 database is never rolled back. Migration planning accepts only schema changes compatible with the old API during the Blue/Green overlap. Any incompatible SQL stops before candidate activation.

Acceptance includes Pi5 image/config/migration identity, lifecycle selection, manifest-only rollback, Kiosk bundle ACK, signage SHA and endpoint, active services, 401 rejection, mismatched release ACK, timeout, load-evidence reuse, and unchanged five-minute/sixty-second timing tests.

### Milestone 7: Enforce staged CI and configure the GitHub ruleset in PR 7

Promote the PR 2 classifier from shadow output to job selection. PRs run `workspace-quality`, API, Web, DB/infra, deploy-contract, client, E2E, and Docker/security jobs in parallel according to the changed paths. A docs-only change limited to `docs/**` and root Markdown runs only repo-policy checks. Shared packages select all consumers that import them.

Unknown paths, renames, deletions, workflow files, action definitions, and CI classifier changes select the full suite. This is fail-closed because an unclassified build input is more dangerous than extra CI time. Tests must feed the classifier docs, API, Web, shared, migration, deploy, Docker, workflow, unknown, rename, and delete fixtures and assert exact job sets.

On pull requests, the API job runs the complete API test set without coverage. On `main` push and the daily schedule, run coverage in three shards. A `push` to `main`, `merge_group`, `workflow_dispatch`, and the daily schedule at 02:30 JST always run the full suite regardless of paths. Express 02:30 JST as 17:30 UTC in the cron schedule and note the timezone in a comment.

Conditional jobs are not required checks. The fixed `ci-required` aggregate evaluates every selected result and is the only CI aggregate required by the ruleset. Keep `codeql` and `gitleaks` as separate fixed-name required checks.

First prove a representative PR has successful `ci-required`, `codeql`, and `gitleaks` checks. Then configure the `main` ruleset to require a pull request with zero required approvals, require those three checks, prohibit force-push and branch deletion, and leave “branch must be up to date” disabled. Record the ruleset response or screenshot reference in this plan, but do not duplicate it into the deployment guide.

Acceptance is exact classifier-fixture behavior, no duplicate PR runs, full main/merge-queue/manual/scheduled runs, stable required names, and a read-back of the enabled ruleset matching the stated policy.

### Milestone 8: Complete migration and reduce documentation after production acceptance

Do not begin compatibility removal until the explicitly approved full-fleet acceptance has succeeded and the same-SHA standard plan is a no-op. Then remove reads and writes for the old Pi5 marker, old deployment lock, and old run format. Remove the temporary `--auto-minimize` alias. Keep only the fleet lock, fleet state, transient unit, and public CLI documented here.

Reduce `docs/guides/deployment.md` to the current operator procedure and move historical deployment evidence to month-based archives. Update recovery documentation to remove direct process kills, direct lock deletion, and retired CLI forms. Recovery uses `--status` and cooperative `--cancel --reason` only. Align architecture documents, `AGENTS.md`, and quick-start instructions to the same command forms and state transitions.

PR 8 must not erase accepted evidence from `docs/plans/rolling-terminal-bluegreen-deploy.md`; archive or link it as historical context. Update this plan’s `supersedes` metadata only when the old behavior is actually retired, and set `superseded_by` only if a later source replaces this plan.

Acceptance is a repository search with no legacy option, marker, lock, or run-format fallback outside historical archives; valid Markdown links; a short current deployment guide; and recovery instructions that cannot tell an operator to kill a process or delete a lock manually.

### Reintroduce product changes after the safety program

After production acceptance, reconstruct product commit `de8dcdd7` as three reviewable pull requests: first shared UI extraction, second assembly schema/API/editor behavior, and third deploy-notice placement. Do not cherry-pick `de8dcdd7`. Do not transplant PR #1003 progress-log commits or `0f19936a`.

When every replacement pull request for the deployment and product work is open, comment on PR #1003 with a mapping from its source behaviors to replacement PRs and close it as superseded. Do not merge or force-push PR #1003. Keep the source branch until all replacement PRs are merged so reviewers can still inspect provenance.

## Concrete Steps

Run repository commands from the repository root unless a command says otherwise. Use a separate clean worktree for every pull request. Never reuse the original PR #1003 worktree for implementation.

Inspect the baseline and the current published PR 1:

    git fetch origin main
    git rev-parse origin/main
    gh pr view 1004 --repo denkoushi/RaspberryPiSystem_002
    gh pr checks 1004 --repo denkoushi/RaspberryPiSystem_002

Expect the baseline to begin at `38e72080969631ababc7c595ef67daca067d327f` for this plan revision and PR #1004 to be open as a draft. If `origin/main` has advanced, do not reset it; use the new tip for the next unstarted milestone and record the SHA in `Progress`.

Validate PR 1 from its clean worktree or checked-out branch:

    git diff --check origin/main...HEAD
    bash -n scripts/deploy/pi5-blue-green.sh
    python3 -m py_compile scripts/deploy/validate-expand-only-migrations.py
    bash scripts/deploy/tests/test-pi5-blue-green.sh

Expect syntax checks to exit zero and the shell test to print `PASS: pi5 blue/green safety lifecycle`. Remove generated ignored bytecode before committing if the test environment creates it. Do not run Prisma against a production database.

Validate PR 2 before publication:

    python3 -m unittest discover -s scripts/ci/tests -p 'test_*.py'
    bash scripts/deploy/tests/test-pi5-image-deploy.sh
    python3 -m py_compile scripts/ci/classify_changes.py
    bash -n scripts/update-all-clients.sh
    git diff --check origin/main...HEAD

In the hosted workflow, also run `ansible-inventory --list` for each inventory and `ansible-playbook --syntax-check` for `playbooks/deploy-staged.yml` under the vault-disabled CI configuration. Expect both inventories to parse, the playbook to parse for both, and Summary to show classification without skipping the full suite.

Validate PR 3 with isolated fixtures:

    python3 -m unittest scripts/deploy/tests/test_inventory_playbook_contract.py
    python3 -m unittest scripts/deploy/tests/test_rollback_configs.py
    python3 scripts/deploy/tests/test_rolling_release.py
    bash -n scripts/update-all-clients.sh
    git diff --check origin/main...HEAD

If the final test filenames differ, record the exact replacements in this section before merge. The tests must execute the four named behaviors; a static text-only assertion is insufficient for lock, cancel, and rollback behavior.

For PR 4 through PR 6, keep one common fast contract suite and add milestone-specific tests:

    python3 -m unittest discover -s scripts/deploy/tests -p 'test_*.py'
    bash scripts/deploy/tests/test-pi5-image-deploy.sh
    bash scripts/deploy/tests/test-pi5-blue-green.sh
    bash scripts/deploy/tests/test-signage-deploy-maintenance.sh
    bash -n scripts/update-all-clients.sh
    git diff --check origin/main...HEAD

Run the client lifecycle executable contract from PR 6 explicitly:

    python3 scripts/deploy/tests/test-client-agent-lifecycle-selection.py

Expect it to exit zero and prove behavior with fixture repositories; it must not contact a terminal.

For PR 7, exercise classifier event and path fixtures locally, then inspect one representative hosted PR:

    python3 -m unittest discover -s scripts/ci/tests -p 'test_*.py'
    gh pr checks <representative-pr-number> --repo denkoushi/RaspberryPiSystem_002

Do not enable the ruleset until that output contains successful checks named exactly `ci-required`, `codeql`, and `gitleaks`. After enabling it, read the ruleset back through GitHub and compare every setting with Milestone 7.

Before PR 8, execute the production acceptance sequence in `Validation and Acceptance`. This is not authorized by creation or merge of this plan. Stop after the two read-only plans and request explicit approval for `infrastructure/ansible/inventory.yml`, then separately for `infrastructure/ansible/inventory-talkplaza.yml`.

At every stopping point, update `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective`, then run documentation checks:

    git diff --check
    git diff -- docs/plans/deployment-foundation-refactor-execplan.md docs/INDEX.md
    rg -n '\?\?\?' docs/plans/deployment-foundation-refactor-execplan.md docs/INDEX.md
    awk 'length($0) > 1000 { print FNR ":" length($0) }' docs/plans/deployment-foundation-refactor-execplan.md docs/INDEX.md

The corruption and long-line commands must print nothing for added lines. Validate every changed relative Markdown link before committing.

## Validation and Acceptance

Repository acceptance is cumulative. Migration tests prove restored history, missing history, checksum mismatch, Expand-only rejection, and zero-new validation. Lock and state tests prove lock-before-checkout, concurrent runs, crash/reboot, cancellation in every phase, partial success, timeout, successful rollback, failed rollback, and an unknown baseline. Inventory tests prove every release target belongs to exactly one real play group. Health tests prove Pi5 image/config/migration identity, Kiosk bundle ACK, signage SHA and authenticated endpoint, and active required services. CLI tests prove retained forms, exit 2 for retired forms, and absence of a hidden fallback. CI tests prove exact classification for docs, API, Web, shared, migration, deploy, Docker, workflow, unknown, rename, and delete inputs.

Production acceptance must occur in this order:

1. Confirm a clean release worktree and successful `ci-required`, `codeql`, and `gitleaks` for the immutable target SHA.
2. Run `--print-plan` for `infrastructure/ansible/inventory.yml` and `infrastructure/ansible/inventory-talkplaza.yml`. Confirm target reasons and confirm that every unknown host remains included. These calls may read live evidence but must not create state or mutate a host.
3. Stop and obtain explicit approval for each inventory. Approval for one inventory does not authorize the other.
4. For the first accepted run only, use `--full-fleet` and preserve the order Pi5, canary, remaining terminals one at a time.
5. Confirm every host has `evidence=verified`, Pi5 image and configuration digests match, no maintenance state remains, and the database migration ledger and checksums match the repository.
6. Run the standard plan for the same SHA and observe a no-op with every exclusion explained by verified evidence.
7. Do not inject a failure or deliberately roll back in production. Prove those paths only in an isolated fixture or lab environment.

During the seven days after CI enforcement, acceptance targets are zero duplicate workflow runs, docs-only completion within two minutes, deploy-only completion within four minutes, API/Web pull requests within six minutes, a `main` full-suite median within nine minutes, and at least a forty-five percent reduction in runner minutes per pull request. Measure completed workflow runs, not anecdotal wall-clock observations.

If even one main-only failure is caused by a missed path classification, disable only the conditional job expressions so pull requests return to the full suite. Keep duplicate-trigger removal and the fixed required checks. Add the missed path as a failing classifier fixture before re-enabling conditions.

The program is complete only when PR 8 is merged, production evidence meets the sequence above, the same-SHA plan is a no-op, the seven-day CI window meets or explicitly rolls back its conditional selection, and PR #1003 is closed with a complete replacement map.

## Idempotence and Recovery

All read-only plans and fixture tests must be safe to repeat. `--print-plan` never creates fleet state. State writes use a generation check, the fleet lock, a temporary file, `fsync` where supported, and atomic replacement. After interruption or reboot, `activeRun`, the transient systemd unit, and observed host evidence determine whether to resume, cancel, or mark the run interrupted; a stale PID or manually deleted lock is never the authority.

The kernel lock is process-owned and non-waiting. If it is held, a later run exits before fetch, checkout, or state change. If its process dies, the kernel releases it. Never recover by deleting the lock path while an owner may exist. Never recover by force-checking out a branch over an active run.

Database migration recovery is forward-only. Restoring a missing repository migration file is safe only when its checksum matches the already-applied ledger. A missing or changed applied migration stops the release. Do not issue a down migration. If an Expand-only candidate fails before activation, fix the repository or add a new forward migration.

Terminal rollback is run-manifest scoped. Repeating rollback reads the same manifest and verifies checksums; it does not select a newer-looking global backup. A rollback failure leaves evidence `unknown`, retains maintenance as appropriate, and stops the rollout. Pi5 rollback switches compatible API/Web images but never reverses the database.

Git recovery preserves work. Do not use force-push, hard reset, or checkout to discard another worktree’s changes. If a pull request must be rebased after earlier merges, prefer a new branch or a normal merge/update that preserves review history; never rewrite PR #1003.

If CI conditional selection is unsafe, use the documented full-PR-suite fallback. If the production release cannot establish verified evidence, stop, record the run as failed or interrupted, and leave uncertain hosts in scope for the next approved plan.

## Artifacts and Notes

Current replacement map at this revision:

    PR 1 / #1004:
      4a5d64a8 -> e1e4f29b
      01999607 -> b9b6c7d1
      284e0bc5 -> 4b57a494
      c5d8a4da migration-only behavior -> a06658fb
    PR 2: CI baseline and deploy-contract shadow (in progress)
    PR 3: inventory, rollback, checkout lock, and cancel safety (in progress)
    PR 4-PR 8: pending prior merge gates
    Product reconstruction: pending deployment-foundation production acceptance

An example fleet state shape is:

    {
      "generation": 12,
      "activeRun": null,
      "lastRun": {
        "runId": "20260715-063000-a1b2c3",
        "status": "success",
        "desiredSha": "0123456789abcdef0123456789abcdef01234567"
      },
      "fleet": {
        "raspberrypi5": {
          "role": "server",
          "desiredSha": "0123456789abcdef0123456789abcdef01234567",
          "currentSha": "0123456789abcdef0123456789abcdef01234567",
          "previousSha": "89abcdef0123456789abcdef0123456789abcdef",
          "evidence": "verified",
          "verifiedAt": "2026-07-14T21:30:00Z",
          "lastRunId": "20260715-063000-a1b2c3",
          "activeSlot": "green",
          "apiImage": "raspisys-api:0123456789ab",
          "webImage": "raspisys-web:0123456789ab",
          "configDigest": "sha256:example-config",
          "migrationDigest": "sha256:example-migrations"
        }
      }
    }

Actual state must use complete calculated digests, not the illustrative values above. Host records for kiosks and signage omit Pi5-only fields but retain the common fields.

An example read-only plan should explain inclusion rather than only listing hosts:

    {
      "desiredSha": "0123456789abcdef0123456789abcdef01234567",
      "fullFleet": false,
      "targets": [
        {"host": "raspberrypi5", "reason": "migration digest differs"},
        {"host": "raspi4-kensaku-stonebase01", "reason": "evidence unknown"}
      ],
      "excluded": [
        {"host": "raspberrypi3", "reason": "verified at desired SHA"}
      ]
    }

The PR #1003 supersession comment must map each retained behavior to a replacement PR, name intentionally omitted progress-only commits and `0f19936a`, link the three product reconstruction PRs, state that #1003 was not merged, and explain that its source branch remains until all replacements merge.

## Interfaces and Dependencies

The supported public CLI at the end of PR 5 is exactly:

    update-all-clients.sh <branch> <inventory> [--limit PATTERN] [--full-fleet] [--detach]
    update-all-clients.sh <branch> <inventory> --print-plan
    update-all-clients.sh --status RUN_ID
    update-all-clients.sh --approve RUN_ID
    update-all-clients.sh --cancel RUN_ID --reason TEXT

A normal invocation without an execution-mode option waits in the foreground. `--dry-run` remains an alias for `--print-plan`. `--skip-canary-hold` is accepted only together with `--emergency-override --reason TEXT`. The retired `--follow`, `--foreground`, `--profile`, `--job`, and `--attach` forms return exit status 2 and print their replacement. There is no `--client-only-compatible` interface.

Status retains terminal values `success`, `failed`, `cancelled`, and `interrupted`. It adds each host’s desired SHA, current SHA, evidence, and target reason. Intermediate phases may include `planning`, `waiting-approval`, `preparing`, `verifying`, `rolling-back`, and `cancelling`, but they must not be mistaken for terminal success.

Deploy-status GET keeps its existing response fields and adds `verifying` phase support plus `desiredReleaseSha`. Existing notice and maintenance ACK payloads remain valid. A `ready` ACK requires `releaseSha`; readiness without it is invalid. The Kiosk value represents the loaded Web bundle SHA, while signage represents its updated repository SHA.

The coordinator depends on Python 3 standard-library code for policy and JSON state, Linux `flock`, systemd transient units, Git, SSH, Ansible, Docker Compose, and the existing authenticated API health surface. Policy code must not shell out. Execution adapters own subprocess calls and return structured results. Tests replace SSH, systemd, Docker, Ansible, HTTP, time, and filesystem boundaries with fixtures.

GitHub Actions exposes fixed checks `ci-required`, `codeql`, and `gitleaks`. `ci-required` is the conditional-job aggregate. The ruleset does not require conditional job names and does not require the branch to be up to date.

## Local Notes JA

- 「通常のproductデプロイは安全基盤の本番検証完了まで凍結」を継続する。計画書やPRの承認は、実機変更の承認ではない。
- 「根拠不明hostは必ず対象に含める」。`unknown` を除外理由にしない。
- 端末デプロイは「1台ずつ」。Pi5の5分安定化と端末の60秒通知は短縮しない。
- `--print-plan` 後に停止し、「inventoryごとに明示承認」を受ける。第2工場の承認をTalkplazaへ流用しない。
- 本番で「故障注入」や「意図的rollback」は実施しない。隔離テストで確認する。
- PR #1003 は参照用に残し、merge・force-pushしない。置換PR対応表をコメントしてから `superseded` としてcloseする。

Revision note (2026-07-15): Created the sole active ExecPlan for the approved eight-PR deployment-foundation refactor. It records Draft PR #1004, the in-progress PR 2 and PR 3 branches, the missing baseline client-lifecycle test and its PR 6 deferral, the `38e72080` baseline, the absent `develop` branch, and the explicit prohibition on real-device actions before per-inventory approval.
