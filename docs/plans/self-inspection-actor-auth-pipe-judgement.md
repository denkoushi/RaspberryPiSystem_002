---
id: self-inspection-actor-auth-pipe-judgement
status: complete
scope: kiosk-self-inspection
date: 2026-07-13
source_of_truth: true
related_code:
  - apps/api/src/services/part-measurement/self-inspection
  - apps/web/src/pages/kiosk/KioskSelfInspectionSessionPage.tsx
  - apps/api/prisma/schema.prisma
related_docs:
  - ./self-inspection-autosave-callout-template-lock.md
  - ../runbooks/kiosk-part-measurement.md
validation: passed
open_items: []
---

# Self-inspection actor NFC authentication and pipe judgement

This ExecPlan is a living document and follows `.agent/PLANS.md`.

## Purpose / Big Picture

An operator or inspector must scan their employee NFC tag whenever the self-inspection screen is opened, including a WIP restart or browser reload. A different employee may scan during the same visible screen; the original entry owner remains unchanged and every save is attributed to the active NFC authentication. Pipe-thread checks use explicit OK/NG judgement rather than a numeric depth.

## Progress

- [x] 2026-07-13: Inspected the existing self-inspection, template, NFC, paper-report, and test implementation.
- [x] 2026-07-13: Created `feat/self-inspection-actor-auth-pipe-judgement` from `origin/main` without touching the worktree that owns `main`.
- [x] Add the database schema, migration, API contracts, and server-side authentication/audit boundary.
- [x] Add the kiosk NFC coordinator and judgement value UI for operators and inspectors.
- [x] Add focused unit tests and API integration-test coverage for the authentication, immutable owner, audit, and pipe judgement scenarios.
- [x] Update the ADR, Runbook, source-of-truth plan, and validation evidence.

## Surprises & Discoveries

- Observation: the standard `scripts/test/start-postgres.sh` removes `postgres-test-local`; it cannot be used for this work because it may mutate an existing user container.
  Evidence: the script calls `docker stop` and `docker rm` for that fixed name.
- Observation: this Mac's Docker daemon answered read-only listing commands, but `docker network create <unique-name>` did not return after 60 seconds. The isolated migration/integration/SQL validation was therefore stopped with Ctrl-C before a container, volume, or network was created.
  Evidence: `docker ps -a` remained empty and `docker network ls` showed only the default networks after cancellation.
- Resolution: after Docker Desktop was restarted successfully, an isolated `pgvector/pgvector:pg16` PostgreSQL database ran all migrations and the focused API integration tests.
  Evidence: `prisma migrate deploy` applied all 145 migrations; four focused integration tests passed; `EXPLAIN (ANALYZE, BUFFERS)` used `SelfInspectionOperation_idx_session_mode_entry_occurred` with an index scan. Both temporary-resource prefixes were absent from `docker ps -a`, `docker volume ls`, and `docker network ls` after their traps ran.

## Decision Log

- Decision: create a server-backed authentication record per NFC scan and keep only its ID in React memory.
  Rationale: stored entry ownership must not unlock a newly opened page, while audit evidence must survive reload.
  Date/Author: 2026-07-13 / Codex
- Decision: use the existing `InspectionResult` (`PASS`/`FAIL`) enum for pipe judgement but keep it in self-inspection value tables.
  Rationale: vocabulary is already defined, while the measuring-instrument inspection record is a different business aggregate.
  Date/Author: 2026-07-13 / Codex
- Decision: reject paper/OCR and ordinary numeric-sheet use of judgement templates in this increment.
  Rationale: these paths are numeric-only and must fail closed rather than silently misrepresent OK/NG.
  Date/Author: 2026-07-13 / Codex

## Outcomes & Retrospective

