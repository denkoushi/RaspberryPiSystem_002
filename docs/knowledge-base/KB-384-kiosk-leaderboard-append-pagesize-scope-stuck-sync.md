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
  ci_run: "27401455961 — lint-build-unit, api-db-and-infra, e2e-smoke, security-docker, e2e-tests — all success"
  phase12: "verify-phase12-real.sh PASS 43 / WARN 0 / FAIL 0 (~30s, post Pi5 deploy)"
  production_pi5: "Detach 20260612-164319-19772 — ok=134 changed=4 failed=0"
  field_verification: "Pi4 kiosk force-reload after Pi5 deploy — user confirmed OK"
open_items:
  - "Pi4×4 deploy pending (only Pi5 deployed for verification)"
  - "Initial shell 80 rows + incomplete-only filter empty-slot UX remains a separate issue"
supersedes: null
superseded_by: null
title: KB-384: Kiosk leaderboard append completion stuck on background sync and pageSize scope drift
tags: [kiosk, leaderboard, append, pageSize, background-sync]
audience: [developers, operators]
last-verified: 2026-06-12
category: knowledge-base
---

# KB-384: Kiosk leaderboard append completion stuck on background sync and pageSize scope drift

## Context

On FJV60/80 leader order board (`resourceCds`: `035,060,501,502,021,033`), the UI could remain on **「一覧を更新中です。完了まで操作できません。」** even after `leaderboard-board/continue` had finished. Slots such as **501** and **033** appeared as **empty rows** (0 incomplete items) while the API data was complete.

Investigation used live production API calls: continue completed in **3 rounds** with valid payloads. The defect was **client display policy**, not API paging failure.

## Symptoms Or Trigger

- Overlay **「一覧を更新中です。完了まで操作できません。」** persists after append should be done.
- Resource slots **501 / 033** (and similar) show **empty placeholder rows** instead of incomplete work.
- Rows may **flash back** to the thinner fresh shell after append completion.
- `isBackgroundRevalidating` stays **true** when network board paging is actually complete.

## Investigation

| Step | Evidence | Result |
|------|----------|--------|
| API continue profile | 3× `POST …/leaderboard-board/continue` completes; `hasMore=false` on all resources | API OK |
| Fresh shell vs append override | Fresh shell uses **`pageSize=80`**; post-append override path uses **`pageSize=160`** | Different paging metadata on same `resourceCd:total` |
| Scope fingerprint | `fingerprintLeaderboardBoardResourcePagingScope` was `resourceCd:total:pageSize` | Same totals treated as **different scopes** |
| Display pick | `pickLeaderboardBoardForDisplay` requires matching `fingerprintLeaderboardBoardShellScope` | Completed **appendOverride rejected** → display reverts to fresh shell |
| Paging complete | `resolveNetworkLeaderboardBoardPagingComplete` depends on adopted display board | Returns **false** → background sync never clears |
| Append gate | `shouldBeginLeaderboardAppendSession` `overrideAhead` stop | Could block re-continue when shell fingerprint changed but override still ahead |

**Related prior fix** (`71ac906c`): preserve board metadata on IDB cache patch so append state is not dropped on terminal-cache writes.

## Root Cause

1. **pageSize in resource paging scope** — append completion and fresh shell refetch used different `pageSize` values while `resourceCd` and `total` matched. Scope mismatch prevented adopting the completed append board for display and paging-complete detection.
2. **Background sync latch** — with paging-incomplete signal stuck, `isBackgroundRevalidating` remained true and the blocking overlay stayed visible.
3. **Append session gate** — `overrideAhead` early-exit applied even when shell fingerprint had changed (fresh refetch), which could suppress legitimate re-append on a new shell generation.

## Fix

**Branch**: `fix/kiosk-leaderboard-process-residual-filter`

