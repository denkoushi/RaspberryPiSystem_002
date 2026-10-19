# Self-inspection per-entry operator confirmation and inspector gate

This ExecPlan is a living document and must be maintained according to `.agent/PLANS.md`.

## Purpose / Big Picture

Self-inspection lots may be processed one item at a time even when the planned quantity is five. An inspector must not measure an item while the operator's values are still a draft, but starting inspector work for item 1 must not stop the operator from confirming item 2. After this change, the kiosk list shows operator and inspector progress together, and the inspector selector shows which item is unavailable, available, in progress, or complete.

## Progress

- [x] (2026-08-09) Inspected current API, Web, database schema, documentation, and production read-only evidence.
- [x] (2026-08-09) Created isolated worktree from `origin/main` at the implementation base SHA.
- [x] (2026-08-09) Add pure API slot-state, eligibility, and entry-lock modules.
- [x] (2026-08-09) Change API guards from session-wide to entry-index scope.
- [x] (2026-08-09) Add API DTO state and regression integration tests.
- [x] (2026-08-09) Add Web slot selector, list actions, and state display.
- [x] (2026-08-09) Add Web unit/component/E2E regression tests.
- [x] (2026-08-09) Run isolated Postgres migration, SQL, EXPLAIN, and related tests.
- [x] (2026-08-09) Update ADR, KB, runbook, and this plan with evidence.

## Surprises & Discoveries

- `SelfInspectionLotEntry` already has a unique `(sessionId, entryIndex)` lookup and a `(sessionId, persistenceStatus)` index, so no migration is expected.
- The current inspector save and inspector instrument pre-use paths validate values and employee ownership but do not check `persistenceStatus`.
- The current operator mutation guard counts any inspector entry for the whole session, which blocks unrelated item indexes.
- A read-only production query found one inconsistent entry for product `0003806492`, resource `589`, Saddle, item 3. It will not be changed by this implementation or by a migration.
- The first Playwright mock used `**/api/**`, which also intercepted Vite source paths such as `/src/api/client.ts`; constraining the mock handler to paths beginning with `/api/` restored the application bootstrap.
- On an empty verification database PostgreSQL chose the existing session indexes for the two point lookups rather than the equivalent unique indexes. The requested unique indexes were present in `pg_indexes`; the persistence query used `SelfInspectionLotEntry_idx_session_persistence` as an index-only scan. This is planner selection, not a schema or migration change.

## Decision Log

- Decision: Gate inspector measurement on the corresponding operator entry being `CONFIRMED`, not on the whole lot. Rationale: the shop-floor process advances one item or a few items at a time.
- Decision: Lock only the operator item whose inspector entry exists. Rationale: preserve the snapshot for the inspected item while allowing other items to proceed.
- Decision: Expose per-slot state from the inspector read model. Rationale: the server remains the source of truth and the UI does not duplicate completion rules.
- Decision: Do not auto-repair historical inconsistent rows. Rationale: data correction is a separate controlled operation; the release must not silently mutate production records.

## Outcomes & Retrospective

- `inspector-slot-state.ts` owns only required-slot mapping, state classification, and completion aggregation. It has no Prisma, HTTP, React, or browser dependency and is covered by six pure API tests, including sparse `FULL`, `FIXED_COUNT`, and `FIRST_LAST` slots.
- `inspector-entry-eligibility.ts` is the API application-layer conversion from paired operator state to a stable 409 (`SELF_INSPECTION_OPERATOR_ENTRY_UNCONFIRMED`). `operator-entry-inspector-lock.ts` performs only the paired-row lookup and converts an existing inspector row to `SELF_INSPECTION_OPERATOR_ENTRY_LOCKED_BY_INSPECTOR`. Inspector entry, pre-use, judgement, and operator entry use cases retain authentication, transaction, persistence, and I/O orchestration while delegating these decisions.
- `serialization.ts` and the session query were intentionally not split further: their existing responsibility is DTO assembly, and the change is a thin call to the state module. The 1,435-line session page was not expanded with new state rules; `SelfInspectionEntrySlotSelector` and the React-free presentation model own rendering and selection. The page remains the query/mutation/NFC coordinator.
- The Web presentation model and selector are independently testable; Web unit/component coverage verifies `未/可/中/済`, disabled controls, labels, and initial selection. The Playwright mock verifies the 5-slot inspector view, refresh entry point, accessibility label, and no horizontal overflow at the configured desktop viewport.
- The dedicated integration test verifies all requested audit points: blocked DRAFT inspector save and pre-use produce no `SelfInspectionInspectorEntryInstrumentUsage`, loan, or inspection records; DRAFT final judgement returns 409; concurrent operator confirmation and inspector save cannot leave an operator DRAFT paired with an inspector entry; and an item-level lock leaves other items usable.
- No Prisma model or migration changed. Existing all-required-slot completion remains unchanged. The known production anomaly remains untouched and requires the separate agreed correction plus a zero-count read-only audit before deployment approval.

