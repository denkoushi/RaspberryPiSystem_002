# キオスク検査図面 UI/UX 改修 ExecPlan

This ExecPlan is a living document. Maintained in accordance with `.agent/PLANS.md`.

## Purpose / Big Picture

検査図面テンプレ作成・改版で、公差を基準値に対する符号付きオフセットとして入力し、名称を固定候補から選べるようにする。自主検査セッションでは合格範囲内の測定値をドロップダウン候補＋手入力で選べる。作成画面上辺に測定点一覧を出し、右ペインで詳細編集する。API/DB の保存契約（絶対 `lowerLimit`/`upperLimit`）は維持する。

## Progress

- [x] (2026-06-03) ブランチ `feat/inspection-drawing-signed-tolerance-uiux` 作成
- [x] 符号付き公差・legacy 遷移・テスト（`toleranceFields.ts` · `markerNumbering.ts`）
- [x] 名称候補 select（`inspectionDrawingMeasurementLabelOptions.ts`）
- [x] 上辺測定点一覧（`pointListSlot` · `InspectionDrawingPointSummaryStrip`）
- [x] 自主検査候補入力（`selfInspectionMeasurementValueOptions.ts` · `valueInputMode`）
- [x] コードレビュー指摘（P2）— 入力 `Input` 復帰・候補 ceil/floor・legacy 表示 `isLegacyAbsoluteOnlyPoint`
- [x] ローカル検証（web test 756 · lint · tsc · build）
- [x] コミット `6e436cfc` · push · CI run **`26867660917`** success
- [x] 先行デプロイ（Web のみ）— **Pi5** + **raspi4-kensaku-stonebase01**
- [x] KB / Runbook / deployment / EXEC_PLAN 反映
- [x] **`main` マージ**（2026-06-03）
- [ ] 残 Pi4×3 ロールアウト（`raspberrypi4` · `raspi4-robodrill01` · `raspi4-fjv60-80`）
- [ ] **レイアウト改善**（図面表示面積不足 — プレビューのみ着手、実装は別タスク）

## Decision Log

- Decision: UI raw は符号付き offset、保存は絶対 `lowerLimit`/`upperLimit`。`lowerLimit = nominal + lowerOffset`, `upperLimit = nominal + upperOffset`。
  Rationale: API 互換維持。2026-06-03 / agent
- Decision: legacy 行は公差欄未編集なら絶対値維持。片側公差入力で移行開始し、legacy 絶対上下限から両側 offset を seed（`mergeInspectionDrawingPointPatch` は seed 時に `legacyAbsoluteBounds` を渡して nominal 解決）。
  Rationale: 意図しない絶対値変更・浮動小数誤差を防ぐ。2026-06-03 / agent
- Decision: 名称候補外の既存値は一時 option（`（既存）`）で表示・未変更なら保存維持。新規点は `name: ''` + プレースホルダ select。
  Rationale: 既存テンプレ互換・将来管理コンソール候補 API 化の余地。2026-06-03 / agent
- Decision: 自主検査候補値は最大 200 件、超過時は手入力のみ。刻みは offset 最小桁、整数スケール。格子範囲は **下限 ceil・上限 floor** で範囲外候補を出さない。
  Rationale: NG 候補選択による保存阻害を防ぐ。2026-06-03 / agent
- Decision: `InspectionDrawingValuePanel` の legacy 表示は `toleranceBoundsFromPoint` の合成 nominal ではなく `isLegacyAbsoluteOnlyPoint` + `legacyAbsoluteBounds` を正本にする。
  Rationale: 「基準値未設定」表示と保存契約の一致。2026-06-03 / agent
- Decision: 本番記録画面（`KioskInspectionDrawingEditPage`）は `valueInputMode` デフォルト（自由入力のみ）。
  Rationale: 変更範囲限定。2026-06-03 / agent

## Surprises & Discoveries

- `mergeInspectionDrawingPointPatch` で `legacyAbsoluteBounds` を delete した **後** に `resolveNominalForLegacySeed(rest)` を呼ぶと、legacy 行の seed offset が誤る（例: 上限 `0.05` が `101.05` になる）。**Fix**: seed 時のみ `legacyAbsoluteBounds` を渡す。
- 候補生成で `Math.round` 両端だと 9.95–10.05・刻み 0.1 で **10.1** が候補に入り NG になる。**Fix**: `Math.ceil(lower*scale)` / `Math.floor(upper*scale)`。
- `formatToleranceRawNumber` に `round6` 未適用だと seed 文字列が `0.04999999999999716` になる。
- 上辺 `pointListSlot` + ヘッダー `p-1.5` + 右ペイン `lg:w-[20rem]` + ページ `p-2` の積み重ねで、**図面キャンバスの実表示面積が著しく減る**（Pi5 実機フィードバック 2026-06-03）。レイアウトは別途改善タスク。

## Concrete Steps（実装ファイル）

| 領域 | 主なパス |
|------|----------|
| 公差変換 | `apps/web/.../toleranceFields.ts` |
| legacy・保存 | `apps/web/.../markerNumbering.ts` |
| 名称候補 | `apps/web/.../inspectionDrawingMeasurementLabelOptions.ts` |
| 候補値 | `apps/web/.../selfInspectionMeasurementValueOptions.ts` |
| UI | `InspectionDrawingPointSettingsPanel.tsx` · `InspectionDrawingValuePanel.tsx` · `InspectionDrawingPointSummaryStrip.tsx` · `InspectionDrawingCreateHeaderBand.tsx` · `inspectionDrawingKioskUi.ts` |
| 画面 | `KioskInspectionDrawingCreatePage.tsx` · `KioskSelfInspectionSessionPage.tsx` |

## Validation and Acceptance

```bash
pnpm --filter @raspi-system/web exec vitest run apps/web/src/features/part-measurement/inspection-drawing/__tests__/
pnpm --filter @raspi-system/web test
pnpm --filter @raspi-system/web lint
pnpm --filter @raspi-system/web exec tsc --noEmit
pnpm --filter @raspi-system/web build
```

手動（Runbook §実機確認ポイント拡張）: テンプレ新規/改版（符号付き公差・名称・一覧）· 自主検査候補+手入力 · 本番記録は自由入力 · legacy 行の上下限維持。

## デプロイ（先行検証 2026-06-03）

| ホスト | Detach Run ID | HEAD | RECAP |
|--------|---------------|------|-------|
| `raspberrypi5` | `20260603-154307-28721` | `6e436cfc` | `failed=0` · `Git: changed` · **Docker web 再ビルド** |
| `raspi4-kensaku-stonebase01` | `20260603-154818-15503` | `6e436cfc` | `failed=0` · `kiosk-browser` 再起動 |

標準手順: [deployment.md §符号付き公差 UI/UX](../guides/deployment.md#kiosk-inspection-drawing-signed-tolerance-uiux-2026-06-03)

## Outcomes & Retrospective

- **CI**: GitHub Actions **`26867660917`** — 全ジョブ success（`lint-build-unit` · `e2e-smoke` · `api-db-and-infra` · `security-docker` · `e2e-tests`）。
- **契約**: 保存 API は従来どおり絶対上下限。UI のみ符号付き offset 表示。
- **残課題**: キオスク検査図面作成画面の **図面表示面積**（ヘッダー・一覧・余白）。プレビュー: `docs/plans/kiosk-inspection-drawing-layout-preview.html`（HTML のみ・未実装）。
