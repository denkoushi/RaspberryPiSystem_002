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
