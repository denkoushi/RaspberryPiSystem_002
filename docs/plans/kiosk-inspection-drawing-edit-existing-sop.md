---
id: plan-kiosk-inspection-drawing-edit-existing-sop
title: Multi-page SOP for editing an existing inspection-drawing template
status: draft
date: 2026-07-28
source_of_truth: true
scope: static design preview / operator SOP (print A4 landscape, one sheet per screen)
related_docs:
  - ../decisions/ADR-20260728-inspection-drawing-sop-step-rail.md
  - ./kiosk-sop-popup-viewer-execplan.md
  - ../plans/kiosk-inspection-drawing-dimension-tolerance-sop-1page.md
  - ../design-previews/kiosk-inspection-drawing-edit-existing-sop.html
  - ../design-previews/kiosk-inspection-drawing-dimension-tolerance-sop-1page.html
  - ../design-previews/README.md
related_code:
  - apps/web/src/features/kiosk-sop/
  - apps/web/src/pages/kiosk/KioskInspectionDrawingLibraryPage.tsx
  - apps/web/src/pages/kiosk/KioskInspectionDrawingCreatePage.tsx
  - apps/web/src/features/part-measurement/inspection-drawing/
---

# Plan: Inspection-drawing existing-edit SOP (multi-page)

## Purpose / Big Picture

Operator SOP for **検査図面** → **既存テンプレ編集**.

**Rule:** when the target kiosk screen changes, the SOP uses a **separate A4 landscape sheet** (not one crowded composite).

| Sheet | Screen | Steps |
|-------|--------|-------|
| 1 / 2 | 一覧（ライブラリ） | 1–2 |
| 2 / 2 | 編集 | 3–12 |

The [dimension/tolerance SOP](./kiosk-inspection-drawing-dimension-tolerance-sop-1page.md) remains a **layout-pattern sample** (single screen, 6 taps).

**Visual / implementation source of truth:**
[`docs/design-previews/kiosk-inspection-drawing-edit-existing-sop.html`](../design-previews/kiosk-inspection-drawing-edit-existing-sop.html)

**Layout ADR (shared):** [ADR-20260728-inspection-drawing-sop-step-rail.md](../decisions/ADR-20260728-inspection-drawing-sop-step-rail.md)

## Progress

- [x] (2026-07-28) Gap analysis vs sample 6-step SOP
- [x] (2026-07-28) Split by screen: library sheet + edit sheet
- [x] Release-bundled popup viewer (implementation tracked separately; production default OFF)
- [ ] Operator review / copy freeze
- [ ] Optional: print PDF laminate (ops only)

## Do / Don't

### Do

- **One target screen → one `.sheet` (one print page)**
- Step numbers continue across sheets (1…n global)
- Follow step-rail ADR per sheet: left list + badges on target **bottom-right**; leaders hover/focus only; print hides leaders
- Match visual tokens from the dimension-tolerance sample HTML
- Show page badge on rail (`1 / 2 · 一覧画面` / `2 / 2 · 編集画面`)

### Don't

- Combine library + edit mocks on one sheet
- Hand / finger PNGs
- Always-on outer callout leaders (superseded ADR)
- Treat the 6-step dimension sample as the full edit SOP

## Step Order And Copy (Japanese)

### Sheet 1 — 一覧

| # | `data-tap` target | List text (`step-t`) |
|---|-------------------|----------------------|
| 1 | 下辺メニュー「検査図面」（immersive header） | 検査図面を開く |
| 2 | テンプレ行の「編集」 | 対象の編集を押す |

### Sheet 2 — 編集

| # | `data-tap` target | List text (`step-t`) |
|---|-------------------|----------------------|
| 3 | 測定点一覧の選択カード | 直す点を選ぶ |
| 4 | 名称 select | 何を測るか選ぶ |
| 5 | 基準値 input | 図面の寸法を入れる |
| 6 | 上限公差 input | 許される＋側 |
| 7 | 下限公差 input | 許される−側 |
| 8 | 十字ナッジ行 | ずれたら十字で直す |
| 9 | 矢視ボタン | （任意）矢視を置く |
| 10 | 丸数字ボタン | （不足なら）点を増やす |
| 11 | 保存 | 改版して残す |
| 12 | 一覧へ戻る | 一覧に戻る |

## Operator constraints (rail notes)

- 保存は改版（旧版は履歴）
- 有効テンプレがある図面は左「新規」不可 → 右の「編集」
- 空所タップ（丸数字モード）は新点追加。既存点の移動は十字

## Acceptance

- [x] Separate sheet per target screen
- [x] Global step numbers 1–12
- [x] Badges on bottom-right; hover leaders only; print leaders off
- [x] Print = A4 landscape × sheet count
- [x] No hand art
- [ ] Shop-floor copy sign-off

## Local Notes JA

- 対象画面が増えたらシートを増やす（1画面=1枚）。1枚に複数画面を詰め込まない。
- 面・呼び径・通し・兄弟保存範囲は密度のため未掲載。必要なら編集シートのレールへ追記、または別シート。

## References

- ADR: [ADR-20260728-inspection-drawing-sop-step-rail.md](../decisions/ADR-20260728-inspection-drawing-sop-step-rail.md)
- Pattern sample: [kiosk-inspection-drawing-dimension-tolerance-sop-1page.md](./kiosk-inspection-drawing-dimension-tolerance-sop-1page.md)
- Preview: [kiosk-inspection-drawing-edit-existing-sop.html](../design-previews/kiosk-inspection-drawing-edit-existing-sop.html)
