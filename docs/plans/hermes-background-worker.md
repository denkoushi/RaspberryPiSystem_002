---
id: hermes-background-worker
title: Delegate bounded Hermes preparation to DGX
status: in-progress
last_verified: 2026-09-15
---

# Delegate bounded Hermes preparation to DGX

## Purpose / Big Picture

The business Pi owns source records, visibility, accepted answers and durable progress. DGX supplies isolated computation. Reduce repeated source reads before moving CPU-heavy preparation to a dedicated DGX worker. Retain business-first inference, manual private switching, verified source answers and recovery after interruption. Different information tables must use their existing business readers; production schedules require current scoped data, not old generated answers.

This living plan follows `.agent/PLANS.md`. Approval on 2026-09-15 permits proceeding with the staged implementation; do not request the same approval again. Never claim an incomplete milestone is production-ready.

## Follow-up: JEV record search state connection (2026-09-21)

This bounded follow-up covers nonconformity search only. The connection order is: natural-language input → JEV intent delta plus code-owned exact-value resolution → validated `SearchDelta` → session-owned `SearchState` update → existing search path → original-record display. The API and Node24 worker must carry the structured state; prior natural-language history is context only and cannot be the source of truth. Exact-only conditions must reuse the existing PostgreSQL/read-service path and include all current valid records, including unclassified records. No new search framework, source connection, classification-store migration, multi-source connection, PR, merge, or deploy is part of this milestone.

User-visible completion requires the three existing turns, `三島工場の不適合2件。直近`, another organization and wording, condition replacement, condition removal, an unresolved condition, and an explicit new search to be exercised through the real API/session/worker/JEV route. For each turn, evidence must compare the before-state, accepted delta, after-state, and result metadata without logging raw records or secrets. Exact conditions must intersect semantic conditions over the full source set before applying limit/sort. Record-condition classification errors remain separately reported from successful state retention. The milestone remains incomplete until the actual screen acceptance is performed.

## Follow-up: shared organization scope and ambiguity (2026-09-22)

This follow-up keeps the same worker, `SearchState`, source definitions, and live PostgreSQL/read-service boundary. The common rule is that code owns authorized candidate discovery, exact organization scope, state transitions, and retrieval; JEV only supplies narrow semantic judgments. A formally resolved department is a set of matching effective origin-department values, not a Choice that selects one record or one factory. A factory is an independent scope condition: it is preserved when a department is refined, and can be removed without removing the department condition. Only an absent formal value or a genuinely different unresolved interpretation returns confirmation; multiple same-named departments across factories do not.

The shared ambiguity policy is `detect ambiguity → evaluate search impact → continue as a set, resolve with an existing SearchState condition, or confirm`. A candidate set is safe to continue when it preserves the reading intent; an existing confirmed condition may narrow the set even when the current wording has several candidates; an interpretation that changes the target, and an unknown term whose meaning cannot be resolved, requires confirmation. This policy is domain-neutral and is not a department-specific exception. It does not infer correctness from a typed JEV value or from the number of returned records.

The change is limited to `scripts/hermes-search/hermes-jev-record-classifier.mjs`, the small domain-neutral `hermes-resolution-policy.mjs`, `scripts/hermes-search/hermes-search-state.mjs`, their focused tests, and the existing exact-search handoff tests as needed. Candidate discovery must continue to use the complete current authorized snapshot, not displayed rows or saved classifications. Exact searches must continue through `HermesSearchTrialService` and `BusinessHermesMcpService` against current PostgreSQL data, including unclassified records, before applying date ordering and the requested limit. Representative acceptance cases are fixed: new `資材課` recent one-result search without a factory; department refinement after a factory is set; wording/department/limit changes through the same generic path; factory removal retaining the department; a newly added same-named department in another factory; and a truly unknown organization term returning confirmation. A small set of non-matching wording cases remains regression coverage and does not expand the acceptance list.

## Progress

