# Milestone 1: Per-kiosk rolling deployment

This ExecPlan is a living document and must be maintained in accordance with `.agent/PLANS.md`.

## Purpose / Big Picture

Operators can deploy one Raspberry Pi 4 kiosk at a time without placing unrelated kiosks into maintenance. Deployment state is merged and removed by deployment run identifier, so concurrent or failed historical state is not erased accidentally. A preflight impact summary prevents a client-only deployment when the selected revision contains server or database changes.

## Progress

- [x] (2026-07-11) Inspected the current per-client deploy-status v2 implementation and staged Ansible flow.
- [x] (2026-07-11) Added a testable atomic deploy-status state manager.
- [x] (2026-07-11) Added revision impact classification and client-only compatibility guard.
- [x] (2026-07-11) Integrated Milestone 1 after local validation and all PR checks passed.
- [x] (2026-07-11) Completed production canary acceptance before starting Milestone 1.5.
- [x] (2026-07-11) Canary deployment succeeded on `raspi4-kensaku-stonebase01` with run `20260711-134711-7114`.
- [x] (2026-07-11) Stopped rollout after the second host exposed root-owned empty state-file handling; no remaining hosts were deployed.
- [x] (2026-07-11) Validated and deployed the ownership/fail-closed correction to all five Pi4 kiosks.

## Surprises & Discoveries

- Observation: both wrapper cleanup and Ansible post-tasks delete the whole deploy-status file.
  Evidence: `clear_pi4_maintenance_flag` uses `rm -f`, and `deploy-staged.yml` uses `state: absent`.
- Observation: the wrapper cleanup condition is inverted for an in-scope kiosk deployment.
  Evidence: `clear_pi4_maintenance_flag_if_needed` clears only when `should_enable_kiosk_maintenance` is false.
- Observation: Ansible's delegated cleanup ran with privilege escalation and replaced the state file with a root-owned empty file.
  Evidence: the next host failed with `PermissionError` writing `/opt/RaspberryPiSystem_002/config/deploy-status.json`.

## Decision Log

- Decision: manipulate state through one Python utility and atomic `os.replace`, rather than embedding more Python fragments in shell and Ansible.
  Rationale: one contract is independently testable and preserves entries owned by other run identifiers.
  Date/Author: 2026-07-11 / Codex.
- Decision: fail a Pi4-only deployment when the revision diff contains API, Web, shared package, Docker, or Prisma changes unless `--client-only-compatible` is explicit.
  Rationale: these paths require the shared Pi5 server in the current architecture.
  Date/Author: 2026-07-11 / Codex.
- Decision: maintenance-state creation is fail-closed and Ansible cleanup runs as the Pi5 deployment user.
  Rationale: a deployment must never continue after the maintenance state could not be published, and subsequent runs must retain write access.
  Date/Author: 2026-07-11 / Codex.

## Outcomes & Retrospective

Milestone 1 is complete in production. All five Pi4 kiosks run `d29d96d8`; `kiosk-browser.service` and `status-agent.timer` are active, all rollout runs ended with `failed=0` and `unreachable=0`, and deploy-status v2 contains no stale kiosk entries. The rollout exposed one root-owned state-file issue after the first canary; the rollout stopped, the implementation was changed to preserve ownership and fail closed, CI passed again, and deployment then completed safely.

## Context and Orientation

`scripts/update-all-clients.sh` is the operator entry point. It writes `/opt/RaspberryPiSystem_002/config/deploy-status.json` on Pi5 before Ansible runs. `infrastructure/ansible/playbooks/deploy-staged.yml` deploys server, kiosk, then signage with serial concurrency one. The new `scripts/deploy/deploy-status-state.py` owns atomic state changes, and `scripts/deploy/classify-deploy-impact.py` classifies a Git revision range.

## Plan of Work

Use the state utility for merge, phase update, run-scoped removal, and failure retention. Replace whole-file deletion in the wrapper and staged playbook. Compute an impact summary before remote preflight, print it, and reject an unsafe client-only target unless the operator supplies the compatibility override. Keep existing command forms working.

## Concrete Steps

From the repository root, run:

    python3 -m unittest scripts/deploy/tests/test_deploy_status_state.py scripts/deploy/tests/test_classify_deploy_impact.py
    bash -n scripts/update-all-clients.sh
    ANSIBLE_ROLES_PATH=infrastructure/ansible/roles ansible-playbook -i infrastructure/ansible/inventory.yml infrastructure/ansible/playbooks/deploy-staged.yml --syntax-check

## Validation and Acceptance

Tests must prove that adding run B preserves run A, removing run A preserves run B, and marking run A failed changes only its entries. Impact tests must prove that API, Web, shared package, Docker, and Prisma paths require the server, while client agent changes do not. A print-plan invocation must display the four impact categories without contacting production.

## Idempotence and Recovery

State operations are idempotent and use an atomic temporary-file replacement. A failed deployment retains only its own entries with phase `failed`. Operators remove a retained run with `deploy-status-state.py remove-run --run-id <id>` after investigation.

## Artifacts and Notes

No production system is modified by local validation.

## Interfaces and Dependencies

The state file remains version 2 and keeps `kioskByClient`. Each entry may contain `maintenance`, `startedAt`, `updatedAt`, `runId`, and `phase`. The utility uses only Python's standard library. The impact classifier emits JSON booleans for `server`, `kiosk`, `signage`, and `migration`.

Revision note: 2026-07-11 recorded production completion on all five Pi4 kiosks and closed Milestone 1.
