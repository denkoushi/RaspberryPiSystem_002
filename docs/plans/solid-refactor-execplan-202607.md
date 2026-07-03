# SOLID Refactor ExecPlan: API route/service layering and Web API-module decomposition

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document must be maintained in accordance with `.agent/PLANS.md` (repository root relative path: `.agent/PLANS.md`).

- id: solid-refactor-execplan-202607
- status: in-progress
- scope: apps/api route/service layering, apps/web api module decomposition
- date: 2026-07-03
- source_of_truth: this file
- related_docs: docs/INDEX.md, docs/plans/kiosk-admin-ui-brushup-202607.md
- open_items: see `Progress` and `Outcomes & Retrospective`

## Purpose / Big Picture

The system is a pnpm monorepo: `apps/api` (Fastify 5 + Prisma 5 backend), `apps/web` (React 18 + Vite 6 frontend), and `packages/` (shared pure-logic libraries). Over time several modules have grown into "god modules" that mix HTTP handling, business logic, and database access in single multi-thousand-line files. This makes changes risky and testing hard.

This plan applies SOLID-oriented, strictly behavior-preserving refactorings in small verified steps. After this change, the code has clearer module boundaries (routes depend on services, services own persistence, the web API layer is split by domain), while every HTTP contract, UI behavior, and test result stays identical. Success is observable by running the existing test suites before and after each step and getting the same green results.

CRITICAL CONSTRAINT: the working tree contains uncommitted work-in-progress UI changes (kiosk admin UI brushup) in these paths, which MUST NOT be modified by this plan:

- apps/web/src/components/kiosk/
- apps/web/src/features/kiosk/
- apps/web/src/features/part-measurement/
- apps/web/src/features/admin/dgx-resource/
- apps/web/src/pages/kiosk/
- apps/web/src/layouts/AdminLayout.tsx
- apps/web/src/features/kiosk/kioskTheme.ts (untracked new file)

Reading those files is allowed (e.g. to keep imports compiling); editing them is not.

## Progress

