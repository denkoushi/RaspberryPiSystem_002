# Decompose SelfInspectionService into enforced use-case boundaries

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document must be maintained in accordance with `.agent/PLANS.md`.

- id: self-inspection-use-case-boundaries-execplan
- status: implementation_complete; integration_pending (push, PR, merge, and deployment are not approved)
- scope: `apps/api/src/services/part-measurement/self-inspection.service.ts` only, plus focused tests and API ESLint enforcement
- started: 2026-08-03
- branch: `refactor/self-inspection-use-case-boundaries`
- baseline_sha: `e3a4e1f6971d9e5502b22352161ecd339f59a5fc`
- integration_pending: push, pull request, merge, and production deployment all require separate explicit approval

## Purpose / Big Picture

The self-inspection API currently works, but its main service grew from 1,685 lines after the July 2026 decomposition to 2,072 lines. This change makes future work safer by moving each business operation into a clearly named use-case module while keeping `SelfInspectionService` as the same public facade used by routes and tests. Users must observe no API behavior change: requests, responses, status codes, error messages, database transactions, locks, audit records, and cache invalidation remain identical.

Success is demonstrated by an isolated PostgreSQL baseline before implementation, identical API test counts after implementation, focused facade delegation tests covering all 22 public methods, successful API build and lint, and structural limits that prevent database logic from returning to the facade.

## Progress

- [x] (2026-08-03 07:50+09:00) Confirmed a clean `main`, fetched `origin/main`, and verified both point to `e3a4e1f6971d9e5502b22352161ecd339f59a5fc`.
- [x] (2026-08-03 07:50+09:00) Created local branch `refactor/self-inspection-use-case-boundaries`; no push was performed.
- [x] (2026-08-03 07:57+09:00) Started uniquely named PostgreSQL 15/pgvector resources, applied all 157 migrations, and ran the full API baseline with Node 20.20.2: 478 test files passed, 2 skipped; 2,513 tests passed, 7 skipped.
- [x] (2026-08-03 07:58+09:00) Removed the baseline container, volume, and network. Docker counts returned exactly to 0 containers, 17 volumes, and 3 networks; no resource with the task label remained.
- [x] (2026-08-03 08:17+09:00) Added facade delegation characterization tests covering the exact 22-method surface, unchanged arguments, delegated return values, and the shared per-facade loan-event service.
- [x] (2026-08-03 08:13+09:00) Extracted session start and session query/detail use cases, preserving signatures and query behavior.
- [x] (2026-08-03 08:13+09:00) Extracted operator input, actor authentication, and instrument-use use cases.
- [x] (2026-08-03 08:13+09:00) Extracted record approval and out-of-tolerance review use cases.
- [x] (2026-08-03 08:13+09:00) Extracted session completion and reset use cases, preserving transaction and lock order.
- [x] (2026-08-03 08:16+09:00) Reduced the facade from 2,072 to 321 physical lines and added target-specific ESLint size and dependency restrictions. Every new use-case file is below 500 physical lines.
- [x] (2026-08-03 08:17+09:00) Focused isolated-database verification passed: 7 files and 93 tests covering the facade, core part-measurement integration, actor authentication, confirmation guard, invalidation, sampling correction, and cache reset.
- [x] (2026-08-03 08:25+09:00) Ran final verification with Node 20.20.2: full API tests passed (479 files, 2,515 tests), API build passed, full API lint passed, and `git diff --check` passed. The exact increase over baseline is the new facade test: one file and two tests.
- [x] (2026-08-03 08:26+09:00) Removed all focused and final temporary Docker resources. Counts returned exactly to 0 containers, 17 volumes, and 3 networks, with no task-labelled resource remaining.
- [x] (2026-08-03 08:28+09:00) Committed the behavior-preserving extraction locally as `55849360` (`refactor(api): split self-inspection use cases`).
- [ ] Commit the architecture guard and completed ExecPlan locally. Push, PR, merge, and deployment remain out of scope and require explicit approval.

## Surprises & Discoveries

- Observation: The default shell resolves Node.js 18.20.8, below the repository requirement, but Homebrew Node.js 20.20.2 is installed at `/opt/homebrew/opt/node@20/bin`.
  Evidence: `node --version` returned `v18.20.8`; `/opt/homebrew/Cellar/node@20/20.20.2` exists.

- Observation: The July 2026 refactor already moved helpers out of the service, but the class later grew by 387 lines and now has 22 public methods.
  Evidence: `docs/plans/solid-refactor-phase2-execplan-202607.md` records 1,685 lines; the baseline file is 2,072 lines.

- Observation: Four integration suites plus focused unit tests provide broad direct coverage of the moved session, actor, invalidation, and cache behavior.
  Evidence: The first post-extraction isolated run passed 7 files and 93 tests, including `part-measurement.integration.test.ts` and all three focused self-inspection route integration files.

