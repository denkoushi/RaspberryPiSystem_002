# Kiosk pallet barcode offline queue

This ExecPlan follows .agent/PLANS.md and the structure of [the loan plan](2026-11-03-kiosk-loan-offline-queue.md). Scope is local implementation in this worktree; integrationPending: true.

## Purpose / Big Picture

Persist kiosk pallet add/replace barcode requests in IndexedDB before sending. Keep each request until acknowledgement, retry serially after recovery, and display 未送信 N 件. Duplicate delivery must create only one business update.

## Progress

- [x] (2026-11-04) Inspect loan events/outbox, pallet commands and safety rules; initial worktree clean.
- [x] Add nullable event columns and migration; implement duplicate lookup before target/schedule validation.
- [x] Add dedicated durable FIFO outbox, layout replay, pending display and destructive-action guards.
- [x] Add API, outbox, controller, action-row and layout tests.
- [x] (2026-11-04) Prisma generation, API/web unit checks, both type checks and final diff review.
- [ ] Complete DB-backed verification (blocked: localhost PostgreSQL connection returns EPERM).
- [x] (2026-11-04) Final pnpm -r lint --max-warnings=0 exits 0.

## Surprises & Discoveries

Review changed the readAt policy: like the loan implementation, out-of-range readAt is logged and stored as server time instead of HTTP 400, so requests queued through a long outage or from a terminal with a wrong clock are not rejected and lost. Dependencies were absent in this worktree; offline frozen installation and local workspace package builds are needed before tests. The DB integration suite fails in its existing initial cleanup before either test executes.

## Decision Log

- Decision: For new events, readAt at least five minutes ahead or more than seven days behind is replaced by server time (warning log), matching resolveLoanReadAt. The fingerprint still uses the original readAt, and a previously accepted identical event is acknowledged even after it ages beyond seven days.
  Rationale: Preserve the specified validation and acknowledgement-before-target-validation boundary.
  Date/Author: 2026-11-04 / Codex.
- Decision: Assign insertion sequence inside the IndexedDB readwrite transaction, independently of readAt. Use a single runner promise and Web Locks when available.
  Rationale: Equal timestamps and clock changes must not let later saved scans overtake earlier ones; tabs share the same drain lock.
  Date/Author: 2026-11-04 / Codex.
- Decision: Keep machine/pallet and explicit caller client key alongside queued requests; generate a fresh UUID per business request.
  Rationale: Preserve the destination through navigation and keep barcode-agent eventId outside business identity. Replacement metadata is only for local pending guards, not the API fingerprint.
  Date/Author: 2026-11-04 / Codex.

## Outcomes & Retrospective

Local implementation is complete. API DB-independent coverage passes across 6 files / 40 distinct tests (combined runs); web final scope passes 17 files / 87 tests. Both package type checks and Prisma generation exit 0. DB integration and board-query fixture setup cannot execute because sandboxed PostgreSQL connections return EPERM. Final recursive lint exits 0 with zero warnings. No git mutation, migration application or deployment occurred; integrationPending: true.

## Context and Orientation

apps/api/src/services/pallet-visualization/pallet-event.ts wraps add/replace in pallet-visualization-command.service.ts. MachinePalletEvent retains affectedItemId independently of current items. apps/web/src/features/kiosk/pallet-visualization/offline/ owns its IndexedDB database, serial sender, message hook and layout replay. Existing loan outbox sources are unchanged.

## Plan of Work

API milestone: add optional eventKey/readAt to kiosk schemas and nullable event metadata with a device/key unique index in migration 20261104100000_pallet_offline_events. Compare SHA-256 fingerprints before executing existing commands and after unique conflicts. Save event and business update in the existing transaction without changing pallet locks, ordering or authentication.

Browser milestone: save every request before the first attempt, send the oldest saved record serially and retain network/5xx failures. Remove 4xx once while publishing their server message. Run replay in KioskLayout without changing its server-status content gate. Invalidate all kiosk boards after success. Disable delete/clear only on pallets with pending requests.

Validation milestone: execute focused unit and DB integration tests, Prisma generation, recursive lint and both package type checks. Use temporary Vitest configurations with envDir disabled and the dotenv-loading module mocked so no secret file is read.

## Concrete Steps

