# SOLID Refactor Phase 6 ExecPlan: final route prisma cleanup (kiosk services, rigging tag service, unified inventory list service)

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document must be maintained in accordance with `.agent/PLANS.md`.

- id: solid-refactor-phase6-execplan-202607
- status: completed; implementation `d669dc53`; CI green (CI `28723350855`, CodeQL `28723350866`, Secret scan `28723350876`, Pages `28723350512` all success); production deploy not yet run (awaiting explicit user request)
- scope: the last 6 non-test route files importing `lib/prisma` directly (`kiosk/config.ts`, `kiosk/support.ts`, `kiosk/signage-preview.ts`, `kiosk/call-targets.ts`, `rigging/index.ts`, `tools/unified/list.ts`); new small services under `services/kiosk/`, `services/rigging/`, `services/tools/`; characterisation integration tests for the two untested routes
- date: 2026-07-05
- source_of_truth: this file
- related_docs: docs/plans/solid-refactor-phase5-execplan-202607.md (phase 5, deployed `d5c26eb1`, run `20260705-071343-12926`), docs/plans/solid-refactor-phase4-execplan-202607.md, docs/guides/deployment.md

## Purpose / Big Picture

Phases 1–5 decomposed god files behind facades and reduced direct `lib/prisma` imports in route files from 26 to 6. Phase 6 finishes the route layer: after this phase, `rg -l "from ['\"].*lib/prisma" apps/api/src/routes | rg -v __tests__` must return NOTHING. A read-only exploration (2026-07-05) mapped the 6 files precisely: 18 prisma call sites (13 reads / 5 writes), no `$transaction`.

1. **Kiosk quartet (Step K1)**: `config.ts` / `support.ts` / `signage-preview.ts` / `call-targets.ts` each get a small cohesive service in `services/kiosk/` (`kiosk-config.service.ts`, `kiosk-support.service.ts`, `kiosk-signage-preview.service.ts`, `kiosk-call-targets.service.ts`). Guarded by 17 existing integration cases in `routes/__tests__/kiosk.integration.test.ts`. Error codes differ per file (`CLIENT_KEY_INVALID` in support vs `INVALID_CLIENT_KEY` elsewhere) and MUST stay byte-identical.
2. **Rigging tags (Step G1)**: `rigging/index.ts` tag CRUD (replace-semantics POST, raw DELETE) moves into a new `services/rigging/rigging-gear-tag.service.ts` shaped like `measuring-instruments/tag.service.ts` but honoring the replace semantics (`replaceTagForGear`). The inline `allowClientKey` copy adopts `client-device-auth.service`. Route-level coverage is ZERO today, so characterisation integration tests are written FIRST.
3. **Unified inventory list (Step U1)**: `tools/unified/list.ts` composes `ItemService` / `MeasuringInstrumentService` / `RiggingGearService` plus two bulk tag reads; extraction target is `services/tools/unified-inventory-list.service.ts`. Coverage is ZERO and the route has dual auth (x-client-key OR JWT) — characterisation integration tests are written FIRST.

All steps are behavior-preserving. Success is observable by identical test results before and after each step, plus exactly the new characterisation-test files.

Out of scope (unchanged from phase 5 defers): `webrtc/signaling.ts` WS state-machine design pass (prisma already removed), tools `LoanService` internals.

## Progress

