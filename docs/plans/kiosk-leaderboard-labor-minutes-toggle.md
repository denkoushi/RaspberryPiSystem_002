# Plan: Kiosk Leaderboard Labor Minutes Toggle (`+人`)

## Metadata

| Field | Value |
|-------|-------|
| id | `plan-kiosk-leaderboard-labor-minutes-toggle` |
| status | **production_deployed_all_kiosks / recovered + layout_stabilized** — PR **#464** · latest code **`5171e44e`** · Pi5 operator OK · all hosts deploy **`20260624-175322-20365`** · Phase12 **43/0/0** |
| scope | Kiosk leader order board (`ProductionScheduleLeaderOrderBoardPage`) |
| date | 2026-06-17 (feature) · 2026-06-18 (visibility fix deploy) · 2026-06-24 (display recovery) |
| source_of_truth | this document |
| branch | `feat/production-schedule-split-orders` → PR **#464** |
| commit | **`5171e44e`** — `fix: stabilize leaderboard sync status layout` |
| latest_recovery | **`cca420ac`** — retain `includeLabor=true` labor metadata by row id for the same display scope and overlay it onto appended rows |
| latest_capacity_toggle | **`4e3d3926`** — per-slot 8H/10H button immediately left of `+人`, persisted locally |
| latest_gantt_ruler | **`a882ac81`** — restore cumulative 8H/10H capacity-boundary mapping; reject the `f978c15e` total-work ruler-height contract |
| related_code | `apps/api/src/services/production-schedule/leaderboard/leaderboard-labor-minutes*.ts`, `apps/web/src/features/kiosk/leaderOrderBoard/*` |
| related_docs | [kiosk-leaderboard-gantt-mode.md](./kiosk-leaderboard-gantt-mode.md), [deployment.md](../guides/deployment.md), [verification-checklist.md](../guides/verification-checklist.md) |

Rank calculation, auto-rank, and load-balancing are **out of scope**. Signage JPEG (`kiosk_leader_order_cards`) is **unchanged**.

## Goal

Each resource slot has a **`+人`** toggle (default OFF). OFF means display minutes = `machineRequiredMinutes`; ON means display minutes = `machineRequiredMinutes + laborRequiredMinutes`. The row minute label and the Gantt **8H/10H vertical ruler** both follow the same `requiredMinutes`; the ruler maps cumulative row work to the slot body so operators can see which item range fits within one 8H/10H capacity window. Row/card heights stay on the compressed performance scale.

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
- `useCompositeLeaderboardPhasedScheduleWithAutoAppend` retains labor metadata returned by `includeLabor=true` shell/continue/deltaRows for the same display scope and overlays it onto the current display board. `includeLabor=false` machine-only rows must not overwrite retained labor metadata with `0`.
- `LeaderOrderResourceCard`: header `+人` button; `LeaderOrderResourceRow`: minute label.
- `LeaderOrderResourceCard`: header `8H/10H` button immediately left of `+人`; `usePersistedLeaderBoardCapacityMode` stores slot capacity locally.
- `ProductionScheduleLeaderOrderBoardPage`: transient sync labels (`一覧を更新中です。`, `詳細情報を更新中です。`) are rendered as a top-right overlay, not normal-flow content, so the resource slot grid does not shift vertically.
- `LeaderBoardLeftToolStack`: split feature status (`分割 Web OFF` etc.) is shown inside the left operation pane under the target device selector, not in the main grid header.
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

**Symptom**: after the leaderboard speed/display-stability fixes, pressing `+人` could keep showing the previous append-complete board that had been fetched with `includeLabor=false`. The row count stayed stable, but `laborRequiredMinutes=0` also stayed visible, so the minute label and Gantt 8H/10H capacity boundary did not move to the labor-inclusive position.

**Root cause**: the Web display freshness key intentionally ignores `includeLabor` to prevent a `+人` refresh from collapsing a long appended board back to a short shell. That part is required for perceived speed/stability. The missing piece was metadata refresh: when the previous longer board won display selection, its old labor metadata also won.

**Partial fix (`4e3d3926`)**: keep the longer appended display board, but merge fresh finite `machineRequiredMinutes` / `laborRequiredMinutes` from the current network board by `row.id` into the displayed rows. This preserved the speed fix, but it only used the current network board and did not retain labor metadata across the same display scope. Rows outside the current shell/partial continue could still stay machine-only until the labor-inclusive append caught up.

**Required fix**: retain `includeLabor=true` metadata by `row.id` for the same search/device/resource display scope, overlay it onto the selected display board, and never let `includeLabor=false` machine-only rows overwrite retained labor metadata with `0`. `+人 OFF` still displays machine minutes only; retained labor metadata is used when `+人` is ON and for the Gantt cumulative capacity calculation.

