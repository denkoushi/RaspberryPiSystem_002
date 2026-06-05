# キオスク検査図面 測定点位置微調整（十字ボタン）ExecPlan

This ExecPlan is a living document. Maintained in accordance with `.agent/PLANS.md`.

## Purpose / Big Picture

検査図面テンプレ **作成/改版** の右ペインで、選択中測定点の丸数字位置を **十字ボタン** で微調整する。座標正本は既存の `xRatio` / `yRatio`（0–1）を維持し、API/DB は変更しない。フロントで **必ず clamp 済み** の座標 patch を生成して保存する（route schema が 0..1 を要求するため）。

## Progress

- [x] (2026-06-05) ブランチ `feat/inspection-drawing-point-nudge` 作成
- [x] 純関数 `inspectionDrawingPointPosition.ts`（`INSPECTION_DRAWING_POINT_NUDGE_STEP_RATIO = 0.0025`）
- [x] UI `InspectionDrawingPointPositionNudge.tsx` + `InspectionDrawingPointSettingsPanel` レイアウト更新
- [x] 単体テスト（純関数 + UI + Sidebar 表示責務 · **14 passed**）
- [x] ローカル検証（web lint 全体 · `tsc` · build · web test **849 passed**）
- [x] ドキュメント（KB-320 · Runbook · verification-checklist · INDEX · EXEC_PLAN · deployment · layout preview HTML）
- [x] コミット / push — **`da9d2675`**
- [x] CI — **`26996602603`** success（全ジョブ）
- [x] デプロイ先行 — Pi5 **`20260605-141538-27072`** · stonebase **`20260605-142229-22757`** · **実機 OK**
- [ ] Pi4×3 順次デプロイ（`raspberrypi4` · `raspi4-robodrill01` · `raspi4-fjv60-80`）
- [x] `main` マージ — PR [#391](https://github.com/denkoushi/RaspberryPiSystem_002/pull/391) · **`791f1074`**

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

## Surprises & Discoveries

- **ESLint `import/order`**: case-insensitive 昇順のため PascalCase sibling より `inspectionDrawing*` を先に並べる必要あり（CI ゲート）。
- **Vitest パス**: `pnpm --filter @raspi-system/web exec` では **`src/features/...`** が正。`apps/web/src/...` は再現不能。
- **Pi5 バンドル確認**: `docker exec docker-web-1 grep 測定点の位置調整 /srv/site/assets/index-*.js` でデプロイ反映を即確認できる。

## Outcomes & Retrospective

- **実装完了** — Web のみ · 純関数 + 既存 `onChange` / 保存契約維持 · テスト 14 + CI 全成功。
- **本番先行** — Pi5 + stonebase **実機 OK**（2026-06-05）。残 Pi4×3 は stonebase パターンどおり順次。
- **参照**: [KB-320 §十字ボタン](../knowledge-base/KB-320-kiosk-part-measurement.md#検査図面-測定点位置微調整-十字ボタン-2026-06-05) · [deployment §2026-06-05](../guides/deployment.md#kiosk-inspection-drawing-point-nudge-2026-06-05)
