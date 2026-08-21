# Improve the kiosk self-inspection list and record-review experience

This ExecPlan is a living document maintained according to `.agent/PLANS.md`. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` current throughout implementation.

## Purpose / Big Picture

Operators must be able to scan self-inspection work without enlarging the existing panes or item boundaries, and open inspection records without first entering the shared password. The list will emphasize serial number, machine, and item name, show Japanese resource names and minute-precision update times, and explain status and next action using the established kiosk theme. Record review will expose three top-level categories while retaining detailed workflow states. The kiosk client key remains the read boundary; NFC remains approval evidence; changing the measuring-instrument policy requires the shared password at the mutation itself.

## Progress

- [x] (2026-08-21 JST) Read repository rules, canonical KB/runbook/ADRs, current API/Web implementation, tests, Prisma schema, and prior ExecPlans.
- [x] (2026-08-21 JST) Audited task state and created `feat/kiosk-self-inspection-record-view-uiux` from exact `origin/main` `3a741c29e09d7c3bd14d687678d5f6b073a3d527` with the lifecycle CLI.
- [x] (2026-08-21 JST) Ran the existing layout Playwright spec at 1280x760, 1536x864, and 1920x1080; all four baseline tests passed and screenshots were captured under `/tmp/rps002-self-inspection-baseline`.
- [x] (2026-08-21 JST) Recorded the baseline and post-change geometry contract: 60px page header, 30.8px action control, 94.3px two-row item (43.3px identity plus 51px metadata/action), one pane at 1280px and two panes at 1536px/1920px, with no page-level horizontal overflow.
- [x] (2026-08-21 JST) Added production-schedule `updatedAt`, completed-record aggregation, and operation-time policy authentication with API tests.
- [x] (2026-08-21 JST) Implemented the constrained list presentation and layout with focused and browser tests.
- [x] (2026-08-21 JST) Implemented password-free record viewing, three category buttons, operation-time NFC/password flows, and tests.
- [x] (2026-08-21 JST) Updated ADR, KB-320, runbook, and documentation indexes.
- [x] (2026-08-21 JST) Applied 158 migrations and ran integration tests and SQL/EXPLAIN in uniquely named tmpfs PostgreSQL containers; both temporary containers and networks were removed with zero residue.
- [x] (2026-08-21 JST) Passed focused Web/API tests, Web lint/build, API build, and all seven scoped Chromium layout tests.

## Surprises & Discoveries

- Observation: list items are two table rows with content-driven height, not fixed-size card components; the pane count is already one below 1536px and two at or above it.
  Evidence: `SelfInspectionTable.tsx` and the baseline Playwright spec.
- Observation: `CsvDashboardRow.updatedAt` and its dashboard/update index already exist, but the production-schedule raw projection and public row types omit the field.
  Evidence: Prisma schema and `production-schedule-query/raw-page.ts`.
- Observation: the shared password currently gates the entire React page but creates no server-side permission token; the policy PUT accepts kiosk client-key alone.
  Evidence: `KioskSelfInspectionRecordApprovalPage.tsx`, the verify-password route, and the registration-policy route.
- Observation: on the 10,000-row isolated fixture, `completed_records` and `active` both used `SelfInspectionSession_idx_record_approval_required_at`; the completed query read 15 buffers in 0.160ms and active read 15 buffers in 0.064ms.
  Evidence: `EXPLAIN (ANALYZE, BUFFERS)` in the task-specific PostgreSQL container. The proposed partial index was therefore not justified and no migration was added.
- Observation: the production-schedule fixture intentionally put all 10,000 rows under one dashboard, so PostgreSQL selected a sequential scan plus top-N heapsort (134 buffers, 1.394ms). This does not meet the plan's selective-query trigger for a new index.
  Evidence: isolated `EXPLAIN (ANALYZE, BUFFERS)` output; `updatedAt` was present in the projection and ordering result.

## Decision Log

- Decision: keep client-key authentication for every record GET and remove only the page-level shared-password gate.
  Rationale: this enables the requested normal viewing flow without exposing inspection data anonymously.
  Date/Author: 2026-08-21 / user and Codex.
- Decision: use `active`, `completed_records`, and `invalidated` as the three visible categories; preserve all detailed states and legacy `state` query meanings.
  Rationale: operators get a small decision set while existing clients remain compatible.
  Date/Author: 2026-08-21 / user and Codex.
- Decision: require the shared password inside kiosk registration-policy PUT requests, while ADMIN/MANAGER JWT requests retain their existing path; NFC remains the approval credential.
  Rationale: operation-time security is server-enforced and does not obstruct viewing or the normal approval flow.
  Date/Author: 2026-08-21 / user and Codex.
- Decision: never use `occurredAt` as a last-update substitute. Propagate nullable `updatedAt` and display an em dash when legacy data lacks it.
  Rationale: the labels must not misrepresent schedule occurrence time.
  Date/Author: 2026-08-21 / user and Codex.
- Decision: retain the record-detail presentation as one prop-only component even though it is 583 lines.
  Rationale: query, mutation, NFC lifecycle, filtering, and pure formatting were extracted; the remaining normal/invalidation detail branches share one read-only layout and labels. Splitting those DOM-only branches further would add cross-file prop plumbing without creating an independently changing business or I/O boundary. Page and component tests directly cover this boundary.
  Date/Author: 2026-08-21 / Codex.

## Outcomes & Retrospective

The requested normal paths are implemented. The list retains its outer grid and two-row item geometry while replacing visible column headings with accessible-only semantics, 21px one-line identity values, a one-line metadata/action row, Japanese resource-name priority, minute-only Tokyo timestamps, textual state intent, and one primary action. The record page now reads immediately under client-key authentication, exposes only the three requested categories, starts NFC only after explicit approval intent, and verifies the shared password atomically with a kiosk policy PUT.

The dependency direction is API contracts to pure format/filter/presentation modules to prop-only React components to page/controller. `SelfInspectionTable` owns only pane selection; `SelfInspectionTablePane` owns the fixed table boundary; `SelfInspectionTableItem` owns item rendering; `selfInspectionTableModel` and `selfInspectionListFormatters` own deterministic presentation. The record page owns query/mutation/NFC lifecycle, while its toolbar, list, detail, dialog, and view-model modules own display or pure transformation. The API filter and policy-access service remain independent of route rendering and Web concerns.

Validation passed: Web focused suite 35 tests, API focused suite 31 tests, isolated full part-measurement integration suite 72 tests, Web lint/build, API build, and seven Chromium tests across 1280x760, 1536x864, and 1920x1080. All 158 migrations applied cleanly; failed migration count was zero; schema inspection confirmed `CsvDashboardRow.updatedAt` and existing indexes. EXPLAIN evidence did not justify a new index. No production or pre-existing Docker resource was used or changed, and each task-specific container/network cleanup reported zero remaining matches.

## Context and Orientation

`apps/web/src/pages/kiosk/KioskSelfInspectionPage.tsx` orchestrates list queries and interactions. `apps/web/src/features/part-measurement/SelfInspectionTable.tsx` owns pane geometry, while `selfInspectionTableModel.ts` creates rows and actions. `KioskSelfInspectionRecordApprovalPage.tsx` currently combines password gating, queries, NFC, filters, list, and detail presentation and must be decomposed rather than enlarged.

The API production-schedule projection is under `apps/api/src/services/production-schedule/production-schedule-query/`. Record-review search is under `apps/api/src/services/part-measurement/self-inspection/use-cases/record-approval.ts`; its route schemas are in `apps/api/src/routes/part-measurement/shared.ts`. Registration policy is stored through `self-inspection-registration-policy.service.ts`.

## Plan of Work

First record baseline item/pane bounds with the existing mocked browser fixture. Then propagate nullable production-schedule `updatedAt`, add a pure record-approval filter that understands an exclusive `scope=completed_records`, and enforce the shared password on kiosk policy mutations. Preserve legacy query states and DTOs.

Next create pure list presentation data and focused item/pane components. Keep the current parent grid and two-row item boundary. The first visual row contains serial, machine, and item name in white 21px one-line fields at 30/30/40 proportions. The second contains a one-line gray metadata region, a textual state/intent region, and actions. Japanese resource names are primary; code is secondary or fallback. At most one non-danger action is primary.

Then decompose record review into pure filter/presentation logic and display components. Remove the entry password state, fetch readable data immediately with client-key, render three pressed-state buttons, and start NFC only after explicit approval intent. Policy changes use a password dialog whose single PUT both verifies and mutates; the password is never persisted.

Finally update a new ADR, KB-320, the kiosk runbook, and documentation indexes. Validate Web/API behavior, browser geometry, and database queries. Do not push, open a PR, merge, or deploy.

## Concrete Steps

Work only in the lifecycle-created worktree. Run focused tests after each subsystem, then Web lint/build and API build. Use a uniquely named `pgvector/pgvector:pg15` container on a unique network with tmpfs data and a loopback random port. Register cleanup before creation, run `prisma migrate deploy`, `migrate status`, integration tests, SQL catalog checks, and `EXPLAIN (ANALYZE, BUFFERS)`, then remove the exact container and network and prove no residue remains.

## Validation and Acceptance

At 1280x760 the list remains one pane; at 1536x864 and 1920x1080 it remains two. Header height remains 60px, action height remains 30.8px, pane and item outer bounds do not grow beyond one pixel, and no horizontal overflow appears. Identity values are white 21px, one line, truncated with accessible full text. Metadata is one gray line. Visible headers are gone.

Record review opens without calling the password verifier. Missing client-key remains 401. The three visible categories return the correct existing or aggregate datasets, and `completed_records` filters in the database before the 201-row limit. Policy PUT is 403 for missing/wrong kiosk password, succeeds for the correct password, and preserves the JWT manager path. NFC is inactive during reading and active only during explicit approval.

## Idempotence and Recovery

All database writes are limited to the uniquely named temporary database. No fixed-name test helper may be used because it deletes an existing container. Cleanup targets only names generated for this task. A failed focused test may be rerun once after diagnosing the failure. No reset, clean, stash, force worktree removal, or production mutation is permitted.

## Artifacts and Notes

Baseline/post-change geometry is 60px header, 30.8px action, and 94.3px per two-row item (43.3px plus 51px); pane counts are 1/2/2 at 1280/1536/1920 and horizontal overflow is absent. Browser assertions enforce the same geometry after the markup change.

The first isolated resources were `rps002-self-inspection-20260821113200-70471` and `rps002-self-inspection-20260821113200-70471-net`, with PostgreSQL exposed only on loopback port 54118 and data on tmpfs. A second independently named tmpfs container/network was used only for reproducible EXPLAIN capture. Cleanup checks after both runs reported `REMAINING_CONTAINERS=0` and `REMAINING_NETWORKS=0`; no Docker volume was created.

API compatibility evidence: omitting `scope` retains the legacy `state` behavior and response DTO; `scope=completed_records` is additive, `state` plus `scope` returns 400, the 200-record response limit/detail APIs are unchanged, and GET without client-key remains 401. Kiosk policy PUT now returns 403 for a missing/wrong password and 429 through the existing 10/minute limiter, while the ADMIN/MANAGER JWT path remains password-free.

## Interfaces and Dependencies

The production-schedule row gains `updatedAt: Date | null` internally and `updatedAt: string | null` at the Web boundary. Record approval GET gains optional `scope: 'completed_records'`, mutually exclusive with `state`. Registration-policy PUT gains optional `accessPassword`; the route requires it for client-key requests and not for authenticated ADMIN/MANAGER requests. All additions are backward compatible; no existing detailed state, DTO field, or limit is removed.
