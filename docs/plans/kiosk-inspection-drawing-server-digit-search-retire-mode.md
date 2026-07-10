---
title: Kiosk Inspection Drawing Server Digit Search And Retire Mode
id: plan-kiosk-inspection-drawing-server-digit-search-retire-mode
status: completed
scope: kiosk inspection drawing library (`/kiosk/part-measurement/inspection`)
date: 2026-07-10
source_of_truth: this file
branch: feat/inspection-drawing-server-digit-search-retire-mode
related_code: apps/api/prisma/schema.prisma, apps/api/src/services/part-measurement/part-measurement-visual-template.service.ts, apps/web/src/pages/kiosk/KioskInspectionDrawingLibraryPage.tsx
related_docs: ./kiosk-inspection-drawing-library-ux-and-depth-through.md, ../decisions/ADR-20260530-kiosk-inspection-drawing-dev-preview-parity.md
validation: local and isolated PostgreSQL PASS · CI 29066398307 success · Pi5/StoneBase01 canary deploy success · Phase12 45/0/0 · StoneBase display PASS
open_items: remaining Pi4×4 and Pi3 were intentionally not deployed in the canary request; physical ON/OFF tap remains optional
---

# Kiosk Inspection Drawing Server Digit Search And Retire Mode

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept current while implementation proceeds. Maintain it in accordance with `.agent/PLANS.md`.

## Purpose / Big Picture

The inspection-drawing menubar digit keypad currently searches only the 40 visual drawings already loaded in the browser and searches template part numbers instead of drawing names. After this work, the same digit sequence searches the normalized digits of drawing names in PostgreSQL across hundreds or more drawings, while each pane renders at most 40 results and asks the operator to enter more digits when matches overflow. Destructive template retirement is hidden during normal operation and is exposed only while an explicit `無効ON` mode is active.

## Progress

- [x] (2026-07-10) Read repository rules, current source-of-truth plan, visual-template ADR, sibling-group ADR, API/Web implementation, tests, and Docker test workflow.
- [x] (2026-07-10) Updated `main` with `git pull --ff-only` and created `feat/inspection-drawing-server-digit-search-retire-mode`.
- [x] (2026-07-10) Added shared ASCII-digit normalization, Prisma column, migration, constraints, and search index.
- [x] (2026-07-10) Added backward-compatible API `digitQuery` filtering and write-path synchronization.
- [x] (2026-07-10) Added debounced Web server search, result caps, overflow guidance, and DEV preview parity.
- [x] (2026-07-10) Added default-off `無効ON/OFF` mode and synchronous destructive-action concurrency guards.
- [x] (2026-07-10) Added focused unit, component, and API integration regression tests.
- [x] (2026-07-10) Validated all 139 migrations, backfill/NOT NULL/CHECK/GIN, focused API integration tests, and an indexed 100,000-row query with isolated temporary PostgreSQL containers; no temporary resources remain.
- [x] (2026-07-10) Passed shared/API/Web lint and builds, API unit 13/13, Web related 26/26, and full API integration 69/69 runnable tests (2 environment-dependent PDF tests skipped).
- [x] (2026-07-10) Confirmed DEV preview interaction: zero retire row buttons by default, 24 while `無効ON`, zero after OFF; `7161` narrowed drawing-name template fixtures from 24 to 16; reset restored them.
- [x] (2026-07-10) Updated the prior plan open item, docs index, preview description, and this retrospective.
- [x] (2026-07-10) Pushed HEAD `5ae28450`; GitHub Actions run `29066398307` passed all five jobs.
- [x] (2026-07-10) Deployed the canary scope only: Pi5 run `20260710-123031-4690` and StoneBase01 run `20260710-124213-28442`, both `failed=0`.
- [x] (2026-07-10) Passed Phase12 45/0/0, production DB/API smoke, StoneBase runtime/heartbeat checks, and Wayland screen inspection.

## Surprises & Discoveries

- Observation: The prior deployed plan already records the 40-row client-side search as an open item.
  Evidence: `docs/plans/kiosk-inspection-drawing-library-ux-and-depth-through.md` says `Visual list limit: 40 may miss digit matches beyond the page`.
