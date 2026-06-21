# Production Schedule Order Split (Leaderboard Phase 1)

```yaml
id: production-schedule-split-orders
status: implemented
review_status: codex-reviewed-2026-06-20-final-pass10-pi5-flag-off-smoke
scope: kiosk-leaderboard-order-split
date: 2026-06-19
last_updated: 2026-06-20
source_of_truth: docs/plans/production-schedule-split-orders.md
related_code:
  - apps/api/src/services/production-schedule/order-split/
  - apps/api/src/routes/kiosk/production-schedule/order-split.ts
  - apps/api/src/services/production-schedule/order-assignment/order-assignment-release.repository.ts
  - apps/web/src/features/kiosk/leaderOrderBoard/LeaderOrderSplitModal.tsx
related_docs:
  - docs/decisions/ADR-20260507-leaderboard-shell-snapshot.md
  - docs/knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md
validation:
  - pnpm --filter api exec tsc -p tsconfig.build.json --noEmit
  - pnpm --filter web exec tsc -b --pretty false
  - pnpm --filter api exec vitest run src/services/production-schedule/order-split/
  - pnpm --filter api exec vitest run src/routes/__tests__/kiosk-production-schedule-order-split.integration.test.ts
  - pnpm --filter api exec vitest run src/services/production-schedule/order-assignment/__tests__/order-assignment-reconciliation.integration.test.ts
  - pnpm --filter web exec vitest run src/features/kiosk/productionSchedule/useProductionScheduleMutations.test.ts
  - pnpm --filter web exec vitest run src/features/kiosk/leaderOrderBoard/__tests__/LeaderOrderSplitModal.test.ts
  - pnpm --filter web exec vitest run src/features/kiosk/leaderOrderBoard/__tests__/LeaderOrderSplitModal.component.test.tsx
  - pnpm --filter api exec vitest run src/services/production-schedule/__tests__/order-supplement-sync.service.test.ts
  - pnpm --filter api exec vitest run src/services/production-schedule/__tests__/order-supplement-sync.integration.test.ts
deploy_status: pi5-flag-off-smoke-passed
open_items:
  - CSV re-import / winner change logical-key relink for existing splits (P2)
  - Split structure contract: global vs site-scoped semantics (needs API/data-model decision)
  - Split-item completion, self-inspection, load-balancing integration
  - Rename excludeRowIds API field to excludeDisplayItemIds (breaking-change phase)
```

## Goal

Allow kiosk leaderboard operators to split a parent production instruction quantity into multiple independently schedulable display items (quantity, due date, manual order).

## Phase 1 Scope (implemented)

- Display item ID contract: unsplit rows use parent UUID; split items use `split:{splitId}`.
- Prisma models: `ProductionScheduleOrderSplit`, `ProductionScheduleOrderSplitAssignment`, `ProductionScheduleOrderSplitAuditLog`.
- Migrations (3): base tables, parent lookup index, site-slot assignment index.
- Split CRUD: `GET/PUT/DELETE /kiosk/production-schedule/:sourceRowId/splits`.
- Split mutations: `PUT /kiosk/production-schedule/splits/:splitId/order`, `.../due-date`.
- Leaderboard shell/continue/decorations expand parent rows to display items when feature flag is on.
- Legacy `responseProfile=leaderboard` list path: display-item count + split expansion aligned with shell.
- Snapshot generation token includes split tables `MAX(updatedAt)`.
- Web leaderboard modal for create/edit; mutations route split display IDs to split APIs.

## Feature Flag

| Layer | Variable | Default |
|-------|----------|---------|
| API | `KIOSK_PRODUCTION_SCHEDULE_ORDER_SPLIT_ENABLED` | `false` |
| Web | `VITE_KIOSK_PRODUCTION_SCHEDULE_ORDER_SPLIT_ENABLED` | unset (`false`) |

When disabled: split routes return 403; leaderboard reads parent rows only (existing behavior).

API tests read `process.env` at call time in `NODE_ENV=test` so integration tests can enable the flag without global CI env.

## Review & Hardening (2026-06-19 — 2026-06-20)

Codex / implementation review fixes (no blockers at final review):

