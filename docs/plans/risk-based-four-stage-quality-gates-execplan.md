---
id: risk-based-four-stage-quality-gates
title: Risk-based four-stage quality gates and Deploy impact contract
status: completed
scope: pull-request Deploy impact declaration, registry-backed risk classification, and change-aware CI contract
date: 2026-08-10
source_of_truth: docs/plans/risk-based-four-stage-quality-gates-execplan.md
related_code:
  - scripts/ci/classify_changes.py
  - scripts/ci/classify_event_changes.py
  - scripts/deploy/terminal_profile_registry.py
  - scripts/deploy/terminal-profile-registry.json
  - scripts/deploy/deploy_impact.py
  - .github/workflows/ci.yml
related_docs:
  - docs/guides/ci-branch-protection.md
  - docs/guides/deployment.md
validation: focused contract tests, complete deployment contracts, isolated PostgreSQL/EXPLAIN checks, documentation audit, and hosted PR validation
open_items: []
---

# Risk-based four-stage quality gates

This ExecPlan is a living document and must remain aligned with
`.agent/PLANS.md`. It introduces a small, observable PR contract: a developer
can record what a change would affect, and CI can stop an incomplete or
under-declared table before expensive jobs start. Existing automatic CI
classification remains authoritative, so a safe over-declaration never hides
verification. The behavior is visible by filling the marker-bounded table in a
PR body and observing `change-classification` accept or reject it.

## Purpose / Big Picture

The repository already has four-stage deployment checks, change-aware CI,
readiness, runtime rehearsal, rollback, cleanup, exact artifact identity,
SBOM/attestation, CodeQL, and gitleaks. The missing durable evidence is a
short declaration of Deploy impact. After this change, a pull request with a
missing table, placeholder, unjustified `N/A`, or declaration safer than the
automatic schemaVersion 6 classifier fails in `change-classification`; a
complete declaration passes and leaves all automatic checks unchanged. This
change affects only PR/CI documentation and validation; it does not deploy to
Pi5, Pi4, or Pi3.

## Deploy impact table for this change

| Item | Decision |
| --- | --- |
| Risk | `unknown` because this change includes full-suite CI/deploy paths and must fail closed |
| Target machines | `none` — the registry classifies the changed CI/docs paths as neutral |
| Changed surfaces | `ci`, `deploy`, `docs`, `unknown` |
| Required files/artifacts | Python standard library modules, existing registry, PR template, workflow and docs |
| Database | `no` — no schema, query, migration, or production data change |
| Secrets/config delivery | `no` — validation accepts only secret-free declarations |
| Success evidence | Contract tests, schemaVersion 6 classifier input, full deploy-contract runner, docs audit, hosted PR/main evidence below |
| Rollback/cleanup | Revert the feature commit; local test-owned Docker resources must be zero |
| Production verification | `N/A` — no production runtime target or authorization |

## Branch and worktree

The implementation branch is `feat/risk-based-quality-gates`, created from the
fetched `origin/main` in an independent worktree so the pre-existing dirty
worktree remains untouched. Before any future continuation, verify the branch
and base with:

    git fetch origin main
    git branch --list feat/risk-based-quality-gates
    git status --short --branch
    git rev-parse HEAD
    git rev-parse origin/main

Do not reuse a pre-existing branch with this name, modify
`agent/fix-pi3-recovery-admission-schema`, or run production/GitHub mutation
from this worktree.

## Progress

