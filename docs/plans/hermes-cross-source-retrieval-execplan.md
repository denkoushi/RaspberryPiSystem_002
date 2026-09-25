---
id: hermes-cross-source-retrieval-execplan
title: Hermes cross-source record retrieval (source catalog, query plan, offline evaluation)
status: in-progress
last_verified: 2026-09-24
---

# Build scalable cross-source record retrieval for the Hermes floating Chat

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds. It is maintained in accordance with `.agent/PLANS.md` at the repository root. The architectural decision behind it is `docs/decisions/ADR-20260923-hermes-cross-source-retrieval.md`.

## Purpose / Big Picture

A factory user opens the floating Chat on the business Pi5 kiosk, types a natural-language question such as "the latest two nonconformities about a dimensional problem in a given department", and within 5 seconds sees the matching records, each shown in its original, unmodified text with its source name. Later, the same Chat must answer questions over other, differently shaped business data (for example work instructions), including questions that need records from several sources at once. Adding such a source must mean writing a small declaration and adapter, not rewriting the search core.

Phase 1 of this plan, which is its whole current scope, completes this behavior for nonconformity records only. The catalog, plan, and executor are built source-neutral so that a second source and cross-source merging can be added in a later phase without redesign, but connecting work instructions or any other source is not part of Phase 1.

Today only one source (nonconformity records) is searchable, only questions that reduce to exact conditions are proven correct, and meaning-based questions can see only about one third of the records. After this plan, a developer can run a single local command that evaluates the whole question-to-answer pipeline against a gold set and prints accuracy and latency, and the Chat can offer the new search behind a separate switch once that evaluation passes.

## Progress

- [x] (2026-09-23 13:40Z) Owner decisions recorded: multi-source cross retrieval, 5-second screen answer, scalability; offline evaluation allowed; planner chosen by JEV-versus-DGX comparison; current JEV path frozen; ADR and ExecPlan first.
- [x] (2026-09-23 13:40Z) ADR-20260923 and this ExecPlan drafted on branch `docs/hermes-cross-source-retrieval`.
- [ ] Owner review of this ExecPlan, including the initial acceptance thresholds in `Validation and Acceptance`.
- [ ] Milestone 1: gold-set format, private gold sets, and offline evaluation command against the current path (baseline numbers).
- [x] (2026-09-23 22:34Z) Owner narrowed Phase 1 to nonconformity records only.
- [ ] Milestone 2: source-neutral catalog v2 with the nonconformity entry, and common document normalization.
- [x] (2026-09-23 22:41Z) Owner chose JEV as the only planner (DGX answers have taken over a minute).
- [x] (2026-09-24 00:09Z) Phase 1 local pipeline is in review: nonconformity only, no-vector path chosen, explicit flag delivery, concurrency 4 in flight / 8 queued / 3s wait, live corpus refresh every 300s with a data timestamp, and a Node 24 CI job. Pi5 on-device validation is still pending.
- [ ] Milestone 3: query-plan schema, validator, and the JEV planner; plan accuracy and latency recorded.
- [ ] Milestone 4: plan executor with exact filters and hybrid retrieval; recall measured.
- [ ] Later phase (not scheduled): second source and cross-source merge.
- [ ] Milestone 5: multi-turn plan replacement measured on dialogue cases.
- [ ] Milestone 6: floating-Chat integration behind a separate switch; screen-complete p95 measured on the Pi5 kiosk (deployment only with explicit approval).
- [x] (2026-09-24) Recent + content orders by the date role after a content gate. The pool keeps a lexical score at least 0.2 of the top score with a positive non-filter content token, and hybrid/dense rows at least 0.75 of the top cosine. Relevance walks newest-first in batches of 15, at most 3 batches. A further batch starts only when the time left before the 4500 ms request deadline is at least the previous batch's duration, or 900 ms before one has been measured. Records accepted so far are returned.
- [x] (2026-09-24) Stage-metric method is the comparison path (`--stage-dump` and `retrieval/stage-score.mjs`). Chosen method: period slot plus the sort rule, hybrid RRF(k=60) of lexical and dense, enrichment text (summary, queries, tags, aliases) on both sides. Query-time DGX embedding is allowed; the Qwen3-Embedding-0.6B contract is not defined yet. Production stays lexical with embedding `none`. On a private 50-case set, paraphrase top-15 rates were lexical 0.00, hybrid e5-base 0.38, hybrid e5 plus enrichment aliases 0.44, hybrid ruri-v3-310m plus aliases 0.62, hybrid Qwen3-Embedding-0.6B plus aliases 0.69. Whole-set status correctness moved from 0.74 to 0.86 with period/sort plus hybrid plus aliases. Mac p95 stayed at or under 2.4 s. Enrichment covered only a 1,000-record subset that contained the targets, so those rates are biased upward. See ADR-20260924.

