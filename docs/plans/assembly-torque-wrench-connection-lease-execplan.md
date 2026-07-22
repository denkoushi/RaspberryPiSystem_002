---
title: Assembly Torque Wrench Connection Lease
id: plan-assembly-torque-wrench-connection-lease
status: implemented_locally
scope: Pi5-owned physical torque-wrench lease, torque-agent fencing, exact external Bluetooth controller guard, and two-terminal pilot
date: 2026-07-22
source_of_truth: this document
related_code: apps/api/prisma/schema.prisma, apps/api/src/services/torque-wrenches, clients/torque-agent, infrastructure/ansible/roles/client, apps/web/src/pages/kiosk/KioskAssemblyWorkSessionPage.tsx
related_docs: ../decisions/ADR-20260722-assembly-torque-wrench-connection-lease.md, ../runbooks/assembly-torque-agent.md, ./assembly-torque-wrench-traceability-execplan.md
validation: local implementation validation complete; no production deployment is authorized by this plan
open_items: production Release A, Release B, pairing, enforcement activation, and physical acceptance require separate approval and the physical wrench
---

# Add a Fleet-Wide Connection Lease for the Shared Torque Wrench

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept current while the work proceeds. Maintain this document in accordance with `.agent/PLANS.md`.

## Purpose / Big Picture

Operators must be able to carry the physical CEM20N3X10D-BTLA torque wrench to another Raspberry Pi terminal and use it there without two terminals accepting or competing for the same wrench. After this change, Pi5 is the authority for one physical wrench, one client device, and one assembly work session. A kiosk explicitly starts use, renews an eight-second lease, releases it when finished, or confirms that the physical wrench is present before taking over an abandoned lease. The dedicated external Bluetooth adapter is powered only while the local terminal owns a valid lease.

The first production pilot is limited to `raspi4-kensaku-stonebase01` and `raspi4-assembly-01`. This implementation work does not authorize a deployment, a pairing operation, a commit, a push, or a pull request.

## Progress

- [x] (2026-07-22) Confirmed the existing local browser binding, exclusive evdev grab, durable SQLite outbox, assembly row locking, part-measurement edit lock, client identity, and exact external-controller preparation boundaries.
- [x] (2026-07-22) Chose Pi5/PostgreSQL coordination rather than direct Pi-to-Pi messaging, explicit operator start, physical-presence takeover, and Runbook-owned pairing.
- [x] (2026-07-22 16:47 JST) Added the expand-only schema, central lease service/routes, event fencing, and a real-PostgreSQL two-client integration test. The focused API test passes.
- [x] (2026-07-22 16:49 JST) Added the torque-agent explicit lease state machine, local API, durable event lease snapshots, HID cancellation, fail-closed renewal behavior, and focused tests. Ruff and 43 pytest tests pass.
- [x] (2026-07-22 18:00 JST) Completed the host guard, exact-controller idempotent helper, one-second deadline reconciliation, four-second command bound, Ansible/Compose wiring, rollback ownership, and tests proving the unrelated internal Bluetooth rfkill remains unchanged.
- [x] (2026-07-22 17:55 JST) Completed the kiosk explicit start/release, owner display, two-step takeover, Bluetooth-wait/ready/communication states, and seven focused UI tests.
- [x] (2026-07-22 18:14 JST) Updated the ADR, Runbook, global/AI indexes, two-terminal physical acceptance checklist, and document inventory.
- [x] (2026-07-22 18:14 JST) Completed focused and full local validation without contacting production hosts.
- [x] (2026-07-22 16:50 JST) Reached a safe local pause point requested for 17:00: no deployment, pairing, commit, push, or production-host contact was performed. Remaining guard/UI contract coverage and full validation are recorded below.

## Surprises & Discoveries

- Observation: The current `torque-agent` loopback heartbeat proves only that the local HTTP process answered; it does not prove a fleet lease, Bluetooth power, HID presence, or exclusive grab.
  Evidence: `KioskAssemblyWorkSessionPage.tsx` marks `agentConnected=true` on any successful `/heartbeat`, while `torque_agent/main.py` returns only `ok` and `bound`.

