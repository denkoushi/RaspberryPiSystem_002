---
id: leaderboard-defer-totals-performance-recovery
status: pi5_residual_evidence_deployed
scope: kiosk leader order board API performance (residual context materialization, residual summary, shell/continue)
date: 2026-06-23
source_of_truth: true
related_code:
  - apps/api/src/services/production-schedule/leaderboard/leaderboard-composite-board.service.ts
  - apps/api/src/services/production-schedule/leaderboard/leaderboard-process-change-residual.materialization.ts
  - apps/api/src/services/production-schedule/leaderboard/leaderboard-process-change-residual.service.ts
  - apps/api/src/services/production-schedule/leaderboard/leaderboard-process-change-residual.sql.ts
  - apps/api/src/services/production-schedule/leaderboard/leaderboard-composite-board-prefix-row-cache.ts
  - apps/api/src/services/production-schedule/fkojunst-status-mail-source-rows.reader.ts
  - apps/api/src/services/production-schedule/fkojunst-status-mail-generation-signals.ts
  - apps/api/src/routes/kiosk/production-schedule/leaderboard-phased-read.ts
  - apps/web/src/features/kiosk/leaderOrderBoard/cache/leaderboardBoardFetchParams.ts
  - apps/web/src/features/kiosk/leaderOrderBoard/useCompositeLeaderboardPhasedScheduleWithAutoAppend.tsx
  - apps/api/prisma/migrations/20260623093000_add_process_change_residual_evidence/migration.sql
  - apps/api/prisma/migrations/20260623101000_add_leaderboard_residual_key_index/migration.sql
related_docs:
  - docs/knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md
  - docs/knowledge-base/KB-384-kiosk-leaderboard-append-pagesize-scope-stuck-sync.md
  - docs/knowledge-base/KB-369-leader-order-board-api-internal-latency.md
  - docs/knowledge-base/KB-372-fkojunst-mail-winner-triple-postgres-bind-chunk.md
  - docs/decisions/ADR-20260211-production-schedule-expression-indexes.md
  - docs/decisions/ADR-20260508-leaderboard-board-aggregate-api.md
  - docs/guides/deployment.md
validation: focused api tests PASS · API build/lint PASS · PR #464 HEAD 259a8336 CI/Secret scan/CodeQL success · Pi5 deploy 20260623-102404 success · post-deploy health success · perf flag restored OFF · 503/504 shell single 9.24s · 4 parallel 12.48-13.07s · continue 4.71s
open_items:
  - `resourceShell` remains the largest 503/504 shell phase (single 503 ~5.9s; 4 parallel ~8.9-9.4s). Next minimal work should target shell row selection/order path before broad UX changes.
  - `attachLabor` is now secondary for 503/504 (~1.4-2.2s) but can still grow on large multi-resource boards; keep prefix labor cache and lookup index assumptions in benchmarks.
  - `generationTokenInitial` is ~1.2-1.4s in warm 503/504 samples; avoid reintroducing wide source reads into the display request path.
  - Pi4 Web rollout for deferTotals UX remains separate; the 2026-06-23 fixes are API/DB only and were deployed to Pi5.
---

# Plan: Leaderboard deferTotals Performance Recovery

## Handoff summary (2026-06-19)

**Done this session**

- Implemented `fetchFkojunstStatusMailSourceRowsOrdered()` as reader-boundary `$queryRaw` with JSONB key projection (`FKOJUN`, `FKOTEICD`, `FSEZONO`, `FKOJUNST`, `FUPDTEDT`) instead of full `rowData`.
- Reconstructed minimal `rowData` for downstream pipeline compatibility; visibility filter and dedupe tie-break order unchanged.
- Unified Prisma `ORDER BY` and raw SQL `ORDER BY` via `FKOJUNST_STATUS_MAIL_SOURCE_ROW_ORDER_SPEC` (Codex P3 drift fix).
- Local: focused tests 26 PASS · typecheck/lint OK · temp Postgres migration/SQL/EXPLAIN OK.
- CI: run **27806781358** success on branch `fix/fkojunst-source-row-order-sync` · commit **`ba7340a1`**.
- Pi5 deploy: Detach **`20260619-143326-20869`** · PLAY RECAP **`failed=0`** · Phase12 **43/0/0**.

**Spec (this change)**

- File: `apps/api/src/services/production-schedule/fkojunst-status-mail-source-rows.reader.ts`
- No Prisma migration / index / response contract change.
- Raw SQL LEFT JOIN + `ImportStatus` visibility filter preserved.
- Tests: reader visibility/order, materialization mocks switched to `$queryRaw` projected rows.

**Key learnings**