- [x] (2026-07-03 21:10+09:00) Read-only audit of apps/api and apps/web completed (two explore subagents). Findings summarized in `Context and Orientation`.
- [x] (2026-07-03 21:16+09:00) Baseline verification green: API (`bash scripts/test/run-tests.sh`, Docker Postgres pgvector:pg15 container `postgres-test-local`, port 55432) = Test Files 412 passed | 2 skipped (414), Tests 2098 passed | 9 skipped (2107). Web (`pnpm --filter @raspi-system/web test`) = Test Files 244 passed, Tests 1179 passed.
- [x] (2026-07-03 21:20+09:00) This ExecPlan created.
- [x] (2026-07-03 21:25+09:00) Step W1 done (worker subagent): created `apps/web/src/api/errors.ts` (43 lines, `getApiErrorMessage`); migrated LoginPage, BackupRestorePage, MasterImportPage, tools/EmployeesPage (remove flow), tools/MachinesPage (remove), tools/ItemsPage (remove); replaced the raw fetch in `hooks.ts` with `getRiggingInspectionRecords()` in client.ts. Skipped (intentionally, logic not mechanically equivalent): CsvImportSchedulePage (401-specific branch), Zod-issues rendering in create/update flows, local-llm/dgx-resource domain helpers. Verified: tsc -b clean, web tests 244 files / 1179 tests green.
- [x] (2026-07-03 22:20+09:00) Step A1 done (worker subagent): created `apps/api/src/services/auth/auth.service.ts` (223 lines) holding login/refresh/MFA initiate-activate-disable/role-audit-log logic; `routes/auth.ts` reduced from 211 to 91 lines with zero `lib/prisma` imports (only `UserRole` type from `@prisma/client`). Role-change route keeps existing `AuthRoleAdminService`. Verified: auth integration tests 14/14 green; full API suite 412 files / 2098 tests green (baseline match).
- [x] (2026-07-03 22:40+09:00) Step W2 done (worker subagent): `apps/web/src/api/client.ts` reduced from 5,532 to 46 lines (pure re-export facade with feature-type compat section). New `apps/web/src/api/http.ts` (120 lines: axios instance, interceptors, client-key, getWebSocketUrl) and 15 domain modules under `apps/web/src/api/domains/` (auth, tools, kiosk, production-schedule 1,822, mobile-placement, measuring-instruments, rigging, part-measurement 1,315, clients, system, signage, kiosk-documents, csv-visualization, assembly). Export-surface diff vs original 495 exports: no loss. Verified: tsc -b clean, web tests 244 files / 1179 tests green, lint 0 errors. Orchestrator cleanup: removed now-unused `axios` import in `pages/tools/ItemsPage.tsx` (last lint warning) and deleted the worker's one-off split script; tsc + lint re-verified clean.
- [x] (2026-07-03 22:52+09:00) Step A2 done (worker subagent): `apps/api/src/routes/part-measurement/index.ts` reduced from 2,405 to 172 lines (composition root; export `registerPartMeasurementRoutes(app): Promise<void>` unchanged). New `shared.ts` (948 lines: shared Zod schemas, serializers, `PartMeasurementRouteDeps`) plus 7 sub-registrars: `visual-templates.ts` (362), `sheets.ts` (436), `production-templates-read.ts` (165), `self-inspection.ts` (455), `production-templates-create.ts` (155), `inspection-drawing-templates.ts` (412), `production-templates-lifecycle.ts` (201). Registration order preserved. Verified: part-measurement integration tests 67 passed | 2 skipped + drawings 2 passed; full API suite 412 files / 2098 tests green (baseline match).
- [x] (2026-07-03 22:55+09:00) Final verification: web suite re-run green (244 files / 1179 tests); `git status` confirms changed files are exactly the refactor scope and no WIP path was touched; docs/INDEX.md link added; test Postgres container removed.
- [ ] Open item (future plan): decompose `apps/api/src/services/part-measurement/self-inspection.service.ts` (4,386 lines) into session/query/command/loan-bridge sub-services with repositories.
- [ ] Open item (future plan): split `apps/web/src/api/hooks.ts` (2,951 lines) by domain; move feature-specific cache patching into feature-side mutation wrappers.
- [ ] Open item (future plan): remove remaining direct `lib/prisma` imports from ~26 other route files (rigging, measuring-instruments, kiosk config/support, storage, tools, system, signage, webrtc, backup).
- [ ] Open item (future plan): split `apps/api/src/services/production-schedule/production-schedule-query.service.ts` (2,051 lines) by query profile; extract shared loan orchestration from tools/rigging/measuring-instruments loan services; partition `apps/api/src/config/env.ts` (554 lines) by domain.
- [ ] Open item (future plan): decompose admin god pages (`SignageSchedulesPage.tsx` 1,618 lines, `CsvImportSchedulePage.tsx` 1,568 lines, `CsvDashboardsPage.tsx` 916 lines, `VisualizationDashboardsPage.tsx` 700 lines) into `features/admin/<domain>/` hooks + presentational components.

## Surprises & Discoveries

- Observation: The repository already contains exemplary target patterns, so no new architecture needs inventing.
  Evidence: `apps/api/src/routes/kiosk/production-schedule/` (thin sub-registrars + `shared.ts` deps object), `apps/api/src/services/kiosk-documents/ports/` + `adapters/` (port/adapter), `apps/api/src/plugins/error-handler.ts` (unified error mapping), `apps/web/src/api/local-llm.ts` (`getLocalLlmApiErrorMessage` helper pattern).
- Observation: API vitest runs with `fileParallelism: false` because tests share one Postgres database; refactor steps must re-run the whole suite serially (~ several minutes) rather than assuming parallel speed.
  Evidence: `apps/api/vitest.config.ts`.
- Observation: `apps/web/src/api/client.ts` re-exports feature types (assembly, part-measurement, mobile-placement), meaning the API layer depends on feature layers (dependency inversion in the wrong direction). The split (Step W2) must preserve these re-exports for compatibility but house them in clearly-marked compat sections.
  Evidence: import statements at top of `apps/web/src/api/client.ts`.