**Validation**:

- Web focused tests: `useCompositeLeaderboardPhasedScheduleWithAutoAppend`, append override scope, shell freshness, required-minutes display — PASS.
- Web lint/build — PASS.
- Real-device follow-up (2026-06-24): `4e3d3926` could still make `+人` appear non-functional while labor metadata had not reached the displayed appended rows. The follow-up fix must validate label and Gantt movement, not only row-count stability.

### 8H/10H capacity toggle next to `+人` (2026-06-24)

**Change**: Web-only. Add a per-slot button immediately left of `+人`; pressing it toggles `8H` ↔ `10H`.

**State**: terminal-local `localStorage`, same site + device scope style as `+人`, slotIndex order. Default is `8H` for all slots.

**Effect**: `8H` passes `480` minutes and `10H` passes `600` minutes as `capacityMinutes` into the existing Gantt layout. `+人` still controls `requiredMinutes`; 8H/10H controls the ruler/capacity scale.

**Validation**:

- Focused Web tests for persisted capacity mode, card button placement, and Grid → Gantt capacity propagation — PASS.
- Web lint/build — PASS.

### Gantt ruler regression after 8H/10H toggle (2026-06-24)

**Symptom**: after 8H/10H capacity toggle landed, pressing `+人` updated the slot's logical total, but large slots could keep the same visible 8H/10H vertical bar height. The row list stayed stable, which was good for performance, but the operator could not see the labor-added stretch.

**Root cause**: `computeGanttSlotLayout` used the same compressed scale for row heights and ruler height. When `totalRequiredMinutes` exceeded capacity, `pxPerMinute` decreased so the larger total still fit the existing scroll/card height. With many rows pinned to the 96px minimum, `containerMinHeightPx` could stay unchanged.

**Incorrect fix (`f978c15e`)**: split the layout contract by computing `rulerHeightPx` from `totalRequiredMinutes / capacityMinutes * availableWorkHeightPx` and using that value in the card scroll height. This made the ruler a long total-work bar instead of showing the cumulative 8H/10H boundary within the card body.

**Required fix**: keep row/card heights compressed, but restore the original Gantt contract: `pxPerMinute = availableWorkHeightPx / max(totalRequiredMinutes, capacityMinutes)` only defines the time-to-Y scale; the ruler height remains tied to the row-list/container height, and 8H/10H boundaries are mapped through cumulative row work. `+人` changes the row `requiredMinutes`, so the cumulative capacity boundary and remainder bands move without expanding the whole scroll area from total minutes.

**Validation**:

- Focused Web tests that treated `400 → 575` as `480px → 575px` ruler-height stretch are no longer accepted as the intended behavior; they must be replaced by tests that assert cumulative 8H/10H boundary movement.
- Web build / CI / deploy / Phase12 all passed for `f978c15e`, but those checks did not validate the intended cumulative-boundary ruler contract.
- Production page check on FJV60/80 `021` showed huge ruler heights (`6220px` / `8307px` / `5116px`), which is now recorded as evidence of the rejected total-work-height behavior, not as a success condition.

### Final recovery and layout stabilization (2026-06-24, PR #464)

**Accepted operator contract**:

- `+人` OFF: row label and Gantt cumulative work use `machineRequiredMinutes`.
- `+人` ON: row label and Gantt cumulative work use `machineRequiredMinutes + laborRequiredMinutes`.
- 8H/10H sets only the capacity window: **480** or **600** minutes per band.
- The Gantt vertical bar is not a total-work-height bar. It maps the cumulative row work to the card body and shows alternating visible/transparent capacity bands. Even bands are visible; odd bands are transparent.
- Row/card heights stay compressed for performance. Do not make scroll height proportional to total minutes.
- `+人 ON` may take time while `includeLabor=true` shell/continue metadata arrives; existing appended rows remain visible and are updated as metadata is retained and overlaid.
- Sync status text remains visible but must not move the grid. It is an overlay. Split feature status belongs in the left pane.

**Fix sequence**:

| Commit | Role |
|--------|------|
| `a882ac81` | Restored cumulative 8H/10H capacity boundaries and removed total-work scroll/ruler growth. |
| `cca420ac` | Retained labor metadata by `row.id` across the same display scope, so appended rows update when `+人` is ON. |
| `5171e44e` | Moved transient sync status to an overlay and moved split status into the left pane to avoid resource-grid layout shift. |

**Validation and deploy**:

| Check | Result |
|-------|--------|
| Focused Web tests | `leaderBoardGantt`, `useCompositeLeaderboardPhasedScheduleWithAutoAppend`, `applyLeaderBoardDisplayRequiredMinutes` — PASS |
| Web lint / build | PASS |
| PR #464 CI at `5171e44e` | Secret scan `28083921237`, CodeQL `28083921239`, push CI `28083918759`, PR CI `28083921253` — PASS. The initial PR `security-docker` failure was GitHub runner `/tmp` exhaustion during Trivy image scan; rerun passed. |
| Pi5 deploy | `20260624-174357-19660` — `failed=0` / `unreachable=0`, commit `5171e44e`, operator real-device check OK. |
| All-host deploy | `20260624-175322-20365` — Pi5 + Pi4×4 + Pi3, `failed=0` / `unreachable=0`, summary success true. |
| Phase12 after all-host deploy | PASS **43**, WARN **0**, FAIL **0**. |

**Operational observation**: `raspi4-kensaku-stonebase01` rebuilt `barcode-agent` during the all-host deploy and spent several minutes in `docker compose --profile barcode up -d --build barcode-agent`. Existing `barcode-agent` / `nfc-agent` containers stayed running, the rebuild eventually completed, and readiness passed. Treat this as a slow-but-successful deploy path unless the final ready check fails.

## Operational Notes (not KB)

- Pi5 api/web rebuild may hit transient health-wait retries after memory spike; see [deployment.md §deploy-api-build-cache-health-wait](../archive/deployments/2026-06.md#deploy-api-build-cache-health-wait-2026-06-17).
- Pi4 deploy does **not** rebuild api/web; only client-side refresh matters for this feature.

## Open Items

- [ ] **Performance monitor**: Labor lookup `EXPLAIN ANALYZE` on production-scale data; add an index only if latency regresses.
- [ ] **Optional all-kiosk visual sign-off**: Pi5 operator check is OK and all-host automated checks passed. 2026-06-24 follow-up automated check also passed `verify-phase12-real.sh` with **43 PASS / 0 WARN / 0 FAIL**, including Pi4×4 `kiosk/status-agent`; however no Codex-accessible VNC/screenshot evidence was available, so actual visual sign-off remains pending. Confirm on each Pi4 that `+人`, 8H/10H bands, card minute labels, sync overlay, and left-pane split status match the accepted contract.

## Next Actions (for resuming AI)

1. If UI stale on Pi4: force reload per verification-checklist §6.6.4 (Pi4 does not `git pull` SPA).
2. Keep monitoring first usable speed; do not remove the labor metadata overlay to solve display staleness.
3. Do not reintroduce `rulerHeightPx = totalRequiredMinutes / capacityMinutes * availableWorkHeightPx`; that was the rejected `f978c15e` behavior.
4. For Mac/VNC verification of another terminal scope, use the Mac kiosk client key from the operator secret store; Pi4 client-key correctly rejects cross-scope `targetDeviceScopeKey`.

## Local Notes JA

- 要件正本: `leaderboard_labor_minutes_requirements.md`（リポジトリ外）
- **2026-06-18 修正**: 実データで `FSIGENCD=10` 行に `fkmail` が無いため lookup が全落ちしていた。表示済み通常行キーに従属する合算へ変更（`10cc06b0`）。
- **2026-06-24 修正（不十分）**: 速度改善で append 済み行維持は効いていたが、旧 `includeLabor=false` 行の `laborRequiredMinutes=0` も維持されていた。`4e3d3926` は fresh network board の人工数メタデータだけを `row.id` で重ねたが、metadata を保持しないため appended rows 全体への復旧としては不十分だった。
- **2026-06-24 追加**: `+人` の左に 8H/10H ボタンを追加。slotIndex 順に端末ローカル保存し、Gantt `capacityMinutes` へ 480/600 分を渡す。
- **2026-06-24 回帰メモ**: `f978c15e` は 8H/10H 縦バーを総工数比例の長い棒にしてしまい、正常仕様である「行順の累積工数が 480/600 分へ到達する位置を表示する」挙動から外れた。修正では累積境界写像へ戻す。
- **2026-06-24 最終復旧**: `a882ac81` で累積境界写像へ復旧、`cca420ac` で append 済み行へ人工数 metadata を保持 overlay、`5171e44e` で同期表示を overlay 化して画面のガタつきを止めた。Pi5 実機 OK、全台 deploy と Phase12 43/0/0 済み。
- Codex レビュー反映: TS re-export fix, lookup 可視性合わせ→**表示行由来キーへ修正**, FSIGENCD=10 除外, cache v3/fingerprint, service tests, import/order, fallback 安定化
