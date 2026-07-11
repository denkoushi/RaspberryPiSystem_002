---
id: kiosk-leaderboard-first-display-performance-202607
status: active
scope: kiosk leader order board first fresh-row display latency
date: 2026-07-11
source_of_truth: true
related_code:
  - apps/api/src/services/production-schedule/leaderboard/leaderboard-composite-board.service.ts
  - apps/api/src/services/production-schedule/leaderboard/leaderboard-shell-snapshot-generation.ts
  - apps/api/src/services/production-schedule/production-schedule-query/leaderboard-shell.ts
  - apps/web/src/features/kiosk/leaderOrderBoard/useCompositeLeaderboardPhasedScheduleWithAutoAppend.tsx
  - scripts/perf/measure-kiosk-perf.mjs
related_docs:
  - docs/knowledge-base/KB-369-leader-order-board-api-internal-latency.md
  - docs/knowledge-base/KB-392-kiosk-leaderboard-spec-source-of-truth.md
  - docs/plans/leaderboard-defer-totals-performance-recovery.md
  - docs/decisions/ADR-20260706-kiosk-display-performance-optimizations.md
validation: local baseline complete; production-like Pi5 measurement awaiting approval
open_items:
  - Capture the current six-slot Pi5 API and Pi4 browser baseline after explicit approval.
  - Identify the single largest production wall-clock contributor before changing behavior.
  - Obtain explicit approval before any Pi measurement, runtime setting change, or deploy.
---

# Improve kiosk leaderboard first fresh-row display in small verified steps

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be updated whenever work stops or a decision changes. Maintain this document in accordance with `.agent/PLANS.md`.

## Purpose / Big Picture

Operators currently wait roughly ten seconds before fresh ranking items appear on the kiosk leader order board. The goal is to reduce first fresh-row display latency without showing an expired terminal cache and without changing row identity, order, totals, completion meaning, manual ranks, process-change residual handling, decorations, or edit behavior. Work proceeds one measured cause at a time so every change has an isolated effect and a simple rollback.

The target is a reduction of at least 30 percent in the median first-fresh-row time for the same six-slot scenario. A candidate change is retained only when it improves the median by at least 10 percent, does not worsen P95 by more than 10 percent, and returns the same row IDs, per-resource order, totals, and residual summary.

## Progress

- [x] (2026-07-11 00:00+09:00) Read repository safety, debugging, UI performance, and ExecPlan rules; inspected the board fetch, cache, rendering, performance logging, and OCR scheduler paths.
- [x] (2026-07-11 00:00+09:00) Confirmed the starting worktree is clean on `main` at `83df9fb4` before creating this plan.
- [x] (2026-07-11 10:25+09:00) Started disposable PostgreSQL `postgres-test-local` on port 5432, applied 144 migrations, and seeded the fixed 1,200-row, six-resource dataset under `tmp/perf-storage`.
- [x] (2026-07-11 10:28+09:00) Captured five-run local API/browser baseline with OCR scheduling disabled locally and server phase telemetry enabled.
- [x] (2026-07-11 10:30+09:00) Classified local API work: `resourceShell` dominates API phases, but the complete local path is far below the reported field latency, so no application optimization is justified from the Mac sample alone.
- [x] (2026-07-11 10:33+09:00) With explicit approval, reproduced a 28.01-second Pi5 API request, temporarily enabled phase logging, captured five stable profiled samples, then restored the log flag to OFF and confirmed API health `ok`.
- [x] (2026-07-11 10:34+09:00) Selected `processChangeResidualSummary` as the single production contributor and implemented only concurrent COUNT/representative-row reads; focused 17 tests and API build pass.
- [x] (2026-07-11 10:40+09:00) Repeated the fixed local five-run benchmark. API median improved 59 to 42 ms, while first-row median improved 579 to 552 ms; production-path retain/reject remains pending because the local seed has zero residual evidence and does not exercise the selected phase.
- [ ] Obtain explicit approval for a Pi5 API-only canary deployment, then repeat the real six-resource five-run measurement and apply the 10-percent/P95/response-equivalence gate.
- [ ] Implement one minimal optimization with focused regression tests.
- [ ] Repeat the identical benchmark and apply the retain/reject gate.
- [ ] Run focused and broader API/Web verification for a retained change.
- [ ] Stop before Pi access or deployment and request explicit approval with local evidence.

