---
title: KB-399 Inspection drawing create layout regression (toolbar stack + sidebar clip)
tags: [kiosk, part-measurement, inspection-drawing, layout, regression, compact-header]
audience: [開発者]
last-verified: 2026-07-09
category: knowledge-base
---

# KB-399: Inspection drawing create layout regression (toolbar stack + sidebar clip)

## Metadata

| Field | Value |
|-------|-------|
| id | KB-399 |
| status | active |
| scope | キオスク検査図面テンプレ作成/改版（`KioskInspectionDrawingCreatePage`、実効幅 1280px）の CompactHeader ツールバーと右ペイン「測定点一覧」 |
| date | 2026-07-09 |
| source_of_truth | this file |
| related_code | `InspectionDrawingCreateCompactHeader.tsx`, `inspectionDrawingKioskUi.ts`, `__tests__/inspectionDrawingCreateCompactHeader.test.tsx`, `inspectionDrawingKioskUi.test.ts` |

## Context

2026-07-09 ユーザー報告: キオスク「検査図面」テンプレート作成/改版画面で、(1) ヘッダー緑ボタンが右端に縦積みしてヘッダーが異常に高くなる、(2) 右ペインの「測定点一覧」が画面下方へ押し出されて見切れる。

両症状は 2026-07-08 の別コミット由来で、2026-07-09 に 2 本の fix ブランチを `main` へマージ済み。

## Symptoms Or Trigger

- 画面: `KioskInspectionDrawingCreatePage`（作成/改版）。実効幅 **1280px** で顕著
- (1) CompactHeader の緑ボタン（切削 / 研削 / 点を配置 / 保存）が右端で縦積みし、ヘッダー高が異常に増える
- (2) 右ペイン「測定点一覧」がペイン内スクロールにならず、画面下方へ押し出されて見切れる
- DEV 再現: `/dev/kiosk-inspection-drawing-create?scenario=revise`（1280×800）

## Investigation

### Cause 1 — toolbar-slot flex shrink

- `2ecfe663`（2026-07-08、二次操作の右寄せ）で CompactHeader の toolbar-slot が `min-w-0 flex-1` になった
- 狭幅でスロットが潰れ、内側 toolbar の `flex-wrap` により緑ボタンが縦積み化
- 応急修正の連鎖でも根治せず: `e8541b29`（`w-full`）→ `f5449e28`（再び `min-w-0 flex-1`）→ `19242fa9`（密度圧縮）
- 正しい定数 `inspectionDrawingToolbarSlotClassName`（`shrink-0`、`inspectionDrawingKioskUi.ts` 内にコメント付きで定義済み）が CompactHeader で**未使用**だった

### Cause 2 — side aside without overflow constraint

- `04bb49fe`（2026-07-08、丸数字設定改善）で右ペイン設定パネル（`shrink-0`）が縦に増えた
- `inspectionDrawingCreateSideAsideClassName` に overflow 拘束がなく、一覧の `overflow-y-auto` に有限高さが渡らない
- 結果、一覧が aside 内で縮まず、`KioskLayout` main の `overflow-auto` 側へ押し出された

## Root Cause

1. **Toolbar**: CompactHeader が共有定数 `inspectionDrawingToolbarSlotClassName`（`shrink-0`）を使わず、`min-w-0 flex-1` のままだったため、狭幅でスロットが潰れ toolbar が wrap 縦積みした。
2. **Sidebar**: 右ペイン aside に `overflow-hidden` がなく、設定パネル増分後も一覧へ有限高さが伝わらず、ページ全体スクロールへ押し出された。

## Fix

| Commit | Change |
|--------|--------|
| `6a265d0e` | `InspectionDrawingCreateCompactHeader.tsx` の toolbar-slot を `inspectionDrawingToolbarSlotClassName` に変更。契約テスト `__tests__/inspectionDrawingCreateCompactHeader.test.tsx` 追加 |
| `2432b4fd` | `inspectionDrawingCreateSideAsideClassName` に `overflow-hidden` 追加。契約テスト `inspectionDrawingKioskUi.test.ts` 追加 |

Note: `lg` 未満の縦積みレイアウトでは aside が内容高さのため、一覧の切り落としは発生しない（意図どおり）。

## Prevention

- 契約テスト: toolbar-slot に `flex-1` / `min-w-0` を戻さない
- 契約テスト: aside の `overflow-hidden` を維持する
- 既存 E2E `e2e/inspection-drawing-create-header-layout.spec.ts` がヘッダー行数契約（最大 2 行・孤児 chip なし・横溢れなし）を担保
- CompactHeader 変更時は `inspectionDrawingToolbarSlotClassName` を直接使う（インライン class で上書きしない）

## Validation

2026-07-09、Mac ローカル:

| Check | Result |
|-------|--------|
| `pnpm --filter web lint` | PASS |
| `pnpm --filter web exec tsc -b` | PASS |
| `pnpm --filter web test -- inspection-drawing` | PASS — 44 files / 252 tests |
| `pnpm exec playwright test e2e/inspection-drawing-create-header-layout.spec.ts` | PASS — 3 tests（1280×800） |
| DEV 目視 `/dev/kiosk-inspection-drawing-create?scenario=revise`（1280×800） | ヘッダー 2 行・測定点一覧がペイン内表示 |

### Production deploy (2026-07-09)

- HEAD: **`4f9a7025`**（`origin/main` 一致）· fix: **`6a265d0e`** / **`2432b4fd`** · **Web only**（API/DB 変更なし）
- `raspberrypi3`（サイネージ）は対象外（スキップ）
- 運用メモ: [Deployment](../guides/deployment.md#inspection-drawing-create-layout-regression-2026-07-09)

| Host | Run ID | Result |
|------|--------|--------|
| `raspberrypi5` | `20260709-104602-7562` | success · `failed=0` · web 再ビルド · health ok |
| `raspi4-kensaku-stonebase01` | `20260709-105025-4697` | success · `failed=0` · `isMaintenance:false` · **実機OK（ユーザー確認）** |
| `raspberrypi4` / `raspi4-robodrill01` / `raspi4-fjv60-80` / `raspi4-sessaku-01` | `20260709-105823-5556` | success · 4台とも `failed=0` / `unreachable=0` · すべて `isMaintenance:false` |

## Open Items

- なし（本番キオスク実機目視は 2026-07-09 完了）

## References

- Fix commits: `6a265d0e`, `2432b4fd`
- Production HEAD: `4f9a7025`
- Regression sources: `2ecfe663` (toolbar-slot), `04bb49fe` (settings panel growth)
- Partial / non-root fixes: `e8541b29`, `f5449e28`, `19242fa9`
- Canonical layout preview: [kiosk-inspection-drawing-layout-preview.html](../plans/kiosk-inspection-drawing-layout-preview.html)
- One-off pre-fix preview (disposable): [kiosk-inspection-drawing-layout-fix-preview-20260709.html](../plans/kiosk-inspection-drawing-layout-fix-preview-20260709.html)
- Screen canon: [KB-320 · キオスク部品測定](./KB-320-kiosk-part-measurement.md)
- Related UI: [KB-397 · tolerance datalist](./KB-397-inspection-tolerance-datalist-unselectable-kiosk.md)

## Local Notes JA

- UI 文言は原文のまま: 切削 / 研削 / 点を配置 / 保存 / 測定点一覧
- 画面名: 検査図面テンプレート作成/改版（`KioskInspectionDrawingCreatePage`）
- 2026-07-09 報告の 2 症状は別根因だが、同一画面・同日修正のため本 KB にまとめた
