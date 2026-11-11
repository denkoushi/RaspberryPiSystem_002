# Planning board auto-order

## Purpose
In 今日から / 資源CD, share operation pins and preview, apply or cancel proposed lane orders; retain the independent ⇅ 納期順 action.

## Algorithm
1. Sort incomplete work with the existing resource comparator and build predecessor links.
2. Reserve pinned indices; while unpinned special-due work remains, offer only its first item in comparator order.
3. Select ready candidates by earliest working start, then due date and current order; reuse working-window placement.
4. If pins or precedence block progress, fill remaining slots in current order while preserving pins.
5. Compare lateness/wait, save changed lanes and record undo; normal display retains special-due priority over saved ranks.

## API Shape
`PUT /kiosk/production-schedule/grinding-planning-board/pins`: `{ sourceRevision, items: [{ itemId, itemRevision, overrideVersion? }], pinned }` → `{ sourceRevision, items }`.
Projected items include optional `orderPinned`; apply/undo reuse the existing bulk-order endpoint (maximum 500 items per lane).
Explicit pins above special-due work retain their slots in a proposal, but cannot round-trip through the normal saved-rank sorter.

## Verification Summary
Follow-up validation: package build, requested web Vitest (57 files / 646 tests), TypeScript and ESLint all passed; validation took about 2 minutes.
Regression coverage includes special-due rank round-trips with pins/predecessors, preview/apply/remount, independent due-sort and undo.
Earlier API route/service/projection tests passed 94 tests; API typecheck had existing rootDir/unrelated diagnostics and is outside this follow-up.
Local changes only; no commit, push, merge, deployment or migration execution.

## Unit-piece order preview (2026-11-11)

- A selected one/two-machine resource view with incomplete unit pieces offers `まとめる`, `順に回す`, and `2台に均す` (the last requires two machines). Other views retain the existing algorithm.
- `planningBoardUnitOrder.ts` groups by part due date/current order, interleaves parts by round, or assigns movable parts to the lighter machine. Completed work is excluded; rows, non-unit pieces, pins, special due and arrival-filtered bars retain their indices.
- Machine-ineligible and pending-seiban pieces stay on their machine and contribute initial load, including current setup segments. Fixed indices take priority over balancing: a lane retains enough pieces to avoid holes before its last fixed bar.
- When setup minutes differ by machine, part priority uses the larger of the two setup times; assigned load uses the destination setup time. Due date remains the first priority.
- Method changes retain the initial comparison metrics. Setup counts are included only for unit-method previews and count bars with positive setup segments once per bar.
- Balance previews apply optimistic resource overrides. Apply batches changed pieces into one overrides write, waits for acknowledgement, then saves both nonempty lane orders (500 items maximum each; overrides maximum 2000).
- Undo stores `restoreResources[]` for both balanced moves and existing single-item moves, restoring resource overrides in one write before lane orders. Confirmed movement retains undo history if a later order write fails.
- Toolbar callbacks are wired through `ProductionScheduleGrindingPlanningBoardPage.tsx`, which owns the toolbar; `PlanningBoardPageView.tsx` only owns the board content.

Validation: web `tsc --noEmit -p tsconfig.json`, seven focused Vitest files (86 tests, including 32 new tests), and `pnpm kiosk-sop:source-check` passed. Parent page/offline tests passed 221/222 tests; the existing two-pane selection test fails before any order proposal because `planning-gantt-bar-a` matches multiple elements (also reproduced in one focused run). This unrelated display/test issue was left unchanged. No API/DB/shared-types changes, commit, push or deployment.