- [x] 2026-09-15: Audited source export, scheduling, adoption, DGX admission and container boundaries.
- [x] 2026-09-15: Created isolated branch `feat/hermes-background-worker` from `0f38b6c1261305c1b1c0b0855cdbe24955823fd8` using the lifecycle CLI.
- [x] 2026-09-15: Reuse batch export evidence and hash all source fields; focused tests and ESLint passed. Full incremental export remains open.
- [x] 2026-09-15: PR #1418 merged as `97997021f6cd013e94f3e1981948e9b935f2a730`; Pi5 deployment `20260915-031014-793110` completed (`active/exited/success/0`, recap 219 ok, 27 changed, no failures or unreachable hosts). Four initial batches succeeded with protected 22/26, wrong 0.
- [x] 2026-09-15: Internal source reader uses 200-record pages; interactive tool limit remains 20. Focused 25 TypeScript tests and ESLint passed; PR #1419 merged as 693f5e2f1f348a10310c8e21275ca3d3d2dfdc59 and Pi5 deployment 20260915-041423-f0f4dc completed successfully. Initial five batches passed, adding 20 facts and 38 wordings.
- [x] 2026-09-15: Profiled catalogue validation and replaced per-record regex compilation with a literal scope prefix plus the unchanged fixed grammar. 32 Python tests passed. Isolated Pi comparison over 2,206 records produced identical catalogues; three alternating runs per version measured median 0.900 seconds before and 0.121 seconds after.
- [x] Implement bounded remote index submission and verified artifact installation locally; coordinated control-plane support is on feat/hermes-preparation-worker.
- [ ] Integrate and deploy the remote index path after the supporting DGX release is verified.
- [x] Keep calculation separate from Pi certification/activation. Add a post-computation authorized source export comparison and a run/source-hash-bound authorization step; changed or removed sources defer without consuming progress. Focused Python and TypeScript checks passed.
- [ ] Add scoped production-schedule reading and deterministic evaluation through existing business services.
- [ ] Review, focused validation, CI, staged integration/deployment and production evidence.
- [x] 2026-09-22: Recorded the shared organization-scope rules, affected modules, and fixed representative cases for the JEV follow-up.
- [x] 2026-09-22: Added the domain-neutral ambiguity-impact policy and applied it to organization candidate sets, prior SearchState scope, and unresolved terms; focused regressions pass locally.
- [ ] 2026-09-22: Complete real JEV/API/DB handoff and floating-chat acceptance for the fixed representative cases.

## Context and Orientation

`apps/api/src/services/assembly/business-hermes-nightly.service.ts` exports every source, selects four records, rereads catalogue references, asks DGX for up to two allowed aliases, writes immutable batch files and invokes `/maintenance/start`. `services/hermes-answer-cache/runtime.py` starts a local Python subprocess using those shared files and atomically switches `active.json`. `maintenance.py` and `facts.py` verify source-only facts and protected reference answers. The API rereads live details before returning cached answers.

The separate repository `/Users/tsudatakashi/DGXSparkControlPlane` owns admission, leases, private controls and DGX deployments. Its existing `/v1/hermes-search/*` API is synchronous model-only computation, not durable jobs. `agents/dgx/dgx_control/inference_admission.py` admits background calls only in spare capacity. `arbiter.py` drains admitted calls before private switching. A new CPU worker must participate in this boundary; merely starting a container does not provide cancellation.

## Surprises & Discoveries

Source search already returns the full fields required by detail and factual verification, but export discards them and preparation rereads about two thousand references per four-record batch. SourceDocument previously omitted disposition and other metadata, so changes outside the search text did not trigger immediate eligibility. These are distinct from inference speed.

Remote work cannot use the current local PID/flock/shared-path assumptions. Existing tests prove local cancellation and embedding retry, not a remote job lifecycle. Existing source-only certification covers two kinds; arbitrary multi-table reasoning is not yet certified.

## Decision Log

2026-09-15, Codex: Start with batch-owned source evidence, retaining the current authorized reader and live answer checks. Use complete source revision hashes. Do not introduce a cache with an arbitrary freshness timeout. An export is not claimed to be a transactional DB snapshot.

2026-09-15, Codex: Keep source fingerprinting as a pure module so source adapters do not depend on HTTP/cache code. Retain the existing exported function for current callers.

2026-09-15, Codex: Keep adoption and evidence checks on the business Pi. A remote worker receives bounded input and returns reconstructible output; it never gets database credentials or host Docker control. Add supporting DGX contract before enabling the business consumer. Reuse Docker and existing admission rather than add a cluster platform.

2026-09-22, Codex: Represent organization ambiguity by unresolved meaning, not by the cardinality of the authorized match set. Keep facility and department terms in the existing organization state fields; derive the next candidate pool from the prior facility terms, never from the prior department values. On facility removal, recompute the department against the full authorized snapshot and retain only the department terms. This preserves the existing SearchState schema while making exact arguments express the same set at the live reader boundary.