- [x] (2026-07-05 08:05+09:00) Working tree confirmed clean on `main` at `50a2a0b4` (phase 5 merged, deployed, verified PASS 45/0/0).
- [x] (2026-07-05 08:07+09:00) Web baseline green: 249 files / 1,245 tests (= phase-5 final).
- [x] (2026-07-05 08:07+09:00) Read-only exploration of the 6 target files completed (A–G report; key findings in `Context and Orientation`).
- [x] (2026-07-05 08:10+09:00) API baseline green: Test Files 414 passed | 2 skipped (416), Tests 2122 passed | 9 skipped (2131) = phase-5 pre-CI-fix baseline (412/2,098+9skip) + exactly the 24 A6 characterisation tests. (The `d5c26eb1` CI record shows 2124/7 because 2 conditionally-skipped tests ran there; totals identical at 2131.)
- [x] (2026-07-05 08:16+09:00) Step K1 done (worker subagent): 4 new services (`kiosk-config.service.ts` 56, `kiosk-support.service.ts` 37, `kiosk-signage-preview.service.ts` 54, `kiosk-call-targets.service.ts` 24 lines); 4 routes prisma-free (config 100→67, support 91→82, signage-preview 99→78, call-targets 78→68; −73 lines total). Auth lookups reuse `client-device-auth.service` (`findClientDeviceByApiKey` re-exported; signage target check wraps `findClientDeviceIdRecordByApiKey`); error codes unchanged (`CLIENT_KEY_INVALID` in support preserved). Verified by worker: tsc clean, full API suite = baseline exactly (414/2,122), lint clean, remaining route prisma-importers = rigging/index.ts + tools/unified/list.ts only. Orchestrator verified: diffs pure delegation, where/select/data byte-identical. Accepted log-only deviation in config.ts: 'Client device lookup result' now logs after the lastSeenAt update and also when no clientKey is present (HTTP contract unchanged; 17 kiosk integration cases green).
- [x] (2026-07-05 08:24+09:00) Step G1 done (worker subagent): Stage 1 characterisation tests written FIRST against unmodified routes and verified green (`routes/__tests__/rigging-tags.integration.test.ts`, 179 lines / 6 cases: POST replace incl. old-row-gone assert, DELETE happy, DELETE nonexistent → CURRENT behavior locked as 400 + errorCode P2025 via global error handler (not 500 as guessed), client-key 200/403 CLIENT_KEY_INVALID/401 CLIENT_KEY_REQUIRED). Stage 2: new `services/rigging/rigging-gear-tag.service.ts` (15 lines; `RiggingGearTagService.replaceTagForGear` deleteMany→create order preserved, `deleteTag` raw delete preserved), barrel export added; `allowClientKey` → `assertKioskApiClientKeyValid` (orchestrator confirmed byte-identical parse logic and error contract in auth hub); `routes/rigging/index.ts` 201→179, prisma-free. Stage-1 tests passed UNCHANGED. Verified: tsc clean, full API suite 415 files / 2,128 tests (= baseline + exactly 1 file / 6 tests), lint clean, remaining route prisma-importer = tools/unified/list.ts only.
- [x] (2026-07-05 08:34+09:00) Step U1 done (worker subagent): characterisation tests `routes/__tests__/tools-unified.integration.test.ts` (215 lines / 5 cases: JWT mixed 3-domain result with tag UIDs and ja sort, valid client-key 200, invalid client-key 401 INVALID_CLIENT_KEY, no auth 401 AUTH_TOKEN_REQUIRED, category filters). New `services/tools/unified-inventory-list.service.ts` (152 lines; `UnifiedInventoryListService.list()` with private bulk tag-map readers, `UnifiedItem` type moved+re-exported); route 176→43 (Zod parse + dual-auth preHandler only; local normalizeClientKey replaced by `parseKioskApiClientKeyHeader` + `findClientDeviceIdRecordByApiKey`, error contract identical). Verified by worker: tsc clean, full API suite 416 files / 2,133 tests (= baseline + 2 files / 11 tests), lint clean, route prisma-importers = ZERO. Orchestrator note: the worker reported the Stage-2 extraction "pre-existed as WIP" at its start — contradicted by G1's final check (list.ts was still a prisma importer at 08:24); judged worker context-compaction confusion. Because the tests-first gate could not be trusted for this step, the orchestrator independently diffed the extracted service against `git show HEAD:.../list.ts` line by line: category branching, findAll params, tag first-only map logic, field mappings (incl. `category: null` for instruments, `gear.department ?? null`), ja-locale sort, and auth parse/error contract are all faithful. `unifiedQuerySchema` defaults category to 'ALL', so the service's `?? 'ALL'` fallback is unreachable but harmless.
- [x] (2026-07-05 08:40+09:00) Final verification (orchestrator): `rg -l "from ['\"].*lib/prisma" apps/api/src/routes | rg -v __tests__` → ZERO files (route-layer goal achieved). Full API suite (U1 worker run) 416 files / 2,133 tests = baseline + exactly 2 new test files / 11 new tests. Web suite re-run: 249 files / 1,245 tests (= phase-5 final; web untouched). `git diff --check` clean. Test container `postgres-test-local` and its anonymous volume removed; pre-existing dangling volumes untouched.
- [x] (2026-07-05 08:44-10:19+09:00) Committed and pushed to `origin/main`: `d669dc53` (`refactor: eliminate remaining direct prisma imports from route layer`; 17 files, +942/−294; pre-commit lint hook passed). GitHub Actions all green for `d669dc53`: CI `28723350855` success (watched to completion, ~95 min), CodeQL `28723350866` success, Secret scan `28723350876` success, Pages `28723350512` success. docs/INDEX.md link added in the same commit. Production deploy intentionally not run — awaiting explicit user request.