| Area | Fix |
|------|-----|
| Shell prefix gap | `leaderboardShellListWhere` (same filters as list) for gap candidate + hydrate |
| Concurrency | Parent-row advisory lock on split order/due-date updates; slot locks scoped to site fallback |
| Slot conflict | Separate indexed lookups (`location` then `siteKey`) instead of single OR; site index `PSOrderSplitAssign_idx_site_resource_order` |
| Display load | Split rows scale `machineRequiredMinutes` / `laborRequiredMinutes` / `FSIGENSHOYORYO` by quantity ratio |
| Audit | Split audit log written inside the same DB transaction as business updates |
| List filters | `resourceAssignedOnlyCds` includes `ProductionScheduleOrderSplitAssignment` via parent row UNION |
| Web mutations | `splitOrderMutation` errors surfaced through `orderError` / `resetOrderError` |
| Tests | Route/service integration tests use `vi.hoisted` + runtime flag; query unit test mocks `productionScheduleOrderSplit.findMany` |

## Codex Final Polish (2026-06-20)

- Split order update: `resourceCd` compare and persist with trim normalization.
- Split due-date API response: `dueDate` as `YYYY-MM-DD | null` (client contract), not raw `Date`.
- Regression tests added in service + HTTP route integration suites.

## Codex Post-Review Hardening (2026-06-20)

| Area | Fix |
|------|-----|
| Date validation | `parseOptionalDateField`: strict `YYYY-MM-DD` calendar check; rejects invalid dates (e.g. `2026-02-31`) on replace + due-date |
| Audit concurrency | `beforeJson` for replace/delete/order/due-date read **inside** transaction **after** parent-row advisory lock (avoids stale audit on concurrent wait) |

Tests: `production-schedule-order-split.integration.test.ts` — invalid due-date cases for replace and `upsertProductionScheduleSplitDueDate`.

## Codex Date Format Strictness (2026-06-20)

| Area | Fix |
|------|-----|
| Date input contract | `parseOptionalDateField`: **full-string** `^YYYY-MM-DD$` match only; no prefix slice (rejects `2026-09-01T00:00:00Z` and similar timestamp strings) |

Tests: `production-schedule-order-split.integration.test.ts` — timestamp-style input → 400 on replace + due-date update.

**Review (pass 3)**: no blockers. Re-checked flag OFF behavior, locks, audit-in-transaction, display item ID propagation, migrations/indexes, Web split routing.

## Codex Mac Proxy DELETE Scope (2026-06-20)

| Area | Fix |
|------|-----|
| DELETE route | `DELETE /splits` resolves `targetDeviceScopeKey` like PUT; Mac proxy requires target (400 `TARGET_DEVICE_SCOPE_KEY_REQUIRED`) |
| Audit | Delete audit `targetLocation` / `siteKey` aligned to resolved target scope |
| Web | `deleteKioskProductionScheduleOrderSplits` + `LeaderOrderSplitModal` send `targetDeviceScopeKey` on split clear |

Tests: `kiosk-production-schedule-order-split.integration.test.ts` — Mac proxy delete target required + audit target on success.

**Review (pass 2)**: no blockers. DB constraints, parent-row lock, slot advisory lock, display item ID contract, leaderboard count/continue/snapshot, flag OFF behavior — all acceptable. Phase-outside risks unchanged (CSV relink, split completion/self-inspection/load-balancing).

## Codex Web UI Safety (2026-06-20)

| Area | Fix |
|------|-----|
| Split draft cap | `LeaderOrderSplitModal`: `MAX_SPLIT_DRAFTS = 50` (API schema max); add button disabled at limit |
| Destructive guard | Split clear (`DELETE /splits`) requires `window.confirm` before invoke |

**Review (pass 4)**: no blockers. Re-checked major boundaries (flag OFF, DB constraints, locks, display item ID, Mac proxy target, leaderboard count/continue/snapshot). Phase-outside risks unchanged.

## Codex Route Boundary Test Polish (2026-06-20)

| Area | Fix |
|------|-----|
| HTTP date validation | Route integration covers invalid calendar dates and timestamp-style strings for split replace + split due-date update |

Tests: `kiosk-production-schedule-order-split.integration.test.ts` — `2026-02-31` and `2026-09-01T00:00:00Z` → 400 on replace + due-date update.

