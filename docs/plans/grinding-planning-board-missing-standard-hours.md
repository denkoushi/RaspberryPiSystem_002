# Show missing standard hours on the grinding planning board

This ExecPlan follows `.agent/PLANS.md`. Scope is local implementation and focused validation only.

## Purpose / Big Picture

Show active SCAW processes absent from the schedule CSV as read-only dashed markers labeled `{工順} 標準工数入力忘れ`. They have no duration and cannot edit a borrowed process.

## Progress

- [x] (2026-11-14) Confirmed clean worktree and read applicable rules; mapped sync, projections, caches and writes.
- [x] (2026-11-14) Added the new table/migration and locked transactional replacement; schedule ingest reuses already-loaded mail rows to refresh donors and remove newly scheduled processes.
- [x] (2026-11-14) Added read-only projection, unknown counts, duration exclusion and generation invalidation in the existing fingerprint SQL query.
- [x] (2026-11-14) Added 128px normal / 70px forward markers; kept existing 72px unknown markers. Disabled mutations, automatic ordering and missing-item editing through the own-minute sheet.
- [x] (2026-11-14) Shared build, Prisma generation, API/web TypeScript checks and 20 focused test files passed: 948 passed, 11 existing dedicated-DB tests skipped.
- [x] (2026-11-14 follow-up) Made schedule-ingest candidate refresh non-blocking, aligned parent-due inputs with normal bars, and narrowed the transactional schedule read to four scalar columns. UI appearance required no change; API typecheck and five related Vitest files passed (102 tests).

## Context and Orientation

`fkojunst-status-mail-sync.pipeline.ts` normalizes retained mail rows and chooses latest per manufacturing order/process/resource. `grinding-planning-board/read.ts` builds cached board payloads; write projections are separate. Completion UI uses sourceRowId, so both public IDs for missing processes must be synthetic. The borrowed CSV row ID stays internal.

## Plan of Work

Persist candidates in `ProductionScheduleMissingStandardHoursProcess` under the existing mail critical transaction lock. Select S/R triple winners with a schedule donor, no scheduled process on any resource, and no strictly newer mail resource for the same order/process. Restrict resources to those present anywhere in the schedule at materialization; apply the existing category policy on read. Refresh on schedule ingest too. Choose the smallest numeric process order (text order for nonnumeric values), then row ID; borrow CSV identity, supplement quantity/end date and donor parent-due inputs (latest row-note due and Excel/manual authority times), never item overrides/completion/split/rank state.

Read candidates once with indexed dashboard selection and primary-key joins, then create items only on the read path. Use null minutes and count them as existing unknown-duration items. Add table count/max(updatedAt) to board and load generations in the existing resource-override fingerprint query (no additional generation query); source caches remain unchanged. Keep new items out of write projections and reject synthetic IDs before writes. Disable selection, dragging, completion, splitting and ordering controls; exclude them from automatic order and editable chain actions.

## Milestones

First prove selection and transactional replacement with pure/mocked tests. Next prove read projection ignores own-minute settings and donor item overrides/completion/split/rank state, and load totals retain their durations. Finally prove 128px normal markers, unchanged 72px unknown markers, 70px forward markers, and disabled editing through focused web/API tests.

## Validation and Acceptance

Run only shared-types build, Prisma generate, API `tsc -p tsconfig.build.json --noEmit`, web `tsc --noEmit`, and changed-area Vitest files. No database migration, production connection, commit or push. Pure-function tests cover all five inclusion/exclusion conditions and deterministic donor choice; mocked API tests cover write rejection.

## Idempotence and Recovery

The migration only creates a new table and its indexes. Replacement is atomic and can be rerun. No migration is applied in this workspace; revert the local diff to discard implementation if needed, without touching user WIP.

## Surprises & Discoveries

Schedule ingest currently recalculates external completion separately; missing-process materialization also needs refreshing there so replaced donor row IDs and newly supplied standard hours are observed promptly.

## Decision Log

