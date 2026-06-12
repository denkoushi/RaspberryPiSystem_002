---
id: KB-384
status: active
scope: kiosk-leaderboard-display-append-background-sync
date: 2026-06-12
source_of_truth: docs/knowledge-base/KB-384-kiosk-leaderboard-append-pagesize-scope-stuck-sync.md
related_code:
  - apps/web/src/features/kiosk/leaderOrderBoard/leaderboardBoardDisplayPolicy.ts
  - apps/web/src/features/kiosk/leaderOrderBoard/leaderboardBoardAppendSessionPolicy.ts
  - apps/web/src/features/kiosk/leaderOrderBoard/useLeaderboardBoardTerminalCache.ts
related_docs:
  - docs/knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md
  - docs/guides/verification-checklist.md
validation:
  local_tests: "37 passed (display policy / append session / hook)"
  ci_run: "27401455961 — all jobs success (branch head 0eed9b8f)"
  phase12_pi5: "verify-phase12-real.sh PASS 43/0/0 (~30s, post Pi5 deploy)"
  phase12_all: "verify-phase12-real.sh PASS 43/0/0 (~57s, post Pi4×4 deploy)"
  production_pi5: "Detach 20260612-164319-19772 — ok=134 changed=4 failed=0"
  production_pi4: "4 hosts sequential main deploy 2026-06-12 — all failed=0"
  field_verification: "Pi4 kiosk — user confirmed item display normalized after deploy"
open_items:
  - "Initial shell 80 rows + incomplete-only filter empty-slot UX (first-paint; separate issue)"
supersedes: null
superseded_by: null
title: KB-384: Kiosk leaderboard append completion stuck on background sync and pageSize scope drift
tags: [kiosk, leaderboard, append, pageSize, background-sync, process-residual]
audience: [developers, operators]
last-verified: 2026-06-12
category: knowledge-base
---

# KB-384: Kiosk leaderboard append completion stuck on background sync and pageSize scope drift

## Context

FJV60/80 leader order board (`resourceCds`: `035,060,501,502,021,033`) showed **「一覧を更新中です。完了まで操作できません。」** after append should finish, and slots **501 / 033** looked empty while API/DB still had incomplete rows.