- [x] (2026-08-10) Audited the current `origin/main`, existing CI classifier, terminal profile registry, branch protection, deployment guide, and cleanup contracts.
- [x] (2026-08-10) Preserved the dirty user worktree and created `feat/risk-based-quality-gates` from `origin/main` in an independent worktree.
- [x] (2026-08-10) Removed the retired `classify-deploy-impact.py` compatibility idea; no historical CLI or execution-closure code is restored.
- [x] (2026-08-10) Kept the target inference helper CLI-free and changed the contract boundary to consume `classify_event_changes.py` schemaVersion 6 JSON directly.
- [x] (2026-08-10) Added the minimal registry-backed profile helper, pure PR table contract, and schemaVersion 6 validator adapter.
- [x] (2026-08-10) Wired PR validation into `change-classification` and support `pull_request.edited` without changing required check names.
- [x] (2026-08-10) Added tests, guide/ADR/rule/index updates, and regenerated document inventory.
- [x] (2026-08-10) Completed local Python suites, Node dependency install, documentation audit, and the complete isolated deployment contract suite.
- [x] (2026-08-10) Fixed the PR-audit NO-GO: the red case was `package.json`/`pnpm-lock.yaml` accepted as docs; focused fixtures now require `unknown` and 18 contract tests are green.
- [x] (2026-08-10) Recorded hosted PR #1232 and main-branch evidence: PR head `d2e73a67a7860b89c377ab1048c24c68c6be6011`, merge/main SHA `eeb27ca0db6d3908936d1f33518901167e30cc32`, PR CI `31343451376`, main CI `31344178115`, CodeQL `31344178134`, Secret scan `31344178120`, and release-set subject digest `sha256:f6693b24a28edcbda1c2c93b8046f914aebc1446828daadb913241e3bd956835`.

## Surprises & Discoveries

- Observation: the historical `scripts/deploy/classify-deploy-impact.py` was
  already deleted on current main together with the terminal coordinator.
  Evidence: `git log --oneline -- scripts/deploy/classify-deploy-impact.py`
  points to the retirement commit, and no current caller exists. The plan was
  corrected before CI/docs wiring so no compatibility CLI was restored.
- Observation: current `classify_changes.py` emits schemaVersion 6, not the
  older version assumed by the initial proposal. Evidence: the source returns
  `"schemaVersion": 6`; validator fixtures for version 5 return input exit 2.
- Observation: the first local Deploy contract attempt lacked Node workspace
  dependencies, but Node 20 plus `pnpm install --frozen-lockfile` resolved the
  missing TypeScript binary. Evidence: the canonical runner then completed
  migration, SQL/EXPLAIN, API, Ansible, runtime, rollback, and cleanup stages.
- Observation: Docker Desktop had pre-existing anonymous volumes. Evidence:
  before/after resource listings contained the same volumes, no containers,
  and only the default bridge/host/none networks; test-owned resources ended
  at zero without touching those volumes.
- Observation: package metadata was a false docs fallback in the first contract
  implementation. Evidence: `package.json` and `pnpm-lock.yaml` are global
  full-suite classifier paths but had no surface mapping, so the old empty-set
  fallback inferred `docs`; the focused red fixture now requires `unknown`.

## Decision Log

- The existing CI classifier remains the authority for selecting jobs. The PR table can only document or over-declare impact; it cannot reduce checks.
- `origin/main` no longer contains the historical `classify-deploy-impact.py`, and the retirement commit removed its execution closure. No compatibility CLI, old fixture, or old schema contract is restored. The validator consumes the current `classify_event_changes.py` JSON (schemaVersion 6) directly; only a minimal registry-backed profile helper is allowed for target-machine inference.
- The PR table is validated only for `pull_request` events. Push, merge-group, schedule, and manual runs retain their existing fail-closed policies.
- No new external quality framework is added. Existing CodeQL, gitleaks, Trivy, OCI/SBOM/attestation, Ansible, Docker, and PostgreSQL contracts remain the verification mechanisms.

- Decision: Use a CLI-free registry helper instead of restoring the retired
  Deploy CLI. Rationale: commit `e2be0459` removed the terminal coordinator
  execution closure and current `origin/main` has no caller; recreating it
  would create a second Deploy authority. Date/Author: 2026-08-10, Codex.

- Decision: Consume `classify_event_changes.py` schemaVersion 6 directly and
  reject old or malformed classifier JSON. Rationale: the current event
  classifier is the single job-selection authority; duplicating its rules
  would allow CI and the PR declaration to drift. Date/Author: 2026-08-10,
  Codex.

- Decision: Add `pull_request.edited` only to `ci.yml`. Rationale: a body-only
  correction needs contract revalidation, while CodeQL and gitleaks can keep
  their existing same-SHA results and required names. Date/Author: 2026-08-10,
  Codex.

