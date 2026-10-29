# Kiosk inventory setup: dismiss, search, tag feedback and scoped choices

This ExecPlan follows `.agent/PLANS.md`. Scope is local implementation and validation in the existing `feat/kiosk-inventory-setup-seigi` worktree. Commit, push, merge and deployment are not authorized.

## Purpose / Big Picture

Operators can hide and restore resolved import errors, find items by department, shelf or label number, see tag replacement results, and manage independent tool choices for 生産技術課. The approved local `mock-ref.html` defines the changed UI; mock controls and sample data are excluded. Existing photos, units, prices, move and delete flows remain intact.

## Progress

- [x] 2026-10-29: Read relevant rules, confirm clean worktree, inspect mock and data ownership.
- [x] 2026-10-29: Add migration, scoped service/API contracts and import dismissal guards.
- [x] 2026-10-29: Complete UI and regression tests (API 241 passed, Web 159 passed).
- [x] 2026-10-29: Run focused API/Web tests, application TypeScript checks and both lint scripts; record unavailable DB/browser checks.

## Context and Orientation

`apps/api/src/services/item-inventory/item-inventory-tool-fields.ts` combines presets with values used by inventory items. `item-inventory.service.ts` exposes these functions through `routes/item-inventory/index.ts`. The web domain and hooks forward requests to the setup components under `apps/web/src/features/kiosk/inventory/setup/`. Import messages are separate from import payloads. The Gmail ingestion service owns retry eligibility. Tag replacement lives in `item-inventory-transactions.ts`.

## Plan of Work

First add nullable `InventoryImportMessage.dismissedAt` and `InventoryToolFieldPreset.scope`, defaulting existing presets to `default`. Keep omitted API scope backward compatible. Derive scope from the first displayed compartment's drawer/shelf area using shelf-layout-core `splitArea`; no location means `default`. Apply that filter to options, usage counts, rename, merge and deletion checks. Keep distinct-value exclusions global.

Next connect dismissal/undo to the registration screen, add department and shelf navigation with highlighted label-number searching, and show replacement scanning over the photo/information region. Extend the existing 409 details with tag usage location while preserving its message. Pass scope through the board and query keys.

Finally add regression tests and execute focused validation. Do not create dependencies or consult another checkout.

## Milestones

The persistence milestone is complete when dismissed messages cannot be retried, restored messages return, and scoped mutations affect only their group. The UI milestone is complete when the mock's changed states are represented with real data and no new helper copy. The validation milestone records passing checks and any unavailable DB evidence without claiming deployment.

## Validation and Acceptance

Run `pnpm --filter @raspi-system/api test` with item-inventory test paths and `pnpm --filter @raspi-system/web test src/features/kiosk/inventory/setup`. Add tests for scope isolation, dismissal/restore and retry exclusions, and tag conflict details/feedback. Package scripts have no standalone typecheck; use the TypeScript portion of build (`tsc -p tsconfig.build.json --noEmit` for API and `tsc -b` for Web). Run both package lint scripts. Prisma generation is permitted; production migration execution is not part of this work.

## Decision Log

- Use placement area, not `InventoryItem.area`: registration explicitly preserves the email's machine in the latter even when the selected shelf differs.
- Order compartments by creation time, then ID, consistently in item display and scope selection, so equal timestamps cannot assign different groups.
- Preserve entered registration fields when changing areas, matching existing draft behavior; the board choices and editing state switch with scope.
- Photo suggestions read image text directly and do not consult choices, so no suggestion scope change is needed.

## Surprises & Discoveries

Automatic ingestion enumerates Gmail search results (`in:inbox is:unread`) and mail-cleanup records, not all retryable/stale DB records. Old mail falling out of that search can leave RETRYABLE/PROCESSING rows indefinitely. PROCESSING is persisted before processing, so interrupted work can also leave it. Actual historical events were not inspected; the precise cause of the user's records remains unconfirmed.

Tag replacement detaches the old UID by setting its compartment to null. Stock operations reject it afterward, so the requested success copy is accurate for inventory use. The row remains in the DB and new registration may reuse it; the current replacement API rejects an already-known unassigned UID. This adjacent behavior is unchanged.

## Idempotence and Recovery

Dismissal is reversible by setting the timestamp to null. Migration preserves every existing row and default scope. No database migration or production operation is performed. Existing working changes were absent at start; leave all implementation changes uncommitted.

