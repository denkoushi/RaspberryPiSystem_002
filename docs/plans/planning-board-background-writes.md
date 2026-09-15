# Make planning-board edits immediate with ordered background saves

This living ExecPlan follows `.agent/PLANS.md`. User approval covers the listed board operations and production rollout.

## Purpose / Big Picture

Operators should see edits immediately and continue working while one background writer saves accepted operations in order. The board must preserve acknowledged changes, reject stale cross-terminal writes, and never let an earlier response erase a later local intent. Existing pointer and pane-order behavior remains unchanged.

## Progress

- [x] 2026-09-15: Surveyed all board mutation paths; audited existing worktrees and started `feat/planning-board-background-writes` at exact origin/main `693f5e2f1f348a10310c8e21275ca3d3d2dfdc59`.
- [x] Implement a board-local ordered writer with optimistic display and confirmed revision tracking.
- [x] Integrate special due, resource moves, rank edits, individual/bulk editor, seiban registration/removal/order, and due-detail edits.
- [x] Verify consecutive and mixed edits, failure recovery, stale refreshes, navigation protection, and rendering scope.
- [ ] Commit, push, pass required CI, merge, lifecycle finish/audit, then verify signed main release and standard production rollout.

## Surprises & Discoveries

`applyOptimisticOverride` previously applies special-due removal but does not apply creation/replacement. Most other writes update some display first but globally reject follow-up operations. Only resource-local reorder currently queues consecutive moves. Due-scope writes return a scope revision but no item revisions, so their affected seiban needs an authoritative refresh before ordinary item writes resume.

## Decision Log

Use one board-local writer, not new dependencies or a general application-wide queue. Reuse the existing resource reorder projection and all existing server API concurrency checks. Keep server-calculated special-due expiry authoritative; a pending label must not invent calendar-derived ordering. Protect navigation for every outstanding save. Refresh after the queue drains instead of every mutation; a due-scope operation may require an intermediate refresh because it changes item revisions without returning them. Restrict any required refresh wait to the affected seiban rather than the entire board. Do not silently retry a write after an ambiguous failure.

## Outcomes & Retrospective

Implementation and focused validation are complete. Required hosted CI, merge, and standard production deployment remain pending. No production changes from this task yet.

## Context and Orientation

`apps/web/src/pages/kiosk/ProductionScheduleGrindingPlanningBoardPage.tsx` owns every edit and the overlays that currently render unconfirmed values. `apps/web/src/features/kiosk/grindingPlanningBoard/usePlanningBoardWriteQueue.ts` replaces the former reorder-only loop and retains its lightweight rank projection in the page. `PlanningBoardItemTable.tsx` renders labels and colored outlines. `PlanningBoardSeibanDrawer.tsx` owns candidate/input selection. `apps/web/src/api/hooks/production-schedule.ts` owns mutations and cache invalidation. The API checks itemRevision/overrideVersion, board sourceRevision, or due scopeRevision depending on the operation. Those server-issued values must never be fabricated.

## Plan of Work

First extend the board-local queue to project accepted intents over confirmed items and registered order. A save result advances confirmed revisions; pending intents remain above it. A failed operation cancels dependent pending intents, retains acknowledged writes, and reconciles before permitting uncertain follow-ups. Keep independent intents where their captured revisions remain valid.

Then route all page handlers through the writer, close editors/date pickers upon accepted intent, preserve enough attempted data to recover after a failure, and remove global saving locks from ordinary follow-up input. Keep resource dragging and long-press pane ordering intact. Ensure registered-card state and drawer inputs remain consistent on failed registration. Local-only controls use state directly and should avoid forcing unchanged item rows to render.

Finally run focused tests, inspect the final diff, submit a PR with the deploy-impact table, verify required checks, and merge. Clean the implementation worktree using lifecycle finish and audit. Use a clean deployment worktree at an integrated, signed SHA. Check for a concurrent production rollout before starting a new one; do not overwrite a newer server deployment or broaden peripheral-agent scope.

## Concrete Steps

