# Sessaku piece operation bars

## Purpose / Big Picture

Split a quantity-one cutting piece into independently placed operation intervals, then merge an interval into its predecessor. This stage delivers DB, API and shared contracts only; Web controls and connector rendering follow separately. A piece is one lot subdivision; an operation is a numbered ResourcePartOpMinutes entry; projection converts database records into board bars. Related history: [unit gantt](2026-11-10-sessaku-unit-gantt-pr2b.md) and [unit pieces](2026-11-09-sessaku-unit-split-ops-pr1.md).

## Progress

- [x] (2026-11-11) Read rules and existing transaction, projection, setup and override paths; initial worktree clean.
- [x] (2026-11-11) Add schema, additive migration, shared contracts and operation boundary projection.
- [x] (2026-11-11) Implement API mutations, cleanup, completion, source links and both load paths.
- [x] (2026-11-11) Prisma generate, shared build, API build tsc and 476 focused unit tests passed; Japanese report saved.
- [ ] Dedicated-DB verification: cascade and SQL load tests are added but skipped without an explicit test DB.
- [x] (2026-11-11) Implement Web operation controls, interval completion, chain links and interval setup; local validation recorded below.
- [ ] Integration remains pending: no commit, push, PR, merge or deploy authorized.

## Surprises & Discoveries

API setup eligibility is the minimum piece position including completed pieces. Web planningBoardGanttLayout.ts applies lane part transitions using planningBoardUnitSegments.ts; Web must use each interval's setupMinutes in the next stage instead of reading the destination machine's whole-part setup.

## Decision Log

Decision: preserve the splitting machine as the duration definition resource, even after movement. Operation order is connected visually and never blocks placement. Rationale: user-approved scheduling behavior. Date/author: 2026-11-11, user.

Decision: add nullable leadingSourceResourceCd on the new split table. It records the first interval's source independently of the first suffix. Rationale: re-splitting a moved suffix and removing the first boundary must not change an unrelated head interval's duration source. Existing tables are unchanged. Date/author: 2026-11-11, implementation.

## Outcomes & Retrospective

Local implementation is complete. Prisma generation, shared-types build and API build typecheck passed. Sixteen focused unit files passed, 476 unique cases. Dedicated-DB suites registered 309 skipped cases, including the two new cascade/SQL checks; those acceptance checks remain unverified. Independent review found two placement/scope issues, both fixed; final review found no major or medium findings. Integration and Web delivery remain separate stages.

## Context and Orientation

apps/api/prisma/schema.prisma defines pieces, their sets and operation completion. apps/api/src/services/production-schedule/sessaku-pieces/sessaku-pieces.service.ts owns operate, which validates set versions and holds critical, logical, board and row locks in that order. grinding-planning-board-projection.ts generates board items; piece-lane-writes.ts copies placement and reranks affected lanes. packages/shared-types/src/common/production-schedule-grinding-planning-board.ts is the API contract.

## Plan of Work

Add only migration apps/api/prisma/migrations/20261111230000_sessaku_piece_op_splits/migration.sql. ProductionScheduleSessakuPieceOpSplit has id, pieceId cascading FK, fromOpNo, sourceResourceCd, leadingSourceResourceCd and createdAt, unique(pieceId, fromOpNo). No backfill is needed. A piece without boundaries follows the existing path.

Expand boundaries into intervals in expandSessakuPieces. The head keeps piece:<pieceId>; suffixes use pieceops:<pieceId>:<fromOpNo>. Every interval has opRange {fromOpNo,toOpNo}, original pieceId and parentItemId. Filter ops, setup and completion to that interval. Read duration definitions from its recorded source resource and the site's part settings. The minimum-position piece carries each interval's operation setup sum. Completed intervals derive from all their ops, while whole-piece completion remains authoritative. Include boundaries/ranges in revision hashes and increment PieceSet.version for split/merge. sourceItemId on dependent items points to the source piece's final interval. Projection reads also select the source piece's last boundary so this works when the source itself is outside the displayed category.

Use POST /kiosk/production-schedule/grinding-planning-board/pieces/ops/split with itemId, fromOpNo, expectedPieceSetVersion, itemRevision and optional dueSource. Use POST at /pieces/ops/merge with the same contract except fromOpNo; identify a suffix itemId to remove its boundary. Return SessakuPiecesMutationResponse with current pieces, affectedItemIds and pieceSetVersion. Reject stale writes with 409, invalid boundaries with 400, and quantity split/merge of sets containing operation boundaries with 409. Split creation uses the existing creation feature gate. Copy source placement into the new suffix immediately after its source at every affected site; merge deletes only the suffix placement. Keep the separate lane persistence issue unchanged.

Web will add split/merge actions using these contracts, send itemId with operation completion when selecting a range, connect same-piece intervals by opRange and connect subsequent processes from sourceItemId. Movement remains unrestricted. No apps/web file changes in this stage.

## Concrete Steps

Run commands from repository root, after implementation:

    pnpm --filter @raspi-system/api exec prisma generate
    pnpm --filter @raspi-system/shared-types build
    pnpm --filter @raspi-system/api exec tsc -p tsconfig.build.json --noEmit
    pnpm --filter @raspi-system/api exec vitest run src/services/production-schedule/sessaku-pieces/__tests__/piece-op-splits.service.test.ts src/routes/kiosk/production-schedule/__tests__/sessaku-pieces.route.test.ts src/services/production-schedule/__tests__/grinding-planning-board-projection.test.ts