- Observation: The current external-controller unit powers the configured UB500-class controller on during provisioning and leaves it powered.
  Evidence: `torque-bluetooth-adapter.sh.j2` unblocks exact rfkill and calls bounded `btmgmt power on`, but has no runtime owner or power-off path.

- Observation: A container-only controller switch cannot fail closed after an abrupt container crash.
  Evidence: the torque container is privileged, but Docker health does not power the host controller off. A separate host systemd guard must own the final timeout.

- Observation: The migration gate accepts new tables and nullable built-in columns on existing tables, but rejects triggers and contract constraints on existing populated tables.
  Evidence: `scripts/deploy/validate-expand-only-migrations.py` implements an explicit allow-list.

- Observation: A taken-over lease may deliberately have `connectAfter` later than its first eight-second expiry when the old owner was just renewed. The new owner must continue renewing while waiting, and only the guard/HID activation waits.
  Evidence: the focused API test verifies generation fencing immediately and a future `connectAfter`; `ConnectionLeaseManager` renews during `handoff_wait` without writing an ON intent early.

- Observation: A business rejection must remain HTTP 200 so an old durable event cannot block the SQLite outbox head.
  Evidence: the real-PostgreSQL focused test receives `CONNECTION_LEASE_REQUIRED` and `CONNECTION_LEASE_FENCED` as retained rejected records with status 200, while a delayed event for the still-current generation is accepted.

- Observation: A current lease row must not prevent ordinary deletion of its owner session or client device, while transition history must remain independent.
  Evidence: the first full API run exposed restrictive current-row foreign keys through 35 existing cleanup failures. Changing only the current row's owner FKs to `ON DELETE CASCADE`, recreating the disposable database, and rerunning the failed suites produced 46/46 passing tests; the history table retains scalar snapshots and no parent FK.

## Decision Log

- Decision: Use one current lease row per `TorqueWrenchProfile`, serialized by a PostgreSQL row lock, plus append-only transition history.
  Rationale: the physical wrench is already represented by a profile, and a single row provides an unambiguous fleet-wide owner without a process-local mutex.
  Date/Author: 2026-07-22 / Codex with user approval.

- Decision: Use an eight-second server and local lease with a two-second renewal cadence; the host guard polls every second.
  Rationale: these values retain the existing browser binding behavior and bound disconnect time to nine seconds.
  Date/Author: 2026-07-22 / Codex with user approval.

- Decision: Require an explicit acquisition request identifier generated by the kiosk action, and never reacquire automatically after fencing.
  Rationale: an old open page must not steal the wrench back from the terminal that performed a physical-presence takeover.
  Date/Author: 2026-07-22 / Codex.

- Decision: Keep pairing outside the kiosk and automate only saved-bond connection exclusivity.
  Rationale: pairing has additional BlueZ privilege, discovery, timeout, and wrong-device risks; the user selected Runbook-owned pairing.
  Date/Author: 2026-07-22 / Codex with user approval.

- Decision: Separate Release A capability deployment from the irreversible per-profile enforcement activation.
  Rationale: the rollback baseline must already understand leases before the existing wrench is made lease-required.
  Date/Author: 2026-07-22 / Codex with user approval.

## Outcomes & Retrospective

Release A capability is implemented and validated locally. The database/API, agent, host guard, kiosk flows, deployment contracts, Runbook, and rollback boundary are complete in the working tree. Full API/Web tests, builds, lint, agent checks, Bluetooth guard checks, migration/deploy contracts, Ansible syntax, and documentation audit pass. No production behavior is claimed: no managed host was contacted, and deployment, pairing, enforcement activation, and the physical two-terminal acceptance sequence remain deliberately open because the wrench is unavailable and each action requires separate approval.

## Context and Orientation