## Surprises & Discoveries

- Observation: expired IndexedDB snapshots are deliberately rejected after the five-minute freshness window and only complete snapshots are displayable.
  Evidence: `leaderboardBoardCacheConstants.ts`, `leaderboardBoardSwrDisplayPolicy.ts`, and `leaderboardBoardCacheRecord.ts` enforce the current contract. This plan does not change it.
- Observation: the aggregate shell waits for every selected resource shell and the residual summary before returning JSON.
  Evidence: `fetchLeaderboardCompositeBoardShell()` awaits nested `Promise.all` calls. Therefore one slow resource can determine first-row latency.
- Observation: existing opt-in client and API phase telemetry is sufficient for the first diagnostic pass.
  Evidence: `leaderboardPerf=1` records browser milestones and `LEADERBOARD_BOARD_PERF_LOG=true` records `processChangeResidualContext`, `resourceShell`, `processChangeResidualSummary`, `attachLabor`, and `requestTotal`.
- Observation: the full local performance harness also measures drawings and assembly pages and runs only three samples.
  Evidence: `scripts/perf/measure-kiosk-perf.mjs`. For this work, keep that harness for comparable regression evidence and add a leaderboard-only five-run mode only if repeated full-harness execution is too costly; do not change production behavior for measurement convenience.
- Observation: the performance seed could not run from `apps/api` because the external script's runtime import of `@raspi-system/shared-types` was compiled through the CommonJS registration path, while that package exports only an ESM `import` condition.
  Evidence: the initial command failed with `ERR_PACKAGE_PATH_NOT_EXPORTED`. Importing the specific source module by relative path restored the documented seed command; the complete seed then exited 0.
- Observation: the five-run local baseline is not representative of the reported ten-second wait. `leaderboard-first-rows` samples were 639, 579, 572, 603, and 549 ms (median 579 ms); direct `leaderboard-board` totals were 72, 51, 57, 74, and 59 ms (median 59 ms).
  Evidence: `tmp/perf-results/leaderboard-before.json` and the local API telemetry session.
- Observation: direct phase sampling still identifies `resourceShell` as the local API critical phase. Warm requests spent 30–39 ms at the slowest resource while generation token was 2–6 ms, materialized base resolution 3–4 ms, residual summary 0 ms, and attach-labor 1–2 ms.
  Evidence: five direct requests with `[leaderboard-board-performance]` enabled. The first post-idle sample was 126 ms total with a 98 ms slowest resource shell; subsequent request totals were 34–48 ms.
- Observation: the current Pi5 reproduced the field-scale delay before profiling: the real six-resource shell took 28.01 seconds and returned HTTP 200.
  Evidence: 2026-07-11 direct HTTPS request for resources `581,305,589,584,588,586`, `pageSize=50`, `includeLabor=false`, `includeDecorations=false`, and `deferTotals=true`.
- Observation: after the temporary API restart, five profiled HTTPS totals were 4.28, 3.89, 4.14, 3.77, and 3.66 seconds (median 3.89 seconds). In every sample, `processChangeResidualSummary` was the largest phase at 2.07–2.35 seconds. Generation-token initial read was 0.84–1.09 seconds and the slowest resource shell was resource `584` at 0.72–1.03 seconds.
  Evidence: Pi5 `[leaderboard-board-performance]` events. Residual materialization was a persisted hit with 219 evidence keys; the response contained four residual rows.
