# Kiosk self-inspection table, selectable filters, and employee NFC search

This ExecPlan is a living document maintained in accordance with `.agent/PLANS.md`. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` describe the implementation as it now exists and must remain current if this work is changed later.

## Purpose / Big Picture

The kiosk self-inspection list previously displayed a sparse card grid. After this change, an operator can see more work at once in compact tables: two panes from 1280 through 1535 pixels, three panes at 1536 pixels and wider, and one pane below 1280 pixels. The 60-pixel page title bar contains the movement-ticket scanner, employee-name NFC scanner, record-approval link, editable product/order and resource filters, clear action, and a single-line status area.

The two filter fields still accept typing and still search production-schedule candidates with the existing API semantics. They now also offer choices sourced only from rows currently rendered on the page. The employee NFC action reuses the existing NFC event stream and tag-resolution endpoint, then filters the at-most-200 loaded work-in-progress sessions by stable employee ID. This distinguishes employees who have the same display name. The inspection-drawing page no longer shows the title-bar actions `部品測定へ` and `新規`, while its tenkey, drawing library, row-level `雛形` action, edit routes, and creation routes remain intact.

## Progress

- [x] (2026-07-14 09:40 JST) Read repository rules, `.agent/PLANS.md`, the self-inspection knowledge base and runbook, existing web/API code, NFC resolver, session serializers, tests, and Prisma schema before making the implementation plan.
- [x] (2026-07-14 09:55 JST) Fetched `origin/main` and created `feat/kiosk-self-inspection-table-nfc` directly from that commit because another worktree owns local `main`.
- [x] (2026-07-14 10:20 JST) Added ordered stable participant identities to the common API summary contract and all summary-producing paths, without changing the database schema.
- [x] (2026-07-14 10:45 JST) Added pure row, option, and balanced-pane functions plus reusable combobox and table components with focused tests.
- [x] (2026-07-14 10:58 JST) Integrated the 60-pixel header, search-mode coordination, movement-ticket regression behavior, and one-shot employee NFC filtering.
- [x] (2026-07-14 11:03 JST) Removed only the two inspection-drawing title-bar actions and updated the page regression test and development preview.
- [x] (2026-07-14 11:08 JST) Updated `docs/knowledge-base/KB-320-kiosk-part-measurement.md` and `docs/runbooks/kiosk-part-measurement.md`.
- [x] (2026-07-14 11:20 JST) Applied all 144 migrations and ran participant SQL, `EXPLAIN (ANALYZE, BUFFERS)`, and 71 related integration tests in uniquely named disposable Postgres resources, then verified complete cleanup.
- [x] (2026-07-14 11:21 JST) Passed responsive Playwright acceptance at 1280x760, 1536x864, and 1920x1080 plus the inspection-drawing acceptance check; visually inspected all four screenshots.
- [x] (2026-07-14 11:41 JST) Passed the final full API and Web test suites and completed lint, build, browser, and diff checks after all contract assertions were added.

## Surprises & Discoveries

- Observation: Local `main` could not be checked out in this worktree because `/private/tmp/raspi-phase3` owns it.
  Evidence: `git switch main` returned `fatal: 'main' is already used by worktree at '/private/tmp/raspi-phase3'`. The feature branch was therefore created directly from the fetched `origin/main` commit, which gives the same base without altering the other worktree.
- Observation: Product/order and resource input does not filter the loaded work-in-progress list. Any non-empty valid search switches the main area to eligible production-schedule candidates.
  Evidence: `KioskSelfInspectionPage` disables both session queries while search input is present and enables `useKioskProductionSchedule`; the refactor deliberately preserves this contract.
- Observation: Historical session summaries had display-name snapshots but no stable participant identity, although each lot entry already stores `createdByEmployeeId`.
  Evidence: no Prisma change was needed. The new participant query reads the existing lot-entry columns and excludes null employee IDs only from ID-based matching, while preserving their snapshot names in `participantEmployeeNames`.
- Observation: The participant query remains bounded by the requested session IDs and uses the existing persistence index.
  Evidence: with 20,000 temporary lot entries, PostgreSQL chose `Bitmap Index Scan on SelfInspectionLotEntry_idx_session_persistence`; the three-session sample read 300 source rows and completed in 0.809 ms.
- Observation: the Web suite prints jsdom XHR diagnostics for unrelated tests that attempt `127.0.0.1:8080`, but those diagnostics are expected stderr rather than failures.
  Evidence: the final command still completed successfully with 283 files and 1,419 tests passed.
- Observation: reset uses a deliberately small `serializeResetNewSession` response rather than the main session serializer, so it needed an explicit empty participant contract.
  Evidence: the strengthened disposable-DB integration assertion initially received `undefined`; adding both empty arrays to that serializer made all 71 related tests pass.
- Observation: one disposable Prisma migration launch returned an intermittent schema-engine error before applying data changes.
  Evidence: the installed trap removed its unique container, volume, and network; a fresh uniquely named retry applied all 144 migrations and passed. No existing Docker or database resource was contacted.

## Decision Log

- Decision: Preserve typed and dropdown-selected product/resource values on the existing `q` and `resourceCds` production-schedule query.
  Rationale: Operators need the existing start-candidate workflow; changing the fields into local work-in-progress filters would be a behavior regression. Only movement-ticket scanning sets exact `productNos` and can auto-open a sole resource-qualified candidate.
  Date/Author: 2026-07-14 / Codex
- Decision: Freeze combobox choices when the menu opens.
  Rationale: background refetches must not reorder or replace a list while an operator uses the keyboard or touch. Each opening snapshots only rows that are rendered in the main area at that moment.
  Date/Author: 2026-07-14 / Codex
- Decision: Split rows into contiguous balanced chunks rather than distributing every nth row to a pane.
  Rationale: reading down the left table and then the next table preserves the source order while keeping pane sizes within one row of each other.
  Date/Author: 2026-07-14 / Codex
- Decision: Employee NFC search clears product/resource filters, stops movement-ticket scanning, and filters only the loaded session summaries by exact employee ID.
  Rationale: this matches the approved displayed-only scope, distinguishes duplicate names, and avoids an unbounded employee-history query or a new endpoint.
  Date/Author: 2026-07-14 / Codex
- Decision: Add optional Web support and additive API output for `participantEmployees`, retaining `participantEmployeeNames`.
  Rationale: the API can deploy before or after the Web client without breaking display compatibility. The Web client never falls back to ambiguous name matching when the new field is absent.
  Date/Author: 2026-07-14 / Codex
- Decision: Do not add a migration or ADR.
  Rationale: the required employee ID is already persisted, the public change is backward-compatible, and no new architectural or persistence boundary was introduced.
  Date/Author: 2026-07-14 / Codex

## Outcomes & Retrospective

The requested behavior is implemented on `feat/kiosk-self-inspection-table-nfc`. Work-in-progress and start-candidate cards are replaced by a shared discriminated table-row model and responsive tables. Session actions, draft visibility, confirmed-only progress, combined in-progress/review-pending ordering, 200-row truncation warning, candidate pagination, movement-ticket exact search, and paper/digital workflow selection remain available.

Employee participation is now serialized consistently through list, resolve, complete, reset, out-of-tolerance approval, and record-approval results. Same-name employees remain distinct by ID; deleted historical employees remain displayable by their name snapshot but cannot match NFC search. No migration was generated.

All requested automated gates passed. The implementation also includes a deterministic Playwright acceptance test, which makes future layout regressions observable without a production database. No deployment, push, pull request, merge, or existing database/Docker resource mutation was performed.

## Context and Orientation

The repository is a pnpm workspace. `apps/web` contains the React kiosk client, `apps/api` contains the Fastify/Prisma API, and `e2e` contains Playwright browser tests. A “session summary” is the compact API object used by self-inspection lists and mutation results. A “candidate” is a production-schedule row from which a new self-inspection session can be started. A “pane” is one independently headed table in the responsive main area.

`apps/web/src/pages/kiosk/KioskSelfInspectionPage.tsx` coordinates query mode, scanning, navigation, and modal state. Presentation and pure transformations live in `apps/web/src/features/part-measurement/SelfInspectionFilterCombobox.tsx`, `SelfInspectionTable.tsx`, and `selfInspectionTableModel.ts`. Their adjacent test files cover keyboard behavior, ARIA roles, row presentation, candidate choices, pane splitting, and breakpoint behavior. `e2e/self-inspection-table-layout.spec.ts` mocks only the browser-facing API responses and verifies the three target viewport sizes and inspection-drawing title bar.

On the API, `apps/api/src/services/part-measurement/self-inspection-participant-names.query.ts` performs the session-ID-bounded SQL lookup. `self-inspection-participant-names.ts` contains pure ordered deduplication. `self-inspection/serialization.ts` is the common summary serializer, and `self-inspection.service.ts` supplies participant data to all relevant response paths. `apps/web/src/features/part-measurement/types.ts` defines the rolling-compatible optional Web field.

The operational contract is documented in `docs/knowledge-base/KB-320-kiosk-part-measurement.md`; manual verification instructions are in `docs/runbooks/kiosk-part-measurement.md`.

## Plan of Work

The implementation first extends the API summary without changing persistence. For every requested session ID, one query obtains name snapshots and non-null employee identities ordered by the first lot-entry index. Pure functions deduplicate names and IDs independently. The common serializer emits both arrays, ensuring list and mutation responses cannot drift.

The Web implementation maps session summaries and production-schedule candidates into a discriminated row model. The table receives action descriptions or callbacks rather than routing logic, so it does not need to know how a session or candidate navigates. Pure helpers build unique product and resource options and split source rows into contiguous chunks. The combobox owns only interaction state, snapshots options on opening, and exposes ordinary `onChange` and `onSelect` callbacks.

The page controller preserves its two modes. Empty fields show combined loaded sessions; text or a resource shows candidate search. Starting either scanner stops the other. A resolved employee clears both fields and filters loaded sessions by `participantEmployees.employeeId`; any non-employee result ends waiting and shows a one-line error without setting a filter.

Finally, the inspection-drawing production page and development preview remove their two title-bar buttons without deleting routes or lower-level creation actions. Documentation and browser tests describe and prove the resulting contract.

## Concrete Steps

The branch was created from the latest remote main in `/Users/tsudatakashi/RaspberryPiSystem_002` with the equivalent of:

    git fetch origin
    git switch --detach origin/main
    git switch -c feat/kiosk-self-inspection-table-nfc

The detached-base form was necessary only because local `main` was already checked out by another worktree. A fresh clone or ordinary worktree can instead use the originally planned `git switch main`, `git pull --ff-only origin main`, and `git switch -c` sequence.

The final repository gates are:

    pnpm --filter @raspi-system/web test
    pnpm --filter @raspi-system/web lint
    pnpm --filter @raspi-system/web build
    pnpm --filter @raspi-system/api test
    pnpm --filter @raspi-system/api lint
    pnpm --filter @raspi-system/api build
    git diff --check

For responsive acceptance, start the Web development server on port 4173 and run the isolated browser test:

    pnpm --filter @raspi-system/web dev --host 127.0.0.1 --port 4173
    pnpm exec playwright test e2e/self-inspection-table-layout.spec.ts --project=chromium --workers=1 --reporter=line

Set `SELF_INSPECTION_E2E_SCREENSHOT_DIR` to an existing temporary directory when screenshots are wanted. The test never writes screenshots unless that variable is provided.

## Validation and Acceptance

The full Web suite must report 283 passed files and 1,419 passed tests. The full API suite, when connected to a fully migrated disposable database, must report 445 passed files, 2 skipped files, 2,282 passed tests, and 7 skipped external-storage tests. Both lint commands and both builds must exit zero, as must `git diff --check`.

The participant-focused API tests prove first-entry ordering, duplicate ID suppression, same-name/different-ID retention, null-ID exclusion from NFC identity, and legacy name compatibility. The integration suite proves the added field is present on list, resolve, complete, reset, and approval-family summary responses. The Web tests prove typed `q`, exact scan `productNos`, sole-candidate auto-open only for movement scanning, frozen rendered-row choices, combobox keyboard/ARIA behavior, one-shot NFC processing, exact same-name employee selection, non-employee errors, mutual filter clearing, table actions, and contiguous pane order.

The browser test must report four passed tests. At 1280x760 it asserts two tables; at 1536x864 and 1920x1080 it asserts three. In all sizes it asserts a 60-pixel non-overflowing title bar, 44-pixel controls, unchanged row order, and all expected header controls. Its inspection-drawing case proves the two title-bar actions are absent while the tenkey and row-level `雛形` action remain.

The disposable database check uses `pgvector/pgvector:pg16`, a random localhost port, and uniquely named container, volume, and network resources. It applies all existing migrations, verifies migration status, seeds only temporary rows, executes participant SQL directly, measures it with `EXPLAIN (ANALYZE, BUFFERS)`, and runs the related integration test. A shell trap removes every created resource on success, failure, or interruption. The final evidence was 144 applied migrations, 71 related integration tests passed, the existing session/persistence index selected, and no matching Docker resources remaining.

## Idempotence and Recovery

All code/test commands are safe to rerun. Browser API responses are fully mocked. Database validation must always generate a new timestamped prefix and must never use the repository’s fixed-name Postgres helper, because that helper may replace a container with the same name. Do not connect to an existing database for seed or migration checks. Install the cleanup trap before creating any network, volume, or container; after the run, check `docker ps -a`, `docker volume ls`, and `docker network ls` for the unique prefix.

If a disposable migration attempt fails during Prisma startup, allow the trap to clean it, verify no prefixed resources remain, and retry with a new prefix. Do not reuse or manually repair the failed temporary volume. No application rollback requires a schema rollback because this change has no migration.

## Artifacts and Notes

Key successful transcripts were:

    Web:  Test Files 283 passed (283); Tests 1419 passed (1419)
    API:  Test Files 445 passed | 2 skipped (447); Tests 2282 passed | 7 skipped (2289)
    Related API integration: 71 passed
    Playwright: 4 passed
    PostgreSQL plan: Bitmap Index Scan on SelfInspectionLotEntry_idx_session_persistence
    PostgreSQL sample: 300 source rows; Execution Time 0.809 ms
    Docker cleanup: API_FULL_CLEANUP_OK

The additive summary field is:

    participantEmployees: Array<{
      employeeId: string;
      displayName: string;
    }>;

The Web DTO makes this field optional only for rolling deployment compatibility and treats absence as an empty array. It never substitutes `participantEmployeeNames` for identity matching.

## Interfaces and Dependencies

`collectParticipantEmployees(rows)` in `self-inspection-participant-names.ts` accepts lot-entry rows containing `entryIndex`, `createdByEmployeeId`, and `createdByEmployeeNameSnapshot`; it returns first-entry-ordered, employee-ID-deduplicated `{ employeeId, displayName }` objects. `loadParticipantSummariesBySessionIds(prisma, sessionIds)` in the query module returns both compatible names and stable identities grouped by session ID. `serializeSessionSummary(session, completedEntryCount, participantNames, participantEmployees)` is the single serializer used throughout the service.

`splitIntoBalancedPanes(rows, paneCount)` is pure and returns contiguous arrays whose lengths differ by at most one. `buildProductFilterOptions(rows)` and `buildResourceFilterOptions(rows)` are pure, stable-order, deduplicating option builders. `SelfInspectionTable` receives rows plus an `onCandidateSelect` callback; routing is represented in row actions rather than embedded in the table. `SelfInspectionFilterCombobox` receives current value, opening-time source options, accessible label, and change/select callbacks.

No new runtime package, external service, API endpoint, WebSocket, table, index, or migration was introduced. React Query, React Router, the existing `useNfcStream`, the existing NFC resolver endpoint, Prisma, and PostgreSQL are reused.

Revision note (2026-07-14): Replaced the initial implementation outline with the completed, self-contained as-built plan and recorded final validation evidence so a future contributor can reproduce and audit the result from this file alone.
