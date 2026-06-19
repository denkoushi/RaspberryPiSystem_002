---
id: leaderboard-defer-totals-performance-recovery
status: pi5_deployed_pi4_pending
scope: kiosk leader order board first-paint latency and sync UX (Web + API deploy)
date: 2026-06-17
source_of_truth: true
related_code:
  - apps/web/src/features/kiosk/leaderOrderBoard/cache/leaderboardBoardFetchParams.ts
  - apps/web/src/features/kiosk/leaderOrderBoard/cache/leaderboardBoardInteractionLockPolicy.ts
  - apps/web/src/features/kiosk/leaderOrderBoard/useCompositeLeaderboardPhasedScheduleWithAutoAppend.tsx
  - apps/web/src/features/kiosk/leaderOrderBoard/useLeaderboardSeibanOrClientFilterOverlay.ts
  - apps/api/src/routes/kiosk/production-schedule/shared.ts
  - apps/api/src/services/signage/loan-grid/playwright/playwright-chromium-availability.ts
  - infrastructure/docker/Dockerfile.api
related_docs:
  - docs/knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md
  - docs/knowledge-base/KB-384-kiosk-leaderboard-append-pagesize-scope-stuck-sync.md
  - docs/guides/deployment.md
validation: web/api unit tests PASS · CI 27618320442 success · Pi5 deploy 20260616-221700-6889 · verify-phase12-real PASS 43/0/0
open_items:
  - Pi5 manual kiosk verification (leaderboard first paint, seiban reconcile, sync messages)
  - Pi4×4 deploy after Pi5 sign-off
  - Phase 2 API shell/COUNT bottleneck optimization (out of phase-1 scope)
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
- counts and flags: `resourceCd`, `resourceCount`, `rowCount`, `deltaRowCount`, `hasMore`, `hasMoreCount`, `total`, `snapshotExpired`, `includeDecorations`, `chunkSize`, `deferredTotals`

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

## Local Notes JA

- 初回 COUNT を `deferTotals=true` で避け、continue で exact total に戻す設計は [KB-374](../knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md) の continue 契約と両立。
- `INSTALL_PLAYWRIGHT_CHROMIUM=false` 時は要領書 HTML→PDF 等も影響。health `checks.playwright` で検知可能。
