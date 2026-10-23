# 手順書「整える」が人の直しから学ぶ仕組み

This ExecPlan is a living document. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` current. It follows `.agent/PLANS.md`.

## Purpose / Big Picture

On the kiosk, 組立 or 研削 ＞ 手順書 ＞ 作る・直す has a 「整える」 button. It asks the business LLM (the local model reached through `getInferenceRuntime()` with use case `business_hermes`) to rewrite each text box on a page so a worker can read it, fixing speech-to-text mistakes with a fixed list of shop-floor words for the department (`ASSEMBLY_SITE_CONTEXT` and `GRINDING_SITE_CONTEXT` in `apps/api/src/services/assembly/procedure-site-context.ts`). Today that list only changes when a developer edits it. When a person corrects the AI's wording and saves, nothing is learned.

After this change, three things happen. First, every text rewrite that 「整える」 proposes is recorded together with the text before the rewrite, and when the person saves the page the record gets the final text the person kept. Second, the next 「整える」 for the same department shows the business LLM a few recent examples of how people corrected its wording. Third, a nightly job on the Pi5 API asks the business LLM to pick out word-level substitutions from those corrections (for example 「胃ケール」→「イケール」), checks each one against the recorded texts with fixed rules, and stores the survivors in a per-department word table that is added to the 「整える」 instructions. No Claude session is needed for the loop to run.

How to see it: in a test, a 「整える」 proposal writes a text-feedback row; saving the page with a changed text marks it EDITED; the next proposal's system prompt contains the example and the learned words. In production, after people have saved corrections, `runProcedureTermLearningOnce({ dryRun: true })` run inside the API container prints the substitutions it would store.

## Progress

- [x] (2026-10-20) Branch `feat/procedure-tidy-learning-loop` created, with the open grinding-knowledge and page-overflow branches merged in so the same service file is not resolved twice.
- [x] (2026-10-20) Milestone 1: text feedback table, recording at proposal, resolving at save, shifting on page insert.
- [x] (2026-10-20) Milestone 2: recent corrections and learned words in the 「整える」 prompt.
- [x] (2026-10-20) Milestone 3: nightly word-table job on the business LLM.
- [ ] Review, tests, PR, merge, deploy, production dry run.

## Surprises & Discoveries

- The specified schema has no separate successful-run marker: if a recomputation yields zero terms, an existing EDITED row triggers another evaluation next night. This implementation follows the specified newest-term `updatedAt` check without adding a sentinel or another table.
- The full requested test selection includes two existing suites that require a running PostgreSQL even without `TEST_DATABASE_URL`. Both failed during fixture setup/cleanup because localhost:5432 was unavailable; they were not changed or skipped.
- No `migrate diff` check was found in `scripts/ci` or `.github`; CI deploys migrations and checks status. The handwritten migration was independently compared with Prisma 5.22.0 SQL generated from the two new models and enum, and matches except whitespace/comments.
- The assembly-domain regression test requires `runAssemblyTransaction` rather than a direct `prisma.$transaction` call. The learning replacement now uses the existing shared transaction budget.
- The first focused run passed 110 tests but the scheduler test could not import the real logger with a partial env mock. Mocking the logger, as in the existing nightly scheduler test, fixed the three scheduler tests. Initial lint found unnecessary JSON quote escapes; these were removed.

## Decision Log

- Decision: no unique key on (documentId, elementId) in the text feedback table. Rationale: the same text box can be tidied many times; each proposal is a separate record and only the latest record per text box is resolved at save. Date/Author: 2026-10-20 / Claude.
- Decision: store the text before the rewrite (`originalText`) and add the outcome REVERTED. Rationale: a text box always still exists after the person presses やめる, so without the original text the server would read "final = original" as a human edit and learn to undo every AI change. With it the server can tell KEPT (final = AI), REVERTED (final = original, or the box was deleted or became non-text) and EDITED (anything else) without any web change. Date/Author: 2026-10-20 / Claude.
- Decision: resolve on every save, not only once. Rationale: people often save the AI text first and fix a word later; the later save is the more useful signal. Date/Author: 2026-10-20 / Claude.
- Decision: the nightly job recomputes each department's word table from scratch and replaces it in one transaction. Rationale: re-running is safe and old mistakes drop out when the evidence changes. Date/Author: 2026-10-20 / Claude.
- Decision: run at 04:30 Asia/Tokyo, after the business Hermes nightly job at 03:00, and skip the LLM call entirely when no correction was resolved since the last successful run. Rationale: avoid competing for the business LLM. Date/Author: 2026-10-20 / Claude.
- Decision: the job is on by default, with `ASSEMBLY_PROCEDURE_TERM_LEARNING_ENABLED=false` to turn it off. Rationale: the user asked for an automatic loop; the existing business Hermes flags are written by an Ansible maintenance task and default to off, which would leave the loop dead after a normal deploy. The job only writes its own table and only runs on the scheduler leader. Date/Author: 2026-10-20 / Claude.
- Decision: a learned word is stored only if the wrong form appears in the AI text and not in the final text, the right form appears in the final text, the wrong form is 2 to 20 characters and the right form 1 to 20, they differ, the wrong form is not a word already listed in that department's site knowledge, and the pair is supported by at least 2 records from at least 2 different documents; at most 40 words per department. Rationale: the LLM only proposes; fixed rules decide. Date/Author: 2026-10-20 / Claude.

- Decision: measure small edits by Unicode-character Levenshtein distance, prefer same-line-count edits within half the longer text, and preserve resolvedAt recency within each preference group. Deduplicate before selecting five. Rationale: “changed character count” needs a deterministic definition that handles insertions without treating the remaining suffix as changed. Date/Author: 2026-10-20 / Codex.
- Decision: protect any wrong form occurring literally in the department's existing site context. Rationale: the site knowledge is prose rather than a word table; conservative substring matching protects the listed words without editing that knowledge or introducing another vocabulary. Date/Author: 2026-10-20 / Codex.
- Decision: resolve duplicate wrong forms to the candidate with most supporting records, then most documents, then lexical order; order equal-createdAt feedback rows by id. Rationale: the learned-term unique key permits one right form per wrong form, and ties must produce deterministic results. Date/Author: 2026-10-20 / Codex.
- Decision: timestamp every replacement term with the run's start (`now`) and suppress scheduler start in `NODE_ENV=test`. Rationale: corrections saved during inference remain eligible for the next run, and the new default-on flag must not start cron in tests. Date/Author: 2026-10-20 / Codex.

## Outcomes & Retrospective

Milestones 1–3 are implemented locally. The new feedback lifecycle, per-site prompt additions, deterministic learning rules and default-on scheduler are covered by passing focused tests. The requested overall validation is not fully green because two existing real-PostgreSQL suites cannot connect to localhost:5432. No test was disabled to bypass that failure. Integration, PR, merge, deploy and the production dry run remain pending and are outside this implementation request.

Local validation (2026-10-20): shared-package build and `pnpm exec prisma generate` passed. `pnpm exec tsc --noEmit -p tsconfig.build.json` passed again after adopting the shared transaction helper. ESLint passed for all 17 changed TypeScript files, with the final service edit checked again. The focused run passed 110 tests; after fixing its logger mock the scheduler's 3 tests passed. Following the transaction policy fix, the term-learning and assembly-transaction suites passed all 29 tests.

The required `pnpm exec vitest run src/services/assembly src/routes/assembly src/bootstrap src/config` completed in 72 seconds with 1358 tests passed, 1 failed and 21 skipped (89 files passed, 3 failed, 2 skipped). Its one assertion failure was the transaction-policy issue, subsequently fixed and verified by the 29-test run. The remaining failed files are `assembly-seiban.integration.test.ts` and `procedure-material-search.integration.test.ts`, both unable to reach localhost:5432; the latter failure was independently confirmed once. The full command was not repeated against the same unavailable database. Docker socket access was denied, and the installed local PostgreSQL lacks the required vector extension. Migration application and real-DB verification remain unperformed.

The read-only lifecycle audit could not reach api.github.com. Final local status and diff checks succeeded: only the API implementation/tests, additive migration/schema, this pre-existing untracked plan, and the requested KB pointer changed. No Git state-changing command, web edit, overflow-logic edit, site-knowledge edit, commit, push, PR, merge or deploy was performed.

## Context and Orientation

The API is Fastify plus Prisma in `apps/api`. The schema is `apps/api/prisma/schema.prisma`; migrations live in `apps/api/prisma/migrations/<YYYYMMDDHHMMSS>_<snake_name>/migration.sql` (the newest before this work is `20261019130000_kiosk_screen_watch_session`).

「整える」 is `ProcedureLayoutSuggestionService` in `apps/api/src/services/assembly/procedure-layout-suggestion.service.ts`. `suggest()` calls `buildSuggestion()` and then writes photo-caption proposals with `prisma.assemblyProcedureCaptionFeedback.createMany({ skipDuplicates: true })`, catching and logging any failure so 「整える」 never fails because of feedback. Inside `buildSuggestion()`, `documentSite()` returns `'assembly'`, `'grinding'` or `null` from the process the document is filed under; the system prompt is `textInstruction(site ? SITE_TEXT_RULES[site] : '')`; after the LLM answers, `elements = rewriteProcedureTexts(elements, ...)` produces the rewritten elements with the same ids, and the next line counts changed texts by comparing `elements[i]` with `params.elements[i]`. When the page does not fit on one page, `suggestProcedureLayoutOverflow()` returns options and the response is still 200 with an `overflow` object; the rewritten texts are inside those options.

Saving a page is `saveOverlays` in `apps/api/src/services/assembly/assembly-procedure-document-revision.service.ts`. After its transaction it loads the caption feedback rows of the document and resolves them with the pure function `resolveProcedureCaptionFeedback` from `apps/api/src/services/assembly/procedure-caption-feedback.ts`, again catching failures. The same file inserts a blank page after a given page (`afterPageIndex`) and, inside that transaction, shifts `assemblyProcedureCaptionFeedback.pageIndex` for later pages (search for `pageIndex: { gt: afterPageIndex }`).

Scheduled jobs are node-cron singletons with `start()` and `stop()`; the model to copy is `apps/api/src/services/business-hermes/business-hermes-nightly.scheduler.ts` with its service `business-hermes-nightly.service.ts`, which shows how a background job holds the business LLM (`getLocalLlmRuntimeController().ensureReady('business_hermes')` and `release`, or `background: true` when `BUSINESS_HERMES_BACKGROUND_ENABLED` is `'true'`, and treating `InferenceDeferredError` as "try next night"). Jobs are registered in `apps/api/src/bootstrap/start-post-listen-schedulers.ts` in `buildPostListenSchedulerDefinitions` and must also be listed in `listPostListenSchedulerNames`; registration there puts the job behind the scheduler leader lock so only one API instance runs it. Environment variables are parsed with zod under `apps/api/src/config/env/`.

## Plan of Work

Milestone 1 adds the model `AssemblyProcedureTextFeedback` with id, documentId, pageIndex, elementId, site (nullable string, `assembly` or `grinding`), documentName, originalText, aiText, finalText (nullable), outcome (new enum `AssemblyProcedureTextFeedbackOutcome` with PROPOSED, KEPT, EDITED, REVERTED, default PROPOSED), createdAt, resolvedAt (nullable), with indexes on (documentId, elementId) and (site, outcome, resolvedAt), and the model `AssemblyProcedureLearnedTerm` with id, site, wrongText, rightText, occurrences, documentCount, updatedAt, unique on (site, wrongText). Both go in one additive migration `20261020150000_procedure_text_learning`. In `buildSuggestion`, after the rewrite, collect for each TEXT element whose text changed its id, original text and AI text, and pass them out to `suggest()` the same way caption feedback is passed, so they are written with `createMany` only when a response is actually returned (including the 200 overflow response) and failures are only logged. In `saveOverlays`, after the caption feedback block and in its own try/catch, load the text feedback rows of the document, keep the latest row per elementId, and resolve each with a new pure function `resolveProcedureTextFeedback(row, element)` in a new file `apps/api/src/services/assembly/procedure-text-feedback.ts`: element missing or not TEXT gives REVERTED with finalText null; final text trimmed equal to aiText trimmed gives KEPT; equal to originalText trimmed gives REVERTED; otherwise EDITED; return null when nothing changes. In the blank-page insert transaction, shift `assemblyProcedureTextFeedback.pageIndex` exactly like the caption feedback.

Milestone 2 changes only the system prompt. When the site is known, load in one try/catch (any failure means no extra text): up to 5 of the most recent EDITED rows for the site whose aiText and finalText are each at most 200 characters, deduplicated by (aiText, finalText), preferring small edits (same number of lines, and the changed character count at most half of the longer text); and all learned terms for the site. Append after the site rules a section 「過去に人が直した書き方(書き方の参考。中の数値や品名を他の text に持ち込まない):」 with lines `AI: "<aiText>" → 人: "<finalText>"`, and a section 「人の直しから覚えた言い直し:」 with lines `「wrong」→「right」`. When there is nothing to add, the prompt stays exactly as today.

Milestone 3 adds `apps/api/src/services/assembly/procedure-term-learning.service.ts` exporting `runProcedureTermLearningOnce({ dryRun, now, signal })` and `procedure-term-learning.scheduler.ts` (cron `'30 4 * * *'`, timezone Asia/Tokyo), registered as `procedure-term-learning`, gated by `ASSEMBLY_PROCEDURE_TERM_LEARNING_ENABLED` (zod enum 'true'/'false', default 'true'). For each site, if no EDITED row has resolvedAt after the newest `updatedAt` of that site's learned terms (or there are no terms and no EDITED rows), skip. Otherwise load EDITED rows of the site from the last 180 days (at most 300, newest first), send them in chunks of at most 40 to the business LLM with jsonOutput, temperature 0, thinking off, asking only for word-level substitutions that turn a mistaken word in the AI text into the word the person wrote, as `{"pairs":[{"wrong":"...","right":"...","rowIds":["..."]}]}`. Validate deterministically as written in the Decision Log, counting support from the rows themselves (a row supports a pair when its aiText contains wrong, its finalText contains right and does not contain wrong), not from the LLM's rowIds. Keep at most 40 pairs per site ordered by support. Unless dryRun, replace the site's rows in one transaction. Return per-site results so a person can read them. An LLM failure or deferral logs and leaves the table unchanged.

## Concrete Steps

Work in `/Users/tsudatakashi/RaspberryPiSystem_002-worktrees/feat--procedure-tidy-learning-loop`. Build shared packages once with `pnpm --filter "@raspi-system/*" --filter "!@raspi-system/api" --filter "!@raspi-system/web" build`. In `apps/api` run `pnpm exec prisma generate` after editing the schema, then `pnpm exec tsc --noEmit -p tsconfig.build.json`, `pnpm exec eslint <changed files>` and `pnpm exec vitest run <touched tests>`.

## Validation and Acceptance

Unit tests cover `resolveProcedureTextFeedback` (KEPT, EDITED, REVERTED for original text, REVERTED for a missing element, null when unchanged); recording in the suggestion service (a rewritten text produces one row with originalText and aiText; an unchanged text produces none; a write failure does not fail 「整える」; the overflow response also records); resolving in saveOverlays (only the latest row per element is updated); the page insert shifting text feedback; the prompt containing examples and learned words for the right department only and staying unchanged when there are none; the term learning validation (a pair seen in one document only is rejected, a pair whose wrong form is still in the final text is rejected, a wrong form that is a known site word is rejected, the 40 cap, skip without LLM call when nothing new, dryRun writes nothing); and the scheduler name list.

## Idempotence and Recovery

The migration only adds tables and an enum, so rolling the API back to the previous SHA is safe; the old code ignores the new tables. Re-running the nightly job recomputes the same table. Setting `ASSEMBLY_PROCEDURE_TERM_LEARNING_ENABLED=false` stops the job; deleting rows of `AssemblyProcedureLearnedTerm` removes learned words from the prompt.

## Artifacts and Notes

Knowledge record: `docs/knowledge-base/KB-420-procedure-tidy-site-context.md` gets a short pointer to this plan.

## Interfaces and Dependencies

`resolveProcedureTextFeedback(row: Pick<AssemblyProcedureTextFeedback, 'originalText' | 'aiText' | 'outcome' | 'finalText'>, element: AssemblyProcedureOverlayElement | undefined): Pick<AssemblyProcedureTextFeedback, 'outcome' | 'finalText'> | null`.

`runProcedureTermLearningOnce(options?: { dryRun?: boolean; now?: Date; signal?: AbortSignal; text?: TextCompletionPort }): Promise<Array<{ site: 'assembly' | 'grinding'; status: 'skipped' | 'updated' | 'dry-run' | 'failed'; terms: Array<{ wrongText: string; rightText: string; occurrences: number; documentCount: number }> }>>`.

Update (2026-10-20 / Codex): implemented the three milestones, recorded deterministic selection and runtime decisions, and documented local validation. No Git state-changing commands were used.