**Review (pass 5)**: no blockers. Remaining gap was HTTP route boundary for invalid dates (service layer already strict); fixed with route integration tests only. Re-checked DB constraints, parent-row lock, slot lock, display item ID, flag OFF, Mac proxy target, leaderboard count/continue/snapshot, and index usage via temporary DB `EXPLAIN`. Phase-outside risks unchanged.

## Codex Stale Order Release Atomicity (2026-06-20)

| Area | Fix |
|------|-----|
| Reconciliation release | `releaseOrderAssignmentAtLocation` / `releaseSplitOrderAssignmentAtLocation`: when called with root `PrismaClient` (has `$transaction`), wrap delete + parent/split slot shift in one transaction |
| Nested tx safety | When already inside a transaction client (no `$transaction`), behavior unchanged — no nested transaction |

Split 導入後、`shiftHigherOrderSlotsAfterRelease` は親 assignment と split assignment の `updateMany` を別 SQL で実行する。reconciliation が `prisma` 直呼びの場合、release 全体を transaction 化しないと中間状態が露出するリスクがあった。

Tests: `order-assignment-reconciliation.integration.test.ts` — parent stale release で split assignment が同一順位空間（location + resourceCd）で繰り上がる。

**Review (pass 6)**: no blockers. One fix: stale manual-order release atomicity across parent + split assignment shifts. Re-ran focused API/Web tests, migrations, and index `EXPLAIN`. Phase-outside risks unchanged.

## Codex Integration Test Isolation (2026-06-20)

| Area | Fix |
|------|-----|
| DB test cleanup | split service / route integration cleanup now deletes only rows with its own fixture `dataHash` prefix, avoiding cross-suite deletion of reconciliation split fixtures when DB-backed suites run in parallel |

Reproduced the cleanup race by running split route/service and reconciliation integration tests concurrently against the same temporary DB; after scoping cleanup, the same parallel run passed.

**Review (pass 7)**: no production blockers. Existing legacy leaderboard list contract keeps manual/display rows allowed to exceed `pageSize`; no behavior change was made there.

## Codex Split Modal Duplicate Order Guard (2026-06-20)

| Area | Fix |
|------|-----|
| Web validation | `LeaderOrderSplitModal`: save-before validation now rejects duplicate manual order numbers in the split draft, matching API conflict semantics before the request is sent |
| Tests | Added focused `validateSplitDrafts` unit coverage for duplicate manual order numbers and valid quantity totals |

**Review (pass 8)**: no production blockers. Temporary pgvector DB verification covered migrations, focused DB integration tests, and `EXPLAIN` for split lookup / assignment slot indexes. Temporary container and volume removed after validation.

## Codex Split Replace Stability & Safety (2026-06-20)

| Area | Fix |
|------|-----|
| Split replace | Optional item `id` for stable update; parent lock 後に資源CD・指示数を再読込して再検証 |
| Slot integrity | Flag OFF でも親/split 横断の unified slot 競合検知を常時有効化 |
| Parent manual order | Flag OFF でも分割済み親行への親 assignment 更新を拒否 |
| Web modal | 行切替時 draft 即時リセット、古い GET 応答破棄、loading 中 save/clear 禁止、PUT payload に split `id` |
| Due-date filter | `hasDueDateOnly` が split 固有納期を display item 単位で扱うよう query / count / expansion を補正 |

Tests: split service/route integration, command unit, Web split modal unit/component.

**Review (pass 9)**: no production blockers. Winner-change logical-key relink remains out of scope; this pass focused on replace revalidation, modal race prevention, and due-date filter alignment. Temporary pgvector DB: migrate deploy/status + `EXPLAIN (ANALYZE, BUFFERS)` for split parent lookup / site slot indexes.

## Codex Flag-OFF Split Consistency (2026-06-20)

