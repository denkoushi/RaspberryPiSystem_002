# ADR-20260214: Signage/Visualization SVG Design System as Material Design 3 (Dark)

Status: accepted

## Context

- The project renders multiple signage/visualization contents as server-side SVG and converts them to JPEG (`sharp`).
- Historically, each renderer defined its own colors/typography constants, which led to:
  - inconsistent look and feel across contents,
  - duplicated style values scattered across files,
  - higher cost/risk when adjusting visibility (contrast, font sizes, spacing).
- There is an existing visibility/theme requirement document for factory use:
  - `docs/requirements/ui-visibility-color-theme.md`
  - This primarily targets web UI (Tailwind classes) and signage card palettes, but it does not provide a single token source for SVG renderers.

## Decision

Adopt a Material Design 3 inspired (dark) token set as the common design system for server-side SVG renderers, and migrate renderers to reference tokens instead of hardcoded values.

Scope for this decision:
- Apply to visualization renderers under `apps/api/src/services/visualization/renderers/*`
- Apply to CSV dashboard template renderer `apps/api/src/services/csv-dashboard/csv-dashboard-template-renderer.ts`

Out of scope (for now):
- `apps/api/src/services/signage/signage.renderer.ts` (tool cards and signage-specific layouts)

## Implementation

- Token module:
  - `apps/api/src/services/visualization/renderers/_design-system/md3.ts`
  - Exposes `createMd3Tokens({ width, height })` and returns token values for:
    - `colors` (surface/text/status/table/card)
    - `typography` (title/header/body/label)
    - `spacing` (8px-based, scaled)
    - `shape` (corner radii, scaled)
- Migration plan and per-renderer checklist:
  - `docs/plans/signage-md3-design-system-migration.md`

## Alternatives Considered

1. Keep status quo (renderer-local constants)
   - Pros: no immediate change risk
   - Cons: inconsistent visuals persist; changes remain expensive and error-prone

2. Dual-theme approach (factory palette + MD3)
   - Pros: easy A/B and safer rollout
   - Cons: increases long-term maintenance; requires theme selection plumbing per renderer

3. Use existing UI visibility palette for SVG too
   - Pros: consistency with Tailwind-based web UI theme doc
   - Cons: SVG renderers are not CSS/Tailwind-driven; still needs a token module; direct reuse is not straightforward

## Consequences

Positive:
- One place to adjust signage/visualization SVG visuals.
- Renderers stay loosely coupled: layout logic remains in each renderer; only values are shared.
- Easier to enforce contrast and typography consistency across contents.

Negative / Risks:
- Visual changes can affect operators' familiarity; must be rolled out carefully.
- Some tests may have implicit coupling to old color literals (especially SVG template tests).

Mitigations:
- Migrate renderer by renderer with small diffs.
- Prefer tests that assert structure/behavior rather than exact color literals.

## References

- `docs/requirements/ui-visibility-color-theme.md`
- `docs/modules/signage/README.md`
- `docs/plans/signage-md3-design-system-migration.md`

