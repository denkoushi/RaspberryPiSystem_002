# KB-392: Kiosk leaderboard spec source of truth and doc drift prevention

## Metadata

| Field | Value |
|-------|-------|
| id | KB-392 |
| status | active |
| scope | Kiosk leader order board (`/kiosk/production-schedule/leader-order-board`) |
| date | 2026-06-24 |
| source_of_truth | this file for current-vs-historical reading rules |
| related_code | `ProductionScheduleLeaderOrderBoardPage.tsx`, `leaderOrderBoard/constants.ts`, `leaderBoardRefetchPolicy.ts`, `leaderboard-phased-read.ts`, `shared.ts`, `leaderboard-composite-board.service.ts` |
| related_docs | [labor toggle plan](../plans/kiosk-leaderboard-labor-minutes-toggle.md), [Gantt plan](../plans/kiosk-leaderboard-gantt-mode.md), [ADR-20260508](../decisions/ADR-20260508-leaderboard-board-aggregate-api.md), [split orders plan](../plans/production-schedule-split-orders.md), [KB-390](./KB-390-kiosk-leaderboard-inspection-workflow.md) |

## Context

Kiosk leaderboard refactors have regressed when older deployment notes, plans, and KB history were read as the current contract. The most visible case was commit `f978c15e`: CI, deploy, and Phase12 passed, but the Gantt ruler behavior was later rejected because it stretched the ruler by total work instead of showing cumulative 8H/10H capacity boundaries inside the card body.

This KB is the compact source for how to read the current leaderboard specification. It does not replace the detailed feature plans or ADRs; it points to them and marks which recurring terms are historical.

## Current Contract

| Area | Current contract | Primary source |
|------|------------------|----------------|
| Board API path | Multi-slot kiosk board uses aggregate `leaderboard-board` / `leaderboard-board/continue`; browser-side per-resource fan-out is not the main path. | [ADR-20260508](../decisions/ADR-20260508-leaderboard-board-aggregate-api.md), [`leaderboard-phased-read.ts`](../../apps/api/src/routes/kiosk/production-schedule/leaderboard-phased-read.ts) |
| Initial shell size | Web sends `LEADER_ORDER_BOARD_SHELL_INITIAL_PAGE_SIZE = 50` per slot. | [`constants.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/constants.ts) |
| Continue chunk | Web sends `LEADER_ORDER_BOARD_CONTINUE_CHUNK_SIZE = 160`; API caps board shell/continue at 160. | [`constants.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/constants.ts), [`shared.ts`](../../apps/api/src/routes/kiosk/production-schedule/shared.ts) |
| Regular freshness | Normal board refetch/stale time is `300_000` ms. IDB max age follows the same constant. | [`leaderBoardRefetchPolicy.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/performance/leaderBoardRefetchPolicy.ts), [`leaderboardBoardCacheConstants.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/cache/leaderboardBoardCacheConstants.ts) |
| `includeLabor` | API default is false for first usable speed. Web sends true only when any slot `+人` toggle is ON. | [`shared.ts`](../../apps/api/src/routes/kiosk/production-schedule/shared.ts), [`ProductionScheduleLeaderOrderBoardPage.tsx`](../../apps/web/src/pages/kiosk/ProductionScheduleLeaderOrderBoardPage.tsx) |
| `+人` | OFF displays machine minutes. ON displays `machineRequiredMinutes + laborRequiredMinutes`; labor metadata is retained by row id within the same display scope and is not erased by machine-only responses. | [labor toggle plan](../plans/kiosk-leaderboard-labor-minutes-toggle.md), [`mergeLeaderboardBoardLaborMetadata.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/mergeLeaderboardBoardLaborMetadata.ts) |
| FSIGENCD=10 | Labor rows are not shown as resource slots. Labor lookup is derived from visible machine rows and summed onto those rows. | [labor toggle plan](../plans/kiosk-leaderboard-labor-minutes-toggle.md) |
| 8H/10H | Per-slot, terminal-local toggle; 8H is 480 minutes, 10H is 600 minutes. Button is immediately left of `+人`. | [Gantt plan](../plans/kiosk-leaderboard-gantt-mode.md), [`usePersistedLeaderBoardCapacityMode.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/usePersistedLeaderBoardCapacityMode.ts) |
| Gantt ruler | Uses cumulative row work mapped into the card body. Do not compute `rulerHeightPx` from total work divided by capacity. | [Gantt plan](../plans/kiosk-leaderboard-gantt-mode.md), [`leaderBoardGanttLayout.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/gantt/leaderBoardGanttLayout.ts) |
| Split orders | Split UI is enabled only when Web build flag, API deployment flag, and runtime pilot gate are all effective. Badge labels include `分割 Web OFF`, `分割 API OFF`, `分割 検証OFF`, and `分割 検証ON`. | [split orders plan](../plans/production-schedule-split-orders.md), [`ProductionScheduleLeaderOrderBoardPage.tsx`](../../apps/web/src/pages/kiosk/ProductionScheduleLeaderOrderBoardPage.tsx) |
| Inspection workflow | Row button `検` opens the chooser `検査方法を選択`; choices are `デジタル入力` and `帳票紙印刷`, with `plannedQuantity` passed to print URLs when valid. | [KB-390](./KB-390-kiosk-leaderboard-inspection-workflow.md) |

## Historical Terms To Treat Carefully

| Term | How to read it now |
|------|--------------------|
| `120秒` / `120s` | Historical terminal-cache cadence from 2026-05-19/20. Current regular board freshness is 300 seconds. Some old docs and one code comment still say 120秒; use the current constants above. |
| `pageSize 80` / `初回 shell 80` | Historical shell size. Current initial shell is 50; continue remains 160. |
| `f978c15e` | Deployed but rejected visual contract for Gantt total-work ruler stretch. Final accepted recovery is `a882ac81` + `cca420ac` + `5171e44e`. |
| `カード単位 phased fetch` | Historical 2026-05-07 behavior. After ADR-20260508, aggregate `leaderboard-board` is the main multi-slot path. |
| `rulerHeightPx = totalRequiredMinutes / capacityMinutes * availableWorkHeightPx` | Rejected. It turns the Gantt ruler into a total-work-height bar and can reintroduce layout regressions. |

## Known Documentation Drift

- [`leaderboardBoardCacheSyncPolicy.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/cache/leaderboardBoardCacheSyncPolicy.ts) still has a comment that says "120秒ポーリング". The implementation reads current constants elsewhere; treat the comment as stale until a code-comment cleanup is explicitly requested.
- `deployment.md`, `verification-checklist.md`, ADR-20260519, ADR-20260520, KB-374, KB-375, and KB-297 contain historical sections that remain useful as incident/deploy records. They are not current spec unless they link back here or to the current plans listed above.

