---
id: leaderboard-defer-totals-performance-recovery
status: labor_metadata_overlay_verified
scope: kiosk leader order board first usable performance and Web display stability
date: 2026-06-29
source_of_truth: true
related_code:
  - apps/api/src/services/production-schedule/leaderboard/leaderboard-composite-board.service.ts
  - apps/api/src/services/production-schedule/leaderboard/leaderboard-row-selection.service.ts
  - apps/api/src/services/production-schedule/leaderboard/leaderboard-labor-minutes.service.ts
  - apps/api/src/services/production-schedule/leaderboard/leaderboard-process-change-residual.materialization.ts
  - apps/api/src/services/production-schedule/leaderboard/leaderboard-process-change-residual.service.ts
  - apps/api/src/services/production-schedule/leaderboard/leaderboard-process-change-residual.sql.ts
  - apps/api/src/services/production-schedule/leaderboard/leaderboard-composite-board-prefix-row-cache.ts
  - apps/api/src/services/production-schedule/production-schedule-effective-completion.sql.ts
  - apps/api/src/services/production-schedule/production-schedule-list-count.service.ts
  - apps/api/src/services/production-schedule/fkojunst-status-mail-source-rows.reader.ts
  - apps/api/src/services/production-schedule/fkojunst-status-mail-generation-signals.ts
  - apps/api/src/routes/kiosk/production-schedule/shared.ts
  - apps/api/src/routes/kiosk/production-schedule/leaderboard-phased-read.ts
  - apps/web/src/features/kiosk/leaderOrderBoard/cache/leaderboardBoardFetchParams.ts
  - apps/web/src/features/kiosk/leaderOrderBoard/leaderboardBoardAppendOverrideScopePolicy.ts
  - apps/web/src/features/kiosk/leaderOrderBoard/leaderboardBoardShellFreshnessPolicy.ts
  - apps/web/src/features/kiosk/leaderOrderBoard/mergeLeaderboardBoardLaborMetadata.ts
  - apps/web/src/features/kiosk/leaderOrderBoard/performance/leaderBoardRefetchPolicy.ts
  - apps/web/src/features/kiosk/leaderOrderBoard/useCompositeLeaderboardPhasedScheduleWithAutoAppend.tsx
  - apps/web/src/pages/kiosk/ProductionScheduleLeaderOrderBoardPage.tsx
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
validation: >-
  focused api/web tests PASS · Web lint/build PASS · commit hook workspace lint PASS · PR #464 HEAD e98de7ce deploy success · Pi5 deploy 20260623-200308-94 success · API container healthy · health ok · 6-slot first usable perf beacon 8.344s · +人 toggle no scrollHeight collapse · labor-toggle sync banner suppressed · 2026-06-24 +人 labor metadata overlay focused Web tests/lint/build PASS · real-device visual OK · f978c15e CI/deploy/Phase12 succeeded but its Gantt ruler-height behavior was later classified as a visual-contract regression ·
  2026-06-28 d507780f completionFilter pushdown CI/CodeQL success, Pi5+4 Pi4 deploy success, Pi4-like Playwright first visible 5.6-8.4s, user real device reported much faster ·
  2026-06-28 bcf79b04 labor metadata lightweight overlay PR #867 CI/CodeQL/gitleaks success, Pi5+5 Pi4 deploy and health success, real Pi4 labor metadata POST verified ·
  2026-06-29 post-deploy comparison showed +人 metadata POST about 3.0-3.5s for 80 displayed ids, faster than the old includeLabor full-board refetch class at about 4.9-6.5s
open_items:
  - If the physical browser still appears busy, distinguish three states: initial shell load, 5-minute board refresh, and `+人` labor metadata refresh. Only the first two should show 「一覧を更新中です。」.
  - `resourceShell` can still be multi-second on large resources; do not add API/index work until browser/client-perf logs show API shell is again the bottleneck.
  - Kiosk browsers must hard reload to pick up the deployed Web bundle; already-open SPA tabs can keep old banner/refetch/labor-overlay behavior until reload.
  - For further `+人` speed work, profile `leaderboardPerf=1` events (`labor-metadata-start/end/error`) plus server `endpoint="laborMetadata"` phases. Current production metadata POST cost is about 3.0-3.5s for 80 displayed ids; do not reintroduce a full board refetch to solve this.
  - Actual DOM reflection after `labor-metadata-end` is not yet quantified on the physical browser. Measure it before optimizing API internals further if operators still report delay.
  - `raspi4-sessaku-01` was updated successfully by deploy runs `20260628-222904` and `20260628-231744`; it is no longer the known old-commit outlier from the completionFilter deploy.
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

