---
title: Kiosk Assembly Home Table Layout
id: plan-kiosk-assembly-home-table-layout
status: active
scope: kiosk assembly home left panes (`/kiosk/assembly`) — registered lots, WIP, completed
date: 2026-07-09
source_of_truth: this file
related_code: apps/web/src/features/assembly/AssemblyLotPane.tsx, apps/web/src/features/assembly/AssemblyWipPane.tsx, apps/web/src/features/assembly/AssemblyCompletedPane.tsx, apps/web/src/features/assembly/AssemblyPaneTableShell.tsx, apps/web/src/features/assembly/assemblyStatusPresentation.ts, apps/web/src/features/assembly/assemblySessionPresentation.ts, apps/web/src/pages/kiosk/KioskAssemblyHomePage.tsx
related_docs: ../decisions/ADR-20260707-assembly-kiosk-record-approval-and-ui-consistency.md, ../design-previews/kiosk-assembly-home-table-layout-preview.html, ../design-previews/README.md, ../INDEX.md
validation: web focused vitest 6 files / 21 tests; web lint; web build; assembly integration 23 tests on temp pgvector/pg15:55436 (disposed)
open_items: on-site visual/touch verification on Pi kiosk; deploy when requested
---

# Kiosk Assembly Home Table Layout

## Purpose

Raise information density on the assembly home left column by replacing card grids with inspection-drawing-style compact tables, without changing API/DB contracts or the right-side lot registration pane.

## Decision Summary

- Branch: `feat/kiosk-assembly-home-table-layout`
- Presentation helpers live in `features/assembly/` only (no cross-feature table kit)
- Lot pane: group row + serial rows
- WIP pane: primary + secondary rows; keep thin progress bar
- Completed pane: primary + secondary rows; keep approval badges and lot qty lookup
- Touch targets: `min-h-11`
- ADR: Decision 6 on `ADR-20260707`

## Implementation Checklist

- [x] Create feature branch from main
- [x] Extract status/session presentation helpers + unit tests
- [x] Add `AssemblyPaneTableShell`
- [x] Convert Lot / WIP / Completed panes
- [x] Update pane + home vitest
- [x] web lint + build
- [x] Temp Postgres assembly integration regression + cleanup
- [x] ADR Decision 6 + this Plan + preview README note + INDEX one-liner

## Validation Commands

```bash
pnpm --filter @raspi-system/web exec vitest run \
  src/features/assembly/AssemblyCompletedPane.test.tsx \
  src/pages/kiosk/KioskAssemblyHomePage.test.tsx \
  src/features/assembly/assemblyStatusPresentation.test.ts \
  src/features/assembly/assemblySessionPresentation.test.ts \
  src/features/assembly/AssemblyLotPane.test.tsx \
  src/features/assembly/AssemblyWipPane.test.tsx
pnpm --filter @raspi-system/web lint
pnpm --filter @raspi-system/web build
```

Temp DB (disposed after run): `pgvector/pgvector:pg15` on `55436`, `prisma migrate deploy`, then `assembly.integration.test.ts` + `assembly-seiban.integration.test.ts`.

## Local Notes JA

- 右ペイン（ロット登録）は変更しない。
- 見た目合意の静的プレビュー: `docs/design-previews/kiosk-assembly-home-table-layout-preview.html`
