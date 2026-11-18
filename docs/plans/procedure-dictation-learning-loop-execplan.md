# Close the procedure dictation learning loop

Maintain this living plan under `.agent/PLANS.md`, including Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective.

## Purpose / Big Picture

Improve the conversion of spoken Japanese into written procedure text using finalized procedures and corrections saved by operators. Start by retaining the transcript, AI proposal, and saved text together. Use that evidence in the next change to measure whether added context improves rewriting.

## Progress

- [x] (2026-11-18) Stage 1 implementation records dictation proposals, resolves them on save, and counts their outcomes by source.
- [x] (2026-11-18) Prisma generation, both TypeScript checks, 87 API tests, and 54 Web tests passed locally.
- [x] (2026-11-18) Review corrections passed Prisma generation, both TypeScript checks, 127 targeted API tests, and 55 targeted Web tests.

## Surprises & Discoveries

The existing overlay save identifies the latest proposal per element across sources. For append mode, the editor inserts the existing text, a newline, and the rewrite result. The stored proposal needs the full string for the save to recognize a kept proposal.

The API skips proposals that exceed the editor's text limit. The editor sends the original text for new-mode proposals so saving the restored `ここに文章を入力` placeholder resolves as `REVERTED`.

## Decision Log

- Decision (2026-11-18). Reuse overlay save resolution and await the optional feedback write so a proposal can exist before the editor saves. Check the edit lease for recording and use sequential queries because the reads and insert do not require a shared transaction. Split layout and dictation outcome counts for measurement.
- Decision (2026-11-18). Restrict both the nightly change check and the 300-row sample for term learning to `LAYOUT`. Dictation corrections alone could trigger relearning, displace layout examples from the sample, and reach the layout instructions before evaluation. Use dictation corrections in the next PR after they pass the nightly evaluation.
- Decision (2026-11-18). Defer adding learned terms to Whisper hints because the system retains no audio for replay and comparison.

## Outcomes & Retrospective

Stage 1 establishes the data needed to pair proposals with human corrections. Stage 2 will use those pairs for evaluation and decide when to use the enriched instructions.

## Context and Orientation

`apps/api/src/routes/assembly/procedure-document-revisions.ts` exposes the rewrite API and records proposals. `apps/web/src/features/assembly/document-editor/useProcedureVoiceInput.ts` supplies the edit target. `apps/api/src/services/assembly/assembly-procedure-document-revision.service.ts` resolves the newest feedback on overlay save. `apps/api/src/services/assembly/procedure-site-vocabulary.ts` records nightly outcome totals.

## Plan of Work

Stage 1 adds a source, input mode, and transcript in `apps/api/prisma/schema.prisma`. When a rewrite targets an active head draft and the request can write under the edit lease, store its proposal. Saving the overlay pairs the latest proposal for each element with the final text and marks it kept, edited, or reverted.

Stage 2 extracts instruction assembly in `apps/api/src/services/assembly/procedure-dictation-rewrite.service.ts` into one pure function, meaning its output depends only on its arguments. Supply the site glossary, learned term corrections, and saved dictation corrections. Each night, run both versions of the prompt on the same fixed questions and questions built from recorded feedback. Keep confirmation cases separate from the examples fed into the prompt. Adopt the enriched version only if its score on the confirmation cases does not regress. Persist both scores and the decision on every run.

Stage 3, adding learned terms to Whisper hints, is deferred until the change can be measured with comparable audio.

## Concrete Steps

Run from the repository root with workspace dependencies installed.

    pnpm --filter @raspi-system/api exec prisma generate
    pnpm --filter @raspi-system/api exec tsc -p tsconfig.build.json --noEmit
    pnpm --filter @raspi-system/api exec vitest run src/routes/assembly/__tests__/procedure-dictation-rewrite.routes.test.ts src/routes/assembly/__tests__/procedure-layout-suggestions.routes.test.ts src/services/assembly/__tests__/procedure-caption-feedback-save.test.ts src/services/assembly/__tests__/procedure-site-vocabulary.test.ts src/services/assembly/__tests__/procedure-term-learning.service.test.ts
    pnpm --filter @raspi-system/web exec tsc --noEmit -p tsconfig.json
    pnpm --filter @raspi-system/web exec vitest run src/features/assembly/document-editor/ProcedureVoiceInput.test.tsx

## Validation and Acceptance

In stage 1, appending `棚に戻す。` to `既存。` must store `既存。\n棚に戻す。` as the proposal. Saving it as written records `KEPT`, and saving a human correction records `EDITED`. A legacy rewrite request or a failed feedback write still returns the rewritten text. The snapshot reports separate layout and dictation counts. In stage 2, test that a lower confirmation score prevents adoption while both scores are still persisted.

## Idempotence and Recovery

Client generation and the mocked checks can be repeated. The migration only adds fields and an index. Existing feedback defaults to `LAYOUT`. A failed feedback write leaves the rewrite response available.

## Artifacts and Notes

The additive SQL is in `apps/api/prisma/migrations/20261118120000_add_procedure_text_feedback_source/migration.sql`.

## Known Limitations

When several proposals target the same element before a save, only the latest row resolves. Earlier rows remain proposed and are excluded from outcome counts and learning. A recorded row can remain even if the Web editor discards a late result or the operator undoes it. Saving a different text can mark that row `EDITED`. The next PR's evaluation uses only `smallEdit` rows, where the final text is a small edit of the proposal, so substantially different pairs are excluded.

## Interfaces and Dependencies

`POST /assembly/procedure-documents/dictation/rewrite` accepts optional `documentId`, `pageIndex`, and `elementId` together as the target for feedback. The Web editor sends its `x-procedure-edit-token` for the recording check. The optional `originalText` supplies the baseline for new-mode feedback. Append and revise use `currentText` as their baseline. Prisma stores the proposal and outcome. Stage 2 will use the existing text completion interface for paired nightly evaluations.

Review revision (2026-11-18). Updated proposal recording and undo handling, and kept nightly term learning on layout feedback until dictation evaluation is in place.
