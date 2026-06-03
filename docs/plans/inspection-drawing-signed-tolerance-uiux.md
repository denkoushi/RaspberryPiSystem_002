# キオスク検査図面 UI/UX 改修 ExecPlan

This ExecPlan is a living document. Maintained in accordance with `.agent/PLANS.md`.

## Purpose / Big Picture

検査図面テンプレ作成・改版で、公差を基準値に対する符号付きオフセットとして入力し、名称を固定候補から選べるようにする。自主検査セッションでは合格範囲内の測定値をドロップダウン候補＋手入力で選べる。作成画面上辺に測定点一覧を出し、右ペインで詳細編集する。

## Progress

- [x] (2026-06-03) ブランチ `feat/inspection-drawing-signed-tolerance-uiux` 作成
- [x] 符号付き公差・legacy 遷移・テスト（`toleranceFields.ts` · `markerNumbering.ts`）
- [x] 名称候補 select（`inspectionDrawingMeasurementLabelOptions.ts`）
- [x] 上辺測定点一覧（`pointListSlot` · `InspectionDrawingPointSummaryStrip`）
- [x] 自主検査候補入力（`selfInspectionMeasurementValueOptions.ts` · `valueInputMode`）
- [x] KB-320 / Runbook / EXEC_PLAN 要約更新
- [ ] Pi5/Pi4 デプロイ・本番目視（**未実施・コミット/push 禁止**）

## Decision Log

- Decision: UI raw は符号付き offset、保存は絶対 `lowerLimit`/`upperLimit`。`lowerLimit = nominal + lowerOffset`。
  Rationale: API 互換維持。2026-06-03 / agent
- Decision: legacy 行は公差欄未編集なら絶対値維持。片側公差入力で移行開始し両側 offset を legacy から seed。
  Rationale: 意図しない絶対値変更を防ぐ。2026-06-03 / agent
- Decision: 名称候補外の既存値は一時 option で表示・未変更なら保存維持。
  Rationale: 既存テンプレ互換。2026-06-03 / agent
- Decision: 候補値は最大 200 件、超過時は手入力のみ。刻みは offset 最小桁、整数スケール生成。
  Rationale: 性能と浮動小数誤差回避。2026-06-03 / agent

## Validation and Acceptance

```bash
pnpm --filter @raspi-system/web exec vitest run apps/web/src/features/part-measurement/inspection-drawing/__tests__/toleranceFields.test.ts
pnpm --filter @raspi-system/web exec vitest run apps/web/src/features/part-measurement/inspection-drawing/__tests__/markerNumbering.test.ts
pnpm --filter @raspi-system/web test
pnpm --filter @raspi-system/web lint
pnpm --filter @raspi-system/web build
```

手動: 検査図面テンプレ新規/改版、本番記録は自由入力のまま、自主検査は候補+手入力。

## Outcomes & Retrospective

- ローカル: `vitest`（inspection-drawing 21 件）· `pnpm --filter @raspi-system/web test`（754 件）· lint · build 成功。
- バグ修正: `mergeInspectionDrawingPointPatch` で legacy 削除後に nominal を解決していたため seed offset が誤る → legacy を渡して解決。`formatToleranceRawNumber` に `round6` を適用。
- 未実施: コミット/push/デプロイ/本番目視（計画どおり停止）。