All Pi4 terminals authenticate to one Pi5 API with a client key. `AssemblyWorkSession.clientDeviceId` already binds a work session to a terminal. The torque agent runs in a privileged Docker container on a Pi4, reads only configured `/dev/input/by-id` HID links, grabs the input device through evdev, writes parsed events to a local SQLite outbox, and sends them to the Pi5 assembly API. Its existing browser binding is process-local and expires after eight seconds.

A connection lease is a short-lived Pi5 database record granting one terminal and one work session the right to use one registered physical wrench. A fencing generation is an integer incremented on every acquisition or takeover. Once a newer generation exists, events and renewals from an older generation are rejected even if the old terminal is delayed. The host Bluetooth guard is a root-owned systemd service that powers the exact configured external USB controller on only while it sees a fresh local lease-intent file written after a successful Pi5 renewal.

The schema lives in `apps/api/prisma/schema.prisma`. Torque-wrench routes and validation live under `apps/api/src/routes/torque-wrenches`, and the traceability intake lives in `apps/api/src/services/torque-wrenches/assembly-torque-traceability.service.ts`. The client is in `clients/torque-agent`. Host provisioning is under `infrastructure/ansible/roles/client`, and the work UI is `apps/web/src/pages/kiosk/KioskAssemblyWorkSessionPage.tsx`.

## Plan of Work

First, add an expand-only migration containing two new tables and nullable columns on the existing profile and torque-record tables. Implement a lease service that locks the profile and current lease in one transaction, validates the client-bound work session and confirmation, and exposes acquire, renew, release, physical takeover, status, and ADMIN/MANAGER enforcement activation. Extend agent event intake with optional lease fields for Release A compatibility; once `connectionLeaseEnforcedAt` is set, missing, wrong-owner, wrong-session, or older-generation events become retained `rejected` audit records.

Second, split the torque agent's current binding from its connection lease. Local `/lease/acquire`, `/lease/takeover`, and `/lease/release` actions call Pi5 with the terminal client key. A successful owner lease permits `/heartbeat` to maintain the work binding and writes a fresh local controller intent. A failed renewal, expired browser heartbeat, fencing response, or shutdown clears binding, stops the HID reader, removes controller intent, and best-effort releases the server lease. Every queued event snapshots the lease ID and generation before SQLite insertion.

Third, extend the exact-controller helper with bounded idempotent power-on, power-off, and status operations. Install a Python systemd guard that validates an atomic intent containing the current Linux boot ID and local monotonic deadline. Invalid, absent, stale, or cross-boot intent always requests power-off. The helper continues to discover by exact USB vendor/product and never persists `hciN`.

Fourth, change the assembly work page so physical confirmation does not silently acquire. The operator explicitly starts use, sees the remote owner when blocked, can perform a two-step physical-presence takeover, and explicitly ends use. Readiness requires server ownership, guard power, HID presence, and exclusive grab rather than only loopback HTTP availability.

Finally, add the two pilot host variables, update deployment safety contracts and documentation, and run all focused and full local validation. Do not contact managed hosts during implementation validation.

## Concrete Steps

Work from `/Users/tsudatakashi/RaspberryPiSystem_002`. Preserve all pre-existing uncommitted Assembly-01 provisioning changes. Use `apply_patch` for tracked edits.

After each subsystem, run its focused tests. At the end run:

    cd /Users/tsudatakashi/RaspberryPiSystem_002
    pnpm --filter @raspi-system/api test
    pnpm --filter @raspi-system/web test
    pnpm --filter @raspi-system/api build
    pnpm --filter @raspi-system/web build
    pnpm lint
    cd clients/torque-agent && poetry run pytest && poetry run ruff check .
    cd ../.. && bash scripts/ci/run-deploy-contracts-local.sh
    node scripts/docs/audit-docs.mjs --check
    git diff --check

Use a disposable PostgreSQL instance for the complete migration ledger and lease concurrency integration tests. Clean up only the explicitly created disposable resources.

## Validation and Acceptance

The API tests must prove that two clients racing to acquire one profile yield exactly one owner; owner renew works; non-owner renew and release fail; an expired lease can be reacquired with a higher generation; physical takeover fences the old generation and returns a finite connection delay; and enabling enforcement is irreversible through the public API.

