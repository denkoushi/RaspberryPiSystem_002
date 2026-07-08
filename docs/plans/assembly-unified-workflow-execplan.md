---
title: Assembly Unified Workflow (Phase 1–4)
id: plan-assembly-unified-workflow
status: active
scope: kiosk assembly procedure library, publish gate, multi-page procedure documents, page-level bolt/check markers, work-session completion gate, record approval aggregation
date: 2026-07-08
source_of_truth: this file
phase: 1 complete (schema + migration + design); 2 complete (API); 3 complete (Web); 4 validation complete; production deploy complete (2026-07-08)
branch: main
related_code: apps/api/prisma/schema.prisma, apps/api/prisma/migrations/20260708101417_assembly_unified_workflow_p1_schema, apps/api/src/routes/assembly/index.ts, apps/api/src/services/assembly, apps/web/src/features/assembly, apps/web/src/pages/kiosk/KioskAssemblyPage.tsx, apps/web/src/pages/kiosk/KioskAssemblyTemplateEditorPage.tsx, apps/web/src/pages/kiosk/KioskAssemblyWorkSessionPage.tsx
related_docs: ../decisions/ADR-20260708-assembly-page-level-markers-and-publish-gate.md, ../decisions/ADR-20260707-assembly-procedure-order-library-scope.md, ./kiosk-assembly-torque-management-mvp.md, ../INDEX.md
open_items: kiosk touch smoke on hardware (publish badge, dual markers, check toggle)
---

# Assembly Unified Workflow ExecPlan

This Plan is the source of truth for completing the assembly kiosk workflow: multi-page procedure documents, explicit publish gate, page-level bolt and check markers on any procedure page (including `KioskDocument` PDF pages), check-sheet completion gate, and record-approval aggregation. Phase 1 (this branch) delivers Prisma schema, migration, and contracts only.

## Scope

- Procedure document import stores **all pages** (max 40) as `AssemblyProcedureDocumentPage` rows; legacy `imageRelativePath` remains the first page mirror.
- **Publish gate**: new imports start as `DRAFT`; only `PUBLISHED` documents may be referenced by viewing order, templates, or marker page refs. Existing rows were backfilled to `PUBLISHED`.
- **Two marker kinds** on arbitrary sequence pages:
  - **Bolt markers** (existing `AssemblyTemplateBolt`): torque recording; may reference `kioskDocumentId | assemblyProcedureDocumentId + pageIndex`, or omit refs for legacy template-document first-page behavior.
  - **Check markers** (new `AssemblyTemplateCheckItem`): OK/confirmed toggle only in Phase 1 design; same page-ref model.
- **Completion**: all bolts accepted (existing rule) **and** all `required` check items checked.
- **Approval**: unchanged NFC approval after completion (`AssemblyWorkSessionApproval`).

## Non-goals

- Bluetooth torque-agent integration, mock/agent input protocol changes, or torque-wrench pairing.
- Procedure **viewing** completion audit (page viewed timestamps as a quality gate).
- NFC serial scan (serial remains software keypad / lot registry).
- Excel export shape changes beyond adding check aggregates where noted.
- Changing record-approval authority model (still ACTIVE employee NFC at approve time).
- Merging `AssemblyProcedureDocument` into `KioskDocument`.

## Confirmed Operational Policy (user agreement)

1. **Publish gate** — import → `DRAFT`; explicit publish → `PUBLISHED`; only published docs in order/template/marker refs.
2. **Multi-page import** — render/save every page; cap 40 pages per document.
3. **Two marker types** — bolts (torque) and checks (toggle); both placeable on any page in the work sequence (kiosk PDF or assembly procedure pages).
4. **Completion** — all tightening complete + all required checks complete.
5. **Approval** — post-completion record review + NFC approve (no change).
6. **Compatibility** — existing documents migrated to `PUBLISHED`; bolts with null page refs keep template `procedureDocument` first-page semantics.

## Phase 1 Delivered (schema + migration)

Migration: `20260708101417_assembly_unified_workflow_p1_schema`

### Data model delta

| Model / enum | Change |
|---|---|
| `AssemblyProcedureDocumentStatus` | New enum: `DRAFT`, `PUBLISHED` |
| `AssemblyProcedureDocument` | `status` (default `DRAFT`), `publishedAt`; `pages[]`; index `(status, isActive)` |
| `AssemblyProcedureDocumentPage` | `documentId`, `pageIndex`, `imageRelativePath`; unique `(documentId, pageIndex)` |
| `AssemblyTemplateBolt` | Optional `kioskDocumentId`, `assemblyProcedureDocumentId`, `pageIndex` (all null = legacy) |
| `AssemblyTemplateCheckItem` | Template-scoped check markers with page ref + coordinates |
| `AssemblyCheckRecord` | Per-session toggle state; unique `(sessionId, checkItemId)` |