Each Pi4: `update-all-clients.sh` with `--limit <host>` + force reload per [verification-checklist §6.6.4](../guides/verification-checklist.md).

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

Deployment: `429049ea` (`perf: show fresh leaderboard shell during append`) was deployed to Pi5 in run `20260623-125453-28293` (`failed=0`). Post-deploy health returned `status: ok`. Final restored-normal-env Pi5 API-container-local cold shell for the 6-slot board was **8.49s** (`480` rows / `6` hasMore slots, `includeDecorations=false`, `deferTotals=true`).

Expected user-visible result: first fresh rows and row-level operations become available at shell arrival time. Full list completion still depends on the background continue chain.

**Follow-up after physical browser still reported ~30s (2026-06-23)**:

- Root cause confirmed: cold/wide 6-slot shells were still paying `attachLabor` even when every slot had `+人` OFF. Perf samples before the fix showed `attachLabor=4090-5535ms` on cold shell; direct `includeLabor=true` after the final deploy still measured **18.20s** for the same 6-slot / 300-row shell.
- Fix: add `includeLabor` to `leaderboard-board` GET and continue POST. The Web board sends `includeLabor=false` while all slot `+人` toggles are OFF; toggling any slot ON changes the query key and refetches with labor metadata. After Pi5 logs showed the physical 6-slot browser still sending old-bundle requests with `includeLabor` missing, `bf9dea17` changed the API default for missing `includeLabor` to **false** while preserving explicit `includeLabor=true`.
- No-labor shell still returns numeric metadata for cache/display compatibility: `machineRequiredMinutes` from row `FSIGENSHOYORYO`, `laborRequiredMinutes: 0` for normal machine rows.
- Deploy: `06ad4a4c` (`perf: defer leaderboard labor lookup`) pushed and deployed to Pi5. Wrapper run `20260623-140812-7148` completed `failed=0`; because an earlier failed direct Ansible run had already moved the repo HEAD, Docker rebuild was manually forced for `api` and `web`. Runtime verified: HEAD `06ad4a4c`, web bundle `index-CtusrliU.js`, `/api/system/health` `status: ok`, `LEADERBOARD_BOARD_PERF_LOG` OFF.
- Pi5 direct HTTPS measurements, 6 slots `581,305,589,584,588,586`, `pageSize=50`, `allowResourceOnly=true`, `includeDecorations=false`, `deferTotals=true`, `includeLabor=false`: **5.25s**, **6.22s**, **5.36s** for 300 shell rows. Sample rows carried `laborRequiredMinutes=0`.
- Deploy: `bf9dea17` (`perf: default leaderboard labor off`) pushed and deployed to Pi5. Wrapper run `20260623-144810-12264` completed `failed=0`, Docker restart summary `ok`, runtime HEAD `bf9dea17`, API container healthy, perf log OFF.
- Pi5 direct HTTPS measurement matching the old bundle request shape, 6 slots `581,305,589,584,588,586`, `pageSize=80`, `allowResourceOnly=true`, `includeDecorations=false`, `deferTotals=true`, **`includeLabor` omitted**: shell **2.81s** for 480 rows; first continue with `includeLabor` omitted **3.85s** for 1303 rows. Sample rows carried `laborRequiredMinutes=0`.

**Next minimal work**:

1. Retest the physical kiosk browser after `bf9dea17`; old tabs no longer need `includeLabor=false` in the URL for speed, but `+人` ON correctness still needs the new bundle.
2. If first usable still exceeds 10s, capture browser Network timings for `leaderboard-board`, `leaderboard-board/continue`, `leaderboard-decorations`, and first row paint.
3. If API shell regresses rather than browser/render, profile `resourceShell` for the 6 slot resources before adding more indexes.

### Physical-screen request sequence check（2026-06-23 follow-up）

Pi5 API logs after `bf9dea17` still showed the physical 6-slot board doing a fast shell but continuing background work for much longer. Representative same-window sequence (JST):

| Relative | Request | Duration |
| ---: | --- | ---: |
| +0.0s | `GET leaderboard-board?pageSize=80&boardResourceCds=581,305,589,584,588,586&includeDecorations=false&deferTotals=true` | **3.06s** |
| +3.5s | `POST leaderboard-decorations` | **1.05s** |
| +3.5s | `POST leaderboard-board/continue` | **4.94s** |
| +9.1s | second non-`q` `GET leaderboard-board` from another/renewed browser session | **5.72s** |
| +40.1s | `GET leaderboard-board ... &q=BA1S5308` | **4.43s** |

