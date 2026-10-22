# Mobile placement verification and shelf photos

This local implementation plan follows `.agent/PLANS.md`. Scope is the current feature worktree only; no Git writes, dependency downloads, migration execution, or deployment are authorized.

## Purpose / Big Picture

Workers can compare a transfer slip's manufacturing order with a supplier slip's purchase order in 照合, independently of placement. In 配膳, they choose a shelf by photograph and place an order without scanning a supplier slip. Shelf master stores each photograph and memo alongside the existing shelf ID.

## Progress

- [x] (2026-10-22) Confirm clean starting worktree, reference mocks, existing registration contract and authenticated HTTP client.
- [x] Implement optional scanned parts, verification details, additive photo model and photo/memo API.
- [x] (2026-10-22) Implement separate phone tabs, authenticated photo picker and photo master forms, including partial-upload retry.
- [x] (2026-10-22) Add focused service, route and web tests; API unit tests (36) and web tests (53 unique tests across 8 files) pass. Changed-file ESLint passes for both packages.
- [ ] Run the DB integration test after generating the new Prisma Client and applying the migration in a test database; neither was performed here.
- [ ] Confirm rendered phone layouts on a device/browser; local Chromium launch was denied by the sandbox.

## Context and Orientation

`apps/api/src/routes/mobile-placement/index.ts` authenticates kiosk requests. Services under `apps/api/src/services/mobile-placement/` resolve manufacturing and purchase orders. The pure slip matcher retains its existing internal reason codes; the service exposes the five UI reasons and retains a failing internal code as `legacyReason`. `apps/web/src/features/mobile-placement/haizen/HaizenHub.tsx` renders the phone and its serialized verification workflow. `shelfMaster/components/ShelfMasterPhonePage.tsx` hosts the new first mode, 写真. API requests use `apps/web/src/api/domains/mobile-placement.ts` and the existing header-injecting HTTP client.

## Plan of Work

First, make scanned part barcodes optional while preserving checks for supplied values and DB pair checks. Return expected/actual metadata already obtained by lookups. Add `MobilePlacementShelfPhoto` with one row per shelf and a cascading foreign key; expose authenticated upload/download/memo routes and list photo timestamps.

Second, split the hub into persisted 照合 and 配膳 tabs. Keep serialized requests, distinguish transport errors, and retain barcode and photo fallback flows. Add a full-screen photo grid using existing registered shelves and order branches. Fetch images as authenticated Blobs and revoke component object URLs. Add shelf master photo listing and add/edit forms, resizing uploads to 800px JPEG. On partial creation/upload failure retain the created ID so retry updates the same shelf.

Finally, exercise these contracts with focused tests and lint/type checks. Keep the footer's 84px assistant gutter and use existing dark tokens.

## Concrete Steps

From the current worktree, run `pnpm --filter @raspi-system/api exec vitest run` with the changed service/route test paths and `pnpm --filter @raspi-system/web exec vitest run` with changed UI test paths. Run each package's `exec eslint` for changed TypeScript files, and `pnpm --filter @raspi-system/web exec tsc --noEmit -p .`. Inspect `git diff --check` and `git status --short` without writing Git state. If tooling is missing, report the exact failure; do not install it. Avoid dotenv loading in test execution.

## Validation and Acceptance

Two barcode scans produce 一致, 不一致 with a specific reason, or 未登録; a request failure displays 照合できませんでした and retry. The placement action is available with only transfer order and shelf. Photo picking filters by previous shelves/area and handles shelves without images. New photo shelves require area, line and a photograph; ID is the first free two-digit slot and remains editable until created. Memo and photo edits are independent. Tests must cover byte signatures, size, authentication, unknown shelves, metadata and save calls.

## Idempotence and Recovery

Migration `20261022120000_mobile_placement_shelf_photo` only creates a table and FK. Do not execute it here. Existing shelf IDs and columns are unchanged. Photo writes upsert one row; memo writes are repeatable. No deployment or data cleanup is part of this task.

