# Decompose the Pi 5 Blue/Green deploy script into enforced modules

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document must be maintained in accordance with `.agent/PLANS.md`.

- id: pi5-blue-green-boundaries-execplan
- status: completed
- scope: the Pi 5 Blue/Green entrypoint, source-only Bash modules, deploy contracts, and structural enforcement
- started: 2026-08-03
- branch: `refactor/pi5-blue-green-boundaries`
- baseline_sha: `f056de7624cd25f8f7ccb17044f9aafb597a7adb`
- merged_sha: `fee56a0a962092cd278177cbbe406918f3509f77`
- integration: completed by PR #1162; the standard target plan classified the change as deploy-control-only and safely selected no production mutation

## Purpose / Big Picture

The Pi 5 Blue/Green deploy script is a safety-critical 2,353-line Bash entrypoint containing roughly 70 functions. It currently passes its deployment contracts, but policy, state persistence, runtime inspection, migration recovery, lifecycle operations, cleanup, reconciliation, and status reporting share one file. This change keeps every command and safety behavior stable while moving those functions into fixed-path, source-only modules. Operators continue to use `scripts/deploy/pi5-blue-green.sh`; maintainers gain smaller responsibility boundaries and an automated structure contract that prevents the entrypoint from growing back into a monolith.

The change is observable without contacting production: the existing Blue/Green, maintenance recovery, coordinator, migration, fleet-state, Ansible, and isolated PostgreSQL contracts must all pass, while a new structure test proves the entrypoint and modules satisfy size, ownership, and dependency rules.

## Progress

- [x] (2026-08-03 13:00+09:00) Confirmed clean synchronized `main` at `f056de7624cd25f8f7ccb17044f9aafb597a7adb` and created `refactor/pi5-blue-green-boundaries`.
- [x] (2026-08-03 13:00+09:00) Established the pre-change baseline: focused Blue/Green and maintenance contracts passed, coordinator backend passed 12 tests, and the Node 20 standard deploy-contract suite passed 962 Python tests plus all isolated PostgreSQL and Ansible checks.
- [x] (2026-08-03 20:46+09:00) Added entrypoint/module-aware behavior characterization and committed it with this ExecPlan as `9a9c593e`.
- [x] (2026-08-03 20:51+09:00) Extracted policy and state functions in `aa0d798e`; focused lifecycle, maintenance recovery, and 12 coordinator tests passed.
- [x] (2026-08-03 20:53+09:00) Extracted image/evidence and runtime functions in `717e8f25`; focused contracts passed.
- [x] (2026-08-03 20:55+09:00) Extracted legacy and migration functions in `84f883d2`; focused contracts passed.
- [x] (2026-08-03 20:58+09:00) Extracted lifecycle, cleanup/reconcile, and status functions in `3533c0ea`; the executable entrypoint became 223 lines and focused contracts passed.
- [x] (2026-08-03 21:01+09:00) Added five structural contracts, module syntax checks in the standard runner, and deployment-guide documentation; focused tests and docs audit passed.
- [x] (2026-08-03 21:07+09:00) Ran the final Node 20 standard deploy contracts: 967 Python tests, 20 isolated deploy-status API tests, 43 Ansible tests, all shell/Blue-Green/maintenance/migration/fleet contracts, and playbook syntax checks passed.
- [x] (2026-08-03 21:08+09:00) Verified cleanup and repository quality: Docker remained at 0 containers, 17 volumes, and 3 networks with no task residue; docs audit and `git diff --check` passed.
- [x] (2026-08-03 21:28+09:00) Pushed the approved branch, opened PR #1162, passed all required CI, CodeQL, and secret scanning, and squash-merged it to `main` as `fee56a0a962092cd278177cbbe406918f3509f77`.
- [x] (2026-08-03 21:30+09:00) Ran the standard `--print-plan` and `--preflight-only` flow. All readiness gates passed, `mainIntegration.completionEligible` was true, and the deploy-control-only classification selected zero mutation, activation, verification, or terminal targets; no release or canary gate was created.

## Surprises & Discoveries

- Observation: The standard local deploy-contract runner requires Node 20.9 or newer; the workstation default Node is older.
  Evidence: The default invocation failed only its version gate, while `PATH=/opt/homebrew/opt/node@20/bin:$PATH scripts/ci/run-deploy-contracts-local.sh` passed completely.

- Observation: Several focused contracts locate function bodies by line ranges in the monolith.
  Evidence: `scripts/deploy/tests/test-pi5-blue-green.sh` extracts `bootstrap`, `prepare`, persistence, monitoring, and cleanup ranges directly from `scripts/deploy/pi5-blue-green.sh`; those tests must become aware of the fixed module set before functions move.

- Observation: No existing function exceeded the 120-line limit once function endings were measured while ignoring embedded Python heredocs.
  Evidence: The largest resulting function is `state_assert` at 106 physical lines; the entrypoint helper maximum is below the same limit.

- Observation: The aggregate test count increased only by the five intended structure tests.
  Evidence: The baseline aggregate passed 962 Python tests and the final aggregate passed 967; no existing test was removed or skipped.