Use a distinct `missing-standard-hours:` prefix for itemId and sourceRowId, and retain donor ID only internally. This prevents generic row completion from targeting the donor. Materialize the resource-existence part of condition 5 during sync to keep board reads bounded; category remains a read policy. Missing markers participate in unknown counts, never duration totals. Keep them out of the per-part own-minute editor too: borrowed quantities must not inflate its estimated lot time. Keep their seiban registered during automatic completion pruning while any eligible missing marker is incomplete.

## Outcomes & Retrospective

Local implementation and requested focused validation are complete. The initial worktree was clean; all final changes are this task. No commit, push, stash, reset, checkout, rebase, migration application or production access occurred. Known limit: deleting a process in SCAW without a subsequent mail status leaves its marker until schedule/status evidence changes. Integration, migration application and production deployment remain unperformed.

## Artifacts and Notes

The final report must list files, test counts, write paths, cache generations and remaining limits.

## Interfaces and Dependencies

Add optional `standardHoursMissing` to the existing shared item contract. No dependencies or public endpoints are added. Keep missing inputs optional in the pure projection so write callers continue to see only actual schedule rows.

## Validation Results

All commands ran from the repository root. The four build/type commands were `pnpm --filter @raspi-system/shared-types build`, `pnpm --filter @raspi-system/api exec prisma generate`, `pnpm --filter @raspi-system/api exec tsc -p tsconfig.build.json --noEmit`, and `pnpm --filter @raspi-system/web exec tsc --noEmit`. All passed (each within approximately one minute). Focused Vitest invocations completed in about 1–9 seconds each. No full lint/typecheck/test suite or live browser/production check was run. The 11 skipped tests require a dedicated test database; new selection, write and transaction tests use pure functions or mocks.

API: 299 passed, 11 skipped across 10 files. These are `missing-standard-hours-process`, `grinding-planning-board-projection`, `grinding-planning-board-load-summary`, `grinding-planning-board-state`, `grinding-planning-board-write`, `grinding-planning-board.service.unit`, `grinding-planning-board-checks-completion`, `fkojunst-status-mail-sync.pipeline`, `fkojunst-status-mail-sync.service`, and `external-completion/fkojunst-external-completion-sync.service` under the existing test directories.

Web: 649 passed across 10 files. These are `PlanningBoardGanttView`, `PlanningBoardGanttDisplay`, `planningBoardGanttLayout`, `planningBoardForwardQueue`, `usePlanningBoardPageGantt`, `PlanningBoardTestBars`, `PlanningBoardPiecePopover`, `PlanningBoardItemTable.completion`, `usePlanningBoardCompletion`, and `usePlanningBoardArrival` under the existing test directories.

New cases: 52 passed. Selection, donor choice, transactional replacement/clear, projection/category filters and load exclusion: 28. API mutation rejection: 14. Schedule-ingest refresh and revision conflict: 3. Generation changes, cached board invalidation, and completion-prune protection: 1 each. Web marker width/label/read-only behavior: 2. Automatic ordering exclusion and disabled table controls: 1 each. Existing tests also assert that missing items never enter the own-minute sheet and that its original/own totals remain unchanged.

The first automatic-order fixture was already due-sorted and was corrected to require a reorder. Two existing service query-count assertions were updated to explicitly allow exactly one new indexed candidate read, while retaining the existing payload/load-cache assertions. All affected checks then passed. The existing baseline-browser-mapping age warning was observed; no dependency changes were made.

Follow-up validation (2026-11-14): API `tsc -p tsconfig.build.json --noEmit` passed (under one minute). Related Vitest files `missing-standard-hours-process` (34), `fkojunst-external-completion-sync.service` (7), `fkojunst-status-mail-sync.pipeline` (19), `fkojunst-status-mail-sync.service` (2) and `grinding-planning-board-projection` (40) passed: 102 tests total, about three seconds.

Added six normal/missing-bar due comparisons (Excel present/absent, manual precedence and SCAW source), two transaction/replacement failure cases, and changed the revision-conflict test to prove warn/skip plus external-completion continuation. Existing query tests now assert one scalar schedule read and one candidate read containing donor due joins.

Normal/forward bar classes and shared CSS have no disabled dimming; both retain the existing unknown bar's dashed border and colors, so no web change or web typecheck was needed. No browser check was run.

The follow-up preserves the pre-existing uncommitted implementation; no commit, push, stash, reset, checkout, rebase, .env inspection or production access was performed.