## Prevention Checklist

Before changing leaderboard behavior or refactoring the board:

1. Compare the intended change against the "Current Contract" table in this KB.
2. Verify constants in `constants.ts` and `leaderBoardRefetchPolicy.ts` instead of copying older values from history sections.
3. For `+人` / Gantt work, run or update focused tests around `useCompositeLeaderboardPhasedScheduleWithAutoAppend`, `applyLeaderBoardDisplayRequiredMinutes`, and `leaderBoardGantt*`.
4. For continue/cursor work, verify `shared.ts`, `buildLeaderboardBoardContinuePayload.ts`, and KB-374 together.
5. Do not treat passing CI, deploy, or Phase12 alone as proof of the visual contract. The `f978c15e` regression passed those gates.

## Validation

This KB was created from a read-only comparison of current implementation, tests, and documentation on `main` at `e0b8175d` / PR #464 merge state. No application code behavior was changed.

2026-06-24 follow-up: the stale `120秒ポーリング` code comment was corrected to the current 300-second refetch wording. `./scripts/deploy/verify-phase12-real.sh` passed with **43 PASS / 0 WARN / 0 FAIL**; this proves automated device/API/service health, not visual sign-off.

## Open Items

- Optional visual sign-off remains manual/VNC work: confirm on each Pi4 kiosk that `+人`, 8H/10H bands, sync overlay, split status badge, and `検` workflow match the accepted contract. Use the labor toggle plan for the validation checklist.

## References

- [KB-369: leaderboard API latency](./KB-369-leader-order-board-api-internal-latency.md)
- [KB-374: leaderboard-board/continue cursor contract](./KB-374-leaderboard-board-continue-cursor-contract.md)
- [KB-375: leaderboard completion integrity](./KB-375-kiosk-leaderboard-completion-integrity.md)
- [KB-390: inspection workflow](./KB-390-kiosk-leaderboard-inspection-workflow.md)