## Surprises & Discoveries

- (2026-07-05) The rigging tag POST is a REPLACE (deleteMany → create), not an add like measuring-instruments; the same replace logic already exists inside `RiggingGearService.update` (L112–119). The new tag service must preserve replace semantics, not copy measuring's add semantics.
- (2026-07-05) Auth error codes are inconsistent across kiosk routes (`CLIENT_KEY_INVALID` vs `INVALID_CLIENT_KEY`); behavior preservation requires keeping each file's exact code even after delegating lookups to the shared auth service.
- (2026-07-05) DELETE `/api/rigging-gear-tags/:tagId` with a nonexistent id returns 400 + errorCode P2025 (global error handler maps Prisma known errors), not the raw 500 the exploration guessed; the characterisation test locks the actual behavior.
- (2026-07-05) The U1 worker misreported the Stage-2 extraction as "pre-existing WIP" (context-compaction confusion; G1's final rg check proved list.ts was still a prisma importer minutes earlier). Orchestrator compensated with an independent line-by-line diff of the extracted service against `git show HEAD` — worker self-reports about repo history need cross-checking against orchestrator-held evidence.

## Decision Log

- Decision: Scope phase 6 to the 6 remaining prisma-importing route files; defer `webrtc/signaling.ts` slimming and tools `LoanService` internals again.
  Rationale: Completes the measurable route-layer goal (zero direct prisma imports) with tightly-scoped mechanical work; the deferred items are genuine design passes.
  Date/Author: 2026-07-05 / Fable 5 (orchestrator)
- Decision: Execute the three steps SERIALLY (K1 → G1 → U1), each verified with the full API suite before the next starts.
  Rationale: Same as phase 5 — all touch apps/api and share the single disposable Postgres DB; the suite enforces `fileParallelism: false`.
  Date/Author: 2026-07-05 / Fable 5
- Decision: For the two untested routes (rigging tags, unified list), characterisation integration tests are written and verified green against the CURRENT implementation before any extraction, mirroring the phase-5 A6 gate.
  Rationale: Zero coverage means no safety net; tests-first makes the extraction provably behavior-preserving.
  Date/Author: 2026-07-05 / Fable 5
- Decision: G1 before U1 so the rigging tag service's bulk-read API can be reused by the unified list service if shapes align.
  Rationale: Explorer recommendation; avoids designing the same bulk tag lookup twice.
  Date/Author: 2026-07-05 / Fable 5
- Decision: Route-side auth seams keep their exact per-file error codes and response shapes; only the prisma lookups move into `client-device-auth.service` functions.
  Rationale: Kiosk contracts are visible to devices in the field; phase-5 precedent.
  Date/Author: 2026-07-05 / Fable 5

## Outcomes & Retrospective

All three steps landed with zero behavior change, verified against the recorded baseline:

- Route layer: direct `lib/prisma` imports in non-test route files reduced from 6 to ZERO — the goal carried since phase 3 is complete. Four small kiosk services (`kiosk-config`, `kiosk-support`, `kiosk-signage-preview`, `kiosk-call-targets`), one rigging tag service (`RiggingGearTagService`, replace semantics preserved), and one composition service (`UnifiedInventoryListService`) now own the persistence calls; routes keep Zod parsing, auth boundaries, and presentation policy (stale threshold, env excludes).
- Test debt: the two previously untested route surfaces (rigging tags, unified inventory list) gained 11 characterisation integration cases locking current behavior, including the non-obvious 400+P2025 delete contract.

Acceptance met: API suite 416 files / 2,133 tests = baseline 414/2,122 + exactly the 2 new test files / 11 new tests; web suite 249/1,245 identical to phase-5 final (web untouched); typecheck and lint clean after every step; `git diff --check` clean. Disposable test container and its anonymous volume removed.

Retrospective notes:

- The tests-first gate again proved its worth in an unexpected way: when the U1 worker's self-report about repo state was unreliable, the orchestrator could fall back to an independent HEAD-vs-extraction diff because the acceptance criteria were defined in terms of observable behavior, not worker claims.
- Serializing workers on the shared test DB remained the right call (same as phases 4–5).

Remaining hotspots for future phases (unchanged): `webrtc/signaling.ts` WS state-machine design pass, tools `LoanService` internals (580 lines).

## Context and Orientation

The system is a pnpm monorepo: `apps/api` (Fastify 5 + Prisma 5 + Zod + vitest, suite runs serially against one disposable Postgres), `apps/web` (React 18 + Vite). "Facade" = original file path keeps exporting the same public symbols; import sites and `vi.mock` paths do not change.

### Exploration findings (2026-07-05, read-only)

- `kiosk/config.ts` (100): GET `/api/kiosk/config`. 3 prisma sites: `clientDevice.findUnique` by apiKey (optional auth — no key still 200 with defaults), `clientDevice.update` lastSeenAt, `clientStatus.findUnique`. Already uses `kiosk-header-tab-order.service`. 4 integration cases.
- `kiosk/support.ts` (91): POST `/api/kiosk/support`. `clientDevice.findUnique` + `clientLog.create` (level INFO, context JSON). Error code `CLIENT_KEY_INVALID`. Slack notification + rate limit via deps. 7 integration cases.
- `kiosk/signage-preview.ts` (99): GET options / PUT selection. 5 prisma sites on `clientDevice` (findMany contains-'signage' filter, findUnique selects, 2 updates of `signagePreviewTargetApiKey`). Uses `requireClientDevice` (phase-5 hub) already. 5 integration cases.
- `kiosk/call-targets.ts` (78): GET `/api/kiosk/call/targets`. `clientDevice.findUnique` auth + `clientStatus.findMany` + `clientDevice.findMany`; 12h stale logic + env exclude in route. 1 integration case only.
- `rigging/index.ts` (201): 13 routes, all service-delegated EXCEPT tag CRUD (POST `/rigging-gears/:id/tags` = deleteMany+create replace; DELETE `/rigging-gear-tags/:tagId` raw delete, Prisma errors unwrapped) and the inline `allowClientKey` (L36–58, `clientDevice.findUnique`). No tag service exists in `services/rigging/` (28 files). Model: `measuring-instruments/tag.service.ts`. ZERO route integration tests.
- `tools/unified/list.ts` (176): GET `/api/tools/unified`. Composes `ItemService.findAll` / `MeasuringInstrumentService.findAll` / `RiggingGearService.findAll` + bulk `measuringInstrumentTag.findMany` / `riggingGearTag.findMany` (first-tag-only maps), normalizes into `UnifiedItem[]`, ja-locale sort. Dual auth: x-client-key (findUnique select id) else JWT roles ADMIN/MANAGER/VIEWER. Local `normalizeClientKey` duplicate of auth-hub helper. ZERO tests.
- Exemplar delegation patterns: `routes/kiosk/employees.ts` L16–22 (requireClientDevice → single service call), `routes/kiosk/production-schedule/list.ts` L18–62 (requireClientDevice → scope resolve → named service function with explicit params).
- Test landscape: `routes/__tests__/kiosk.integration.test.ts` holds all 17 kiosk cases (real DB, no vi.mock constraints). Rigging: only service-level tests with `vi.mock('lib/prisma')` — route seam free. Unified: nothing.

## Plan of Work

Step K1 (worker 1): create `services/kiosk/kiosk-config.service.ts` (`resolveKioskConfig(clientKey?)` — optional-auth semantics preserved: missing/unknown key still yields defaults), `kiosk-support.service.ts` (`recordSupportMessage(...)` — clientLog.create with identical context shape; Slack call stays route-side or moves with identical ordering), `kiosk-signage-preview.service.ts` (options listing + selection get/set), `kiosk-call-targets.service.ts` (3 reads; 12h stale logic and env-exclude filtering may move in as pure named functions or stay in route — keep response byte-identical). Auth lookups adopt `client-device-auth.service` functions with per-file error codes preserved (`CLIENT_KEY_INVALID` in support). Remove `lib/prisma` import from all 4 files. Gate: kiosk integration tests pass unchanged; full API suite = baseline.

Step G1 (worker 2): Stage 1 — add characterisation integration tests for rigging tag routes (POST replace incl. old-tag deletion assert, DELETE happy path, DELETE nonexistent current behavior, allowClientKey x-client-key vs JWT fallback) and verify green against CURRENT code. Stage 2 — new `services/rigging/rigging-gear-tag.service.ts` (class `RiggingGearTagService`: `replaceTagForGear(riggingGearId, rfidTagUid)`, `deleteTag(tagId)` — preserve raw Prisma error behavior of DELETE unless tests capture otherwise), route delegates; `allowClientKey` switches to `assertKioskApiClientKeyValid`/lookup from auth hub with identical error responses. Stage-1 tests must pass UNCHANGED. Gate: full API suite = baseline + new test file.

Step U1 (worker 3): Stage 1 — add characterisation integration tests for GET `/api/tools/unified` (client-key auth vs JWT roles, category filter each value, mixed 3-domain result with tag UIDs, ja sort order) and verify green against CURRENT code. Stage 2 — new `services/tools/unified-inventory-list.service.ts` composing the three findAll calls + bulk tag reads (reuse G1's service if shape fits) and `UnifiedItem[]` assembly; route keeps dual-auth preHandler (auth stays at boundary), local `normalizeClientKey` replaced by auth-hub helper. Stage-1 tests must pass UNCHANGED. Gate: full API suite = baseline + new test files.

Each step is executed by a Composer 2.5 worker subagent, serially; the orchestrator verifies against baseline before the next step starts.

## Concrete Steps

All commands run from `/Users/tsudatakashi/RaspberryPiSystem_002`.

API verification: `POSTGRES_PORT=5432 bash scripts/test/run-tests.sh` (container `postgres-test-local` on 5432; explicit port export required because the script auto-switches to 55432 when 5432 is occupied). Typecheck from apps/api: `tsc -p tsconfig.build.json --noEmit` (plain `tsc --noEmit` has a known pre-existing TS6059 failure).

Web verification (final only; web untouched this phase): `pnpm --filter @raspi-system/web test`.

Cleanup after all verification: stop and remove `postgres-test-local` and its anonymous volume created this session.

## Validation and Acceptance

Acceptance is behavioral equivalence: after each step the full API suite passes with baseline counts (recorded below once the baseline run completes) plus exactly the new characterisation-test files; typecheck and lint clean. Kiosk integration tests (17 cases) pass unchanged after K1. After U1, `rg -l "from ['\"].*lib/prisma" apps/api/src/routes | rg -v __tests__` returns nothing.

## Idempotence and Recovery

Pure source refactorings; revert per file with `git checkout -- <path>` (and removal of new directories) if a step's verification fails and forward-fix isn't obvious. The test Postgres container and volume are disposable.

## Artifacts and Notes

Baseline (2026-07-05, before any change; expected to equal phase-5 final state):

    API (bash scripts/test/run-tests.sh, container postgres-test-local on 5432):
      Test Files  414 passed | 2 skipped (416)
      Tests       2122 passed | 9 skipped (2131)
    Web (pnpm --filter @raspi-system/web test):
      Test Files  249 passed (249)
      Tests       1245 passed (1245)

Revision note (2026-07-05): initial version, written before step execution.
