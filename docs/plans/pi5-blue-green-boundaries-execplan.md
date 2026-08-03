# Decompose the Pi 5 Blue/Green deploy script into enforced modules

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document must be maintained in accordance with `.agent/PLANS.md`.

- id: pi5-blue-green-boundaries-execplan
- status: in-progress
- scope: the Pi 5 Blue/Green entrypoint, source-only Bash modules, deploy contracts, and structural enforcement
- started: 2026-08-03
- branch: `refactor/pi5-blue-green-boundaries`
- baseline_sha: `f056de7624cd25f8f7ccb17044f9aafb597a7adb`
- integration: pending separate approval; no push, PR, merge, or production deployment is authorized by this plan

## Purpose / Big Picture

The Pi 5 Blue/Green deploy script is a safety-critical 2,353-line Bash entrypoint containing roughly 70 functions. It currently passes its deployment contracts, but policy, state persistence, runtime inspection, migration recovery, lifecycle operations, cleanup, reconciliation, and status reporting share one file. This change keeps every command and safety behavior stable while moving those functions into fixed-path, source-only modules. Operators continue to use `scripts/deploy/pi5-blue-green.sh`; maintainers gain smaller responsibility boundaries and an automated structure contract that prevents the entrypoint from growing back into a monolith.

The change is observable without contacting production: the existing Blue/Green, maintenance recovery, coordinator, migration, fleet-state, Ansible, and isolated PostgreSQL contracts must all pass, while a new structure test proves the entrypoint and modules satisfy size, ownership, and dependency rules.

## Progress

- [x] (2026-08-03 13:00+09:00) Confirmed clean synchronized `main` at `f056de7624cd25f8f7ccb17044f9aafb597a7adb` and created `refactor/pi5-blue-green-boundaries`.
- [x] (2026-08-03 13:00+09:00) Established the pre-change baseline: focused Blue/Green and maintenance contracts passed, coordinator backend passed 12 tests, and the Node 20 standard deploy-contract suite passed 962 Python tests plus all isolated PostgreSQL and Ansible checks.
- [ ] Add entrypoint/module-aware behavior characterization and commit it with this ExecPlan.
- [ ] Extract policy and state functions, then run focused contracts.
- [ ] Extract image/evidence and runtime functions, then run focused contracts.
- [ ] Extract legacy and migration functions, then run focused contracts.
- [ ] Extract lifecycle, cleanup/reconcile, and status functions, then run focused contracts.
- [ ] Add the structural contract to the standard deploy-contract runner and update documentation.
- [ ] Run final Node 20 deploy contracts, verify disposable Docker cleanup, update this plan, and leave the local branch ready for separate integration approval.

## Surprises & Discoveries

- Observation: The standard local deploy-contract runner requires Node 20.9 or newer; the workstation default Node is older.
  Evidence: The default invocation failed only its version gate, while `PATH=/opt/homebrew/opt/node@20/bin:$PATH scripts/ci/run-deploy-contracts-local.sh` passed completely.

- Observation: Several focused contracts locate function bodies by line ranges in the monolith.
  Evidence: `scripts/deploy/tests/test-pi5-blue-green.sh` extracts `bootstrap`, `prepare`, persistence, monitoring, and cleanup ranges directly from `scripts/deploy/pi5-blue-green.sh`; those tests must become aware of the fixed module set before functions move.

## Decision Log

- Decision: Preserve Bash and mechanically move existing functions into source-only modules rather than rewrite deployment control flow.
  Rationale: The existing contracts protect mature, safety-critical behavior. Mechanical movement minimizes semantic risk and keeps individual commits reversible.
  Date/Author: 2026-08-03 / Codex

- Decision: Only the entrypoint may source modules, and it will use paths derived from its own canonical path.
  Rationale: Fixed loading order avoids hidden module dependencies and prevents the caller's working directory or environment from redirecting safety-critical code loading.
  Date/Author: 2026-08-03 / Codex

- Decision: Keep production and managed hosts outside this implementation and validation cycle.
  Rationale: The standard contract suite exercises orchestration with mocks and uniquely named isolated PostgreSQL resources; production verification belongs to a later, separately approved standard rollout.
  Date/Author: 2026-08-03 / Codex

## Outcomes & Retrospective

Implementation is in progress. The expected outcome is a small dispatch entrypoint, nine responsibility modules, unchanged deployment behavior, and automated structural enforcement. Push, PR, merge, and production integration remain pending separate approval.

## Context and Orientation

`scripts/deploy/pi5-blue-green.sh` is the sole supported Pi 5 Blue/Green command entrypoint. `scripts/deploy/rolling-release.py`, the reconcile systemd unit, and migration evidence helpers call this path or its internal commands. “Blue/Green” means the host keeps an active application slot serving traffic while preparing an inactive slot, then moves the gateway only after readiness and migration policy checks pass. The coordinator is `rolling-release.py`; it alone decides whether a failed switch needs a switchback.

The existing focused shell contract is `scripts/deploy/tests/test-pi5-blue-green.sh`; maintenance recovery is covered by `scripts/deploy/tests/test-pi5-blue-green-maintenance-container.sh`; coordinator behavior is covered by `scripts/deploy/tests/test_pi5_backend.py`. `scripts/ci/run-deploy-contracts-local.sh` is the standard local aggregate and does not contact managed hosts. New source-only modules belong in `scripts/deploy/lib/pi5-blue-green/` and may contain function definitions and comments only. They may call functions defined by other modules at runtime, but they may not source one another.

