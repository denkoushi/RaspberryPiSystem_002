# Hermes nightly document questions and independent evaluation

This living ExecPlan follows `.agent/PLANS.md`. Scope: local implementation and focused validation approved on 2026-09-14. The user subsequently approved commit, PR, CI, main integration, standard Pi5 deployment and observation for three nights. Model training remains outside this change. Rollout is in progress; local completion is not production completion.

## Purpose / Big Picture


The nightly job can prepare useful questions even when no new conversations occurred. It selects a bounded set of authorized documents, generates source-specific questions, quotes complete source passages, and checks relevance and conditions before staging them. Existing GPTCache question lookup and fresh-source answer validation remain the serving path.

An independently reviewed evaluation file (a holdout, meaning questions withheld from generation) must show a gain before a changed answer catalogue is activated. Growing the catalogue alone is not evidence of improvement.

## Progress


- [x] (2026-09-14) Inspect the existing source adapters, nightly job, cache, protected tests and activation path; create a clean lifecycle worktree from `53444262`.
- [x] (2026-09-14) Implement bounded document selection, generation, question filtering and complete-source review.
- [x] (2026-09-14) Add independent evaluation, leakage checks and activation identity checks.
- [x] (2026-09-14) Exercise preparation and adoption/rejection with synthetic fixtures; run focused lint and type checks.

## Surprises & Discoveries


The existing nightly job only considers up to 24 recorded interactions. With no eligible interaction it never calls the model. The Python worker currently allows `coverage_added` to activate a larger catalogue without an observed evaluation improvement. Existing timing is explicitly server response assembly, not end-to-end display time. Reusing the main checkout dependency directory initially caused unrelated missing generated Prisma/shared types; an isolated offline frozen install, local Prisma generation and package builds resolved this without changing application code or dependencies. Two new Python assertions initially compared macOS temporary-directory aliases; resolving the fixture root corrected those assertions.

## Decision Log


Decision (2026-09-14, Codex): apply document-to-question generation and filtering to the existing GPTCache/FastEmbed/FAISS stack. These methods mean predicting what a document can answer and excluding unsupported questions before indexing. No additional serving service or model-training dependency is necessary. Ragas is a possible later evaluation generator, not a prerequisite for this bounded change.

Decision (2026-09-14, Codex): retain source-quoted answers, numeric identity checks, negative user feedback, inference lease release, cancellation and atomic activation. The separate model review is another call to the configured model; it is not independent human verification.

Decision (2026-09-14, Codex): preserve `checks.json` as regression checks and use private `holdout.json` for reviewed real-question evaluation. Both sets are withheld from model prompts and new aliases are checked for exact/near duplication. Missing holdout data permits staging and source-index refresh but prevents catalogue adoption. Synthetic fixtures validate the mechanism, not business accuracy.

## Outcomes & Retrospective


Local implementation and focused validation are complete. Eleven API tests (three existing source-review tests and eight selection/preparation tests) and twenty Python tests passed. API type checking and targeted ESLint passed. Stored-data inspection found an additional historical regression-test candidate, but no confirmed unused, human-reviewed real-question holdout. No real-world accuracy gain, full request-to-display latency result, or production change is claimed.

## Context and Orientation


`apps/api/src/services/assembly/business-hermes-nightly.service.ts` runs the 03:00 job using authorized MCP readers and the existing business inference runtime. `business-hermes-source-adapters.ts` projects documents and identifies their business numbers. `services/hermes-answer-cache/maintenance.py` compares immutable candidate and current catalogues. `runtime.py` verifies file hashes before switching `active.json`. `server.py` implements the existing GPTCache search and source-bound answers.

## Plan of Work


Milestone 1 adds pure question-filter and selection helpers plus their tests, then integrates them into the existing job. Selection considers failed/frequent source references, changed or uncovered documents and prior attempts so repeated runs make progress. Four documents and eight eligible conversations bound each batch. Documents produce at most two questions each; every accepted question receives complete-source answer selection and review. Persist the selection ledger privately and retain rejection reasons in the job input.

Milestone 2 adds a separately hashed holdout evaluation and blocks new aliases that duplicate protected questions. Evaluate current and candidate on both sets, reject new wrong or lost correct outcomes and material lookup slowdown, and require independent improvement for adoption. Add negative answer fragments and report answerable coverage separately from successful abstentions. Recheck both evaluation file identities immediately before activation.

Milestone 3 runs synthetic preparation and worker/activation tests including empty histories, invented identifiers, omitted conditions, duplicate questions, missing or changed holdouts, plateau, regression and successful improvement. Inspect the final diff and preserve the uncommitted task worktree for review.

## Concrete Steps


