# KB-440: Sessaku piece quantity, operation completion and parent audit

- Status: active
- Date: 2026-11-09
- Scope: API sessaku pieces and parent completion commands; local implementation only

## Symptoms And Root Cause

Quantity growth used the final unfinished piece even for unit-split lots. Operation
replacement removed obsolete evidence without aggregating remaining operations.
Parent completion updated pieces without passing through the piece audit writer.

## Fix

- For existing all-one pieces on an enabled effective resource, append units up to
  50 pieces. Put overflow on the final unprotected unfinished piece. Keep the
  existing decrease and non-unit policies. Import callers resolve effective
  resources and stored flags from boards displaying the lot inside the transaction.
- When all 50 pieces are protected, preserve evidence and report
  `INVALID_PLANNED_QUANTITY` rather than create piece 51 or change recorded work.
- Enforce this cap regardless of unit splitting or piece quantities; growth uses each site's parent resource override (or the set resource), ignoring piece overrides.
- Complete unfinished pieces with a nonempty retained operation set whose evidence
  is complete. Use existing quantity/progress synchronization to publish parent
  completion and downstream arrival. Later pieces retain independent completion.
  Empty definitions preserve completion; added operations fill completed pieces.
- Audit parent completion/cancellation after commit with before/after piece and
  operation snapshots and versions. Reuse the existing best-effort audit writer.

## Automatic Unit Split Runs In The Background (2026-11-11)

- Symptom: after PR #2682 the automatic unit split never split a production lot.
  Each lot rewrites ranks for every lane and site (estimated ~5.6 s on Pi5, not
  measured), but the per-lot budget was 3 s, and the split only ran while a
  planning board page polled `POST .../pieces/auto-unit-split`.
- The split is a first-time-only process. It now runs as the post-listen scheduler
  `sessaku-auto-unit-split` (leader only, gated by `SESSAKU_PIECES_CREATE_ENABLED=true`).
  It starts 30 s after start-up, repeats every 1 s while `hasMore`, and every 60 s when idle or after an error.
  A round that reports `hasMore` but splits nothing waits 2 s, then twice as long each time, up to
  60 s. This covers fast lot failures (P2034, SOURCE_ITEM_MISSING, PIECE_REFERENCED), a budget hit
  before any lot is chosen, and lots that keep exceeding the budget. One split returns it to 1 s.
  Wakes from old pages do not shorten this delay.
  The existing xact advisory lock still prevents a double run, and progress is
  re-derived from the DB after a restart or blue/green switch.
- The background job splits one lot per transaction, so every lot gets the full
  budget and a flush or commit failure is attributed to that lot. Per-lot budget
  is 20 s (runner timeout 27 s); the #2733 extended retry was removed. Retry delays are kept in memory only:
  - A lot that yields to a human save is deferred for 30 s, doubling up to 5 min.
  - A lot that exceeds the budget or fails is deferred for 3 min.
  - The lots behind a deferred lot keep progressing.
- `mergeSessakuPieces` sets `ProductionScheduleSessakuPieceSet.autoUnitSplitHeldAt`
  for both partial and full merges. Candidate SQL, the TS predicate and the
  automatic path of `splitSessakuPieces` skip held sets, so human merges are never
  split again automatically. Manual split is unchanged and keeps the marker.
  `ProductionScheduleSessakuPieceHistory` is not used as the marker: #2727 removed
  that gate on purpose, and the table also holds keys from manual sets made before the feature existed.
- The POST route now only wakes the scheduler and returns `hasMore: false`, so
  pages that are already open stop polling after one response. The board shows
  background splits on its next refetch (up to 5 min) or on reload.
- Log events to watch: `sessaku_piece.auto_unit_split_background`,
  `sessaku_piece.auto_unit_split_background_error`, `sessaku_piece.auto_unit_split_deferred`,
  `sessaku_piece.auto_unit_split_background_backoff` (`retryAfterMs`),
  and `sessaku_piece.auto_unit_split_call` (`totalMs`, `lockHeldMs`, `yieldReason`, `errorCode`).

## FHINCD Investigation

Resource-part minute writes use `z.string().trim()`, and piece operation lookups
and definition reconciliation also use `trim()` and exact matching. These rules
agree. Neither side performs NFKC normalization or case folding. No change to the
resource-minutes/capacity files is required for this mismatch investigation.

## Validation

Unit tests cover unit growth, 50-piece overflow, protected evidence, independent
later links, operation removal/addition/empty definitions and parent audit failure.
DB cases are added to `sessaku-pieces.integration.test.ts` for user execution;
no DB connection or `.env` read is part of this local validation.

## References

- [Quantity planning](../../apps/api/src/services/production-schedule/sessaku-pieces/piece-quantity.ts)
- [Operation reconciliation](../../apps/api/src/services/production-schedule/sessaku-pieces/piece-operation-definitions.ts)
- [Parent commands](../../apps/api/src/services/production-schedule/production-schedule-command.service.ts)
