---
id: plan-kiosk-inspection-drawing-dimension-tolerance-sop-1page
title: One-page SOP for inspection-drawing dimension / tolerance setup
status: accepted
date: 2026-07-28
source_of_truth: true
scope: static design preview / operator SOP (print A4 landscape)
related_docs:
  - ../decisions/ADR-20260728-inspection-drawing-sop-outer-callouts.md
  - ../design-previews/kiosk-inspection-drawing-dimension-tolerance-sop-1page.html
  - ../design-previews/README.md
related_code:
  - apps/web/src/features/part-measurement/inspection-drawing/
---

# Plan: Inspection-drawing dimension / tolerance SOP (1 page)

## Purpose / Big Picture

Ship a **single A4 landscape** operator SOP for kiosk path **自主検査 › 検査図面** → **寸法・公差設定**. Operators barely read prose: the mock UI is primary; short numbered callouts + non-crossing leader lines guide taps.

**Visual / implementation source of truth (frozen):**
[`docs/design-previews/kiosk-inspection-drawing-dimension-tolerance-sop-1page.html`](../design-previews/kiosk-inspection-drawing-dimension-tolerance-sop-1page.html)

## Progress

- [x] (2026-07-28) Spec accepted with user
- [x] Frozen HTML preview committed under `docs/design-previews/`
- [x] ADR for outer-gutter callouts (no hand art)
- [ ] Optional: print PDF export / shop-floor laminate (ops only; not required for this Plan)

## Prompt For Another AI (copy-paste)

```text
Read and follow exactly:
  docs/plans/kiosk-inspection-drawing-dimension-tolerance-sop-1page.md
Visual reference (do not invent a new style):
  docs/design-previews/kiosk-inspection-drawing-dimension-tolerance-sop-1page.html
Also read:
  docs/decisions/ADR-20260728-inspection-drawing-sop-outer-callouts.md

Reproduce a single static HTML SOP (A4 landscape, print/PDF).
Do not add hand illustrations. Do not place callouts inside the kiosk screen.
Do not invent new step copy. Match Do/Don't, layout %, park coordinates, and tokens below.
No deploy. No app code changes unless explicitly requested.
```

## Do / Don't

### Do

- One composition: page frame + inset kiosk mock + outer callouts
- Rebuild kiosk chrome from production tokens (slate-800 stage, 17rem aside feel, flat band, mode row 丸数字/矢視, 基準値 / 上限公差 / 下限公差, 保存)
- Six steps only, order fixed
- Callouts in **outer gutters** with orange pill + circular badge number
- Leader lines from bubble edge → control contact point; tips are **CSS true circles** (7×7px)
- Print: lock geometry to 1280×720 then scale to A4 landscape (`@page` landscape, hide `.bar`)

### Don't

- Hand / finger PNGs or click-red overlays
- Callouts parked on toolbar/aside buttons or inside the drawing canvas “empty” zones that create spider-web crossings
- SVG `<circle>` tips under `preserveAspectRatio="none"` (they become ellipses)
- Long paragraphs, multi-page flow, industrial document chrome
- Repeating control labels as the only bubble text (use instructional supplements below)

## Step Order And Copy (Japanese, exact)

| # | `data-tap` target | Bubble text (`bubble-text`) |
|---|-------------------|-----------------------------|
| 1 | 丸数字 (placement mode) | 配置モードにする |
| 2 | Active marker on drawing | ここに点を打つ |
| 3 | 基準値 input | 図面の寸法を入れる |
| 4 | 上限公差 input | 許される＋側 |
| 5 | 下限公差 input | 許される−側 |
| 6 | 保存 | 入力を確定する |

Bubble structure:

```html
<div class="tap-bubble" data-bubble="N">
  <span class="bubble-num">N</span>
  <span class="bubble-text">…</span>
</div>
```

## Layout Contract

Page (`.sheet`): `1280 / 720` aspect, background `#dbe3ec`.

Kiosk screen (`.stage`) inset (percent of `.sheet`):

| Edge | Value |
|------|-------|
| left | `10.5%` |
| right | `16.8%` |
| top | `9.2%` |
| bottom | `8.5%` |

Callout park centers (percent of `.sheet`, bubble `transform: translate(-50%,-50%)`):

| id | x% | y% | Gutter |
|----|----|----|--------|
| 1 | 91.6 | 36.5 | right |
| 2 | 5.2 | 47.0 | left |
| 3 | 91.6 | 50.5 | right |
| 4 | 91.6 | 60.5 | right |
| 5 | 91.6 | 70.5 | right |
| 6 | 74.0 | 4.4 | top |

Non-crossing rule: left=2, top=6, right stack top→bottom = 1,3,4,5 (Y order matches aside controls).

Leader contact on target (`data-tap`):

- `aimX` = horizontal center (`0.50` of target box)
- `aimY` = slightly below vertical center (`0.68` of target box)

Leader start: intersect bubble bounding box toward aim (edge × 0.98).

## Visual Tokens

| Token | Value |
|-------|-------|
| Accent / stroke | `#e85d04` |
| Bubble fill | `rgba(255, 248, 240, 0.98)` |
| Bubble text | `#9a3412` |
| Badge | orange circle, white digit, ~`1.35rem` |
| Tip | `.leader-tip` 7×7px, `border-radius: 50%`, white 1px halo |
| Leader stroke | 1.25, round cap, `vector-effect: non-scaling-stroke` |
| Stage bg | `#1e293b` (`--slate-800`) |

Production UI references (for mock fidelity, not callout style):

- `inspectionDrawingKioskUi.ts` / `kioskTheme.ts` / `kioskMarkerTheme.ts`
- Create page: aside ~17rem, mode row 丸数字/矢視, nominal + tolerances, save in flat band

## Implementation Notes

- Leaders: SVG lines in `.leader-layer` with `viewBox="0 0 100 100"` + `preserveAspectRatio="none"` (lines only)
- Tips: HTML `.leader-tip` absolutely positioned in % — **not** SVG circles
- Placement JS runs on load / resize / `beforeprint` (after print fit)
- Function name in frozen HTML may still be `placeHands`; behavior is callout placement only

## Acceptance

- [ ] Safari `file://` shows 6 numbered pills outside the screen
- [ ] Leaders do not form a spider web (no mutual crossings)
- [ ] Tips look circular (not ellipses)
- [ ] Print / PDF is one A4 landscape page; chrome bar hidden
- [ ] Copy matches the table exactly
- [ ] No hand art

## Local Notes JA

- 現場向け一枚物。文章は読ませない前提。
- 「ボタン名の繰り返し禁止」→ 指示補足の6文言を使う。
- 手イラスト案は検討後に不採用（確定）。

## References

- ADR: [ADR-20260728-inspection-drawing-sop-outer-callouts.md](../decisions/ADR-20260728-inspection-drawing-sop-outer-callouts.md)
- Preview: [kiosk-inspection-drawing-dimension-tolerance-sop-1page.html](../design-previews/kiosk-inspection-drawing-dimension-tolerance-sop-1page.html)
