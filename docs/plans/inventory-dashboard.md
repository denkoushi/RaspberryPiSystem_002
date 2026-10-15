# Kiosk inventory usage dashboard

This local implementation plan follows `.agent/PLANS.md`. Implementation, PR, merge and deployment were approved by the user on 2026-10-15.

## Purpose / Big Picture

Add 集計 to 在庫の準備 so operators can compare weekly usage, stock and current-price cost, set an item price, and review spelling variants without leaving the PIN-protected setup screen.

## Progress

- [x] Read safety, quality, architecture, UI and documentation rules; confirmed clean worktree and inspected approved HTML mock.
- [x] Add schema, shared contracts, bounded dashboard query and variant service/routes.
- [x] Add price editor and dashboard with existing setup-session hooks.
- [x] Add contract tests and run requested validation. API full-project typecheck remains blocked by existing configuration/type errors; browser visual verification is unavailable in this environment.

## Context and Orientation

`apps/api/src/services/item-inventory/item-inventory.service.ts` records ISSUE with negative delta and CANCEL with reversalOfId. Compartments obtain their area from drawer.shelf. `apps/web/src/features/kiosk/inventory/setup/` contains the setup tabs; API functions and hooks live in `apps/web/src/api/domains/item-inventory.ts` and `apps/web/src/api/hooks/item-inventory.ts`. Shared inventory contracts live in `packages/shared-types/src/tools/item-inventory.ts`.

## Plan of Work

First add nullable price and sorted dismissal pairs with an additive migration. Introduce a pure dashboard aggregator plus a service query bounded by the two comparison periods. Introduce pure variant suggestions and explicit merge/dismiss routes using setup authorization. Then add the 12-column dashboard and inline item price control, preserving PIN-session expiration behavior. Finally test the contracts and run the specified app suites and type checks.

## Decision Log

- Canceled ISSUE rows are excluded at the original issue date, including cancellations across week boundaries. RESTOCK and its cancellation do not contribute to usage.
- Weeks start Monday at midnight in Asia/Tokyo; the current partial week is included. Previous period contains the same number of calendar weeks.
- Prices are current item prices, not historical transaction prices. Existing data has no price history.
- Machine scope follows the compartment's current shelf area, because movement transactions do not record a structured historical machine on ISSUE.
- Normalization is shared and applied at display time; GET never rewrites stored values. Auto count counts redundant raw spellings. Human-approved variants persist through the existing rename operation.

## Surprises & Discoveries

The existing rename method normalized the source before matching, which missed legacy full-width or spaced stored values. It now validates the source but matches its exact stored spelling, while retaining target normalization.

The transaction self-relation already identifies reversals, allowing cancellation exclusion without loading unlimited transaction history.

## Validation and Acceptance

From repository root, build shared-types; run API prisma validate and generate, API vitest on src/routes/item-inventory and src/services/item-inventory, API tsc, web vitest on src/features/kiosk/inventory and src/pages/kiosk, web tsc, and ESLint on changed app files. Tests must cover Tokyo boundaries, reversals, machine scope, price null/zero, variant rules and dismissal, authenticated routes, and dashboard interactions. The screen must retain the mock's 4 tiles and 7/5 then 5/3/4 panel proportions within the available height.

## Idempotence and Recovery

Do not apply migrations to a database. Schema generation and tests are local only. Preserve all user WIP; never read .env files, contact services, or change git history. The migration is additive and existing unpriced items remain null.

## Outcomes & Retrospective

Implemented nullable price editing, Tokyo-week usage and current-price costs, machine filters, shared display normalization, maker/tool-name suggestions, dismissal persistence and explicit merges. No migration was applied. Integration and deployment remain outside scope.

Local validation on 2026-10-15 (about 8 minutes including failure investigation):

