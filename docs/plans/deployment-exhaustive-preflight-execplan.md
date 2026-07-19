---
id: deployment-exhaustive-preflight
title: Prove every deployment route before another production release
status: in-progress
scope: Local launch, Pi5 bootstrap and release, terminal rollout, cancellation, rollback, interrupted recovery, and final evidence
date: 2026-07-19
source_of_truth: docs/plans/deployment-exhaustive-preflight-execplan.md
related_code:
  - scripts/update-all-clients.sh
  - scripts/deploy/rolling-release.py
  - scripts/deploy/rolling_release/application.py
  - scripts/deploy/rolling_release/coordinator.py
  - scripts/ci/run-deploy-contracts-local.sh
related_docs:
  - ./deployment-foundation-refactor-execplan.md
  - ../guides/deployment.md
  - ../runbooks/deploy-status-recovery.md
validation:
  - machine-readable route coverage contract
  - composed success and before/after-boundary fault rehearsal
  - complete local deploy contract suite and exact-head hosted checks
  - two consecutive read-only production preflights with unchanged host evidence
open_items:
  - publish and pass exact-head hosted validation
  - pass two read-only Pi5 and StoneBase preflights before release
supersedes: null
superseded_by: null
---

# Prove every deployment route before another production release

This ExecPlan is a living document. Maintain `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` whenever work stops or validation changes. Follow `.agent/PLANS.md` from the repository root.

## Purpose / Big Picture

The operator must not discover deterministic deployment defects one at a time in production. Before another release, the repository will enumerate the complete route from the local command through Pi5, Kiosk, Signage, rollback, cancellation, interrupted recovery, and final evidence. Every route boundary must have either a read-only live proof or an isolated composed rehearsal. The public `--preflight-only` result will report all known blockers together and will never call a mutating local Ansible adapter.

The result is observable in three ways. The route coverage test fails if a new execution boundary lacks a proof. The local deployment contract command rehearses success and failure without managed-host access. Finally, two identical production-scope `--preflight-only` runs pass while Git HEAD, fleet state, maintenance, services, and the database remain unchanged.

## Progress

- [x] (2026-07-19 01:20Z) Froze production after the local preflight stopped before release submission; no Pi, service, or database mutation occurred.
- [x] (2026-07-19 01:35Z) Identified the immediate boundary defect: local launch used the normal Ansible inventory adapter, inherited `ansible.cfg`, and required an intentionally absent local `.vault-pass`.
- [x] (2026-07-19 01:42Z) Preserved the uncommitted correction that routes local launch through the existing read-only inventory adapters; 14 release-application and 55 Ansible-adapter tests passed.
- [x] (2026-07-19 02:05Z) Audited the public CLI, local application, transient-systemd bootstrap, coordinator phases, terminal preflight, migration preflight, deployment guide, and existing fault tests. Confirmed that current `--preflight-only` does not cover every later route boundary.
- [x] (2026-07-19 05:18Z) Added the 23-stage route contract. AST coverage rejects unregistered local/coordinator boundaries, and every rehearsal ID must resolve to an existing concrete test method.
- [x] (2026-07-19 05:20Z) Added the standard-library Pi5 route probe and aggregate JSON report. Normal launch and `--preflight-only` both collect migration, route, and terminal results before deciding; exit 0/78/70 is fail-closed.
- [x] (2026-07-19 05:22Z) Reconnected the complete existing rehearsal matrix to the route contract: no-op, Pi5, Kiosk, Signage, combined ordering, canary, rollback, cancellation, finalization, and interrupted recovery remain exercised by the complete deploy suite.
- [x] (2026-07-19 05:31Z) Passed 692 deployment Python tests and the canonical local deploy-contract twice: 99 templates, shell/Blue-Green/maintenance/rollback contracts, both inventories, all profile playbooks, isolated Postgres with 149 migrations, SQL/EXPLAIN, and 20 API tests. Temporary Docker resources were absent after completion.
- [ ] Complete hosted exact-head checks and two-pass live read-only gates.
- [ ] Only after all gates pass, run the already-authorized limited Pi5 and StoneBase release and prove verified/no-op completion.

## Surprises & Discoveries

- Observation: The public preflight name suggests complete readiness, but its implementation currently checks only the production migration ledger and aggregate terminal prerequisites.
  Evidence: `application.launch` calls `preflight_migrations` and `preflight_terminals`, then submits the transient unit. Pi5 normal Ansible/Vault, bootstrap checkout, interrupted recovery, server configuration, candidate build, Blue/Green switching, and terminal finalization occur only after submission.

- Observation: Local plan and local launch used different inventory adapters even though both are read-only operator actions.
  Evidence: `build_print_plan` used `read_only_inventory_json`, while `application.launch` used `inventory_json` and therefore auto-loaded `infrastructure/ansible/ansible.cfg` plus `.vault-pass` from its working directory.

- Observation: Existing tests are extensive but do not expose a single statement of route completeness.
  Evidence: Coordinator, bootstrap, rollback, migration, and terminal preflight tests cover hundreds of cases, but no contract fails when a new coordinator boundary has neither live preflight evidence nor composed failure rehearsal.

