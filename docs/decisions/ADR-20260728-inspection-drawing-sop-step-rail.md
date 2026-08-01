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
- Leaders **hover/focus only** (one at a time); omitted in print
- No hand illustrations
- **One target kiosk screen → one A4 landscape sheet** (do not composite multiple screens onto one page)

## Alternatives

- Outer-gutter pills + always-on non-crossing leaders — superseded (fails at high step counts)
- Hand PNG pointing at controls — rejected (overlap, noise)
- Badge at fingertip contact (50% / 68%) — rejected (still covers control face)
- Badge far outside controls — rejected (too detached)

## Consequences

- Scales better: more steps → longer/scrolling rail, not more permanent leaders
- 構造化定義、実画面PNG、生成manifestが再現元となる
- Print remains list + badges without interactive leaders

## Validation

- Safari: badges on bottom-right of 丸数字 / marker / 基準値 / 公差 / 保存
- Hover shows one leader; leave clears
- Print preview: one A4 landscape page, no leaders

## References

- Plan: [kiosk-inspection-drawing-dimension-tolerance-sop-1page.md](../plans/kiosk-inspection-drawing-dimension-tolerance-sop-1page.md)
- Preview: [kiosk-inspection-drawing-dimension-tolerance-sop-1page.html](../design-previews/kiosk-inspection-drawing-dimension-tolerance-sop-1page.html)
- Supersedes: [ADR-20260728-inspection-drawing-sop-outer-callouts.md](./ADR-20260728-inspection-drawing-sop-outer-callouts.md)
