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

## Local Notes JA

- 初回 COUNT を `deferTotals=true` で避け、continue で exact total に戻す設計は [KB-374](../knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md) の continue 契約と両立。
- `INSTALL_PLAYWRIGHT_CHROMIUM=false` 時は要領書 HTML→PDF 等も影響。health `checks.playwright` で検知可能。
