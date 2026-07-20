---
id: ADR-20260720-assembly-work-id-genealogy-and-formal-id
status: accepted
scope: assembly work IDs, product genealogy, and formal identifiers
date: 2026-07-20
source_of_truth: this file
related_code: apps/api/prisma/schema.prisma, apps/api/src/services/assembly/assembly-traceability.service.ts, apps/web/src/pages/kiosk/KioskAssemblyTraceabilityPage.tsx
related_docs: ../plans/assembly-work-id-traceability-execplan.md
validation: isolated migration, API integration, UI tests, and partial-index EXPLAIN are required
open_items: none
---

# ADR-20260720: Assembly Work ID Genealogy and Formal Identifier History

## Context

The previous assembly flow called the ID entered at work start a serial number, even though the real formal product identifier is assigned only after completion. Products may consist of several independently completed subassemblies, so a single direct formal-ID column on every work record cannot accurately represent the relationship.

## Decision

1. The ID issued or entered at work start is named 作業用ID in new UI and APIs. The deployed `AssemblySerialRegistry.serialNo` storage remains unchanged and is mapped to `AssemblyWorkUnit.workId` in Prisma.
2. An append-only composition table represents parent/child work-unit history. A partial unique index permits a child to have only one active parent, while permitting historical correction records.
3. A formal-ID history table assigns one active formal ID to one top-level completed work unit. Formal IDs are globally unique forever, including superseded entries.
4. Children must be completed; parents must be in progress or completed; cycles, self-links, second active parents, formal-ID-bearing children, and formal IDs on non-root or incomplete units are refused by the service and database constraints.
5. Unlink, reparent, and formal-ID correction require a reason and preserve actor/device snapshots. Every mutation verifies the existing shared management password server-side.
6. Existing `serialNo` and `serialNos` request/response aliases remain only as compatibility adapters. New contracts and UI use `workId` and `workIds`.

## Alternatives

- Overwrite a formal-ID field on the work session: rejected because corrections would erase audit evidence and children cannot safely share one final ID.
- Give each work unit a formal-ID column: rejected because it duplicates the final product ID across components and cannot represent reassignment history.
- Create a separate final-product master for v1: rejected because a work unit already supplies the physical completion anchor; a composition graph provides arbitrary depth without a duplicate lifecycle.
- Enforce BOM matching in this feature: rejected because BOM validation rules are not yet defined. The composition model intentionally remains reusable for a later BOM policy.

## Consequences

The API, UI, and export gain clear work-ID terminology and a controlled formalization step. The database grows by two history tables and partial indexes, but existing assembly records remain usable and begin with no formal ID. Formal-ID assignment is ready to become a future shipment eligibility condition without coupling this feature to a nonexistent shipment domain.

## Validation

Apply the migration to an isolated PostgreSQL instance, test multi-level construction and conflicting writes, verify password enforcement and correction history, inspect partial indexes, run `EXPLAIN (ANALYZE, BUFFERS)`, and confirm Excel includes work ID, formal ID, and history.

## Supersedes / Superseded By

- Supersedes: none.
- Superseded by: none.

## Local Notes JA

- 作業用IDは製番の後に番号を付与する将来ルールにも対応するが、v1は利用者入力と重複拒否だけを担う。
- 正式IDの採番・BOM照合・出荷ブロックはこの決定には含めない。
