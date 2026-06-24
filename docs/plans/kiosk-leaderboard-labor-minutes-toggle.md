# Plan: Kiosk Leaderboard Labor Minutes Toggle (`+人`)

## Metadata

| Field | Value |
|-------|-------|
| id | `plan-kiosk-leaderboard-labor-minutes-toggle` |
| status | **production_deployed / field_verified** — Pi5 + Pi4×4 · visibility fix **`10cc06b0`** (2026-06-18) · display recovery verified on real device (2026-06-24) · 8H/10H toggle implemented locally |
| scope | Kiosk leader order board (`ProductionScheduleLeaderOrderBoardPage`) |
| date | 2026-06-17 (feature) · 2026-06-18 (visibility fix deploy) · 2026-06-24 (display recovery) |
| source_of_truth | this document |
| branch | `fix/leaderboard-labor-visibility-from-machine-status` → merge to `main` |
| commit | **`10cc06b0`** — `fix: derive leaderboard labor minutes from visible machine rows` |
| latest_recovery | 2026-06-24 working tree — keep appended display rows while overlaying fresh labor metadata by row id |
| latest_capacity_toggle | 2026-06-24 working tree — per-slot 8H/10H button immediately left of `+人`, persisted locally |
| related_code | `apps/api/src/services/production-schedule/leaderboard/leaderboard-labor-minutes*.ts`, `apps/web/src/features/kiosk/leaderOrderBoard/*` |
| related_docs | [kiosk-leaderboard-gantt-mode.md](./kiosk-leaderboard-gantt-mode.md), [deployment.md](../guides/deployment.md), [verification-checklist.md](../guides/verification-checklist.md) |

Rank calculation, auto-rank, and load-balancing are **out of scope**. Signage JPEG (`kiosk_leader_order_cards`) is **unchanged**.

## Goal

Each resource slot has a **`+人`** toggle (default OFF). When ON, display minutes = `machineRequiredMinutes + laborRequiredMinutes`. Gantt bar height and row minute label follow `requiredMinutes`.

2026-06-24 addition: each resource slot has an **8H/10H** toggle immediately left of `+人`. It is persisted per terminal and slot, and passes **480** or **600** minutes to the Gantt `capacityMinutes`.

## Contract

| Field | Meaning |
|-------|---------|
| `machineRequiredMinutes` | Machine row `FSIGENSHOYORYO` (minutes); API-attached, stable per row |
| `laborRequiredMinutes` | Sum of `FSIGENCD=10` rows for same `ProductNo + FKOJUN`, keyed only from **visible machine rows** already on the board (10 rows do **not** require their own `fkmail`) |
| `requiredMinutes` | Web display value after slot `+人` toggle |

Rules:

- `FSIGENCD=10` rows are **not shown** as resource slots (sanitized on restore, fallback, server sync, picker).
- Labor lookup follows **display-row visibility**: keys come from visible machine rows; `FSIGENCD=10` rows are summed without shell `fkmail` on the 10 row itself.
- Toggle state: per slot index, per terminal (`localStorage` via `usePersistedLeaderBoardLaborMode`); survives resource CD reassignment on the slot.
- IndexedDB cache schema **v3**; records without labor metadata are rejected. Fingerprint includes labor fields.

## Implementation Summary

### API

- `attachLeaderboardLaborMinutes()` decorates shell/continue board payloads (max 1 DB lookup per call).
- `buildLeaderboardLaborMinutesLookupWhereSql()` applies winner materialization and process-change residual filter only; labor keys are collected from visible machine rows, not from `fkmail` on `FSIGENCD=10` rows.
- Positive-only SUM for `FSIGENSHOYORYO` (negative → 0).
- Rows already carrying metadata skip re-lookup.

### Web

