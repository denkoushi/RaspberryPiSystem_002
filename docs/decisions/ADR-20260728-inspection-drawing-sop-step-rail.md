---
id: ADR-20260728-inspection-drawing-sop-step-rail
title: Step-rail list + on-screen badges for inspection-drawing dimension SOP
status: accepted
date: 2026-07-28
source_of_truth: true
supersedes:
  - ../decisions/ADR-20260728-inspection-drawing-sop-outer-callouts.md
related_docs:
  - ../plans/kiosk-inspection-drawing-edit-existing-sop.md
  - ../plans/kiosk-sop-visual-layout-correction-execplan.md
  - ../design-previews/kiosk-inspection-drawing-edit-existing-sop.html
  - ../plans/kiosk-inspection-drawing-dimension-tolerance-sop-1page.md
  - ../design-previews/kiosk-inspection-drawing-dimension-tolerance-sop-1page.html
---

# ADR-20260728: Step-rail SOP (badges on target corners)

## Context

A4 landscape SOP for **検査図面 寸法・公差**. Always-on outer callouts + leaders do not scale (spider web at ~30–50 steps). Hand PNGs added noise. Badges centered on controls covered labels.

## Decision

> 2026-08-01: ステップレールの表示判断は継続する。凍結HTMLを再現元とする判断だけは [ADR-20260801](./ADR-20260801-kiosk-sop-generated-from-production-ui.md) により、本番Reactルートからの決定的生成へ置き換えられた。

- Left **step rail**: numbered instructional list (scrollable for growth)
- On screen: **step badges only**, anchored to each target’s **bottom-right corner**
- The bottom-right anchor is measured from the target DOM rectangle in the sheet's
  prepared production UI state. Missing targets and hand-authored coordinate fallbacks
  are generation errors.
- Leaders **hover/focus only** (one at a time); omitted in print
- Touch/click and keyboard focus select one card until another card is selected. Mouse
  hover temporarily previews a card and returns to the persistent selection on leave.
- The selected leader is measured from the card's right-center to the target badge
  boundary after layout; fixed or estimated endpoints are not permitted.
- No hand illustrations
- **One target kiosk screen → one A4 landscape sheet** (do not composite multiple screens onto one page)
- Runtime popup presentation fills the available iframe while retaining a 330-pixel
  instruction rail. The deterministic and print artifact remains 1280×720.

## Alternatives

- Outer-gutter pills + always-on non-crossing leaders — superseded (fails at high step counts)
- Hand PNG pointing at controls — rejected (overlap, noise)
- Badge at fingertip contact (50% / 68%) — rejected (still covers control face)
- Badge far outside controls — rejected (too detached)

## Consequences

- Scales better: more steps → longer/scrolling rail, not more permanent leaders
- 構造化定義、実画面PNG、生成manifestが再現元となる
- Print remains list + badges without interactive leaders
- Responsive containment must place badges against the rendered image rectangle, not
  against any letterbox area around it.

## Validation

- Chromium / Firefox: badges on the DOM-measured bottom-right of 丸数字 / marker / 基準値 / 公差 / 保存
- Hover shows one leader; leave clears
- Print preview: one A4 landscape page, no leaders

## References

- Plan: [kiosk-inspection-drawing-dimension-tolerance-sop-1page.md](../plans/kiosk-inspection-drawing-dimension-tolerance-sop-1page.md)
- Preview: [kiosk-inspection-drawing-dimension-tolerance-sop-1page.html](../design-previews/kiosk-inspection-drawing-dimension-tolerance-sop-1page.html)
- Supersedes: [ADR-20260728-inspection-drawing-sop-outer-callouts.md](./ADR-20260728-inspection-drawing-sop-outer-callouts.md)
