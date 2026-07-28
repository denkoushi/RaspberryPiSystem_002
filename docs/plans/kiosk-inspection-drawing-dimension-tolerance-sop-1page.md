---
id: plan-kiosk-inspection-drawing-dimension-tolerance-sop-1page
title: One-page SOP for inspection-drawing dimension / tolerance setup
status: accepted
date: 2026-07-28
source_of_truth: true
scope: static design preview / operator SOP (print A4 landscape)
related_docs:
  - ../decisions/ADR-20260728-inspection-drawing-sop-step-rail.md
  - ../decisions/ADR-20260728-inspection-drawing-sop-outer-callouts.md
  - ../design-previews/kiosk-inspection-drawing-dimension-tolerance-sop-1page.html
  - ../design-previews/README.md
related_code:
  - apps/web/src/features/part-measurement/inspection-drawing/
---

# Plan: Inspection-drawing dimension / tolerance SOP (1 page)

## Purpose / Big Picture

Ship a **single A4 landscape** operator SOP for kiosk path **自主検査 › 検査図面** → **寸法・公差設定**. Operators barely read prose: the mock UI is primary; a left numbered step list explains taps; on-screen badges mark targets.

**Visual / implementation source of truth (frozen):**
[`docs/design-previews/kiosk-inspection-drawing-dimension-tolerance-sop-1page.html`](../design-previews/kiosk-inspection-drawing-dimension-tolerance-sop-1page.html)

## Progress

- [x] (2026-07-28) Outer-gutter callout draft (later superseded — does not scale past ~8 steps)
- [x] (2026-07-28) Step-rail + on-screen badges accepted
- [x] Frozen HTML preview under `docs/design-previews/`
- [x] ADR for step-rail pattern
- [ ] Optional: print PDF export / shop-floor laminate (ops only)

## Prompt For Another AI (copy-paste)

```text
Read and follow exactly:
  docs/plans/kiosk-inspection-drawing-dimension-tolerance-sop-1page.md
Visual reference (do not invent a new style):
  docs/design-previews/kiosk-inspection-drawing-dimension-tolerance-sop-1page.html
Also read:
  docs/decisions/ADR-20260728-inspection-drawing-sop-step-rail.md

Reproduce a single static HTML SOP (A4 landscape, print/PDF).
Do not add hand illustrations.
Do not use always-on leader lines or outer floating callout bubbles.
Do not invent new step copy.
Match Do/Don't, layout, badge anchor, and tokens below.
No deploy. No app code changes unless explicitly requested.
```

## Do / Don't

### Do

- Grid page: **left step rail** + **kiosk stage** (production-token mock)
- On screen: orange circular **step badges only** (no hand art)
- Badge anchor: **bottom-right corner** of each `data-tap` target (`t.right`, `t.bottom`; CSS `translate(-50%, -50%)`)
- Left rail: numbered list with instructional Japanese copy
- Leaders: **hover/focus only**, one line at a time (list item ↔ badge); print hides leaders
- Print: lock geometry to 1280×720 then scale to A4 landscape; hide `.bar`
- Pattern must remain readable if step count grows (scrollable rail; still no always-on spider-web)

### Don't

- Hand / finger PNGs or click-red overlays
- Always-visible leaders from every callout (spider web; breaks at 30–50 steps)
- Outer floating pill bubbles parked in gutters (superseded draft)
- Badge centered on / covering the control face (use bottom-right corner)
- SVG `<circle>` tips under `preserveAspectRatio="none"` as the only tip style
- Long paragraphs, multi-page prose manuals
- Repeating bare control labels as the only list text

## Step Order And Copy (Japanese, exact)

| # | `data-tap` target | List text (`step-t`) |
|---|-------------------|----------------------|
| 1 | 丸数字 (placement mode) | 配置モードにする |
| 2 | Active marker on drawing | ここに点を打つ |
| 3 | 基準値 input | 図面の寸法を入れる |
| 4 | 上限公差 input | 許される＋側 |
| 5 | 下限公差 input | 許される−側 |
| 6 | 保存 | 入力を確定する |

List item structure:

```html
<li class="step-item" data-step="N" tabindex="0">
  <span class="step-n">N</span>
  <span class="step-t">…</span>
</li>
```

On-screen pin:

```html
<div class="sop-pin" data-pin="N"><span>N</span></div>
```

## Layout Contract

Page (`.sheet`): `1280 / 720` aspect, `display: grid`, columns `minmax(11.5rem, 18%) 1fr`.

| Region | Role |
|--------|------|
| `.step-rail` | Title + scrollable `.step-list` |
| `.stage` | Kiosk UI mock (slate-800) |
| `.sop-overlay` | Absolute full-bleed; pins + optional hover leaders |

Badge placement JS (per target):

```js
const tipX = t.right;
const tipY = t.bottom;
```

Hover interaction:

- `mouseenter` / `focus` on `.step-item` or `.sop-pin` → dim others, highlight pair, show one leader
- `mouseleave` / `blur` → clear
- Print / `beforeprint` → clear hover state; hide `.leader-layer`

## Visual Tokens

| Token | Value |
|-------|-------|
| Accent | `#e85d04` |
| Rail bg | `#e8eef5` |
| List text | `#9a3412` |
| Badge | orange circle, white digit, ~20px, white ring |
| Stage bg | `#1e293b` (`--slate-800`) |
| Leader (hover) | orange stroke ~1.35, one line only |

Production UI references (mock fidelity):

- `inspectionDrawingKioskUi.ts` / `kioskTheme.ts` / `kioskMarkerTheme.ts`
- Create page: aside ~17rem, mode row 丸数字/矢視, nominal + tolerances, save in flat band

## Implementation Notes

- Overlay must not create extra grid cells (`position: absolute; inset: 0` on `.sop-overlay`)
- Leaders: SVG lines only; opacity 0 unless `.is-on`
- `placePins` on load / resize / after print-fit
- Measurement marker digit on the drawing (white “1”) is unrelated to SOP step “2”

## Acceptance

- [x] Left rail shows 6 steps with exact copy
- [x] On-screen badges sit on target **bottom-right** corners
- [x] No always-on leader spider web; hover shows at most one line
- [x] Print / PDF is one A4 landscape page; leaders off; chrome bar hidden
- [x] No hand art

## Local Notes JA

- 現場向け一枚物。文章は読ませない前提。
- 「ボタン名の繰り返し禁止」→ 指示補足の6文言を使う。
- 手イラスト案・外周吹き出し常時引出線案は不採用（確定はステップレール方式）。

## References

- ADR (current): [ADR-20260728-inspection-drawing-sop-step-rail.md](../decisions/ADR-20260728-inspection-drawing-sop-step-rail.md)
- ADR (superseded): [ADR-20260728-inspection-drawing-sop-outer-callouts.md](../decisions/ADR-20260728-inspection-drawing-sop-outer-callouts.md)
- Preview: [kiosk-inspection-drawing-dimension-tolerance-sop-1page.html](../design-previews/kiosk-inspection-drawing-dimension-tolerance-sop-1page.html)
