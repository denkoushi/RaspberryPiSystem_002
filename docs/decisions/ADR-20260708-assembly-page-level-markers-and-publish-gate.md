# ADR-20260708: Assembly Page-Level Markers and Procedure Publish Gate

- Status: accepted
- Date: 2026-07-08
- Scope: assembly procedure library, template bolt/check markers, work-session completion, procedure sequence resolution
- Supersedes (partial): [ADR-20260707-assembly-procedure-order-library-scope](./ADR-20260707-assembly-procedure-order-library-scope.md) — marker placement is no longer limited to assembly-library documents for templates; kiosk PDF pages are valid marker targets again at the template layer
- related_code:
  - `apps/api/prisma/migrations/20260708101417_assembly_unified_workflow_p1_schema/migration.sql`
  - `apps/api/prisma/schema.prisma` (assembly models)
- related_docs: `docs/plans/assembly-unified-workflow-execplan.md`, `docs/plans/kiosk-assembly-torque-management-mvp.md`, `docs/decisions/ADR-20260707-assembly-procedure-order-library-scope.md`

## Context

The assembly kiosk MVP stored each procedure document as a single image (`AssemblyProcedureDocument.imageRelativePath`) and placed bolt markers implicitly on that image. Viewing-order settings were later restricted to assembly-library documents ([ADR-20260707](./ADR-20260707-assembly-procedure-order-library-scope.md)), but operators still need:

- Multi-page procedure imports (PDFs with more than one page).
- Explicit review before a imported document becomes usable in production settings.
- Bolt markers on arbitrary pages in the work sequence (including legacy `KioskDocument` PDF pages).
- A separate check-sheet marker type (OK toggle) with its own completion gate before session complete.

## Decision

1. **Publish gate** — Add `AssemblyProcedureDocumentStatus` (`DRAFT` | `PUBLISHED`) and `publishedAt`. New imports default to `DRAFT`. Viewing order, template primary document, and explicit marker page references require `PUBLISHED`. Migration backfills existing rows to `PUBLISHED` for compatibility.

2. **Multi-page storage** — Add `AssemblyProcedureDocumentPage` (`documentId`, `pageIndex`, `imageRelativePath`). Keep `imageRelativePath` on the parent as the first-page mirror. Migration inserts `pageIndex=0` from existing data.

3. **Page-level bolt refs** — Extend `AssemblyTemplateBolt` with optional `kioskDocumentId | assemblyProcedureDocumentId + pageIndex`. All null preserves legacy behavior (template `procedureDocument` first page).

4. **Separate check model** — Add `AssemblyTemplateCheckItem` (template-scoped, copied on revise) and `AssemblyCheckRecord` (session upsert). Do not overload bolt/torque records for check toggles.

5. **Completion** — Session complete requires existing all-bolt-accepted rule **and** all `required` check items checked. NFC record approval remains a post-completion step (unchanged).

## Alternatives

- **Store checks as pseudo-bolts with zero torque**: rejected; mixes audit semantics and complicates torque summaries/exports.
- **Require unpublish instead of delete**: rejected for Phase 1; unpublish with 409 when referenced is enough; delete guards extended in API phase.
- **Drop `imageRelativePath` in favor of pages only**: rejected; would break existing clients and protected-image URLs without a coordinated API break.

## Consequences

- Phase 2 must implement publish/unpublish endpoints and enforce `PUBLISHED` in order/template/session services.
- Phase 3 must add dual marker editing and sequence overlay keyed by `(source, documentId, pageIndex)`.
- ADR-20260707 remains authoritative for **viewing-order settings UI listing** (assembly library docs as add source); template markers may reference kiosk PDF pages even when order items do not.

## Validation

- Migration `20260708101417` applies cleanly on empty DB after full chain (`prisma migrate deploy`, 136 migrations).
- `pnpm --filter @raspi-system/api exec prisma generate` and `tsc -p tsconfig.build.json` pass with schema-only changes.
- Data backfill: `AssemblyProcedureDocument` all `PUBLISHED`; one page row per pre-existing document.

## Open Items

- Phase 2 API and Phase 3 UI (see ExecPlan).
- Whether unpublish should clear `publishedAt` only or also block reads of in-flight sessions referencing the document (default: block new refs, allow in-progress sessions to finish).

## Local Notes JA

- 閲覧順設定の追加元UIは ADR-20260707 のとおり組立ライブラリ手順書中心のまま。テンプレート上のマーカー配置だけ KioskDocument ページへ拡張する。