- Observation: The repository's commit hook inherits the shell's Node version rather than selecting the required version itself.
  Evidence: The first commit invocation warned that Node 18.20.8 was unsupported. Re-running with `/opt/homebrew/opt/node@20/bin` first in `PATH` executed the repository-wide lint hook successfully.

## Decision Log

- Decision: Preserve `SelfInspectionService` as the composition facade and move whole method bodies into plain exported use-case functions.
  Rationale: Existing routes, mocks, module-level exports, and constructor usage remain unchanged, while business and database logic gets a visible ownership boundary.
  Date/Author: 2026-08-03 / Codex

- Decision: Apply new size and dependency rules only to the facade and new `self-inspection/use-cases/` modules.
  Rationale: Existing helper modules are large and outside this behavior-preserving change; widening the lint scope would mix unrelated refactoring into the work.
  Date/Author: 2026-08-03 / Codex

- Decision: Use uniquely named disposable Docker resources instead of the repository's fixed-name local test database helper.
  Rationale: The user prohibited modification of existing containers and databases. Unique names, labels, random loopback port binding, and exact cleanup avoid collisions and make resource-delta verification possible.
  Date/Author: 2026-08-03 / Codex

## Outcomes & Retrospective

The implementation is complete on the local feature branch. `SelfInspectionService` is now a 321-line facade over eight responsibility-focused use-case modules plus a one-line shared constant module. The largest new module is 448 physical lines. The exact 22-method public surface and all existing import sites remain unchanged. A new two-test facade suite proves method-surface and delegation behavior, including reuse of one loan-event service instance.

Behavioral verification exceeded the baseline without replacing any existing test. Before refactoring, 478 files and 2,513 tests passed. After refactoring, 479 files and 2,515 tests passed; the one-file/two-test increase is solely the new facade contract test. API build, target and full lint, and whitespace validation pass under Node 20.20.2. Disposable Docker resources returned to their exact pre-work counts.

No production connection, schema change, migration, configuration behavior change, UI change, deployment, push, pull request, or merge occurred. Integration to `origin/main` remains pending separate approval.

## Context and Orientation

The repository is a pnpm monorepo. The API lives under `apps/api`. HTTP routes instantiate `SelfInspectionService` from `apps/api/src/services/part-measurement/self-inspection.service.ts`; therefore that path, class name, constructor usage, public method signatures, and module-level exports are compatibility boundaries.

The current service contains session creation and queries, operator and inspector measurement commands, instrument pre-use checks, record approval, tolerance review, completion, reset, and leaderboard decoration. Existing helper code lives under `apps/api/src/services/part-measurement/self-inspection/`. This plan adds `use-cases/` below that directory. A use case means one cohesive application operation such as starting a session or approving records; it may coordinate Prisma database calls and existing helpers. The facade may only create dependencies and delegate calls.

Database correctness depends on details that must survive byte-for-byte in meaning even when code moves. Session mutations acquire the session row lock first. Reset acquires the business-key lock and then the session row lock. Transaction boundaries do not move. Cache invalidation runs only after a successful transaction. Optimistic locking, Prisma `P2002` conflict handling, audit logging, and exact error messages remain unchanged. The facade continues to own exactly one `MeasuringInstrumentLoanEventService` instance and passes it to use cases that need it.

## Plan of Work

### Milestone 1: establish a reproducible baseline

Record Docker containers, volumes, and networks before starting. Create uniquely named and labeled PostgreSQL 15/pgvector resources with a random port bound to loopback. Apply the existing Prisma migrations and run `pnpm --filter @raspi-system/api test` with `/opt/homebrew/opt/node@20/bin` first in `PATH`. If the baseline fails, stop source refactoring and distinguish environment failure from an existing test failure. Record test-file and test-case counts and delete only the uniquely named resources. Acceptance is a green full suite and a zero resource delta.

### Milestone 2: freeze the facade contract

Add a focused unit test that mocks each use-case module and invokes every one of the facade's 22 public methods. Assert that each method forwards the exact arguments and returns or rejects with the delegated result. Also assert that a single facade shares one loan-event service instance across relevant calls. The new test protects the public class while later milestones move method bodies.

### Milestone 3: extract read and start operations

Create focused files under `apps/api/src/services/part-measurement/self-inspection/use-cases/` for session start, session search/detail, and record-approval reads. Move logic without redesigning it, replace facade bodies with short delegates, and run the new facade test plus existing session-selection, expected-entry-count, cache, and part-measurement integration tests. Each step must compile before proceeding.

### Milestone 4: extract input, authentication, and approval operations