- `normalizeLeaderBoardRow` / `applyLeaderBoardDisplayRequiredMinutesToGrouped` / `usePersistedLeaderBoardLaborMode`.
- `LeaderOrderResourceCard`: header `+人` button; `LeaderOrderResourceRow`: minute label.
- `LeaderOrderResourceCard`: header `8H/10H` button immediately left of `+人`; `usePersistedLeaderBoardCapacityMode` stores slot capacity locally.
- `sanitizeLeaderBoardSlotResourceCd` + server-sync filter exclude `10` from slots.
- `useLeaderBoardResourceSlots`: stable fallback seed to avoid re-hydrate loops.

## Validation Example

ProductNo `0003767716`, resource `021`: OFF **400** min, ON **575** min (from requirements).

## Local Validation (pre-production)

| Check | Result |
|-------|--------|
| Web lint / tsc / full tests (1074) | PASS |
| API lint / tsc / full tests on temp Postgres (1960) | PASS |
| Focused labor tests (API 9, Web 55+) | PASS |
| Temp Postgres: 108 migrations, lookup SQL `175` min visible / `25` hidden, negative → 0 | PASS |
| CI run `27686147211` | success (all jobs) |

## Production Deploy

Standard: [deployment.md](../guides/deployment.md) · `./scripts/update-all-clients.sh` · `./scripts/deploy/verify-phase12-real.sh`.

### Initial feature (`496c4e58`, 2026-06-17)

| Host | Detach Run ID | PLAY RECAP | Notes |
|------|---------------|------------|-------|
| `raspberrypi5` | `20260617-205420-14041` | `ok=134` `changed=4` `failed=0` | api/web rebuild; health wait retried then OK (memory ~91%) |
| `raspi4-kensaku-stonebase01` | `20260617-210832-11505` | `ok=129` `changed=10` `failed=0` | |
| `raspberrypi4` | `20260617-211425-7391` | `ok=122` `changed=10` `failed=0` | |
| `raspi4-robodrill01` | `20260617-212014-28758` | `ok=122` `changed=9` `failed=0` | |
| `raspi4-fjv60-80` | `20260617-212451-8826` | `ok=122` `changed=9` `failed=0` | |

Post-deploy (initial): sample 160 rows for `021` had **0 rows with `laborRequiredMinutes > 0`** — root cause was lookup requiring `fkmail` on `FSIGENCD=10` rows (real data has none).

### Visibility fix (`10cc06b0`, 2026-06-18)

**Change**: API-only. Labor lookup keys from visible machine rows; no `fkmail` on `FSIGENCD=10` rows. Prisma/migration/Web unchanged.

| Host | Detach Run ID | PLAY RECAP | Notes |
|------|---------------|------------|-------|
| `raspberrypi5` | `20260618-093522-6496` | `ok=134` `changed=4` `failed=0` | api rebuild |
| `raspi4-kensaku-stonebase01` | `20260618-094426-12265` | `ok=129` `changed=11` `failed=0` | `kiosk-browser` restart |
| `raspberrypi4` | `20260618-094841-29506` | `ok=122` `changed=10` `failed=0` | |
| `raspi4-robodrill01` | `20260618-095302-31509` | `ok=122` `changed=9` `failed=0` | |
| `raspi4-fjv60-80` | `20260618-095624-9230` | `ok=122` `changed=9` `failed=0` | |

Phase12 after Pi5 and after all Pi4: **PASS 43 / WARN 0 / FAIL 0**. CI run **`27727806513`** success (pre-deploy).

**Post-deploy API check (Pi5, `boardResourceCds=021`)**:

- `ProductNo=0003767716`: `machineRequiredMinutes=400`, `laborRequiredMinutes=175` → `+人` ON expects **575** min.
- First 160 rows: **153** with `laborRequiredMinutes > 0`.

Pi4: SPA from Pi5; `kiosk-browser` restarted per host. Force reload per [verification-checklist §6.6.4](../guides/verification-checklist.md) if UI stale.

### Display recovery after performance fixes (2026-06-24)

