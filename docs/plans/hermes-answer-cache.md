# Hermes reviewed answer reuse

This living ExecPlan follows `.agent/PLANS.md`. Status: production rollout authorized on 2026-09-13; implementing nightly maintenance, regression checking, source refresh and standard Pi5 deployment. General ten-second acceptance remains unmet. The user approved GPTCache integration followed by source-reviewed question/answer accumulation. Earlier unused evaluation-code removal remains in the same worktree; its history is in [the previous plan](hermes-learning-evaluation.md).

## Purpose / Big Picture

Reuse a correct answer without another LLM investigation. A user asks a natural Japanese question and sees a matching, complete canonical question among the existing choices. Selecting it checks the current business source and returns the reviewed answer. Similarity alone never authorizes answering a different question. A miss, changed record, removed publication or unavailable cache uses the existing Hermes route. The goal is better useful-answer accuracy and lower question-to-completed-answer latency, ultimately ten seconds including retrieval, source validation and display.

## Progress

- [x] Read pinned Hermes memory implementation and GPTCache get/put API. Native Mem0's repeated-search prompt does not establish faster answers.
- [x] Implement GPTCache catalogue reader and existing consultation integration with source revision checks.
- [x] Check cache hit, changed/removed source, invalid input, and ordinary-route fallback with focused tests.
- [x] Accumulate five source-reviewed answers from actual Hermes turns; retain five different cases outside the catalogue.
- [x] Verify Japanese paraphrases, different identifiers/conditions, and current-source checks using the actual cache engine.
- [x] Measure native answering baseline and local reuse with honest host/timing boundaries.
- [x] Review final diff and report completed and unperformed stages separately. Production integration is not implied by local verification.

- [x] Unify candidate documents and separate the two existing table projections.
- [x] Automatically persist source selection, actual question wordings, answers and explicit feedback.
- [x] Verify source promotion, automatic reuse, withdrawal, re-evaluation and restart across two real source kinds.
- [x] Verify a third synthetic source kind and reject unregistered real source access.

## Surprises & Discoveries

The business application already stores source evidence and history, but its three question recipes are fixed and its prefetch map is confined to one consultation. Native Hermes Mem0 provides semantic recall, but also instructs repeated searches and can wait for memory before inference. GPTCache supplies the independent question index needed to bypass generation for a selected reviewed answer. FastEmbed 0.8.0 supports a 384-dimensional, quantized multilingual MiniLM embedding of approximately 0.22 GB; the local Docker trial used approximately 600 MiB RSS under a one-GiB memory limit. Pi5 deployment has not been measured.

## Decision Log

On 2026-09-13, choose GPTCache 0.1.44 get/put, SQLite and FAISS, with FastEmbed CPU embeddings. Do not install a generative model or send business text to a cloud embedding API. A small private service isolates Python dependencies from the Node API. The existing database remains the authoritative business store.

Require an explicit selected canonical question for reuse. The service offers at most one learned question, up to three matching source choices, and a supplement option. Without source choices it retains the existing generic recipes. Skip speculative LLM work when such a candidate is offered. A modified source falls back to investigating the user's selected question. A canonical question must name its applicable part, historical case or conditions; it must not turn historical advice into a universal manufacturing rule.

Only reviewed catalogue entries are admitted. `review.verdict=pass`, reviewer, reason and reviewedAt attest a source review; these fields do not perform that review themselves. Answer content is never promoted simply because the model completed a turn or another LLM agreed. Correct a case by replacing the entry and review; remove failed cases. Accumulation is supervised in this phase, not autonomous training. Repeating a saved question is a cache-hit test, not an independent quality benchmark.

## Context and Orientation

`services/hermes-answer-cache/server.py` wraps GPTCache and reads a private versioned JSON catalogue. Each case contains `question`, `queries` (reviewed user wordings), `answer`, `sources` and `review`. Sources contain `kind`, `id` and `sha256`: the SHA-256 of the complete current `business_hermes_get_detail` result, serialized as recursively key-sorted compact JSON with UTF-8 text. This captures both source content and current publication metadata. Questions must be unique and at most 100 characters; answers at most 4000; one to eight source references. Catalogue contents and business transcripts stay outside Git.