Expected: generated client, successful shared build/API compilation and focused passing test counts. Never run full lint/typecheck/test suites. DB integration tests run only with the repository's explicit designated test database selection; otherwise record skips. Do not read or modify secrets.

## Validation and Acceptance

A piece with ops 1,2,3 split at 3 yields piece:id {1,2} and pieceops:id:3 {3,3}; sum operation minutes is conserved on the original machine. Moving either bar changes only placement. Merging suffix restores the head and removes suffix overrides. Old revisions and versions yield 409. Quantity operations reject operation-split sets. Completion of only ops 1,2 completes the head but leaves the suffix open. Piece deletion cascades its boundaries and removes all interval overrides. Focused service, route and projection tests provide observable evidence.

## Idempotence and Recovery

Mutations are transactional, so any rejection rolls back boundary, placement and version changes together. Repeated writes with old versions conflict and require a refresh. The additive migration is delivered but is not applied to an operational database. Revert only this task's files to abandon implementation; no git write operation is authorized.

## Artifacts and Notes

Japanese delivery report: /tmp/sessaku-piece-op-bars-report-ja.md. No existing WIP was present. All 29 changed/new repository files belong to this task, with no Web or existing migration changes. Temporary test configuration blocked dotenv loading and used an empty envDir, then was removed. Initial mock omissions/query-contract expectations and invalid temporary environment values were corrected before final success. Tests took seconds; the final checks additionally waited for the repository heavy-run concurrency guard. The additive migration was not applied. This plan is the single implementation and validation record.

## Interfaces and Dependencies

Reuse Prisma, Zod, existing sessaku-pieces routes/services, shared board types and Vitest. Add SessakuPieceOpSplitRequest, SessakuPieceOpMergeRequest and response aliases; optional itemId on completion selects the bar revision. Reuse acquireSessakuPieceLogicalLocks then acquireSessakuPieceBoardStateLocks through operate. No new dependency or UI text.

Revision note: initial plan records the requested first-stage boundary and independent head source persistence discovered during implementation.

Revision note: completed local stage and recorded focused evidence, final review, category-independent source links and the dedicated-DB verification gap.

## Web Stage (2026-11-11)

The piece dialog inserts a 32px dashed scissors button between a unit bar's sorted operations. Suffix bars expose operation merge; interval bars are excluded from quantity splitting and merging. Operation mutations reuse the quantity operation gates, refresh, error handling and focus path; their response supplies the interval display during refresh and selects the suffix after split or the predecessor after merge. Suffix completion sends itemId. Split links order intervals by fromOpNo, and subsequent process links/dependencies prefer sourceItemId, falling back to the source piece's final visible interval. Interval bars use their own operation and setup minutes with existing lane part transitions. Placement remains unrestricted by interval order; bars without opRange retain the existing duration/setup calculation. No lane write queue, persistence or resend changes were made.

The API lint-only extraction moves operation mutation logic to sessaku-pieces/piece-op-splits.ts and interval load SQL/calculation to grinding-planning-board-op-bar-load.ts. Transaction, lock and response behavior is preserved; write.ts only folds the added item-ID loop. The original staged first-stage changes remain intact.

Validation: API focused ESLint (the three existing files and two extracted files), API build typecheck, and the requested three API test files passed (79 cases). Web typecheck and six directly related Web test files passed (653 unique cases; 18 added for this stage). Tests use temporary configs with an empty envDir and a mocked dotenv loader for API, avoiding secret-file reads; temporary configs are removed after validation. Full suites, Web lint, browser checks, database integration, commit, push, PR, merge and deploy are outside this stage. Japanese delivery report: /tmp/sessaku-piece-op-bars-stage2-report-ja.md.

## Unit Configuration Follow-up (2026-11-12, PR 2779)

Configure now accepts operation completion evidence. Retained operation numbers keep their records; reconciliation runs after boundary replacement so obsolete source intervals cannot retain removed evidence or close a unit prematurely. Fully covered remaining operations close the unit through the existing reconciliation. Completed interval replacements copy placement using the existing operation-split pattern. Target selection, source-resource assignment and the outside-target boundary guard are unchanged.

Setup uses the saved total, or the minimum-position unit head when unregistered. Equal counts preserve each operation setup; changed counts put the conserved total on the first operation. The dialog uses 300px width, 32px scissors and a 1px slate-700 divider. Both Gantt modes preserve the rounded head and square suffixes; no helper text was added.

Validation: API build typecheck and Web `tsc -p tsconfig.json --noEmit` passed. The focused API service file passed 42 cases; the four requested Web files passed 423 cases across focused runs. Added dedicated-DB cases cover other-lot splits/overrides, OPERATION_SPLIT_IN_USE rollback and completion identity/removal/whole-unit closure. TEST_DATABASE_URL is absent: all 293 integration cases were collected and skipped, including the three additions. Temporary Vitest configurations outside the repository disable dotenv loading and use an empty envDir. No commit, push, merge or deploy was performed.
