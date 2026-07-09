# ADR-20260709: Assembly Work Session Operator Layout

- Status: accepted
- Date: 2026-07-09
- Scope: kiosk assembly work session (`/kiosk/assembly/work-sessions/:sessionId`)
- related_code:
  - `apps/web/src/pages/kiosk/KioskAssemblyWorkSessionPage.tsx`
  - `apps/web/src/features/assembly/AssemblyWorkSessionHeader.tsx`
- related_docs:
  - `docs/design-previews/kiosk-assembly-work-session-operator-layout-preview.html`
  - `docs/plans/kiosk-assembly-torque-management-mvp.md`
  - `docs/decisions/ADR-20260707-assembly-kiosk-record-approval-and-ui-consistency.md`

## Context

The work-session page is used by operators after seiban/serial registration. Vertical space for the procedure document was reduced by:

1. A tall page header (title + product meta + three actions)
2. A second left-pane heading band (要領書/手順書 + current bolt + required checks)
3. Admin affordances on the operator surface: **テンプレ** (template edit) and **Excel** (session export)

MVP historically kept Excel export on this page as a quality-record download. Template edit belongs on the library/management path (`/kiosk/assembly/library`).

## Decision

1. **Title**: `組立締付作業` → `組立作業`.
2. **Single-row operator header** (`AssemblyWorkSessionHeader`): title + product meta | procedure mode + current position + required check summary | **組立トップ** only. No wrap into multiple rows on typical kiosk widths; truncate long meta.
3. **Remove left-pane heading band** so the procedure viewer/canvas owns the vertical space under the header.
4. **Remove テンプレ and Excel buttons** from the work-session UI. Template editing remains reachable from the assembly library. Excel API (`GET /assembly/work-sessions/:id/export.xlsx`) and `downloadAssemblyWorkSessionXlsx` remain; no alternate UI affordance in this change.
5. Right pane (締付 controls), `AssemblyProcedureSequenceViewer` internal toolbar, routes, and KioskLayout immersive policy are unchanged.
6. **Contain-fit follow-up (2026-07-09)**: the procedure image (configured sequence and single-image fallback) scales to the **largest size that fits the parent pane while preserving aspect ratio** (`computeContainSize` + `ResizeObserver`). Still **one page at a time** — no dual-page / spread layout. Removes the previous `max-h-[calc(100dvh-15rem)]` viewport-based cap on the fallback canvas.

## Alternatives

- Move Excel to record-approvals in the same change: deferred; expands scope beyond operator layout.
- Delete the Excel API: rejected; destructive and out of scope.
- Also collapse the sequence viewer internal page-nav toolbar: deferred; separate UX decision.

## Consequences

- Operators lose in-session Excel download and template-edit shortcuts; management/export can be restored later on a non-operator surface if needed.
- Procedure area gains the height previously used by the dual chrome bands.
- Narrow viewports rely on truncate/nowrap rather than wrapping into three header rows (same class of risk as KB-399 compact headers).

## Validation

- `npx vitest run src/pages/kiosk/KioskAssemblyWorkSessionPage.test.tsx` (3 passed): title `組立作業`, 組立トップ present, テンプレ/Excel absent, configured sequence page nav and fallback canvas still work.
- Contain-fit: `computeContainSize.test.ts` + sequence viewer / work-session tests passed; image uses parent-box contain math (not `100dvh-15rem`).
- Design preview: `docs/design-previews/kiosk-assembly-work-session-operator-layout-preview.html`

## Local Notes JA

- 依頼根拠: オペレータ作業画面の手順書縦スペース確保。Excel は方針 A（UI 削除・API 維持・代替導線なし）。