- [x] (2026-09-25) DGX dense evaluation on the full 8,209-record sealed snapshot (2026-09-12) and the private 50-case stage set, `--now 2026-09-24`. Document vectors come from the production index path (#1487) with the 700-character cap (#1486), and query vectors come from the DGX business embedding server through an owner-opened SSH tunnel. No record failed to embed. Paraphrase top-15 rates on 16 cases were: lexical 0.06, hybrid DGX 0.25, and hybrid DGX with Grok enrichment on the 1,000 pilot ids 0.44. Whole-set status correctness was 0.80, 0.88, and 0.90, and filter precision stayed at 0.72 in all three runs. The enrichment run is biased upward because the pilot ids were chosen to contain the targets. The owner accepted the thresholds (paraphrase clearly above lexical, status not lower, no precision loss) and approved `HERMES_RETRIEVAL_DENSE_PROVIDER=dgx` on Pi5 the same day.
- [ ] Compare the DGX night enrichment of the 1,000 pilot ids with the Grok enrichment by using the same evaluation, then decide whether to enrich all records on DGX.
- [ ] Measure screen-complete latency on the Pi5 kiosk with the DGX dense provider on.

## Surprises & Discoveries

- Observation: the exact branch is already fast; the goal is blocked by coverage and generality, not speed.
  Evidence: eight real screen responses on 2026-09-23 had worker `elapsedMs` between 632 and 968, all `searchPlan.mode` `exact`.
- Observation: the Node tests under `scripts/hermes-search/` are not run by `.github/workflows/ci.yml`; previous PRs reported them as local runs.
  Evidence: `rg -n -i hermes .github/workflows/ci.yml` only lists the `hermes-answer-cache` job.
- Observation: a second source already has an authorized read path.
  Evidence: `apps/api/src/services/assembly/business-hermes-mcp.service.ts` imports `WorkInstructionReadService` and has `readWorkInstructionCandidates`.

- Observation (2026-09-25): after PR #1485 reached Pi5 with the index flag on, the dense store stayed at its 16-byte header. Two causes were found in order. First, the DGX release wrote the business proxy drop-in and restarted the proxy without a systemd daemon reload, so `POST /v1/embeddings` still went to the LLM and returned 404. A manual `daemon-reload` and proxy restart fixed that; the playbook fix belongs to `DGXSparkControlPlane`. Second, the DGX embedding server accepts about 1024 tokens per input (`--ctx-size 2048 --parallel 2`), and one long record failed its whole batch of 8.
  Evidence: probes from the Pi5 API container with generated text only. Short input was 404 before the reload and 200 after it. After the reload, 800 characters passed and 1000 failed, and 8 inputs of 500 characters took about 1.1 s. Document text is now capped at 700 characters, and a failed batch is retried one record at a time.

## Decision Log

- Decision: replace per-record LLM classification with ingest-time lexical and embedding indexing for all new work.
  Rationale: per-record classification needs a hand-made taxonomy per source and one LLM call per record; after days it covered about one third of nonconformity records.
  Date/Author: 2026-09-23, supervising agent with owner approval.
- Decision: a turn produces a complete query plan that replaces the previous plan, instead of typed operation deltas.
  Rationale: the delta design needed many separate small decisions per turn (operation type, removal target, field-versus-value, display intent, equivalence), and most repairs between 2026-09-20 and 2026-09-23 were in that area. A full plan can be compared with the previous plan by code.
  Date/Author: 2026-09-23, supervising agent.
- Decision: choose the planner model by measurement, not by preference.
  Rationale: JEV is a choice-scoring service whose fitness for producing a complete plan is unknown; the DGX business LLM has only been measured inside a slow multi-turn agent loop, not as a single schema-constrained call.
  Date/Author: 2026-09-23, owner. Superseded by the next entry.
- Decision: the planner is JEV only; the DGX planner adapter and comparison are dropped.
  Rationale: DGX Spark answers have taken over a minute in practice, and the business model can be stopped when a Private workload takes the GPU, so it cannot support a 5-second answer. JEV calls measured 632-968 ms including worker time on 2026-09-23. If JEV cannot reach the plan-accuracy threshold, stop and report instead of switching models silently.
  Date/Author: 2026-09-24, owner.
- Decision: query-time DGX embedding is allowed; production still defaults to lexical and embedding none. Details and aggregate rates are in ADR-20260924.
  Rationale: the owner allowed DGX calls at query time. The Qwen3-Embedding-0.6B contract is not defined, so the port has no remote adapter yet.
  Date/Author: 2026-09-24, owner. Supersedes the next entry for the DGX query-time ban only.
- Decision: the per-question query embedding must not depend on DGX availability for the 5-second path.
  Rationale: the same preemption that rules out the DGX planner would make semantic search unavailable. Milestone 4 measures EmbeddingGemma query embedding on the Pi5 CPU; if it fits the retrieval budget, the Pi5 computes query embeddings and DGX is used only for bulk indexing, otherwise the fallback is lexical-only search with an explicit notice.
  Date/Author: 2026-09-24, supervising agent.
- Decision: Phase 1 covers nonconformity records only; work instructions and cross-source merging move to a later phase.
  Rationale: owner wants one source finished end to end first. Keeping the catalog and plan source-neutral preserves the scalability requirement without paying for a second source now.
  Date/Author: 2026-09-24, owner.
- Decision: the supervising and implementing agents draft the gold set; the owner only reviews a short list.
  Rationale: expected records can be fixed by read-only queries without the owner, but questions written only by developers miss real user wording, so a brief owner review is the cheapest guard.
  Date/Author: 2026-09-24, supervising agent.
- Decision: acceptance is judged on a held-out gold set that the implementing agent never sees; a development/held-out gap over 10 points blocks promotion.
  Rationale: the owner asked whether a gold set means building logic that answers only specific questions. Without a held-out set, repeated tuning against visible cases would recreate the per-utterance patching this plan replaces.
  Date/Author: 2026-09-24, owner question, supervising agent.
- Decision: the primary pipeline is lexical IDF retrieval plus one JEV planner call and one JEV relevance call; vector retrieval stays optional and OFF.
  Rationale: on a 20-question supervisor held-out set, no-vector gave 15/17 fully relevant content answers, 0 with wrong records, 2 safe no_result, both nonsense questions no_result, warm total p50 0.76 s / p95 0.94 s, cold 1.9 s. With vector: 14/17, 3 with wrong records, warm p50 1.08 s. No-vector also removes the embedding model and DGX from the answer path on the Pi5.
  Date/Author: 2026-09-24, supervising agent (owner: "any means that produce results").
- Decision: every component must support more sources, cross-source search, and several concurrent Chat users; tools that cannot are parked as candidates, not removed.
  Rationale: owner requirement 2026-09-24. Parked candidates: QMD vector search with EmbeddingGemma, BGE and OpenProvence rerankers, GPTCache/fastembed/FAISS answer cache, LlamaIndex, langextract, the Hermes Agent native tool loop, and PostgreSQL or SQLite full-text search (the last is the planned replacement for the in-memory lexical index when records outgrow the worker heap).
  Date/Author: 2026-09-24, owner and supervising agent.
- Decision: concurrency is handled in the API/worker, not by JEV limits.
  Rationale: 1, 5, and 10 parallel live questions all completed in about 3 s wall time with planner max 1.6 s and relevance max 1.1 s, so the external service did not degrade at that load. The existing `HermesSearchTrialService` processes one request at a time; the worker must accept several in-flight requests keyed by request id, with a bounded queue and an explicit busy response.
  Date/Author: 2026-09-24, supervising agent.
- Decision: answers must come from current data, not only the sealed snapshot.
  Rationale: the local snapshot is from 2026-09-12. The worker must load records through the existing authorized read path at startup and refresh incrementally on a fixed interval, reporting the data timestamp with each answer.
  Date/Author: 2026-09-24, supervising agent.
- Decision: gold sets containing business text stay outside Git.
  Rationale: the previous handoff kept acceptance wording and responses private for the same reason; Git receives only schemas and synthetic fixtures.
  Date/Author: 2026-09-23, supervising agent.
- Decision: implementation is delegated milestone by milestone to an implementing agent (Grok 4.7 High Fast), each milestone on its own branch and PR; the supervising agent reviews against this plan before any PR is proposed.
  Rationale: keeps each change small and checkable against the acceptance numbers here, and prevents a return to per-utterance patching.
  Date/Author: 2026-09-23, owner.

## Outcomes & Retrospective

Not started. No code, deployment, or measurement beyond the baseline evidence above exists yet.

## Context and Orientation

This section explains the current system for a reader who knows nothing about it.

The business Pi5 is a Raspberry Pi 5 that runs the business API (a Node/TypeScript server in `apps/api`) and serves the kiosk web app (`apps/web`). The floating Chat is the component `apps/web/src/components/hermes/HermesFloatingChat.tsx`. When its `JEV記録` mode is visible, a question is posted to the authenticated route `POST /assembly/hermes-search-trial/answer`, implemented in `apps/api/src/routes/assembly/hermes-search-trial.ts`, which calls `HermesSearchTrialService` in `apps/api/src/services/assembly/hermes-search-trial.service.ts`.

That service starts one long-running child process, the "worker": `scripts/hermes-search/hermes-qmd-prefetch-worker.mjs`, run with Node 24 and a 384 MB heap. The service and worker talk over standard input and output using one JSON object per line: the service writes `{type:"request", requestId, question, session}` and the worker answers `{workerRequestId, stage:"completed", result}`. The worker keeps no database connection; the service keeps a 10-minute session per Chat conversation.

JEV means the TypeSafe JEV model, called as `typesafe-ai/jev` through the `experimental_evaluate` function of the `ai` npm package, or directly at `https://api.typesafe.ai/v1/systemone` (`scripts/hermes-search/hermes-jev-record-pilot.mjs`). It is an external internet service authenticated with a key delivered from Ansible Vault. It does not write free text; it receives a conversation state and a set of typed questions ("choice": pick one of these options; "noul": yes or no) and returns a probability for each option.

The current record-search logic lives in `scripts/hermes-search/hermes-jev-record-classifier.mjs` (about 1,900 lines), `scripts/hermes-search/hermes-search-state.mjs` (conversation state), and `scripts/hermes-search/hermes-resolution-policy.mjs` (ambiguity rules). It has two branches. The "exact" branch turns a question into conditions such as organization, date order, and count; the API then reads current rows from PostgreSQL through `BusinessHermesMcpService` (`apps/api/src/services/assembly/business-hermes-mcp.service.ts`). The "classified" or semantic branch looks up per-record JEV judgments stored in a JSON file; only records that have a saved judgment can be found.

As of 2026-09-23 there are 2,764 saved judgments for roughly 8,200 current records, record classification is switched OFF by `HERMES_SEARCH_RECORD_CLASSIFICATION_ENABLED=false`, and the judgment definition version is 4. This whole path is frozen by the ADR: do not change its behavior, its store, or its settings in this plan.

A source definition is a JSON file describing a data source's fields; the only one is `scripts/hermes-search/hermes-sources/nonconformity.json`, validated by `validateSourceDefinition` in `scripts/hermes-search/hermes-source-definition.mjs` (schema `hermes-source-definition/v1`). It lists metadata fields (for example `partNumber` labelled 品番, `originDepartmentName` labelled 起因部署, `discoveredOn` labelled 発見日), body fields (for example `condition` labelled 不適合内容), and lexical fields.

QMD is a local search library (`@tobilu/qmd`, pinned to Git commit `04e4dbd8245c527a88f1a8f0bda547aef9ca81fb` in `scripts/hermes-search/package.json`) that stores a lexical index and an embedding (vector) index in SQLite. `scripts/hermes-search/hermes-qmd-local.mjs` wraps it. An embedding is a list of 768 numbers that represents the meaning of a text; texts with similar meaning have nearby embeddings. The embedding model is EmbeddingGemma 300M, and on the Pi5 its computation is sent to the DGX machine through `RemoteInference` in `scripts/hermes-search/hermes-remote-inference.mjs` (operations under `/v1/hermes-search/`, private network only). A reranker is a second model (BGE reranker v2 m3) that rescores a short list of candidates against the question. An earlier evaluation of QMD lexical+vector search with reranking (called r10) left accuracy failures unresolved; that is the main technical risk this plan measures first.

The DGX business LLM is not used in this plan: its answers have taken over a minute, and its model can be stopped when a Private workload takes the GPU. DGX is used only for bulk embedding computation while indexing. Access to DGX is arbitrated by the separate `denkoushi/DGXSparkControlPlane` repository; do not change that repository's contracts from here.

Terms used below. A "gold set" is a private file of test cases, each with a question (and optional earlier turns), the expected query plan, and the expected record ids. A "query plan" is the structured description of what to search, defined in Milestone 3. "Recall at k" is the fraction of expected records that appear in the top k results. "p95 latency" is the time under which 95% of requests finish. "Screen-complete" time is measured in the kiosk browser from pressing send until the answer is fully rendered.

## Plan of Work

The work is ordered so that the riskiest unknown, retrieval accuracy, is measured before any user-visible change, and so that every milestone is additive: the frozen JEV path keeps working throughout. New code goes under a new directory `scripts/hermes-search/retrieval/` so it never edits the frozen classifier. No new npm or Python dependency may be added without owner approval; reuse `@tobilu/qmd`, `ai`, the existing EmbeddingGemma and BGE inference, and Node's built-in test runner.

### Milestone 1: gold sets and the offline evaluation command

At the end of this milestone a developer can run one command that feeds every gold-set case through a pipeline and prints accuracy and latency, and the numbers for the current frozen path exist as a baseline.

Define the gold-set format in `scripts/hermes-search/retrieval/gold-set.schema.json` (schema id `hermes-retrieval-gold/v1`). Each case has `id`, `sources` (expected source ids), `turns` (array of user questions; the last one is evaluated), `expectedPlan` (the fields defined in Milestone 3, allowed to be partial), `expectedRecordIds` (ordered when the question asks for an order, otherwise a set), `expect` (one of `answer`, `clarification`, `no_result`), and `tags` (for example `exact`, `semantic`, `cross_source`, `multi_turn`). Add a synthetic fixture `scripts/hermes-search/retrieval/fixtures/synthetic-gold.json` with invented records and questions only.

Create the private gold set outside Git at `~/Documents/hermes-retrieval-private/gold/nonconformity.json` with directory mode 0700 and file mode 0600. Target at least 60 cases: at least 30 `semantic`, at least 10 `multi_turn`, at least 5 whose correct outcome is `clarification`, and at least 5 whose correct outcome is `no_result`.

Start from the existing private evidence (the eight 2026-09-23 exact utterances under `~/Documents/Codex/2026-09-23/hermes-or-diagnosis/private-evidence/`). The agents draft the remaining questions by sampling real records across departments, dates, and defect types and writing the question a shop-floor user would type; they must not copy phrases from the record body verbatim into semantic questions, because that makes lexical search look better than it is. Expected record ids must be confirmed by read-only queries against current data, never by the system under test. The owner then reviews a list of about 20 drafted questions, marks unnatural ones, and may add a few phrasings actually used on the floor; this review is the only owner task in Milestone 1.

The gold set measures the system; it is never an input to it. To keep the system general, split the cases into a development set (about 60%) and a held-out set (about 40%) stored in a separate file, `nonconformity.heldout.json`, that the implementing agent never reads. The implementing agent may inspect development-set failures; the supervising agent alone runs the held-out set and reports only summary numbers. Acceptance is judged on the held-out set. A gap of more than 10 percentage points between development and held-out scores is treated as overfitting and blocks promotion. Code, prompts, and catalog entries must not contain gold-set question text, record-specific values chosen to pass a case, or branches keyed to particular phrasings; the supervising agent checks each PR diff for this. After each promotion decision, add at least 10 new held-out cases so the held-out set does not become familiar over time. Never paste gold-set text into Git, PR descriptions, or CI logs.

Write the evaluator `scripts/hermes-search/retrieval/evaluate.mjs`. It takes `--gold <file>`, `--pipeline <name>`, and `--out <file>`, loads records from a local snapshot directory given by `--snapshot <dir>` (the same sealed snapshot files used on the Pi5), runs each case, and writes per-case results plus a summary: plan accuracy, recall at 5 and 10, wrong-answer rate (an answer was shown but contains a record not in the expected set), correct-clarification rate, and p50 and p95 latency per stage. Output files go under `~/Documents/hermes-retrieval-private/runs/`. Provide a pipeline wrapper `frozen-jev` that drives `TrialWorker` from `hermes-qmd-prefetch-worker.mjs` without modifying it. Because it calls the external JEV service with business questions, running `frozen-jev` on private gold sets is allowed only for nonconformity, which is already approved for that service.

Also add a separate CI job in `.github/workflows/ci.yml` that installs with `npm ci` in `scripts/hermes-search` and runs `node --test retrieval/`, using only synthetic fixtures and no network. Existing tests in `scripts/hermes-search/` join that job only after they are confirmed to pass offline; do not modify frozen-path tests to make them fit. This makes every later milestone's regressions visible in hosted CI.

### Milestone 2: source catalog v2 and common documents

At the end of this milestone nonconformity records are converted into a source-neutral document shape and indexed, and a synthetic second source in the test fixtures demonstrates that adding a source needs only a catalog file and an adapter.

Add schema `hermes-source-catalog/v2` in `scripts/hermes-search/retrieval/source-catalog.mjs`. It extends v1 without breaking it: v1 files keep validating with the existing `validateSourceDefinition`. A v2 entry adds `fields`, where each field has `key`, `label`, `type` (`string`, `date`, `number`, `code`), `role` (`identifier`, `facet`, `organization`, `date`, `body`), `filterable`, and `valueSource` (`enumerated` from the snapshot, `free`, or `none`), plus `displayDefault` and `readAdapter` (a code-registered name, never a connection string). Write `hermes-sources/nonconformity.v2.json`, and a synthetic second entry only under `scripts/hermes-search/retrieval/fixtures/` for tests. A real work-instruction entry belongs to the later phase.

Add `scripts/hermes-search/retrieval/documents.mjs` that turns a record into `{sourceId, recordId, facets, segments:[{field, text, start, end}], updatedAt}` where `start` and `end` are UTF-16 offsets into the original field text, so that display always slices the original. Add `scripts/hermes-search/retrieval/value-index.mjs` that collects the distinct values of each enumerated filterable field per source; the planner and validator use it to resolve names (for example organization names) to exact values.

Indexing reuses `HermesQmdLocal` with one QMD collection per source and incremental updates keyed by `recordId` and `updatedAt`. Embeddings are computed through `RemoteInference` when `HERMES_INFERENCE_ORIGIN` is set, otherwise locally on a developer machine.

### Milestone 3: query plan, validator, and JEV planner

At the end of this milestone the JEV planner produces validated plans for every gold-set case, and its plan accuracy and planning latency are recorded in `Surprises & Discoveries`.

Define `hermes-query-plan/v1` in `scripts/hermes-search/retrieval/query-plan.mjs`: `sources` (array of catalog ids), `filters` (array of `{source, field, op, values}` with `op` in `eq`, `in`, `not_in`, `before`, `after`, `between`), `semanticQuery` (free text or empty), `sort` (`{field, direction}` or relevance), `limit` (1 to 20), `display` (field keys), and `unresolved` (terms that could not be resolved, each with candidate values). The validator rejects any unknown source, field, operator, or value not present in the value index for enumerated fields; a non-empty `unresolved` becomes a clarification question listing candidates.

The JEV planner (`planner-jev.mjs`) makes one JEV call per turn. Code first finds candidate values for organization-like and other enumerated fields by string matching against the value index, so JEV chooses among real values rather than inventing them. The single call asks choice questions built from those candidates and the catalog summary: which sources, which candidate value for each detected term, whether the turn is a new search or a refinement of the previous plan, sort, and limit. `semanticQuery` is the question text minus the resolved filter terms. The number of questions per call is bounded by the catalog, not by past failures. It must not import the frozen classifier.

Run the evaluator on the development gold set. If JEV misses the plan-accuracy threshold or planning p95 exceeds 1.5 s, stop and report to the owner rather than tuning prompts case by case or switching models.

### Milestone 4: executor

At the end of this milestone the evaluator runs the full pipeline and reports recall and wrong-answer rate for nonconformity records. The merge step exists and is tested with the synthetic second source, but no real second source is connected.

Add `scripts/hermes-search/retrieval/executor.mjs`. For each source in the plan, in parallel: apply exact filters through a read adapter (for the evaluator, over the local snapshot; in the API, through the existing `BusinessHermesMcpService` nonconformity read), then, if `semanticQuery` is non-empty, run QMD lexical+vector search restricted to the filtered record ids, then optionally rerank the top 20 with BGE. Apply sort and limit after filtering. Merge sources by interleaving on normalized score, keep the source label on each result, and return original-text segments only. An empty well-formed result is `no_result`, not a failure.

If semantic recall at 10 on the nonconformity gold set is below the threshold, record per-case misses in `Surprises & Discoveries` and try, in this order and one at a time: segment-level instead of record-level embeddings, adding the `search_text` produced by the existing offline extraction as an extra indexed field, and reranking depth. Stop and report after these three if the threshold is still missed.

### Milestone 5: multi-turn plan replacement

At the end of this milestone multi-turn gold cases pass at the threshold. The service stores the last validated plan per session. Each turn sends it to the planner, which returns a complete new plan; code computes the difference only for display ("added facility X, kept process Y"). Corrections are just new plans. No typed operation vocabulary is introduced.

### Milestone 6: floating-Chat integration

At the end of this milestone a new Chat mode, separate from `JEV記録`, uses the new pipeline when a new setting `HERMES_RETRIEVAL_V2_ENABLED=true` is present, delivered through the standard release environment like the existing Hermes search settings in `infrastructure/ansible/roles/release_pi5/tasks/business-hermes-chat-prepare.yml`. Omitting the setting leaves the current behavior. The worker protocol gains a `pipeline` field; the frozen path stays the default. Production deployment follows `docs/guides/deployment.md` with `scripts/update-all-clients.sh <branch> infrastructure/ansible/inventory.yml --print-plan --limit raspberrypi5` first, and only with explicit owner approval.

## Concrete Steps

All commands run from the task worktree root unless stated. Install the search runtime once per worktree:

    cd scripts/hermes-search && npm ci

Run the new unit tests (synthetic data only, no network):

    cd scripts/hermes-search && node --test retrieval/

Prepare the private area once on the developer Mac:

    mkdir -p ~/Documents/hermes-retrieval-private/gold ~/Documents/hermes-retrieval-private/runs
    chmod 700 ~/Documents/hermes-retrieval-private

Evaluate a pipeline (Milestone 1 onward); the expected summary shape is shown:

    node scripts/hermes-search/retrieval/evaluate.mjs --gold ~/Documents/hermes-retrieval-private/gold/nonconformity.json --snapshot <private snapshot dir> --pipeline frozen-jev --out ~/Documents/hermes-retrieval-private/runs/<date>-frozen-jev.json

    {"cases":60,"planAccuracy":0.00,"recallAt5":0.00,"recallAt10":0.00,"wrongAnswerRate":0.00,"clarificationCorrect":0.00,"latencyMs":{"plan":{"p50":0,"p95":0},"retrieve":{"p50":0,"p95":0},"total":{"p50":0,"p95":0}}}

Record only the summary numbers (never case text) in this plan's `Surprises & Discoveries` or `Decision Log`.

## Validation and Acceptance

These initial thresholds are the supervising agent's proposal and require owner confirmation before Milestone 3 starts:

On the private held-out gold set, evaluated by the supervising agent with the command above and the chosen pipeline: plan accuracy on exact cases at least 95%; semantic recall at 10 at least 90% and recall at 5 at least 80%; wrong-answer rate at most 2% (a clarification or honest `no_result` is preferred to a wrong answer); correct clarification on cases whose `expect` is `clarification` at least 90%; multi-turn plan accuracy at least 90%; pipeline total p95 at most 3 s on the Pi5 with DGX inference.

On the Pi5 kiosk browser after an approved deployment: screen-complete p95 at most 5 s over at least 30 gold questions, with each answer's record ids and original text matching independent read-only queries of current data.

Every new module must have Node tests using synthetic fixtures that fail before the change and pass after it, and the new CI job must pass on the PR.

## Idempotence and Recovery

Everything before Milestone 6 is additive and local: new files under `scripts/hermes-search/retrieval/`, new catalog files, a new CI job, and private files outside Git. Re-running the evaluator overwrites only its `--out` file. Indexes built for evaluation live in a temporary directory given by `--work-dir` and can be deleted and rebuilt. The frozen JEV path, its classification store, and its settings are never modified, so rollback of any milestone is a normal revert of that milestone's PR. In Milestone 6, removing `HERMES_RETRIEVAL_V2_ENABLED` through the standard release path restores current behavior; never edit environment files on the device directly, force-kill processes, or bypass deployment gates.

## Artifacts and Notes

Private evidence from the frozen path's 2026-09-23 acceptance is at `~/Documents/Codex/2026-09-23/hermes-or-diagnosis/private-evidence/` and must stay private. The frozen path's own handoff is `docs/plans/hermes-jev-search-handoff-20260923.md`.

## Interfaces and Dependencies

At the end of Milestone 4 these exports must exist:

In `scripts/hermes-search/retrieval/source-catalog.mjs`: `validateSourceCatalogEntry(value, expectedId)` returning a frozen entry, and `loadSourceCatalog(ids)`.

In `scripts/hermes-search/retrieval/query-plan.mjs`: `validateQueryPlan(plan, catalog, valueIndex)` returning `{ok:true, plan}` or `{ok:false, clarification}`.

In `scripts/hermes-search/retrieval/planner-jev.mjs`: `createPlanner(options)` returning an object with `async plan({question, previousPlan, catalogSummary, candidates})` that returns an unvalidated plan and stage timings.

In `scripts/hermes-search/retrieval/executor.mjs`: `async execute(plan, {adapters, index, reranker})` returning `{status, results:[{sourceId, recordId, segments}], timings}`.

Dependencies are limited to what `scripts/hermes-search/package.json` already pins, Node 24 built-ins, the existing JEV access through the `ai` package, and the existing DGX embedding inference for bulk indexing.