- Observation: The current digit behavior removes every non-ASCII digit before matching, so forwarding the digits to the existing raw-name `q` filter would change `71-A61` versus `7161` semantics.
  Evidence: `inspectionDrawingDigitQuery.ts` uses `replace(/\D/g, '')` on both the drawing name and query.
- Observation: `retireBusy` is passed to the table's `busy` prop, but populated tables do not use it to disable the retirement button, so an explicit action guard is required.
  Evidence: `InspectionDrawingLibraryTemplateTable.tsx` only reads `busy` in its empty-state branch.
- Observation: PostgreSQL preferred a 2.9 ms sequential scan for a compact 20,000-row synthetic table even with a selective six-digit query; with 100,000 varied digit rows it selected the trigram GIN Bitmap Index Scan and completed in about 1.7 ms.
  Evidence: isolated `EXPLAIN (ANALYZE, BUFFERS)` runs on `pgvector/pgvector:pg15`; the 100,000-row plan used `PartMeasurementVisualTemplate_searchDigits_trgm_idx` and returned one row.

## Decision Log

- Decision: Persist an internal `searchDigits` derivative on `PartMeasurementVisualTemplate`, enforce equality to the drawing name with a CHECK constraint, and index it with `pg_trgm` GIN.
  Rationale: It preserves punctuation-insensitive digit matching, supports relation filtering from templates, and prevents an unbounded browser scan. A shared pure normalizer plus a DB constraint keeps write paths explicit and detects drift.
  Date/Author: 2026-07-10 / Codex and user-approved plan.
- Decision: Display at most 40 rows per pane during digit search, fetch 41 visual rows to detect overflow, and show an instruction to add digits rather than add pagination.
  Rationale: The operator is looking up a known drawing number; progressive narrowing keeps the kiosk dense and fast.
  Date/Author: 2026-07-10 / user choice.
- Decision: Keep retirement mode active until explicitly turned off or the page unmounts; do not persist it in browser storage.
  Rationale: It supports several intentional retirements in one maintenance session while restoring the safe default on the next visit.
  Date/Author: 2026-07-10 / user choice.

## Outcomes & Retrospective

Implemented the approved scope on `feat/inspection-drawing-server-digit-search-retire-mode`, then deployed only the user-approved canary scope (`raspberrypi5` and `raspi4-kensaku-stonebase01`). Both list APIs now accept an optional validated `digitQuery`; visual rows use the persisted drawing-name digit derivative and template rows filter through the related visual template, so part-number digits no longer satisfy the menubar query. The Web page debounces the shared query once, caps visible digit-search results at 40, reports overflow, and preserves all existing detail filters.

The retirement action is now absent from the DOM by default and available only in the local page-scoped `無効ON` mode. A synchronous ref lock plus disabled controls prevents duplicate mutations, while cancellation, confirmation, reload, history filtering, and non-persistent mode lifetime retain their prior contracts.

Validation used only disposable `pgvector/pgvector:pg15` containers with dynamically assigned localhost ports and no volume or custom network. All 139 migrations applied, an old-form minimal table backfilled `図面71-A61` to `7161`, NOT NULL and the CHECK constraint rejected drift, and the trigram index existed. PostgreSQL reasonably chose a sequential scan for the compact 20,000-row probe (about 2.9 ms); on 100,000 varied rows the selective query used the GIN Bitmap Index Scan and completed in about 1.7 ms. Full API integration finished with 69 passed and two pre-existing environment-dependent PDF tests skipped. Every temporary container was removed and no matching volume or network remained.

Production validation used push CI run `29066398307`, then serial canary deploys. Pi5 applied the new migration and rebuilt API/Web; StoneBase01 synced the same revision and restarted its kiosk services. Production data had 23 visual rows with zero derivative drift; `7161` returned 18 visual rows and 15 template summaries, while alphanumeric input returned 400 and the internal derivative stayed absent from DTOs. Phase12 passed 45/0/0. A StoneBase Wayland capture confirmed the library, keypad, `無効ON`, and default-hidden row action. No remaining Pi4 or Pi3 host was deployed.

## Context and Orientation

