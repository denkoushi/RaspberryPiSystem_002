```md
# Kiosk loan offline queue

This ExecPlan follows .agent/PLANS.md. It covers local implementation only. Git mutations, deployment, inventory queue changes, and secret files are excluded.

## Purpose / Big Picture

A kiosk keeps failed NFC borrow and return requests in IndexedDB while the server is unavailable. It shows 未送信 N 件, then sends its queue one request at a time in ascending readAt order. Existing clients without eventKey/readAt continue to work.

## Progress

- [x] (2026-11-03) Inspect existing photo idempotency, loan transactions, inventory outbox, and kiosk callers; initial worktree clean.
- [x] Add nullable database columns and manual migration; implement event fingerprint lookup and time correction.
- [x] (2026-11-03) Integrate the separate kiosk loan outbox and its messages with tool, instrument, and rigging screens.
- [x] (2026-11-03) Add contract tests and execute requested local validation; DB-backed validation blocked by sandbox EPERM.
- [x] (2026-11-03) Review final diff and record local evidence and exclusions. All changes are uncommitted task work.

## Surprises & Discoveries

- All asset types share Loan and Transaction, but measuring instruments and rigging use separate service boundaries. Loan.clientId can change on return, so event identity belongs on Transaction.
- Instrument borrowing currently saves inspection records in separate browser requests after creating the loan. Deferred borrowing must not silently lose the inspected item IDs.
- Rigging's display lookup currently blocks borrowing when the network fails. Only retryable display failures may bypass that lookup.

## Decision Log

- Decision: Store both borrow and return eventKey/fingerprint on Transaction, unique with clientId.
  Rationale: This follows photo-borrow's unique constraint and fingerprint pattern. Loan.clientId is mutable on return from another kiosk; audit transactions retain the originating client, preserving deduplication. Both audit rows are atomic with loan state changes.
  Date/Author: 2026-11-03 / Codex
- Decision: Keep borrowReceivedAt and returnReceivedAt separately from adopted borrowedAt/returnedAt. A readAt at least five minutes ahead or more than seven days behind uses server time and logs a warning.
  Rationale: Preserve both operational and reception times without reordering committed loans or other kiosks.
  Date/Author: 2026-11-03 / Codex
- Decision: Exclude photo capture/upload from the persistent outbox.
  Rationale: Photo bodies and the existing capture/idempotency workflow need separate storage and lifecycle work. Existing photo keys remain unchanged.
  Date/Author: 2026-11-03 / Codex

## Outcomes & Retrospective

Local implementation is complete. API focused tests: 6 files / 140 tests passed. Kiosk feature tests: 199 files / 1707 tests passed. The instrument NFC page tests also passed (2 tests). API and web type checks exited 0; changed TypeScript ESLint checks exited 0 with no warnings. The DB-backed loans suite could not reach PostgreSQL (EPERM); its new concurrency test has not executed against a database. No migration application, git mutation, integration, or deployment was performed. integrationPending: true.

## Context and Orientation

apps/api/src/services/tools/loan.service.ts implements tool loans. The measuring-instruments and rigging loan.service.ts files delegate atomic operations to services/loan/loan-transaction.helpers.ts. New services/loan/loan-event.ts performs event lookup and fingerprint validation before execution and after conflicts. The migration is apps/api/prisma/migrations/20261103130000_loan_offline_events/migration.sql.

apps/web/src/features/kiosk/loan/offline/ holds a separate IndexedDB database, runner, message subscription, and replay hook. It follows the inventory outbox structure without modifying inventory. The runner sends through existing domain clients, retaining eventKey/readAt across retries. KioskLayout starts replay on mount, online events, and a 30-second timer.

## Plan of Work

First add optional API/shared payload fields and nullable database fields. Wrap service borrow/return entry points with fingerprint lookup. Save adopted event times and reception times in their existing atomic transactions. Resolve return client identity from the authenticated kiosk header when eventKey is present.

Then integrate outbox submission and messages with KioskBorrowPage, KioskReturnPage, KioskInstrumentBorrowPage, KioskInstrumentReturnPage, and KioskRiggingBorrowPage. Return retries that encounter a missing, already returned, or cancelled loan are acknowledged and removed. Other permanent replay errors are shown once and removed from the queue; network errors and 5xx remain pending. HTTP 4xx from initial submission propagate directly.

Finally test duplicate requests, mismatched fingerprints, concurrent conflict recovery, time boundaries, durable saving, FIFO replay, and message counts. Inspect only changed files and protect any concurrent WIP.

## Concrete Steps

Run commands from the repository root. Generate Prisma types without connecting to a database using pnpm --filter api exec prisma generate. Build shared-types when required by its package exports. Use focused API Vitest files under routes/tools, services/tools, and routes/__tests__, plus the affected asset service tests. Run pnpm --filter web exec vitest run src/features/kiosk. Run API tsc --noEmit -p tsconfig.build.json, web tsc -b, and ESLint on changed TypeScript files. Keep logs under /tmp and record their final results here.

## Validation and Acceptance

Duplicate eventKey requests return the original loan without another transition; mismatched request bodies return 409. Valid readAt becomes borrowedAt/returnedAt; out-of-range readAt becomes reception time and warns. The kiosk queues only transport failures and 5xx, retains a stable UUID, replays ascending readAt serially, and displays 未送信 N 件. Pending unsent borrows are not synthesized into the server's active-loan list.

## Idempotence and Recovery

The SQL migration only adds nullable columns and unique indexes. Do not run migrate dev or apply migrations locally. Legacy rows have null event keys. IndexedDB save errors propagate instead of claiming durable acceptance. Successful and duplicate-return acknowledgements remove only the corresponding queue entry. No automatic git or deployment actions are permitted.

## Artifacts and Notes

Validation commands and final output:

- pnpm --filter api exec vitest run --config /tmp/loan-api-vitest.config.mjs src/services/tools/__tests__/loan-offline-events.test.ts src/services/tools/__tests__/loan.service.test.ts src/services/measuring-instruments/__tests__/loan.service.test.ts src/services/rigging/__tests__/loan.service.test.ts src/routes/tools/__tests__/contracts.loans.test.ts src/routes/tools/loans/__tests__/device-auth.test.ts
  Final: Test Files 6 passed (6); Tests 140 passed (140); Duration 2.16s.
- pnpm --filter web exec vitest run --config /tmp/loan-web-vitest.config.mjs src/features/kiosk
  Final: Test Files 199 passed (199); Tests 1707 passed (1707); Duration 53.03s.
- pnpm --filter web exec vitest run --config /tmp/loan-web-vitest.config.mjs src/features/kiosk/loan src/pages/kiosk/KioskInstrumentBorrowPage.nfc.test.tsx
  Final: Test Files 4 passed (4); Tests 29 passed (29); Duration 2.37s.
- pnpm --filter api exec tsc --noEmit -p tsconfig.build.json; pnpm --filter web exec tsc -b
  Final: both exit 0, no diagnostics. Prisma generate and local workspace dependency builds completed first.
- ESLint on every changed TypeScript file in api, web, and shared-types, with --max-warnings 0.
  Final: all exit 0. An obsolete instrument callback dependency was removed after moving inspection persistence into the atomic loan request.

The temporary Vitest configurations retain repository settings while setting envDir: false. API setup mocks config/env/load-dotenv.ts before application imports. This prevents reading .env files. Logs are under /tmp/loan-*.log. The first kiosk-wide run exposed four timestamp-format expectations; after normalizing those expectations, the final complete run above passed. Initial exact service assertions were updated to include the added reception timestamps.

DB limitation: src/routes/__tests__/loans.integration.test.ts was attempted and failed in fixture creation with Prisma EPERM (9 existing tests, before adding the new test). The added test named deduplicates concurrent offline events and keeps readAt separate from reception time is not verified against PostgreSQL. The related DB-backed src/routes/__tests__/measuring-instruments.integration.test.ts was not run because the same database is inaccessible. No attempt was made to apply the migration or use migrate dev.

Exclusions and decisions:

- Photo capture/upload borrowing is not queued; the existing photo idempotencyKey is unchanged. Returns of server-known photo loans use the regular return queue.
- Returns of unsent borrows and ordering across devices or already committed loans are excluded as requested.
- A retryable asset/profile display lookup failure must not block durable loan capture. Definite 4xx/configuration errors keep the existing error path.
- Instrument inspection item IDs already loaded in the screen travel with the borrow request and PASS records are saved in the same database transaction. If the inspection profile could not be loaded, only the borrow is queued; no unobserved inspection result is invented. Self-inspection session pre-use recording is a separate existing workflow and is not part of this loan outbox.
- Return screens keep already fetched loan data visible when a background refresh fails. They do not invent loans or maintain a new offline active-loan catalogue.
- Pending requests are retained across outages; permanent replay failures are notified once and removed. The independent IndexedDB store uses the inventory pattern of a 500-pending cap and cleanup of previously failed records during replay. Inventory sources are unchanged.

Changed files (repository-relative):

- apps/api/prisma/migrations/20261103130000_loan_offline_events/migration.sql
- apps/api/prisma/schema.prisma
- apps/api/src/routes/__tests__/loans.integration.test.ts
- apps/api/src/routes/measuring-instruments/index.ts
- apps/api/src/routes/measuring-instruments/schemas.ts
- apps/api/src/routes/rigging/index.ts
- apps/api/src/routes/rigging/schemas.ts
- apps/api/src/routes/tools/__tests__/contracts.loans.test.ts
- apps/api/src/routes/tools/loans/schemas.ts
- apps/api/src/services/loan/loan-event.ts
- apps/api/src/services/loan/loan-transaction.helpers.ts
- apps/api/src/services/measuring-instruments/__tests__/loan.service.test.ts
- apps/api/src/services/measuring-instruments/loan.service.ts
- apps/api/src/services/rigging/__tests__/loan.service.test.ts
- apps/api/src/services/rigging/loan.service.ts
- apps/api/src/services/tools/__tests__/loan-offline-events.test.ts
- apps/api/src/services/tools/loan.service.ts
- apps/web/src/api/domains/rigging.ts
- apps/web/src/api/hooks/tools.ts
- apps/web/src/features/kiosk/borrowMachine.ts
- apps/web/src/features/kiosk/loan/offline/loanOfflineQueueStore.test.ts
- apps/web/src/features/kiosk/loan/offline/loanOfflineQueueStore.ts
- apps/web/src/features/kiosk/loan/offline/loanOutboxRunner.test.ts
- apps/web/src/features/kiosk/loan/offline/loanOutboxRunner.ts
- apps/web/src/features/kiosk/loan/offline/loanQueueRequest.ts
- apps/web/src/features/kiosk/loan/offline/useLoanOfflineQueue.test.tsx
- apps/web/src/features/kiosk/loan/offline/useLoanOfflineQueue.ts
- apps/web/src/features/kiosk/loan/offline/useLoanOutboxReplay.ts
- apps/web/src/layouts/KioskLayout.tsx
- apps/web/src/pages/kiosk/KioskBorrowPage.tsx
- apps/web/src/pages/kiosk/KioskInstrumentBorrowPage.nfc.test.tsx
- apps/web/src/pages/kiosk/KioskInstrumentBorrowPage.tsx
- apps/web/src/pages/kiosk/KioskInstrumentReturnPage.tsx
- apps/web/src/pages/kiosk/KioskReturnPage.tsx
- apps/web/src/pages/kiosk/KioskRiggingBorrowPage.tsx
- docs/AI_START_HERE.md
- docs/plans/2026-11-03-kiosk-loan-offline-queue.md
- packages/shared-types/src/measuring-instruments/index.ts
- packages/shared-types/src/rigging/index.ts
- packages/shared-types/src/tools/index.ts

## Interfaces and Dependencies

Use existing Prisma, Zod, idb, Axios, React, and React Query dependencies. LoanEventInput has optional eventKey and readAt. Browser queue bodies require both fields. No inventory abstraction or shared outbox refactor is introduced.
```

Additional correction: all three return services clamp returnedAt to max(resolved readAt, borrowedAt) and warn when clamped. Failed replay records are excluded from pending counts.

Additional correction validation (2026-11-03):
- API requested Vitest scope: 46 files / 355 tests passed (20.85s).
- Web requested Vitest scope: 41 files / 622 tests passed; one unrelated KioskAssemblyPage thumbnail reference test timed out (45.86s). Its focused rerun passed (2.40s); the full scope was not rerun.
- API `tsc --noEmit -p tsconfig.build.json` and Web `tsc -b`: exit 0, no diagnostics.
- ESLint on changed API/Web/shared-types TypeScript files: exit 0.
- Runtime environment file reads were blocked for the requested Vitest runs. Inventory sources were unchanged. No commit, push, merge, or deployment was performed.