## Context and Orientation

The API self-inspection use cases are under `apps/api/src/services/part-measurement/self-inspection/`. `inspector-entry.ts` saves inspector measurements, `instrument-pre-use-inspection.ts` handles instrument loans and pre-use records, `use-cases/operator-entry.ts` handles operator create/update/draft flows, `mutation-guards.ts` contains transaction guards, and `shared.ts`/`serialization.ts` build progress and DTOs. The Web kiosk page is `apps/web/src/pages/kiosk/KioskSelfInspectionSessionPage.tsx`; reusable entry-slot and list presentation code is under `apps/web/src/features/part-measurement/`.

`DRAFT` means autosaved values are present but the operator has not pressed the explicit save action. `CONFIRMED` means the operator entry passed full validation and is eligible for inspector measurement. An inspector entry is considered started as soon as its row exists, including when it was created by instrument pre-use registration.

## Plan of Work

Create `inspector-slot-state.ts` as a pure module that maps required slots, operator entries, and inspector entries to `operatorState` (`missing`, `draft`, `confirmed`) and `inspectorState` (`not_started`, `in_progress`, `complete`). Move the aggregate inspector completion calculation there and ignore inspector rows paired with non-confirmed operator rows.

Create `inspector-entry-eligibility.ts` for the reusable 409 guard and stable error code `SELF_INSPECTION_OPERATOR_ENTRY_UNCONFIRMED`. Create an entry-scoped operator lock guard with stable error code `SELF_INSPECTION_OPERATOR_ENTRY_LOCKED_BY_INSPECTOR`. Apply the first guard to inspector entry create/update, inspector pre-use, and inspector judgement save. Apply the second guard to operator create, draft upsert, update, and operator pre-use after the requested entry index is known. Keep the session-row lock as the transaction serialization boundary.

Add `inspectorSlotStates` to the inspector-session DTO. Update record-approval readiness so a full-valued draft remains `input_incomplete` and its inspector row is not counted. Do not change Prisma schema or final all-required-slot completion rules.

Extract the Web selector into `SelfInspectionEntrySlotSelector` and a pure presentation model. Show `未`, `可`, `中`, and `済` states with a legend, disable all inspector inputs and instrument navigation for non-confirmed operator slots, select the first usable slot on entry, and provide a status refresh action. Refactor WIP rows to display both progress counters and multiple workflow links.

Add a dedicated API integration test file for a quantity-five, partially interleaved operator/inspector workflow. Add pure API tests, Web presentation/component tests, and a focused Playwright mock test. Update ADR, KB-408, the kiosk runbook, and navigation links without duplicating the full incident narrative.

## Concrete Steps

Work only in `/Users/tsudatakashi/RaspberryPiSystem_002-self-inspection-entry-gate` on branch `fix/self-inspection-per-entry-inspector-gate`, based at `3c890fb9eaf357e109e8b0e78d42163fce21410e` (`origin/main`). Keep the original worktree untouched. Make small commits by concern (`fix`, `test`, `docs`) and run `git diff --check` before each handoff.