`apps/api/src/services/assembly/business-hermes-answer-cache.ts` calls authenticated `/search` for one question suggestion and exact `/lookup` after selection. Its HTTP wait is at most 800 ms; missing configuration preserves the old route. It rereads sources through `BusinessHermesMcpService`, validates fingerprints, and passes fresh evidence through the existing projector. `business-hermes-consultation.service.ts` retains the existing selection validation, cancellation, history and evidence display contracts. Cache timing/hit metadata stays in existing private learning diagnostics.

## Plan of Work

First complete the actual five source reviews and private catalogue, then run GPTCache and the real consultation class against paraphrases. Current source reads should use the existing authenticated MCP endpoint, including during timing. Capture whether any LLM invocation occurs. Use different unregistered cases to check fallback. Do not lower similarity thresholds to turn wrong candidates into successes. A candidate for a different explicit identifier must not be counted as a correct match.

## Concrete Steps

Install Python dependencies from `services/hermes-answer-cache/requirements.txt` in an isolated environment. Start the service with `ANSWER_CACHE_TOKEN` supplied privately and these arguments:

    python services/hermes-answer-cache/server.py --catalogue /private/reviewed.json --data-dir /private/index --model-dir /private/models

Alternatively, the directory's `compose.yml` builds the service and downloads the embedding weights during build. Set `ANSWER_CACHE_CATALOGUE_DIR` to a directory containing `reviewed.json`, and use a private token of at least 24 characters. The container binds only local port 8650, has a one-GB memory limit and serves read-only HTTP. The read-only catalogue must be readable by container UID 10001; keep its directory restricted to that operator/service identity. Set API `BUSINESS_HERMES_ANSWER_CACHE_URL` and `BUSINESS_HERMES_ANSWER_CACHE_TOKEN` to connect. Stop/restart the service when replacing the catalogue atomically; the new content selects a separate persisted index. Old indexes are derived data, not the reviewed knowledge source.

## Validation and Acceptance

Run the three relevant API test files with Vitest and `services/hermes-answer-cache/test_catalogue.py`. Build workspace dependencies before the API build typecheck. Test a full first question and selection: the saved answer must appear with zero LLM calls, matching source evidence and normal persisted history. Test a source update/deletion and a forged selection: the old answer must not be served. Test Japanese paraphrases and changed part numbers on the actual embedding engine, followed by local HTTP and real-source latency measurements. Record model identity, host, selection delay and what display timing was not measured.

## Idempotence and Recovery

Unset the two cache API variables to restore the existing consultation route. No business DB migration or Hermes model switch is required. Keep the reviewed catalogue private and backed up. The static operator catalogue is read-only. The authenticated experience endpoints accept only API-produced answer events and explicit user feedback; they cannot modify business sources. Old catalogue/index versions may be retained for rollback; do not delete actual transcripts, reviewed sources or unrelated directories.

## Outcomes & Retrospective

On 2026-09-13, five actual native Hermes answers completed in 14.848–27.497 seconds, including a fixed one-second selection wait. Source review found one reversed depth explanation; it was corrected before admission. Another answer's unrelated second-case paragraph was removed. Five reviewed answers and initially five observed wordings were admitted.

The actual API consultation class, real production database persistence, current authenticated MCP detail reads, and local Docker GPTCache were then exercised. Three of five new wordings matched (six hits across two rounds). After source-reviewing and admitting the two missed wordings, all five matched in both repeated rounds: 10/10 source-validated correct reused answers, zero LLM calls, total latency 3.091–5.270 seconds (median 3.342), selection-to-answer median 1.454 seconds. Total latency includes a fixed one-second selection wait. These are trained repeat results, not unseen-question accuracy. API execution was on Mac, with actual business Pi database/source access; the native baseline executed on Pi, so this is not a matched-host speedup ratio. Browser rendering was not measured.

Five separate, unregistered questions were probed. Four had no suggestion; one pin-tightness question received an irrelevant drill-depth candidate. Selection requires the full explicit canonical question, so no wrong answer was automatically emitted. Suggestion quality needs further real-use review; source fingerprint checks protect freshness, not semantic equivalence by themselves.

Focused validation: 62 API tests, two catalogue tests, API build typecheck, Docker build and `git diff --check` passed. No production cache deployment, model switch, Git commit or merge was performed during this stage. Local implementation is not proof of Pi5 deployment or of ten-second screen latency. Cache misses still incur ordinary LLM latency, and additional data tables require source-reader support before their answers can be admitted safely.


