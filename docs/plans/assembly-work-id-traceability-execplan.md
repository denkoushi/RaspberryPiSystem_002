---
title: Assembly Work ID, Genealogy, and Formal Identifier Traceability
id: plan-assembly-work-id-traceability
status: complete
scope: assembly work IDs, subassembly genealogy, formal identifiers, kiosk UI, Excel export, and disposable-Postgres validation
date: 2026-07-20
source_of_truth: this file
related_code: apps/api/prisma/schema.prisma, apps/api/src/routes/assembly/index.ts, apps/api/src/services/assembly, apps/web/src/pages/kiosk/KioskAssemblyTraceabilityPage.tsx, apps/web/src/features/assembly
related_docs: ../decisions/ADR-20260720-assembly-work-id-genealogy-and-formal-id.md, .agent/PLANS.md
validation: isolated PostgreSQL migration, 23 focused API integration tests, work-ID UI tests, API/Web type checks, targeted lint, index inspection, and EXPLAIN all pass; disposable containers were removed
open_items: none
---

# Add Work IDs, Product Genealogy, and Formal IDs to Assembly

This ExecPlan is a living document. Maintain it in accordance with `.agent/PLANS.md` from the repository root.

## Purpose / Big Picture

An operator can start every physical subassembly with a unique 作業用ID (work ID), complete it independently, combine completed subassemblies into an arbitrary-depth product tree, and then assign one formal identifier to the completed top-level product. The final identifier is visible from every component through its genealogy. Corrections leave history instead of overwriting evidence.

## Progress

- [x] (2026-07-20) Confirmed a clean `feat/assembly-torque-wrench-traceability` worktree and created `feat/assembly-work-id-genealogy` from it.
- [x] (2026-07-20) Re-read repository safety, architecture, documentation, test, Git, UI, and ExecPlan rules.
- [x] (2026-07-20) Added the mapped work-unit schema, append-only composition/formal-ID tables, API services/routes, kiosk route, and Excel history output.
- [x] (2026-07-20) Added API integration coverage for hierarchy, conflict guards, password enforcement, formal-ID correction, and Excel output.
- [x] (2026-07-20) Passed API build type checking and Web type checking.
- [x] (2026-07-20) Applied all 150 migrations to a disposable `pgvector/pgvector:pg15` database; focused API integration passed 23/23 after the final CTE and summary changes.
- [x] (2026-07-20) Passed Web traceability-page tests 2/2, API/Web type checks, targeted API/Web lint, and `git diff --check`.
- [x] (2026-07-20) Inspected partial indexes and ran `EXPLAIN (ANALYZE, BUFFERS)` against the disposable database; all temporary containers were removed.

## Surprises & Discoveries

- Observation: existing physical names are `AssemblySerialRegistry`, `serialNo`, and `serialRegistryId`.
  Evidence: the current schema and migration `20260708090000_assembly_lot_serial_workflow` persist those names in already deployed data.
- Observation: the pre-existing kiosk normalizer removed `-` and other useful identifier punctuation.
  Evidence: `KioskAssemblyHomePage` used an alphanumeric-only serial normalizer. The work-ID path now preserves the supported identifier punctuation.
- Observation: repository test scripts use a fixed Postgres container name and may stop it.
  Evidence: `scripts/test/start-postgres.sh` targets `postgres-test-local`; disposable validation must not use that script.

## Decision Log

- Decision: keep the physical registry table and column names, while exposing `AssemblyWorkUnit.workId` in Prisma and all new contracts.
  Rationale: existing IDs and references remain valid without a destructive table/column rename.
  Date/Author: 2026-07-20 / Codex
- Decision: model composition and formal IDs as append-only history rows with partial unique indexes for active state.
  Rationale: corrections are auditable, and PostgreSQL enforces one active parent and one active formal assignment even under concurrent requests.
  Date/Author: 2026-07-20 / Codex
- Decision: use the existing shared due-management password configuration, but verify it in every mutation service call.
  Rationale: the kiosk unlock UI alone cannot protect direct HTTP calls; no unrelated password configuration is duplicated.
  Date/Author: 2026-07-20 / Codex
- Decision: read an active genealogy with one recursive CTE followed by one bounded work-unit query.
  Rationale: this avoids one database query per tree node while retaining arbitrary depth and keeping the tree assembly in the service boundary.
  Date/Author: 2026-07-20 / Codex

## Outcomes & Retrospective

The feature is implemented and locally validated. Existing physical table and column names remain unchanged; newly issued IDs and kiosk labels use 作業用ID. The only intentionally deferred work is future formal-ID auto-numbering, BOM validation, and shipment enforcement.