From the task worktree, run the API's installed Vitest and ESLint against the nightly files and TypeScript build configuration with `--noEmit`. From `services/hermes-answer-cache`, run `python3 -m unittest test_maintenance test_catalogue test_experience`. The Python unit tests must not require a model download or production service. Final commands (worktree root unless specified):

    pnpm --filter @raspi-system/api exec vitest run src/services/assembly/business-hermes-nightly.service.test.ts
    pnpm --filter @raspi-system/api exec vitest run src/services/assembly/business-hermes-nightly-candidates.test.ts src/services/assembly/business-hermes-nightly-preparation.test.ts
    pnpm --filter @raspi-system/api exec tsc -p tsconfig.build.json --noEmit
    pnpm --filter @raspi-system/api exec eslint src/services/assembly/business-hermes-nightly.service.ts src/services/assembly/business-hermes-nightly-candidates.ts src/services/assembly/business-hermes-nightly-candidates.test.ts src/services/assembly/business-hermes-nightly-preparation.test.ts

The first API command passed 3 tests; the second passed 8, including a final recheck after strengthening copied-question detection to recognize source-prefixed copies. Type checking and lint passed. From `services/hermes-answer-cache`, use the existing private Python environment at `/Users/tsudatakashi/Documents/Codex/2026-09-12/new-chat/work/gptcache-venv/bin/python` with `-m unittest test_maintenance test_catalogue test_experience`: 20 passed. After the copied-question guard changed, `-m unittest test_maintenance` passed all 13 affected tests. 

The default system Python lacks GPTCache; no dependencies were added to it. Test execution and environment repair stayed within the repository's 20-minute validation budget.

## Validation and Acceptance


With an empty conversation history and a visible synthetic document, the preparation test must stage a grounded question. Fabricated business numbers and questions copied from protected evaluation must not be staged. A separately mocked model rejection must keep a candidate out. Worker tests must show that catalogue growth without independent improvement does not activate, a newly wrong guard rejects adoption, and a verified gain can activate. Changing a holdout during preparation must prevent activation. These are mechanism checks; representative reviewed business holdout data is needed to measure actual gains.

## Idempotence and Recovery


Each job retains immutable candidate/input/result files in the existing private data directory. Failed or cancelled jobs retain the active catalogue. `previous-active.json` remains the recovery pointer. The document attempt ledger controls scheduling only and cannot authorize an answer. No credentials or actual business questions belong in Git. Repeated runs select a bounded batch and do not append duplicate aliases.

## Artifacts and Notes


Research basis: Doc2Query predicts questions before indexing; Doc2Query-- filters unsupported questions; KCS uses interaction evidence to prioritize knowledge maintenance; CheckList uses controlled wording/identity/condition changes to expose behavioral failures. These are design methods, not claims that a particular research implementation has been installed.

## Interfaces and Dependencies


Keep the existing catalogue version 1 and source export version 2. New private state is a bounded-by-corpus document-attempt ledger and optional `holdout.json`.
The holdout uses version 1 cases with unique `id`, `question`, optional current `expectedSource` (`kind`, `id`, `sha256`), `requiredFragments`, and optional
`forbiddenFragments`. A positive case must have required answer fragments; a negative case omits `expectedSource`. For `holdout.json`, require top-level
`provenance: "human-reviewed-real-questions"`, nonempty `reviewedBy` and `reviewedAt`, four to two hundred unique cases, at least one positive and one
abstention case, and required fragments on every positive. These fields record review provenance; they are not cryptographic evidence of review. Do not label
model-reviewed or previously exposed questions as human-reviewed independent data. The API stores evaluation file hashes before generation; the worker checks
them again and the activation process rechecks them before switching files.

Missing holdout data produces `awaiting_holdout`, stages the candidate, refreshes source discovery and creates a deduplicated existing administrator alert. Plateau does not switch the catalogue. Every job retains its candidate and decisions, while the scheduling ledger avoids reattempting an unchanged document for seven days. This version generates a bounded batch per run and does not automatically merge unadopted candidates from previous jobs. Evaluate larger batches only after measuring the existing twenty-minute job and device memory limits.

Require a human review identity and cases from actual held-out interactions before operational use. Never manufacture a business holdout from candidate questions.

Revision note (2026-09-14): created after inspecting the current implementation; preserve the deployed answer path and concentrate changes at preparation and adoption boundaries.

Revision note (2026-09-14, completion): recorded passed focused validation, isolated dependency repair, copied-question prefix guards, and the stored-data audit limitation. Local implementation is complete; the independent business dataset and actual performance measurement remain operational prerequisites.

Lifecycle completion audit: target is `DIRTY_PROTECTED`, with only this task's nine changed/new files retained. Main remains clean; existing unrelated worktrees were preserved. No remote branch or PR was created.

## Production Rollout


The user approved standard deployment to the business Pi5 (`raspberrypi5`) and observation of three scheduled nights. Preserve the existing no-holdout adoption gate. Follow required CI, signed artifacts, the standard release wrapper and its rollback checks. Record deployment evidence in the task output report. A thread heartbeat should check daily after 03:00 JST, stay quiet on unchanged/non-actionable state, notify meaningful failures and report the three-night result before pausing itself.

- [ ] PR and required CI successful.
- [ ] Main integration and main CI successful.
- [ ] Standard Pi5 release and health evidence complete.
- [ ] Three-night observation configured; observed results are a later milestone.