- Prior Pi5 EXPLAIN: full `rowData` ~15.5s vs required keys only ~1.5s on ~390k rows — fetch projection was the right minimal cold-path lever.
- Subphase telemetry (prior deploy) showed `sourceRowFetchDurationMs` dominated cold `residualMaterialization` (~93%).
- Post-deploy single stonebase shell: `shellMs=54880`, `rows=569`, `total=3619` (contract intact; perf log not re-run yet for subphase delta).
- Heavy leaderboard probing during live Pi5 load can briefly push health to `memory:error` (~95%); service recovered to `status: ok` without rollback.

**Next action**

1. Temporarily enable `LEADERBOARD_BOARD_PERF_LOG=true` on Pi5 `.env`, run one cold stonebase shell, compare `sourceRowFetchDurationMs`.
2. Re-run continue benchmark when Pi5 is quieter.
3. If cold fetch is confirmed improved, next bottleneck is likely `generationTokenInitial` on warm path or continue assembly — pick one minimal PR.

## Goal

Reduce kiosk leader order board **perceived latency** and **over-broad “updating” UI** without breaking existing board/continue/decorations contracts.

**Phase 1 (Web)**: deferTotals UX + sync separation — Pi5 deployed earlier; Pi4 Web rollout still separate.

**Phase 2 (API)**: instrumentation → prefix labor cache → raw mail source projection (this session).

## Current branch and HEAD

- **Branch (this work)**: `fix/fkojunst-source-row-order-sync`
- **Tip**: `ba7340a1` — fix: reduce FKOJUNST source row fetch payload (+ Plan handoff update in same PR)
- **Prisma / migration**: none

## Phase 1 specification (implemented)

### Web — light shell fetch policy

Central helper `applyLeaderboardBoardLightShellFetchPolicy()` in `leaderboardBoardFetchParams.ts`:

- `includeDecorations: false`
- `deferTotals: true`

Applied consistently to:

- `buildLeaderboardBoardBaseFetchParams` (normal path)
- `buildLeaderboardBoardLegacyFetchParams`
- `buildLeaderboardBoardReconcileFetchParams` (seiban OR client filter reconcile)

**Unchanged by design**: `buildLeaderboardBoardContinuePayload` does **not** send `deferTotals`; continue resolves exact totals per existing contract ([KB-374](../knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md)).

### Web — sync state separation

New concepts in composite hook + interaction lock policy:

| Signal | Meaning | UI |
|--------|---------|-----|
| `isBoardDataSyncing` | Initial board / refetch / continue / incomplete append | 「一覧を更新中です。」 |
| `isDecorationSyncing` | `leaderboard-decorations` POST in flight | 「詳細情報を更新中です。」 |
| Interaction lock | Mutation in progress only | 「完了まで操作できません。」 |

`isBackgroundRevalidating` remains for SWR cache retention (decorations must not vanish during decoration-only fetch). `scheduleQuery.isFetching` no longer treats decoration fetch as board fetch.

### Web — seiban reconcile

`useLeaderboardSeibanOrClientFilterOverlay`: clear `serverVerifiedBoard` only when `seibanOrFiltersKey` changes (not on every render).

### API — contract and ops

- `deferTotals` Zod: accepts **boolean or string** (aligned with `includeDecorations`).
- `probePlaywrightChromiumAvailability()`: startup log + `/api/system/health` → `checks.playwright` (`ok` / `warning`; warning alone does not degrade overall status).
- `Dockerfile.api`: prod `node_modules` contamination fix; Playwright install via `pnpm --filter @raspi-system/api exec playwright install chromium`; runtime dep `libpango-1.0-0`.

## Validation (pre-deploy)

| Check | Result |
|-------|--------|
| Web unit (leaderboard targets) | 7 files / 57 tests PASS |
| API unit (shared, health, playwright availability) | PASS |
| `prisma migrate deploy` (temp pg16) | 108 migrations OK |
| API Docker build (`INSTALL_PLAYWRIGHT_CHROMIUM=false`) | OK |
| GitHub Actions CI | run **27618320442** success |

## Pi5 production deploy (2026-06-16)

**Command** (standard):

```bash
export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"
./scripts/update-all-clients.sh feat/leaderboard-defer-totals \
  infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow
```

| Field | Value |
|-------|-------|
| Detach Run ID | `20260616-221700-6889` |
| Git on Pi5 | `14bb6e96` on `feat/leaderboard-defer-totals` |
| Web bundle | `index-GwX1IMdN.js` (contains `deferTotals`, `一覧を更新中`, `詳細情報を更新中`) |
| Ansible PLAY RECAP | `ok=122` `changed=6` **`failed=1`** `rescued=1` |
| Post-deploy health | `status: ok`, `playwright: ok` |
| Phase12 | **PASS 43 / WARN 0 / FAIL 0** (~129s) |

### Deploy troubleshooting (recorded)

**Symptom**: Ansible task `Wait for API health endpoint to recover` failed after api/web recreate — HTTP **503** `status: degraded`, `checks.memory.status: error` (**96.1%** at ~93s uptime). DB and Playwright checks were OK.

