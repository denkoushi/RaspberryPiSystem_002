# 配膳の「照合の記録」と製造オーダーの「足取り」

This ExecPlan is a living document. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` current as work proceeds. It follows `.agent/PLANS.md`.

## Purpose / Big Picture

The 配膳 phones compare a move slip (移動票, carries the 10-digit production order number, called ProductNo or FSEZONO) with the real slip (現品票) before placing a part on a shelf. Today that comparison result is thrown away: a mismatch or an unreadable slip leaves no trace, and nobody can later see what was checked. Separately, nobody can see in one place where one production order has been: which process it is at, which shelf it was put on, when it was scanned or put on a pallet.

After this change the kiosk screen 在庫 > 配膳の場所 (`/kiosk/inventory/haizen`) has two buttons, 照合の記録 and 足取り, under its top bar. 照合の記録 (`/kiosk/inventory/haizen/verify-history`) lists every verify the phones made in the last 1, 7 or 30 days with result 一致 / 不一致 / 未登録 / 照合できず, and where the part was then placed. 足取り (`/kiosk/inventory/haizen/trail?order=<10 digits>`) shows one production order's process steps and a dated timeline gathered from shelves, verifies, process status, actual hours, pallets, Zero2W scans and purchasing. The screens already exist on this branch with the API contract in `apps/web/src/features/kiosk/haizen/haizenRecordTypes.ts`; this plan adds the data behind them.

The phone versions of the two screens (mocks approved by the user) are a separate follow-up PR. They reuse the same API.

## Progress

- [x] (2026-10-29) Kiosk screens and API hooks written against fixtures; mock approved by the user.
- [x] (2026-10-29) Milestone 1: implemented the Prisma model/migration, authenticated POST, phone store/upload job, input + outcome dedupe in `runSlipVerify`, and `clientRecordId` linking in `put()`. Migration has not been applied to a database.
- [x] (2026-10-29) Milestone 2, verify-records half: implemented authenticated `GET /mobile-placement/verify-records`, 1/7/30-day filtering, newest-first limit of 500, schedule/machine enrichment, and placement lookup by `clientRecordId`.
- [x] (2026-10-29) Milestone 2, order-trail half: authenticated `GET /mobile-placement/order-trail` with exact 10-digit validation, bounded source queries (200 each), process/status mapping, all seven event feeds, JST dates, newest-first sorting, current shelves, and loose purchasing matches. Unknown orders return `null`.
- [x] (2026-10-29) Milestone 3: registered both kiosk routes in the existing kiosk/mobile-sync layout and made current-shelf amber text/border override the ghost-button defaults.
- [x] (2026-10-29) Milestones 2–3 validation: API `pnpm exec vitest run src/routes/__tests__/mobile-placement-order-trail.test.ts src/services/mobile-placement/__tests__/order-trail.service.test.ts` passed (15 tests, 0.61s). Web `pnpm exec tsc --noEmit` and `pnpm exec vitest run src/App.haizen-routes.test.tsx src/pages/kiosk/KioskHaizenPage.test.tsx` passed (22 tests, 11.01s). Root `pnpm -r lint` passed (approximately 3 minutes). `git diff --check` passed. Existing WIP was preserved; no commit, push, migration execution, or deploy was performed.
- [x] (2026-10-29) Prisma validate/generate passed. Mocked API route/service tests passed (2 files, 14 tests; 1.19s). Web typecheck and the requested verify-records, page-state and haizen tests passed (13 files, 142 tests; 11.52s). `pnpm -r lint` passed after correcting one added import order.
- [ ] Validation: API typecheck is blocked by existing `rootDir: src` / include conflicts (TS6059). Postgres integration/migration execution is not performed in this mocked-test run. Supplemental API typecheck (`--rootDir .`) finished with 498 diagnostics outside the new verify-record files and none in those files. Full API typecheck remains unpassed; unrelated errors were left out of scope.

## Surprises & Discoveries

- (2026-10-29) The referenced scan-frame endpoint accepts one record per POST; its runner uploads a bounded sequence. Verify records follow that wire shape with up to 20 records per sync run.
- (2026-10-29) An unlinked upload can finish after `put()` adds its placement link. Acknowledgement removes only the uploaded link version, preserving the changed record for another POST; this race is covered by store and runner tests. The recorder retains the last payload so an already uploaded record can be queued again with the same `clientVerifyId`.
- (2026-10-29) The supplied API typecheck command stops before checking source because `tsconfig.json` includes Prisma, scripts and Vitest config outside `rootDir: src`. A supplemental command with `--rootDir .` reports 498 repository type errors and no errors in the new verify-record files after the correction; the new route test's copied untyped error handler was corrected. No unrelated configuration or source files were changed.

- Phone verify usually never reaches the server. `verifyLocalFirst` (`apps/web/src/features/mobile-placement/local-data/localFirstLookup.ts`) answers from on-phone data and only calls `POST /mobile-placement/verify-slip-match` when local data is missing. So logging inside that route would miss most verifies; the phone must upload results itself.
- `useHaizenWorkflow` (`apps/web/src/features/mobile-placement/haizen/useHaizenWorkflow.ts`) re-runs verify whenever the inputs change and on 再試行, so the same pair can be verified many times.
- `ProductionScheduleActualHoursRaw.lotNo` is filled from `FSEZONO` (`production-actual-hours-import.service.ts`), so actual hours join to the production order directly.

## Decision Log

- Decision: record one verify per distinct input set and outcome. The input set is (transfer order, transfer part, actual order, actual fseiban, actual part). The phone remembers the last recorded input set and outcome; when a verify finishes with the same input set and the same outcome it is not recorded again. A pending verify is never recorded. A thrown error is recorded as outcome `error`. `part_required`, `order_not_found` and `transfer_not_found` are recorded (shown as 未登録). Rationale: the approved mock shows a 照合できず row followed a minute later by an 一致 row for the same order, and retries with the same result should not add rows. Date: 2026-10-29.
- Decision: link a verify to the placement that followed it through the placement's existing `clientRecordId`. When 「ここに置く」 runs (`put()` in `HaizenHub.tsx`, where `clientRecordId` is created), the phone attaches that id to the last recorded verify of the current verify tab. If the verify record is still on the phone, it is updated in place; if it was already sent, a second POST with the same `clientVerifyId` and the `clientRecordId` sets the link on the server. Reading joins `OrderPlacementEvent` by `clientRecordId`. Rationale: same mechanism as scan frames; a join by device, order and time window breaks when one order is placed twice. Date: 2026-10-29.
- Decision: no columns are added to `OrderPlacementEvent` and verify logging is not added to `POST /mobile-placement/verify-slip-match`. Date: 2026-10-29.
- Decision: purchasing rows join only by 製番 + 品番, which can match several orders; they are marked `loose: true`. Date: 2026-10-29.

## Outcomes & Retrospective

Not yet.

## Context and Orientation

The repository is a pnpm monorepo. `apps/api` is a Fastify server with Prisma (Postgres); `apps/web` is React with TanStack Query. Phones and kiosks are both `ClientDevice` rows and authenticate with the `x-client-key` header checked by `requireClientDevice` (imported in `apps/api/src/routes/mobile-placement/index.ts` from `../kiosk/shared.js`). Mobile placement routes are registered in `registerMobilePlacementRoutes` in that file and served under `/api`.

The closest template is the scan-frame upload added by PR #2371. Server: `apps/api/src/routes/mobile-placement/scan-frames.ts`, `apps/api/src/services/mobile-placement/mobile-scan-frame.service.ts`, the `MobileScanFrame` model in `apps/api/prisma/schema.prisma`, migration `apps/api/prisma/migrations/20261029120000_mobile_scan_frames/migration.sql`, and the mocked route test `apps/api/src/routes/__tests__/mobile-placement-scan-frames.test.ts`. Phone: `apps/web/src/features/mobile-placement/scan-frames/` (`scanFrameStore.ts` IndexedDB store with memory fallback, `saveScanFrame.ts`, `scanFrameUploadRunner.ts`, and their tests), wired with one `registerSyncJob` in `apps/web/src/features/mobile-placement/sync/MobileSyncProvider.tsx`. A client-made uuid gives idempotency: a duplicate POST answers 409 and the phone deletes its local copy.

The phone verify runs in `runSlipVerify` (`apps/web/src/features/mobile-placement/useMobilePlacementPageState.ts`), which builds the input (transferOrder, transferPart, actualOrder, actualFseiban, actualPart), calls `verifyLocalFirst`, and maps the result to `slipResult` 'ok' / 'ng' / 'not-found' / 'error'. The full result type is `SlipVerificationResult` in `packages/slip-match-core/src/verify.ts` (`ok`, `reason` of match / different_seiban / different_part / part_required / order_not_found / transfer_not_found, `expected { fseiban, fhincd, partName? }`, `actual { fseiban?, partCode? }`, `matchedBy?`, `actualResolvedBy?`).

Production-order data: the schedule rows are `CsvDashboardRow` with `csvDashboardId = PRODUCTION_SCHEDULE_DASHBOARD_ID` (`apps/api/src/services/production-schedule/constants.ts`) and `rowData` keys `ProductNo`, `FSEIBAN`, `FHINCD`, `FHINMEI`, `FSIGENCD` (resource code), `FKOJUN` (process order). Process status: `ProductionScheduleFkojunstMailStatus` (`fsezono`, `fkoteicd`, `fkojun`, `statusCode`, `sourceUpdatedAt`), `ProductionScheduleFkojunstStatus` (`productNo`, `resourceCd`, `processOrder`, `statusCode`, `updatedAt`), `ProductionScheduleProgress` (`csvDashboardRowId`, `isCompleted`, `updatedAt`). Status codes: C done, S started, R move slip issued, X off-site, P unconfirmed. Resource names: `ProductionScheduleResourceMaster` by `resourceCd`. Actual hours: `ProductionScheduleActualHoursCanonical` (`lotNo` = ProductNo, `resourceCd`, `processOrder`, `workDate`, `actualMinutes`, `isExcluded`). Shelves: `OrderPlacementEvent` (`manufacturingOrderBarcodeRaw`, `branchNo`, `shelfCodeRaw`, `placedAt`, `slipKind`, `clientRecordId`, `clientDevice`, `mobileScanFrames`) and `OrderPlacementBranchState` (current shelf per branch). Zero2W: `HaizenScanEvent` (`manufacturingOrderBarcodeRaw`, `presetShelfCodeRaw`, `createdAt`) and `HaizenCurrentPlacement`. Pallets: `MachinePalletEvent` (`actionType`, `resourceCd`, `palletNo`, `manufacturingOrderBarcodeRaw`, `createdAt`). Purchasing: `PurchaseOrderLookupRow` (`seiban`, `purchasePartCodeMatchKey`, `purchaseStatus`, `sourceUpdatedAt`). Machine display names: `resolveSeibanMachineDisplayNamesBatched`, as used by `listHaizenOverview` in `apps/api/src/services/mobile-placement/haizen-overview.service.ts`.

## Plan of Work

Milestone 1. Add Prisma model `MobileSlipVerifyRecord` (table `mobile_slip_verify_records`) with: id, `clientVerifyId` (uuid, unique), `clientDeviceId` (FK to ClientDevice), `verifiedAt`, `transferOrderBarcodeRaw`, `transferPartRaw?`, `actualOrderBarcodeRaw`, `actualFseibanRaw`, `actualPartRaw?`, `outcome` (enum match / mismatch / not_found / error), `reason?` (the slip-match reason), `expectedFseiban?`, `expectedFhincd?`, `expectedPartName?`, `actualResolvedFseiban?`, `actualPartCode?`, `matchedBy?`, `clientRecordId?` (placement link, not a FK), `createdAt`; indexes on `verifiedAt` and `transferOrderBarcodeRaw`. Add a migration with a timestamp after 20261029120000. Add `POST /mobile-placement/verify-records` (client device auth, Zod body, accepts a batch like scan frames): a new `clientVerifyId` creates the row (201); an existing one from the same device whose body carries a `clientRecordId` while the stored one is null sets it (200); any other duplicate answers 409. On the phone, add a verify-record store and upload runner beside the scan-frame ones, register one sync job, record from `runSlipVerify` per the dedupe decision, and attach the `clientRecordId` in `put()` per the link decision.

Milestone 2. Add `GET /mobile-placement/verify-records?days=1|7|30` returning `{ records: HaizenVerifyRecord[] }`, newest first, at most 500. Map outcome to `result` (match, mismatch, not_found, error), `mismatch` to 'fseiban' for different_seiban and 'part' for different_part, `deviceName` from the device, `fhinmei` from `expectedPartName` or the schedule row, `machineName` from the machine-name resolver, `placedShelfCodeRaw` and `branchNo` from the `OrderPlacementEvent` with the same `clientRecordId`. Add `GET /mobile-placement/order-trail?order=<10 digits>` returning `{ trail: HaizenOrderTrail | null }` (null when nothing is known). Steps come from the schedule rows of that ProductNo, one per process order, sorted numerically, with resource name from the resource master; status and tone: completed or code C → 加工完了 / done, S → 現場着手 / active, R → 移動票発行 / waiting, X → 外注 / waiting, otherwise 未確定 / none (prefer the mail status, then fkojunst status, then progress). Events: 棚 per placement event (title "<shelf> に置いた", detail "分配N · <device> · 写真あり" parts as available), 照合 per verify record (titles 照合 一致 / 照合 不一致 / 照合できませんでした; detail device and 現品票 number or 別の製番 X), 工程 per mail-status change (title "<resource> <status>", detail 状態の更新) and per non-excluded actual-hours row (date only, `at` null, detail "実績 N分"), パレット per pallet event, Zero2W per scan event (title "<shelf> を読んだ", detail 棚スキャナ), 購買 per purchase row by 製番 + 品番 (`loose: true`, date only). Events are sorted newest first; `date` is the local day (Asia/Tokyo) as YYYY-MM-DD. `currentShelves` comes from `OrderPlacementBranchState` and `HaizenCurrentPlacement`.

Milestone 3. Register `/kiosk/inventory/haizen/verify-history` and `/kiosk/inventory/haizen/trail` next to `/kiosk/inventory/haizen` in `apps/web/src/App.tsx`, inside the same layout element. On the trail page the current-shelf links must keep their amber look.

## Concrete Steps

From the worktree root:

    pnpm --filter @raspi-system/api exec prisma validate
    docker start postgres-test-local
    DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/borrow_return pnpm --filter @raspi-system/api exec prisma migrate deploy
    cd apps/api && DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/borrow_return pnpm exec vitest run <new test files>
    cd apps/web && pnpm exec vitest run <new and touched test files> && pnpm exec tsc --noEmit
    pnpm -r lint

## Validation and Acceptance

API tests show: POST stores, repeats answer 409, the link POST sets `clientRecordId`, a wrong or missing key answers 401; GET verify-records maps outcomes and joins the placed shelf; GET order-trail returns steps and events for a seeded order and null for an unknown one. Web tests show: the same verify twice records once, a changed outcome records again, `put()` links the last record, the upload runner removes records on 201/409. The kiosk 配膳の場所 tests keep passing, and the two pages render from the real endpoints.

## Idempotence and Recovery

The migration only creates a table and an enum. Re-sending verify records is safe because of the unique `clientVerifyId`.

## Interfaces and Dependencies

Response types are fixed by `apps/web/src/features/kiosk/haizen/haizenRecordTypes.ts` and consumed by `apps/web/src/api/hooks/haizen-records.ts`.
