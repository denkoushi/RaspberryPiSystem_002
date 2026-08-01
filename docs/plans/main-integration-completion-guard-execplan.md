---
title: Main Integration Completion Guard ExecPlan
status: complete
scope: repository completion policy and rolling-release integration evidence
date: 2026-08-01
source_of_truth: this file
related_code:
  - AGENTS.md
  - .agent/PLANS.md
  - scripts/deploy/rolling-release.py
  - scripts/deploy/rolling_release/application.py
related_docs:
  - docs/AI_START_HERE.md
  - docs/guides/deployment.md
validation: passed
open_items: []
---

# Make main integration a mandatory completion check

This ExecPlan is a living document maintained according to `.agent/PLANS.md`. It must keep `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` current while the work proceeds.

## Purpose / Big Picture

An implementation can be cleanly committed, pushed, and even verified in production from a feature branch without being merged into `main`. That distinction was previously reported incorrectly. After this change, every rolling-release plan and status result will state whether the candidate and observed production commits are contained in `origin/main`. Repository instructions will prohibit calling an implementation complete while that integration check is pending or unavailable.

Feature-branch production verification remains possible. A release may succeed operationally while its separate repository-completion state remains blocked. The observable result is a stable JSON contract containing the source SHA, `origin/main` SHA, production SHA set, ancestry results, `integrationPending`, and `completionEligible`.

## Progress

- [x] (2026-08-01) Read repository instructions, the deployment guide, rolling-release planner/application/state boundaries, and existing test contracts.
- [x] (2026-08-01) Confirmed clean synchronized `main` at `da8a4506` and created `feat/main-integration-completion-guard`.
- [x] (2026-08-01) Added a pure, reusable main-integration audit model with fail-closed unknown handling and seven model tests.
- [x] (2026-08-01) Added the audit to `--print-plan`, foreground/detached launch output, and `--status` without changing release mutation selection.
- [x] (2026-08-01) Added agent and ExecPlan completion rules and updated the deployment runbook contract.
- [x] (2026-08-01) Passed 154 focused Python tests, all 943 Python deployment-contract tests, the complete shell/Ansible/Web/PostgreSQL deployment contract, documentation audit, and Git checks.
- [x] (2026-08-01) Merged PR #1142 as `cd10814816757d03c76b46db26ab25abd3e484e9`, passed the main push CI, synchronized local `main`, and proved the production plan selects zero devices with `completionEligible=true`.

## Surprises & Discoveries

- Observation: The deployment guide already tells operators to distinguish worktree, origin synchronization, main integration, and fleet SHA, but the machine-readable release output does not contain the main-integration decision.
  Evidence: `docs/guides/deployment.md` has the four-point reporting rule, while `scripts/deploy/rolling_release/planner.py` exposes branch, candidate SHA, and host SHA records without an `origin/main` ancestry summary.
- Observation: A release's operational success and the repository task's completion are separate state machines.
  Evidence: feature-branch releases are intentionally supported by the public CLI, and `RunStateStore` uses `success` only for device convergence. Reusing that field for PR integration would incorrectly turn a healthy canary or production verification into a deployment failure.
- Observation: The complete local deployment contract requires the repository-compatible Node/pnpm pair and the project Ansible environment to precede system tools on `PATH`.
  Evidence: two environment-only attempts stopped before contract execution because Ansible was absent and a newer pnpm requested an interactive modules reinstall. With bundled Node 24, repository pnpm 9.15.9, pyenv Ansible 3.11.8, and `CI=true`, the complete suite passed without source changes.
- Observation: The isolated PostgreSQL phase applies all 157 migrations and removes every container, volume, and network carrying the temporary-resource label.
  Evidence: migration deploy/status, schema SQL, focused API tests, and `EXPLAIN (ANALYZE, BUFFERS)` passed; a post-run Docker label query returned no resources.
- Observation: The pushed feature branch proves the completion gate independently of deploy targeting.
  Evidence: the production `--print-plan` for source `81b040a811e14ced52ef9a7350801949f8a346ac` selected zero devices, reported production SHA `0132e82f8bbf3d672f1a68e12b2656cdf9942c8c` as integrated, reported source integration as false against `origin/main` `da8a4506f9b85bb0be63753784562a26ace8f4e5`, and therefore emitted `integrationPending=true` and `completionEligible=false`.

## Decision Log

- Decision: Preserve operational release success and add a separate fail-closed completion audit.
  Rationale: Feature branches must remain deployable for approved verification, but agents must not describe that verification as completed repository integration.
  Date/Author: 2026-08-01 / Codex with user approval.
- Decision: Derive all public integration fields from one presentation-neutral audit model.
  Rationale: `--print-plan`, launch, and `--status` must not implement ancestry semantics independently. A pure model with an injected Git ancestry resolver is testable and keeps subprocess details at the application boundary.
  Date/Author: 2026-08-01 / Codex.
- Decision: Treat unavailable `origin/main`, malformed SHA evidence, or unknown production SHA as completion-ineligible.
  Rationale: The original failure was an unjustified positive claim. Unknown evidence must never become an implicit “merged” result.
  Date/Author: 2026-08-01 / Codex.

## Outcomes & Retrospective

