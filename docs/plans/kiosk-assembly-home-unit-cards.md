---
title: Kiosk Assembly Home Unit Cards
id: plan-kiosk-assembly-home-unit-cards
status: done
scope: kiosk assembly home (`/kiosk/assembly`) — per-unit cards in the three left panes
date: 2026-07-14
source_of_truth: this file
related_code: apps/web/src/pages/kiosk/KioskAssemblyHomePage.tsx, apps/web/src/features/assembly/AssemblyItemCard.tsx, apps/web/src/features/assembly/AssemblyItemPane.tsx, apps/web/src/features/assembly/assemblyHomeItemPresentation.ts, apps/web/src/features/assembly/AssemblyLotPane.tsx, apps/web/src/features/assembly/AssemblyWipPane.tsx, apps/web/src/features/assembly/AssemblyCompletedPane.tsx
related_docs: ../decisions/ADR-20260707-assembly-kiosk-record-approval-and-ui-consistency.md, ../design-previews/kiosk-assembly-home-unit-cards-preview.html, ../design-previews/README.md, ../INDEX.md
validation: focused web vitest 6 files / 18 tests; full web vitest passed; web lint; web build; assembly integration 19 tests + seiban-lot-quantity service 5 tests on isolated pgvector/pg15:55440 (disposed); migration history SQL + AssemblyLot/AssemblyWorkSession EXPLAIN (ANALYZE, BUFFERS) on isolated pgvector/pg15:55439 (disposed)
open_items: none
---

# Kiosk Assembly Home Unit Cards

## Purpose

Make each serial-numbered unit scannable in the existing three-pane assembly home: `着手前` / `仕掛中` / `完了・承認`. The right-side lot registration workflow and all APIs remain unchanged.

## Decision

- Branch: `feat/kiosk-assembly-unit-cards`, created from `origin/main` because `main` is checked out by another local worktree.
- Add header KPIs for registered lots, WIP sessions, and pending approvals.
- Convert only `not_started` lot serials into individual `着手前` cards. WIP and completed cards remain session-based. Cancelled serials are excluded.
- Every card starts closed. Its compact portion is `製番・S/N・進捗` plus a second machine-name row; the name uses `break-words` and may add a line rather than truncate.
- State badges are removed from cards. Pending approval remains a header KPI and the record-confirmation screen remains the per-record authority.
- Expanded details and actions use existing DTO fields. Not-started progress is `0%`; WIP/completed progress is accepted bolts over total bolts. No API, Prisma, or migration change is required.
- `AssemblyItemCard` owns accessible expansion, `AssemblyItemPane` owns shared pane chrome, and pure presentation functions isolate DTO-to-view conversion.

## Progress

- [x] Create implementation branch.
- [x] Replace table-only panes with per-unit card composition.
- [x] Add pure presentation mapping and focused tests.
- [x] Update page header KPI presentation.
- [x] Add ADR, preview, and index references.
- [x] Complete lint/build and isolated Postgres API regression.

## Validation

Run focused Web tests, Web lint, and Web build. For API regression, start a uniquely named temporary `pgvector/pgvector:pg15` container on an available localhost port; point `DATABASE_URL` only there; run `prisma generate`, `prisma migrate deploy`, migration-history SQL, and `EXPLAIN (ANALYZE, BUFFERS)` for the assembly lot/session summary lead queries; then execute the assembly integration and seiban-lot-quantity tests. Always remove the temporary container in a shell `trap`; never call the shared `scripts/test/start-postgres.sh` or `pnpm test:api`, because those may operate on an existing named container.

## Outcomes

Focused Web tests (6 files / 18 tests), full Web Vitest, lint, and production build passed. The API assembly integration suite (19 tests) and seiban-lot-quantity service suite (5 tests) passed against a fresh temporary `pgvector/pgvector:pg15` database on localhost port 55440, which was removed by the shell trap. The full migration chain applied cleanly to a separate fresh temporary database on port 55439. `EXPLAIN (ANALYZE, BUFFERS)` confirmed the empty-test-data lot listing is a short sequential scan and the status-filtered WIP listing uses `AssemblyWorkSession_idx_status_updated` backward. No deployment is included in this change.