| Area | Fix |
|------|-----|
| Stale release | Flag OFF でも split assignment を stale 検出・順位詰め対象に含める |
| Release locking | release 時に同一 site/resource の手動順位 slot 1–10 を lock してから delete/shift |
| Parent manual order | Flag ON: 分割済み親順位は拒否（従来どおり）。Flag OFF: 同一親・同一 scope の split 順位を畳んで親順位保存を許可 |
| Order usage | Flag OFF でも split assignment を usage 集計に含め、空き番号表示と 409 のずれを抑制 |
| Supplement sync | 外部数量同期で親 row advisory lock を取得し、`plannedQuantity` 変更時に既存 split 数量を比例再配分 |

Tests: order-supplement sync unit/integration, command unit (flag OFF parent restore), reconciliation integration (flag OFF shift + concurrent release/write).

**Review (pass 10)**: no P1 production blockers. Agent follow-up fixed the release repository unit-test mock to include `$executeRaw`, matching the new slot-lock protocol. P2 winner row ID relink and global vs site-scoped split contract remain explicitly out of scope (data-model/API contract change). Temporary pgvector DB: migrate deploy/status + EXPLAIN for split indexes.

## Pi5 Flag-OFF Smoke Hardening (2026-06-20)

| Area | Fix |
|------|-----|
| Supplement split locks | Split parent locks are acquired only for parents that actually have splits; split parent lookup is batched per update chunk instead of per row |
| Winner row change guard | If an existing supplement would move to another winner row but the old parent has splits, keep the supplement on the old parent and reconcile that parent instead of orphaning split state |
| Supplement transaction size | `create` / `update` / `prune` writes run in short chunk transactions, avoiding Pi5 interactive transaction timeout on large supplement datasets |

Pi5 flag-OFF smoke evidence:

- Branch commit deployed to `raspberrypi5`: `75ea7b86`.
- `KIOSK_PRODUCTION_SCHEDULE_ORDER_SPLIT_ENABLED=false`.
- `prisma migrate status`: **Database schema is up to date** (`111` migrations).
- API health: `status=ok`.
- Backup before latest supplement smoke: `/opt/backups/db_backup_split_order_smoke_20260620_215414.sql.gz` (`264M`).
- Order supplement sync smoke completed on real Pi5 data:
  - earlier pass: `scanned=67964`, `normalized=67964`, `matched=24435`, `unmatched=43529`, `upserted=24435`, `pruned=0`.
  - recheck after Codex handoff: `scanned=67963`, `normalized=67963`, `matched=24434`, `unmatched=43529`, `upserted=24434`, `pruned=0`.
- Parent/split duplicate slot SQL: `0` rows.
- Split quantity mismatch SQL: `0` rows.
- Post-smoke API health recovered to `status=ok` after a short memory-pressure interval (`degraded` at 95.2% immediately after sync).
- Docker state: only standard Pi5 compose services (`docker-web-1`, `docker-api-1`, `docker-db-1`); no temporary container / volume / network created for this Pi5 recheck.
- CI: implementation runs `27869672609`, `27870341509`, `27871004452` passed; docs-only run `27871646967` also passed.
- Not executed in this recheck: flag ON -> split creation -> supplement sync -> SQL 0 -> flag OFF scenario. In production, the flag is startup-configured and split creation would write to real rows; run only with an explicit limited site/row target.

Observed and fixed during Pi5 smoke:

- First attempt with parent-row locks for every changed supplement hit PostgreSQL `out of shared memory`; fixed by locking only split-bearing parents.
- Second attempt with per-row split existence checks avoided the lock error but hit Prisma interactive transaction timeout (`P2028`) on real data; fixed by batching split parent lookup and chunking transactions.
- 2026-06-21 pre-pilot evidence pass found supplement sync `P2035` (`too many bind variables`, 36,798 bind values) in the winner lookup query; fixed by passing supplement lookup keys as one JSON payload and expanding with `jsonb_to_recordset`.
- P2035 fix commit: `38e33014`; CI `27887448895` passed; Pi5 redeploy `20260621-085713-13579` completed with Ansible `failed=0`.
- Re-deployed Pi5 app SHA: `38e33014` (supersedes earlier deployed app SHA `75ea7b86` for the pilot candidate).
- Re-deploy backup: `/opt/backups/db_backup_split_order_p2035_fix_smoke_20260621_090823.sql.gz`, gzip test passed, SHA-256 `e0a373d69dc7ac8fe537e0604819a058805d850f9b57a5ce5fd5a9105768aa5d`, size `281297840` bytes (`269M`).
- Re-deploy flag values: API `KIOSK_PRODUCTION_SCHEDULE_ORDER_SPLIT_ENABLED=false`; served Web bundle contains `splitFeatureEnabled:y=!1`.
- Re-deploy supplement sync smoke completed on real Pi5 data: `scanned=81600`, `normalized=81600`, `matched=24434`, `unmatched=57166`, `upserted=24434`, `pruned=0`.
- Memory/health during re-deploy sync smoke: before `health=ok`; immediate `degraded` at 95.2%; 30s `ok`; 60s `ok`; 180s `ok`; API/DB/Web restart count `0`, OOMKilled `false`, no `P2028` / `P2035` / `out of shared memory` log matches.
- Re-deploy SQL checks: scope-aware parent/split duplicate assignment SQL `0`; split quantity anomaly SQL `0`; final health `ok`.

