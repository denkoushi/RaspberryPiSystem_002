---
title: Runbook: Kiosk Device Initial Route
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
open_items: tab filtering by process, common top screen, optional main-branch redeploy after merge
---

# Runbook: Kiosk Device Initial Route

## Summary

This runbook is the canonical handoff for the kiosk per-device startup route work.
It records the implemented v1 behavior, verification results, deployment state, and
known operational notes needed by the next AI agent.

## Current Spec

- Admin console path: `/admin/clients`.
- Table column and edit control: `起動先`.
- Stored field: nullable `ClientDevice.kioskInitialRoute`.
- Existing `ClientDevice.defaultMode` stays as legacy fallback.
- `GET /api/kiosk/config` returns `initialKioskRoute` and `initialKioskPath`.
- `GET/PUT /api/clients` returns and updates `kioskInitialRoute`.
- Authorization follows the existing client management rule: `ADMIN` or `MANAGER`.
- Kiosk auto redirect only evaluates `/` and `/kiosk`; direct subpaths such as
  `/kiosk/tag` are not overwritten.
- The header `持出` tab must link to a concrete borrow subpath, not `/kiosk`.
  It resolves to `/kiosk/photo` when `defaultMode` is `PHOTO`, otherwise
  `/kiosk/tag`.
- If `kioskInitialRoute` is explicitly set, it takes priority over browser
  `kiosk-last-path`.
- If `kioskInitialRoute` is null or invalid, the legacy fallback is:
  `PHOTO -> /kiosk/photo`, otherwise `/kiosk/tag`.

## Route IDs

Selectable startup routes as of 2026-07-06:

| ID | Label | Path |
| --- | --- | --- |
| `borrow_tag` | `2タグスキャン` | `/kiosk/tag` |
| `borrow_photo` | `写真撮影持出` | `/kiosk/photo` |
| `leader_order_board` | `順位ボード` | `/kiosk/production-schedule/leader-order-board` |
| `assembly` | `組立` | `/kiosk/assembly` |

Legacy-compatible but no longer selectable in the admin dropdown:

| ID | Label | Path |
| --- | --- | --- |
| `production_schedule` | `生産スケジュール` | `/kiosk/production-schedule` |

The legacy ID remains accepted by API validation and path resolution so that
existing rows do not break. When a row already has a legacy value, the admin
edit dropdown keeps it visible as `既存設定`.

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

## Validation Results

Local validation completed on branch `feat/kiosk-device-initial-route` before merge:

- `pnpm --filter @raspi-system/shared-types build` passed.
- `pnpm --filter @raspi-system/api build` passed.
- `pnpm --filter @raspi-system/web test` passed:
  254 test files, 1272 tests.
- `pnpm --filter @raspi-system/web build` passed.
- Focused web redirect tests passed, including:
  explicit route priority, subpath no-op, legacy last-path restore, invalid fallback.
- API integration tests passed for:
  client save/read/clear/reject, kiosk config fallback, `assembly`, and
  `leader_order_board`.
- Temporary `pgvector/pgvector:pg16` Postgres was used for DB validation.
  Existing DBs and existing containers were not modified.
- `prisma migrate deploy` and `prisma generate` passed against the temporary DB.
- `EXPLAIN (ANALYZE, BUFFERS)` for `ClientDevice.apiKey` lookup used the existing
  unique index `ClientDevice_apiKey_key`.
- Temporary container, volume, and network were removed after validation.

CI:

- Commit `d78377ee` passed GitHub Actions run `28770698340`.
- Follow-up regression fix commit `cbe78dab` passed GitHub Actions run
  `28775139271`, including `lint-build-unit`, `api-db-and-infra`,
  `security-docker`, `e2e-smoke`, and `e2e-tests`.

## Deployment State

Pi5 validation deploy:

- Deployed commit: `d78377ee`.
- Branch at deploy time: `feat/kiosk-device-initial-route`.
- API and DB containers were healthy after deploy.
- API health returned `status: ok`.

Pi4 kiosk deploy:

- Deployed commit: `d78377ee`.
- Run ID: `20260706-151824-18843`.
- Summary path on Pi5:
  `/opt/RaspberryPiSystem_002/logs/deploy/ansible-update-20260706-151824-18843.summary.json`.
- Result: `totalHosts: 5`, `failedHosts: []`, `unreachableHosts: []`, `success: true`.
- Verified hosts:
  `raspberrypi4`, `raspi4-robodrill01`, `raspi4-fjv60-80`,
  `raspi4-kensaku-stonebase01`, `raspi4-sessaku-01`.
- Each verified host reported:
  `REV=d78377ee`, kiosk service active, status-agent timer active, and Firefox
  launched with `_appRef=d78377ee`.

Follow-up deploy for header `持出` tab redirect regression:

- Deployed commit: `cbe78dab`.
- Branch at deploy time: `fix/kiosk-borrow-tab-direct-route`.
- Pi5 deploy run: `20260706-164538-3734`; result `failed=0`,
  `unreachable=0`, API health `status: ok`.
- StoneBase deploy run: `20260706-165104-32318`; result `failed=0`,
  `unreachable=0`.
- Remaining Pi4 deploy run: `20260706-174215-29814`; targets:
  `raspberrypi4`, `raspi4-robodrill01`, `raspi4-fjv60-80`,
  `raspi4-sessaku-01`; result `failed=0`, `unreachable=0`.
- Final automatic real-device verification:
  `./scripts/deploy/verify-phase12-real.sh` -> `PASS 45 / WARN 0 / FAIL 0`.
- All Pi4 kiosks were checked from Pi5 and reported `REV=cbe78dab`,
  `kiosk-browser.service=active`, `status-agent.timer=active`, and Firefox
  `_appRef=cbe78dab`.
- StoneBase screen capture confirmed the configured `組立` startup screen
  rendered as `組立トルク管理`.
- Production Playwright regression check with the StoneBase client context:
  `/kiosk/assembly` -> click `持出` -> `/kiosk/photo`; it did not return to
  `/kiosk/assembly`.
- Operator real-device check: OK.

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

### Pi5 API build OOM

The first Pi5 deploy attempt failed during API TypeScript build with Node heap
exhaustion. The existing containers recovered through the deploy script.

Workaround used successfully:

```bash
NODE_OPTIONS=--max-old-space-size=3072 ./scripts/server/deploy.sh feat/kiosk-device-initial-route
```

### Pi4 deploy bootstrap lock

`./scripts/update-all-clients.sh ... --job --follow` failed before the playbook
started and left a stale lock:

```text
/opt/RaspberryPiSystem_002/logs/.update-all-clients.lock
```

Before removing this lock, verify there is no active Ansible or systemd deploy
job. After that, removing the stale lock and rerunning the normal detach/follow
path succeeded.

### Ansible ad-hoc verification quoting

When verifying remote service state, escape remote shell substitutions so they
do not expand on Pi5 before reaching each kiosk host. The first unescaped check
reported a false `KIOSK=inactive`; the corrected escaped command showed all
kiosk services active.

## Open Items

- Optional: redeploy Pi5 and Pi4 kiosks from `main` after PR merge so the remote
  branch label matches `main`. Behavior is already present at commit `cbe78dab`.
- Future phase: process-specific tab visibility or a common top screen. These
  were explicitly out of scope for v1.