- `pnpm --filter @raspi-system/shared-types build`: passed.
- `pnpm --filter @raspi-system/api exec prisma validate`: passed.
- `pnpm --filter @raspi-system/api exec prisma generate`: passed.
- `pnpm --filter @raspi-system/api exec vitest run src/routes/item-inventory src/services/item-inventory`: 213 passed; 2 existing DB integration tests skipped, 5.56 seconds.
- `pnpm --filter @raspi-system/api exec tsc --noEmit -p .`: blocked by existing TS6059 rootDir/include mismatch for prisma, scripts and vitest config. One diagnostic run with `--rootDir .` showed existing repository errors (including an unchanged mock typing at item-inventory.service.test.ts:861); no errors in files changed by this task. These unrelated errors were not modified.
- `pnpm --filter @raspi-system/web exec vitest run src/features/kiosk/inventory src/pages/kiosk`: 611 passed, 14.60 seconds. Existing tests logged failed resource requests; no external service was required.
- `pnpm --filter @raspi-system/web exec tsc --noEmit -p .`: passed.
- `pnpm exec eslint <changed TS/TSX files>` in each app: passed. The dashboard hook was checked again after preserving filter choices during refetch.
- `git diff --check`: passed.

CLI/test automatic `.env` discovery was blocked with a temporary Node preload, and Prisma used an explicit non-secret local dummy DATABASE_URL. No credentials were read. First focused checks exposed a missing shared barrel export and an ambiguous UI assertion, both corrected. Period switching then exposed temporarily disappearing machine choices; keeping previous query data resolved it.

A visual preview was bundled using mocked data, but the environment rejected localhost listen (EPERM) and installed Chrome startup (SIGABRT). No screenshot or no-scroll measurement is claimed. Temporary preview sources were removed. The actual 1920×1080 render remains unverified.

Suggestions intentionally cover maker and toolName; additional option fields remain optional scope. Current machine assignment is used because historical ISSUE records have no structured machine snapshot. Zero-baseline percentage comparison displays 比較なし when current usage is nonzero.

## Artifacts and Notes

Approved layout: the HTML mock reviewed on 2026-10-15 (published as an artifact, not kept in the repo).

## Interfaces and Dependencies

No new packages. Shared normalizeToolValue and dashboard/variant types connect API and web. GET /item-inventory/dashboard accepts weeks 4, 12, 26 or 52 and optional machine. GET /item-inventory/tool-value-variants reports groups; POST merge and dismiss modify stored choices or distinct pairs. PUT item details accepts nullable integer unitPrice from 0 to 10000000.

## Changed Files

- `apps/api/prisma/migrations/20261015120000_inventory_dashboard/migration.sql`
- `apps/api/prisma/schema.prisma`
- `apps/api/src/routes/item-inventory/dashboard.test.ts`
- `apps/api/src/routes/item-inventory/index.ts`
- `apps/api/src/services/item-inventory/__tests__/inventory-dashboard.test.ts`
- `apps/api/src/services/item-inventory/__tests__/tool-value-variants.test.ts`
- `apps/api/src/services/item-inventory/inventory-dashboard.ts`
- `apps/api/src/services/item-inventory/item-inventory.service.ts`
- `apps/api/src/services/item-inventory/tool-value-variants.ts`
- `apps/web/src/api/domains/item-inventory.ts`
- `apps/web/src/api/hooks/item-inventory.ts`
- `apps/web/src/features/kiosk/inventory/setup/InventoryDashboardTab.test.tsx`
- `apps/web/src/features/kiosk/inventory/setup/InventoryDashboardTab.tsx`
- `apps/web/src/features/kiosk/inventory/setup/InventoryItemEditTab.test.tsx`
- `apps/web/src/features/kiosk/inventory/setup/InventoryItemEditTab.tsx`
- `apps/web/src/pages/kiosk/KioskItemInventorySettingsPage.test.tsx`
- `apps/web/src/pages/kiosk/KioskItemInventorySettingsPage.tsx`
- `docs/plans/inventory-dashboard.md`
- `packages/shared-types/src/tools/index.ts`
- `packages/shared-types/src/tools/item-inventory.ts`