## Out of Scope (explicit)

- Completion toggle per split item (parent row completion contract unchanged).
- Self-inspection per split quantity.
- Load-balancing quantity aggregation changes.
- CSV re-import logical-key relink for splits (splits remain on old parent row).

## Validation (latest)

Verified locally + CI + Pi5 (Agent, 2026-06-21 — P2035 follow-up):

- `pnpm --filter api build`: passed.
- `pnpm --filter api exec tsc -p tsconfig.build.json --noEmit`: passed after P2035 fix.
- `pnpm --filter web build`: passed.
- `pnpm --filter web test`: **232 files / 1080 tests** passed (jsdom emitted localhost connection logs, but Vitest passed).
- API Vitest — focused unit: order supplement sync + command, **2 files / 20 tests** passed; order supplement sync unit re-run after P2035 fix: **13 tests** passed.
- API Vitest — DB integration: split service, reconciliation, order supplement sync, **3 files / 14 tests** passed; order supplement sync integration re-run after P2035 fix on temporary pgvector DB: **1 test** passed.
- API Vitest — route/query/command focused: **3 files / 38 tests** passed.
- API Vitest full suite: **402 files / 2027 tests** passed, **2 files / 9 tests skipped**.
- Temporary Postgres `pgvector/pgvector:pg16`: `prisma migrate deploy` / `migrate status` (**111** migrations); P2035 fix temp container / volume removed after verify.
- `EXPLAIN`: `PSOrderSplit_idx_dashboard_parent_split_no`, `PSOrderSplitAssign_idx_site_resource_order`, `PSOrderSplitAssign_unique_order_slot`.
- `git diff --check` passed.
- GitHub Actions `27869672609`, `27870341509`, `27871004452`, `27871646967`, `27887448895`: passed.
- Pi5 deploys to `raspberrypi5` only: `cc5d6f82`, `54d026dd`, `75ea7b86`, `38e33014` all completed with Ansible `failed=0`; latest verified ref is `38e33014`.
- Pi5 latest verification: flag OFF, migration up to date, API health ok after recovery, supplement sync smoke passed (`scanned=81600`, `upserted=24434`), scope-aware duplicate SQL `0`, split quantity anomaly SQL `0`, backup `/opt/backups/db_backup_split_order_p2035_fix_smoke_20260621_090823.sql.gz`.

Note: standard `postgres:16-alpine` fails on existing `vector` extension migrations; use pgvector image for local DB verification.

**Not done**: wider Pi4 rollout; permanent/all-terminal flag ON; old-binary rollback validation. Feature flag remains off in `.env.example`.

## Deploy Notes

- Snapshot generation token includes split tables `MAX(updatedAt)` — **apply the 3 split migrations before enabling the app/flag**, or leaderboard cache invalidation may miss split changes.
- Safe rollout: (1) migrate on Pi, (2) deploy API+Web with flag OFF, (3) manual smoke with flag ON, (4) enable flag in production env.
- Rollback after split creation is **new binary + feature flag OFF**. Do not rely on old-binary rollback after the split migrations have been applied and split rows may exist.
- API split flag is Pi5 shared API scope, not per terminal. Web split flag is build-time and served from the shared Pi5 web bundle. Therefore "limited terminal ON" is not a hard isolation boundary unless a separate per-device gate is added.
- Step 1 temporary scope contract: split structure is global to the parent production schedule row across sites; manual order assignment remains site/location scoped. Do not edit split structure from another site during the pilot.