## Surprises & Discoveries

The register API already requires only the manufacturing order and shelf. The verification route previously rejected empty part fields. The API environment loader invokes dotenv automatically, so test execution must avoid reading local secret files.

## Decision Log

- Keep internal mismatch codes and expose them as `legacyReason` while `reason` uses the requested UI vocabulary. Existing `ok` and `actualResolvedBy` remain unchanged. Repository consumers do not branch on the old codes.
- Compute the first free shelf number in the web form from registered shelves; retain server duplicate detection for concurrent edits.

## Outcomes & Retrospective

The local implementation is complete. Two-barcode verification, independent placement, photo picking, and shelf photo/memo editing have focused test coverage. DB integration remains unverified because the available generated Prisma Client lacks MobilePlacementShelfPhoto and this migration has not been applied. Main integration and production deployment were not requested.

(2026-10-22, field request) The 配膳 tab now shows the shelf photo list (area chips, 3 columns, scrolls) under the 棚 stub by default, using the same list as the full-screen picker; the primary button still opens that picker. The header row is 照合 / 配膳 tabs plus 購買 and 部品 buttons moved out of the ••• menu; パレット, Zero2W and 棚マスタ stay in the menu.

## Artifacts and Notes

Validation used existing local dependencies from the main checkout via temporary symlinks, including Vitest 4.1.8; no package was downloaded. The task worktree initially had no node_modules. Temporary Vitest configs inherited the existing package config and changed only envDir to an empty temporary directory and cacheDir to a writable temporary directory. This prevented dotenv file loading. The integration test also mocks the API dotenv loader.

API command: `pnpm --filter @raspi-system/api exec vitest run --config .haizen-vitest.config.ts src/services/mobile-placement/__tests__/mobile-placement-slip-match.test.ts src/services/mobile-placement/__tests__/mobile-placement-verify-slip.service.test.ts src/services/mobile-placement/__tests__/mobile-placement-shelf-photo.service.test.ts` — 3 files, 36 tests passed.

Web focused files: `HaizenHub.test.tsx`, `HaizenShelfPhotoPicker.test.tsx`, `ShelfPhotoMaster.test.tsx`, `ShelfMasterPhonePage.test.tsx`, `shelfPhoto.test.tsx`, plus existing `useMobilePlacementPageState.native.test.tsx`, `useHubBackGuard.test.tsx`, and `navigationState.test.ts`. They ran with `pnpm --filter @raspi-system/web exec vitest run --config .haizen-vitest.config.ts <paths>`; all 53 unique tests passed. Initial new-test failures were corrected by waiting for shelf loading and selecting the intended duplicate-labelled scan controls.

`pnpm --filter @raspi-system/api exec eslint <changed files>` and the corresponding web command passed. `pnpm --filter @raspi-system/web exec tsc --noEmit -p .` reports no errors in changed files; the full check still fails outside this change against the available stale/missing local dependency types. Browser capture failed with macOS `bootstrap_check_in ... Permission denied (1100)`, before rendering. The full DB test file `apps/api/src/routes/__tests__/mobile-placement.integration.test.ts` was updated but not run. Local validation and investigation stayed within the 45-minute DB-change budget.

Reference layouts are `haizen-2barcode-mock.html` and `haizen-shelf-photo-mock.html` supplied in the task's temporary scratchpad. Photos are stored in PostgreSQL bytes, not in a new volume.

## Interfaces and Dependencies

Add PUT/GET `/mobile-placement/shelves/:shelfCodeRaw/photo` and PATCH `/mobile-placement/shelves/:shelfCodeRaw`. POST shelves accepts optional `displayLabel`; registered shelves returns nullable `photoUpdatedAt`. Use existing Prisma, Fastify, Zod, React Query and canvas APIs; no dependencies are added.

Revision note (2026-10-22): recorded implementation, focused validation, local dependency reuse and the explicit DB/browser verification gaps.