Code inspection confirmed the intended display gate remains in place: `scheduleQuery.isLoading` is false once display rows exist, `displayBoardForUi` can use the fresh shell before continue/decorations finish, and row controls are not locked by `isFetching`/append/decorations. The `q=BA1S5308` GET is consistent with the seiban overlay reconcile after `networkBoardComplete`, so it is not expected to block the first shell display.

Follow-up instrumentation: an opt-in Web client perf beacon was added for physical passes.

- Enable on the target browser with `?leaderboardPerf=1` on `/kiosk/production-schedule/leader-order-board` (persists in localStorage). Disable with `?leaderboardPerf=0`.
- API log marker: `[leaderboard-board-client-perf]`.
- Events: `board-get-start`, `board-get-settled`, `first-display-board-rows`, `schedule-usable`, `grid-mounted`, `append-start`, `append-chunk`, `append-complete`, `append-error`, `decorations-start`, `decorations-end`.
- Use this to measure `leaderboard-board` response settled → first display rows → `schedule-usable` → `LeaderBoardGrid` mount on the actual kiosk browser, before doing more DB/API work.

<a id="cursor-handoff-web-display-stability-and-refresh-cadence2026-06-23-current"></a>

### Cursor handoff: Web display stability and refresh cadence（2026-06-23 current）

This is the latest context for PR #464 on branch `feat/production-schedule-split-orders`. The current Pi5 runtime HEAD is **`e98de7ce`**.

**Problem sequence after `bf9dea17`**:

- The API shell itself was already below the 10s target, but the physical screen still felt busy because Web could display stale/partial states during append/labor transitions.
- Pressing a slot `+人` is intentionally not a pure client toggle. It changes `includeLabor=false -> true`, which changes the React Query key and fetches labor metadata. This request must remain so `laborRequiredMinutes` can be populated.
- The unexpected visual regression was different: after a full append had completed, `+人` could temporarily swap the display back from the long appended board to a shorter fresh shell/partial append. To the operator this looked like rows disappearing and reappearing.
- Another UX issue: `+人` labor metadata refresh was counted as `isBoardDataSyncing`, so the page showed 「一覧を更新中です。」 immediately after pressing `+人`. That message is misleading for a display-only labor metadata refresh.

**Fix chain**:

| Commit | Purpose |
| --- | --- |
| `64ece479` | Keep shell rows visible while only `includeLabor` changes. Added display freshness key that ignores `includeLabor`. |
| `2bc28966` | Preserve previous append override through `includeLabor` reload, so completed rows are not lost during the placeholder phase. |
| `1e24fd38` | When the fresh labor append is shorter than the previous completed display append, keep the longer previous append until the new append catches up. |
| `2c33c6c4` | Reduce regular board background refresh from 2 minutes to 5 minutes (`LEADER_BOARD_SCHEDULE_REFETCH_MS=300_000`, staleTime also `300_000`). |
| `e98de7ce` | Hide 「一覧を更新中です。」 for display-only labor refreshes caused by `+人`, while keeping real initial/periodic board sync messages. |

**Deployed state**:

| Commit | Pi5 deploy run | Notes |
| --- | --- | --- |
| `1e24fd38` | `20260623-184617-15143` | Fixed disappearing appended rows during labor refresh. |
| `2c33c6c4` | `20260623-191430-21189` | Slowed regular background board refresh to 5 minutes. |
| `e98de7ce` | `20260623-200308-94` | Suppressed labor-toggle sync banner. Runtime health checked `ok`; API container healthy. |

**Measurements after fixes**:

- Pi5 Web client perf beacon on the real 6-slot resource set `581,305,589,584,588,586` recorded:
  - `board-get-settled elapsedMs=8342`, `rowCount=300`, `hasMoreCount=6`
  - `first-display-board-rows elapsedMs=8344`
  - `schedule-usable elapsedMs=8344`
  - Interpretation: first usable fresh rows are **8.344s**, inside the 10s target.
- Headless Chrome verification after `1e24fd38`:
  - waited until resource `584` had a full/long scrollHeight around `15212`
  - clicked `+人`
  - 12s sample: min target scrollHeight **14400**, `below10000Count=0`
  - Pi5 API logs confirmed an `includeLabor=true` `leaderboard-board` GET occurred.
  - Interpretation: `+人` still refetches labor metadata, but rows no longer collapse to shell height.

