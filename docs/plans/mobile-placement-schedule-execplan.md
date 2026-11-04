# Connect Excel schedules to mobile placement

This living plan follows `.agent/PLANS.md`. Scope is local API and phone Web implementation only; the user forbids git mutations and production changes.

## Purpose / Big Picture

Operators can open 日程 from the phone menu, identify urgent manufacturing orders, inspect their parts by placement state, and start existing slip verification with a particular manufacturing order or part in view. Dates come exclusively from the imported Excel schedule.

## Progress

- [x] (2026-11-04) Inspect existing phone workflow, completion SQL, shelf presentation, and authorization.
- [x] (2026-11-04) Implement shared batch aggregation and read-only list/detail routes with focused tests.
- [x] (2026-11-04) Implement list/detail screens, target navigation, shelf prioritization, and transfer-only continuation of previously verified parts.
- [x] (2026-11-04) Complete focused and existing affected tests, Web full regression, package lint/type checks, and final diff review (full API suite and real device/browser checks not run).

## Context and Orientation

`apps/api/src/routes/mobile-placement/index.ts` registers the existing device-authorized API. The new `schedule-seibans.ts` route delegates to `apps/api/src/services/mobile-placement/schedule-seiban-status.service.ts`. `ProductionScheduleDScheduleMinutes` contains the imported manufacturing-order dates and aliases. `CsvDashboardRow` contains individual process rows; a part is identified by ProductNo, and all of its process rows must be complete before the part is complete.

`apps/web/src/features/mobile-placement/haizen/HaizenHub.tsx` owns phone verification and placement. `useHaizenWorkflow.ts` serializes existing verification requests. `HaizenScheduleList.tsx` and `HaizenScheduleDetail.tsx` are new screens registered in `apps/web/src/App.tsx`. Their API calls and React Query hooks live in `apps/web/src/api/domains/schedule-seibans.ts` and `apps/web/src/api/hooks/schedule-seibans.ts`.

## Plan of Work

First implement read-only aggregation rooted in imported Excel rows. Reuse `buildProductionScheduleEffectiveCompletedSql`, `normalizeSlipToken`, and `normalizePurchaseFhinCdForMatching`; query each data source as a batch. Resolve aliases into their parent manufacturing order. Classify each part as done, shelf, verified, or pending in that priority order. Exclude fully complete orders from the list, sort null dates last, and return at most 200 orders.

Then add phone list/detail screens using existing phone tokens and shelf photo components. Route verification targets through `scheduleFseiban` and optional `scheduleProductNo` URL parameters. Never populate scan inputs from these targets. After normal matching, compare the scanned record with the target and display a separate notice when different. Prioritize shelves already containing parts of the target order and badge their counts. Retain existing offline placement queue behavior.

## Milestones

The API milestone is observable through GET `/api/mobile-placement/schedule-seibans` and its `/:fseiban` detail route. Authorized clients receive Excel manufacturing orders, counts, and part states; missing detail returns 404. Focused service and route tests exercise aliases, purchase and Zero2W shelves, completion, and date ordering.

The phone milestone is observable at `/kiosk/mobile-placement/schedule-seibans`. Open an order, switch among the four states, expand a shelf, and select a pending or verified part to enter the existing scan screen. A part-target placement returns to detail; a manufacturing-order target stays on scanning and refreshes its count.

## Decision Log

- Decision: Return the most recently updated shelf for a part with multiple placement branches. Rationale: the requested part response has one shelf field. Date: 2026-11-04.
- Decision: Treat an Excel alias as belonging to its parent verification target. Rationale: the same detail aggregates both sets of parts. Date: 2026-11-04.
- Decision: For an already verified target part, a new transfer scan matching its ProductNo can reuse that persisted verified state. Rationale: no fabricated slip inputs, additional verification API, or replacement of the existing recorder is needed. Date: 2026-11-04.
- Decision: Count only max-ProductNo winner rows (`buildMaxProductNoWinnerCondition`) and resolve machine names with `resolveSeibanMachineDisplayNamesBatched` (unregistered label shown as nothing). Rationale: reissued orders otherwise stay as phantom pending parts, and the boards use the same rules. Date: 2026-11-04.

## Surprises & Discoveries

Initial test runners could not start because existing node_modules links pointed to missing package versions. `pnpm install --offline --frozen-lockfile --ignore-scripts` restored packages without changing the lockfile. Prisma generation and workspace package builds are required before API and Web verification in this checkout.

## Concrete Steps

From the repository root, run the two new API test files with `pnpm --filter @raspi-system/api exec vitest run src/services/mobile-placement/__tests__/schedule-seiban-status.service.test.ts src/routes/__tests__/mobile-placement-schedule-seibans.test.ts`. Run Web focused tests with `pnpm --filter @raspi-system/web exec vitest run src/features/mobile-placement/haizen`. Run package lint and TypeScript checks after necessary workspace builds. Record final outcomes below.

## Validation and Acceptance

Tests must show that only Excel manufacturing orders enter the list, parent and alias parts aggregate together, done parts take precedence, verified parts without a shelf remain verified, purchase and Zero2W shelves resolve, fully complete orders disappear from the list, and null dates follow dated rows. Route tests cover list, detail, and 404. Phone tests cover filters, state counts, shelf photo contents, menu navigation, target notices, transfer-only continuation, and placement destinations. Existing package tests and lint/type checks provide regression evidence.