The user's additional model comparison uses the same ten source-grounded prompts without answer-cache reuse. Existing private Pi Codex Luna and Antigravity Gemini binaries and account credentials are reused under a new HOME and workspace per invocation, with the original private home hidden via bubblewrap. No private MAGI job store, history, Skills or knowledge is copied or updated. DGX calls use the existing business Hermes egress path and thinking-disabled production alias. The result compares answer generation plus route overhead, not the complete search-and-UI workflow. Results are recorded separately from cache-hit timings.

Provider results on the same ten supplied-evidence questions: Qwen 10/10 source-reviewed correct, median 3.143 s (2.244–4.798); Codex Luna 10/10, median 10.732 s (10.324–13.846); Antigravity Gemini 9/10 completed and correct, median 13.144 s (10.414–22.775), one CLI failure at 22.986 s. The failed Gemini case passed a separate diagnostic repeat at 10.934 s; the initial failure remains counted and its cause is unresolved. These timings exclude search and UI; CLI startup is included for the cloud routes. Existing high-effort cloud settings and thinking-disabled Qwen are preserved. The recommendation is to keep current Qwen and prioritize supplying the needed evidence in one invocation, then verify the entire UI workflow. Original private credentials were unchanged and per-call private test homes were removed.


## Approved next phase: prepared evidence and actual UI (2026-09-13)

Implemented `sources.py` using the existing FastEmbed/FAISS dependencies and SQLite FTS5 trigram search, reciprocal-rank fusion, and exact explicit part/case filters. `export-business-hermes-answer-sources.ts` exports through the existing authorized MCP reader with pagination (published results use the `workInstruction` hasMore key). The actual source snapshot contains 8,611 records: 8,212 nonconformities and 399 published groups. It remains private and outside Git. Pass `--sources /private/sources.json`, or set `ANSWER_CACHE_SOURCES=/catalogue/sources.json` for the existing compose reader. This source export is a candidate index, not answer authority. Export/reload is an operator action in this phase.

The first question now offers concrete source choices; supplementing a question produces new choices when the feature is enabled. On selection, `business-hermes-prepared-answer.ts` obtains fresh source evidence and makes one tool-free, thinking-disabled, JSON completion through the existing business inference port, with the existing runtime lease. Missing/changed sources and oversized evidence ask for clarification. This prepared route is application integration, not a claim that native Hermes automatically limits itself to one action. Other turns retain the existing Hermes flow. Reviewed answers retain current-source fingerprint checks and zero-generation reuse.

The existing frontend and actual API were run on Mac, connected to the actual business Pi database and DGX. The private Pi personal environment and cloud CLI routes were not used in this phase. No product frontend fork or generic evaluation framework was added. API preview uses the already-warm DGX in always-on mode; production runtime startup latency is not measured.

Final-prompt generation trials: 10/10 source-reviewed correct, median 7.4605 s, range 6.564–8.661 s. One question required added thickness/depth conditions after its original vague wording missed the intended source among the top three. The complete supplement/update/select/answer UI flow was separately verified, not counted in that single-question timing. Initial prompt trials included a missing consultation condition and a 14.158 s result; these findings remain recorded. Conditions were preserved in the revised prompt before admission.

Registered ten actually displayed, source-reviewed answers in the private `prepared-reviewed.json` catalogue. Repeat UI trials: 10/10 correct, all ten server diagnostics show cache hit with zero inference calls; median 4.485 s, range 3.603–14.083 s, only 9/10 within ten seconds. The slow case spent 11.545 s in server answer handling without inference. A separate diagnostic repeat took 4.592 s and does not replace the original. Exact non-LLM cause remains unresolved. Timing is question submission to completed answer observed through browser automation, including a fixed one-second selection wait, excluding page/new-conversation startup and including observation overhead. These are development/reuse cases, not unseen-question accuracy.

Validation: 68 focused API tests, three existing text-adapter tests, three Python tests, API build typecheck, final Docker build, and whitespace diff check passed. Full source-index memory/startup on the 4GB Pi and its permanent production deployment remain unverified. Initial approximately 8k indexing took about 318 s on Mac; saved indexes avoid repeat work. The image build does not prove the full index fits the compose one-GiB runtime limit or its startup healthcheck. Standard production service integration, source refresh operation, and non-LLM latency investigation remain pending. No commit, PR, merge, production deployment, or autonomous conversation-to-approved-answer learning occurred.