**2026-06-24 regression recovery after real-device check**:

- The 2026-06-23 headless check proved the board height no longer collapsed, but it did not prove that the minute label/Gantt bar used the fresh labor values. Real-device verification found that pressing `+人` could still leave `laborRequiredMinutes=0` on displayed rows, so the 8H bar did not stretch.
- Root cause: display freshness intentionally ignored `includeLabor`, and the longer previous append-complete board won display selection during labor refresh. That preserved row count and speed, but it also preserved old machine-only labor metadata.
- Partial fix (`4e3d3926`): after choosing the display board, overlay fresh finite `machineRequiredMinutes` / `laborRequiredMinutes` from `networkDisplayBoard` by `row.id`. This kept the long appended board visible and updated rows already returned by the `includeLabor=true` refresh.
- Remaining gap: the overlay was only based on the current network board. It did not retain labor metadata for the same display scope, so appended rows outside the current shell/partial continue could still show `laborRequiredMinutes=0` and make `+人` appear broken.
- Required fix: retain `includeLabor=true` shell/continue/deltaRows labor metadata by `row.id`, overlay retained metadata onto the selected display board, and prevent `includeLabor=false` machine-only rows from clearing retained labor values.

**2026-06-24 Gantt ruler stretch follow-up（deployed, later rejected）**:

- After the 8H/10H toggle, real-device use found another visual-only gap: `+人` could update logical `requiredMinutes`, but the Gantt vertical ruler still appeared unchanged on large slots because row height and ruler height shared the same compressed scale.
- Incorrect fix: **`f978c15e`** computed `rulerHeightPx` from logical capacity bands (`totalRequiredMinutes / capacityMinutes * availableWorkHeightPx`) and used it in the card scroll height. This proved the label and total-work bar could change, but it broke the intended Gantt contract.
- Required behavior: keep the row/card scale compressed for first-usable performance; use `requiredMinutes` changes from `+人` to move the cumulative 480/600-minute boundary and remainder bands inside the slot body. Do not derive the whole ruler/scroll height from total slot minutes.

**Current intended behavior**:

- Initial page load can show 「読み込み中…」, then fresh shell rows become usable at shell arrival.
- Full append continues in the background; it should not block row operations or keep the global 「一覧を更新中です。」 banner visible once shell rows are displayed.
- Regular board refresh is now **5 minutes**. During real shell refetch with no safe displayed rows, 「一覧を更新中です。」 may still appear; append-only continuation after rows are displayed stays silent.
- Pressing `+人` triggers labor metadata fetch but should **not** show 「一覧を更新中です。」 if existing display rows are present and the only effective display freshness change is `includeLabor`.
- Decorations still use the separate 「詳細情報を更新中です。」 message.

**Follow-up fix after local Playwright pass（2026-06-23 · PR #464 deployed）**:

- Local Playwright against Pi5 production API with the target 6-slot set `581,305,589,584,588,586` recorded `board-get-settled=5.813s`, `first-display-board-rows=5.814s`, and `schedule-usable=5.814s`. The remaining misleading signal was UI-only: `boardDataSyncing=true` during background append kept 「一覧を更新中です。」 visible even though rows were already displayed and row operations were not locked.
- Fix: `isBoardDataSyncStatusVisible` now treats continuation-only sync after display rows exist as silent, while keeping true initial GET loading visible and leaving `isBoardDataSyncing` intact for cache/SWR internals.

**API follow-up: resource-first winner shell（2026-06-23 · PR #464 deployed）**:

- Pre-change investigation on Pi5 showed the real board shell is dominated by per-resource row selection rather than labor/decorations. The target resources have modest candidate sizes (`584` max ~3,495 raw rows), while the materialized winner array contains ~54k ids.
- EXPLAIN comparison on resource `584` indicated the resource-first correlated winner shape can be faster than scanning the full materialized winner membership before resource filtering (approx. 0.66s vs 1.23s in the sampled plan).
- Fix: `leaderboard-board` shell now calls each single-resource `resourceShell` with `leaderboardWinnerBaseStrategy: 'correlated'`. The shared materialized winner path remains in place for summary, continue, totals, decorations, and non-opt-in callers. Perf logs include `winnerBaseStrategy: 'correlated'` on `phase=resourceShell`.
- Local validation: `pnpm --filter @raspi-system/api test -- src/services/production-schedule/__tests__/max-product-no-winner-materialization.test.ts src/services/production-schedule/leaderboard/__tests__/leaderboard-composite-board-generation-token.test.ts` PASS; `pnpm --filter @raspi-system/api lint` PASS; `pnpm --filter @raspi-system/api build` PASS. The broader route integration test filtered by `leaderboard shell` could not run locally because PostgreSQL was not reachable at `localhost:5432`.