- Observation: the residual summary currently waits for its COUNT query before starting the representative-row query even though both use the same immutable inputs and neither query consumes the other's result.
  Evidence: `fetchLeaderboardProcessChangeResidualSummary()` performed `countResidualRowsByKeys()` and then `queryResidualRepresentativeRows()` sequentially.
- Observation: the after-change local benchmark improved `leaderboard-board` median from 59 to 42 ms (28.8 percent) and first-row median from 579 to 552 ms (4.7 percent). The API raw response size remained 661,729 bytes.
  Evidence: `tmp/perf-results/leaderboard-before.json` and `tmp/perf-results/leaderboard-after.json`. This is not a valid production-path acceptance result because the deterministic local seed has zero residual evidence, whereas Pi5 has 219 evidence keys and four returned residual rows.

## Decision Log

- Decision: show only fresh server data; do not extend the expired terminal-cache display window.
  Rationale: the user selected “最新だけ表示,” prioritizing operational correctness over instant stale display.
  Date/Author: 2026-07-11 / user and Codex.
- Decision: measure before editing the query or scheduler paths.
  Rationale: repository debugging rules require competing hypotheses to be separated, and previous production samples show different dominant phases under cold and warm conditions.
  Date/Author: 2026-07-11 / Codex.
- Decision: retain at most one performance mechanism per implementation commit.
  Rationale: isolated commits make causality, regression detection, and rollback reliable.
  Date/Author: 2026-07-11 / user and Codex.
- Decision: no production host access, environment edits, migrations, or deployment occur without a later explicit approval.
  Rationale: repository safety rules and the approved rollout boundary require a separate gate.
  Date/Author: 2026-07-11 / user and Codex.
- Decision: stop before changing leaderboard application code and request the planned Pi measurement approval.
  Rationale: local first-row latency is already 579 ms median, whereas the field symptom is around ten seconds. The historical production evidence also shows the correlated resource-first SQL was deliberately selected after a Pi5 `EXPLAIN` comparison, so replacing it from Mac-only evidence risks undoing a proven production optimization.
  Date/Author: 2026-07-11 / Codex.
- Decision: optimize only the residual-summary serialization by starting COUNT and representative-row SELECT concurrently.
  Rationale: this phase contributes roughly 53–61 percent of the stable Pi5 request wall clock. The queries are read-only and independent, and the change preserves their SQL, input evidence set, winner predicate, output count, representative ordering, and zero-result response behavior.
  Date/Author: 2026-07-11 / Codex.
- Decision: do not treat the local 4.7-percent first-row change as either production acceptance or rejection; hold the candidate uncommitted until an explicitly approved Pi5 API-only canary.
  Rationale: the selected phase is absent from the local dataset, so the local browser measurement primarily measures unrelated rendering noise. Pi5 is the only available environment that exercises the measured 2.07–2.35-second residual-summary path.
  Date/Author: 2026-07-11 / Codex.

## Outcomes & Retrospective

No application runtime behavior has changed. The local measurement foundation now supports an explicit five-run count and enables the existing browser milestone flag. The deterministic seed command also runs again. Current evidence is sufficient to reject speculative Mac-only application changes, but not sufficient to select the current production bottleneck; the next safe action is read-only Pi5/Pi4 measurement after explicit approval.

## Context and Orientation

The Web page `apps/web/src/pages/kiosk/ProductionScheduleLeaderOrderBoardPage.tsx` builds the selected device and ordered resource slots, then calls `useCompositeLeaderboardPhasedScheduleWithAutoAppend.tsx`. That hook issues one aggregate `GET /kiosk/production-schedule/leaderboard-board`. Fresh shell rows become usable immediately when that GET returns; background continue and decoration requests must not block first display.

The API orchestration lives in `leaderboard-composite-board.service.ts`. Before returning the shell it reads a generation token, resolves process-change residual evidence, evaluates each selected resource shell, and builds the residual summary. It already exposes optional per-phase telemetry through the route when `LEADERBOARD_BOARD_PERF_LOG=true`.