State schema v2, immutable image identity, recovery authority, expand-only migration checks, active scheduler leadership, five-minute post-switch stability, two-second monitoring intervals, fifteen structural samples, coordinator-owned switchback, resumable cleanup, status fail-closed behavior, all command names, options, environment variables, messages, JSON, and exit codes are public safety contracts for this refactor.

## Plan of Work

First change the focused contract helper so it searches the entrypoint and the ordered module directory for complete function definitions. Add CLI characterizations for help, unknown-command failure, an uninitialized status response, command dispatch, locking, and read-only status. Commit these tests and this plan while the implementation is still monolithic.

Then create `policy.sh` and `state.sh`, mechanically moving fixed safety policy, coordinator authority, alerting, lock cleanup, schema validation, atomic persistence, and state-context functions. Keep top-level policy invocation and lock acquisition in the entrypoint. Repeat the same move-and-test cycle for `images-evidence.sh` and `runtime.sh`; `legacy.sh` and `migrations.sh`; and finally `lifecycle.sh`, `cleanup-reconcile.sh`, and `status.sh`. Module order is fixed in the entrypoint and modules never source other files.

Finally add `scripts/deploy/tests/test_pi5_blue_green_structure.py`. It will enforce a 350-line entrypoint, 500-line modules, 120-line functions, unique function definitions, the exact module list and order, absence of module-to-module sourcing or entrypoint reverse dependencies, absence of source-time side effects, and continued use of the public entrypoint by production callers. Add this test and module syntax checks to `scripts/ci/run-deploy-contracts-local.sh`, update the relevant runbook only where the internal layout needs explanation, and run the complete local contract suite.

## Concrete Steps

Run all commands from `/Users/tsudatakashi/RaspberryPiSystem_002`. Use Node 20 by prefixing final aggregate commands with `PATH=/opt/homebrew/opt/node@20/bin:$PATH`.

After each cohesive extraction run:

    bash -n scripts/deploy/pi5-blue-green.sh scripts/deploy/lib/pi5-blue-green/*.sh
    bash scripts/deploy/tests/test-pi5-blue-green.sh
    bash scripts/deploy/tests/test-pi5-blue-green-maintenance-container.sh
    python3 -m unittest scripts.deploy.tests.test_pi5_backend scripts.deploy.tests.test_pi5_blue_green_structure
    git diff --check

At completion run:

    PATH=/opt/homebrew/opt/node@20/bin:$PATH scripts/ci/run-deploy-contracts-local.sh

Record the concise pass counts, file line counts, and Docker before/after evidence in this document. Do not execute `scripts/deploy/pi5-blue-green.sh` against a host and do not invoke `scripts/update-all-clients.sh` during this work.

## Validation and Acceptance

Acceptance requires `scripts/deploy/pi5-blue-green.sh` to remain executable and at most 350 lines, every new module to be at most 500 lines, and every function to be at most 120 lines. The public and internal command set, options, state schema, JSON, error paths, lock behavior, recovery order, migration rules, runtime sequencing, and coordinator authority must remain accepted by all existing contracts. No test may be deleted or newly skipped.

The new structure test must fail if a module sources another module, performs work while being sourced, duplicates a function, exceeds its limit, or if a supported caller bypasses the public entrypoint. The standard aggregate must pass with Node 20 and must leave no uniquely labelled disposable container, volume, network, or PostgreSQL resource behind.

## Idempotence and Recovery

All edits are code and contract changes only; they do not touch a schema, production data, hosts, Compose configuration, or inventory. Each extraction is a separate commit and can be reverted independently. If a focused contract fails, stop that extraction, compare the moved function byte-for-byte with its pre-move form, and restore the last passing commit before proceeding. The aggregate test owns isolated resources and its normal cleanup must remove them; if interrupted, identify resources by the runner's unique label and remove only those resources.

## Artifacts and Notes

Pre-change evidence at `f056de7624cd25f8f7ccb17044f9aafb597a7adb`:

    pi5-blue-green.sh: 2,353 physical lines
    focused Blue/Green lifecycle: passed
    maintenance-container recovery: passed
    coordinator backend: 12 tests passed
    standard deploy contract: passed with Node v20.20.2
    aggregate Python suite: 962 tests passed
    deploy-status isolated PostgreSQL: 20 tests passed
    Ansible-related contracts: 43 tests passed
    disposable rolling-deploy-status Docker residue: zero

## Interfaces and Dependencies

The executable interface remains `scripts/deploy/pi5-blue-green.sh` with public commands `status`, `bootstrap`, `prepare`, `switch`, `rollback`, `cleanup`, `reconcile`, and `monitor`, plus coordinator helpers `seal-image-ids`, `migration-ledger`, and `restart-monitor`. The nine module filenames and responsibilities are fixed by this plan: `policy.sh`, `state.sh`, `images-evidence.sh`, `runtime.sh`, `legacy.sh`, `migrations.sh`, `lifecycle.sh`, `cleanup-reconcile.sh`, and `status.sh`.

The implementation may use Bash, Python's standard library for structural testing, the existing Docker-backed aggregate test, and existing repository helpers only. It must not add packages, modify Compose or Ansible data, or change the callers in `rolling-release.py`, systemd reconciliation, or migration evidence collection.

Revision note (2026-08-03): Initial plan created from the clean synchronized baseline after the complete local deployment contract passed with Node 20.