Run commands from the task worktree unless noted. Reuse installed workspace dependencies without changing the lockfile. Build shared-types if its generated output is absent. From `apps/web`, run `pnpm exec vitest run src/features/kiosk/grindingPlanningBoard/usePlanningBoardWriteQueue.test.ts src/pages/kiosk/ProductionScheduleGrindingPlanningBoardPage.test.tsx`, then `pnpm exec tsc -b` and ESLint on changed source files. Update exact test names here if the queue module is renamed. Use hosted CI for the broader suite; do not duplicate its full container build locally.

Deployment uses only `scripts/update-all-clients.sh <branch> infrastructure/ansible/inventory.yml --print-plan --limit <exact hosts>`, followed by one `--detach` and canonical `--status <returned run id>`. Target raspberrypi5 and the six existing kiosk hosts (stonebase01, robodrill01, fjv60-80, sessaku-01, assembly-01, kensaku-02); allow only standard one-shot offline-host exclusions. Existing credential path is `/Users/tsudatakashi/RaspberryPiSystem_002/infrastructure/ansible/.vault-pass`; do not copy credentials into worktrees.

## Validation and Acceptance

With a deliberately unresolved first save, perform multiple special-due toggles, resource/rank edits, and seiban order changes. Every accepted intent must be visible immediately, only one HTTP mutation may run at a time, and the next request must use revisions returned by the previous save. Resolve/reject promises out of user-input order and prove late responses cannot erase newer intents. Fail one request and verify saved results remain, dependent work is cancelled visibly, and unrelated data is not overwritten. Preserve existing 409, original-allocation read-only, completed-item, bulk snapshot, and 50-seiban limit contracts. Individual due changes preview on board items; due-scope changes preview in the detail panel and close input immediately. Scope-wide item dates reconcile from authoritative snapshots, preserving processing-level overrides and fallback dates before dependent writes.

Check that status stays inside the fixed toolbar space. Verify local controls and pointer behavior remain usable. A browser fixture can demonstrate update order; do not claim physical-terminal timings without measurement. Production completion requires terminal success, failed/unreachable/rescued counts of zero for executed hosts, role health results, exact SHA evidence, and a final clean-worktree audit.

## Idempotence and Recovery

Do not reset/stash existing WIP, force-remove worktrees, bypass concurrency checks, or manually edit deployment state. A mutation with uncertain outcome is reconciled through reads, not blindly replayed. Use the standard deployment role rollback on failure. Preserve all unrelated worktrees; finish only the merged implementation task. An already-running deployment must reach a terminal state before another mutation begins.

## Artifacts and Notes

Task evidence lives in `/Users/tsudatakashi/Documents/Codex/2026-09-14/new-chat-2/work/board-writes-*` and a final concise record under `outputs`. PR, CI, merge, run IDs, and final results will be recorded as they become known.

## Interfaces and Dependencies

Use React state/refs/memoization, the existing query hooks, existing shared request/response types, and existing sort/projection helpers. The writer owns pending operations and confirmed revisions; the page supplies domain operations and UI callbacks. It remains scoped to the planning board. Do not add an offline service, network protocol, database migration, or dependency.

Revision note: created after the approved full-board survey to capture concurrency and recovery boundaries before implementation.

## Validation checkpoint: 2026-09-15 16:05 JST

The user explicitly approved extending validation after the first retry limit. The final page suite passes all 50 tests, including immediate special-due toggles, mixed resource/rank edits with a deferred first save, consecutive seiban order writes, stale responses, external unregister cleanup, and placeholder read-only behavior. The five writer tests pass. Shared-types build, final TypeScript build and ESLint checks pass. Test failures during implementation exposed registration promise timing, pending expiry formatting, external selection cleanup, and obsolete save-lock assumptions; these were corrected without disabling concurrency checks.

Due-detail input closes immediately and previews its date. Scope-wide board item dates wait for authoritative data because processing overrides and fallback provenance are not available in the item contract. This is the bounded exception to immediate item display. Existing server deadline calculation, pointer handling and per-terminal pane order remain intact. No physical-terminal latency benchmark has been performed for this change.