2026-09-22, Codex: Make ambiguity impact explicit and reusable: `candidate_set` can continue as a set, a confirmed existing condition can resolve its scope, and only meaning-unresolved or scope-changing interpretations confirm. Keep the policy separate from organization names so later condition resolvers can reuse it without adding source-specific exceptions.

## Plan of Work

### Milestone 1: Remove repeated reads without changing answers

Extract canonical source hashing into `business-hermes-source-identity.ts`. Add a batch-scoped `NightlySourceEvidence` containing authorized source records already returned by `exportBusinessHermesSources`. Duplicate identities during pagination fail rather than mix records. Missing references are rechecked through the current reader. Add a complete source revision to SourceDocument; existing source index identity changes safely and reuses text vectors. Tests must prove the same record produces the same evidence hash, removed sources require a fresh reader call, cancellation prevents reads, and a disposition-only update changes eligibility.

This reduces redundant detail queries; it is not complete incremental export. Before replacing full export, establish stable source generations and deletion/publication-change propagation through the business readers. Avoid an unchecked TTL cache.

### Milestone 2: Remote computation and safe resumption

Keep evaluation and adoption on the Pi where queries are served. Moving the entire maintenance process would measure DGX latency instead and incorrectly transfer adoption authority. Move source SQLite/FAISS construction and question GPTCache construction/flush through a `RemotePreparation` adapter in `services/hermes-answer-cache/preparation.py`. The existing egress allowlist adds only `/v1/hermes-search/prepare`; the Pi release delivers that proxy update together with the consumer. The adapter installs only complete verified artifacts; `QuestionCache` and `SourceCandidates` then use their existing readers and checks. The pending consumer PR sets `business_hermes_remote_preparation_enabled=true` for Pi5; the release role delivers `ANSWER_CACHE_REMOTE_PREPARATION` to the cache container. Do not merge/deploy this enabling consumer until control-plane support has passed live verification. Its absence/false preserves the existing local builder for rollback.

The exact resource contract is recorded in the control-plane plan `docs/exec-plans/hermes-index-preparation.md` on branch `feat/hermes-preparation-worker`. POST `/v1/hermes-search/prepare` uses the existing egress/token and is forced to priority 10. The immutable job ID hashes a manifest of ordered chunk hashes, row count and index kind. Inputs contain text and pinned MiniLM vectors (plus canonical question labels for GPTCache), never final answers or credentials. Requests contain at most 128 rows/512 KiB. DGX closes artifacts and returns their exact names, sizes and hashes; Pi downloads bounded chunks, verifies everything, then installs. There is one disposable worker under the existing Unix supervisor/container, with a 20-second work-unit deadline, 256 MiB scratch bound and 60-second idle expiry. Private unload terminates it and removes scratch.

Durable embeddings remain checkpointed on Pi using the existing eight-text requests. Existing source-index vectors from before the HTTP checkpoint database are also reused for identical text, avoiding an unnecessary model pass over the full corpus. A lost DGX scratch requires replay of index inserts, but completed embedding calculation is reused. No client-side adoption follows a deferred, interrupted or corrupt response. The existing local maintenance subprocess and cancellation marker remain authoritative. Pi source recheck now occurs after computation: repeat the authorized export and compare complete record revisions with the prepared export. A mismatch cancels and defers the batch. Only a matching run ID/source-file hash authorization permits the request process to apply its existing base/evaluation/fact/source checks and atomic active pointer. This is a recheck, not a cross-database transaction; answer-time live-source verification remains mandatory.

The future retention of old Pi job/index generations and incremental export are not silently included here. DGX scratch needs no durable recovery and cannot become a new data authority.

### Milestone 3: Scoped table support

Use the existing production-schedule location adapter and query services for resolved schedule values. Preserve effective completion and part/order identity. Define typed relation keys, scope, source revision and freshness on the data boundary. Add a source adapter and independent deterministic checks for supported read-only queries. Do not let the model construct unrestricted SQL or certify its own answers. Latest schedules must be reread at answer time.

### Milestone 4: Integration and deployment

Run the narrow tests below, then required hosted CI on exact PR heads. For coordinated changes merge backward-compatible control-plane support first, business consumer second. Retain current production until remote retry/cancel/private-switch/source-change tests pass. Use standard deployment scripts; business Pi only is updated by this repo, DGX/private deployment belongs to control-plane. Record both exact SHAs, run IDs, raw terminal states, health, rollback and real batch progress. Restore the consumer before removing DGX compatibility if rollback is required.

