---
id: deploy-readiness-policy-engine-20260726
title: Data-driven deploy release-readiness policy engine
status: completed
scope: canonical SSH rolling release before release-unit submission
date: 2026-07-26
source_of_truth: docs/plans/deploy-readiness-policy-engine-20260726.md
related_code:
  - scripts/update-all-clients.sh
  - scripts/deploy/readiness-gates.json
  - scripts/deploy/rolling_release/application.py
  - scripts/deploy/rolling_release/readiness_policy.py
  - scripts/deploy/rolling_release/coordinator.py
related_docs:
  - docs/decisions/ADR-20260726-deploy-readiness-policy-engine.md
  - docs/plans/deploy-release-readiness-review-20260725.md
  - docs/guides/deployment.md
validation: focused tests, complete deploy contracts, required CI, exact-head read-only preflight, then standard production deployment
open_items: []
---

# Automate Data-Driven Deploy Release Readiness

This ExecPlan is a living document. The sections `Progress`,
`Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must
be kept current while work proceeds. It is maintained according to
`.agent/PLANS.md`.

## Purpose / Big Picture

The standard deployment entry point already runs read-only checks before it
creates a release unit. Today, however, Python conditionals decide which checks
apply and the terminal check can be built from the selected inventory rather
than the actual work plan. A future feature can therefore add a deploy impact
without recording how readiness is protected, or can probe a terminal that the
release will not touch.

After this change, a strict data-only registry declares each readiness gate,
its applicability, its typed probe capability, its scope, and its operational
justification. A pure evaluator turns the existing read-only deployment plan
into facts and selects only the required probes and actual work hosts. The
admission produced by successful preflight is compared with the coordinator's
locked plan before any new-release mutation. Operators can inspect the
selection in `--print-plan`, the evidence in `--preflight-only`, and the sealed
admission in release status.

## Progress

- [x] (2026-07-25 23:25Z) Confirmed a clean worktree and created
  `feat/deploy-readiness-policy-engine` from current `origin/main`
  `8b87d045`.
- [x] (2026-07-25 23:25Z) Re-audited the current registry, application,
  planner, terminal contract, probe adapters, launch bootstrap, coordinator
  mutation boundary, deployment tests, and canonical local contract runner.
- [x] (2026-07-26 00:20Z) Added and statically validated the strict data-only gate registry and
  component-coverage decisions.
- [x] (2026-07-26 00:20Z) Implemented the pure facts, selection, evidence evaluation, result
  aggregation, and admission logic.
- [x] (2026-07-26 00:20Z) Wired `readinessPlan`, exact terminal-work probe scope, and structured
  version 2 migration and terminal evidence into the existing CLI contract.
- [x] (2026-07-26 00:20Z) Sealed the admission into bootstrap version 3, rejected locked-plan
  scope expansion before new-release mutation, and persist its summary.
- [x] (2026-07-26 00:03Z) Passed 213 focused tests, all 855 Python Deploy
  tests, Python compilation, root lint, `git diff --check`, and the canonical
  `run-deploy-contracts-local.sh` shell/Ansible/PostgreSQL contract runner.
  Its cleanup trap removed the isolated PostgreSQL container, volume, and
  network.
- [x] (2026-07-26 00:46Z) Published PR #1088, passed required CI, CodeQL,
  gitleaks, and repository policy, then squash-merged the tested tree as
  `5661a9cb`.
- [x] (2026-07-26 00:46Z) Passed the exact-head all-target read-only preflight
  `20260726-001909-abcd54` and the Pi5 plus assembly-only reverify preflight
  `20260726-002055-d367a8`. The latter ran the terminal probe only for
  `raspi4-assembly-01`.
- [x] (2026-07-26 00:46Z) Completed standard production release
  `20260726-002143-2aeaf0`. The saved admission matched the locked plan, Pi5
  and all six Kiosk activations were verified, every maintenance marker was
  cleared, and the post-deploy plan contained no targets or terminal work.

## Surprises & Discoveries

- Observation: The current registry is machine-readable only inside Python;
  its `applicability` value is prose and callers supply the actual booleans.
  Evidence: `route_contract.py::readiness_review_payload()` accepts an
  application-owned applicability map.

- Observation: The planner already exposes the exact information needed for a
  generic policy: mutation, activation, verification, profile, and required
  release claims per host.
  Evidence: `planner.py` emits `terminalWork`, `mutationTargets`,
  `activationTargets`, and `verificationTargets`.

- Observation: The application builds terminal preflight contracts before the
  plan exists, from the selected release inventory.
  Evidence: `application.py::_launch()` creates
  `terminal_preflight_targets` before `build_read_only_plan()`.

- Observation: migration, route, and terminal preflights each acquire the same
  fleet lock.
  Evidence: all three adapters use the shared lock contract, so they must
  remain sequential unless the lock architecture changes.

- Observation: A broad issue prefix such as `terminal.` would silently make a
  future observation part of an existing enforce gate.
  Evidence: the first registry draft could assign every future terminal code
  to `terminal.selected-prerequisites`; the final registry uses exact matches
  and closed, reviewed dynamic namespaces, while host identity is a separate
  result field.

- Observation: the planner's `classificationComponents: null` is a valid no-op
  state rather than missing data.
  Evidence: existing no-op plan fixtures intentionally emit null. The
  normalizer maps only an explicitly present null to the registered `neutral`
  component; an absent key is still incomplete.

## Decision Log

- Decision: Treat the planner result as the only authority for probe host
  scope. Missing or malformed plan facts stop with `incomplete`; inventory-wide
  fallback is forbidden.
  Rationale: A fail-open scope guesses at future work, while an all-fleet
  fallback causes unrelated devices to block a release.
  Date/Author: 2026-07-26 / Codex

- Decision: Keep the registry data-only and use a closed condition grammar,
  closed capabilities, and closed scope selectors.
  Rationale: JSON may select repository-owned typed adapters but must never
  become a second command or Python execution surface.
  Date/Author: 2026-07-26 / Codex

- Decision: Preserve sequential remote probes and group gates by capability.
  Rationale: This keeps fleet-lock behavior compatible and prevents duplicate
  remote checks when several gates consume one observation.
  Date/Author: 2026-07-26 / Codex

- Decision: Make every known impact component carry either gate coverage or a
  non-empty no-additional-gate reason in the registry.
  Rationale: Adding a component without a readiness decision must fail a fast
  static test rather than be noticed during deployment.
  Date/Author: 2026-07-26 / Codex

- Decision: Existing seven blockers enter as `enforce`; the interrupted-run
  notification remains `observe`. New gates default to `observe`, and
  promotion requires recorded run IDs and a separate reviewed change.
  Rationale: Existing safety meaning remains compatible while new observations
  cannot create unreviewed production blockers.
  Date/Author: 2026-07-26 / Codex

- Decision: Transport the admission additively in bootstrap schema version 3,
  while allowing a null value only for direct legacy unit-test backend
  callers. The canonical application always supplies it and a real
  `--remote-run` namespace without it is rejected before coordinator work.
  Rationale: This keeps low-level compatibility tests usable without leaving
  the standard Deploy entry point able to start an unadmitted release.
  Date/Author: 2026-07-26 / Codex

## Outcomes & Retrospective

The data-driven policy engine is implemented and running in production. It
selects probes from strict registry data, skips unrelated terminal SSH, emits
structured version 2 migration and terminal evidence, and stops locked-plan
expansion with a saved admission audit.

The focused suite passed 213 tests, the complete Python Deploy suite passed
855 tests, and the canonical contract runner passed its shell, Ansible,
safety, terminal-profile, and isolated PostgreSQL migration/API checks. PR
#1088 and the resulting main commit passed required CI, CodeQL, gitleaks, and
repository policy. Both production read-only preflights passed. Release
`20260726-002143-2aeaf0` finished successfully with scope admission
`sha256:77698f08394dedf7c6a1ee1d3373ec6745f32a736764a643488026f8c0a41b41`;
Pi5 and all six Kiosk activations were verified, every terminal recorded
`maintenanceClearedAt`, and the next standard plan was a no-op.

## Context and Orientation

The canonical operator command is `scripts/update-all-clients.sh`. Its Python
application is `scripts/deploy/rolling_release/application.py`. The
application verifies local source, asks `planner.py` for a read-only work plan,
runs migration, Raspberry Pi 5 route, and terminal preflights, then creates a
systemd release unit only after the aggregate result passes.

A readiness gate is an operational rule that states what requirement must be
true before a release may start. A probe capability is a closed identifier for
a repository-owned read-only adapter; registry data can request a capability
but cannot supply code or commands. An admission is the immutable summary of
the source SHA, policy digest, work scope, required claims, and applicable
gates that passed preflight. Scope drift means the coordinator's later locked
plan requires work outside that admitted set.

`scripts/deploy/terminal-profile-registry.json` is the source for known impact
components and terminal profiles. `planner.py` is the source for the work
hosts, action kinds, and claim requirements. `coordinator.py` performs recovery
for a previous sealed run, then builds a new locked plan. The admission
comparison belongs after that plan is built and validated but before the
coordinator begins the new release's Pi5 or terminal mutation.

## Plan of Work

Create `scripts/deploy/readiness-gates.json` with schema version, eight migrated
gates, and a coverage decision for every known component. Add
`readiness_policy.py` to load and strictly validate the registry, enforce a
bounded condition grammar, normalize a planner payload into immutable facts,
derive gate and probe selections, evaluate typed evidence, aggregate exit
semantics, and create or compare admissions. The evaluator is pure after JSON
loading and must not import subprocess, SSH, Prisma, inventory loading, or
systemd backends.

Adapt `application.py` so the read-only plan exists before terminal contracts
are built. Add `readinessPlan` to print-plan. Run remote probes sequentially
only when the selection requests their capabilities, pass only terminalWork
hosts to terminal preflight, normalize every result to the same secret-free
evidence contract, and let the policy evaluator produce `readinessReview`.
Preserve legacy report fields and exit codes.

Update migration and terminal preflight adapters to emit version 2 JSON with
stable issue codes, host and capability ownership, status, and bounded
evidence. Route preflight already emits structured version 2 data and will be
adapted rather than duplicated.

Extend `LaunchSpec` and bootstrap serialization with the admission. In
`coordinator.py`, compare the locked plan with the admission before new
candidate mutation. Permit removed work and action downgrades; reject policy
or source mismatch, new hosts, action upgrades, new claims, or newly required
capabilities. Persist a secret-free admission summary into release state and
status output.

Add registry, evaluator, application, adapter, bootstrap, coordinator, and
status tests. Use the real six-Kiosk/no-Signage example as a fixture. Extend
the existing fast deploy-contract job instead of adding a new heavy CI job.

## Concrete Steps

All commands run from `/Users/tsudatakashi/RaspberryPiSystem_002`.

Implement registry and policy tests first, then run:

    PYTHONDONTWRITEBYTECODE=1 python3 -m unittest \
      scripts.deploy.tests.test_readiness_policy -q

After application and admission integration, run focused deployment tests:

    PYTHONDONTWRITEBYTECODE=1 python3 -m unittest \
      scripts.deploy.tests.test_release_application \
      scripts.deploy.tests.test_rolling_release_coordinator \
      scripts.deploy.tests.test_route_contract \
      scripts.deploy.tests.test_route_preflight \
      scripts.deploy.tests.test_terminal_preflight -q

Run the complete canonical suite:

    scripts/ci/run-deploy-contracts-local.sh
    git diff --check

After publishing the exact tested commit and required CI success, exercise the
standard command's read-only modes against that immutable SHA:

    scripts/update-all-clients.sh --print-plan
    scripts/update-all-clients.sh --preflight-only

Also run the approved Pi5 plus assembly reverify scenario and verify that its
readiness plan includes only the six Kiosk terminal hosts and no Signage host.
Only after those checks match the exact commit may the normal deployment
command create a release unit. Verify successful status, saved admission,
absence of stale maintenance display, and a later no-op plan.

## Validation and Acceptance

The JSON registry must reject duplicate IDs, unknown components, profiles,
actions, or capabilities, excessive condition depth, missing issue ownership,
missing real regression tests, and unsupported enforcement evidence. Every
terminal-profile impact component must have a readiness coverage decision.

Pure fixtures must prove docs-only, server application, migration, agent-only,
Signage-only, unknown, full-fleet, and reverify selection. The production
example must select exactly the six assembly Kiosks for terminal probes and
must not select Pi3 Signage. Observe failure exits zero with warnings; enforce
failure exits 78; malformed or unowned evidence exits 70.

Admission tests must allow a strict subset and reject a new host, verification
to mutation escalation, a new claim, a new capability, a changed policy
digest, or a changed source SHA. An application test must prove
`SystemdBackend.start()` is never invoked before every enforce gate passes.

The complete deployment contract suite, required CI, exact-head production
read-only preflights, actual standard deployment, post-deploy status, and no-op
plan must all succeed. Temporary PostgreSQL containers, volumes, and networks
created by the canonical test runner must be absent after completion.

## Idempotence and Recovery

Registry evaluation and print-plan are read-only and repeatable. Preflight
adapters keep their current shared lock and bounded timeout behavior. The
application creates no release unit for exit 78 or 70. A scope mismatch stops
before new-release mutation; a prior sealed run may still complete its
existing recovery path first. Production deployment uses only
`scripts/update-all-clients.sh`; no terminal is manually excluded to obtain a
pass.

If implementation validation fails, fix the code and rerun focused tests
before the complete suite. If required CI or exact-head preflight fails, do not
deploy. The canonical local suite owns and removes its isolated PostgreSQL
resources even on failure; verify cleanup before retrying.

## Artifacts and Notes

Baseline focused tests before implementation:

    Ran 66 tests in 0.096s
    OK

The previous build-aware review is
`docs/plans/deploy-release-readiness-review-20260725.md`. It explains the
existing eight rules and external build-route check; this plan replaces its
Python-owned applicability map with the data-driven policy and exact scope.

## Interfaces and Dependencies

`scripts/deploy/rolling_release/readiness_policy.py` will expose immutable
types for `ReadinessFacts`, `GateSelection`, `ProbeRequest`,
`ReadinessDecision`, and `ReadinessAdmission`, plus pure functions to validate
the registry, normalize a plan, select gates, evaluate evidence, create an
admission, and compare a locked plan with an admission.

`--print-plan` gains `readinessPlan`. `--preflight-only` remains additive and
keeps `status`, `selectedHosts`, `terminalCount`, `probes`, and
`readinessReview`. Exit semantics remain 0 for pass or warning only, 78 for an
enforced failure, and 70 for an incomplete or inconsistent audit. Product API,
Prisma, database, inventory, and public terminal-profile contracts do not
change.

Revision note (2026-07-26): Created the implementation source of truth after
the approved design and a fresh code audit. It records the no-fallback scope
rule, data-only boundary, shared-lock sequencing, and production safety gates.

Revision note (2026-07-26 00:20Z): Updated the living plan after the first
complete implementation and Python-suite pass. Recorded the exact-issue
ownership correction, neutral no-op normalization, bootstrap compatibility
boundary, test counts, and remaining canonical validation.