Evidence and honest timing boundaries are in the task outputs `hermes-chat-ui-validation-2026-09-13.md` and `.json`; private source and server measurement records remain in task work files. The Mac preview is retained for review. Acceptance is partial: useful answers and reuse work, but all-case ten-second latency and production readiness are not yet established.


## Automatic experience phase (2026-09-13)

The user approved a table-independent source boundary, automatic conversation/selection/correction accumulation, and guarded GPTCache reuse. This phase is implemented in the existing product API and UI. No new dependency, business schema migration, cloud call, or private Pi history integration was added.

`business-hermes-source-adapters.ts` contains the two current table projections and export cursors. The source export is now version 2 with kind, id, title, text and explicit identifiers. Python search and experience ranking depend only on that document shape. Adding a future table still requires an authorized MCP reader, its projection/export adapter and appropriate evidence display; it is not automatically granted access. Unregistered kinds are rejected before current-detail calls. Existing source text ordering was verified identical before reusing all 8,611 derived vectors under the new export identity.

`experience.py` uses GPTCache question embeddings and a private SQLite event store. Each persisted answer message contributes its actual user wording, qualified canonical question, answer and fresh source fingerprints automatically. Selection can promote a source candidate, but cannot endorse an answer. The existing chat now exposes helpful/unhelpful buttons. A helpful evaluation enables reuse of that qualified canonical answer; an unhelpful evaluation blocks that answer across duplicate conversations and demotes the source for matching questions. Re-evaluation is supported. Helpful is a user endorsement, not independent correctness certification. An already endorsed answer can acquire a newly selected wording without another endorsement or an operator catalogue edit.

The API resolves feedback content exclusively from the specified consultation's persisted assistant message. Client payloads contain only message ID and verdict. Invalid IDs, unauthorized requests, arbitrary answer payloads, unavailable storage, changed/removed sources, unregistered kinds and mismatched source IDs are rejected. Repeated experience delivery preserves existing verdicts. Internal learning fields are hidden from browser history; only feedback status is exposed. Existing business authentication and current source-read visibility remain authoritative.

The two routes covered by automatic admission are prepared-source generation and cache reuse. Native-agent contextual follow-ups are not auto-promoted. Source export refresh remains an operator action; this phase does not ingest arbitrary new tables automatically. Long questions whose full qualified canonical form exceeds 100 characters still learn source associations but are not truncated into reusable answers.

UI evidence: an actual nonconformity source moved from second candidate to first after interaction. Generation/reuse comparisons were 7.984/5.236 seconds for
the nonconformity question and 8.212/4.793 for the published work-instruction question. Those comparisons preceded the final wording/identity guards. After the
final code and restart, the nonconformity paraphrase completed in 4.407 seconds and the work-instruction repeat in 6.114, both with server-confirmed cache hits
and zero inference calls. The exact paraphrase was then present in the persisted semantic index with no manual registration. Negative feedback produced null
search/lookup and no source suggestion; re-evaluation restored reuse. Timing includes a fixed one-second selection wait and excludes page/new-conversation
startup. One browser fill attempt occurred before conversation creation completed; no question was sent and it was resumed after readiness. These are a few
functional cases, not a general accuracy or latency guarantee.

Validation: 58 consultation, 7 cache, 5 prepared-answer, 6 route, 38 UI and 6 Python tests passed across the narrow changed contracts; API/web typechecks and final Docker build passed. Python tests include a third synthetic source kind with an overlapping ID, restart persistence, numeric mismatch rejection, retry idempotence, withdrawn answers and automatic wording reuse. No new real third table was introduced. The Docker build is not proof of the 4GB Pi's full-index runtime capacity.

Private transcripts/events and reader tokens remain outside Git. User-facing evidence is in the task outputs `hermes-automatic-learning-2026-09-13.md` and `.json`. The Mac preview is left running for review. No commit, push, PR, merge or production deployment occurred. Production packaging/rollout and broader latency reliability remain separate unfinished stages.


## Production milestone (2026-09-13)

The user approved implementation and real-device rollout including nightly improvement and a checker. Preserve the current feature worktree and complete its standard PR/main/release path. Existing local tests prove useful answer reuse, but not ongoing improvement: the three-day simulation improved unfamiliar-question candidate coverage from 9/16 to 12/16 and then plateaued. Never report that as continuous accuracy improvement.

