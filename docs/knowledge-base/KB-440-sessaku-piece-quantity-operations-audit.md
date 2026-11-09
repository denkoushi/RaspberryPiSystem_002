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