**Outcome**: ~1 minute later health returned **200 ok**; new containers and branch tip remained deployed (no effective rollback).

**Mitigation for operators**: After Pi5 api/web rebuild, if PLAY RECAP shows `failed=1` on health wait only, re-check `curl -sk https://<Pi5>/api/system/health` before assuming deploy failure. Transient post-start memory spike on Pi5 can exceed the playbook retry window.

**Permanent fix**: branch **`fix/deploy-api-build-cache-health-wait`** — Dockerfile manifest-first cache + Ansible health wait 24×5s. Details: [deployment.md §deploy-api-build-cache-health-wait](../guides/deployment.md#deploy-api-build-cache-health-wait-2026-06-17) · [KB-389](../knowledge-base/infrastructure/ansible-deployment-performance.md#kb-389-api-docker-build-cache-and-health-wait).

## Pi5 manual verification (pending)

On Pi5 kiosk / browser (Pi4 not yet on this branch):

1. Leaderboard first paint — fewer false “updating” states; rows usable while decorations load.
2. Seiban OR filter ON → reconcile → rows and `hasMore` correct after append.
3. Network — board GET includes `deferTotals=true`; continue POST does not.
4. Decoration fetch — 「詳細情報を更新中です。」 only; no 「操作できません」 unless mutating.

## Pi4 rollout (not started)

After Pi5 sign-off, deploy **one host at a time** (recommended order):

`raspberrypi5` (already done) → `raspi4-kensaku-stonebase01` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80`

Pi3 / signage: out of scope (`skipping: no hosts matched`).

Each Pi4: `update-all-clients.sh` with `--limit <host>` + force reload per [verification-checklist §6.6.4](../verification-checklist.md).

## Phase 2 (open — not in this branch)

API-side shell selection / winner materialization / COUNT path profiling and minimal query changes. Phase 1 improves client-side deferTotals consistency and UX only; root 10s-class latency may remain until phase 2.

## Phase 2 investigation update (2026-06-19)

Read-only Pi5 measurements from Mac confirmed the current bottleneck is still API-side, not only Pi4 browser rendering.

Observed against `https://100.106.158.2`:

| Probe | Result |
|-------|--------|
| `/api/system/health` | `200 ok`; DB, memory, Playwright OK |
| `leaderboard-board` shell with `includeDecorations=false&deferTotals=true` | `robodrill` ~10.8s, `fjv` ~10.0s, `stonebase` ~12.4s |
| `stonebase` `leaderboard-board/continue` | `pageSize=80` hit `snapshotExpired`; `pageSize=160` completed in ~222.5s total, ~207.8s continue, 7 rounds |
| `stonebase` deferred decorations | priority 64 rows ~1.25s; first background 80 rows ~1.11s |
| Pi5 system info after probes | CPU temp ~55.1C, load ~44%, maintenance false |

Interpretation:

- `deferTotals=true` avoids exact shell COUNT, but shell is still 10s-class.
- Continue can exceed snapshot TTL / practical UX budget on large boards.
- Deferred decorations are visible cost but not the primary bottleneck in this sample.
- Recent `+人` labor metadata is a high-priority hypothesis because shell and continue both call `attachLeaderboardLaborMinutes`, but this is not yet confirmed.

### Temporary performance instrumentation

API-only opt-in instrumentation was added for the next investigation pass. Default is OFF and response contracts are unchanged.

Enable on Pi5 only when collecting logs:

```bash
LEADERBOARD_BOARD_PERF_LOG=true
```

When enabled, `GET /api/kiosk/production-schedule/leaderboard-board` and `POST /api/kiosk/production-schedule/leaderboard-board/continue` emit `[leaderboard-board-performance]` log records with:

- `endpoint`: `shell` or `continue`
- `phase`: `processChangeResidualContext`, `materializedBaseWhere`, `resourceShell`, `processChangeResidualSummary`, `resourceTotals`, `resourceContinue`, `assembleResource`, `attachLabor`, `decorate`, `requestTotal`
- `subphase` (under `processChangeResidualContext` only): `generationTokenInitial`, `residualMaterialization`, `generationTokenRefresh`
- counts and flags: `resourceCd`, `resourceCount`, `rowCount`, `deltaRowCount`, `hasMore`, `hasMoreCount`, `total`, `snapshotExpired`, `includeDecorations`, `chunkSize`, `deferredTotals`, `cacheHit`, `revisionChanged`, `rawRowCount`, `normalizedRowCount`, `dedupedRowCount`, `strongEvidenceKeyCount`
- materialization stage durations (under `subphase=residualMaterialization`): `sourceRowFetchDurationMs`, `normalizeDurationMs`, `dedupeDurationMs`, `buildEvidenceDurationMs`
- Parent `processChangeResidualContext` events omit `subphase`; treat `subphase == null` as the parent total when aggregating.

Use these logs to decide whether the next minimal fix should target row selection, process-change residual materialization, labor lookup, continue assembly, or snapshot TTL/process locality.

### Pi5 instrumentation deploy and first logs

Instrumentation branch:

- Branch: `chore/leaderboard-board-perf-logging`
- Commit: `4882bda1` (`chore: instrument leaderboard board performance`)
- Pi5 deploy: `20260619-083502-12095`
- PLAY RECAP: `ok=134 changed=4 failed=0`
- Phase12: `PASS 43 / WARN 0 / FAIL 0`

Temporary runtime flag:

- `LEADERBOARD_BOARD_PERF_LOG=true` was added to Pi5 `infrastructure/docker/.env`.
- Backup before edit: `infrastructure/docker/.env.leaderboard-perf.bak-20260619-084003`.
- API health after recreate: `200 ok`.

First instrumented `stonebase` request after API recreate:

| Endpoint | Total | Dominant phases |
|----------|-------|-----------------|
| shell | ~78.5s | `processChangeResidualContext` ~62.0s, `materializedBaseWhere` ~6.1s, `attachLabor` ~5.2s, per-resource shell ~3.8-5.3s |
| continue round 1 (`pageSize=160`) | ~39.8s | `processChangeResidualContext` ~21.3s, `attachLabor` ~13.0s, `resourceTotals` ~3.0s, per-resource continue ~5.3-5.5s |

Warm follow-up `stonebase` shell:

| Total | Dominant phases |
|-------|-----------------|
| ~14.3s | `processChangeResidualContext` ~4.7s, `attachLabor` ~5.1s, per-resource shell max ~4.2s, `processChangeResidualSummary` ~3.2s |

Interpretation update:

- Cold-start/process-change residual materialization can dominate the first request after API recreate.
- Warm shell still has no single tiny culprit: `attachLabor`, process-change residual context/summary, and per-resource shell selection are all multi-second.
- Continue round 1 confirms `attachLabor` becomes larger as accumulated rows grow (`1547` rows / `978` delta rows -> ~13.0s).
- Next minimal fix should target measurement-informed reduction of `attachLabor` repeated work and process-change residual materialization cost before changing client constants.

### Local implementation draft (not deployed)

Implemented locally on `chore/leaderboard-board-perf-logging` after the Pi5 timing pass:

- Seed `leaderboard-board` prefix row cache with labor-attached rows after shell `attachLabor`.
- Re-seed each continue snapshot prefix with labor-attached accumulated rows after continue `attachLabor`.
- Preserve response shape and snapshot/continue cursor behavior.

Expected effect: later continue rounds should skip labor lookup for already accumulated prefix rows and only attach labor metadata for newly added rows, reducing repeated `attachLabor` cost as the board grows.

Validation:

- `pnpm --filter @raspi-system/api exec vitest run src/services/production-schedule/leaderboard/__tests__/leaderboard-composite-board-generation-token.test.ts src/services/production-schedule/leaderboard/__tests__/leaderboard-composite-board-prefix-row-cache.test.ts`
- `pnpm --filter @raspi-system/api build`
- `pnpm --filter @raspi-system/api lint`

Deployment status: **not deployed**. Next step is to run the same `stonebase` shell + continue timing after deploy and confirm `attachLabor` drops on continue round 2+.

### Pi5 API optimization deploy (2026-06-19)

**Branch**: `chore/leaderboard-board-perf-logging` · **HEAD**: `986248e5` (`fix: reduce leaderboard continue repeated labor work`)

**Scope (API only, no Prisma / Web change)**:

- Seed prefix row cache with **labor-attached** rows after shell/continue `attachLabor` (`seedAttachedRowsForSnapshot`).
- Continue perf logging: resolve `materializedBaseWhere` once (no double-count in logs).
- Failed phase emits `ok:false` + `errorName`/`errorCode` before rethrow.
- `requestTotal` perf events include `ok:true`.

**Deploy target**: **`raspberrypi5` only** (Pi4/Pi3 not required for API-only change).

**Command** (standard):

```bash
export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"
./scripts/update-all-clients.sh chore/leaderboard-board-perf-logging \
  infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow
```

| Field | Value |
|-------|-------|
| Detach Run ID | `20260619-093623-144` |
| Git on Pi5 | `986248e5` |
| Ansible PLAY RECAP | `ok=138` `changed=7` **`failed=0`** |
| Phase12 | **PASS 43 / WARN 0 / FAIL 0** (~39s) |
| Post-deploy health | Phase12 API health PASS; brief post-recreate memory `degraded` possible (same pattern as prior api rebuild) |

**Post-deploy verification (Mac → Pi5, read-only)**:

| Check | Result |
|-------|--------|
| `benchmark-leaderboard-board-shell.mjs --profile stonebase --runs 2` | run1 ~77.2s (cold) · run2 ~25.2s (warm) · rows=569 total=3619 |
| `benchmark-leaderboard-continue-chunk.mjs --profile stonebase` | pageSize **160**: total ~74.8s · **7** continue rounds · **3619** rows · row ids **match** pageSize 80 baseline |
| Continue A/B gate | output同値 **PASS** · 160 vs 80 total **1.35x** faster (~26% saved) |

**Interpretation**:

- Response contract preserved (`3619` rows, identical row-id fingerprint vs pageSize=80).
- Warm continue total (~75s for stonebase full board at chunk 160) improved vs pre-fix cold sample (~222s); treat as directional — mixed cold/warm and residual context still apply.
- `LEADERBOARD_BOARD_PERF_LOG` was **not** in Pi5 `.env` after standard deploy (prior manual flag removed). Re-add temporarily for phase-level `attachLabor` proof if needed.

**Next minimal work**: reduce `processChangeResidualContext` using subphase timings (cold stonebase: DB fetch dominates); optional re-enable perf log flag for another timed session.

### Pi5 residual context measurement deploy (2026-06-19)

**Branch**: `chore/leaderboard-residual-context-measurement` · **HEAD**: `42c2c483` (`chore: instrument leaderboard residual context`)

**Scope (API only, no Prisma / Web change)**:

- Split `processChangeResidualContext` into opt-in subphase perf events: `generationTokenInitial`, `residualMaterialization`, `generationTokenRefresh`.
- Forward materialization counts + stage durations (`sourceRowFetchDurationMs`, `normalizeDurationMs`, `dedupeDurationMs`, `buildEvidenceDurationMs`) into board perf logs.
- Optional materialization `telemetry` callback; failures in telemetry do not break residual materialization.
- Response contract unchanged; perf log default OFF.

**Deploy target**: **`raspberrypi5` only** (Pi4/Pi3 not required for API-only change).

**Command** (standard):

```bash
export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"
./scripts/update-all-clients.sh chore/leaderboard-residual-context-measurement \
  infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow
```

| Field | Value |
|-------|-------|
| Detach Run ID | `20260619-113535-25865` |
| Git on Pi5 | `42c2c483` |
| Ansible PLAY RECAP | `ok=134` `changed=4` **`failed=0`** |
| Phase12 | **PASS 43 / WARN 0 / FAIL 0** (~57s) |
| Post-deploy health | `status: ok` after brief post-recreate memory spike (same pattern as prior api rebuild) |

**Post-deploy verification (Mac → Pi5, read-only unless noted)**:

| Check | Result |
|-------|--------|
| `benchmark-leaderboard-board-shell.mjs --profile stonebase --runs 2` | run1 ~21.2s · run2 ~22.0s · rows=569 total=3619 |
| `benchmark-leaderboard-continue-chunk.mjs --profile stonebase` | pageSize **160**: total ~94.0s · **7** continue rounds · **3619** rows · row ids **match** · gate **PASS** |
| Temporary `LEADERBOARD_BOARD_PERF_LOG=true` + 1 stonebase shell | subphase logs emitted; cold sample below |

**Subphase log sample (stonebase shell, cold after API recreate, flag temporarily enabled then restored)**:

| Event | durationMs | Notes |
|-------|------------|-------|
| `subphase=generationTokenInitial` | 2339 | generation token SQL |
| `subphase=residualMaterialization` | 39198 | `sourceRowFetchDurationMs=36622` · `normalizeDurationMs=1867` · `dedupeDurationMs=472` · `buildEvidenceDurationMs=237` · `rawRowCount=390372` · `dedupedRowCount=315854` · `strongEvidenceKeyCount=114` |
| parent `processChangeResidualContext` (no subphase) | 41539 | sum of subphases |

**Interpretation**:

- Instrumentation works on Pi5; DB source-row fetch is the dominant cost inside cold `residualMaterialization` (~93% of that subphase in this sample).
- Warm shell (~21–22s) and continue contract (`3619` rows, matching ids) preserved after deploy.
- `LEADERBOARD_BOARD_PERF_LOG` restored to OFF after verification (standard deploy does not persist manual flag).

**Next minimal work**: optimize raw mail source fetch / materialization cache path for cold shell; use subphase logs to validate any fix before broader rollout.

### Pi5 source-row projection deploy (2026-06-19)

**Branch**: `fix/fkojunst-source-row-order-sync` · **HEAD**: `ba7340a1` (`fix: reduce FKOJUNST source row fetch payload`)

**Scope (API only, no Prisma / Web change)**:

- Replace Prisma `findMany` full-`rowData` fetch in `fetchFkojunstStatusMailSourceRowsOrdered()` with raw SQL that projects only required `FKOJUNST_Status` keys.
- Keep downstream contract by reconstructing the minimal `rowData` object inside the reader boundary.
- Derive Prisma `orderBy` and raw SQL `ORDER BY` from one shared spec to prevent dedupe tie-break drift.

**Deploy target**: **`raspberrypi5` only** (Pi4/Pi3 not required for API-only change).

**Command** (standard):

```bash
export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"
./scripts/update-all-clients.sh fix/fkojunst-source-row-order-sync \
  infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow
```

| Field | Value |
|-------|-------|
| Detach Run ID | `20260619-143326-20869` |
| Git on Pi5 | `ba7340a1` |
| Ansible PLAY RECAP | `ok=134` `changed=4` **`failed=0`** |
| Phase12 | **PASS 43 / WARN 0 / FAIL 0** |
| Post-deploy health | immediate check `status: ok`; later heavy board/continue probing temporarily hit `memory:error` before recovering to `status: ok` |

**Post-deploy verification (Mac → Pi5, read-only unless noted)**:

| Check | Result |
|-------|--------|
| `curl -sk https://100.106.158.2/api/system/health` | initial `status: ok` (`database` / `memory` / `playwright` all `ok`) |
| `node ./scripts/test/benchmark-leaderboard-board-shell.mjs --profile stonebase --runs 1` | `shellMs=54880` · `rows=569` · `total=3619` |
| `NODE_TLS_REJECT_UNAUTHORIZED=0 node ./scripts/test/benchmark-leaderboard-continue-chunk.mjs --profile stonebase` | initial probe hit `HTTP 503` while Pi5 health was `memory:error` (`95.5%`) |
| `curl -sk https://100.106.158.2/api/system/health` after cooldown | recovered to `status: ok` with `memory` warning level (~89.9%) |

**Interpretation**:

- The API-only deploy itself completed cleanly and standard regression checks stayed green.
- The shell contract for `stonebase` remained intact after deploy (`569` rows, `3619` total).
- Subphase perf improvement is **not yet quantified** on Pi5 after this deploy; re-enable perf flag for one cold shell before claiming fetch-time reduction.
- A full continue benchmark should be re-run during a quieter Pi5 window because a live-load probe temporarily pushed health into `memory:error`; the service recovered without manual intervention.

**Next minimal work**: quantify `sourceRowFetchDurationMs` delta on Pi5; then choose next single bottleneck (`generationTokenInitial` vs continue assembly).

### Pi5 residual evidence persistence + residual-key index deploy (2026-06-23)

**Branch / PR**: `feat/production-schedule-split-orders` / PR #464
**Final HEAD**: `259a8336` (`perf: match residual summary index predicate`)

**Scope (API + DB, no Web contract change)**:

- Persist process-change residual evidence during `ProductionScheduleFkojunstMailStatusSyncService.syncFromStatusMailDashboard()`.
  - New tables: `ProductionScheduleProcessChangeResidualSnapshot`, `ProductionScheduleProcessChangeResidualEvidence`.
  - Migration: `20260623093000_add_process_change_residual_evidence`.
  - Materialization now reads persisted evidence first when the requested raw mail revision matches; fallback still supports raw source rows.
- Avoid rereading all `FKOJUNST_Status` raw rows inside the sync replacement transaction.
  - `fetchFkojunstStatusMailGenerationSignals()` uses `COUNT` / `MIN(createdAt)` / `MAX(createdAt)`-style revision signals instead of full row fetch.
  - This removed the `P2028` timeout observed when 451,087 raw mail rows were reread inside a 60s transaction.
- Count residual summary from the small evidence key set rather than the generic visible-row `COUNT` path.
  - `fetchLeaderboardProcessChangeResidualSummary()` now uses `WITH residual_keys(...) AS (VALUES ...)` and joins by normalized `ProductNo + FKOJUN + resource`.
  - `leaderboard-shell-row-projection.sql.ts` exposes auxiliary joins so the representative residual-row SELECT can share the normal shell projection while changing the join root.
- Add normalized residual-key expression index.
  - Migration: `20260623101000_add_leaderboard_residual_key_index`.
  - Index: `csv_dashboard_row_prod_schedule_residual_key_idx` on `csvDashboardId`, `NULLIF(BTRIM(ProductNo),'')`, `NULLIF(BTRIM(FKOJUN),'')`, `UPPER(BTRIM(FSIGENCD))`.
  - SQL explicitly includes the partial-index predicate (`csvDashboardId` + key-present checks); without this, Pi5 samples still showed multi-second residual summary scans.

**Representative commits**:

| Commit | Purpose |
| --- | --- |
| `c3fd5ea7` | Persist residual evidence for leaderboard |
| `d6f2d7f8` | Avoid raw mail reread during sync revision check |
| `6da6634a` | Count residual summary from evidence keys |
| `42d840ab` | Add residual leaderboard key index |
| `259a8336` | Match residual summary SQL to partial-index predicate |

**Backfill / data point**:

After deploy, a one-off Pi5 `syncFromStatusMailDashboard()` backfill completed and persisted evidence for the current raw mail revision:

| Field | Value |
| --- | --- |
| Raw rows scanned | `451,087` |
| Normalized rows | `372,383` |
| Matched current rows | `19,923` |
| Evidence rows | `129` |
| Raw mail revision | `451087:2026-06-22T21:48:45.989Z:2026-06-22T22:37:02.085Z` |
| Algorithm version | `1` |

**Deploy / validation**:

| Check | Result |
| --- | --- |
| Focused API tests | `leaderboard-process-change-residual.materialization`, `fkojunst-status-mail-sync.pipeline`, `leaderboard-shell-snapshot-generation.sql`, `leaderboard-composite-board-generation-token` PASS |
| API build / lint | PASS |
| Commit hooks | workspace lint PASS |
| GitHub Actions on `259a8336` | CI / Secret scan / CodeQL success |
| Pi5 deploy | `20260623-102404` success (`failed=0`) |
| Post-deploy health | success |
| Perf flag | temporarily enabled for measurement, then removed from `.env` and API restarted healthy |

**Pi5 measurement summary (503/504 board, `includeDecorations=false`, `deferTotals=true`)**:

| Stage | Before this 2026-06-23 round | After persisted evidence + residual index |
| --- | --- | --- |
| Pre-residual persistence shell | ~62-65s | n/a |
| After persisted evidence shell | ~16-18s | n/a |
| Final shell single request | n/a | **9.24s** (`rows=107`) |
| Final shell 4 parallel | n/a | **12.48-13.07s** |
| Final continue `pageSize=160` | previously observed ~21-22s under live-load contention | **4.71s** (`rows=267`, `deltaRows=160`, `total=489`) |
| `processChangeResidualSummary` | ~3s class, sometimes worse under contention | **761ms** single; **2.35-2.90s** under 4 parallel |

**Final single-request phase sample**:

| Phase | durationMs | Notes |
| --- | ---: | --- |
| `generationTokenInitial` | 1357 | no raw residual source scan |
| `residualMaterialization` | 11 | `persistedHit=true`, `persistedEvidenceRowCount=129`, `strongEvidenceKeyCount=129` |
| `materializedBaseWhere` | 441 | winner base set |
| `processChangeResidualSummary` | 761 | residual CTE + normalized key index |
| `resourceShell` 504 | 1459 | 27 rows, no more |
| `resourceShell` 503 | 5855 | 80 rows, has more |
| `attachLabor` | 1517 | 107 rows |
| `requestTotal` | 9189 | HTTP observed 9.24s |

**Interpretation**:

- The main speedup came from moving wide data reads out of display requests:
  - raw `FKOJUNST_Status` evidence is materialized at sync/backfill time;
  - display requests read 129 persisted evidence rows instead of the 45万-row raw mail dashboard;
  - residual summary uses an indexed normalized-key lookup instead of broad visible-row counting.
- The next bottleneck is no longer residual materialization. For 503/504, `resourceShell` is now the dominant phase. `attachLabor` and `generationTokenInitial` are still visible but secondary in the final samples.
- 6-resource live board requests can still be much heavier, especially when real kiosks and manual probes overlap. Treat final numbers above as 503/504 scoped proof, not a P95 guarantee for all resource sets.

**Next minimal work**:

1. Profile `resourceShell` SQL for 503 and a 6-resource board under a quiet Pi5 window.
2. Decide whether the next safe lever is a sort/lookup index, a materialized shell ordering key, or a narrower row-selection query for `allowResourceOnly=true`.
3. Keep `LEADERBOARD_BOARD_PERF_LOG` opt-in only; standard deploys remove manual `.env` edits, and measurement sessions must restore the flag to OFF.

### Pi5 6-slot resource board follow-up (2026-06-23)

**Branch / PR**: `feat/production-schedule-split-orders` / PR #464
**HEAD**: `91347780` (`perf: speed up leaderboard labor lookup`)
**Pi5 deploy**: `20260623-120401-21398` success (`failed=0`, `Git: changed`)

**Scope (API + DB, no response contract change)**:

- Add generation-scoped `ProductNo + FKOJUN` labor lookup cache for leaderboard shell/continue.
  - Scope key is the leaderboard snapshot generation token.
  - Positive rows and zero misses are cached for 5 minutes; tests clear the cache explicitly.
  - This targets repeated `attachLabor` work across the shell/continue chain.
- Add normalized resource expression index for resource-slot row selection.
  - Migration: `20260623115000_add_leaderboard_normalized_resource_index`.
  - Index: `csv_dashboard_row_prod_schedule_resource_norm_idx` on `csvDashboardId`, `UPPER(BTRIM(FSIGENCD))`, `id`.
  - Reason: Pi5 showed the older raw `rowData->>'FSIGENCD'` index at `idx_scan=0` because runtime predicates normalize with `UPPER(BTRIM(...))`.

**Validation / deploy state**:

| Check | Result |
| --- | --- |
| Focused API tests | `leaderboard-labor-minutes.service.test.ts` + `leaderboard-composite-board-generation-token.test.ts` PASS |
| API lint / build | PASS |
| Commit hook | workspace lint PASS |
| Pi5 migration | `20260623115000_add_leaderboard_normalized_resource_index` applied |
| Pi5 index | `csv_dashboard_row_prod_schedule_resource_norm_idx` present |
| Perf flag | temporarily enabled for measurement, restored to `off`; API restarted healthy |
| Post-measure health | `status: ok` (`database` / `memory` / `playwright` ok) |

**Pi5 direct API measurement (6 slots: `581,305,589,584,588,586`)**:

The measurement ran from inside the Pi5 API container against `127.0.0.1:8080`, with `allowResourceOnly=true`, shell `pageSize=80`, continue `pageSize=160`, `deferTotals=true`.

| Stage | Before this round | After `91347780` |
| --- | ---: | ---: |
| Shell light (`includeDecorations=false`) | **32.87s** | **3.36s** measured request (`requestTotal=3.28s`, warm labor cache) |
| Deferred decorations, 480 rows | **8.43s** | **8.02s** |
| Continue chain, 5 rounds | **55.15s** | **20.97s** |
| Rows after continue | `2579 / 2579` | `2579 / 2579` |
| `includeDecorations=true` shell | **31.80s** | **10.99s** cold request (`requestTotal=10.94s`) |

**Measured continue rounds after `91347780`**:

| Round | durationMs | rows | deltaRows | hasMoreCount |
| --- | ---: | ---: | ---: | ---: |
| 1 | 4594 | 1303 | 823 | 4 |
| 2 | 6896 | 1823 | 520 | 3 |
| 3 | 3409 | 2267 | 444 | 2 |
| 4 | 2975 | 2429 | 162 | 1 |
| 5 | 3099 | 2579 | 150 | 0 |

**Server phase samples**:

| Request | Key phase data |
| --- | --- |
| First live cold shell after restart | `requestTotal=8615ms`; resourceShell max `584=1728ms`; `attachLabor=5583ms` |
| Measured shell (`req-55`) | `requestTotal=3283ms`; resourceShell max `584=1592ms`; `attachLabor=5ms` because the live cold request had already warmed the generation cache |
| Measured continue round 1 (`req-65`) | `requestTotal=4523ms`; resourceContinue max `589=3229ms`; `attachLabor=18ms` |
| Measured continue round 2 (`req-69`) | `requestTotal=6829ms`; resourceContinue max `586=5475ms`; `attachLabor=10ms` |
| Measured continue rounds 3-5 | `3339ms`, `2905ms`, `3019ms`; `attachLabor=7ms/5ms/5ms` |
| Cold `includeDecorations=true` shell (`req-4`) | `requestTotal=10936ms`; resourceShell max `584=1929ms`; `attachLabor=5653ms`; `decorate=1749ms` |

**Interpretation**:

- The 6-slot one-minute class API path was primarily server-side, not Web rendering. After the normalized resource index and generation-scoped labor lookup cache, the same API chain is no longer ~1 minute.
- `resourceShell` dropped from the earlier 6-slot max **24.3s** (`584`) to ~**1.6-1.9s** per resource in the new samples.
- The cache only helps after the first request for a generation. A cold shell still spends ~**5.6s** in `attachLabor`; subsequent continue requests spend single-digit milliseconds there.
- The remaining API cost is now mostly `resourceContinue` for the large resources plus repeated per-request fixed work (`generationTokenInitial` / materialized base WHERE). If the real browser still feels slow, verify Web append/render next before adding more DB indexes.

### First usable state target（2026-06-23 follow-up）

User clarified the immediate target as **「最初に使える状態」を10秒以内** rather than complete append visibility. The 6-slot direct API data already supports that target when the browser can switch to the fresh shell promptly:

- warm shell: **3.36s**
- first cold shell after API restart: **8.62s** (`attachLabor=5.58s`)
- cold `includeDecorations=true`: **10.99s**, but production Web uses `includeDecorations=false` for shell and fetches decorations separately

Web follow-up changed Phase 2 SWR display policy: terminal cache still fills initial blank loading, but once a fresh network shell has display rows, the board switches to network rows even while append/decorations continue in the background. This prevents a complete cached board from hiding the new partial shell until the ~20-30s append chain finishes.

Expected user-visible result: first fresh rows and row-level operations become available at shell arrival time. Full list completion still depends on the background continue chain.

**Next minimal work**:

1. Check the actual Pi5 browser after deploy with the 6-slot view; record whether item visibility is now API-bound or render-bound.
2. If still slow, profile `resourceContinue` SQL for `584`, `586`, and `589`.
3. Consider reducing repeated continue fixed work before adding broader indexes.

## Local Notes JA

- 初回 COUNT を `deferTotals=true` で避け、continue で exact total に戻す設計は [KB-374](../knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md) の continue 契約と両立。
- `INSTALL_PLAYWRIGHT_CHROMIUM=false` 時は要領書 HTML→PDF 等も影響。health `checks.playwright` で検知可能。