**API follow-up: lazy materialized winner for first usable shell（2026-06-23 · PR #464 deployed）**:

- Post-deploy direct API showed resource-first winner helped but did not remove the real shell floor: target 6-slot `pageSize=50&includeLabor=false&includeDecorations=false&deferTotals=true` averaged around `5.5s` curl total / `2.6s` API responseTime, and Pi5 still had `129` persisted process-change residual evidence rows. Because residual evidence was non-empty, shell still resolved the global materialized winner base for `processChangeResidualSummary`, even though resource shell rows themselves were already using correlated winner filtering.
- Fix: `fetchLeaderboardCompositeBoardShell` now lazily resolves `resolveLeaderboardMaterializedBaseWhere()` only when exact totals or labor lookup need it. For `deferTotals=true` shell residual summary, it passes `buildProductionScheduleDashboardBaseWhereWithCorrelatedMaxProductNoWinner(PRODUCTION_SCHEDULE_DASHBOARD_ID)` instead of building the global materialized winner set. If residual evidence keys are empty, it returns the standard zero residual summary without calling the residual summary service. This keeps output semantics while removing global winner materialization from the normal first-usable request shape (`includeLabor=false`, `deferTotals=true`).
- Perf logging: `phase=processChangeResidualSummary` now includes `winnerBaseStrategy: 'correlated'` for deferred shell and `materialized` for exact shell. In the expected first-usable path, no `phase=materializedBaseWhere` event should appear unless `includeLabor=true` or exact totals are requested.
- Local validation: `pnpm --filter @raspi-system/api test -- src/services/production-schedule/leaderboard/__tests__/leaderboard-composite-board-generation-token.test.ts src/services/production-schedule/__tests__/max-product-no-winner-materialization.test.ts` PASS; `pnpm --filter @raspi-system/api lint` PASS; `pnpm --filter @raspi-system/api build` PASS.

**API/Web follow-up: completionFilter pushdown for incomplete default（2026-06-28 · d507780f）**:

- Context: after the shell/defer/labor work above, physical kiosk first-visible performance was still not consistently inside 10s. The important remaining waste was that the leaderboard could fetch completed rows and then let the Web/UI completion view discard them. The kiosk board default is `completionFilter='incomplete'`, so the incomplete filter must be part of the server-side row selection, count/snapshot identity, cache/freshness key, and continue payload.
- Spec: accepted values are `all`, `complete`, and `incomplete`. The SQL source of truth is `production-schedule-effective-completion.sql.ts`; it preserves the existing effective completion semantics and only changes where the filter is applied. `completionFilter=all` keeps the legacy broad behavior. `completionFilter=incomplete` is now pushed into list/count, `leaderboard-board` shell, shell snapshot fingerprint, `leaderboard-board/continue`, and Web fetch params. Continue must echo the same filter as shell, otherwise snapshot totals and row identity can diverge.
- Implementation branch: `perf/kiosk-leaderboard-completion-pushdown`; commit `d507780f9f4f83b3b06d85448826cc34f5789a33` (`perf(kiosk): push down leaderboard completion filter`). Files touched: API shared schema/routes, production schedule query/list count, leaderboard row selection/composite board/continue totals/snapshot fingerprint, Web API client/fetch params/continue payload/page default tests.
- Local validation before deploy: API build/lint PASS, Web build/lint PASS, focused API schema/integration tests PASS, focused Web leaderboard tests PASS, `git diff --check` PASS, commit hook workspace lint PASS. Temporary Docker pgvector/Postgres validation applied 119 migrations, ran targeted integration, verified the normalized index, and showed synthetic EXPLAIN improvement for current-like pushdown rows `625 -> 125` and first 50 incomplete `0 -> 50`; temporary container, volume, and network were removed.
- CI/deploy: GitHub CI run `28320684848` success and CodeQL run `28320684808` success. Manual full-history Secret scan run `28320684799` failed only on older historical findings; scoped gitleaks for `origin/main..HEAD` reported `no leaks found`. Deploy run `20260628-204154-6536` succeeded for Pi5 plus reachable Pi4 clients `raspberrypi4`, `raspi4-robodrill01`, `raspi4-fjv60-80`, and `raspi4-kensaku-stonebase01` (`failed=0`, `unreachable=0`, summary success, exit `0`). `raspi4-sessaku-01` was excluded after the first preflight timed out; later service check showed it active but still on old commit `43d77489`.
- Production measurements after deploy:
  - Pi5 API, `completionFilter=incomplete`, `pageSize=80`, `includeDecorations=false`, `deferTotals=true`: robodrill median `2.253s` for 272 rows, FJV median `2.462s` for 284 rows, stonebase median `4.052s` for 522 rows.
  - Browser Playwright with Pi4-like keys and production page, first visible card bodies: RoboDrill01 `5.999s`, FJV60/80 `5.558s`, kensakuMain `8.401s`. Requests used `pageSize=50`, `completionFilter=incomplete`, `deferTotals=true`, `includeDecorations=false`, and no Mac `targetDeviceScopeKey`.
  - Real Pi4 curl via Pi5 to production API, same page shape: robodrill `3.61s`, FJV `4.20s`, kensaku `4.81s`.
  - User physical-device validation on 2026-06-28: "非常に早くなりました" and accepted continuing further optimization.