## Context and Orientation

`AssemblyWorkUnit` is the code-level name for the one globally unique ID issued when assembly begins. Its underlying table remains `AssemblySerialRegistry`. A composition link connects one parent work unit to one child work unit; an active link has no `unlinkedAt` timestamp. A formal-ID assignment is the later official number for a top-level finished unit; an active assignment has no `supersededAt` timestamp. Neither history table is hard-deleted during normal correction.

The API route module is `apps/api/src/routes/assembly/index.ts`. Business constraints belong to `AssemblyTraceabilityService`; database queries and locks belong to `AssemblyTraceabilityRepository`; the password boundary belongs to `AssemblyTraceabilityAccessService`. The React page uses these HTTP contracts and does not implement status, cycle, or uniqueness rules itself.

## Plan of Work

The Prisma model maps `workId` to the deployed `serialNo` column and maps the existing foreign-key columns to `workUnitId`. The migration only creates `AssemblyWorkUnitComposition` and `AssemblyFormalIdentifierAssignment`, their foreign keys, normal indexes, and partial unique indexes. It must not rename or backfill existing assembly rows.

The traceability service normalizes identifiers, locks candidate work units in deterministic ID order, checks completion and parent eligibility, rejects self-links, duplicate active parents, active cycles, and formal-ID-bearing children, then creates one link transactionally. Unlink and reparent operations timestamp the prior row and record actor/reason. Formal assignment requires a completed root; correction timestamps the old assignment before inserting a new one. The globally unique formal-ID column prevents reuse after correction.

The kiosk page verifies the same password before use, retains it only in React memory, accepts keyboard or barcode-agent input for parent, child, and formal fields, and requires a reason plus confirmation for unlink, reparent, and correction. The work-start area and cards call the identifier a 作業用ID. Legacy `serialNo` input/response aliases remain at API boundaries until old clients are migrated.

## Concrete Steps

From the repository root, first confirm no user work is mixed in:

    git status --short
    git diff --check
    git switch -c feat/assembly-work-id-genealogy

Generate the Prisma client after schema changes:

    apps/api/node_modules/.bin/prisma generate --schema=apps/api/prisma/schema.prisma

Do not use `scripts/test/start-postgres.sh`. It owns a fixed existing container. Before validation, inspect existing Docker state and select an unused loopback port. Start one named disposable container with `--rm`, apply migrations only to it, and use an EXIT trap to remove it.

## Validation and Acceptance

Use a temporary PostgreSQL database to prove all migrations apply. Run the focused assembly integration file, API build type check, Web test/build/type check, and inspect the two partial indexes in `pg_indexes`. Run `EXPLAIN (ANALYZE, BUFFERS)` for active-child lookup and top-level completed-product lookup. If a tiny fixture chooses a sequential scan, repeat the plan inside the temporary database with `SET LOCAL enable_seqscan = off` to prove index eligibility.

An operator acceptance scenario is: complete `SUB-001` and `SUB-002`; link both under `FINAL-001`; assign `FORMAL-001`; resolve either subassembly and see `FORMAL-001` at the root. Attempting to link `SUB-001` to a second parent, assign an ID to a child, reuse a corrected formal ID, or omit the management password must be refused. Correcting `FORMAL-001` to `FORMAL-002` must retain both assignments and a reason in the Excel history sheet.

## Idempotence and Recovery

The migration is additive and is applied once by Prisma migration history. Retrying a failed API mutation is safe because active unique indexes and transactions prevent duplicates. Failed local validation must remove only the unique temporary container; no existing container, database, named volume, or custom network is touched. If the branch is discarded before deployment, no production data has been modified.

## Artifacts and Notes

Disposable validation used three distinct `--rm` containers named `rps-assembly-traceability-*` on loopback-only ports 55439–55441. Each applied all 150 migrations, including `20260720120000_assembly_work_id_genealogy`; the final focused API run passed 23/23 tests. The Web page test passed 2/2 using the application Vitest configuration. API and Web type checks plus targeted lint passed.

`pg_indexes` showed `AssemblyWorkUnitComposition_unique_active_child` (partial on active child) and `AssemblyFormalIdentifierAssignment_unique_active_work_unit` (partial on active assignment). With `enable_seqscan = off` in the disposable database, active-child lookup used `Index Scan using AssemblyWorkUnitComposition_unique_active_child`; the root anti-join used `Index Only Scan using AssemblyWorkUnitComposition_unique_active_child`. Every validation shell installed an EXIT trap and Docker reported no remaining containers afterward. No existing container, database, named volume, or network was touched.