### Pi Deploy Readiness (prepared, not executed)

Target environment for the first real-device pass:

- Host group: `raspberrypi5` only.
- App scope: API + Web + Prisma migrations.
- Feature flag: `KIOSK_PRODUCTION_SCHEDULE_ORDER_SPLIT_ENABLED=false` for deploy and initial smoke.
- Branch/ref: use the reviewed branch/ref only after it is committed and intentionally pushed; do not deploy an uncommitted local tree.

Execution outline to present before running:

1. Take a PostgreSQL backup and record the backup path.
2. Apply Prisma migrations before app rollout:
   - `20260619120000_add_production_schedule_order_split`
   - `20260620103000_add_production_schedule_order_split_parent_lookup_index`
   - `20260620120000_add_production_schedule_order_split_assignment_site_slot_index`
3. Deploy API/Web to Pi5 with split flag OFF.
4. Run API health and standard phase smoke; confirm normal ranking operations still work with flag OFF.
5. Enable the split flag only for the limited Pi5/site smoke.
6. Verify create/update/delete splits, parent/split order writes, completion/reconciliation, supplement sync, and OFF -> ON behavior.
7. Run SQL checks for parent/split slot duplicates and split quantity totals before wider rollout.

Suggested duplicate slot check:

```sql
WITH slots AS (
  SELECT
    'parent' AS kind,
    "csvDashboardRowId" AS item_id,
    "location",
    "siteKey",
    "resourceCd",
    "orderNumber"
  FROM "ProductionScheduleOrderAssignment"
  WHERE "csvDashboardId" = 'production-schedule-mishima-grinding'
  UNION ALL
  SELECT
    'split' AS kind,
    "splitId" AS item_id,
    "location",
    "siteKey",
    "resourceCd",
    "orderNumber"
  FROM "ProductionScheduleOrderSplitAssignment"
  WHERE "csvDashboardId" = 'production-schedule-mishima-grinding'
)
SELECT
  "location",
  "resourceCd",
  "orderNumber",
  COUNT(*) AS duplicated_count,
  json_agg(json_build_object('kind', kind, 'itemId', item_id) ORDER BY kind, item_id) AS items
FROM slots
GROUP BY "location", "resourceCd", "orderNumber"
HAVING COUNT(*) > 1;
```

Suggested split quantity total check:

```sql
SELECT
  s."parentCsvDashboardRowId",
  SUM(s."splitQuantity") AS split_total,
  os."plannedQuantity"
FROM "ProductionScheduleOrderSplit" AS s
LEFT JOIN "ProductionScheduleOrderSupplement" AS os
  ON os."csvDashboardId" = s."csvDashboardId"
  AND os."csvDashboardRowId" = s."parentCsvDashboardRowId"
WHERE s."csvDashboardId" = 'production-schedule-mishima-grinding'
GROUP BY s."parentCsvDashboardRowId", os."plannedQuantity"
HAVING os."plannedQuantity" IS NOT NULL
  AND SUM(s."splitQuantity") <> os."plannedQuantity";
```

Stop conditions:

- Any migration failure, health check failure, or API/Web build mismatch.
- Any parent/split duplicate slot rows from the SQL check.
- Any split total mismatch after supplement sync.
- Any winner-row relink scenario caused by CSV re-import; P2 relink is not implemented.
- Any behavior that depends on deciding whether split structure is global or site-scoped; that contract is still open.

### Step 1 Limited Flag-ON Gate (not executed)

Before enabling the split flag for the first Pi5 pilot, present and confirm:

- Target: `raspberrypi5` only; no Pi4 or all-terminal rollout.
- Candidate app SHA: `38e33014`; docs-only HEAD may be newer.
- Current precondition: Pi5 is already redeployed with flag OFF, health recovered to `ok`, and supplement sync smoke passed on real data.
- Backup: take a fresh PostgreSQL backup immediately before the flag-ON pilot and record path, size, gzip test, and SHA-256.
- Scope: one explicitly named site/resource/order row set. Do not edit split structure from another site while the pilot runs.
- Rollback: disable `KIOSK_PRODUCTION_SCHEDULE_ORDER_SPLIT_ENABLED` and redeploy/restart the same new binary; do not use an old-binary rollback after split rows exist.

