---
id: ADR-20260728-inspection-drawing-sop-outer-callouts
title: Outer-gutter numbered callouts for inspection-drawing dimension SOP
status: superseded
date: 2026-07-28
source_of_truth: false
superseded_by:
  - ../decisions/ADR-20260728-inspection-drawing-sop-step-rail.md
related_docs:
  - ../plans/kiosk-inspection-drawing-dimension-tolerance-sop-1page.md
  - ../design-previews/kiosk-inspection-drawing-dimension-tolerance-sop-1page.html
---

# ADR-20260728: Outer-gutter numbered callouts (superseded)

## Status

**Superseded** by [ADR-20260728-inspection-drawing-sop-step-rail.md](./ADR-20260728-inspection-drawing-sop-step-rail.md).

Kept as history: always-on outer callouts + leaders do not scale past a handful of steps.

## Original Decision (summary)

- Park callouts in outer gutters; non-crossing always-on leaders
- No hand art; CSS true-circle tips

## Why superseded

- Permanent leaders become a spider web as step count grows (30–50)
- Step-rail + on-screen corner badges + hover-only leaders chosen instead

## References

- Current ADR: [ADR-20260728-inspection-drawing-sop-step-rail.md](./ADR-20260728-inspection-drawing-sop-step-rail.md)
- Plan: [kiosk-inspection-drawing-dimension-tolerance-sop-1page.md](../plans/kiosk-inspection-drawing-dimension-tolerance-sop-1page.md)
