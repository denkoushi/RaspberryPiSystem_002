# キオスク検査図面MVP ExecPlan

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

Maintained in accordance with `.agent/PLANS.md`.

## Purpose / Big Picture

キオスクで変換済み図面に測定点を置き、クリック入力と OK/NG 色分けまでを試せる MVP を、既存部品測定ドメインを壊さず並走追加する。完了後は Pi 実機で触り、次フェーズ（TIFF・順位ボード連携）を判断する。

## Progress

- [x] (2026-05-30) ブランチ `feat/kiosk-inspection-drawing-mvp` 作成・本 ExecPlan 初期化
- [x] (2026-05-30) Prisma / API / DTO 拡張（座標・上下限）— migration `20260530120000_part_measurement_template_item_inspection_marker`
- [x] (2026-05-30) 共通モジュール `features/part-measurement/inspection-drawing`
- [x] (2026-05-30) 評価用作成画面・`evaluation-sheets` / `evaluation-templates` API 隔離
- [x] (2026-05-30) 本番編集導線（`quantity===1` + 図面付きテンプレ → `inspection/edit`、通常 sheet API）
- [x] (2026-05-30) キオスクヘッダー独立タブ **「検査図面作成」**（`kioskInspectionDrawingRoutes.ts` + `KioskHeader`）
- [x] (2026-05-30) 単体テスト・Runbook/KB/deployment 補足・CI success（`26675704712` / `26676840821`）
- [x] (2026-05-30) **Pi5 本番先行**（`583aecad`）— 実機手動 OK・Phase12 **42/1/0**
- [x] (2026-05-30) 一覧ハブ移行（ブランチ `feat/inspection-drawing-library-hub` · **`ef78f4dd`**）
  - 専用 API: `GET/GET:id/POST:revise` under `/part-measurement/inspection-drawing/templates`
  - `KioskInspectionDrawingLibraryPage` · 履歴ダイアログ · 旧版 readOnly · 有効化後専用 GET 再読込
  - レビュー対応: 汎用 `GET /templates/:id` からの破壊的改版防止・一覧 fhincd 部分一致・要約 DTO