Minimum pilot sequence:

1. Record before-state: app SHA, API flag value, Web bundle flag value, health, container restart counts, and backup evidence.
2. Enable flag on Pi5 only.
3. Create a split for the agreed parent row; verify display item IDs, split quantities, and parent row behavior.
4. Update split quantity / due date / manual order; verify parent/split slot duplicate SQL remains `0`.
5. Run supplement sync once; verify no `P2028`, `P2035`, or `out of shared memory` log matches and split total SQL remains `0`.
6. Disable flag again unless the user explicitly approves keeping it on.
7. Record after-state: health at immediate / 30s / 60s / 180s, restart counts, SQL results, and whether any split rows remain.

Stop immediately and keep the flag OFF if any check fails, any SQL returns rows, memory does not recover to `ok`, or the pilot scope is ambiguous.

## Local Notes JA

- 現場要件: 5個中2個先行・3個遅延など、順位ボード上で数量・納期・手動順番を分けたい。
- 初回は `plannedQuantity` が正の整数の行のみ分割可能。null/0/不正は API 400。
- 親行に分割がある場合、snapshot / continue の ID 列は display item 基準。
- Web UI: 分割片追加は API 上限 **50 件**で停止（追加ボタン disabled）。分割解除は確認ダイアログ必須。手動順番の重複は保存前にクライアント側で拒否。行切替時は draft 即時リセット、loading 中は保存/解除不可。
- replace PUT: 既存 split は optional `id` で安定更新。親ロック後に資源CD・指示数を再検証。
- `hasDueDateOnly`: split 固有納期は display item 単位で filter / count。
- flag OFF でも: stale release / order usage / slot 競合は split assignment を含めて整合。親 manual order は同一 scope の split 順位を畳んで保存可能（flag ON では拒否）。
- 外部数量同期: `plannedQuantity` 変更時、親 row lock 下で split 数量を比例再配分。
- Pi5 flag OFF smoke: `38e33014` で P2035 修正後に再deploy、API/Web flag OFF、order supplement sync 実データ完走、順位重複SQL 0、split数量不一致SQL 0。
- 2026-06-20 Codex レビュー pass 10: flag OFF 整合（release lock、usage、supplement sync 比例再配分）。P2 winner relink / global vs site-scoped 契約は out of scope。
- 2026-06-20 Codex レビュー pass 9: replace 安定化、modal race 防止、due-date filter 補正。winner relink は引き続き out of scope。
- 2026-06-20 Codex レビュー pass 7: split service / route integration の cleanup を fixture 行に限定し、DB 付きテスト並列実行時の相互削除を防止。
- 2026-06-20 Codex レビュー pass 8: Web 分割モーダルで手動順番の重複を保存前に検出。focused test / migration / EXPLAIN / DB integration 済み。
- 2026-06-20 Codex レビュー pass 6: stale manual order 解放を transaction 化（親 + split assignment の順位詰めを atomic に）。reconciliation 回帰テスト追加。
- 2026-06-20 Codex レビュー pass 5: route integration でも不正日付（存在しない日付・timestamp 文字列）を 400 として固定。
- 2026-06-20 Codex レビュー pass 4: ブロッカーなし。主要境界（flag OFF、ロック、display item ID、Mac proxy、leaderboard）再確認済み。
- 2026-06-20 Codex レビュー pass 3: 日付は `YYYY-MM-DD` **完全一致**のみ（`2026-09-01T00:00:00Z` 等は 400）。
- Mac proxy: `DELETE /splits` も `targetDeviceScopeKey` 必須。Web 分割解除も同パラメータ送信。監査 target は解決済み scope に揃える。
- 日付硬化: `2026-02-31` 等の存在しない日付は 400。監査 `beforeJson` は親行ロック取得後の transaction 内で読む。
- 本番反映: **migration 先行**（snapshot token が split テーブルを参照）→ デプロイ（flag OFF）→ Pi 上で flag ON 手動確認 → 本番 flag 有効化。