Data migration SQL (in migration):

- All existing `AssemblyProcedureDocument` rows → `status=PUBLISHED`, `publishedAt=COALESCE(updatedAt, createdAt, now())`.
- Insert `AssemblyProcedureDocumentPage` row per document at `pageIndex=0` using existing `imageRelativePath`.

### Schema notes for implementers

- `AssemblyProcedureDocument.imageRelativePath` is retained as the **first-page mirror** for backward-compatible API fields and protected-image URLs.
- Check item coordinates use `Float` (`xRatio`, `yRatio`); bolt coordinates remain `Decimal(10,8)` (unchanged).
- `AssemblyTemplateCheckItem` adds `@@unique([templateId, markerNo])` in addition to sort-order uniqueness (matches bolt area pattern).
- Page reference validation (exactly one doc ref or none) is enforced in **service layer**, not DB CHECK constraints (same as `AssemblyProcedureOrderItem`).

## Phase 2 — API contracts (DTO level)

Implement on branch after Phase 1 merge. All routes stay under existing `/api/assembly/*` prefix and reuse `allowView` / `allowWriteKiosk` preHandlers unless noted.

### Shared types

```ts
type AssemblyProcedureDocumentStatusDto = 'draft' | 'published';

type AssemblyMarkerPageRefDto = {
  kioskDocumentId?: string | null;
  assemblyProcedureDocumentId?: string | null;
  pageIndex?: number; // default 0 when a doc id is set; omit/null doc ids = legacy bolt behavior
};

type AssemblyProcedureDocumentPageDto = {
  pageIndex: number;
  imageRelativePath: string;
};

type AssemblyProcedureDocumentDto = {
  id: string;
  name: string;
  imageRelativePath: string; // page 0 mirror
  status: AssemblyProcedureDocumentStatusDto;
  publishedAt: string | null;
  isActive: boolean;
  pages: AssemblyProcedureDocumentPageDto[];
  createdAt: string;
  updatedAt: string;
};

type AssemblyTemplateCheckItemDto = {
  id: string;
  markerNo: number;
  label: string | null;
  required: boolean;
  xRatio: number;
  yRatio: number;
  sortOrder: number;
  kioskDocumentId: string | null;
  assemblyProcedureDocumentId: string | null;
  pageIndex: number;
};

type AssemblyCheckRecordDto = {
  checkItemId: string;
  checked: boolean;
  checkedByOperatorName: string | null;
  checkedAt: string | null;
};

type AssemblyCheckSummaryDto = {
  requiredTotal: number;
  requiredCompleted: number;
  allRequiredCompleted: boolean;
};

type AssemblyProcedureSequencePageDto = {
  source: 'kiosk_document' | 'assembly_procedure_document';
  documentId: string;
  pageIndex: number;
  pageUrl: string;
};
```

### Procedure documents

#### `POST /assembly/procedure-documents`

- **Auth**: `allowWriteKiosk`
- **Request**: multipart — `file` (PDF or image), optional `name`
- **Behavior**: import all pages (max **40**); create document with `status=draft`, `publishedAt=null`; create `pages[]` with contiguous `pageIndex` 0..n-1; set `imageRelativePath` to page 0 path.
- **Response** `201`:

```json
{
  "document": { "...AssemblyProcedureDocumentDto with pages[]..." }
}
```

- **Errors**: `400` unsupported type / empty file / page count > 40.

#### `GET /assembly/procedure-documents` and `GET /assembly/procedure-documents/:id`

- Extend serializers to include `status`, `publishedAt`, `pages[]` (ordered by `pageIndex`).

#### `POST /assembly/procedure-documents/:id/publish`

- **Auth**: `allowWriteKiosk`
- **Behavior**: set `status=PUBLISHED`, `publishedAt=now()` (idempotent if already published — refresh `publishedAt` optional; prefer no-op except first publish).
- **Response** `200`: `{ "document": AssemblyProcedureDocumentDto }`
- **Errors**: `404` not found.

#### `POST /assembly/procedure-documents/:id/unpublish`

- **Auth**: `allowWriteKiosk`
- **Behavior**: set `status=DRAFT`, `publishedAt=null`
- **Response** `200`: `{ "document": AssemblyProcedureDocumentDto }`
- **Errors**:
  - `404` not found
  - `409` if referenced by any `AssemblyProcedureOrderItem`, any `AssemblyTemplate.procedureDocumentId`, any bolt/check page ref pointing at this document, or any active template using it as primary procedure document. Message should distinguish "in use" vs generic conflict.

#### `DELETE /assembly/procedure-documents/:id`

- Extend guards: also block when referenced by bolt/check page refs (not only order + template primary doc).