## Concrete Steps

For remote preparation, work in `/Users/tsudatakashi/RaspberryPiSystem_002-worktrees/feat--hermes-remote-preparation`. Use the existing pnpm workspace. Run focused tests from `apps/api` with `pnpm exec vitest run src/services/assembly/business-hermes-nightly-source-evidence.test.ts src/services/assembly/business-hermes-nightly-preparation.test.ts src/services/assembly/business-hermes-nightly-candidates.test.ts src/services/assembly/business-hermes-mcp.service.test.ts`. Add the new test paths as they are created. Run ESLint on changed TypeScript files. Do not use production credentials for fixtures.

Deployment validation budget is 45 minutes of local validation; hosted CI provides broad checks. Follow the standard wrapper plan and exact-host deploy from `docs/guides/deployment.md`. Keep production unchanged if a required boundary is unverified.

After each merged business task use `python3 -m scripts.git_lifecycle.cli finish --worktree <exact-path> --pr <number>`, then `audit --json`. Never clean or reset user WIP. The control-plane primary contains unrelated character-chat edits and must remain intact.

## Validation and Acceptance

A four-document batch must avoid extra detail database calls for references already present in its authorized export. Changes to any evidence field must make the source eligible. Old/removed/private records must never become visible by reusing prepared content. Existing protected 26-question verdicts and per-question latency gates must remain intact.

A remote job must tolerate repeated submission, disconnection, cancellation, worker restart and manual private selection without double adoption. Pi validates the returned generation and current authorization before commit. Test source updates/deletions and scope restrictions. If remote preparation is unavailable, pause safely and retain active answers; do not bypass private ownership.

Measure actual end-to-end batch duration and preparation backlog. GPU utilization alone is not the acceptance metric. Do not claim all corpus records are prepared based on a few successful batches.

## Idempotence and Recovery

Keep current source files, active/previous pointers and bounded embedding checkpoints. Never delete active, previous or running-job artifacts. A cleanup policy must first establish the complete set of referenced generations. Pin model and serialization versions for cross-host derived indexes and verify results before activation.

## Interfaces and Dependencies

`NightlySourceEvidence.add(record)` owns a serialized authorized record for a single batch; `read(ref, reader, signal)` reuses it or delegates missing references. `sourceFingerprint(value)` is pure and deterministic. `SourceDocument.revision` identifies all source fields separately from the searchable text. No new package is required for the first milestone.

## Outcomes & Retrospective

Milestone 1 removes redundant detail calls for exported records and detects metadata-only changes. Focused validation passed: 29 initial tests, then 21 affected tests after adding reader-parity and orchestration coverage; all 30 distinct tests passed. ESLint passed from apps/api (the initial root invocation lacked the app-local tsconfig and was corrected). PR #1418 is deployed on Pi5; the first four batches succeeded. Initial median cycle was 43.4 seconds (3 intervals), versus 48.1 seconds across 18 earlier intervals; source preparation still takes about 15 seconds. These are preliminary non-concurrent measurements, not a controlled load benchmark. Remote job support and production-schedule integration remain open; the local-read optimization alone does not complete the overall request.

## Artifacts and Notes

The read-only audit before work is stored in the conversation workspace at `work/worker-implementation-audit-before.json`. Earlier audit measured source preparation around 19 seconds, generation around 7 seconds and later verification/index work around 21 seconds per four-record batch; these are stage timings, not pure CPU measurements.

Revision 2026-09-15: created this executable plan to preserve boundaries and the full remaining scope while starting with the observed repeated-read cost.

Revision 2026-09-15: after the first production measurement, continue the same milestone with internal 200-record source pages. Reuse the existing visibility and serialization logic; do not expose a larger MCP tool limit. Full incremental export and transactional source generations remain open.

Revision 2026-09-15: the source-page follow-up also removes measured regex compilation overhead in catalogue validation. It does not change the accepted grammar, source facts, model or certification rules.

Revision 2026-09-15: implement remote index construction while retaining Pi latency evaluation/adoption, and add a fresh authorized source comparison before activation. The full authenticated HTTP canary must run after the Pi egress update, following a healthy DGX release. Real cross-repository child-process validation preserved nine source rankings over 257 records and ten question lookups; release integration and production enablement remain pending.