## Outcomes & Retrospective

All four requested behaviors are implemented locally. Focused API and Web tests pass. Database integration tests are skipped because no dedicated TEST_DATABASE_URL is configured. Browser layout validation could not start because the sandbox rejects listening on 127.0.0.1:4178 with EPERM. API and Web TypeScript checks and both application lint scripts pass. Local verification took approximately 15 minutes, within the 45-minute DB-change validation budget. No commit, push, database migration or deployment was performed.

## Artifacts and Notes

Migration: `apps/api/prisma/migrations/20261029130000_inventory_setup_scope_and_dismiss/migration.sql`.

## Interfaces and Dependencies

Shared type `InventoryToolScope` is `default | seigi`. Scope defaults to `default` on read queries and mutation bodies. The new authorized `PUT /item-inventory/import-messages/:id/dismissed` accepts `{ dismissed: boolean }`. Tag conflict responses retain HTTP 409 and their existing message, adding `details.usedBy` when a compartment is known. No new dependencies.

## Validation Evidence

- `pnpm --filter @raspi-system/api prisma:generate`: passed; generated client for the additive schema change.
- `pnpm --filter @raspi-system/shared-types build`: passed after exporting InventoryToolScope from tools/index.ts.
- `pnpm --filter @raspi-system/api test src/services/item-inventory src/routes/item-inventory src/services/imports/__tests__/item-inventory-import-schedule.policy.test.ts`: 241 passed, 2 skipped, 38 seconds on final run. The first run had one outdated default-scope argument expectation; updated that assertion before the single rerun.
- `pnpm --filter @raspi-system/web test src/features/kiosk/inventory/setup`: 159 passed, 21 seconds on final run. The first run had a new test referencing a nonexistent button; corrected it to the actual existing area selector and 登録済みから選ぶ.
- Initial application typechecks reported the missing shared-type barrel export; the export was added and the shared package rebuilt before rerunning.
- `pnpm --filter @raspi-system/api exec tsc -p tsconfig.build.json --noEmit`: passed after the shared export fix.
- `pnpm --filter @raspi-system/web exec tsc -b`: passed after the shared export fix.
- `pnpm --filter @raspi-system/api lint`: passed.
- `pnpm --filter @raspi-system/web lint`: initial run reported five import-order errors and inconsistent JSX source offsets while that file was being edited. Import order was fixed; the single rerun on stable files passed with no errors or warnings.
- `pnpm --filter @raspi-system/web exec tailwindcss -i src/index.css -o /private/tmp/inventory-setup.css --minify`: passed; 9.4 seconds. Explicit arbitrary opacity values ensure the new green success borders are emitted.
- `git diff --check`: passed.
- Local preview using Vite createServer with an empty envDir: blocked by `listen EPERM: operation not permitted 127.0.0.1:4178`. No browser screenshot evidence is available.
- No dedicated test database is configured. The two existing guarded registration concurrency/label integration tests skip; no database or existing container was modified.

## Changed Files

