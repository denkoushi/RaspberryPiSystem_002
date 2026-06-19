---
id: leaderboard-defer-totals-performance-recovery
status: pi5_residual_context_measurement_deployed
scope: kiosk leader order board API performance (residual context subphase telemetry)
date: 2026-06-19
source_of_truth: true
related_code:
  - apps/api/src/services/production-schedule/leaderboard/leaderboard-composite-board.service.ts
  - apps/api/src/services/production-schedule/leaderboard/leaderboard-process-change-residual.materialization.ts
  - apps/api/src/services/production-schedule/leaderboard/leaderboard-composite-board-prefix-row-cache.ts
  - apps/api/src/routes/kiosk/production-schedule/leaderboard-phased-read.ts
  - apps/web/src/features/kiosk/leaderOrderBoard/cache/leaderboardBoardFetchParams.ts
  - apps/web/src/features/kiosk/leaderOrderBoard/useCompositeLeaderboardPhasedScheduleWithAutoAppend.tsx
related_docs:
  - docs/knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md
  - docs/knowledge-base/KB-384-kiosk-leaderboard-append-pagesize-scope-stuck-sync.md
  - docs/guides/deployment.md
validation: focused api tests 20 PASS · CI 27800293596 success · Pi5 deploy 20260619-113535-25865 · verify-phase12-real PASS 43/0/0 · stonebase shell/continue contract preserved · subphase perf log verified (temporary flag)
open_items:
  - Reduce `processChangeResidualContext` cost using subphase timings (DB fetch dominates cold shell on stonebase)
  - Re-enable `LEADERBOARD_BOARD_PERF_LOG=true` on Pi5 only when collecting another timed stonebase session (manual `.env`; lost on standard deploy)
  - Pi4 Web rollout for deferTotals UX (phase 1 Web) remains separate; API-only fix needs no Pi4 deploy
  - Evaluate client continue chunk default (160) after sustained Pi5 observation
---

# Plan: Leaderboard deferTotals Performance Recovery

## Goal

Reduce kiosk leader order board **perceived latency** and **over-broad “updating” UI** without breaking existing board/continue/decorations contracts.

**Phase 1 (this branch)**: Web low-risk fixes + minimal API/deploy hardening. **Does not** directly optimize 10s-class API shell work (phase 2).

## Current branch and HEAD

- **Branch**: `feat/leaderboard-defer-totals`
- **Tip**: `14bb6e96` — fix(deploy): run playwright install from api workspace
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

## Local Notes JA

- 初回 COUNT を `deferTotals=true` で避け、continue で exact total に戻す設計は [KB-374](../knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md) の continue 契約と両立。
- `INSTALL_PLAYWRIGHT_CHROMIUM=false` 時は要領書 HTML→PDF 等も影響。health `checks.playwright` で検知可能。