The local benchmark seed creates 1,200 leaderboard rows across resource codes `1` through `6`. `scripts/perf/measure-kiosk-perf.mjs` measures API transfer and browser first-row/full-board timing against that deterministic dataset. Results belong under ignored `tmp/perf-results/`, while concise evidence is copied into this plan.

## Plan of Work

First create an isolated local database using the repository test PostgreSQL workflow or an equivalent disposable `pgvector/pgvector:pg15` container. Apply migrations, seed the normal prerequisites, then run `scripts/perf/seed-kiosk-perf-data.ts` with storage under `tmp/perf-storage`. Start the API with `LEADERBOARD_BOARD_PERF_LOG=true` and background work that can distort the benchmark disabled only through existing test/local environment controls. Start the Web preview on port 4173. Do not reuse a production database or production storage.

Capture five fresh-browser leaderboard-first-row samples and five direct aggregate shell samples. Preserve the first sample as cold and the remaining samples as warm. Also run the existing full harness three times per scenario so results remain comparable with ADR-20260706. Save raw JSON and API logs under `tmp/perf-results/before/`. For each aggregate response, compute a stable fingerprint containing ordered row IDs, each resource code and total, overall total, and process-change residual total.

Classify the delay from evidence. If the gap before `board-get-start` exceeds one second, the first change is limited to the device/site/resource bootstrap path. If API `requestTotal` dominates and one phase accounts for at least 40 percent, optimize that phase. Within API phases, prefer the largest measured wall-clock contributor in this order only when durations are effectively tied within five percent: `resourceShell`, `processChangeResidualContext`, `processChangeResidualSummary`, then other phases. If samples overlapping drawing OCR are at least 20 percent slower than non-overlapping samples while the same API phase times inflate, isolate the OCR workload instead of changing ranking SQL. If browser `board-get-settled` to `grid-mounted` exceeds 250 ms while API time is stable, optimize Web derivation/rendering only. Record the selected path and evidence in `Decision Log` before editing code.

For a `resourceShell` result, profile only the slowest resource with `EXPLAIN (ANALYZE, BUFFERS)` against the disposable database. First reshape an existing query to use current indexes without changing predicates or order. Add an index only if the explain plan proves a scan dominates and the index is effective; place an index in a separate migration and separate commit. For generation/residual work, remove only repeated evaluation or unnecessary broad scans while preserving the same generation token inputs and snapshot invalidation meaning. For bootstrap work, combine or reuse existing lightweight device/resource data without coupling it to leaderboard results. For OCR contention, defer a queued OCR batch while an in-process leaderboard shell is active, then resume the unchanged queue after the request settles; never drop a queue item.

After the one change, repeat the identical commands and save results under `tmp/perf-results/after/`. Compare medians, an interpolated P95 over the five samples, response fingerprints, HTTP status, and error logs. Reject the change if it misses any gate. A rejected experiment is reverted as a whole and documented; it is not combined with another optimization to manufacture an improvement.

## Concrete Steps

All commands run from `/Users/tsudatakashi/RaspberryPiSystem_002` unless a command explicitly changes directory.

1. Record the starting state and confirm no overlapping work:

       git status --short
       git rev-parse --short HEAD

   Expected starting HEAD is `83df9fb4`; a non-empty status requires stopping before editing overlapping files.

2. Start a disposable PostgreSQL instance and apply migrations using the repository test database workflow. Record the chosen container name and port in `Progress`. Never point `DATABASE_URL` at a production address.

3. Seed deterministic performance data with storage under `tmp/perf-storage`:

       cd apps/api
       DATABASE_URL=postgresql://postgres:postgres@localhost:5432/borrow_return \
       PHOTO_STORAGE_DIR=/Users/tsudatakashi/RaspberryPiSystem_002/tmp/perf-storage \
       PDF_STORAGE_DIR=/Users/tsudatakashi/RaspberryPiSystem_002/tmp/perf-storage \
       pnpm exec tsx ../../scripts/perf/seed-kiosk-perf-data.ts

   Expect `leaderboardRowCount` to be 1,200 in `tmp/perf-storage/perf-seed-manifest.json`.