## Decision Log

- Decision: Freeze deployment until every route-contract row has a passing proof and the live scope passes twice unchanged.
  Rationale: A partial fix followed by another release attempt recreates the serial-discovery failure mode the user rejected.
  Date/Author: 2026-07-19 / Codex, approved by user.

- Decision: Local plan, local launch, and local host selection use only `ansible-readonly.cfg`; only the Pi5 coordinator may use normal Ansible configuration and Vault.
  Rationale: Read-only operator actions do not need secrets, while the remote coordinator owns actual configuration mutation.
  Date/Author: 2026-07-19 / Codex.

- Decision: A route boundary is accepted only when it has a named read-only proof or an isolated before/after fault rehearsal; comments and runbook statements alone are not proof.
  Rationale: Machine-enforced completeness prevents a new stage from silently bypassing prevalidation.
  Date/Author: 2026-07-19 / Codex.

- Decision: Production preflight aggregates blockers and returns `0` for complete success, `78` for discovered blockers, and `70` for an incomplete or internally failed audit.
  Rationale: Incomplete evidence must never be interpreted as readiness, and operators need all deterministic blockers in one run.
  Date/Author: 2026-07-19 / Codex.

## Outcomes & Retrospective

Offline implementation and the complete local contract now pass. Production remains unchanged. Publication, exact-head hosted checks, two consecutive live read-only proofs, and the final release remain pending.

## Context and Orientation

`scripts/update-all-clients.sh` is the only public deployment entry and executes `scripts/deploy/rolling-release.py`. Local actions are implemented in `scripts/deploy/rolling_release/application.py`. A normal release sends a standard-library bootstrap to Pi5 through a transient systemd unit; the target checkout then runs `scripts/deploy/rolling_release/coordinator.py`. The coordinator owns durable fleet state, interrupted recovery, Pi5 server configuration and Blue/Green release, serial terminal release, rollback, cancellation, and final evidence.

A route boundary is any call that reads an external authority or may change Git, files, configuration, database state, Docker, systemd, maintenance, or durable release evidence. A read-only proof observes the real production prerequisite without changing it. A composed rehearsal runs the real orchestration logic against controlled adapters and injects command loss on both sides of a mutation boundary.

The current branch is `feat/assembly-torque-external-bluetooth-acceptance`. Two intentional uncommitted changes in `application.py` and `test_release_application.py` replace local mutating inventory adapters with read-only adapters and make regression tests reject a future reversal. Do not discard or stash them.

## Plan of Work

Create `scripts/deploy/rolling_release/route_contract.py` as the single route inventory. Each record has a stable stage ID, owner (`local`, `pi5`, or `terminal`), operation class (`read`, `mutation`, or `commit`), preflight proof ID, failure disposition, and recovery owner. Cover local resolution, production-ledger preflight, terminal aggregate preflight, unit bootstrap, candidate residue recovery, fleet begin, interrupted server and terminal recovery, evidence seeding, planning, Pi5 configuration and release, terminal capture/notice/maintenance/apply/ready/finalization, canary approval, rollback, cancellation, fleet finalization, and post-success no-op evidence.

Add a coverage test that extracts the named checkpoints and boundary calls from `application.py` and `coordinator.py`. It must reject an unknown boundary, a mutation without before/after rehearsal, a read without a preflight proof, or a failure disposition without a recovery owner. The same route contract supplies ordered stage IDs in preflight output; do not duplicate the list in shell scripts or documentation.

Finish the local read-only adapter correction. Keep the normal `inventory_json` and `selected_hosts` functions for remote coordinator execution. Tests must define those mutating methods to raise when local launch or print-plan attempts to use them.

Add a standard-library Pi5 route preflight source beside the migration and terminal preflight modules. It acquires the existing fleet lock non-blockingly, verifies Pi5 identity, clean checkout, candidate commit and protocol, sudo/systemd-run capability, normal remote Ansible configuration and Vault usability through a redacted inventory expansion, candidate-owned executors and templates, Docker/Compose availability, disk and memory thresholds, current Blue/Green evidence, release-state readability, and rollback authority structure. It must not check out a commit, create a release unit, build an image, apply a migration, run a playbook, change maintenance, or start/stop a service.

Change local application preflight orchestration to execute all preflight probes even when one reports a blocker, provided continuing is safe. Parse bounded JSON results and emit one report containing the immutable SHA, inventory, selected hosts, route coverage, proofs, blockers, and warnings. Secret-bearing output is never forwarded. A malformed, missing, oversized, or internally failed probe yields exit `70`; ordinary prerequisite blockers yield `78`.

Extend the composed coordinator harness. Prove no-op, Pi5-only, each registered terminal profile, combined Pi5 plus terminal, canary approval, rollback, cancellation, and interrupted recovery. Derive fault points from the route contract rather than hand-maintaining another list. For every mutation and commit boundary, inject failure immediately before and immediately after the adapter reports; then rerun from durable state and require convergence without double mutation, false verified evidence, lost maintenance authority, or an incorrect rollback baseline.