- [x] (2026-05-30) **Pi5 本番** 一覧ハブ — Detach `20260530-180728-7767` · Phase12 **42/1/0** · CI `26679994903`
- [x] (2026-05-30) **`main` マージ** — PR [#374](https://github.com/denkoushi/RaspberryPiSystem_002/pull/374) squash **`f0a2725c`**
- [x] (2026-05-30) **DEV プレビュー本番パリティ + UI 調整**（`feat/kiosk-inspection-drawing-preview-parity` · **`ccacef85`**）
  - `KioskLayout` 配下 DEV ルート · 共有 `InspectionDrawingLibraryFilterBar` / `InspectionDrawingPointSettingsPanel`
  - UI: フィルタ `flex-wrap` · 測定点縦並び · ツールバー「一覧へ戻る」 · 作成画面下部リンク削除
  - ADR: [ADR-20260530](../decisions/ADR-20260530-kiosk-inspection-drawing-dev-preview-parity.md)
- [x] (2026-05-30) **Pi5 本番** プレビュー parity — Detach `20260530-192609-10677` · CI `26681207121`
- [x] (2026-05-30) **一覧フィルタ overflow 修正**（`fix/kiosk-inspection-drawing-library-filter-overflow` · **`e19f9b07`**）
  - 共有 `InspectionDrawingResourceCdSelect` + `overflow-hidden` シェル（ネイティブ select の描画はみ出し）
  - 作成画面新規時の資源 select も共有化（metadata 幅 **10.5rem** 維持）
  - 単体: `inspectionDrawingBoundedSelectClasses.test.ts` · CI **`26683408296`**
- [x] (2026-05-30) **Pi5 本番** フィルタ overflow — Detach `20260530-212035-5804` · Phase12 **42/1/0** · **実機目視 OK**
- [x] (2026-05-30) **`main` マージ**（overflow 修正 + docs）— PR [#376](https://github.com/denkoushi/RaspberryPiSystem_002/pull/376) squash **`46ec0621`**
- [x] (2026-05-30) **キャンバスズーム UI**（`feat/kiosk-inspection-drawing-canvas-zoom` · **`364aa184`**）
  - ヘッダー `centerSlot` に `−` `＋` `□`（倍率表示なし）· キャンバス列の高さ維持
  - `useInspectionDrawingZoom` · `computeZoomedCanvasLayout`（ページ `scale` 禁止契約）
  - 配置: pointerup + 10px しきい値 · `pointercancel` は中止のみ
  - 単体: `inspectionDrawingCanvasLayout` / `inspectionDrawingCanvasPointer` / `inspectionDrawingZoom` · CI **`26684356891`**
- [x] (2026-05-30) **Pi5 本番** キャンバスズーム — Detach `20260530-221723-1575` · Phase12 **42/1/0** · **実機目視 OK**
- [ ] **`main` マージ**（キャンバスズーム + docs）— PR 作成後
- [ ] **Pi4×4 本番** — キャンバスズーム `main` マージ後に各キオスクへ順次（overflow 含む未反映分と合わせて推奨）
- [ ] **Pi5 実機目視** プレビュー parity UI — デプロイ済・目視記録は運用側（任意 Phase12）

## Surprises & Discoveries

- Observation: `features/inspection-drawing-lab` に Canvas・判定・座標変換が既存
  Evidence: `InspectionDrawingCanvas.tsx`, `evaluateMeasurement.ts`

- Observation: 図面編集は `PIECE_INDEX=0` 固定のため、本番 order（複数個）へ接続すると確定不能になる
  Evidence: レビュー指摘 [P1] → **数量1のみ**に本番自動遷移を限定（2026-05-30）

- Observation: MVP 初版は作成画面が **URL 直打ちのみ**で、現場から「タブがない」と報告
  Evidence: ExecPlan 当初「ハブボタンは出さない」+ 計画上の「専用タブ」未実装 → **ヘッダー独立タブ**で解消（`583aecad`）

- Observation: `createDraft` が `visualTemplate` を include しないと図面判定できず `quantity` 初期化されない
  Evidence: 本番導線テスト修正・`partMeasurementTemplateFullInclude` で解消（`45c02e0a`）

- Observation: `update-all-clients.sh` は **origin より ahead のローカル**を拒否する
  Evidence: Pi5 デプロイ開始時に push 必須メッセージ（2026-05-30 一覧ハブ）

- Observation: 汎用テンプレ GET + キオスク改版は、図面未対象テンプレや旧版で **意図しない改版**が起きうる
  Evidence: コードレビュー → 専用 `inspection-drawing/templates/*` + `reviseKioskInspectionDrawingTemplate`（`ef78f4dd`）

- Observation: DEV プレビューと本番のレイアウト差の主因は **`transform: scale` ではなく**、`KioskLayout` 外・全画面・**プレビュー専用 JSX 複製**
  Evidence: 2026-05-30 調査 → `ccacef85` で本番コンポーネント共有 + `KioskLayout` 配下 DEV ルートへ移行

- Observation: 一覧フィルタの `lg:grid-cols-[13rem_15rem_auto…]` は長い資源表示名で **工程列と視覚的に重なる**
  Evidence: 現場レイアウト指摘 → `InspectionDrawingLibraryFilterBar` で `flex-wrap`（`ccacef85`）

- Observation: `flex-wrap` 後も資源 `<select>` は **親幅を超えて overflow 描画**し、工程ボタン・履歴チェックと重なって見える（`gap` は効かない）
  Evidence: 2026-05-30 調査 → `InspectionDrawingResourceCdSelect` + `inspectionDrawingBoundedSelectShellClassName`（`e19f9b07`）

- Observation: 作成画面の資源 select を `w-fit` にすると品番等（10.5rem）と幅不一致になる
  Evidence: コードレビュー [P2] → `widthVariant=metadata` は `inspectionDrawingMetadataResourceFieldWidthClass`（`e19f9b07`）

- Observation: ズーム中の `touch-action: pan-x pan-y` と配置モードで **pointerdown 即追加**すると、パン開始位置に測定点が増える
  Evidence: タブレット実機・レビュー [P1] → pointerup + 10px しきい値（`364aa184`）

- Observation: `pointercancel` でも `onAddPoint` すると、ブラウザがパンを cancel したとき誤配置する
  Evidence: レビュー追補 → `handlePlacePointerCancel` は `clearPendingPlace` のみ（`364aa184`）

## Decision Log

- Decision: 新ドメインは作らず `PartMeasurementTemplateItem` を拡張し、UI は `/kiosk/part-measurement/inspection/*` で並走
  Rationale: 記録・図面配信・認可を再利用し、既存表形式 UI を維持
  Date/Author: 2026-05-30 / agent

- Decision: Phase1 評価用 **作成**はヘッダー **「検査図面作成」** タブ（部品測定タブとは別）。部品測定ハブ内サブナビは採用しない
  Rationale: ユーザー要望「部品測定タブ内ではなく新規タブ」。アクティブ状態は `isKioskPartMeasurementHubPath` / `isKioskInspectionDrawingPath` で分離
  Date/Author: 2026-05-30 / agent

- Decision: 本番 **編集**導線は `quantity===1` のみ（schedule / ハブ / 下書き / 確定 / template pick）
  Rationale: inspection 編集は `PIECE_INDEX=0` のみで複数個数 order が破綻する（レビュー [P1][P2]）
  Date/Author: 2026-05-30 / agent

- Decision: 評価保存は `__INSPECTION_DRAWING_EVAL__` バケット専用 API。通常 `POST /templates` は使わない
  Rationale: 通常 create は同キーの本番テンプレを非アクティブ化する（レビュー [P1] 評価保存）
  Date/Author: 2026-05-30 / agent

- Decision: 評価用は `GET /templates`・候補・clone・改版・退役から除外。保存は multipart 一括（失敗時ファイル削除）
  Rationale: 管理画面への混入と orphan 図面（レビュー [P2][P3]）
  Date/Author: 2026-05-30 / agent

- Decision: 実験用編集は `evaluation-sheets` 専用 API。評価用テンプレ由来・数量1のみ（URL 直打ちでも本番 sheet は 409）
  Rationale: inspection/edit が本番 1 個目を書き換え可能だった（レビュー [P2]）
  Date/Author: 2026-05-30 / agent

- Decision: 評価用 PATCH body は Zod で `quantity: 1`・`pieceIndex: 0` のみ。正規化後に通常 patch へ渡す
  Rationale: 評価用 API 直叩きで quantity/pieceIndex 制約を破れる（レビュー [P2]）
  Date/Author: 2026-05-30 / agent

- Decision: Phase1 は PNG/JPEG/WebP のみ（TIFF 後回し）
  Rationale: 既存 `PartMeasurementDrawingStorage` 制約と Pi4 負荷
  Date/Author: 2026-05-30 / agent

- Decision: キオスク検査図面の **一覧・取得・改版**は `/part-measurement/inspection-drawing/templates*` に限定。`THREE_KEY` + 図面 + 全マーカー/上下限のみ
  Rationale: 汎用 API では対象外テンプレの改版・一覧の過大 payload・fhincd 完全一致が現場とずれる
  Date/Author: 2026-05-30 / agent（`ef78f4dd`）

- Decision: 新規作成は引き続き `POST /part-measurement/templates`（multipart・図面必須）。編集キー（品番/資源/工程）は UI 表示専用
  Rationale: 既存 create フローと visual アップロードを再利用。改版は `reviseActiveTemplate` で版管理
  Date/Author: 2026-05-30 / agent

- Decision: 検査図面のレイアウト調整用 DEV プレビューは **本番と同じコンポーネント + `KioskLayout`**。scale や JSX 複製は使わない
  Rationale: 修正指示が出せないズレの根本原因がレンダリング契約だった（[ADR-20260530](../decisions/ADR-20260530-kiosk-inspection-drawing-dev-preview-parity.md)）
  Date/Author: 2026-05-30 / agent

- Decision: 一覧フィルタは **flex-wrap**、測定点は **縦並び**、作成ツールバーに **「一覧へ戻る」**（`libraryTo`）
  Rationale: 現場フィードバック・プレビュー/本番の単一コンポーネント化
  Date/Author: 2026-05-30 / agent

- Decision: 資源 `<select>` は **`InspectionDrawingResourceCdSelect`** で包み、外側に **`overflow-hidden` シェル**を付ける。`truncate` のみでは不十分
  Rationale: ネイティブ select は flex 子の box 幅を超えて描画される（[KB-320 §overflow](../knowledge-base/KB-320-kiosk-part-measurement.md#検査図面-library-filter-overflow-2026-05-30)）
  Date/Author: 2026-05-30 / agent

- Decision: 図面ズームは **ヘッダー `centerSlot`**（`−` `＋` `□` のみ）。キャンバス上にツールバー行を足さない。倍率は **0.5〜2.5 / 刻み 0.25**、座標は **ratio のまま**
  Rationale: 図面表示領域の高さを減らさない現場要望。ADR のページ `transform: scale` 禁止に合わせレイアウト寸法でスケール
  Date/Author: 2026-05-30 / agent

- Decision: 配置モードの確定は **pointerup** と **移動量 &lt; 10px**。`pointercancel` は **pending 解除のみ**
  Rationale: ズーム後パンとタップ配置の競合（レビュー [P1]）
  Date/Author: 2026-05-30 / agent

## Outcomes & Retrospective

- **評価用作成（互換）**: `/kiosk/part-measurement/inspection/create` は残置。評価用 API は UI 主導線から外した。
- **一覧ハブ**: ヘッダー **「検査図面」** → 一覧 → 新規/編集/履歴。専用 API + 要約 DTO。旧版は閲覧専用・有効化後に再取得。
- **本番編集（数量1のみ）**: 変更なし（`inspection/edit` + 通常 sheet API）。
- **隔離**: 評価用バケットと **409** 相互ブロックは維持。
- **デプロイ**: Pi5 で MVP 導線・タブ・一覧ハブ・**プレビュー parity（`ccacef85`）**・**フィルタ overflow（`e19f9b07`）**・**キャンバスズーム（`364aa184`）** まで反映。**Pi4×4 は `main` マージ後の次タスク**（parity + overflow + ズーム）。
- **DEV プレビュー**: `/dev/kiosk-inspection-drawing-*` で本番コンポーネントを Mac 上で反復可能（fixture）。
- **未着手**: 複数個数図面UI、TIFF、順位ボード連携、Phase12 への専用 API スモーク追加（任意）。

## 代表コミット

| SHA | ブランチ | 概要 |
|-----|----------|------|
| `caff87b1` | `feat/kiosk-inspection-drawing-mvp` | 評価用 MVP 隔離 |
| `45c02e0a` | 同上 | 本番 quantity=1 図面 edit |
| `583aecad` | 同上 | ヘッダー独立タブ |
| `ef78f4dd` | `feat/inspection-drawing-library-hub` | 一覧ハブ・専用 API・履歴 UI |
| `ccacef85` | `feat/kiosk-inspection-drawing-preview-parity` | DEV 本番パリティ・共有 UI コンポーネント |
| `e19f9b07` | `fix/kiosk-inspection-drawing-library-filter-overflow` | 資源 select overflow クリップ・共有 select |
| `46ec0621` | `main`（PR #376 squash） | 上記 + docs マージ |
| `364aa184` | `feat/kiosk-inspection-drawing-canvas-zoom` | キャンバスズーム UI・配置ポインタ契約 |

## 主要ファイル（後続読者向け）

| 領域 | パス |
|------|------|
| ヘッダー導線 | `apps/web/src/components/kiosk/KioskHeader.tsx` |
| ルート判定 | `apps/web/src/features/part-measurement/inspection-drawing/kioskInspectionDrawingRoutes.ts` |
| 本番分岐 | `productionInspectionDrawingPolicy.ts` / `kioskPartMeasurementSheetNavigation.ts` |
| API 方針 | `apps/api/src/services/part-measurement/part-measurement-inspection-drawing-policy.ts` |
| 評価アクセス | `evaluationSheetAccess.ts`（Web） |
| 一覧 UI | `KioskInspectionDrawingLibraryPage.tsx` |
| 一覧フィルタ（共有） | `InspectionDrawingLibraryFilterBar.tsx` |
| 資源 select（共有） | `InspectionDrawingResourceCdSelect.tsx` · `inspectionDrawingKioskUi.ts` |
| 作成/テンプレ編集 UI | `KioskInspectionDrawingCreatePage.tsx` |
| 測定点パネル（共有） | `InspectionDrawingPointSettingsPanel.tsx` |
| DEV プレビュー | `pages/dev/KioskInspectionDrawing*PreviewPage.tsx` · `KioskInspectionDrawingDevPreviewChrome.tsx` |
| 記録図面編集 UI | `KioskInspectionDrawingEditPage.tsx` |
| キャンバスズーム | `useInspectionDrawingZoom.ts` · `InspectionDrawingCanvasZoomControls.tsx` · `inspectionDrawingCanvasLayout.ts` |
| テンプレサービス | `part-measurement-template.service.ts`（`list/get/reviseKioskInspectionDrawing*`） |

## Context and Orientation

既存キオスク部品測定は `apps/web/src/pages/kiosk/KioskPartMeasurement*.tsx` と `apps/api/src/routes/part-measurement/index.ts`。図面は `PartMeasurementVisualTemplate` + Blob 取得。

## Plan of Work

（親計画 `inspection_drawing_mvp` と同一。本ファイルは実装進捗の正本）

## Validation and Acceptance

- 単体: `evaluateMeasurement` / `kioskInspectionDrawingRoutes` / `productionInspectionDrawingPolicy` / `kioskPartMeasurementSheetNavigation`
- 統合: `part-measurement.integration.test.ts`（policy・evaluation 隔離・blank 削除）
- 自動実機: `./scripts/deploy/verify-phase12-real.sh`（部品測定スモーク含む）
- 手動（Pi5・一覧ハブ）: **検査図面** → 一覧 → 新規/編集/履歴。旧版 readOnly・有効化→編集可
- 手動（Pi5・UI parity）: フィルタ折り返し・測定点縦並び・「一覧へ戻る」・下部リンクなし（`ccacef85` 以降）
- 手動（Pi5・フィルタ overflow）: 資源 select が工程・履歴と重ならない・「履歴を含む」全文（`e19f9b07` 以降 · Pi5 実機 OK）
- 手動（Pi5・キャンバスズーム）: ヘッダー `−` `＋` `□` · 拡大パンで点が増えない · `□` フィット（`364aa184` 以降 · Pi5 実機 OK）
- 手動（Mac DEV）: `/dev/kiosk-inspection-drawing-library` · `/dev/kiosk-inspection-drawing-create`（本番コンポーネント・fixture）
- 手動（Pi5・記録）: 本番図面テンプレ + 数量1 → 図面 edit
- 手動（Pi4 未）: `main` 反映後、各キオスクで同確認（強制リロード §6.6.4）
