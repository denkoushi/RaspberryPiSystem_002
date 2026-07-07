# ADR-20260707: Assembly Procedure Order Scoped to Assembly Library Documents

- Status: accepted
- Date: 2026-07-07
- Scope: kiosk assembly procedure order settings (`/kiosk/assembly/procedure-order-settings`), assembly work session procedure sequence, assembly library page, assembly home page
- related_code:
  - `apps/api/prisma/migrations/20260707035701_assembly_procedure_order_item_assembly_document/migration.sql`
  - `apps/api/src/services/assembly/assembly-procedure-order.service.ts`
  - `apps/api/src/services/assembly/assembly-procedure-sequence.service.ts`
  - `apps/api/src/services/assembly/assembly-seiban-lot-quantity.service.ts`
  - `apps/api/src/services/assembly/assembly-operator-nfc-resolve.service.ts`
  - `apps/web/src/pages/kiosk/KioskAssemblyProcedureOrderSettingsPage.tsx`
  - `apps/web/src/pages/kiosk/KioskAssemblyHomePage.tsx`
  - `apps/web/src/features/assembly/AssemblyCompletedPane.tsx`
- related_docs: `docs/plans/kiosk-assembly-torque-management-mvp.md`, `docs/decisions/ADR-20260706-kiosk-display-performance-optimizations.md`

## Context

The assembly procedure order settings page listed all enabled `KioskDocument` rows (cross-process PDF 要領書, manual upload and Gmail ingest). Documents imported from the assembly library page (組立 手順書/テンプレート管理) are stored in a separate table, `AssemblyProcedureDocument` (single-page image), so they could never appear in the order settings page. The operator expectation was: "組立 手順書/テンプレート管理からインポートした手順書だけを閲覧順の対象にしたい".

## Decision

1. **Schema**: `AssemblyProcedureOrderItem` gains a nullable `assemblyProcedureDocumentId` (FK to `AssemblyProcedureDocument`, `ON DELETE RESTRICT`) and `kioskDocumentId` becomes nullable. Each item must reference exactly one of the two (validated at the service layer; 400 otherwise). Migration is additive/non-destructive (nullable change + column + index + FK only).
2. **Settings UI**: the add-source pane lists only active `AssemblyProcedureDocument` rows. Existing `KioskDocument`-based items remain visible, sortable, and removable (with a type badge) for backward compatibility.
3. **Preview pane**: the page is now 3 panes (registered order / document list / preview). Assembly documents preview their single image; kiosk documents preview `pageUrls` with simple page navigation. List panes use compact fixed-ish widths (`xl:grid-cols-[20rem_20rem_minmax(0,1fr)]`) so the leftover width goes to the preview.
4. **Sequence resolution**: `resolveForWorkSession` resolves assembly-document items as `pageUrls = [imageRelativePath]`, kiosk-document items as before. `DELETE /api/assembly/procedure-documents/:id` returns 409 while referenced by an order set (same pattern as the kiosk-documents guard).

Related changes shipped together (same feature request, recorded here to avoid a second source of truth):

- Assembly library page header keeps only 「組立トップ」 (renamed from 「組立開始へ」); 「検査図面へ」「新規」 were removed, and the per-template 「作業」 button plus the dead `/kiosk/assembly/work/start` page/routes were deleted (start flow is unified on the assembly home page).
- Assembly home page adds a 完了した製品 pane (`GET /api/assembly/work-sessions/summary?status=completed`), lot quantity display via `GET /api/assembly/seiban-lot-quantities` (production actual hours: `DISTINCT (fseiban, lotNo, lotQty)` then sum per fseiban), and NFC operator input via `useNfcStream` + `POST /api/assembly/operators/resolve-nfc` (`Employee.nfcTagUid`; sets `operatorNameSnapshot` and `operatorEmployeeId`; manual edit clears the employee id).

## Alternatives

- Import assembly library documents into `KioskDocument` as well (tag by category): rejected, duplicates storage and creates two write paths for the same artifact.
- Repoint `AssemblyProcedureOrderItem.kioskDocumentId` to `AssemblyProcedureDocument` (destructive migration): rejected, would orphan or drop existing production order data.

## Consequences

- Existing production order sets referencing `KioskDocument` keep working (list, save, sequence, viewer fallback).
- New order items are expected to reference assembly library documents; the KioskDocument add-path no longer exists in the UI.
- NFC input requires the kiosk NFC agent WebSocket (`useNfcStream` policy); on non-kiosk hosts the field stays manual-input only.

## Validation

- `pnpm --filter @raspi-system/api build` / `lint`, `pnpm --filter @raspi-system/web build` / `lint`: pass (merged main, 2026-07-07).
- Web unit tests: 258 files / 1291 tests pass.
- API assembly integration tests (`assembly.integration.test.ts`, 10 tests incl. new order-item compatibility and 409 guard cases) pass against a temporary Postgres container (`pgvector/pgvector:pg16`, `prisma migrate deploy` clean, 133 migrations). Temporary container/volume removed after verification.
- Not yet verified: on-device kiosk behavior (NFC agent, Pi displays) and production deploy.

## Open Items

- On-device verification and production deploy are pending user instruction.

## References

- Merge commits on `main`: `d615062d` (library cleanup), `000ecc1a` (assembly home), `3f322653` (procedure order scope), `bec8e09c` (test alignment).