- Decision: Infer `docs` only from explicit documentation-owned paths and infer
  `unknown` for all other empty surfaces or non-documentation full-suite
  evidence. Rationale: package metadata, lockfiles, and unclassified paths
  must not pass as docs. Date/Author: 2026-08-10, Codex.

## Validation and recovery

The focused suite must prove missing tables, malformed rows, unjustified N/A values, under-declared risk, missing Pi4/Pi3 targets, migration under-declaration, package.json/pnpm-lock.yaml full-suite paths, and unknown/delete/rename fail closed. Explicit `docs/` and README/Markdown paths are green for docs risk. `.cursor/`, `.agent/`, and PR templates have surface `docs` but actual classifier fail-closed reasons, so their minimum risk is `unknown`. Safe over-declaration and valid Japanese explanations must pass. The validator input fixture is the current `classify_event_changes.py` schemaVersion 6 JSON; no schemaVersion 5 or retired CLI fixture is accepted.

The canonical `scripts/ci/run-deploy-contracts-local.sh` remains the only complete local deployment check. It owns an isolated UUID-named PostgreSQL container, volume, and network, runs migration, SQL, role-boundary, and `EXPLAIN (ANALYZE, BUFFERS)` checks, and must verify cleanup after success or failure. Existing database and containers are never used.

No production SSH, real-device mutation, database migration, or GitHub ruleset mutation was performed. The authorized PR merge and hosted release/runtime checks completed as recorded below; production verification remains `N/A` because this change has no production runtime target.

## Outcomes & Retrospective

- `scripts/ci/deploy_impact_contract.py` is the pure domain module. It parses
  the marker-bounded table, infers risk/surfaces from schemaVersion 6 change
  records, validates target/database/secret declarations, and renders a
  summary. It depends only on the minimal registry helper and standard Python;
  unit tests cover malformed tables, risk/target/database under-declaration,
  fail-closed changes, over-declaration, Japanese explanations, and schema
  rejection.
- `scripts/ci/validate_deploy_impact.py` is the thin I/O adapter. It reads the
  GitHub event and classifier JSON, maps contract/input failures to exit codes
  1/2, and appends the summary. It owns no business rules; validator tests use
  temporary JSON files and verify pull-request and old-schema behavior.
- `scripts/deploy/deploy_impact.py` is a CLI-free, pure registry adapter. It
  maps already-classified paths (including rename/copy sources) to the current
  terminal profiles and the Pi5 server component. Its tests cover neutral,
  server, status-agent, and unknown/rename paths. The retired
  `classify-deploy-impact.py` and terminal coordinator are intentionally absent.
- `.github/workflows/ci.yml` only persists the existing classifier JSON and
  invokes the adapter for pull requests, including `edited`; it does not copy
  risk logic into YAML. Existing `ci-required`, `codeql`, and `gitleaks` names
  remain unchanged. Workflow assertions live in
  `scripts/ci/tests/test_staged_ci_workflow.py`.
- `.github/pull_request_template.md`, the CI guide, ADR, Cursor rule, index, and
  generated inventory are documentation/input boundaries and contain no
  execution logic. The ExecPlan is the implementation record and this
  Outcomes section is the responsibility/dependency/test-boundary summary.
- No database schema/query, public API, inventory runtime, systemd unit,
  production Deploy command, secret value, or existing worktree file changed.
  The canonical contract exercised isolated PostgreSQL migrations,
  migration-ledger checks, SQL fixture + `EXPLAIN (ANALYZE, BUFFERS)`, role
  boundaries, Deploy-status tests, Ansible inventory/playbook syntax, runtime,
  rollback, and cleanup. Existing Docker containers/volumes/networks were
  preserved; test-owned resources ended at zero.

