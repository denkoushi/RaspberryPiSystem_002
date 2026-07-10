---
id: ADR-20260710-inspection-drawing-callout-tip
title: Optional callout tip ratios on inspection drawing markers
status: accepted
date: 2026-07-10
source_of_truth: true
related_docs:
  - ../plans/self-inspection-autosave-callout-template-lock.md
  - ../design-previews/kiosk-inspection-drawing-callout-pointer-preview.html
  - ../knowledge-base/KB-320-kiosk-part-measurement.md
related_code:
  - apps/api/prisma/schema.prisma
  - apps/web/src/features/part-measurement/inspection-drawing/
---

# ADR-20260710: Optional inspection-drawing callout tips

## Context

Circled markers alone are sometimes insufficient to point at a specific hole or screw on a dense drawing. Right-pane space is already tight (17rem).

## Decision

- Add nullable `calloutTipXRatio` / `calloutTipYRatio` on `PartMeasurementTemplateItem`
- Draw callouts on the canvas (SVG line + tip badge with the same marker number)
- Place tips via toolbar「指差し」mode; right pane only shows a one-line status + delete
- Compress density: half-height nudge buttons; name label+select on one row
- Callouts are optional; `templateSupportsInspectionDrawing` does not require tips

## Alternatives

- Right-pane coordinate editors — rejected (crushes point list; KB-399)
- Mandatory callout on every marker — rejected (noise)

## Consequences

- Migration is additive/nullable; existing templates unchanged visually
- Print preview shares tip geometry via `computePrintCalloutLines`

## Validation

- Unit: tip mapper round-trip
- Temp Postgres: migrate + EXPLAIN on tip columns
