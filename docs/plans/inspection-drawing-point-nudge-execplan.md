# キオスク検査図面 測定点位置微調整（十字ボタン）ExecPlan

This ExecPlan is a living document. Maintained in accordance with `.agent/PLANS.md`.

## Purpose / Big Picture

検査図面テンプレ **作成/改版** の右ペインで、選択中測定点の丸数字位置を **十字ボタン** で微調整する。座標正本は既存の `xRatio` / `yRatio`（0–1）を維持し、API/DB は変更しない。フロントで **必ず clamp 済み** の座標 patch を生成して保存する（route schema が 0..1 を要求するため）。

## Progress

- [x] (2026-06-05) ブランチ `feat/inspection-drawing-point-nudge` 作成
- [x] 純関数 `inspectionDrawingPointPosition.ts`（`INSPECTION_DRAWING_POINT_NUDGE_STEP_RATIO = 0.0025`）
- [x] UI `InspectionDrawingPointPositionNudge.tsx` + `InspectionDrawingPointSettingsPanel` レイアウト更新
- [x] 単体テスト（純関数 + UI + Sidebar 表示責務）
- [x] ローカル検証（web test 対象ファイル · 14 passed · `tsc --noEmit` OK）
- [x] ドキュメント（KB-320 · Runbook · verification-checklist · INDEX · EXEC_PLAN · layout preview HTML）
- [x] コミット / push（ユーザー指示により実施）
- [ ] CI 確認 / デプロイ（デプロイは未実施）

## Decision Log

- Decision: 微調整は **十字ボタンのみ**（ドラッグなし）。ステップは固定 ratio **`INSPECTION_DRAWING_POINT_NUDGE_STEP_RATIO = 0.0025`**。
  Rationale: Pi4 でも軽量・実装単純・ズーム非依存。2026-06-05 / agent
- Decision: フロントで **必ず clamp 済み patch** を生成。API service の `clampRatio` に依存しない。
  Rationale: route schema（`z.number().min(0).max(1)`）が範囲外を拒否する。2026-06-05 / agent
- Decision: `clampInspectionDrawingRatio` は有限 number 以外を **0** に丸める。
  Rationale: 不正 state の収束とテスト容易性。2026-06-05 / agent
- Decision: 表示条件は **`InspectionDrawingPointSidebar`** の `mode === 'place' && selectedPoint` を維持。`SettingsPanel` に `mode` prop は増やさない。
  Rationale: モード責務の集約・疎結合。2026-06-05 / agent
- Decision: 右ペイン `17rem` 内で名称・基準値を 2 列化。説明文「合格範囲は…」は削除。
  Rationale: 十字ボタン配置スペース確保。2026-06-05 / agent

## Concrete Steps（実装ファイル）

| 領域 | パス |
|------|------|
| 座標演算 | `apps/web/.../inspectionDrawingPointPosition.ts` |
| 十字 UI | `apps/web/.../InspectionDrawingPointPositionNudge.tsx` |
| 設定パネル | `apps/web/.../InspectionDrawingPointSettingsPanel.tsx` |
| スタイル | `apps/web/.../inspectionDrawingKioskUi.ts` |
| 表示責務 | `apps/web/.../InspectionDrawingPointSidebar.tsx`（変更なし・契約維持） |
| テスト | `__tests__/inspectionDrawingPointPosition.test.ts` · `InspectionDrawingPointPositionNudge.test.tsx` · `InspectionDrawingPointSettingsPanel.test.tsx` · `InspectionDrawingPointSidebar.test.tsx` |

## Validation and Acceptance

```bash
pnpm --filter @raspi-system/web exec vitest run \
  src/features/part-measurement/inspection-drawing/__tests__/inspectionDrawingPointPosition.test.ts \
  src/features/part-measurement/inspection-drawing/__tests__/InspectionDrawingPointPositionNudge.test.tsx \
  src/features/part-measurement/inspection-drawing/__tests__/InspectionDrawingPointSettingsPanel.test.tsx \
  src/features/part-measurement/inspection-drawing/__tests__/InspectionDrawingPointSidebar.test.tsx
```

手動: 「点を配置」+ 測定点選択 → 右ペイン上部の十字ボタンでマーカーが移動 · test/ガイド試行では設定パネル非表示 · 保存後 `markerXRatio`/`markerYRatio` 反映。

## Outcomes & Retrospective

- **未デプロイ** — 実装完了・ローカルテスト OK・コミット/push 禁止で停止。
