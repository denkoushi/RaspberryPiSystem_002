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
- [x] (2026-07-08) 旧先行分の未展開 Pi4×3 + 追加 Pi4 `raspi4-sessaku-01` も現行 **`04bb49fe`** へ収束（Pi5 + Pi4×5 反映済）
- [x] **レイアウト改善（作成/改版）** — 別 ExecPlan [inspection-drawing-create-layout-and-return-nav.md](./inspection-drawing-create-layout-and-return-nav.md) · **`5274f1ee`** · Pi5 Detach **`20260603-211122-29648`**
- [x] (2026-07-06) 名称ごとの **寸法公差 / 幾何公差** 紐づけ設定と上下限公差候補を追加（`feat/inspection-drawing-tolerance-kind-settings` · `20e90160`）
- [x] (2026-07-06) CI **`28758193791`** success、Deploy **`20260706-082903-1300`** success、Phase12 **45/0/0**
- [x] (2026-07-06) 公差入力の実機フィードバック対応（幾何公差 `0` 追加、候補再選択、入力文字色、名称 placeholder）を追加（`feat/inspection-drawing-tolerance-input-usability-fixes` · `becb6e7c`）
- [x] (2026-07-06) CI **`28760895857`** success、Deploy **`20260706-100018-28681`** success、Phase12 **45/0/0**
- [x] (2026-07-08) 丸数字設定改善（保存状態・全削除・`厚み`・幾何公差 0〜上限値）— **`04bb49fe`**、CI **`28910499400`** success、Pi5 + Pi4×5 deploy success、Phase12 **45/0/0**、実機検証OK

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
- Decision: 検査図面の測定点名称に `度` を含む場合は既定で **幾何公差**、それ以外は **寸法公差** とし、管理コンソール `/admin/tools/part-measurement-templates` で名称ごとに上書きできる。
  Rationale: 初期導入を手作業なしで始めつつ、`幅=幾何公差` など現場例外を設定で吸収する。2026-07-06 / agent
- Decision: 上限公差・下限公差は同じ候補リストを `datalist` で提示し、候補外の手入力値は保持する。名称変更時も入力済み上下限は自動変更しない。
  Rationale: 既存テンプレ・現場入力を壊さず、入力補助だけを足す。2026-07-06 / agent
- Decision: 幾何公差候補には `0` を先頭に含め、`0` / `0.001`〜`0.009` とする。
  Rationale: 実機検証で幾何公差の下限・上限に `0` を選ぶ運用が必要だった。2026-07-06 / agent
- Decision: 候補入力は選択済み候補の再フォーカス時に一時的に空にし、候補を選ばず blur した場合は元値を復元する。
  Rationale: 実機ブラウザで同じ値が残ったままだと datalist の再選択がしにくく、手入力契約も維持する必要がある。2026-07-06 / agent
- Decision: 作成/改版の保存ボタンは「変更あり + 入力有効 + 保存中でない + 閲覧版でない」のときだけ enabled とし、一時保存は追加しない。状態表示は既存1行ツールバー内の保存ボタン右、一覧へ戻る左に置き、未保存の内部リンク遷移・ブラウザ更新/終了だけ警告する。
  Rationale: 既存の改版保存を確定保存として保ち、履歴・API 契約を変えずに「押す必要がある時だけ押せる」状態へ寄せる。2026-07-08 / agent
- Decision: 幾何公差は入力値を上限値とし、合格範囲を `0〜上限値` に統一する。保存 payload は `nominalValue=上限値` / `lowerLimit=0` / `upperLimit=上限値`。
  Rationale: 平行度 `0.005` や `0.01` など、幾何公差の現場表記は上限のみを規格値として扱うため。2026-07-08 / agent

## Surprises & Discoveries

- `mergeInspectionDrawingPointPatch` で `legacyAbsoluteBounds` を delete した **後** に `resolveNominalForLegacySeed(rest)` を呼ぶと、legacy 行の seed offset が誤る（例: 上限 `0.05` が `101.05` になる）。**Fix**: seed 時のみ `legacyAbsoluteBounds` を渡す。
- 候補生成で `Math.round` 両端だと 9.95–10.05・刻み 0.1 で **10.1** が候補に入り NG になる。**Fix**: `Math.ceil(lower*scale)` / `Math.floor(upper*scale)`。
- `formatToleranceRawNumber` に `round6` 未適用だと seed 文字列が `0.04999999999999716` になる。
- 上辺 `pointListSlot` + ヘッダー `p-1.5` + 右ペイン `lg:w-[20rem]` + ページ `p-2` の積み重ねで、**図面キャンバスの実表示面積が著しく減る**（Pi5 実機フィードバック 2026-06-03）。**作成/改版は [layout ExecPlan](./inspection-drawing-create-layout-and-return-nav.md) で対応済**（`5274f1ee`）。
- 実機ブラウザでは、`datalist` 候補を一度選ぶと値が残ったままになり、同じ欄で候補を開き直して別値を選びにくい。**Fix**: 候補値に一致する入力だけ focus 時に一時クリアし、blur 時に復元する。

## Concrete Steps（実装ファイル）

| 領域 | 主なパス |
|------|----------|
| 公差変換 | `apps/web/.../toleranceFields.ts` |
| legacy・保存 | `apps/web/.../markerNumbering.ts` |
| 名称候補 | `apps/web/.../inspectionDrawingMeasurementLabelOptions.ts` |
| 名称・公差種別設定 | `packages/shared-types/src/part-measurement/inspection-drawing-tolerance-kind.ts` · `apps/web/.../InspectionDrawingMeasurementLabelSettingsSection.tsx` |
| 設定 API | `apps/api/src/routes/part-measurement/inspection-drawing-measurement-label-settings.ts` · `apps/api/src/services/part-measurement/inspection-drawing-measurement-label-settings.service.ts` |
| 公差入力 UX | `InspectionDrawingPointSettingsPanel.tsx` · `inspectionDrawingKioskUi.ts` · `inspectionDrawingMeasurementLabelOptions.ts` |
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