Update `scripts/ci/run-deploy-contracts-local.sh` so the route coverage and composed rehearsal are part of the same command used by CI. Preserve the existing temporary-directory cleanup and isolated Postgres test. Update the deployment guide only after executable behavior exists, and link this plan from the document index without copying its narrative.

## Concrete Steps

Work from the repository root. First run focused tests for the preserved WIP:

    PYTHONPATH=.:scripts/deploy python3 scripts/deploy/tests/test_release_application.py
    PYTHONPATH=.:scripts/deploy python3 scripts/deploy/tests/test_ansible_adapter.py

After each implementation slice, run the new route-contract tests and the relevant application, systemd, migration, terminal-preflight, bootstrap, coordinator-transition, and rolling-release tests. Before publication run:

    scripts/ci/run-deploy-contracts-local.sh
    pnpm lint --max-warnings=0
    node scripts/docs/audit-docs.mjs
    git diff --check

The contract script creates and removes its own temporary files and isolated Postgres resources. Verify no same-run container, volume, network, or process remains.

After a clean commit and push, dispatch CI, CodeQL, and Secret scan for the exact branch head and require the fixed checks `ci-required`, `codeql`, and `gitleaks` to succeed.

Then run the limited read-only sequence twice with the exact same SHA:

    RASPI_SERVER_HOST=denkon5sd02@100.106.158.2 scripts/update-all-clients.sh feat/assembly-torque-external-bluetooth-acceptance infrastructure/ansible/inventory.yml --limit 'raspberrypi5:raspi4-kensaku-stonebase01' --print-plan
    RASPI_SERVER_HOST=denkon5sd02@100.106.158.2 scripts/update-all-clients.sh feat/assembly-torque-external-bluetooth-acceptance infrastructure/ansible/inventory.yml --limit 'raspberrypi5:raspi4-kensaku-stonebase01' --preflight-only

Capture before, between, and after evidence for Git HEAD, fleet state digest, deploy-status digest, maintenance, service states, Docker identities, and migration ledger digest. The two preflight reports and all evidence must match except timestamps and generated preflight IDs.

Only after that evidence passes may the same limited command run without a read-only flag. Observe through the public `--status` command, use public `--approve` if the run reaches a human canary gate, and finish by requiring every target verified, no maintenance residue, and a same-SHA no-op plan.

## Validation and Acceptance

Acceptance requires all route-contract rows to report a proof, every registered terminal profile to complete the composed success route, and every mutation/commit boundary to converge after both before and after failure injection. The complete deployment contract command must pass from a clean worktree and leave no temporary resources.

The hosted exact-head checks must be green without rerunning away a deterministic failure. The two live preflight reports must contain zero blockers, zero incomplete proofs, the same target set, and no host-state change. A release is successful only when public status reports success, desired and current SHA match for Pi5 and StoneBase, evidence is verified, maintenance is absent, required services and agents are healthy, and the same-SHA standard plan is a no-op.

## Idempotence and Recovery

All local tests and read-only probes are repeatable. Preflight may create only a bounded lock file or temporary directory already owned by the preflight implementation; it removes temporary artifacts on success, failure, interruption, and timeout. It does not remove or rewrite existing fleet state.

If any local or hosted gate fails, fix the route contract or its implementation and rerun the complete validation sequence. If a new production blocker appears after all gates, stop through the public cancel/status interface, add the missing route proof and regression, and restart the entire twelve-gate sequence. Do not apply a host-specific repair and immediately retry.

## Artifacts and Notes

The first stopped preflight produced no release run and no managed-host mutation. Its deterministic failure was local `ansible-inventory` auto-loading normal `ansible.cfg` and looking for `.vault-pass`. The read-only inventory command from the repository root succeeded, proving the local responsibility mismatch.

## Interfaces and Dependencies

The public CLI names remain unchanged. `--preflight-only` gains a complete JSON report and stable exit semantics: `0` passed, `78` blockers, `70` incomplete audit. Internal route records live only in `route_contract.py`. The preflight sources use only the Python standard library because they are transferred to Pi5 before target checkout execution. No product API, DTO, Prisma schema, or down migration changes are part of this work.

Revision note 2026-07-19: Created this focused plan after the user rejected serial production discovery. It freezes deployment, preserves the local read-only adapter WIP, defines machine-enforced route completeness, expands aggregate preflight, requires before/after boundary rehearsal, and makes two unchanged live preflights a hard release gate.

Revision note 2026-07-19 05:31Z: Implemented the route inventory, boundary/rehearsal coverage checks, standard-library Pi5 route probe, aggregate machine-readable preflight, selected-host evidence, and local read-only inventory boundary. A readable active run is now carried forward as interrupted-recovery work instead of being incorrectly blocked; missing recovery authority fails closed. The complete local deploy contract passed twice with no residual temporary Docker resources; hosted and live read-only gates remain.