- Observation: The change-aware release planner correctly treated this refactor as deployment-control code rather than an application release.
  Evidence: The merged-SHA plan reported components `deploy-control`, `neutral`, and `server-app`, selected no targets, and returned `mainIntegration.completionEligible=true`; the read-only preflight passed every applicable gate with `releaseSubmitted=false`.

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

- Decision: Keep the existing embedded production safety matrix as comments in `policy.sh`.
  Rationale: It is review documentation rather than executable dispatch behavior, and moving it out of the entrypoint reduces the entrypoint without changing or discarding the safety checklist.
  Date/Author: 2026-08-03 / Codex

- Decision: Accept the standard planner's zero-target result instead of forcing Pi5 or terminal redeployment.
  Rationale: The merged change modifies deploy-control implementation and tests but not API/Web images, database state, Compose definitions, or terminal runtime. Forcing a host mutation would add risk without validating any changed runtime artifact.
  Date/Author: 2026-08-03 / Codex

## Outcomes & Retrospective

The local, behavior-preserving decomposition is complete. The entrypoint fell from 2,353 lines to 223 lines and remains executable at the same path. Nine source-only modules are between 90 and 333 lines; the largest function is 106 lines. Five structure tests enforce the module inventory and load order, file and function limits, unique definitions, source-only behavior, and supported caller paths.

The final Node 20 standard deployment contract passed all shell and Blue/Green lifecycle contracts, maintenance recovery, Web routing/build, migration, fleet-state, rollback, release, terminal, isolated PostgreSQL, deploy-status, inventory, and Ansible checks. Its Python discovery count was 967, exactly the 962-test baseline plus five new structure tests. The isolated database applied all 157 migrations and the 20 deploy-status API tests passed. Docker resources returned to their exact starting counts with no named residue.

No API, database schema, migration, Compose definition, Ansible inventory, public command, state contract, host, or production data was changed. PR #1162 passed the protected CI set and was squash-merged as `fee56a0a962092cd278177cbbe406918f3509f77`. The standard merged-SHA plan selected no hosts because the change is deploy-control-only. Its read-only preflight verified source identity, the full production migration ledger, Pi5 authority and resources, external build routes, and interrupted-run recovery. No release unit, fleet mutation, host checkout, service change, or canary approval was created. Repository integration is complete.

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

Record the concise pass counts, file line counts, and Docker before/after evidence in this document. During implementation, do not execute `scripts/deploy/pi5-blue-green.sh` against a host and do not invoke `scripts/update-all-clients.sh`. After separate integration approval, use only `scripts/update-all-clients.sh --print-plan` and `--preflight-only`; accept a zero-target result rather than bypassing the planner.

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

Final local evidence after `a3819c76`:

    pi5-blue-green.sh: 223 physical lines, executable
    modules: 9 source-only files, 90 to 333 physical lines
    largest function: state_assert, 106 physical lines
    structural contracts: 5 passed
    aggregate Python suite: 967 tests passed
    deploy-status isolated PostgreSQL: 157 migrations, 20 tests passed
    Ansible-related contracts: 43 tests passed
    standard deploy contract: all checks passed with Node v20.20.2
    Docker before/after: 0 containers, 17 volumes, 3 networks
    task-labelled Docker residue: zero
    docs audit and git diff check: passed

Integration evidence:

    pull request: #1162
    merge SHA: fee56a0a962092cd278177cbbe406918f3509f77
    protected CI, CodeQL, secret scan: passed
    merged-SHA plan targets: zero
    preflight ID: 20260803-122956-941fcd
    readiness gates: all applicable gates passed
    releaseSubmitted: false
    mainIntegration: integrated; completionEligible=true
    production mutation: none

## Interfaces and Dependencies

The executable interface remains `scripts/deploy/pi5-blue-green.sh` with public commands `status`, `bootstrap`, `prepare`, `switch`, `rollback`, `cleanup`, `reconcile`, and `monitor`, plus coordinator helpers `seal-image-ids`, `migration-ledger`, and `restart-monitor`. The nine module filenames and responsibilities are fixed by this plan: `policy.sh`, `state.sh`, `images-evidence.sh`, `runtime.sh`, `legacy.sh`, `migrations.sh`, `lifecycle.sh`, `cleanup-reconcile.sh`, and `status.sh`.

The implementation may use Bash, Python's standard library for structural testing, the existing Docker-backed aggregate test, and existing repository helpers only. It must not add packages, modify Compose or Ansible data, or change the callers in `rolling-release.py`, systemd reconciliation, or migration evidence collection.

Revision note (2026-08-03): Initial plan created from the clean synchronized baseline after the complete local deployment contract passed with Node 20.

Revision note (2026-08-03 21:01+09:00): Updated after all nine modules, focused contracts, structural enforcement, and documentation were completed; the full aggregate remains pending.

Revision note (2026-08-03 21:08+09:00): Closed local implementation after the full standard contract and zero-residue cleanup passed. Integration remains open because push, PR, merge, and production rollout require separate approval.

Revision note (2026-08-03 21:30+09:00): Marked complete after protected PR integration and the standard merged-SHA planner/preflight proved that no production target or mutation was required.