### Procedure viewing order

#### `PUT /assembly/procedure-orders` (existing save endpoint)

- When `assemblyProcedureDocumentId` is set on an item, verify target document `status=PUBLISHED` and `isActive=true`; else `400` with clear message.
- Legacy `kioskDocumentId` items unchanged.

### Templates

#### `POST /assembly/templates` and `POST /assembly/templates/:id/revise`

- **Extend request body**:

```ts
{
  // existing fields...
  areas: [{
    // existing area fields...
    bolts: [{
      // existing bolt fields...
      kioskDocumentId?: string | null;
      assemblyProcedureDocumentId?: string | null;
      pageIndex?: number | null;
    }]
  }];
  checkItems?: [{
    markerNo: number;
    label?: string | null;
    required?: boolean; // default true
    xRatio: number;
    yRatio: number;
    sortOrder: number;
    kioskDocumentId?: string | null;
    assemblyProcedureDocumentId?: string | null;
    pageIndex?: number; // default 0
  }];
}
```

- **Validation**:
  - `procedureDocumentId` must reference a `PUBLISHED` active document.
  - Each bolt/check page ref: exactly one of `kioskDocumentId` or `assemblyProcedureDocumentId`, or both omitted (bolts only — legacy). When set, referenced assembly doc must be `PUBLISHED`; kiosk doc must be `enabled`.
  - `pageIndex` within document page count (assembly: `pages.length`; kiosk: `pageCount` or rendered page list).
  - `checkItems`: unique `markerNo` and `sortOrder` per template; at least zero items allowed.
- **`revise`**: copy `checkItems` from source template revision when `checkItems` omitted (same as areas default copy behavior).

#### `GET /assembly/templates/:id`

- Add top-level `checkItems: AssemblyTemplateCheckItemDto[]` ordered by `sortOrder`.
- Include page ref fields on each `areas[].bolts[]` entry.

### Work sessions

#### `GET /assembly/work-sessions/:id`

- Add:
  - `checkItems`: template check item definitions **plus** runtime state `{ ...item, record: AssemblyCheckRecordDto | null }`
  - `checkSummary: AssemblyCheckSummaryDto` computed from template `required` flags and records

#### `POST /assembly/work-sessions/:id/record-check`

- **Auth**: same as `record-torque` (`allowWriteKiosk`; kiosk client key or JWT)
- **Request**:

```json
{ "checkItemId": "uuid", "checked": true }
```

- **Behavior**: upsert `AssemblyCheckRecord` for `(sessionId, checkItemId)`; set `checkedByOperatorName` from session operator snapshot; `checkedAt=now()`.
- **Response** `200`:

```json
{
  "record": AssemblyCheckRecordDto,
  "checkSummary": AssemblyCheckSummaryDto
}
```

- **Errors**: `404` session/item; `409` if session not `IN_PROGRESS`.

#### `POST /assembly/work-sessions/:id/complete`

- **Existing**: all bolts must have accepted OK torque record.
- **Add**: `checkSummary.allRequiredCompleted` must be true; else `409` with `{ message, checkSummary }`.
- Approval flow unchanged (complete first, approve later).

#### `GET /assembly/work-sessions/:id/procedure-sequence`

- Replace flat `pageUrls: string[]` per document with explicit page list including identifiers.
- **Response shape** (extend each configured document entry):

```ts
{
  // existing metadata fields...
  pages: AssemblyProcedureSequencePageDto[];
}
```

- **Rules**:
  - Assembly procedure documents: expand **all** `AssemblyProcedureDocumentPage` rows in `pageIndex` order; skip entire document if `status=DRAFT`.
  - Kiosk PDF documents: one entry per rendered page URL with `source='kiosk_document'`.
  - Fallback mode (no configured order): still expose template primary procedure document pages (published only); if draft/unavailable, behave as today with empty/blocked sequence per product decision (prefer omit + fallback reason).
  - Marker overlay resolution uses `(source, documentId, pageIndex)` — Phase 3 consumes this.

### Record approval (review screen)

Extend work-session detail used by `/kiosk/assembly/record-approvals` (same `GET /assembly/work-sessions/:id` payload or summary variant):

- Add `checkSummary` and per-item check outcomes (same structure as work session detail).
- Area torque summaries unchanged.

## Phase 3 — Web UI direction

### Library (`/kiosk/assembly/library` procedure pane)

- Show `DRAFT` / `PUBLISHED` badge on each procedure document.
- Actions: **公開** / **公開取り消し** (calls publish/unpublish APIs); disable unpublish when API returns 409 and surface reason.
- Import preview lists all pages after multi-page upload.

### Template editor