- Added additive Prisma migration `20260713110000_self_inspection_actor_auth_pipe_judgement` with numeric/judgement values, judgement snapshots, page-authentication records, operation history, and the session/mode/entry/time index.
- Kiosk authentication is in-memory per mounted session page. Reload/WIP/direct access clears it; an employee scan creates a server record and a later employee scan replaces only the active actor. Employee ownership snapshots remain first-writer-only.
- Pipe `管用` is stored as `ネジ穴深さ` plus `valueKind=judgement`; UI uses OK/NG, API maps it to PASS/FAIL and bypasses numeric review. `キリ穴深さ` exposes existing measurement/through controls.
- Passed local checks: shared-types build, API build, Web build; focused Web tests (63 tests) and API judgement validation tests (2 tests).
- Passed isolated Docker validation using only `rps-selfauth-*` resources: Prisma generation, all 145 migrations via `prisma migrate deploy`, focused API integration tests (2 files / 4 tests), SQL new-column/default verification, and `EXPLAIN (ANALYZE, BUFFERS)`. The operation-history query used `SelfInspectionOperation_idx_session_mode_entry_occurred` with an index scan (0.102 ms for the seeded lookup).
- No existing container, database, volume, or network was modified. The two temporary Docker resource prefixes were confirmed absent after cleanup.

## Context and Orientation

`KioskSelfInspectionSessionPage.tsx` currently considers an existing entry creator enough to unlock the operator page and always unlocks inspector mode. The API trusts optional `employeeTagUid` in write payloads. `SelfInspectionLotEntry` and `SelfInspectionInspectorEntry` hold immutable first-owner fields, but there is no per-operation actor log. Template items are numeric and pipe-thread data is currently stored only as a measurement-point supplement.

## Plan of Work

The API receives a small authentication endpoint that resolves an active employee NFC tag and writes an immutable session/mode/device-bound record. Every operator and inspector mutation requires that record. The entry services validate it inside their existing transaction, preserve the first entry owner, and append a draft, confirmation, or instrument operation record.

Template items gain an explicit numeric-or-judgement value kind. A judgement item is valid only when its label is `ネジ穴深さ` and its parsed thread nominal is `管用`; numeric tolerances are omitted. Numeric validation and completion remain unchanged. Judgement validation accepts only PASS or FAIL and never creates an out-of-tolerance review.

The React page owns an in-memory active authentication. Its NFC coordinator performs authentication scans before accepting input and permits a later employee scan to replace the active authentication. The value panel receives a judgement input mode and renders accessible OK and NG buttons. Both operator and inspector save flows send the active authentication ID.

## Concrete Steps

Work from `/Users/tsudatakashi/RaspberryPiSystem_002`. Add the schema/migration first, run Prisma generation against an isolated database, then add API tests before adapting the kiosk page. Use a unique Docker container, network, volume, and port; never call the fixed-name PostgreSQL helper. Finish with focused tests, builds, SQL schema checks, and an `EXPLAIN (ANALYZE, BUFFERS)` query over the operation-history index.

## Validation and Acceptance

The completed kiosk page must lock both modes after reload despite existing saved values, unlock only after the matching employee scan, allow an employee change on the still-mounted page, and record the actor for every successful draft and confirmation. A `管用` item must show only OK/NG; NG must confirm without a review. A `キリ穴深さ` item must retain the existing measurement/through controls.

## Idempotence and Recovery

Migrations are additive. Existing numeric rows keep their default numeric value kind. Isolated test Docker resources use a unique prefix and a shell `trap` that removes only those exact names. A failed test can be re-run after the trap has cleaned those resources.

## Interfaces and Dependencies

The new `POST /part-measurement/self-inspection/sessions/:id/measurement-actor-authentications` endpoint accepts `{ employeeTagUid, measurementMode }` and returns an immutable authentication ID. Entry, draft, inspector-entry, and instrument-pre-use writes accept `measurementActorAuthenticationId`. Template item DTOs expose `valueKind`; self-inspection value payloads use either numeric `value` or `judgementResult: PASS | FAIL | null`.

Revision note (2026-07-13): created at implementation start so progress, decisions, and validation evidence remain restartable.