The implementation emits one fail-closed `mainIntegration` object across planning, launch, and status paths while preserving release success and mutation selection. Repository instructions now use that object as a mandatory completion gate. PR #1142 passed every required check and merged as `cd10814816757d03c76b46db26ab25abd3e484e9`; the subsequent main push CI run `30676604995` also passed.

The merged-main production plan observed all eight fleet hosts at verified application SHA `0132e82f8bbf3d672f1a68e12b2656cdf9942c8c`, selected zero mutation targets, and returned no warnings. Its audit reported source and `origin/main` as `cd10814816757d03c76b46db26ab25abd3e484e9`, both source and production ancestry as true, `integrationPending=false`, and `completionEligible=true`. This supplies the four distinct completion facts that were previously conflated: clean worktree, synchronized branch, main integration, and separate production runtime evidence.

## Context and Orientation

`scripts/update-all-clients.sh` delegates to `scripts/deploy/rolling-release.py`. The facade resolves the requested remote branch, reads production fleet state, and composes `--print-plan`. `scripts/deploy/rolling_release/application.py` launches the remote release unit and presents foreground, detached, and later `--status` results. `scripts/deploy/rolling_release/planner.py` owns device mutation planning; main integration must not alter that planning.

The new audit module will accept a source SHA, an `origin/main` SHA, and production host SHA evidence. “Ancestor” means that Git can reach the candidate commit by walking backward from `origin/main`; this proves that the commit is integrated into main. If all hosts report one SHA, `productionSha` contains it. If hosts differ, `productionSha` is null and `productionShas` lists every distinct SHA so mixed fleets are not hidden.

## Plan of Work

First create `scripts/deploy/rolling_release/main_integration.py` as a pure model. It will validate full lowercase Git SHAs, call an injected ancestry predicate for the source and each distinct production SHA, and return one stable dictionary. It will set `integrationPending` when the source is outside main, any production SHA is outside main, or required evidence is unavailable. `completionEligible` is the exact inverse only when the audit is complete.

Next add a facade adapter in `scripts/deploy/rolling-release.py` that resolves `origin/main`, performs `git merge-base --is-ancestor`, and extracts current SHA evidence from the existing public host records. Attach the resulting fields to `--print-plan`. Reuse the same adapter from `application.py` for foreground output, detached acceptance, and `--status`. Do not modify target selection, release state transitions, canary behavior, or fleet persistence.

Finally update `AGENTS.md`, `.agent/PLANS.md`, and `docs/guides/deployment.md`. The instructions will require the audit before completion and prohibit a positive integration claim when `completionEligible` is false. Tests will cover integrated, pending, mixed-production, malformed, and unavailable evidence, plus all three public output paths.

## Concrete Steps

Work from `/Users/tsudatakashi/RaspberryPiSystem_002` on `feat/main-integration-completion-guard`.

1. Add the pure audit module and focused tests under `scripts/deploy/tests/`.
2. Attach the audit to print-plan and application outputs, then update existing facade/application tests.
3. Update repository instructions and deployment documentation; regenerate `docs/_meta/document-inventory.*`.
4. Run focused Python tests and `scripts/ci/run-deploy-contracts-local.sh` under the repository's Node 20 runtime.
5. Run documentation and Git checks, commit, push, open a PR, wait for required CI, and merge only after success.
6. Synchronize local `main` and run the standard `--print-plan`; expect no device targets and `completionEligible=true`.

## Validation and Acceptance

Focused unit tests must prove that a feature-branch candidate produces `sourceShaIsInMain=false`, `integrationPending=true`, and `completionEligible=false` without changing release targets. A main candidate and production SHAs that are all ancestors of `origin/main` must produce the inverse. Mixed production SHAs must be listed individually rather than collapsed. Missing main resolution, malformed host evidence, and ancestry errors must fail closed.

CLI contract tests must prove that `--print-plan`, detached acceptance, foreground success, and `--status` expose the same field names. The complete deployment contract suite must continue to pass, showing that no remote protocol, mutation, rollback, or canary contract changed. The post-merge production plan must select zero devices because this is deployment-control and documentation work only.

## Idempotence and Recovery

The audit is read-only and does not modify Git refs, fleet state, release records, devices, or databases. Repeating it is safe. A Git network or ancestry failure produces completion-ineligible evidence and a bounded warning; it never broadens or suppresses device mutation targets. Existing release cancellation and rollback behavior remains unchanged.

## Artifacts and Notes

Do not commit test logs, generated caches, or temporary databases. Documentation inventory files are canonical generated outputs and must be committed when their source metadata changes.

## Interfaces and Dependencies

The audit module will expose one function accepting `source_sha`, `origin_main_sha`, a collection of production SHAs, and an `is_ancestor(candidate, main)` callable. It returns JSON-compatible values only. The facade owns Git subprocess execution; the planner and state stores do not depend on Git. `application.py` depends only on a runtime callback supplied by the facade, preserving its testable adapter boundary.

Plan revision note (2026-08-01): created after analyzing the existing four-state documentation rule and the absence of equivalent machine-readable completion evidence. Updated after the complete local contract suite and the pushed feature-branch production-plan acceptance check passed. Closed after PR #1142, main CI, and the merged-main production no-op audit all succeeded.