**Symptom**: after the leaderboard speed/display-stability fixes, pressing `+人` could keep showing the previous append-complete board that had been fetched with `includeLabor=false`. The row count stayed stable, but `laborRequiredMinutes=0` also stayed visible, so the minute label and Gantt 8H bar did not stretch.

**Root cause**: the Web display freshness key intentionally ignores `includeLabor` to prevent a `+人` refresh from collapsing a long appended board back to a short shell. That part is required for perceived speed/stability. The missing piece was metadata refresh: when the previous longer board won display selection, its old labor metadata also won.

**Fix**: keep the longer appended display board, but merge fresh finite `machineRequiredMinutes` / `laborRequiredMinutes` from the current network board by `row.id` into the displayed rows. This preserves the speed fix and restores the `+人` display behavior.

**Validation**:

- Web focused tests: `useCompositeLeaderboardPhasedScheduleWithAutoAppend`, append override scope, shell freshness, required-minutes display — PASS.
- Web lint/build — PASS.
- Real-device verification (2026-06-24, user visual check): `+人` ON reflects labor minutes and the 8H bar stretches again.

### 8H/10H capacity toggle next to `+人` (2026-06-24)

**Change**: Web-only. Add a per-slot button immediately left of `+人`; pressing it toggles `8H` ↔ `10H`.

**State**: terminal-local `localStorage`, same site + device scope style as `+人`, slotIndex order. Default is `8H` for all slots.

**Effect**: `8H` passes `480` minutes and `10H` passes `600` minutes as `capacityMinutes` into the existing Gantt layout. `+人` still controls `requiredMinutes`; 8H/10H controls the ruler/capacity scale.

**Validation**:

- Focused Web tests for persisted capacity mode, card button placement, and Grid → Gantt capacity propagation — PASS.
- Web lint/build — PASS.

## Operational Notes (not KB)

- Pi5 api/web rebuild may hit transient health-wait retries after memory spike; see [deployment.md §deploy-api-build-cache-health-wait](../guides/deployment.md#deploy-api-build-cache-health-wait-2026-06-17).
- Pi4 deploy does **not** rebuild api/web; only client-side refresh matters for this feature.

## Open Items

- [x] **Field sign-off (real device, 2026-06-24)**: `+人` toggle changes minute label and Gantt height after the display recovery. API verified on Pi5; UI behavior verified by user visual check.
- [ ] **Performance monitor**: Labor lookup `EXPLAIN ANALYZE` on production-scale data; add index only if latency regresses.

## Next Actions (for resuming AI)

1. When the 2026-06-24 recovery and 8H/10H toggle are committed/deployed, replace `latest_recovery` / `latest_capacity_toggle` with the final commit hash.
2. If UI stale on Pi4: force reload per verification-checklist §6.6.4 (Pi4 does not `git pull` SPA).
3. Keep monitoring first usable speed; do not remove the labor metadata overlay to solve display staleness.

## Local Notes JA

- 要件正本: `leaderboard_labor_minutes_requirements.md`（リポジトリ外）
- **2026-06-18 修正**: 実データで `FSIGENCD=10` 行に `fkmail` が無いため lookup が全落ちしていた。表示済み通常行キーに従属する合算へ変更（`10cc06b0`）。
- **2026-06-24 修正**: 速度改善で append 済み行維持は効いていたが、旧 `includeLabor=false` 行の `laborRequiredMinutes=0` も維持されていた。表示行数は維持し、fresh network board の人工数メタデータだけを `row.id` で重ねる方式に変更。実機目視 OK。
- **2026-06-24 追加**: `+人` の左に 8H/10H ボタンを追加。slotIndex 順に端末ローカル保存し、Gantt `capacityMinutes` へ 480/600 分を渡す。
- Codex レビュー反映: TS re-export fix, lookup 可視性合わせ→**表示行由来キーへ修正**, FSIGENCD=10 除外, cache v3/fingerprint, service tests, import/order, fallback 安定化
