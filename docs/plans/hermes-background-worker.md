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

## Progress

- [x] 2026-09-15: Audited source export, scheduling, adoption, DGX admission and container boundaries.
- [x] 2026-09-15: Created isolated branch `feat/hermes-background-worker` from `0f38b6c1261305c1b1c0b0855cdbe24955823fd8` using the lifecycle CLI.
- [x] 2026-09-15: Reuse batch export evidence and hash all source fields; focused tests and ESLint passed. Full incremental export remains open.
- [ ] Define and implement bounded remote preparation submission, result identity, cancellation and retry through DGX resource admission.
- [ ] Separate calculation from local activation; verify interrupted/replayed work never commits twice or accepts stale sources.
- [ ] Add scoped production-schedule reading and deterministic evaluation through existing business services.
- [ ] Review, focused validation, CI, staged integration/deployment and production evidence.

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

## Plan of Work

### Milestone 1: Remove repeated reads without changing answers

Extract canonical source hashing into `business-hermes-source-identity.ts`. Add a batch-scoped `NightlySourceEvidence` containing authorized source records already returned by `exportBusinessHermesSources`. Duplicate identities during pagination fail rather than mix records. Missing references are rechecked through the current reader. Add a complete source revision to SourceDocument; existing source index identity changes safely and reuses text vectors. Tests must prove the same record produces the same evidence hash, removed sources require a fresh reader call, cancellation prevents reads, and a disposition-only update changes eligibility.

This reduces redundant detail queries; it is not complete incremental export. Before replacing full export, establish stable source generations and deletion/publication-change propagation through the business readers. Avoid an unchecked TTL cache.

### Milestone 2: Remote computation and safe resumption

Separate calculation from activation in the existing Python service. Define versioned inputs and outputs with a stable job ID, source/evaluation/model hashes and bounded payload sizes. Keep durable submission and adoption state on Pi. A repeated identical job returns its existing result; reuse of the ID with different input is rejected. Cancellation and a lost HTTP response cannot imply success. DGX stores only bounded temporary inputs/derived artifacts under an isolated worker owner; no private mounts or credentials are shared.

Extend the control-plane resource lifecycle to cover CPU preparation as well as model calls. Each work unit must finish or checkpoint before private compute starts; enforce host memory headroom in addition to container limits. Verify this on a bounded fixture before moving the production index. Establish exact route/schema and image ownership in the coordinated control-plane plan before edits there. No consumer deployment precedes this support.

### Milestone 3: Scoped table support

Use the existing production-schedule location adapter and query services for resolved schedule values. Preserve effective completion and part/order identity. Define typed relation keys, scope, source revision and freshness on the data boundary. Add a source adapter and independent deterministic checks for supported read-only queries. Do not let the model construct unrestricted SQL or certify its own answers. Latest schedules must be reread at answer time.

### Milestone 4: Integration and deployment

Run the narrow tests below, then required hosted CI on exact PR heads. For coordinated changes merge backward-compatible control-plane support first, business consumer second. Retain current production until remote retry/cancel/private-switch/source-change tests pass. Use standard deployment scripts; business Pi only is updated by this repo, DGX/private deployment belongs to control-plane. Record both exact SHAs, run IDs, raw terminal states, health, rollback and real batch progress. Restore the consumer before removing DGX compatibility if rollback is required.

## Concrete Steps

Work in `/Users/tsudatakashi/RaspberryPiSystem_002-worktrees/feat--hermes-background-worker`. Use the existing pnpm workspace. Run focused tests from `apps/api` with `pnpm exec vitest run src/services/assembly/business-hermes-nightly-source-evidence.test.ts src/services/assembly/business-hermes-nightly-preparation.test.ts src/services/assembly/business-hermes-nightly-candidates.test.ts src/services/assembly/business-hermes-mcp.service.test.ts`. Add the new test paths as they are created. Run ESLint on changed TypeScript files. Do not use production credentials for fixtures.

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

Milestone 1 removes redundant detail calls for exported records and detects metadata-only changes. Focused validation passed: 29 initial tests, then 21 affected tests after adding reader-parity and orchestration coverage; all 30 distinct tests passed. ESLint passed from apps/api (the initial root invocation lacked the app-local tsconfig and was corrected). No new deployment has occurred in this task. Remote job support and production-schedule integration remain open; the local-read optimization alone does not complete the overall request.

## Artifacts and Notes

The read-only audit before work is stored in the conversation workspace at `work/worker-implementation-audit-before.json`. Earlier audit measured source preparation around 19 seconds, generation around 7 seconds and later verification/index work around 21 seconds per four-record batch; these are stage timings, not pure CPU measurements.

Revision 2026-09-15: created this executable plan to preserve boundaries and the full remaining scope while starting with the observed repeated-read cost.
