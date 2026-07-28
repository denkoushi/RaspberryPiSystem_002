---
id: ADR-20260728-inspection-drawing-sop-outer-callouts
title: Outer-gutter numbered callouts for inspection-drawing dimension SOP
status: accepted
date: 2026-07-28
source_of_truth: true
related_docs:
  - ../plans/kiosk-inspection-drawing-dimension-tolerance-sop-1page.md
  - ../design-previews/kiosk-inspection-drawing-dimension-tolerance-sop-1page.html
---

# ADR-20260728: Outer-gutter numbered callouts (no hand art)

## Context

Need a one-page A4 landscape SOP for **検査図面 寸法・公差** setup. Early drafts put callouts inside the mock screen and/or used hand PNGs. In-screen callouts produced crossing “spider web” leaders; SVG tip circles under `preserveAspectRatio="none"` became ellipses and collided with hand digits.

## Decision

- Inset the kiosk mock inside a page frame; park callouts only in **outer gutters**
- Assign parks so leaders **do not cross** (left: step 2; top: step 6; right stack 1→3→4→5)
- Drop hand illustrations; put **circular step badges on the bubbles**
- Draw leader tips as **HTML/CSS true circles**, not SVG `<circle>` in a stretched layer
- Keep instructional Japanese copy (not bare control labels)

## Alternatives

- Callouts in canvas empty zones + long leaders — rejected (unreadable crossings)
- Hand PNG + dorsum number + SVG tip — rejected (overlap, ellipse distortion, visual noise)
- Multi-page / prose-heavy SOP — rejected (operators do not read)

## Consequences

- Spec + frozen HTML live under `docs/plans/` and `docs/design-previews/`
- Another agent can reproduce from the Plan prompt without chat history
- Print pipeline stays 1280×720 → A4 landscape scale

## Validation

- Visual check in Safari; print preview one landscape page
- Tips remain circular at sheet aspect 1280×720
- Leaders from frozen park table do not cross

## References

- Plan: [kiosk-inspection-drawing-dimension-tolerance-sop-1page.md](../plans/kiosk-inspection-drawing-dimension-tolerance-sop-1page.md)
- Preview HTML: [kiosk-inspection-drawing-dimension-tolerance-sop-1page.html](../design-previews/kiosk-inspection-drawing-dimension-tolerance-sop-1page.html)