The implementation meets the local and hosted acceptance goals. PR #1232
passed its PR CI (`31343451376`), CodeQL, and Secret scan, then merged with
head `d2e73a67a7860b89c377ab1048c24c68c6be6011` into main as
`eeb27ca0db6d3908936d1f33518901167e30cc32`. Main CI (`31344178115`), CodeQL
(`31344178134`), Secret scan (`31344178120`), release/runtime gates, and the
recorded release-set subject digest all completed successfully. No ruleset was
changed, and production verification is `N/A` because no production runtime
target was in scope. The main lesson is to reuse the current classifier and
static registry at one narrow boundary; a second Deploy engine would have
increased risk without adding evidence.

## Milestones

Milestone 1 is complete when the feature branch is isolated from the dirty
original worktree and this plan records the no-target Deploy impact. Milestone
2 is complete when pure table parsing, schemaVersion 6 inference, registry
target mapping, and exit-code behavior pass focused fixtures. Milestone 3 is
complete when the PR template and `change-classification` connection reject
under-declaration while allowing safe over-declaration and body edits.
Milestone 4 is complete: Python suites, the Node workspace, documentation
inventory, isolated PostgreSQL/EXPLAIN and Ansible contracts, runtime
rehearsal, rollback, cleanup, hosted PR validation, and the authorized main
merge all passed. Production verification is `N/A` because no production
runtime target was in scope.

## Context and Orientation

The repository root is `/Users/tsudatakashi/Documents/Codex/2026-08-10/development-four-stage-quality-gates/worktree`.
`scripts/ci/classify_event_changes.py` collects a GitHub event diff and calls
`scripts/ci/classify_changes.py`, which emits schemaVersion 6 JSON containing
`changes`, statuses, paths, categories, and fail-closed reasons. The existing
workflow stores that JSON in the runner temporary directory and exposes its
boolean outputs to conditional jobs. `scripts/deploy/terminal_profile_registry.py`
reads static path/component/profile data; it is not an execution engine.

The new pure domain module parses the nine-row marker-bounded Markdown table
and compares it with the existing JSON. The thin validator reads the GitHub
event and JSON, then returns exit 0 for success, 1 for a contract mismatch, or
2 for malformed input. A `pull_request` event has a body; all other events
skip body validation and continue using automatic classification.

## Plan of Work

The first milestone protects the dirty original worktree by creating
`feat/risk-based-quality-gates` from `origin/main` in the independent worktree
described above. The first change is this ExecPlan and its Deploy table, which
declares no runtime target, no database, and no secret delivery.

The second milestone adds `scripts/deploy/deploy_impact.py` as a small pure
profile adapter, `scripts/ci/deploy_impact_contract.py` as the domain contract,
and `scripts/ci/validate_deploy_impact.py` as the event/file adapter. It adds
fixtures for missing/duplicate tables, placeholders, unjustified N/A, API or
database under-declaration, missing Pi4/Pi3/Pi5 targets, safe over-reporting,
Japanese explanations, and unknown/delete/rename changes.

The third milestone adds the marker-bounded table to
`.github/pull_request_template.md`, persists the existing classifier JSON, and
invokes validation only inside `change-classification` for pull requests. It
adds `edited` to `ci.yml` without changing `ci-required`, `codeql`, or
`gitleaks` names. The fourth milestone updates the CI guide, ADR, Cursor rule,
index, and generated inventory, then runs all local verification. No public
API, Prisma schema, systemd unit, Ansible inventory, or production command is
changed.

## Concrete Steps

From the independent worktree, confirm the branch and base, then install the
existing workspace dependencies with Node 20:

    export PATH="/opt/homebrew/Cellar/node@20/20.20.2/bin:$PATH"
    pnpm install --frozen-lockfile

Run the pure suites and documentation checks:

    PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s scripts/ci/tests -p 'test_*.py'
    PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s scripts/deploy/tests -p 'test_*.py'
    node scripts/docs/audit-docs.mjs --write
    node scripts/docs/audit-docs.mjs --check
    git diff --check

Run the canonical local Deploy contract from the same worktree. It creates
only UUID-named test resources and removes them on success or failure:

    scripts/ci/run-deploy-contracts-local.sh