- Remaining gap: `+人` is still slow to reflect after pressing. Treat this separately from initial first-visible performance. It intentionally changes `includeLabor=false -> true` and needs a labor metadata fetch; do not remove that refetch. Next investigation should measure `includeLabor=true` shell/continue duration, whether retained labor metadata covers all currently displayed rows, and whether the UI can show immediate local feedback while labor metadata is loading without changing row identity or hiding existing rows.

**API/Web follow-up: labor metadata lightweight overlay for `+人`（2026-06-28/29 · PR #867 verified）**:

- Implementation branch: `perf/kiosk-leaderboard-labor-metadata-overlay`; runtime commit `bcf79b04` (`perf(kiosk): fetch leaderboard labor metadata lazily`); docs/rollout commit `742fafb8`; PR #867.
- Design: keep `leaderboard-board` and `leaderboard-board/continue` requests on `includeLabor=false` for first-use and append stability. `+人` no longer changes the board query key. Instead, Web posts only the currently displayed row ids for resource slots where `+人` is ON to `POST /api/kiosk/production-schedule/leaderboard-board/labor-metadata`.
- API shape: the endpoint accepts DisplayItemId values (`uuid` and `split:{uuid}`) up to the existing display-row scope cap (`8000`) and returns finite `machineRequiredMinutes` / `laborRequiredMinutes` by row id. It reuses `fetchLeaderboardScheduleHydratedRowsOrderedByDisplayItemIds` and `attachLeaderboardLaborMinutes`; no separate labor SQL path or migration is introduced.
- Web behavior: metadata results are stored in the existing retained labor metadata map and overlaid through `mergeLeaderboardBoardLaborMetadataForDisplay`. Existing rows, append-complete rows, scroll state, and row order are preserved. Endpoint failure is non-blocking and must not show 「一覧を更新中です。」.
- Perf diagnostics: client events add `labor-metadata-start`, `labor-metadata-end`, and `labor-metadata-error` with only row/resource counts. Server perf uses `endpoint: "laborMetadata"` with phases `processChangeResidualContext`, `materializedBaseWhere`, `hydrateRows`, `attachLabor`, and `requestTotal` when `LEADERBOARD_BOARD_PERF_LOG=true`.
- Local validation on 2026-06-28: API schema/service focused tests PASS, Web fetch-param/hook focused tests PASS, temporary Docker `pgvector/pgvector:pg15` migration/integration/EXPLAIN PASS. The temporary container, volume, and network were removed. API/Web lint and build PASS.
- CI/deploy: GitHub CI run `28323382336`, CodeQL run `28323382315`, and gitleaks run `28323382321` succeeded. Deploy run `20260628-222904` succeeded for Pi5 and all Pi4 kiosk clients (`raspberrypi4`, `raspi4-robodrill01`, `raspi4-fjv60-80`, `raspi4-kensaku-stonebase01`, `raspi4-sessaku-01`) with `failed=0`, `unreachable=0`, health success, and exit `0`. Post-deploy commit/service check from Pi5 showed all six hosts on `bcf79b04` / branch `perf/kiosk-leaderboard-labor-metadata-overlay`; Pi4 `kiosk-browser.service` and `status-agent.timer` were active.
- Final PR-head verification: after the docs/rollout commit, GitHub CI run `28324698726`, CodeQL run `28324698727`, and gitleaks run `28324698725` all succeeded. Sync deploy `20260628-231744` succeeded for Pi5 plus all five Pi4 kiosk clients with health success. Post-sync check showed all six hosts on `742fafb8`; Pi4 `kiosk-browser.service` and `status-agent.timer` were active.
- Production API verification: for assigned boards, `leaderboard-board` stayed `includeLabor=false` with first row `laborRequiredMinutes=0`, and separate `labor-metadata` POST returned overlay rows. Mac-to-Pi5 checks: kensakuMain `boardRows=300`, metadata `80/80` non-zero, board `4.130s`, metadata `3.728s`; RoboDrill01 `boardRows=239`, metadata `80/80` non-zero, board `3.083s`, metadata `2.534s`; FJV60/80 `boardRows=242`, metadata `79/80` non-zero, board `2.885s`, metadata `3.335s`.
- Real Pi4 verification: Ansible `uri` executed on the physical Pi4 clients for kensakuMain, RoboDrill01, and FJV60/80. Each Pi4 performed `leaderboard-board includeLabor=false -> labor-metadata POST`; all returned HTTP 200, kept first board labor at `0`, sent `80` row ids, and returned `80` metadata rows (`80`, `80`, and `79` non-zero labor rows respectively).
- 2026-06-29 speed comparison: `+人` no longer triggers a board GET, so compare old `includeLabor=true` full-board refetch time against the new metadata POST only. Production samples: kensakuMain old full-board `6.485s` vs metadata `3.484s`; RoboDrill01 `4.907s` vs `2.982s`; FJV60/80 `5.110s` vs `3.411s`. This reduces the labor reflection request by roughly 1.7-3.0s and preserves row/scroll state. A separate kensakuMain machine-only board sample was anomalously slow (`16.805s`) and should not be added to `+人` cost because `+人` no longer refetches the board.
- 2026-06-29 local investigation follow-up, not deployed: branch `chore/leaderboard-labor-metadata-perf-split` adds `laborMetadata` `processChangeResidualContext` subphases (`generationTokenInitial`, `residualMaterialization`, `generationTokenRefresh`) so the remaining `requestTotal` fixed cost can be separated before choosing an optimization. Local validation: focused API/Web tests, API lint/build, temporary Docker `pgvector/pgvector:pg15` migration, labor-metadata integration, and read-only EXPLAIN PASS. The temporary container was removed.

