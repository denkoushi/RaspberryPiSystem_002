---
id: kiosk-leaderboard-deferred-residual-summary-202607
status: proposed
scope: defer leaderboard process-change residual summary until after fresh shell rows are visible
date: 2026-07-11
source_of_truth: true
related_code:
  - apps/api/src/services/production-schedule/leaderboard/leaderboard-composite-board.service.ts
  - apps/api/src/routes/kiosk/production-schedule/leaderboard-phased-read.ts
  - apps/web/src/features/kiosk/leaderOrderBoard/useCompositeLeaderboardPhasedScheduleWithAutoAppend.tsx
  - apps/web/src/features/kiosk/leaderOrderBoard/mergeLeaderboardBoardContinueResponse.ts
related_docs:
  - docs/plans/kiosk-leaderboard-first-display-performance-202607.md
validation: design only; implementation not started
---

# Show fresh leaderboard rows before the residual summary finishes

This ExecPlan is a living document maintained according to `.agent/PLANS.md`. It is deliberately separate from the SQL experiments in `kiosk-leaderboard-first-display-performance-202607.md` because it changes the timing, but not the meaning, of an existing response field.

## Purpose / Big Picture

The aggregate leaderboard shell currently waits about 2.1–2.35 seconds for the process-change residual count and representative rows even after the fresh per-resource ranking rows are ready. The board must keep excluding residual-suspected rows from normal ranking and must eventually show the same residual count, representative rows, evidence, and ordering. The intended user-visible change is only that fresh ranking rows become visible first and residual summary metadata joins immediately afterward.

The feature is off by default. Existing clients and requests retain the current atomic response. A canary is retained only if first-row median improves by at least 10 percent, P95 does not worsen by more than 10 percent, and the final merged board is identical to the current response.

## Progress

- [x] (2026-07-11 11:35+09:00) Confirmed residual evidence keys are required on the shell critical path because they exclude suspected rows from normal ranking.
- [x] (2026-07-11 11:35+09:00) Confirmed only residual summary COUNT and representative-row hydration can be deferred; these account for about 2.1–2.35 seconds on Pi5.
- [x] (2026-07-11 11:35+09:00) Selected existing `leaderboard-board/continue` as the follow-up transport to avoid another endpoint and reuse snapshot validation.
- [x] (2026-07-11 12:00+09:00) Implemented API shell deferral and continue summary attachment behind `LEADERBOARD_DEFER_RESIDUAL_SUMMARY_ENABLED=false`; default behavior remains atomic.
- [x] (2026-07-11 12:06+09:00) Implemented Web opt-in behind `VITE_KIOSK_LEADERBOARD_DEFER_RESIDUAL_SUMMARY_ENABLED=false`, including pending merge, summary-only continue, append completion, fingerprints, and cache completeness.
- [x] (2026-07-11 12:12+09:00) Passed API 24 focused tests, Web 67 focused tests, both builds/lints, and `git diff --check`; local atomic/deferred row IDs and final summary matched exactly.
- [ ] Measure the feature on Pi5/Pi4 canary with production residual evidence; local seed has zero residual evidence and cannot prove the expected 2-second gain.
- [ ] Request explicit approval before any Pi5 canary deployment.

## Surprises & Discoveries

- The residual materialization keys cannot be deferred. They are inputs to shell row selection and preserve the rule that process-change remnants do not appear as ordinary ranked rows.
- The residual summary is not returned by the current continue response. Continue already resolves the same generation token and evidence materialization, so adding optional summary work there reuses the correct consistency boundary.
- A board can have no resource continuation while still needing residual summary metadata. The Web must therefore issue one summary-bearing continue request even when every resource has `hasMore=false`.
- Existing display fingerprints include residual total and representative rows. A deferred shell needs an explicit pending marker so missing metadata is not mistaken for an authoritative zero and does not invalidate a longer append override.

## Decision Log

- Decision: keep generation-token and residual-evidence-key resolution in the initial shell.
  Rationale: deferring either would change row membership and snapshot invalidation semantics.
  Date/Author: 2026-07-11 / Codex.
- Decision: defer only `fetchLeaderboardProcessChangeResidualSummary()`.
  Rationale: it is the largest steady-state phase and its output is display metadata, while normal ranked rows are already determined from the evidence key set.
  Date/Author: 2026-07-11 / Codex.
- Decision: carry deferred summary on the existing continue response rather than a new endpoint.
  Rationale: continue already checks snapshot generation and filter scope, and the Web already merges its response into the displayed board.
  Date/Author: 2026-07-11 / Codex.