Before and after that command, list Docker containers, volumes, and networks.
The before/after sets must preserve pre-existing resources and contain zero
test-owned resources after cleanup. Do not connect to an existing database or
container. The runner verifies migration status and ledger checks, inserts an
SQL fixture, runs `EXPLAIN (ANALYZE, BUFFERS)`, checks production-like role
boundaries, runs Deploy-status tests, validates Ansible inventory/playbook
syntax, exercises runtime and rollback contracts, and verifies cleanup.

## Validation and Acceptance

The focused contract suite must report all tests passing. A body without the
markers, duplicate markers/rows, a placeholder, a bare `N/A`/`no`, a docs
risk for an API path, a missing target, a database `no` for a Prisma path, or
an old schemaVersion 5 JSON must fail. A declaration that includes additional
risk, targets, or surfaces must pass without reducing automatic CI selection.
The current change shape is expected to infer `unknown`, `ci, deploy, docs,
unknown`, and no runtime target; this is intentionally safer than the former
docs fallback because the change contains full-suite CI/deploy paths.

The full local runner ended with successful PostgreSQL integration, Ansible,
runtime, rollback, and cleanup messages. `git diff --check` and the document
audit succeeded. Hosted PR #1232 showed the completed Deploy impact contract
and passed the existing required checks; its head merged into main as
`eeb27ca0db6d3908936d1f33518901167e30cc32`, with main CI, CodeQL, Secret scan,
and release/runtime/security gates passing. Ruleset modification, SSH,
real-device checks, and production Deploy were not performed; production
verification is `N/A`.

## Idempotence and Recovery

The validator is stateless and may be rerun for the same event JSON. The
document audit is deterministic and may be run repeatedly. `pnpm install` is
safe to repeat with the frozen lockfile. If a local contract fails, inspect its
stage, rerun the focused test or runner, and verify cleanup; never bypass a
required check. A code rollback is a normal revert of this feature branch.
The original dirty worktree remains independent and must not be reset,
cleaned, or edited.

## Artifacts and Notes

The important artifacts are the nine-row PR template, the pure contract and
thin validator, the registry helper, the current classifier JSON fixture, the
ADR, the CI guide, the Cursor rule, the index, and the generated inventory.
The implementation was reviewed and merged through PR #1232. No GitHub
ruleset mutation, production Deploy, SSH, database/Vault operation, or
real-device operation was performed.

## Interfaces and Dependencies

The public internal interfaces are:

- `parse_table(body: str) -> dict[str, str]` and
  `assess(declaration, classification) -> ImpactAssessment` in
  `scripts/ci/deploy_impact_contract.py`.
- `main(argv) -> int` in `scripts/ci/validate_deploy_impact.py`, with CLI
  options `--event-path`, `--classification-json`, and optional
  `--markdown-file`.
- `classify_change_records(changes)` in
  `scripts/deploy/deploy_impact.py`, which returns registry components and
  booleans for the server, kiosk, and signage profiles. It has no subprocess,
  Git, network, or deployment side effect.

These modules use only Python's standard library and the existing terminal
profile registry. The workflow is the sole I/O caller. Tests are separated at
the pure parser/inference boundary, the file/event adapter boundary, the
registry mapping boundary, and the existing full deployment contract boundary.

## Revision Note

2026-08-10: corrected the plan after re-auditing current `origin/main`: the
retired Deploy CLI and execution closure are not restored, the old schema
assumption is removed, and the validator consumes schemaVersion 6 directly. A
PR-before audit then found the empty-surface docs
fallback incorrectly accepted package metadata; the implementation now limits
docs to explicit documentation paths and fails other full-suite/uncertain
inputs closed as `unknown`. A second audit confirmed that `.cursor/`, `.agent/`,
and PR-template paths carry actual classifier `unknown path` reasons; their
surface remains docs but risk is unknown. CI (133 tests), focused contract
surface remains docs but risk is unknown. CI (134 tests), focused contract
tests (18), diff check, and docs audit were rerun; Postgres/Ansible contracts
were intentionally not repeated because the fix is pure classification logic.
After authorization, PR #1232 and the main-branch hosted evidence were
recorded above, the plan was marked completed, and production verification was
closed as `N/A`.