For database verification, start a uniquely named `pgvector/pgvector:pg15` container with no named volume or custom network, use a shell trap to remove only that container, set `DATABASE_URL` to its auto-assigned port, run `pnpm --dir apps/api exec prisma migrate deploy`, run the SQL audit and `EXPLAIN (ANALYZE, BUFFERS)` for the operator unique key, inspector unique key, and persistence-status index, then run the focused related API tests. Never use the repository helper that deletes `postgres-test-local`.

## Validation and Acceptance

The API integration scenario must prove that item 2 with a full-valued `DRAFT` is rejected by inspector save and pre-use without creating inspector or loan side effects; item 1 can be inspected; item 2 can then be confirmed by the operator; item 1 remains operator-locked; and item 2 becomes inspector-eligible after confirmation. API read models must show both counters and correct per-slot states.

Web tests must prove both list actions, the four slot states, disabled controls and accessible labels, initial usable-slot selection, and refresh behavior. Run Web tests, lint, builds, and the focused Playwright specs. Run documentation checks (`git diff --check`, link review, no long lines or duplicated narrative).

Acceptance is complete only when a quantity-five lot can alternate operator confirmation and inspector measurement item-by-item, no inspector measurement can begin from a draft, unrelated operator items remain usable, final completion still requires every required item, and the temporary Postgres container and any temporary resources are gone.

Validation evidence on 2026-08-09:

- `pnpm --dir apps/api exec prisma migrate deploy`: all 157 migrations applied; SQL count of unfinished or rolled-back rows in `_prisma_migrations`: `0`.
- Temporary Postgres related suite: 8 files, 45 tests passed. It included actor authentication, confirmation guard, item invalidation, the dedicated per-entry gate integration file, slot-state, configuration, expected-entry-count, and registration-tag tests.
- Dedicated gate assertions include inspector-side usage model `SelfInspectionInspectorEntryInstrumentUsage`, instrument loans, inspection records, DRAFT final judgement 409, and the concurrent confirmation/save invariant.
- `pnpm --filter @raspi-system/api build` and targeted API lint passed. Web Vitest passed 334 files / 1,679 tests, Web lint passed, and `pnpm --filter @raspi-system/web build` passed.
- Playwright `e2e/self-inspection-inspector-slot-gate.spec.ts` passed after installing the local Chromium runtime. It verifies the state legend, disabled DRAFT slot, refresh control, aria text, and right-pane width.
- EXPLAIN checks found all three requested named indexes. The point lookups used the existing session indexes (`SelfInspectionLotEntry_idx_session_persistence` and `SelfInspectionInspectorEntry_idx_session`); the persistence count used `SelfInspectionLotEntry_idx_session_persistence` via an index-only scan with zero heap fetches.
- The temporary containers were removed by trap after success and failure. No named volume, custom network, existing container, production database, push, PR, or deployment was changed.

## Idempotence and Recovery

The implementation is additive and can be rerun from the feature branch. If a test container fails, remove only the uniquely named temporary container and retry. Do not mutate existing production or development databases. If the production read-only anomaly audit is non-zero, stop release readiness and handle the previously agreed item-level correction separately.

## Interfaces and Dependencies

The new API read-model field is:

    inspectorSlotStates: Array<{
      entryIndex: number;
      operatorState: 'missing' | 'draft' | 'confirmed';
      inspectorState: 'not_started' | 'in_progress' | 'complete';
    }>;

The new API conflict codes are `SELF_INSPECTION_OPERATOR_ENTRY_UNCONFIRMED` and `SELF_INSPECTION_OPERATOR_ENTRY_LOCKED_BY_INSPECTOR`. The pure state module must not import Prisma, Fastify, React, or browser APIs. The Web selector must receive already-derived state and emit only selection, refresh, and page-navigation callbacks.

## Revision Notes

- 2026-08-09: Initial implementation plan created after repository, code, documentation, schema, and production read-only analysis.
- 2026-08-09: Implementation, focused regression coverage, isolated PostgreSQL verification, Web E2E, and documentation completed. Recorded module boundaries, planner behavior, and the preserved production-data blocker.
