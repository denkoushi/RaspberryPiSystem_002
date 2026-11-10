---
title: "Runbook: Kiosk Device Initial Route"
tags: [kiosk, client-device, initial-route, deployment, validation]
audience: [ai-agent, developer, operator]
last-verified: 2026-07-06
related:
  - ../AI_START_HERE.md
  - ../../packages/shared-types/src/kiosk/kiosk-initial-route.ts
  - ../../apps/api/src/services/kiosk/kiosk-config.service.ts
  - ../../apps/api/src/routes/kiosk/config.ts
  - ../../apps/api/src/routes/clients/shared.ts
  - ../../apps/web/src/features/kiosk/kioskInitialRedirect.ts
  - ../../apps/web/src/features/kiosk/kioskHeaderTabs/kioskHeaderReorderableTabRenderer.tsx
  - ../../apps/web/src/pages/admin/ClientsPage.tsx
category: runbooks
id: RUNBOOK-kiosk-device-initial-route
status: active
scope: Per-device kiosk startup route configuration and verification
date: 2026-07-06
source_of_truth: true
validation: local tests, temporary pgvector Postgres migration, CI, Pi5 deploy, Pi4 kiosk deploy, Phase12
open_items: tab filtering by process, common top screen
---

# Runbook: Kiosk Device Initial Route

## Summary

> 端末ごとのキオスク起動先の現行仕様（Current Spec、Route IDs）と設定・確認手順（Operational Checks）を載せる。2026-07-06 の実装時の検証・反映記録は [docs/archive/deployments/2026-07.md](../archive/deployments/2026-07.md) へ移した。

## Current Spec

- Admin console path: `/admin/clients`.
- Table column and edit control: `起動先`.
- Stored field: nullable `ClientDevice.kioskInitialRoute`.
- Existing `ClientDevice.defaultMode` stays as legacy fallback.
- `GET /api/kiosk/config` returns `initialKioskRoute` and `initialKioskPath`.
- `GET/PUT /api/clients` returns and updates `kioskInitialRoute`.
- Admin updates require `ADMIN` or `MANAGER` as before.
- The kiosk dock home button sets the active tab as this device's startup page,
  without login or PIN. `PUT /api/kiosk/initial-route` uses `x-client-key` and
  accepts only `{ initialRoute: <ID> | null }`; no device selector is accepted.
  It updates only the authenticated device's `kioskInitialRoute` and returns
  `{ ok: true, initialKioskRoute, initialKioskPath }` with the config fallback.
- PIN tabs `tag_desk` and `due_management`, and paths outside the header tabs,
  cannot be startup pages. All other tabs are selectable; borrow has two IDs.
- The dock home icon and tab marker show the effective startup page, including
  the `defaultMode` fallback. Saving does not navigate. A notification above the
  dock stays visible when the dock hides; save offers undo (including null) for
  about 6 seconds, other notices last about 3 seconds.
- Kiosk auto redirect only evaluates `/` and `/kiosk`; direct subpaths such as
  `/kiosk/tag` are not overwritten.
- The header `持出` tab must link to a concrete borrow subpath, not `/kiosk`.
  It resolves to `/kiosk/photo` when `defaultMode` is `PHOTO`, otherwise
  `/kiosk/tag`.
- The header `持出` tab carries the start-page mark only when it leads to the
  start page: while the tab is open, the current screen (tag or photo) must be
  the start page; otherwise the tab's link target must be. This keeps the mark
  in step with the dock's home button.
- If `kioskInitialRoute` is explicitly set, it takes priority over browser
  `kiosk-last-path`.
- If `kioskInitialRoute` is null or invalid, the legacy fallback is:
  `PHOTO -> /kiosk/photo`, otherwise `/kiosk/tag`.

## Route IDs

All selectable startup routes (existing IDs and paths remain valid):