- Observation: `scripts/test/run-tests.sh` auto-switches to port 55432 when it sees anything bound to 5432 — including the test container itself. On re-runs while `postgres-test-local` is already up on 5432, `POSTGRES_PORT=5432` must be set explicitly or migrations target the wrong port.
  Evidence: Step A1 worker had to export `POSTGRES_PORT=5432` for the full-suite re-run.
- Observation: The Step W1 helper migration left one dead `import axios` in `pages/tools/ItemsPage.tsx` (lint warning); mechanical migrations need a final lint pass by the orchestrator.
  Evidence: `pnpm --filter @raspi-system/web lint` warning, fixed by removing the import; lint then clean.
- Observation: Facade-preserving splits worked with zero import-site churn: the original `client.ts` had 495 export statements and the post-split export-surface diff showed no loss, so no file outside `apps/web/src/api/` changed.
  Evidence: Step W2 report; `git status` shows only `api/` files modified on the web side besides the W1 pages.

## Decision Log

- Decision: Scope this plan to four behavior-preserving steps (W1, A1, W2, A2) and record the remaining audit findings as open items for follow-up plans.
  Rationale: Core safety rule is minimal change with verification between steps. The audit found ~10 major hotspots; doing all in one pass would create an unreviewably large diff mixed with the uncommitted UI WIP.
  Date/Author: 2026-07-03 / Fable 5 (orchestrator)
- Decision: Do not commit anything in this session.
  Rationale: Repository rule `.cursor/rules/20-git-workflow.mdc` requires explicit user request for git operations; the working tree also holds unrelated UI WIP that must not be mixed into commits.
  Date/Author: 2026-07-03 / Fable 5
- Decision: Keep `apps/web/src/api/client.ts` and `apps/api/src/routes/part-measurement/index.ts` as facades that re-export/compose the new modules, instead of updating every import site.
  Rationale: Preserves the public import surface, keeps the diff mechanical and reviewable, avoids touching WIP files that import from these modules.
  Date/Author: 2026-07-03 / Fable 5
- Decision: Use the existing `postgres-test-local` Docker container flow (`scripts/test/run-tests.sh`) instead of creating a new temporary Postgres container.
  Rationale: The repo already provisions a dedicated disposable test container on a conflict-free port; creating another would duplicate infrastructure. No production/dev database is touched.
  Date/Author: 2026-07-03 / Fable 5
- Decision: In Step W2 the domain modules live in `apps/web/src/api/domains/` (not `api/modules/`).
  Rationale: "domains" states the split axis explicitly; avoids confusion with bundler terminology.
  Date/Author: 2026-07-03 / Fable 5

## Outcomes & Retrospective

(2026-07-03) All four planned steps completed with zero behavior change; every suite matches baseline exactly (API 412 files / 2098 tests, Web 244 files / 1179 tests).

Achieved:

- Web: shared `getApiErrorMessage` helper in `apps/web/src/api/errors.ts` adopted by 6 pages; last raw `fetch` removed; `client.ts` reduced from 5,532 lines to a 46-line facade over `http.ts` + 15 domain modules under `api/domains/`.
- API: `routes/auth.ts` reduced 211 to 91 lines with all Prisma access moved into `services/auth/auth.service.ts`; `routes/part-measurement/index.ts` reduced 2,405 to 172 lines composing 7 sub-registrars plus `shared.ts`.
- No WIP file (kiosk admin UI brushup) was modified; nothing was committed (per repo git rules, commits require explicit user request).

Remaining work is recorded as open items in `Progress`: the `self-inspection.service.ts` god service (4,386 lines), the `hooks.ts` split (2,951 lines), ~26 remaining route files importing `lib/prisma` directly, the `production-schedule-query.service.ts` split, shared loan orchestration, `config/env.ts` partitioning, and the admin god pages. Each should get its own follow-up plan of similar shape.