## Mutation Boundaries

Due dates, resource transfers, special due dates, pins, individual rank, arrival and first-process arrival reject missing IDs in `discoverSourceRows`. Single/bulk resource order (including automatic order and undo) and test-bar insertion/restoration reject the same IDs at their entry points. Transaction projection and low-level override writes also reject them. All use HTTP 400 / `READ_ONLY_MISSING_STANDARD_HOURS` before saving.

Generic completion, note, due, processing and row-rank endpoints require GUID row IDs; synthetic sourceRowId fails their existing schemas. Piece split/merge requires a `row:` parent and operation/individual-piece paths require actual piece IDs, so the missing ID cannot resolve. The donor row ID is never exposed as the marker sourceRowId. Write projections never receive missing evidence; surrounding-bar renumbering therefore cannot save missing markers.

The UI disables item selection, resource and due dragging, rank, pin, completion, split/merge and arrival controls. Automatic-order options/snapshots and test-bar anchors exclude missing markers. Interactive chains/drop targets exclude them; chain links have no persistence API. Resource-wide settings remain available, but candidate rows are excluded from per-part own-minute editing.

## Cache and Read Cost

Candidate data is read once per board build with a dashboard-ID predicate supported by `PSMissingStandardHours_unique_key` / `PSMissingStandardHours_idx_generation`, donor/supplement joins, the latest donor row-note due and the shared board Excel/manual authority joins. Candidate replacement reads schedule id, ProductNo, FKOJUN and FSIGENCD in one `$queryRaw`, without loading the full rowData JSON. The same collection is passed to load construction, avoiding a second read. The separate load endpoint makes one such candidate read. Reused board payloads do not reread candidates.

The existing fingerprint SQL additionally returns `[COUNT(*), MAX(updatedAt)]` for the new table. `missingStandardHoursGeneration` is included in both board `generationToken` and `loadGenerationToken`; this invalidates cursor snapshots, reusable/in-flight board payloads/rewarm and persisted load aggregates on replacement/update/clear. Existing canonical-row and leaderboard-winner cache keys stay unchanged because they still contain only actual CSV rows. No per-item queries were added. Actual database query plans and migration execution remain unverified locally.

## Local Notes JA

借用元は同じ製造オーダー内で既存の工順比較を使った最小工順、同じ工順なら行IDの辞書順です。CSV由来の品番・品名・製番、補助CSV由来の数量・予定終了日、および通常の棒と同じ納期解決に必要なExcel納期・更新時刻・最新行メモ納期を借ります。ボード項目単位の上書き、完了、資源振替、順位、分割は借りません。条件5の「日程CSVのどこかにある資源」は同期時に確定し、カテゴリ判定はボード読み取り時に既存ポリシーで行います。日程CSV取込後にも候補を更新するので、新たな工程行の出現と借用元IDの差し替えに追従します。

所要不明の件数に含めます。時間は元の値・独自の値のどちらにも加算しません。標準工数が入力され日程行が現れれば消え、最新状態C/Xでも消えます。SCAWで工程を削除しても状態メールが来なければ残る制約は解消していません。

## Changed Files

The final task diff contains 45 files (including this plan).