Move measuring-person resolution, update, draft input, measurement-actor authentication, measuring-instrument pre-use checks, record approval commands, and out-of-tolerance review operations into cohesive use-case files. Preserve the one-per-facade loan-event dependency by passing it explicitly. Run the related direct and integration tests after each cohesive move.

### Milestone 5: extract lifecycle mutations

Move session completion and reset last because they contain the most important transaction and lock-order invariants. Compare moved bodies against the baseline, then run tests covering completion, reset, optimistic conflicts, invalidation, and audit behavior. No cleanup or improvement is combined with the move.

### Milestone 6: enforce boundaries and verify everything

Add ESLint overrides for the facade and new use-case directory. The facade must have at most 350 lines and 40 lines per method, must not import `lib/prisma`, and use cases must not import the facade. Each new use-case file must be at most 500 lines and each function at most 220 lines. Run the full API suite against a fresh uniquely named isolated database, then API build, lint, and `git diff --check` under Node 20. Compare test counts to Milestone 1, inspect the diff for schema, migration, route, shared-type, config, and public-interface changes, then clean all temporary Docker resources.

## Concrete Steps

All commands run from `/Users/tsudatakashi/RaspberryPiSystem_002`. Prefix commands with `PATH=/opt/homebrew/opt/node@20/bin:$PATH` so `node --version` reports at least 20.9. The isolated database receives a unique name and random host port; its `DATABASE_URL` is supplied only to migration and test processes. Never point these commands at a production or existing development URL.

After each extraction, run the closest direct tests with Vitest. At the read/start milestone and every later milestone, run `pnpm --filter @raspi-system/api test -- part-measurement` or the repository's equivalent targeted files. At the end run:

    pnpm --filter @raspi-system/api test
    pnpm --filter @raspi-system/api build
    pnpm --filter @raspi-system/api lint
    git diff --check

Use `git status --short` and `git diff --stat` between milestones. Commit only cohesive verified steps on the local feature branch. Do not push, open a PR, merge, deploy, modify Prisma schema, or execute production scripts.

## Validation and Acceptance

Acceptance requires that the facade has the same class name, constructor compatibility, 22 public methods, and module-level exports. Routes and other services keep their current import path. HTTP contracts, error text, database transactions, lock order, cache invalidation timing, audit behavior, and the single per-facade loan-event service instance remain unchanged.

The facade is at most 350 lines and contains no Prisma calls, transaction blocks, or business decisions. New use-case modules are organized by responsibility, meet the requested line limits, and have no cyclic dependency back to the facade. The full API test counts equal the recorded baseline, build and lint pass with Node 20, and `git diff --check` is clean. No schema, migration, configuration, UI, or deployment-script changes appear in the final diff.

## Idempotence and Recovery

Source changes are split into small local commits so a faulty extraction can be reverted without affecting later work. Disposable Docker names and labels include a unique run identifier. Cleanup targets only that exact container, volume, and network. Before and after snapshots prove that no pre-existing resource changed. If a test exposes a behavior difference, restore the affected method from the preceding commit and repeat the extraction more mechanically.

## Artifacts and Notes

Baseline source facts at `e3a4e1f6971d9e5502b22352161ecd339f59a5fc`:

    apps/api/src/services/part-measurement/self-inspection.service.ts: 2,072 lines
    SelfInspectionService public methods: 22
    Prisma transaction sites in the facade: 11

The isolated database baseline and final verification counts will be added here as they are produced.

Baseline verification (2026-08-03, before service implementation changes):

    Node.js: v20.20.2
    PostgreSQL image: pgvector/pgvector:pg15
    Prisma migrations: 157 applied successfully
    Test Files: 478 passed | 2 skipped (480)
    Tests: 2513 passed | 7 skipped (2520)
    Duration: 266.56s
    Docker before: 0 containers, 17 volumes, 3 networks
    Docker after:  0 containers, 17 volumes, 3 networks

Final verification (2026-08-03, after extraction and boundary enforcement):

    Node.js: v20.20.2
    PostgreSQL image: pgvector/pgvector:pg15 (fresh isolated resources)
    Prisma migrations: 157 applied successfully
    Focused tests: 7 files, 93 tests passed
    Test Files: 479 passed | 2 skipped (481)
    Tests: 2515 passed | 7 skipped (2522)
    Existing-suite delta: 0 failures, 0 removals
    New facade tests: +1 file, +2 tests
    API build: passed
    API lint: passed
    git diff --check: passed
    Docker before: 0 containers, 17 volumes, 3 networks
    Docker after:  0 containers, 17 volumes, 3 networks

Local implementation commit:

    55849360 refactor(api): split self-inspection use cases

Revision note (2026-08-03): Initial implementation plan created after confirming the clean synchronized baseline and dedicated local branch. Updated after every validation milestone and finalized after full isolated verification.