Lesson: facade-preserving mechanical splits (old path re-exports new modules; composition root keeps its export signature) allowed multi-thousand-line decompositions with no import-site churn and no test churn. This is the recommended template for the open items.

## Context and Orientation

The monorepo layout (paths relative to repository root):

- `apps/api/src/main.ts` and `app.ts`: Fastify server bootstrap. Routes are registered under `/api`.
- `apps/api/src/routes/`: HTTP layer grouped by domain. Handlers should parse input with Zod, check auth via `apps/api/src/lib/auth.ts` (`authenticate`, `authorizeRoles`), then call a service.
- `apps/api/src/services/`: business logic grouped by domain. Services own Prisma access via the singleton `apps/api/src/lib/prisma.ts`.
- `apps/api/src/plugins/error-handler.ts`: converts thrown `ApiError` (from `apps/api/src/lib/errors.ts`), `ZodError`, and Prisma errors into HTTP responses. Services/routes should throw, not hand-craft error responses.
- `apps/web/src/api/client.ts`: axios instance (baseURL `/api`) plus, historically, ~100 HTTP functions and DTO types in one 5,532-line file.
- `apps/web/src/api/hooks.ts`: ~100 TanStack Query hooks (2,951 lines).
- `packages/`: `@raspi-system/shared-types` (shared TS types), `part-search-core`, `shelf-layout-core` (pure functions).

A "god module" here means a single file combining multiple responsibilities (HTTP parsing, business rules, persistence, presentation) such that any change forces re-testing everything. A "facade" means a file that keeps its old path and re-exports symbols now defined in smaller modules, so existing `import` statements keep working.

Known-good patterns already in the repo that the steps below copy:

- Route decomposition: `apps/api/src/routes/kiosk/production-schedule/index.ts` registers 30+ sub-registrars, each in its own file, sharing Zod schemas and a deps object from `shared.ts`.
- Thin handler + service: `apps/api/src/routes/tools/items/create.ts` with `ItemService` instantiated once in `routes/tools/items/index.ts`.
- Web error-message helper: `getLocalLlmApiErrorMessage` in `apps/web/src/api/local-llm.ts`.

## Plan of Work

Step W1 (web, small): create `apps/web/src/api/errors.ts` exporting `getApiErrorMessage(error: unknown, fallback: string): string` that unwraps axios errors (response.data.message / .error / statusText) and plain Errors. Replace per-page inline `axios.isAxiosError` blocks in non-WIP admin pages (`LoginPage`, `EmployeesPage`, `CsvImportSchedulePage`, `BackupRestorePage`, `MasterImportPage`, and similar) with the helper where the replacement is mechanically equivalent. Also replace the single raw `fetch` call in `apps/web/src/api/hooks.ts` (rigging inspection records, around line 2649) with a function using the shared axios client.

Step A1 (api, small): create `apps/api/src/services/auth/auth.service.ts` encapsulating the login, refresh, and logout logic currently inline in `apps/api/src/routes/auth.ts` (10 direct prisma calls). Routes keep identical Zod schemas, status codes, and response bodies; they delegate to the service. Follow the constructor-injection style of `ItemService`.

Step W2 (web, large but mechanical): split `apps/web/src/api/client.ts` into domain modules under `apps/web/src/api/domains/` (auth, tools, kiosk, production-schedule, signage, backup-admin, storage, measuring-instruments, rigging, assembly, mobile-placement, part-measurement, system, webrtc, misc as needed). The axios instance and interceptors stay in a small `apps/web/src/api/http.ts` (or remain in client.ts) imported by every domain module. `client.ts` becomes a facade re-exporting everything it exported before, including the feature-type re-exports (marked with a compat comment). No import site elsewhere changes.

Step A2 (api, large but mechanical): split `apps/api/src/routes/part-measurement/index.ts` (~65 handlers) into sub-registrar files under `apps/api/src/routes/part-measurement/` (for example `templates.routes.ts`, `sessions.routes.ts`, `measurements.routes.ts`, `evaluation-sheets.routes.ts`, `self-inspection.routes.ts`, `uploads.routes.ts`, plus `shared.ts` for shared Zod schemas/deps), mirroring `routes/kiosk/production-schedule/`. `index.ts` becomes the composition root that instantiates services once and calls each registrar. Handler bodies move verbatim; no behavior change.