- Decision: default both API and Web gates OFF.
  Rationale: old clients retain the current HTTP timing and payload, and rollback is a gate change plus service restart.
  Date/Author: 2026-07-11 / Codex.

## Proposed API Contract

Add optional request fields, with false as the default:

- Shell GET: `deferResidualSummary=true` asks the server to omit the summary query from the critical path.
- Continue POST: `includeResidualSummary=true` asks the server to attach the exact summary for the current filter and generation.

Add one optional response field:

- `residualSummaryDeferred: true` means summary fields are pending. Absence preserves the existing contract. An authoritative zero remains `processChangeResidualTotal: 0` with an empty row list.

When shell deferral is active, the server still resolves generation token, residual materialization, and evidence keys before resource shells. It skips only `fetchLeaderboardProcessChangeResidualSummary()` and returns fresh resource rows with `residualSummaryDeferred: true`.

When continue requests the summary, the server computes it from the same current filters and evidence materialization. If supplied snapshots are stale for the current generation, the response sets `snapshotExpired` and the Web discards both continuation and summary, purges terminal cache, and refetches the shell. Otherwise the response contains the same three summary fields as today's shell and does not set the deferred marker.

## Proposed Web Flow

With the Web gate OFF, send neither new request field and preserve current behavior.

With the gate ON:

1. Request the shell with `deferResidualSummary=true`.
2. Display fresh shell rows as soon as they arrive. Do not render an authoritative “0 residuals” state while `residualSummaryDeferred=true`.
3. Start the normal append loop immediately. Its first POST sets `includeResidualSummary=true`.
4. If every resource is already complete, send one continue POST with unchanged resource slices solely to retrieve the summary.
5. Merge summary fields from the continue response into the current board without replacing or shortening displayed resource rows.
6. Only a board with resolved summary and complete paging may be written as a complete terminal-cache record. This prevents a pending summary from becoming a five-minute authoritative cache entry.

Decorations and labor metadata remain independent and must not delay first rows. Summary failure keeps fresh ranked rows visible, records a retryable background error, and retries with bounded backoff; it must not show a global fatal board error unless snapshot expiry requires a full refetch.

## Implementation Steps

1. Extend API schemas and response types with the optional fields. Add service tests proving default behavior still calls and returns summary exactly as before.
2. In shell orchestration, conditionally replace the summary promise with an explicit deferred state. Do not alter resource-shell inputs or evidence keys.
3. In continue orchestration, optionally run summary alongside continuation work and attach it only after snapshot validity is established.
4. Extend Web types, query construction, merge policy, and fingerprints. Add an explicit three-state summary model: pending, resolved zero, resolved nonzero.
5. Add tests for no-more-resources summary fetch, snapshot expiry, retry, cache completeness, append-row preservation, decoration merge, and gate OFF compatibility.
6. Benchmark gate OFF and ON with identical five-run procedures. Compare final normalized payloads after summary merge.

## Validation and Acceptance

- Gate OFF response and request shapes remain byte-for-byte compatible except for code that is unreachable while disabled.
- Gate ON first shell returns the same ordered normal row IDs and resource snapshot metadata as gate OFF.
- After the first successful summary-bearing continue, process-change residual total, representative row IDs/order, evidence, and representative limit equal the gate-OFF shell.
- A residual-suspected row never appears among normal ranked rows while summary is pending.
- Snapshot expiry cannot merge a summary from a newer generation into older displayed rows.
- Pending summary is never persisted as an authoritative complete IndexedDB record.
- First-row median improves at least 10 percent and P95 does not worsen more than 10 percent on the real six-slot Pi5/Pi4 canary.
- API/Web lint, builds, focused tests, and `git diff --check` pass before deployment approval is requested.

## Rollback

Turn the Web opt-in gate OFF first so no new deferred requests are issued. The API default remains atomic and compatible. If necessary, revert the isolated API and Web commits; there is no migration and no stored-data rollback.

## Outcomes & Retrospective

API and Web stages are implemented locally behind disabled-by-default gates; no production setting has changed. The atomic shell and deferred shell returned identical normal row IDs, and the first summary-bearing continue reproduced the atomic summary without snapshot expiry. The local browser median did not improve because its deterministic seed has zero residual evidence and the measured production-only 2.1–2.35-second phase is absent. A separately approved Pi5/Pi4 canary is required for the retain/reject performance gate.