**Relevant files for Cursor**:

- `apps/web/src/features/kiosk/leaderOrderBoard/useCompositeLeaderboardPhasedScheduleWithAutoAppend.tsx`
  - `displayFreshnessParamsKey` ignores `includeLabor`
  - `displayAppendOverrideRef` keeps previous long append display
  - after display selection, retained/fresh labor metadata is overlaid by `row.id`
  - `isBoardDataSyncStatusVisible` separates UI banner visibility from internal `isBoardDataSyncing`
  - continuation-only background sync after shell rows are displayed is silent in the global banner
- `apps/api/src/routes/kiosk/production-schedule/leaderboard-phased-read.ts`
  - registers `POST /kiosk/production-schedule/leaderboard-board/labor-metadata` and routes it through the same client-device/site scope boundary as the board endpoints
- `apps/api/src/services/production-schedule/leaderboard/leaderboard-labor-metadata.service.ts`
  - hydrates only requested display row ids and attaches labor minutes through the existing shared labor service
- `apps/api/src/routes/kiosk/production-schedule/shared.ts`
  - owns the request body schema and DisplayItemId validation for the labor metadata endpoint
- `apps/web/src/api/client.ts`
  - exposes `postKioskProductionScheduleLeaderboardLaborMetadata()` for the lightweight overlay path
- `apps/web/src/features/kiosk/leaderOrderBoard/mergeLeaderboardBoardLaborMetadata.ts`
  - preserves the selected display board shape/row count while refreshing `machineRequiredMinutes` and `laborRequiredMinutes`; retained metadata is preferred over machine-only `includeLabor=false` zeros
- `apps/web/src/features/kiosk/leaderOrderBoard/leaderboardBoardAppendOverrideScopePolicy.ts`
  - `pickLeaderboardAppendOverrideForDisplay()` chooses the longer previous/fresh append during labor refresh
- `apps/web/src/features/kiosk/leaderOrderBoard/leaderboardBoardShellFreshnessPolicy.ts`
  - `buildLeaderboardShellDisplayFreshnessKey()` omits `includeLabor`
- `apps/web/src/features/kiosk/leaderOrderBoard/performance/leaderBoardRefetchPolicy.ts`
  - regular board refresh and staleTime are `300_000`