`PartMeasurementVisualTemplate` stores one reusable drawing and its display name. `GET /part-measurement/visual-templates` currently supports raw name search and an optional limit. `GET /part-measurement/inspection-drawing/templates` returns production inspection templates and can filter the related visual name. The Web page owns one menubar digit state, but currently filters visual rows in memory and filters template representatives by `fhincd`. The history checkbox is already functional: it sends `includeInactive=true`, and the page groups active and inactive versions into one lineage.

The result cap applies after template lineage grouping so sibling resources and revisions are not truncated inconsistently. When no digit query is active, existing list behavior remains unchanged. Raw text search, part-number search, resource, process, history, template revision, and retirement API behavior remain compatible.

## Plan of Work

Add `extractInspectionDrawingAsciiDigits` to `@raspi-system/shared-types` and reuse it in Web helpers and every visual-template name write path. Add required `searchDigits` to the Prisma model. Create migration `20260710120000_part_measurement_visual_template_search_digits`: add and backfill the column, set it not null, add a CHECK against `regexp_replace(name, '[^0-9]', '', 'g')`, ensure `pg_trgm`, and add a GIN trigram index.

Extend both list route schemas, service inputs, and Web client inputs with optional digit-only `digitQuery`. Visual queries filter `searchDigits`; inspection-template queries compose `visualTemplate.name` and `visualTemplate.searchDigits` in one relation filter. Responses remain unchanged.

Debounce the menubar state once for 400 ms in the page and pass the settled value to both list hooks. The visual library requests 41 rows and exposes the first 40 plus `hasMore`; template representatives are capped after grouping only while digit search is active. Remove production client-side part-number filtering, while retaining shared-helper filtering for API-free preview fixtures.

Add controlled retirement-mode props to the template filter bar and render the toggle immediately after `履歴`. Pass the optional row retirement callback only while the mode is on. Disable the mode toggle and row retirement action while the mutation is pending, retain the confirmation dialog, and keep the mode on after success.

Update the production-parity DEV preview, focused tests, the prior plan's open-item link, the design-preview README, and the thin global index entry.

## Concrete Steps

Work from `/Users/tsudatakashi/RaspberryPiSystem_002`. Implement in small commits grouped as database/API, Web/UI, then tests/docs. Run Prisma generation after the schema change. Do not deploy or write to any existing database.

For database validation, use a unique no-volume container based on `pgvector/pgvector:pg15` bound to an unused localhost port. Set `DATABASE_URL` only in each validation command. Apply all migrations, run the focused integration suite, then seed synthetic visual rows and run `EXPLAIN (ANALYZE, BUFFERS)` for a selective three-or-more-digit substring. Remove the container in a shell trap and verify no matching container, volume, or network remains.

## Validation and Acceptance

Focused tests must prove `7161-A` and `71-A61` normalize to `7161`; create and rename keep `searchDigits` synchronized; both APIs search drawing-name digits and reject non-digit queries; a part number alone cannot satisfy the menubar digit search; a drawing outside the latest 40 is found; 41 matches render 40 plus guidance; stale requests cannot overwrite newer results; history still sends `includeInactive=true`; row retirement is absent by default, visible only in mode, confirmed before mutation, protected from double submission, and the mode remains on after success.

Run shared-types lint/build, focused API unit and integration tests, focused Web tests, API lint/build, Web lint/build, `git diff --check`, and a local browser smoke against the isolated database or the production-parity DEV preview. All must pass before completion.

## Idempotence and Recovery

The migration is additive and backfills before setting constraints. It can be tested repeatedly only on fresh disposable databases. If validation fails, preserve logs, delete the disposable container, correct the branch, and retry with a new unique container. Never point `DATABASE_URL` at an existing local or production database. No volume or custom network is needed.

## Interfaces and Dependencies

Public additions are optional `digitQuery?: string` query parameters on the two existing GET endpoints and corresponding Web client parameter types. Response DTOs do not change. Internal additions are `PartMeasurementVisualTemplate.searchDigits`, `extractInspectionDrawingAsciiDigits(value)`, visual-hook overflow state, and controlled retirement-mode props on `InspectionDrawingLibraryFilterBar`.