Each step is executed by a worker subagent, then the orchestrator runs verification before starting the next step.

## Concrete Steps

All commands run from the repository root `/Users/tsudatakashi/RaspberryPiSystem_002`.

Baseline and per-step API verification:

    bash scripts/test/run-tests.sh

This auto-starts Docker container `postgres-test-local` (image pgvector/pgvector:pg15) on port 5432 or 55432, runs `prisma migrate deploy`, `prisma generate`, then `vitest run` serially. Expect: `Tests 2098 passed | 9 skipped (2107)`.

Per-step web verification:

    pnpm --filter @raspi-system/web exec tsc -b
    pnpm --filter @raspi-system/web test

Expect: tsc exits 0 silently; vitest reports `Tests 1179 passed (1179)`.

Targeted fast checks during a step (examples):

    cd apps/api && pnpm vitest run src/routes/__tests__/auth.integration.test.ts
    cd apps/api && pnpm vitest run "src/routes/__tests__/part-measurement*"

Cleanup after all verification (the test container is disposable; its data volume is recreated on demand):

    pnpm test:postgres:stop

## Validation and Acceptance

Acceptance is behavioral equivalence: after each step, the full relevant test suite passes with the same counts as baseline, `tsc -b` for the web workspace is clean, and `git status` shows no modification to the WIP paths listed in `Purpose / Big Picture`. For Step A1, the auth integration test (`apps/api/src/routes/__tests__/auth.integration.test.ts`) exercises login/refresh/logout end-to-end and must pass unchanged. For Step A2, all `part-measurement` integration tests must pass unchanged. For Steps W1/W2, all web vitest suites must pass unchanged and no import path outside `apps/web/src/api/` needs modification (facade guarantee).

## Idempotence and Recovery

All steps are pure source refactorings with no data migration; they can be re-run or reverted with `git checkout -- <path>` per file (taking care never to revert the pre-existing WIP paths). If a step's verification fails, fix forward if the cause is obvious (missing export, wrong import path), otherwise revert only the files that step touched and re-plan. The Docker test container and its volume are disposable and recreated by `scripts/test/start-postgres.sh`; stopping/removing it never touches development or production data.

## Artifacts and Notes

Baseline (2026-07-03, before any change):

    API (bash scripts/test/run-tests.sh, Postgres port 55432):
      Test Files  412 passed | 2 skipped (414)
      Tests       2098 passed | 9 skipped (2107)
    Web (pnpm --filter @raspi-system/web test):
      Test Files  244 passed (244)
      Tests       1179 passed (1179)

These counts are the acceptance reference for every subsequent step.

## Interfaces and Dependencies

Step W1 defines in `apps/web/src/api/errors.ts`:

    export function getApiErrorMessage(error: unknown, fallback: string): string

Step A1 defines in `apps/api/src/services/auth/auth.service.ts` a class `AuthService` with methods matching the three route flows (login, refresh, logout), each returning the exact DTO the route previously built inline, and throwing `ApiError` for the failure cases the route previously mapped to 4xx.

Step W2 keeps `apps/web/src/api/client.ts` exporting every symbol it exported before (functions, types, const objects); new domain modules under `apps/web/src/api/domains/` import the shared axios instance from `apps/web/src/api/http.ts`.

Step A2 keeps `registerPartMeasurementRoutes(app)` (the export used by the route index) with an identical signature; sub-registrars follow the pattern `export function register<Area>Routes(app: FastifyInstance, deps: PartMeasurementRouteDeps): void` with `PartMeasurementRouteDeps` defined in `apps/api/src/routes/part-measurement/shared.ts`.

Revision note (2026-07-03): initial version, written after the read-only audit and before step execution. Update after each step with progress, discoveries, and final retrospective, per PLANS.md living-document requirements.
