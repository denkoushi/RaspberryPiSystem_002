---
title: "ADR-20260709: Inspection drawing depth through mode"
id: ADR-20260709-inspection-drawing-depth-through-mode
status: accepted
date: 2026-07-09
source_of_truth: true
related_code:
  - apps/api/prisma/schema.prisma
  - apps/web/src/features/part-measurement/inspection-drawing/
related_docs:
  - ../plans/kiosk-inspection-drawing-library-ux-and-depth-through.md
  - ../design-previews/kiosk-inspection-drawing-depth-through-mode-preview.html
---

# ADR-20260709: Inspection drawing depth through mode

## Context

Depth labels (`深さ`, `ネジ穴深さ`) may be through-holes (現場語: 通し). Clearing nominal/tolerance fields alone breaks `hasInspectionDrawingTemplate` and `isValueWithinTolerance` (null limits → invalid template / always out of tolerance).

## Decision

- Add explicit `PartMeasurementDepthMode` (`MEASURED` | `THROUGH`) on `PartMeasurementTemplateItem`.
- Through save uses sentinel `lowerLimit=0`, `upperLimit=0`, `nominalValue=null` plus `depthMode=THROUGH` so existing non-null limit checks for drawing templates still pass.
- Evaluation reads `depthMode` first and skips numeric tolerance for `THROUGH` (never treat sentinel 0/0 as a measured band).
- UI shows 測定|通し without a section title; shop-floor label is 通し.
- Do not use free-text `supplementText` as the source of truth for through.

## Alternatives

- Null limits only — rejected (breaks template validity and evaluation).
- Encode through only in `measurementPoint` text — rejected (ambiguous, not machine-safe).

## Consequences

- Non-destructive migration (default MEASURED).
- Print/display must show 通し for through points.
- All evaluation entry points must check `depthMode` before comparing limits.

## Validation

- Unit tests for save/load and display.
- API integration: create/revise through item; measurement save does not treat as out-of-tolerance solely due to sentinel limits.
