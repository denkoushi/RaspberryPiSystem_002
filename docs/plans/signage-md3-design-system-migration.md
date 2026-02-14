# ExecPlan: Signage/Visualization MD3 Design System Migration

Status: in_progress

## Goal

Unify server-side SVG renderer visuals (colors/typography/spacing/shape) by introducing a Material Design 3 (dark) token module and migrating renderers to reference it.

Scope (phase 1 target):
- Visualization renderers: `apps/api/src/services/visualization/renderers/*`
- CSV dashboard template renderer: `apps/api/src/services/csv-dashboard/csv-dashboard-template-renderer.ts`

Out of scope (for now):
- Tool card signage renderer: `apps/api/src/services/signage/signage.renderer.ts`

## Design Principles

- Token-only module: the design system provides values only (no layout logic).
- Loose coupling: renderers remain responsible for layout; they only read tokens.
- Backward compatibility: keep `RenderConfig.colors` as override escape hatch where it already exists.
- Small diffs: migrate renderer by renderer; avoid broad refactors.

## Token Module

Files:
- `apps/api/src/services/visualization/renderers/_design-system/md3.ts`
- `apps/api/src/services/visualization/renderers/_design-system/index.ts`

API:
- `createMd3Tokens({ width, height })`

## Migration Checklist (per renderer)

### 1) TableRenderer

File: `apps/api/src/services/visualization/renderers/table/table-renderer.ts`

Replace:
- `BACKGROUND`, `TEXT_COLOR`, `GRID_COLOR`
- zebra row fills `#0f172a` / `#111827`
- header fill `GRID_COLOR`

Verify:
- Renders with 0 columns (error svg) unchanged behavior
- Column width normalization unchanged

### 2) KpiCardsRenderer

File: `apps/api/src/services/visualization/renderers/kpi-cards/kpi-cards-renderer.ts`

Replace:
- `BACKGROUND`, `TEXT_COLOR`
- default `good/bad/neutral` colors (when `config.colors` not provided)

Keep:
- `config.colors` override behavior

Verify:
- Visual contrast of accent borders
- Still renders JPEG for valid KPI data

### 3) ProgressListRenderer

File: `apps/api/src/services/visualization/renderers/progress-list/progress-list-renderer.ts`

Replace:
- `BACKGROUND`, `TEXT_COLOR`, `SUB_TEXT_COLOR`, `BORDER_COLOR`
- `CARD_BG`, bar bg, and status colors

Verify:
- Percentage color mapping remains consistent with previous semantics
- Text truncation still works (uses `_text/text-fit.ts`)

### 4) BarChartRenderer

File: `apps/api/src/services/visualization/renderers/bar-chart/bar-chart-renderer.ts`

Replace:
- `BACKGROUND`, `TEXT_COLOR` and grid/axis related colors

Verify:
- Dataset custom colors still respected when provided

### 5) UninspectedMachinesRenderer

File: `apps/api/src/services/visualization/renderers/uninspected-machines/uninspected-machines-renderer.ts`

Replace:
- Base palette: background/text/subtext/grid/card fill/border
- Table base zebra colors
- KPI colors (OK/ALERT)
- Result cell colors:
  - Unused: keep zebra fill
  - Abnormal >= 1: error container
  - Abnormal = 0: info/success container (pick one and keep consistent)

Keep:
- Result cell logic and parsing (only move color values)
- Two-column layout logic and row capacity logic

Verify:
- \"点検結果\" background only applies to that column
- Unused rows remain grouped at end (sorting logic in data source)

## CSV Dashboard Template Migration

File:
- `apps/api/src/services/csv-dashboard/csv-dashboard-template-renderer.ts`

Replace:
- Header rect fill/stroke
- Row zebra fills
- Text color

Tests impacted:
- `apps/api/src/services/csv-dashboard/__tests__/csv-dashboard-template-renderer.test.ts`

Plan:
- Update tests so they do not depend on a specific fill color value.
- Keep width extraction robust by matching header rects by structure (y/height), not color.

## Verification

Automated:
- Run `vitest` for renderer tests
- Ensure CSV dashboard template tests pass after update

Manual:
- Use signage preview in admin console to compare before/after for the affected dashboards
- Real device check on Pi3 after deployment (if/when deployed)

## Rollback Strategy

- Revert per-renderer token refactoring commits in reverse order (CSV template last).
- Keep the token module even if a renderer is rolled back; it is inert without imports.