- [apps/api/prisma/migrations/20261114090000_add_missing_standard_hours_process/migration.sql](../../apps/api/prisma/migrations/20261114090000_add_missing_standard_hours_process/migration.sql)
- [apps/api/prisma/schema.prisma](../../apps/api/prisma/schema.prisma)
- [apps/api/src/services/production-schedule/__tests__/fkojunst-status-mail-sync.pipeline.test.ts](../../apps/api/src/services/production-schedule/__tests__/fkojunst-status-mail-sync.pipeline.test.ts)
- [apps/api/src/services/production-schedule/__tests__/fkojunst-status-mail-sync.service.test.ts](../../apps/api/src/services/production-schedule/__tests__/fkojunst-status-mail-sync.service.test.ts)
- [apps/api/src/services/production-schedule/__tests__/grinding-planning-board-checks-completion.test.ts](../../apps/api/src/services/production-schedule/__tests__/grinding-planning-board-checks-completion.test.ts)
- [apps/api/src/services/production-schedule/__tests__/grinding-planning-board-load-summary.test.ts](../../apps/api/src/services/production-schedule/__tests__/grinding-planning-board-load-summary.test.ts)
- [apps/api/src/services/production-schedule/__tests__/grinding-planning-board-state.test.ts](../../apps/api/src/services/production-schedule/__tests__/grinding-planning-board-state.test.ts)
- [apps/api/src/services/production-schedule/__tests__/grinding-planning-board-write.test.ts](../../apps/api/src/services/production-schedule/__tests__/grinding-planning-board-write.test.ts)
- [apps/api/src/services/production-schedule/__tests__/grinding-planning-board.service.unit.test.ts](../../apps/api/src/services/production-schedule/__tests__/grinding-planning-board.service.unit.test.ts)
- [apps/api/src/services/production-schedule/__tests__/missing-standard-hours-process.test.ts](../../apps/api/src/services/production-schedule/__tests__/missing-standard-hours-process.test.ts)
- [apps/api/src/services/production-schedule/external-completion/__tests__/fkojunst-external-completion-sync.service.test.ts](../../apps/api/src/services/production-schedule/external-completion/__tests__/fkojunst-external-completion-sync.service.test.ts)
- [apps/api/src/services/production-schedule/external-completion/fkojunst-external-completion-sync.service.ts](../../apps/api/src/services/production-schedule/external-completion/fkojunst-external-completion-sync.service.ts)
- [apps/api/src/services/production-schedule/fkojunst-status-mail-sync.pipeline.ts](../../apps/api/src/services/production-schedule/fkojunst-status-mail-sync.pipeline.ts)
- [apps/api/src/services/production-schedule/fkojunst-status-mail-sync.service.ts](../../apps/api/src/services/production-schedule/fkojunst-status-mail-sync.service.ts)
- [apps/api/src/services/production-schedule/grinding-planning-board-load-summary.ts](../../apps/api/src/services/production-schedule/grinding-planning-board-load-summary.ts)
- [apps/api/src/services/production-schedule/grinding-planning-board-projection.ts](../../apps/api/src/services/production-schedule/grinding-planning-board-projection.ts)
- [apps/api/src/services/production-schedule/grinding-planning-board/completion.ts](../../apps/api/src/services/production-schedule/grinding-planning-board/completion.ts)
- [apps/api/src/services/production-schedule/grinding-planning-board/read.ts](../../apps/api/src/services/production-schedule/grinding-planning-board/read.ts)
- [apps/api/src/services/production-schedule/grinding-planning-board/state.ts](../../apps/api/src/services/production-schedule/grinding-planning-board/state.ts)
- [apps/api/src/services/production-schedule/grinding-planning-board/test-bars.ts](../../apps/api/src/services/production-schedule/grinding-planning-board/test-bars.ts)
- [apps/api/src/services/production-schedule/grinding-planning-board/write.ts](../../apps/api/src/services/production-schedule/grinding-planning-board/write.ts)
- [apps/api/src/services/production-schedule/missing-standard-hours-process.ts](../../apps/api/src/services/production-schedule/missing-standard-hours-process.ts)
- [apps/web/src/features/kiosk/grindingPlanningBoard/PlanningBoardCompletionButton.tsx](../../apps/web/src/features/kiosk/grindingPlanningBoard/PlanningBoardCompletionButton.tsx)
- [apps/web/src/features/kiosk/grindingPlanningBoard/PlanningBoardFocusView.tsx](../../apps/web/src/features/kiosk/grindingPlanningBoard/PlanningBoardFocusView.tsx)
- [apps/web/src/features/kiosk/grindingPlanningBoard/PlanningBoardItemTable.tsx](../../apps/web/src/features/kiosk/grindingPlanningBoard/PlanningBoardItemTable.tsx)
- [apps/web/src/features/kiosk/grindingPlanningBoard/PlanningBoardPiecePopover.tsx](../../apps/web/src/features/kiosk/grindingPlanningBoard/PlanningBoardPiecePopover.tsx)
- [apps/web/src/features/kiosk/grindingPlanningBoard/PlanningBoardSeibanPane.tsx](../../apps/web/src/features/kiosk/grindingPlanningBoard/PlanningBoardSeibanPane.tsx)
- [apps/web/src/features/kiosk/grindingPlanningBoard/__tests__/PlanningBoardItemTable.completion.test.tsx](../../apps/web/src/features/kiosk/grindingPlanningBoard/__tests__/PlanningBoardItemTable.completion.test.tsx)
- [apps/web/src/features/kiosk/grindingPlanningBoard/gantt/PlanningBoardForwardGanttRow.tsx](../../apps/web/src/features/kiosk/grindingPlanningBoard/gantt/PlanningBoardForwardGanttRow.tsx)
- [apps/web/src/features/kiosk/grindingPlanningBoard/gantt/PlanningBoardForwardQueuePopover.tsx](../../apps/web/src/features/kiosk/grindingPlanningBoard/gantt/PlanningBoardForwardQueuePopover.tsx)
- [apps/web/src/features/kiosk/grindingPlanningBoard/gantt/PlanningBoardGanttDisplay.test.tsx](../../apps/web/src/features/kiosk/grindingPlanningBoard/gantt/PlanningBoardGanttDisplay.test.tsx)
- [apps/web/src/features/kiosk/grindingPlanningBoard/gantt/PlanningBoardGanttRow.tsx](../../apps/web/src/features/kiosk/grindingPlanningBoard/gantt/PlanningBoardGanttRow.tsx)
- [apps/web/src/features/kiosk/grindingPlanningBoard/gantt/PlanningBoardGanttView.test.tsx](../../apps/web/src/features/kiosk/grindingPlanningBoard/gantt/PlanningBoardGanttView.test.tsx)
- [apps/web/src/features/kiosk/grindingPlanningBoard/gantt/PlanningBoardGanttView.tsx](../../apps/web/src/features/kiosk/grindingPlanningBoard/gantt/PlanningBoardGanttView.tsx)
- [apps/web/src/features/kiosk/grindingPlanningBoard/gantt/planningBoardChainStripBars.ts](../../apps/web/src/features/kiosk/grindingPlanningBoard/gantt/planningBoardChainStripBars.ts)
- [apps/web/src/features/kiosk/grindingPlanningBoard/gantt/planningBoardGanttGeometry.ts](../../apps/web/src/features/kiosk/grindingPlanningBoard/gantt/planningBoardGanttGeometry.ts)
- [apps/web/src/features/kiosk/grindingPlanningBoard/usePlanningBoardArrival.ts](../../apps/web/src/features/kiosk/grindingPlanningBoard/usePlanningBoardArrival.ts)
- [apps/web/src/features/kiosk/grindingPlanningBoard/usePlanningBoardCompletion.ts](../../apps/web/src/features/kiosk/grindingPlanningBoard/usePlanningBoardCompletion.ts)
- [apps/web/src/features/kiosk/grindingPlanningBoard/usePlanningBoardPageGantt.test.tsx](../../apps/web/src/features/kiosk/grindingPlanningBoard/usePlanningBoardPageGantt.test.tsx)
- [apps/web/src/features/kiosk/grindingPlanningBoard/usePlanningBoardPageGantt.ts](../../apps/web/src/features/kiosk/grindingPlanningBoard/usePlanningBoardPageGantt.ts)
- [apps/web/src/features/kiosk/grindingPlanningBoard/usePlanningBoardTestBars.ts](../../apps/web/src/features/kiosk/grindingPlanningBoard/usePlanningBoardTestBars.ts)
- [apps/web/src/pages/kiosk/ProductionScheduleGrindingPlanningBoardPage.tsx](../../apps/web/src/pages/kiosk/ProductionScheduleGrindingPlanningBoardPage.tsx)
- [docs/INDEX.md](../../docs/INDEX.md)
- [docs/plans/grinding-planning-board-missing-standard-hours.md](../../docs/plans/grinding-planning-board-missing-standard-hours.md)
- [packages/shared-types/src/common/production-schedule-grinding-planning-board.ts](../../packages/shared-types/src/common/production-schedule-grinding-planning-board.ts)

Updated 2026-11-14: recorded completed implementation, focused validation, mutation boundaries, cache behavior and the final file inventory.