| ID | Label | Path |
| --- | --- | --- |
| `portal` | `ポータル` | `/kiosk/portal` |
| `borrow_tag` | `2タグスキャン` | `/kiosk/tag` |
| `borrow_photo` | `写真撮影持出` | `/kiosk/photo` |
| `production_schedule` | `生産スケジュール` | `/kiosk/production-schedule` |
| `leader_order_board` | `順位ボード` | `/kiosk/production-schedule/leader-order-board` |
| `assembly` | `組立` | `/kiosk/assembly` |
| `self_inspection` | `自主検査` | `/kiosk/part-measurement/self-inspection` |
| `inventory_settings` | `在庫` | `/kiosk/inventory` |
| `instruments_borrow` | `計測機器 持出` | `/kiosk/instruments/borrow` |
| `rigging_borrow` | `吊具 持出` | `/kiosk/rigging/borrow` |
| `manual_order` | `手動順番` | `/kiosk/production-schedule/manual-order` |
| `grinding_planning_board` | `製番ボード` | `/kiosk/production-schedule/planning-board` |
| `progress_overview` | `進捗一覧` | `/kiosk/production-schedule/progress-overview` |
| `load_balancing` | `負荷調整` | `/kiosk/production-schedule/load-balancing` |
| `purchase_order_lookup` | `購買照会` | `/kiosk/purchase-order-lookup` |
| `pallet_visualization` | `パレット` | `/kiosk/pallet-visualization` |
| `shelf_master` | `棚マスタ` | `/kiosk/mobile-placement/shelf-master` |
| `documents` | `要領書` | `/kiosk/documents` |
| `part_measurement` | `部品測定` | `/kiosk/part-measurement` |
| `inspection_drawing` | `検査図面` | `/kiosk/part-measurement/inspection` |
| `rigging_analytics` | `集計` | `/kiosk/rigging-analytics` |
| `machine_signal` | `設備稼働` | `/kiosk/machine-signal` |
| `call` | `通話` | `/kiosk/call` |

## Implementation State

- Shared route source of truth:
  [kiosk-initial-route.ts](../../packages/shared-types/src/kiosk/kiosk-initial-route.ts).
- API config resolution:
  [kiosk-config.service.ts](../../apps/api/src/services/kiosk/kiosk-config.service.ts)
  and [config.ts](../../apps/api/src/routes/kiosk/config.ts).
- API client update validation:
  [shared.ts](../../apps/api/src/routes/clients/shared.ts).
- Web redirect decision is pure and tested:
  [kioskInitialRedirect.ts](../../apps/web/src/features/kiosk/kioskInitialRedirect.ts).
- Kiosk header borrow-tab path resolution:
  [kioskHeaderReorderableTabRenderer.tsx](../../apps/web/src/features/kiosk/kioskHeaderTabs/kioskHeaderReorderableTabRenderer.tsx).
- Admin UI route selection:
  [ClientsPage.tsx](../../apps/web/src/pages/admin/ClientsPage.tsx).
- Prisma migration:
  `apps/api/prisma/migrations/20260706150000_add_client_device_kiosk_initial_route/migration.sql`.
- Kiosk header tab order and bottom-edge hover behavior were intentionally not changed.
- Process-specific tab restriction and a common top screen were intentionally not included in v1.

Validation Results、Deployment State、2026-07-06 のトラブル記録（Pi5 API build OOM、Pi4 deploy bootstrap lock、Ansible ad-hoc verification quoting）は [docs/archive/deployments/2026-07.md](../archive/deployments/2026-07.md#2026-07-06-キオスク端末別起動先kiosk-device-initial-route) へ移した。

## Operational Checks

To set a device startup route:

1. Open `/admin/clients`.
2. Find the target client row, for example `raspi4-sessaku-01`.
3. Click `編集`.
4. Change `起動先`.
5. Save.
6. On the kiosk, open `/` or `/kiosk`, or restart the browser service.

If a kiosk is already on a direct subpath such as `/kiosk/tag`, the redirect code
does not force it away from that subpath. This is expected behavior to avoid
interrupting in-progress work.

For browser-level confirmation, call `/api/kiosk/config` with the device
`x-client-key` and confirm:

- `initialKioskRoute` is the configured ID.
- `initialKioskPath` is the expected path.

Do not paste real client keys into docs, PRs, or chat.

## Troubleshooting Notes

### Apparent startup route miss

During validation, `raspi4-sessaku-01` was configured for `組立`, but the screen
being watched was later identified as `raspi4-kensaku-stonebase01`. That was a
target-device mix-up, not evidence of redirect failure.

Check the actual client row, hostname, and browser URL before treating a startup
route mismatch as a code issue.

### `組立` startup immediately pulls `持出` back to `組立`

Cause found on 2026-07-06:

- The header `持出` tab still linked to `/kiosk`.
- `/kiosk` is now the startup-entry route.
- When a device had explicit `kioskInitialRoute=assembly`, clicking `持出`
  navigated to `/kiosk`, then `KioskRedirect` correctly redirected that entry
  route to `/kiosk/assembly`.

Fix:

- Resolve the `持出` header tab to a concrete borrow route:
  `/kiosk/photo` for `PHOTO`, otherwise `/kiosk/tag`.
- Keep `KioskRedirect` scoped to `/` and `/kiosk`; direct subpaths remain
  untouched.
- Regression tests cover both the redirect no-op for `/kiosk/tag` and the
  rendered header link path.

If this symptom recurs, inspect the rendered `持出` anchor first. It must be
`/kiosk/tag` or `/kiosk/photo`, never `/kiosk`.

## Open Items

- Future phase: process-specific tab visibility or a common top screen. These
  were explicitly out of scope for v1.