- **When**: anomaly surfaced after a long review cycle (**2026-06-11 → 2026-06-12**); fixed afternoon **2026-06-12** via `pageSize` scope drift fix + append session gate tightening.
- **API**: live production calls showed `leaderboard-board/continue` completing in **3 rounds** with valid payloads — **not** an API paging failure.
- **Merged fix**: PR [#431](https://github.com/denkoushi/RaspberryPiSystem_002/pull/431) squash `f3359a4d` on `main` (includes process-change residual filter + display stability).

## Symptoms Or Trigger

- Overlay **「一覧を更新中です。完了まで操作できません。」** persists after append completes.
- Resource slots **501 / 033** show **empty rows** (0 incomplete items) despite data existing post-append.
- Rows may **revert** to the thinner fresh shell after append completion.
- `isBackgroundRevalidating` stays **true** when network paging is actually complete.

### Representative counts (FJV60/80)

| resourceCd | initial shell incomplete | after append complete incomplete |
|------------|-------------------------:|---------------------------------:|
| 501 | 0 | 54 |
| 033 | 0 | 39 |

Initial shell `pageSize=80` had **no incomplete rows** in range → default incomplete-only filter showed **0 items**. After continue, incomplete rows existed but display rolled back to fresh shell.

## Root Cause

### Design rule violated

`pageSize` is a **fetch chunk size**, not part of the **logical display scope**. Initial GET and continue-complete boards may legitimately differ in `pageSize` (80 vs 160). Scope fingerprints must use stable identity (`resourceCd`, `total`), not transport parameters.

Pre-fix fingerprint:

```ts
`${resourceCd}:${total}:${pageSize}`  // wrong: pageSize is not logical scope
```

Post-fix:

```ts
`${resourceCd}:${total}`  // total change = different data range; keep total
```

### Failure chain

1. Initial `GET …/leaderboard-board` returns shell with `pageSize=80`, some `hasMore=true`.
2. `POST …/leaderboard-board/continue` completes; `appendOverride` has `hasMore=false`.
3. Continue-complete board uses `pageSize=160` on `resources[]`.
4. Same `resourceCd` + `total`, different `pageSize` → **resource scope mismatch**.
5. `pickLeaderboardBoardForDisplay` rejects completed `appendOverride`.
6. `resolveNetworkLeaderboardBoardPagingComplete` cannot treat override as complete.
7. `networkBoardComplete=false` persists.
8. `isBackgroundRevalidating=true` → blocking overlay remains.
9. Display falls back to fresh shell → **501/033 show 0 incomplete** under default filter.
10. Auxiliary: `shouldBeginLeaderboardAppendSession` `overrideAhead` could block re-continue even when shell fingerprint changed to a fresh shell.

**Related prior fix** (`71ac906c`): preserve board metadata on IDB cache patch.

**Residual drift (separate scope)**: `processChangeResidualTotal` / `processChangeResidualRows` / evidence changes still invalidate `appendOverride` — intentional; not part of this `pageSize` bug.

## Fix

| Commit | Change |
|--------|--------|
| `71ac906c` | Preserve leaderboard board metadata on terminal-cache patch |
| `66b71fdf` | Clear background revalidation after append completion |
| `0eed9b8f` | Drop `pageSize` from resource paging scope; scope `overrideAhead` to same shell fingerprint only |

**Files**:

- `leaderboardBoardDisplayPolicy.ts` — `fingerprintLeaderboardBoardResourcePagingScope` uses `resourceCd:total` only
- `leaderboardBoardAppendSessionPolicy.ts` — `overrideAhead` stop only when `lastStartedShellFingerprint === shellFingerprint`
- Tests: `leaderboardBoardDisplayPolicy.test.ts`, `leaderboardBoardAppendSessionPolicy.test.ts`, `useCompositeLeaderboardPhasedScheduleWithAutoAppend.test.tsx`

### Test assertions (regression lock)

- `pageSize`-only drift: appendOverride treated as **same scope** for display and paging-complete.
- Fresh shell fingerprint change: re-append allowed even if old override has more rows than shell.
- Resource with **0 incomplete on initial shell** but **rows after append** (501/033 pattern): display keeps append rows; `isBackgroundRevalidating → false`.

**Out of scope**: first-paint empty slots when initial 80-row shell has 0 incomplete before append — separate UX issue.

## Prevention

### Code rules

- Do **not** put `pageSize`, `cursor`, or `snapshotId` into **display logical scope** keys.
- `pickLeaderboardBoardForDisplay` and `resolveNetworkLeaderboardBoardPagingComplete` must share the same scope assumptions.
- When reviewing leaderboard display changes, decompose what keeps `networkBoardComplete=false` and thus `isBackgroundRevalidating=true`.

### Review checklist

- Compare initial shell vs continue-complete `resources[]`: `resourceCd`, `total`, `pageSize`, `hasMore`, `nextCursor`, `snapshotId`.
- Confirm fetch-control fields are not mixed into display scope.
- Confirm stale `appendOverride` does not block fresh-shell re-continue.
- Include a test case: initial incomplete **0**, post-append incomplete **>0** for a resource slot.

## Validation

### Local

```bash
pnpm --filter @raspi-system/web test -- leaderboardBoardDisplayPolicy leaderboardBoardAppendSessionPolicy useCompositeLeaderboardPhasedScheduleWithAutoAppend
# 37 passed
```

### CI

- Run `27401455961` (branch `0eed9b8f`): lint-build-unit, api-db-and-infra, e2e-smoke, security-docker, e2e-tests — all success.

### Production

**Pi5** (`main` after merge — first verification deploy used feature branch):

```bash
export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"
./scripts/update-all-clients.sh fix/kiosk-leaderboard-process-residual-filter \
  infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow
```

| Host | Detach Run ID | PLAY RECAP |
|------|---------------|------------|
| `raspberrypi5` | `20260612-164319-19772` | ok=134 / changed=4 / **failed=0** |

Git on Pi5: `66b71fdf` → `0eed9b8f` (pre-merge verification). Docker rebuild/restart: ok.

**Pi4×4** (sequential `main` deploy, 2026-06-12):

```bash
for host in raspberrypi4 raspi4-robodrill01 raspi4-fjv60-80 raspi4-kensaku-stonebase01; do
  ./scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --limit "$host" --detach --follow
done
```

| Host | Detach Run ID | PLAY RECAP |
|------|---------------|------------|
| `raspberrypi4` | `20260612-180451-30659` | ok=122 / changed=10 / **failed=0** |
| `raspi4-robodrill01` | `20260612-180944-11816` | ok=122 / changed=9 / **failed=0** |
| `raspi4-fjv60-80` | `20260612-181325-12902` | ok=122 / changed=9 / **failed=0** |
| `raspi4-kensaku-stonebase01` | `20260612-181714-19251` | ok=129 / changed=11 / **failed=0** |

All runs: `summary success: true`, remote `exit 0`. Pi5 play skipped (already on `main`).

### Phase12

- Post Pi5: **PASS 43 / WARN 0 / FAIL 0** (~30s)
- Post Pi4×4: **PASS 43 / WARN 0 / FAIL 0** (~57s); Pi4 kiosk/status-agent all PASS

### Field verification (user confirmed)

After deploy + kiosk **force reload** (verification-checklist §6.6.4):

- [x] Overlay clears after append completes
- [x] **501 / 033** show incomplete items (not empty slots)
- [x] Display does not revert to empty after fresh shell refetch
- [x] `leaderboard-board/continue` completes normally
- [x] Rank change, completion, notes, auto-rank behave as before

## Troubleshooting

| Symptom | Likely cause | Action |
|---------|--------------|--------|
| Overlay stuck after deploy | Old SPA bundle | Confirm `main` ≥ `f3359a4d`; **force reload** on Pi4 |
| Empty 501/033 with overlay | Pre-fix `pageSize` in scope fingerprint | Verify Pi5 `web` image; reload kiosk |
| Append never restarts on unchanged shell | Append-complete latch | Expected; change filters/params or wait for shell fingerprint change |

## Open Items

1. **First-paint empty slots** — initial 80-row shell + incomplete-only filter can show 0 items before append; not fixed by KB-384 (post-append rollback only).

## Local Notes JA

- 現場メッセージ: **「一覧を更新中です。完了まで操作できません。」**
- 長時間レビュー（2026-06-11〜12）後のデプロイで顕在化、2026-06-12 午後の修正で解消
- `pageSize` は取得単位。resource paging scope には含めない

## References

- [KB-374](./KB-374-leaderboard-board-continue-cursor-contract.md) — continue contract, pageSize 80/160 history
- [verification-checklist.md §6.6.18](../guides/verification-checklist.md) — leader order board regression
- PR [#431](https://github.com/denkoushi/RaspberryPiSystem_002/pull/431) — squash `f3359a4d`
- Docs link commit: `9ea595db`