Traceability tests must prove that a valid owner event advances the bolt, a same-generation durable outbox retry remains idempotent, and missing, wrong-owner, wrong-session, or older-generation events produce retained rejected records without advancing the bolt. A rejected event must receive a successful API response so the agent acknowledges it.

Agent tests must prove that confirmation reuse does not acquire, only an explicit request identifier starts acquisition, repeated browser heartbeats renew but do not reacquire after fencing, every queued event contains its lease snapshot, and loss of Pi5 renewal clears controller intent. Guard tests must prove power-off for missing, malformed, stale, and wrong-boot intent; power-on only for a fresh intent; and power-off no later than the eight-second deadline plus one poll interval.

Web tests must prove every displayed state and the two-step physical takeover. Infrastructure tests must prove exact USB identity, bounded controller commands, power-off default, guard lifecycle ownership, and unchanged NFC/internal-Bluetooth behavior.

Production physical acceptance remains a later approved action and must follow the sequence in `docs/runbooks/assembly-torque-agent.md`.

## Idempotence and Recovery

The migration is additive and can be reapplied through Prisma safely. Lease acquire, renew, and release endpoints use lease ID, generation, and request ID for idempotency. The guard treats every operation as desired-state convergence, so restarts and USB replug repeat safely. `/run` is cleared at reboot, making the safe initial controller state OFF.

Before enforcement activation, Release A may roll back to the existing runtime while Assembly-01 remains unpaired. After activation, rollback is limited to a lease-capable runtime; if an older runtime must be restored, stop both torque agents first. Never delete the SQLite outbox or lease history during recovery.

## Artifacts and Notes

The implementation must not write the real wrench serial number into new public documentation or test fixtures. Inventory already contains the approved exact HID identity and remains the deployment source for that secret-adjacent value.

Final local validation evidence at 2026-07-22 18:14 JST:

    API focused real-PostgreSQL integration plus prior cleanup regressions: 46 tests passed
    API full suite: 453 files, 2362 passed, 7 external-integration tests skipped
    torque-agent Ruff: passed
    torque-agent pytest: 43 passed
    Web focused test: 7 passed
    Web full suite: 297 files, 1469 passed
    API TypeScript build: passed
    Web production build: passed (existing bundle-size/browser-data warnings only)
    root lint: passed
    Bluetooth helper/guard/template focused unittest: 21 passed
    full deploy contracts including migration gate and Ansible syntax: passed
    document inventory audit: passed
    git diff --check: passed

Physical acceptance, deployment, pairing, and activation have not run. They require the wrench, access to both pilot terminals and Pi5, and separate explicit approvals.

## Interfaces and Dependencies

The Pi5 API adds `GET /api/torque-wrenches/:id/connection-lease` and POST actions `acquire`, `renew`, `release`, `takeover`, and `enforcement/enable`. Client actions authenticate with `x-client-key`; activation authenticates with ADMIN or MANAGER JWT. Lease status is one of `available`, `owned_by_self`, `owned_by_other`, `handoff_wait`, or `expired`. Only the owner response contains the opaque lease ID and generation.

The loopback agent keeps `/heartbeat` for the work binding and adds `/lease/acquire`, `/lease/takeover`, and `/lease/release`. `/health` returns process health separately from `ready`, plus lease, controller, and HID state. No new external Python dependency is required for the host guard.

Revision note 2026-07-22: Initial self-contained plan created from the user-approved implementation design and repository inspection. No implementation or deployment result has been recorded yet.

Revision note 2026-07-22 16:50 JST: Recorded the safe pause boundary, focused validation evidence, and exact remaining work. The disposable local PostgreSQL container is stopped before handoff.

Revision note 2026-07-22 18:14 JST: Resumed without the physical wrench, completed the remaining guard/UI/documentation work, hardened confirmation freshness and current-row deletion behavior, and completed full local validation. Production and physical acceptance remain gated.
