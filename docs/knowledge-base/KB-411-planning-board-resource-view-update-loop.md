---
id: KB-411
title: Kiosk planning board (製番ボード) resource view crashed with a React update loop on 切削
status: active
scope: kiosk 製番ボード resource (資源CD) view (Web)
date: 2026-10-01
source_of_truth: false
related_code:
  - apps/web/src/features/kiosk/grindingPlanningBoard/PlanningBoardResourceView.tsx
  - apps/web/src/components/AppErrorBoundary.tsx
validation:
  - apps/web/src/features/kiosk/grindingPlanningBoard/PlanningBoardResourceView.test.tsx
open_items:
  - Confirm on a real kiosk after deploy that 資源CD + 切削 opens.
  - AppErrorBoundary does not record the error anywhere; the cause was only visible in the browser console.
---

# KB-411: Planning board resource view update loop

## Context

2026-10-01. On the kiosk 製番ボード, choosing 資源CD and then switching 研削 → 切削 replaced the screen with 「画面を表示できませんでした」 (`AppErrorBoundary`). It happened on the Pi4 kiosk (stonebase) and on a Mac browser alike, so it was not a resource shortage.

## Symptoms Or Trigger

- Browser console: `Minified React error #185` (Maximum update depth exceeded).
- The app frame in the stack was `setBottomSpace(...)` inside the second `useLayoutEffect` of `PlanningBoardResourceView`. This was matched by building the same bundle locally with source maps (the vendor chunk hash was identical).
- 「画面を再読み込み」 always returned to 研削 / 製番 because the category and view are plain component state. That part is expected behavior, and it made the failure repeat every time.

## Investigation

- Hypothesis: bad 切削 data (special due expiry, resource name map shape). Result: rejected, the API guards both.
- Hypothesis: the category switch itself breaks the remounted view. Result: rejected, a jsdom test with the real progressive hook passed.
- Reproduced in a real browser with a local mock API (切削: 40 resources, 600 items, 4 pages) and the dev server. A temporary log showed that during the loop only the identity of `heights` changed. Its values were equal and the measure function was not called.

## Root Cause

Two layout effects cooperate: the first measures row heights and stores `heights` with a functional `setHeights`; the second recomputes `bottomSpace` and listed the `heights` object as a dependency.

When a low-priority `setHeights` (from the `ResizeObserver` or `resize` callback) is still queued and a synchronous render also enqueues a `setHeights`, React skips the low-priority update and re-runs the later updater on every synchronous render. That updater returns a new object each time, so `heights` changes identity without changing value. The second effect then re-ran, called `setBottomSpace` in the layout phase, forced another synchronous render, and repeated until React stopped at 50 nested updates.

研削 did not trigger it because the measured heights equalled the previous values, so the updater returned the current object. 切削 rows measure differently and load in several pages over many tables, so remeasures overlap. The failure is timing dependent.

## Fix

The second effect depends on `heights.normal` and `heights.expanded` (numbers) instead of the `heights` object.

## Prevention

- Regression test `監視からの再計測が未反映のまま同期の再描画が来ても更新ループにならない` queues a remeasure from the observer callback and then forces a synchronous rerender. It fails with the same error without the fix.
- Rule of thumb: an effect that calls `setState` should depend on primitive values, not on a state object produced by a functional updater.
- jsdom has no layout, so measurement-driven effects need a real browser (or a priority race written out as above) to be exercised.

## Validation

- `pnpm exec vitest run src/features/kiosk/grindingPlanningBoard src/pages/kiosk/ProductionScheduleGrindingPlanningBoardPage.test.tsx`: 81 passed.
- `pnpm exec tsc -b` and eslint on the changed files: no errors.
- Real browser with the mock API: with the dependency change applied, 40 panes and 600 rows rendered without the error (one run, during investigation).

## Open Items

See `open_items` above.