| Commit | Change |
|--------|--------|
| `71ac906c` | Preserve leaderboard board metadata on terminal-cache patch |
| `66b71fdf` | Clear background revalidation after append completion |
| `0eed9b8f` | Drop `pageSize` from resource paging scope fingerprint (`resourceCd:total` only); limit `overrideAhead` stop to **same** `lastStartedShellFingerprint === shellFingerprint` |

**Files**:

- `leaderboardBoardDisplayPolicy.ts` — scope fingerprint excludes `pageSize`
- `leaderboardBoardAppendSessionPolicy.ts` — `overrideAhead` gate scoped to unchanged shell fingerprint
- Regression tests in `leaderboardBoardDisplayPolicy.test.ts`, `leaderboardBoardAppendSessionPolicy.test.ts`, `useCompositeLeaderboardPhasedScheduleWithAutoAppend.test.tsx`

**Out of scope (separate issue)**: empty-slot UX when the **initial 80-row shell** plus **incomplete-only filter** hides rows before append fills the board. This fix addresses **post-append rollback and stuck sync**, not first-paint density.

## Prevention

- Resource paging **scope keys must not include volatile request parameters** (`pageSize`) when totals and resource codes are the completion signal.
- Tests must cover **fresh shell pageSize drift after append complete** (`isBackgroundRevalidating → false`, display keeps append rows).
- When changing shell/append fingerprint rules, run the three leaderboard policy test files together.

## Validation

### Local

```bash
pnpm --filter @raspi-system/web test -- leaderboardBoardDisplayPolicy leaderboardBoardAppendSessionPolicy useCompositeLeaderboardPhasedScheduleWithAutoAppend
# 37 passed
```

### CI

- Run `27401455961` on `0eed9b8f`: all jobs success.

### Production (Pi5 only)

```bash
export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"
./scripts/update-all-clients.sh fix/kiosk-leaderboard-process-residual-filter \
  infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow
```

- Detach **`20260612-164319-19772`**
- Git **`66b71fdf` → `0eed9b8f`** (fast-forward)
- PLAY RECAP: **ok=134 / changed=4 / failed=0**
- Docker rebuild/restart: **ok**

### Field verification

- `./scripts/deploy/verify-phase12-real.sh` → **43/0/0**
- Pi4 kiosk: **force reload** (verification-checklist §6.6.4), open leader order board, wait for append — **user confirmed fixed** (overlay clears; 501/033 rows visible).

## Troubleshooting

| Symptom | Likely cause | Action |
|---------|--------------|--------|
| Overlay stuck after deploy | Old web bundle on kiosk | Pi5 ref check; Pi4 **force reload** |
| Empty 501/033 slots with overlay | Pre-fix scope drift | Confirm Pi5 `web` at `0eed9b8f` or later on `main` after merge |
| Append never restarts | Terminal append-complete latch for unchanged shell | Expected; change filters/params or wait for shell fingerprint change |

## Open Items

1. **Pi4×4 deploy** — after merge to `main`, run standard `./scripts/update-all-clients.sh main …` per host (`raspberrypi4`, `raspi4-robodrill01`, `raspi4-fjv60-80`, `raspi4-kensaku-stonebase01`). Pi5 already carries the web image; Pi4 still needs kiosk reload / client sync per [deployment.md](../guides/deployment.md).
2. **First-paint empty slots** — track separately if product wants denser initial shell before append (not part of KB-384 fix).

## Local Notes JA

- 現場メッセージ: **「一覧を更新中です。完了まで操作できません。」**
- 対象資源例: **501 / 033**（FJV60/80 セット）
- 実機検証は Pi5 デプロイ後に **Pi4 キオスク強制リロード** で実施

## References

- [KB-374](./KB-374-leaderboard-board-continue-cursor-contract.md) — continue contract, pageSize 80/160 history
- [verification-checklist.md §6.6.18](../guides/verification-checklist.md) — leader order board regression checklist
- PR: _(to be filled after merge)_