## Idempotence and Recovery

There are no schema migrations or writes in the new API. Source changes remain local and reviewable. Dependency installation uses the committed lockfile and local cache. Do not commit, branch, stash, push, merge, or deploy as part of this task.

## Interfaces and Dependencies

The list returns `{seibans, truncated}`. Each summary includes fseiban, aliasFseibans, partsCompleteDate, sendOutDate, outsourceMarks, memo, machineName, and counts. Detail adds parts containing productNo, fhincd, fhinmei, state, and optional shelfCodeRaw/shelfLabel. Existing Fastify, Prisma, React, React Router, and React Query suffice; no dependency changes are needed.

## Outcomes & Retrospective

The read-only API, phone schedule screens, target verification notices, shelf priorities, transfer-only continuation, and placement destinations are implemented. New API tests cover nine cases; 34 existing related API cases pass. Web full regression passes 686 files / 6,008 tests (193 seconds); after final adjustments, Hub/schedule tests pass 83 cases (18 seconds) and shelf picker tests pass 54 cases (2 seconds). API lint and API/Web type checks pass. Final Web package lint passes. The complete API suite and a real-device/browser session were not run. No git mutation or production action was performed.

Revision note: Updated on 2026-11-04 after final package lint/type checks and targeted tests passed; the file list and commands below are the local implementation evidence.


## Artifacts and Notes

Successful API test commands (run from the repository root):

    pnpm --filter @raspi-system/api exec vitest run src/services/mobile-placement/__tests__/schedule-seiban-status.service.test.ts src/routes/__tests__/mobile-placement-schedule-seibans.test.ts
    pnpm --filter @raspi-system/api exec vitest run src/services/mobile-placement/__tests__/schedule-seiban-status.service.test.ts
    pnpm --filter @raspi-system/api exec vitest run src/services/mobile-placement/__tests__/placement-completion.service.test.ts src/services/mobile-placement/__tests__/mobile-placement-slip-match.test.ts src/services/mobile-placement/__tests__/mobile-placement-verify-slip.service.test.ts

The first command passed eight tests before the latest-shelf boundary test was added; the second passed all six service tests after that addition. The three route tests were unchanged. The third command passed 34 existing tests.

Successful Web test commands:

    pnpm --filter @raspi-system/web exec vitest run
    pnpm --filter @raspi-system/web exec vitest run src/features/mobile-placement/haizen/HaizenHub.test.tsx src/features/mobile-placement/haizen/HaizenSchedule.test.tsx
    pnpm --filter @raspi-system/web exec vitest run src/features/mobile-placement/haizen/HaizenShelfPhotoPicker.test.tsx

The full suite passed 6,008 tests. Final targeted checks passed 83 and 54 tests, respectively, after the last display and shelf-filter adjustments. Full-suite logs include external-network errors from existing tests, but no failures. Initial focused failures were dependency/setup failures and a menu tile-count expectation updated for the new tile. Initial lint failures were import ordering and a SQL full-width space literal; these were corrected.

The following static check commands all passed (package-wide checks took roughly one to three minutes each):

    pnpm --filter @raspi-system/api lint
    pnpm --filter @raspi-system/api exec tsc --noEmit -p tsconfig.build.json
    pnpm --filter @raspi-system/web lint
    pnpm --filter @raspi-system/web exec tsc -b --pretty false
    git diff --check

Prisma generation and workspace builds produced only ignored local artifacts. The committed dependency manifests and lockfile are unchanged. Initial worktree status was clean, so all files listed below belong to this task.

### Changed Files

- `apps/api/src/routes/mobile-placement/index.ts`
- `apps/web/src/App.tsx`
- `apps/web/src/features/mobile-placement/haizen/HaizenHub.test.tsx`
- `apps/web/src/features/mobile-placement/haizen/HaizenHub.tsx`
- `apps/web/src/features/mobile-placement/haizen/HaizenIcon.tsx`
- `apps/web/src/features/mobile-placement/haizen/HaizenShelfPhotoPicker.test.tsx`
- `apps/web/src/features/mobile-placement/haizen/HaizenShelfPhotoPicker.tsx`
- `apps/web/src/features/mobile-placement/haizen/HaizenShelfPhotoViewer.tsx`
- `apps/web/src/features/mobile-placement/haizen/useHaizenWorkflow.ts`
- `docs/INDEX.md`
- `apps/api/src/routes/__tests__/mobile-placement-schedule-seibans.test.ts`
- `apps/api/src/routes/mobile-placement/schedule-seibans.ts`
- `apps/api/src/services/mobile-placement/__tests__/schedule-seiban-status.service.test.ts`
- `apps/api/src/services/mobile-placement/schedule-seiban-status.service.ts`
- `apps/web/src/api/domains/schedule-seibans.ts`
- `apps/web/src/api/hooks/schedule-seibans.ts`
- `apps/web/src/features/mobile-placement/haizen/HaizenSchedule.test.tsx`
- `apps/web/src/features/mobile-placement/haizen/HaizenScheduleDetail.tsx`
- `apps/web/src/features/mobile-placement/haizen/HaizenScheduleList.tsx`
- `apps/web/src/features/mobile-placement/haizen/scheduleDisplay.ts`
- `docs/plans/mobile-placement-schedule-execplan.md`