- Page picker tied to union of:
  - Template primary procedure document pages (published)
  - Any published assembly docs + enabled kiosk PDFs available in sequence context (minimum: primary doc + docs referenced by order settings for the model if loaded)
- Two marker modes on selected page:
  - **Bolt** (existing editor, existing color rules)
  - **Check** (new marker type, distinct color)
- Save sends `checkItems[]` and bolt page refs in template create/revise payloads.

### Work session (`AssemblyProcedureSequenceViewer`)

- Render markers for current `pages[]` entry matching `(source, documentId, pageIndex)`.
- Bolt markers: existing torque colors/state.
- Check markers: distinct color; tap toggles via `record-check`.
- Complete button disabled until API reports `checkSummary.allRequiredCompleted` (and existing bolt completion).
- Show compact check progress (e.g. `3/5 必須チェック`).

### Record approval page

- Display check aggregate alongside area torque summaries; list unchecked required items on completed-but-not-approved sessions if any data inconsistency (should not happen post-complete gate).

## Phase 4 — Validation plan

| Area | Checks |
|---|---|
| Migration | Fresh DB `prisma migrate deploy` applies `20260708101417`; existing docs `PUBLISHED` + page row count = document count; new import defaults `DRAFT`. |
| Compatibility | Legacy templates/sessions without page refs and without check items behave as before; completion only requires bolts. |
| API integration | Extend `assembly.integration.test.ts`: publish/unpublish guards, multi-page import cap, order save rejects draft doc, complete rejects missing checks, record-check upsert, sequence page identifiers exclude draft docs. |
| Web smoke | Library publish badge, template dual markers, work-session toggle + complete guard, record approval check summary. |
| Deploy | Follow `docs/guides/deployment.md`; Pi5 + Pi4 kiosks; Phase12 script. |

### Production deploy (2026-07-08, main `9fc67e3e`)

- **Deploy**: pre-deploy DB backup OK (Dropbox env/csv partial 409) · `update-all-clients.sh main` Run ID **`20260708-203404-17566`** · PLAY RECAP 7/7 `failed=0` · Pi5 HEAD **`9fc67e3e`** · migration **`20260708101417_assembly_unified_workflow_p1_schema`** applied (136/136 up to date).
- **Smoke (read-only)**: `verify-phase12-real.sh` PASS 45/0/0 · `GET /api/assembly/procedure-documents` 1 doc `status=published` + `pages[0].pageIndex=0` · templates/summary HTTP 200 · work-sessions/summary HTTP 200 · `/kiosk/assembly` HTTP 200.

### Validation results (2026-07-08, branch `feature/assembly-uwf-p4-validation`)

| Check | Command | Result |
|---|---|---|
| Migration (fresh DB) | `DATABASE_URL=…55999/borrow_return prisma migrate deploy` on temp `pgvector/pgvector:pg15` | pass — all 136 migrations including `20260708101417_assembly_unified_workflow_p1_schema` |
| API integration | `pnpm test` (apps/api, temp Postgres) | pass — 2193 tests; `assembly.integration.test.ts` 18/18 (3 test fixes: publish header, cleanup order, sortOrder seed) |
| API typecheck | `pnpm --filter @raspi-system/api exec tsc -p tsconfig.build.json --noEmit` | pass |
| Web typecheck | `pnpm --filter @raspi-system/web exec tsc --noEmit` | pass |
| Web build | `pnpm --filter @raspi-system/web build` | pass |
| Lint | `pnpm --filter @raspi-system/api lint` + web lint | pass |
| Web unit (assembly) | vitest: `AssemblyProcedureSequenceViewer`, `KioskAssemblyWorkSessionPage`, `KioskAssemblyRecordApprovalPage` | pass — 7/7 |
| API⇔Web contract | static review `assembly/index.ts` serializers vs `types.ts` / `domains/assembly.ts` | pass — no mismatches found |
| Legacy compat | integration tests (bolt-only complete, no page refs) | pass |

## Key files (Phase 1)

- [Prisma schema](../../apps/api/prisma/schema.prisma) — assembly models ~L2289+
- [Migration](../../apps/api/prisma/migrations/20260708101417_assembly_unified_workflow_p1_schema/migration.sql)
- [ADR](../decisions/ADR-20260708-assembly-page-level-markers-and-publish-gate.md)

## Resume checklist (Phase 2 AI)

1. Read this file, ADR-20260708, and `kiosk-assembly-torque-management-mvp.md` for baseline behavior.
2. Do not re-open Phase 1 schema unless a contract gap is found; update this Plan first.
3. Implement API sections in order: procedure publish → multi-page import → template/check CRUD → session record-check → sequence page ids → complete gate.
4. Test with temporary `pgvector/pgvector:pg16` container only; remove container/volume after tests.
5. Keep assembly domain isolated from part-measurement/self-inspection models.
