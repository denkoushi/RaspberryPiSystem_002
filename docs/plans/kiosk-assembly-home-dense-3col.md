---
title: Kiosk Assembly Home Dense 3-Column Layout
id: plan-kiosk-assembly-home-dense-3col
status: active
scope: kiosk assembly home left panes (`/kiosk/assembly`) — density follow-up after table layout
date: 2026-07-09
source_of_truth: this file
related_code: apps/web/src/features/assembly/AssemblyLotPane.tsx, apps/web/src/features/assembly/AssemblyWipPane.tsx, apps/web/src/features/assembly/AssemblyCompletedPane.tsx, apps/web/src/features/assembly/AssemblyPaneTableShell.tsx, apps/web/src/features/assembly/AssemblyRowToggle.tsx, apps/web/src/features/assembly/assemblyRowExpansion.ts, apps/web/src/pages/kiosk/KioskAssemblyHomePage.tsx
related_docs: ../decisions/ADR-20260707-assembly-kiosk-record-approval-and-ui-consistency.md, ../plans/kiosk-assembly-home-table-layout.md, ../design-previews/kiosk-assembly-home-table-dense-3col-preview.html, ../design-previews/README.md, ../INDEX.md
validation: web focused vitest 5 files / 18 tests; web lint; web build; assembly integration 23 tests on temp pgvector/pg15:55437 (disposed)
open_items: commit / push / PR; on-site visual/touch verification; deploy when requested
---

# Kiosk Assembly Home Dense 3-Column Layout

## Purpose

Follow-up to the Decision 6 table layout: raise scan density further with a horizontal 3-column left grid, ~0.75× row body height, and default-collapsed detail rows — without changing API/DB/DTO or the right-side start pane.

## Decision Summary

- Branch: `feat/kiosk-assembly-home-dense-3col` (from table-layout tip while PR #961 unmerged)
- Left wrapper: `grid … xl:grid-cols-3`
- Row body ~0.75×; **actions keep `min-h-11`**
- Collapse default closed:
  - Lot: group heading always; serials on expand
  - WIP / Completed: primary always; secondary on expand (option A)
- Expansion: `useAssemblyRowExpansion` + `AssemblyRowToggle` (no localStorage)
- ADR: Decision 7 on `ADR-20260707`

## Implementation Checklist

- [x] Create feature branch
- [x] Update dense preview (WIP/completed option A + min-h-11 note) + README
- [x] `assemblyRowExpansion` + `AssemblyRowToggle` + unit test
- [x] Parent 3-column layout
- [x] Lot / WIP / Completed collapse + dense cell classes
- [x] Pane + Home vitest
- [x] web lint + build
- [x] Temp Postgres assembly integration regression + cleanup
- [x] ADR Decision 7 + this Plan + INDEX one-liner
- [ ] Commit / push / PR
- [ ] Deploy / on-site visual/touch

## Validation Commands

```bash
pnpm --filter @raspi-system/web exec vitest run \
  src/features/assembly/AssemblyLotPane.test.tsx \
  src/features/assembly/AssemblyWipPane.test.tsx \
  src/features/assembly/AssemblyCompletedPane.test.tsx \
  src/features/assembly/assemblyRowExpansion.test.ts \
  src/pages/kiosk/KioskAssemblyHomePage.test.tsx
pnpm --filter @raspi-system/web lint
pnpm --filter @raspi-system/web build
```

Temp DB (disposed after run): `pgvector/pgvector:pg15` on `55437`, `prisma migrate deploy`, then `assembly.integration.test.ts` + `assembly-seiban.integration.test.ts` (23 passed).

## Local Notes JA

- 右ペイン（ロット登録）は変更しない。
- 見た目合意の静的プレビュー: `docs/design-previews/kiosk-assembly-home-table-dense-3col-preview.html`
- 先行の表レイアウト正本: `docs/plans/kiosk-assembly-home-table-layout.md`