- `apps/web/src/pages/kiosk/ProductionScheduleLeaderOrderBoardPage.tsx`
  - displays the board sync banner from `isBoardDataSyncStatusVisible`, not raw `isBoardDataSyncing`
- `apps/api/src/services/production-schedule/leaderboard/leaderboard-composite-board.service.ts`
  - board shell resource slots use `leaderboardWinnerBaseStrategy: 'correlated'` for resource-first winner filtering
- `apps/api/src/services/production-schedule/production-schedule-query.service.ts`
  - `listLeaderboardShellProductionScheduleRows` can opt into correlated winner base for exactly one `resourceCd`
- `apps/api/src/services/production-schedule/row-resolver/max-product-no-winner-materialization.ts`
  - keeps both materialized and correlated winner base builders

**Validation already run**:

- `pnpm --filter @raspi-system/web test -- src/features/kiosk/leaderOrderBoard/__tests__/useCompositeLeaderboardPhasedScheduleWithAutoAppend.test.tsx` PASS
- `pnpm --filter @raspi-system/web test -- src/features/kiosk/leaderOrderBoard/__tests__/leaderboardBoardAppendOverrideScopePolicy.test.ts src/features/kiosk/leaderOrderBoard/__tests__/useCompositeLeaderboardPhasedScheduleWithAutoAppend.test.tsx` PASS for the append-display fix
- `pnpm --filter @raspi-system/web test -- src/features/kiosk/leaderOrderBoard/__tests__/useCompositeLeaderboardPhasedScheduleWithAutoAppend.test.tsx src/features/kiosk/leaderOrderBoard/__tests__/leaderboardBoardAppendOverrideScopePolicy.test.ts src/features/kiosk/leaderOrderBoard/__tests__/leaderboardBoardShellFreshnessPolicy.test.ts src/features/kiosk/leaderOrderBoard/__tests__/applyLeaderBoardDisplayRequiredMinutes.test.ts` PASS for the 2026-06-24 labor metadata overlay
- `pnpm --filter @raspi-system/web test -- src/features/kiosk/leaderOrderBoard/__tests__/applyLeaderBoardDisplayRequiredMinutes.test.ts src/features/kiosk/leaderOrderBoard/__tests__/useCompositeLeaderboardPhasedScheduleWithAutoAppend.test.tsx src/features/kiosk/leaderOrderBoard/__tests__/leaderBoardGanttDisplay.test.tsx src/features/kiosk/leaderOrderBoard/__tests__/leaderBoardGanttLayout.test.ts` PASS for the 2026-06-24 `f978c15e` ruler stretch, later superseded because it asserted the rejected total-work ruler-height behavior
- `pnpm --filter @raspi-system/api test -- src/services/production-schedule/__tests__/max-product-no-winner-materialization.test.ts src/services/production-schedule/leaderboard/__tests__/leaderboard-composite-board-generation-token.test.ts` PASS for the resource-first winner shell fix
- `pnpm --filter @raspi-system/api lint` PASS
- `pnpm --filter @raspi-system/api build` PASS
- `pnpm --filter @raspi-system/web lint` PASS
- `pnpm --filter @raspi-system/web build` PASS
- commit hook workspace lint PASS
- Pi5 deploys above completed with Ansible `failed=0`

**Do not regress**:

- Do not remove the `+人` labor metadata fetch; real labor minutes still require a server lookup. The current Web path is the dedicated `labor-metadata` POST, while `includeLabor=true` board/continue remains only as a compatibility path.
- Do not use raw `paramsKey` for display fallback freshness when only `includeLabor` changes.
- Do not let a shorter fresh append override a longer previous display append unless it has caught up.
- Do not keep an old `includeLabor=false` display board without overlaying retained/fresh labor metadata from the current display scope.
- Do not show 「一覧を更新中です。」 for `+人` display-only refresh with existing rows; use `isBoardDataSyncStatusVisible`.
- Do not make every row card taller just to show `+人` labor additions. Keep row/card height compressed, and move the cumulative 8H/10H capacity boundary/remainder bands inside the existing slot body. Do not stretch the whole ruler/scroll height from total slot minutes.

## Local Notes JA

- 初回 COUNT を `deferTotals=true` で避け、continue で exact total に戻す設計は [KB-374](../knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md) の continue 契約と両立。
- `INSTALL_PLAYWRIGHT_CHROMIUM=false` 時は要領書 HTML→PDF 等も影響。health `checks.playwright` で検知可能。