- [apps/api/prisma/migrations/20261029130000_inventory_setup_scope_and_dismiss/migration.sql](../../apps/api/prisma/migrations/20261029130000_inventory_setup_scope_and_dismiss/migration.sql)
- [apps/api/prisma/schema.prisma](../../apps/api/prisma/schema.prisma)
- [apps/api/scripts/inventory-tool-presets-import.mjs](../../apps/api/scripts/inventory-tool-presets-import.mjs)
- [apps/api/src/routes/item-inventory/dashboard.test.ts](../../apps/api/src/routes/item-inventory/dashboard.test.ts)
- [apps/api/src/routes/item-inventory/index.ts](../../apps/api/src/routes/item-inventory/index.ts)
- [apps/api/src/routes/item-inventory/phase2-api.test.ts](../../apps/api/src/routes/item-inventory/phase2-api.test.ts)
- [apps/api/src/services/item-inventory/__tests__/inventory-dashboard.test.ts](../../apps/api/src/services/item-inventory/__tests__/inventory-dashboard.test.ts)
- [apps/api/src/services/item-inventory/__tests__/inventory-setup-scope.test.ts](../../apps/api/src/services/item-inventory/__tests__/inventory-setup-scope.test.ts)
- [apps/api/src/services/item-inventory/__tests__/item-inventory-gmail-ingestion.test.ts](../../apps/api/src/services/item-inventory/__tests__/item-inventory-gmail-ingestion.test.ts)
- [apps/api/src/services/item-inventory/__tests__/item-inventory.service.test.ts](../../apps/api/src/services/item-inventory/__tests__/item-inventory.service.test.ts)
- [apps/api/src/services/item-inventory/item-inventory-gmail-ingestion.service.ts](../../apps/api/src/services/item-inventory/item-inventory-gmail-ingestion.service.ts)
- [apps/api/src/services/item-inventory/item-inventory-operations.ts](../../apps/api/src/services/item-inventory/item-inventory-operations.ts)
- [apps/api/src/services/item-inventory/item-inventory-tool-fields.ts](../../apps/api/src/services/item-inventory/item-inventory-tool-fields.ts)
- [apps/api/src/services/item-inventory/item-inventory-transactions.ts](../../apps/api/src/services/item-inventory/item-inventory-transactions.ts)
- [apps/api/src/services/item-inventory/item-inventory.service.ts](../../apps/api/src/services/item-inventory/item-inventory.service.ts)
- [apps/web/src/api/domains/item-inventory.ts](../../apps/web/src/api/domains/item-inventory.ts)
- [apps/web/src/api/hooks/item-inventory.ts](../../apps/web/src/api/hooks/item-inventory.ts)
- [apps/web/src/features/kiosk/inventory/setup/InventoryItemEditTab.test.tsx](../../apps/web/src/features/kiosk/inventory/setup/InventoryItemEditTab.test.tsx)
- [apps/web/src/features/kiosk/inventory/setup/InventoryItemEditTab.tsx](../../apps/web/src/features/kiosk/inventory/setup/InventoryItemEditTab.tsx)
- [apps/web/src/features/kiosk/inventory/setup/InventoryRegistrationTab.test.tsx](../../apps/web/src/features/kiosk/inventory/setup/InventoryRegistrationTab.test.tsx)
- [apps/web/src/features/kiosk/inventory/setup/InventoryRegistrationTab.tsx](../../apps/web/src/features/kiosk/inventory/setup/InventoryRegistrationTab.tsx)
- [apps/web/src/features/kiosk/inventory/setup/NfcScanPanel.tsx](../../apps/web/src/features/kiosk/inventory/setup/NfcScanPanel.tsx)
- [apps/web/src/features/kiosk/inventory/setup/ToolValueBoard.tsx](../../apps/web/src/features/kiosk/inventory/setup/ToolValueBoard.tsx)
- [apps/web/src/features/kiosk/inventory/setup/inventorySetupMutations.test.tsx](../../apps/web/src/features/kiosk/inventory/setup/inventorySetupMutations.test.tsx)
- [apps/web/src/features/kiosk/inventory/setup/setupError.ts](../../apps/web/src/features/kiosk/inventory/setup/setupError.ts)
- [docs/INDEX.md](../../docs/INDEX.md)
- [docs/plans/kiosk-inventory-setup-seigi.md](../../docs/plans/kiosk-inventory-setup-seigi.md)
- [packages/shared-types/src/tools/index.ts](../../packages/shared-types/src/tools/index.ts)
- [packages/shared-types/src/tools/item-inventory.ts](../../packages/shared-types/src/tools/item-inventory.ts)

## Local Notes JA

取込記録が残る構造はコードから確認済みです。自動再試行はGmail検索対象から外れた旧メールを拾わず、登録完了も別の旧メッセージ記録を更新しません。既読・移動・削除や修正版の別メール送信、PROCESSING中断は起こり得る経路ですが、今回どれが発生したかは推測です。

旧タグは交換後の在庫操作に使えません。永久廃棄ではなく、新規登録では再利用可能です。未割当の既存UIDをタグ交換では拒否する既存の差異は依頼外として変更していません。旧タグなし、または同じUIDを再読取した場合は「古いタグは使えなくなりました」を表示せず、事実と異なる案内を避けています。

検証時に baseline-browser-mapping / caniuse-lite の古さの警告が出ました。依存更新は依頼外のため実施していません。

Final review: all 29 changed files belong to this request. The worktree was clean at entry; no pre-existing WIP was changed. `apps/web/src/generated/**`, secret files and the root EXEC_PLAN.md remain untouched. This plan was updated with implementation decisions and final validation evidence on 2026-10-29.