2026-07-06 追加検証:

```bash
pnpm --filter @raspi-system/shared-types build
DATABASE_URL=postgresql://postgres:postgres@localhost:55433/borrow_return pnpm --filter @raspi-system/api prisma:deploy
DATABASE_URL=postgresql://postgres:postgres@localhost:55433/borrow_return pnpm --filter @raspi-system/api test -- src/routes/__tests__/part-measurement.integration.test.ts
pnpm --filter @raspi-system/web test -- src/features/part-measurement/inspection-drawing
pnpm --filter @raspi-system/web build
```

一時 Postgres で migration / integration test / `EXPLAIN` を確認し、検証後に一時コンテナを削除する。

2026-07-06 本番反映:

- GitHub Actions CI **`28758193791`** — 全ジョブ success（`lint-build-unit` · `api-db-and-infra` · `security-docker` · `e2e-smoke` · `e2e-tests`）。
- `./scripts/update-all-clients.sh feat/inspection-drawing-tolerance-kind-settings infrastructure/ansible/inventory.yml --detach --follow` → **Run ID `20260706-082903-1300`**、summary success true、exitCode 0、全 7 ホスト `failed=0 / unreachable=0`。
- `./scripts/deploy/verify-phase12-real.sh` → **PASS 45 / WARN 0 / FAIL 0**。

2026-07-06 実機フィードバック対応 追加検証:

- `pnpm --filter @raspi-system/shared-types build`、`pnpm --filter @raspi-system/web test -- src/features/part-measurement/inspection-drawing`（**41 files / 213 tests passed**）、`pnpm --filter @raspi-system/web build`、`pnpm lint --max-warnings=0`、`git diff --check` success。
- GitHub Actions CI **`28760895857`** — 全ジョブ success（`lint-build-unit` · `api-db-and-infra` · `security-docker` · `e2e-smoke` · `e2e-tests`）。
- `./scripts/update-all-clients.sh feat/inspection-drawing-tolerance-input-usability-fixes infrastructure/ansible/inventory.yml --detach --follow` → **Run ID `20260706-100018-28681`**、summary success true、exitCode 0、全 7 ホスト `failed=0 / unreachable=0`。
- `./scripts/deploy/verify-phase12-real.sh` → **PASS 45 / WARN 0 / FAIL 0**。

2026-07-08 丸数字設定改善 追加検証:

- Web targeted tests **9 files / 65 tests passed**、`pnpm --filter @raspi-system/web lint`、`pnpm --filter @raspi-system/web build`、`pnpm --filter @raspi-system/shared-types build`、`git diff --check` success。
- GitHub Actions CI **`28910499400`** — 全ジョブ success（`lint-build-unit` · `api-db-and-infra` · `security-docker` · `e2e-smoke` · `e2e-tests`）。
- Pi5 + Pi4×5 順次デプロイ: `raspberrypi5=20260708-103842-32504`、`raspi4-kensaku-stonebase01=20260708-104449-7203`、`raspberrypi4=20260708-110444-28905`、`raspi4-robodrill01=20260708-110943-19113`、`raspi4-fjv60-80=20260708-111331-2379`、`raspi4-sessaku-01=20260708-111719-728`。全台 `failed=0`、HEAD **`04bb49fe`**。
- `./scripts/deploy/verify-phase12-real.sh` → **PASS 45 / WARN 0 / FAIL 0**。deployed Web smoke は保存なしで、保存状態表示・`全削除`・`厚み`・1行 `↑ ↓ ← →`・幾何 `平行度 0.005` の `合格範囲 0〜0.005` を確認。2026-07-08 ユーザー実機検証OK。

## デプロイ（先行検証 2026-06-03）

| ホスト | Detach Run ID | HEAD | RECAP |
|--------|---------------|------|-------|
| `raspberrypi5` | `20260603-154307-28721` | `6e436cfc` | `failed=0` · `Git: changed` · **Docker web 再ビルド** |
| `raspi4-kensaku-stonebase01` | `20260603-154818-15503` | `6e436cfc` | `failed=0` · `kiosk-browser` 再起動 |

標準手順: [deployment.md §符号付き公差 UI/UX](../archive/deployments/2026-06.md#kiosk-inspection-drawing-signed-tolerance-uiux-2026-06-03)

## Outcomes & Retrospective

- **CI**: GitHub Actions **`26867660917`** — 全ジョブ success（`lint-build-unit` · `e2e-smoke` · `api-db-and-infra` · `security-docker` · `e2e-tests`）。
- **名称・公差種別設定（2026-07-06）**: GitHub Actions **`28758193791`** success、Deploy **`20260706-082903-1300`** success、Phase12 **45/0/0**。
- **公差入力 実機フィードバック対応（2026-07-06）**: GitHub Actions **`28760895857`** success、Deploy **`20260706-100018-28681`** success、Phase12 **45/0/0**。
- **丸数字設定改善（2026-07-08）**: GitHub Actions **`28910499400`** success、Pi5 + Pi4×5 deploy success、Phase12 **45/0/0**、ユーザー実機検証OK。
- **契約**: 保存 API は従来どおり絶対上下限。UI のみ符号付き offset 表示。
- **残課題**: キオスク検査図面作成画面の **図面表示面積**（ヘッダー・一覧・余白）。プレビュー: `docs/plans/kiosk-inspection-drawing-layout-preview.html`（HTML のみ・未実装）。