4. Start local API and Web processes in separate sessions with the same database and storage. Keep `LEADERBOARD_BOARD_PERF_LOG=true` only for the measurement session. Capture logs under `tmp/perf-results/before/`.

5. Run the unmodified harness:

       node scripts/perf/measure-kiosk-perf.mjs tmp/perf-results/before/full.json

   Then run the leaderboard-only five-sample procedure defined during the measurement step. If a small harness option is required, add tests or a self-contained script option before changing application code and commit it separately as diagnostics only.

6. Document the dominant phase and select exactly one implementation path according to `Plan of Work`. Update `Progress`, `Surprises & Discoveries`, and `Decision Log` before application edits.

7. Implement and test the single optimization. Re-run the exact benchmark into `tmp/perf-results/after/` and compare response fingerprints before broader validation.

8. For a retained change, run focused tests first, then API/Web lint and build. Exact test files depend on the measured path, but must include aggregate board generation/snapshot/continue tests and the Web composite/cache/display tests listed under validation.

9. Restore local measurement flags, stop the temporary services, and remove only disposable containers/volumes created by this plan. Do not delete repository or user data.

## Validation and Acceptance

The baseline and after-run must use the same commit except for the one intended optimization, the same seed manifest, resource order, viewport, and sample procedure. Acceptance requires all of the following:

- First-fresh-row median improves by at least 10 percent for retaining an individual change; the overall target is 30 percent.
- Five-sample P95 does not worsen by more than 10 percent.
- Ordered row IDs, per-resource totals and order, overall total, and residual total match exactly.
- No expired terminal cache is shown.
- Initial rows do not wait for continue or decorations.
- API tests cover board generation, snapshot, continue cursor, completion filter, and split flag OFF behavior.
- Web tests cover the composite hook, terminal-cache freshness policy, display ordering, and virtual rows.
- Focused commands pass, followed by:

       pnpm --filter @raspi-system/api lint
       pnpm --filter @raspi-system/api build
       pnpm --filter @raspi-system/web lint
       pnpm --filter @raspi-system/web build
       git diff --check

No local benchmark alone authorizes production rollout. Before Pi access, report the before/after samples, selected cause, exact diff scope, rollback, and remaining risks to the user.

## Idempotence and Recovery

The performance seed is designed to skip already-complete PERF data and re-seed a partial PERF set. Use only the disposable database. Raw benchmark output is replaceable and remains under ignored `tmp/`. Every application experiment is isolated to one commit or one uncommitted patch; if it fails the gate, reverse only that patch without touching unrelated work.

Do not run destructive Git commands. Do not reset a dirty tree. Do not deploy or edit Pi environment files in this plan without explicit approval. Restore `LEADERBOARD_BOARD_PERF_LOG` to off after every measurement session, including failed sessions.

## Artifacts and Notes

Store raw local artifacts in:

    tmp/perf-results/before/
    tmp/perf-results/after/
    tmp/perf-storage/perf-seed-manifest.json

Copy only concise medians, P95 values, phase totals, response fingerprints, and relevant error lines into this plan. Do not commit generated images, database volumes, full logs, client keys, or secrets.

## Interfaces and Dependencies

The initial implementation must preserve all existing HTTP request and response schemas. Reuse the existing Fastify, Prisma, React Query, IndexedDB, Playwright, and performance logging facilities. Do not add a package. Any helper introduced for timing, request activity, or response fingerprinting must be internal and must not expose client keys, row contents, or personal data in logs.

Revision note (2026-07-11): Initial ExecPlan created from the user-approved latest-only, one-cause-at-a-time rollout plan and current repository inspection.
