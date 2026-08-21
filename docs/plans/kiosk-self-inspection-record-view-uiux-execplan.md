# Improve the kiosk self-inspection list and record-review experience

This ExecPlan is a living document maintained according to `.agent/PLANS.md`. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` current throughout implementation.

## Purpose / Big Picture

Operators must be able to scan self-inspection work without enlarging the existing panes or item boundaries, and open inspection records without first entering the shared password. The list will emphasize serial number, machine, and item name, show Japanese resource names and minute-precision update times, and explain status and next action using the established kiosk theme. Record review will expose three top-level categories while retaining detailed workflow states. The kiosk client key remains the read boundary; NFC remains approval evidence; changing the measuring-instrument policy requires the shared password at the mutation itself.

## Progress

- [x] (2026-08-21 JST) Read repository rules, canonical KB/runbook/ADRs, current API/Web implementation, tests, Prisma schema, and prior ExecPlans.
- [x] (2026-08-21 JST) Audited task state and created `feat/kiosk-self-inspection-record-view-uiux` from exact `origin/main` `3a741c29e09d7c3bd14d687678d5f6b073a3d527` with the lifecycle CLI.
- [x] (2026-08-21 JST) Ran the existing layout Playwright spec at 1280x760, 1536x864, and 1920x1080; all four baseline tests passed and screenshots were captured under `/tmp/rps002-self-inspection-baseline`.
- [ ] Record exact baseline item and pane geometry before list markup changes.
- [ ] Add production-schedule `updatedAt`, completed-record aggregation, and operation-time policy authentication with API tests.
- [ ] Implement the constrained list presentation and layout with focused and browser tests.
- [ ] Implement password-free record viewing, three category buttons, operation-time NFC/password flows, and tests.
- [ ] Update ADR, KB, runbook, and indexes.
- [ ] Validate on an isolated temporary PostgreSQL instance, run SQL and EXPLAIN, run all scoped quality gates, and record cleanup evidence.

## Surprises & Discoveries

- Observation: list items are two table rows with content-driven height, not fixed-size card components; the pane count is already one below 1536px and two at or above it.
  Evidence: `SelfInspectionTable.tsx` and the baseline Playwright spec.
- Observation: `CsvDashboardRow.updatedAt` and its dashboard/update index already exist, but the production-schedule raw projection and public row types omit the field.
  Evidence: Prisma schema and `production-schedule-query/raw-page.ts`.
- Observation: the shared password currently gates the entire React page but creates no server-side permission token; the policy PUT accepts kiosk client-key alone.
  Evidence: `KioskSelfInspectionRecordApprovalPage.tsx`, the verify-password route, and the registration-policy route.

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

## Outcomes & Retrospective

Implementation is in progress. Complete this section with user-visible results, module boundaries, test evidence, database plan evidence, and any remaining work.

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

Record baseline/post-change geometry, concise test summaries, migration status, SQL catalog output, EXPLAIN node/timing/buffer evidence, exact temporary Docker names, and cleanup proof here as work proceeds.

## Interfaces and Dependencies

The production-schedule row gains `updatedAt: Date | null` internally and `updatedAt: string | null` at the Web boundary. Record approval GET gains optional `scope: 'completed_records'`, mutually exclusive with `state`. Registration-policy PUT gains optional `accessPassword`; the route requires it for client-key requests and not for authenticated ADMIN/MANAGER requests. All additions are backward compatible; no existing detailed state, DTO field, or limit is removed.