- [x] Inspect the existing release, scheduler leadership and administrator-alert contracts.
- [x] Package the private GPTCache service for the standard Pi5 release lifecycle, including rollback and persistent private state.
- [x] Connect nightly bounded source refresh and source-quoted answer/wording preparation to the existing scheduler leader and inference runtime.
- [x] Check each proposed catalogue against private fixed reference questions; preserve the active version on regression, expose failures and multi-night deterioration through administrator alerts.
- [ ] Validate Pi memory/startup and remaining latency with existing source and phase measurements.
- [ ] Complete narrow tests, required CI, main integration and standard deployment; record exact SHA and release status separately.

The API owns authorized business reads, DGX inference leases and the leader-controlled 03:00 Asia/Tokyo job. It prepares a bounded candidate from recorded business interactions; answers consist only of complete source units and pass a separate relevance/conditions check. The private Python service owns embedding indexes, source-candidate indexing, reference checks and atomic catalogue activation. Expensive maintenance runs outside the request-serving process. Current detail fingerprints and user rejection checks remain authoritative at answer time.

The service persists private sources, experiences, protected reference questions, versioned catalogues and checker history outside Git. Reference questions and their answers never enter the nightly generation prompt. A new wrong suggestion, reduced reference coverage, changed reference source, failed maintenance or materially slower reference lookups cannot improve the adopted version. An alias-only plateau retains the existing version; a source-quoted new canonical answer may be admitted as additional coverage only when no protected case regresses. This is not counted as an observed accuracy gain. Compare the current deployed catalogue with the initial reference and recent nights; notify through the existing administrator alert store, without adding a separate dashboard.

Daytime source refresh and answer freshness are different: nightly exports refresh candidate discovery, whereas every selected answer still re-reads its current authorized source. Removal or change must disable an old answer immediately even before the next export. Docker memory and health limits must be checked with the full business index on the 4GB Pi, not inferred from a small Mac test.

Use the standard `scripts/update-all-clients.sh` plan and explicit `--limit raspberrypi5` for mutation. The existing private Pi environment is outside this deployment. Keep a rollback image and persistent catalogue version; use the release role's rescue path rather than direct container manipulation. Validation budget for this DB/infrastructure work is 45 minutes of local checks and related investigation, excluding an already-running approved production deployment; retain hosted CI as the final broad check.

This revision extends the plan from local reuse to the user's approved production milestone. Implementation and deployment remain incomplete until their evidence is recorded.


Production implementation evidence (deployment still pending): the API job is registered in the existing scheduler leader at 03:00 Asia/Tokyo, limited to 24 recent eligible events and 20 minutes. DGX calls use the existing business runtime/lease and 45-second individual deadlines. Each source fragment is selected whole; assembly preserves source order. User rejection remains authoritative. A cancellation prevents a worker from activating its candidate.

The checker records each protected case as correct, missing or wrong. A gain cannot hide a newly wrong/lost known case. It retains a 90-run metric history and compares the current version with the initial reference and the preceding two comparable nights. Source changes require reference review. It also records daily answer-stage server p95 and the over-ten-second fraction from existing consultation diagnostics; at least five samples are needed for the live latency comparison. Those measurements exclude browser/network rendering and must not be labeled end-to-end UI time.

The production container is ARM64, has a 1400 MiB limit, two CPUs and an internal business-only network. The existing API SSD mount shares private job files; the service never accesses the private Pi. Main CI builds and attests its exact-SHA image; the standard launcher verifies provenance before Ansible starts it. Initial business seeds travel as six checksum-verified private files, never Git objects. Initialization preserves previously accumulated data. Ansible captures the previous image and restores it on release failure.

Read-only hardware evidence showed approximately 8 GiB total RAM and 4.4 GiB available on the actual business Pi. This differs from the user's stated 4 GiB configuration, so container memory constraints are tested explicitly rather than claiming a 4 GiB hardware run. Narrow checks passed: 78 initial API feature tests, 10 scheduler/nightly tests after membership update, 11 Python cache/checker tests, 38 standard-launcher tests, API build typecheck and targeted lint. The Docker rehearsal found and corrected a missing maintenance argument at server startup before production. Full-index rehearsal, hosted CI and deployment results follow below when completed.