From the repository root: pnpm --filter @raspi-system/api exec prisma generate; pnpm --filter @raspi-system/api exec vitest run --config /tmp/pallet-api-vitest.config.mjs with pallet service tests; pnpm --filter @raspi-system/web exec vitest run --config /tmp/pallet-web-vitest.config.mjs src/features/kiosk/pallet-visualization src/layouts/KioskLayout.test.tsx; pnpm -r lint --max-warnings=0; pnpm --filter @raspi-system/api exec tsc --noEmit -p tsconfig.build.json; pnpm --filter @raspi-system/web exec tsc -b. There are no standalone typecheck scripts in these package.json files; these are their existing build type-check steps without bundling.

## Validation and Acceptance

Same-key sequential/concurrent requests return the saved id; changed body/itemId returns EVENT_KEY_REUSED (409). Deleted targets do not break acknowledgement. Legacy bodies work, and out-of-range readAt is stored as server time. Browser tests prove save-before-send, durable failure handling, permanent messages, FIFO/no overtaking, queue cap, controller routing and deletion guards, and layout replay integration.

## Idempotence and Recovery

Migration only adds nullable columns and an index; it has not been applied. Browser storage errors propagate instead of claiming acceptance. HTTP 4xx marks that request failed (kept locally for up to 50 records / 7 days, not counted as pending, message shown until the next accepted request); network/5xx retains it unchanged. readAt is audit metadata only. Do not edit fleet-100-scale-gap-execplan.md, AGENTS.md or docs/AI_START_HERE.md.

## Artifacts and Notes

Validation evidence (2026-11-04; logs are /tmp/pallet-*.log):

- pnpm install --offline --frozen-lockfile --ignore-scripts: exit 0, then pnpm --filter './packages/*' -r build: exit 0. No lockfile changes.
- pnpm --filter @raspi-system/api exec prisma generate: exit 0 (Prisma 7.10.1; about 1 second).
- pnpm --filter @raspi-system/api exec vitest run --config /tmp/pallet-api-vitest.config.mjs src/services/pallet-visualization/__tests__/pallet-offline-events.test.ts: 12 passed (0.44 seconds).
- pnpm --filter @raspi-system/api exec vitest run --config /tmp/pallet-api-vitest.config.mjs src/services/pallet-visualization/__tests__/pallet-offline-contract.test.ts: 6 passed (1.05 seconds).
- Focused existing command tests: 5 passed; schedule resolver: 6 passed; display fields: 5 passed; contracts.snapshot.test.ts: 6 passed (its keys concern loan schemas and require no update). These 22 tests passed in /tmp/pallet-api-test.log, whose combined command also selected the blocked query service suite.
- pnpm --filter @raspi-system/web exec vitest run --config /tmp/pallet-web-vitest.config.mjs src/features/kiosk/pallet-visualization src/layouts/KioskLayout.test.tsx src/pages/kiosk/KioskMobilePalletVisualizationPage.test.tsx: exit 0, 17 files / 87 tests (10.54 seconds).
- pnpm --filter @raspi-system/api exec tsc --noEmit -p tsconfig.build.json: exit 0; pnpm --filter @raspi-system/web exec tsc -b: exit 0, including the final mobile-test update.
- pnpm -r lint --max-warnings=0: final exit 0, zero warnings (about 3 minutes). Initial runs found import ordering and intermediate page JSX diagnostics; corrected before the successful final run.
- git diff --check: exit 0. Initial status was clean; all final changes belong to this task.

DB evidence: pnpm --filter @raspi-system/api exec vitest run --config /tmp/pallet-api-vitest.config.mjs src/services/pallet-visualization/__tests__/pallet-command-concurrency.integration.test.ts fails in initial cleanup, with both tests unexecuted. The selected pallet-visualization-query.service.test.ts also fails before its 14 tests execute. A direct TCP connection check to 127.0.0.1:5432 returns EPERM. These suites were not retried or weakened, and no migration was applied.

Temporary Vitest configurations set envDir: false; the API setup mocks src/config/env/load-dotenv.ts before imports. This prevents runtime .env reads. No secrets were opened. Browser automation was not necessary for this message/disabled-state change.

Implementation adjustments during verification: the mobile page test now mocks durable storage and expects eventKey/readAt on sends. Desktop pending status sits outside the board-data condition so it remains visible when a fresh board fetch fails. docs/INDEX.md contains one link to this plan; the fleet M4 row and forbidden entry-point documents remain unchanged.

## Interfaces and Dependencies

Existing Prisma, Zod, idb, Axios, React and React Query only. No shared loan-queue refactor or new dependency. PalletEventInput exposes optional eventKey/readAt; durable browser bodies require both.

Known limits accepted in review: a request that keeps failing with network/5xx blocks later requests behind it with no retry limit (same as the loan queue). Deletion and clear are disabled only while this terminal has pending requests for the pallet; requests pending on other terminals do not block them.
