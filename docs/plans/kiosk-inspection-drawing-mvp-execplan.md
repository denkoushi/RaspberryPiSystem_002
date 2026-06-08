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
- [x] (2026-05-30) **`main` マージ**（キャンバスズーム + docs）— PR [#377](https://github.com/denkoushi/RaspberryPiSystem_002/pull/377) squash **`e42aff35`**
- [x] (2026-05-31) **テンプレ編集・認可付き図面読込**（`fix/kiosk-inspection-drawing-edit-image-load` · **`e12a5a9c`**）
  - `usePartMeasurementDrawingBlobUrl` + `inspectionDrawingTemplateImageDisplay`（ローカル優先・読込エラー UI）
  - フック: path 変更時 blob 即クリア（テンプレ切替の旧図面残り防止）
  - **Pi5 デプロイ**: `20260531-092334-26185` · **実機: 一覧→編集で図面表示 OK**
  - CI: **`26698822834`** success
- [x] (2026-05-31) **キャンバスズーム痙攣修正**（同一ブランチ · **`f6a9544a`**）
  - `useZoomedCanvasLayout` · `areZoomedCanvasLayoutsEqual` · `scrollbar-gutter: stable` · `minWidth/minHeight: 100%` 削除
  - **実機: 拡大2回目（1.5）の震え解消 OK**（Pi5 · 2026-05-31）
  - CI: **`26700061664`** success
- [x] (2026-05-31) **`main` マージ** — PR [#378](https://github.com/denkoushi/RaspberryPiSystem_002/pull/378) squash **`19112272`**
- [x] (2026-06-02) **PDF 取込基盤**（`feat/inspection-drawing-pdf-import` · **`12072afa`**）
  - `importDrawingAndSave` · poppler `pdftoppm` · 30MB PDF / 12MB 保存上限 · semaphore（同時1・待ち4）
- [x] (2026-06-02) **PDF プレビュー整合**（同一ブランチ · **`8307c995`**）
  - `POST /api/part-measurement/drawings/preview`（副作用なし）
  - `usePartMeasurementDrawingLocalPreview` · 保存時同一 JPEG File 再利用
  - レビュー: abort レース · 失敗時 pending 解除 · unmount cleanup · デバッグ fetch 撤去
  - 単体/統合テスト追加 · CI **`26812045529`** success
- [x] (2026-06-02) **Pi5 本番** PDF プレビュー — Detach **`20260602-190538-1780`** · Phase12 **41/1/1** · **実機目視 OK**
- [x] (2026-06-02) **`main` マージ** — PR [#382](https://github.com/denkoushi/RaspberryPiSystem_002/pull/382) squash **`a3ce2284`**
- [x] (2026-06-08) **図面ライブラリ（visual library）** — ブランチ `feat/kiosk-inspection-drawing-visual-library` · **`127d2d4a`**
  - 一覧ハブ上部に **図面ライブラリ** セクション（`KioskInspectionDrawingVisualLibrarySection`）
  - 図面のみ登録（`KioskInspectionDrawingVisualUploadModal`）→ ライブラリから **新規検査図面作成**（`kioskInspectionDrawingCreatePathWithVisual`）
  - API: `GET /part-measurement/visual-templates`（`q` / `limit` / `sort`）· 検索 debounce **400ms** · 上限 **40** · 並び **`recentlyUpdated`**
  - 作成画面: `?visualId=` 深リンク・最近アップロードの再解決・戻り先 `returnTo=library`
  - 単体/統合: `inspectionDrawingVisualLibrary*` · `part-measurement.integration.test.ts`（visual 一覧・deep link）
- [x] (2026-06-08) **一覧レイアウト密度改善** — 同一ブランチ · **`38b7583f`**
  - 図面ライブラリ: **5列グリッド** · 検索欄をタイトル行右（`w-1/5` · placeholder **「図面名で検索」**）
  - テンプレート一覧: **`InspectionDrawingLibraryTemplateGrid`** コンパクト **4列** カード
  - 説明文 `<p>` 削除（ページヘッダー・図面ライブラリ内）
  - DEV プレビュー: `inspectionDrawingPreviewFixtures` モック10件 · `/dev/kiosk-inspection-drawing-library`
  - レビュー: `useInspectionDrawingVisualLibrary` に **`enabled: false`**（`previewVisuals` 時は API 呼び出しなし）
- [x] (2026-06-08) **Pi5 本番** 図面ライブラリ + 密度改善 — Detach **`20260608-153118-7422`**（`127d2d4a..38b7583f` · Docker rebuild）· Phase12 **43/0/0** · CI **`27119651752`** · **実機目視 OK**
- [x] (2026-06-08) **図面ライブラリ密度調整（第2弾）** — ブランチ `fix/kiosk-inspection-drawing-library-density-tuning` · **`ddc3ce8b`**
  - ヘッダー重複 **「図面を登録」** 削除（登録導線は Section 内に一本化）
  - 検索欄: **20% wrapper** + 白背景 **`text-slate-900`** · タイトル行で **再読込 / 図面を登録** を検索右隣に配置
  - 図面ライブラリ: **6列グリッド**（`lg:grid-cols-6`）· fixture コメント更新
  - API/hook/modal は変更なし · DEV preview は共有 Section 経由（`min-w-[1280px]` chrome 前提）
  - **Mac DEV 目視 OK** · **Pi5 本番** Detach **`20260608-164812-2511`** · Phase12 **43/0/0** · CI **`27122345564`** · **Pi5 実機目視 OK**
  - Web バンドル（`docker-web-1`）: `/srv/site/assets/index-i9Bqvljz.js` — `grid-cols-6` · 「図面を登録」**3件**（モーダル+Section、ヘッダー重複なし）
- [ ] **Pi4×4 本番** — visual library + 密度改善（第1弾 `38b7583f` + 第2弾 `ddc3ce8b`）を順次（`raspi4-kensaku-stonebase01` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` · Pi3 除外 · 各台強制リロード §6.6.4）
- [ ] **Pi4×4 本番（旧積み残し）** — MVP 以降の parity / overflow / ズーム / 図面読込 / PDF preview が未反映の端末があれば同手順で一括

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

- Observation: テンプレ編集だけ `drawingImageRelativePath` を `<img src>` 直指定すると storage 401 で図面が空白になる（記録編集は Blob 経由で正常）
  Evidence: 2026-05-31 調査 → `e12a5a9c` で `inspectionDrawingTemplateImageDisplay` + 共有フックに統一

- Observation: ズーム `＋` 2回目（倍率 1.5）で `ResizeObserver` とスクロールバーの client 寸法揺れが連鎖し図面が震える。Blob 読込修正とは別ファイル
  Evidence: 実機報告 + コードレビュー → `f6a9544a`（`useZoomedCanvasLayout` + 等価比較 + `scrollbar-gutter: stable`）

- Observation: 新規フック3ファイルを `git add -u` だけでコミットすると CI が import 解決失敗する
  Evidence: レビュー [P1] 2026-05-31 → 必ず `useZoomedCanvasLayout.ts` 等を同コミットに含める

- Observation: PDF Blob を Canvas `<img>` に直接渡すと **プレビュー空白**になり、save 経路（`pdftoppm`→JPEG）と表示ラスタが不一致で **座標ずれ**する
  Evidence: 2026-06-02 調査 → `8307c995` で preview API + 同一 JPEG File 再利用

- Observation: PDF preview 失敗後に `hasPendingLocalSelection` が true のままだと **保存が永久ブロック**される
  Evidence: コードレビュー → 失敗パスで pending 解除 + CreatePage で previewError 時 ref リセット（`8307c995`）

- Observation: ファイル差し替え連打で abort 済みリクエストの成功コールバックが後から走ると **古い preview が勝つ**
  Evidence: レビュー → 成功パスでも `controller.signal.aborted` を確認（`8307c995`）

- Observation: Pi5 上で `curl http://127.0.0.1:3000/api/system/health` が **000** でも、Tailscale **`https://100.106.158.2/api/...`** は正常（Caddy 経由）
  Evidence: 2026-06-02 デプロイ後検証 — SSH localhost 直は本番構成では使わない

- Observation: DEV プレビューで `previewVisuals` を渡しても hook が `enabled` 既定 true だと **不要な visual-templates API** が走る
  Evidence: コードレビュー 2026-06-08 → `enabled: !isPreview` + `useInspectionDrawingVisualLibrary.test.ts`（`38b7583f`）

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

- Decision: Phase1 は PNG/JPEG/WebP に加え **PDF（1ページ目→JPEG）** を preview API + save で同一ラスタ契約（TIFF 後回し）
  Rationale: 保存前プレビュー空白を解消し、座標ずれを防ぐ。Canvas は常に画像 URL
  Date/Author: 2026-06-02 / agent

- Decision: PDF 保存前プレビューは `POST /api/part-measurement/drawings/preview`（副作用なし・rate limit 有効）。Web は `usePartMeasurementDrawingLocalPreview` で AbortController 競合制御
  Rationale: フロント専用 PDF 描画を持たず、API 変換経路を save と共有
  Date/Author: 2026-06-02 / agent

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

- Decision: **図面ライブラリ**は既存 **`PartMeasurementVisualTemplate`** + **`GET /part-measurement/visual-templates`** を再利用。業務テンプレ（THREE_KEY）なしで図面だけ登録し、ライブラリから検査図面作成へ遷移
  Rationale: 図面資産と業務テンプレの境界を分離し、既存 Blob 配信・認可を流用
  Date/Author: 2026-06-08 / agent

- Decision: 一覧ハブの密度 — 図面ライブラリ **5列** · テンプレート **4列コンパクト** · 検索は各セクション **タイトル行内**（説明文 `<p>` は削除）
  Rationale: キオスク実機で一覧性不足。余白削減で同一画面に更多表示
  Date/Author: 2026-06-08 / agent

- Decision: 図面ライブラリ密度調整（第2弾）— visual **6列**（`lg+`）· 登録ボタンは Section 内のみ · 検索は **20% wrapper** 内の白背景 Input · 幅は `Input` の `w-full` 競合を避ける
  Rationale: 実機で検索視認性・重複導線・一覧密度の追加改善。共有 `Input` への `!w-*` 上書きより wrapper で境界を閉じる
  Date/Author: 2026-06-08 / agent

## Outcomes & Retrospective

- **評価用作成（互換）**: `/kiosk/part-measurement/inspection/create` は残置。評価用 API は UI 主導線から外した。
- **一覧ハブ**: ヘッダー **「検査図面」** → 一覧 → 新規/編集/履歴。専用 API + 要約 DTO。旧版は閲覧専用・有効化後に再取得。
- **本番編集（数量1のみ）**: 変更なし（`inspection/edit` + 通常 sheet API）。
- **隔離**: 評価用バケットと **409** 相互ブロックは維持。
- **デプロイ**: Pi5 で MVP 導線・タブ・一覧ハブ・**プレビュー parity（`ccacef85`）**・**フィルタ overflow（`e19f9b07`）**・**キャンバスズーム（`364aa184`）**・**図面読込/ズーム痙攣（`e12a5a9c`/`f6a9544a`）**・**PDF プレビュー整合（`8307c995`）** まで反映。**Pi4×4 は `main` マージ後の次タスク**。
- **PDF プレビュー（2026-06-02）**: Pi5 Detach `20260602-190538-1780` · キオスク目視 OK · preview API は副作用なし JPEG 契約で save と座標一致。
- **DEV プレビュー**: `/dev/kiosk-inspection-drawing-*` で本番コンポーネントを Mac 上で反復可能（fixture）。
- **図面ライブラリ（2026-06-08）**: Pi5 で **standalone visual 登録 → ライブラリ → 新規作成** 導線 + **5列/4列** 密度レイアウトまで反映。**Pi4×4 は未**。
- **図面ライブラリ密度調整（第2弾 · 2026-06-08）**: **6列**・検索 wrapper・登録導線一本化 — **`ddc3ce8b`**。**Pi5 本番・実機目視 OK**。**Pi4×4 は未**（`main` マージ後に `--limit` 順次）。
- **未着手**: 複数個数図面UI、TIFF、順位ボード連携、Phase12 への専用 visual-library スモーク追加（任意）。

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
| `e42aff35` | `main`（PR #377 squash） | 上記 + docs マージ |
| `12072afa` | `feat/inspection-drawing-pdf-import` | PDF 取込基盤（pdftoppm・上限・semaphore） |
| `8307c995` | 同上 | PDF preview API + Web 同一 JPEG 契約 |
| `127d2d4a` | `feat/kiosk-inspection-drawing-visual-library` | 図面ライブラリ・visual 登録・deep link |
| `38b7583f` | 同上 | 5列/4列密度レイアウト・preview `enabled: false` |
| `ddc3ce8b` | `fix/kiosk-inspection-drawing-library-density-tuning` | 図面ライブラリ 6列・検索 wrapper・登録導線一本化 |

## 主要ファイル（後続読者向け）

| 領域 | パス |
|------|------|
| ヘッダー導線 | `apps/web/src/components/kiosk/KioskHeader.tsx` |
| ルート判定 | `apps/web/src/features/part-measurement/inspection-drawing/kioskInspectionDrawingRoutes.ts` |
| 本番分岐 | `productionInspectionDrawingPolicy.ts` / `kioskPartMeasurementSheetNavigation.ts` |
| API 方針 | `apps/api/src/services/part-measurement/part-measurement-inspection-drawing-policy.ts` |
| 評価アクセス | `evaluationSheetAccess.ts`（Web） |
| 一覧 UI | `KioskInspectionDrawingLibraryPage.tsx` |
| 図面ライブラリ UI | `KioskInspectionDrawingVisualLibrarySection.tsx` · `KioskInspectionDrawingVisualUploadModal.tsx` |
| 図面ライブラリ hook | `useInspectionDrawingVisualLibrary.ts` · `inspectionDrawingVisualLibraryConstants.ts` |
| テンプレ4列グリッド | `InspectionDrawingLibraryTemplateGrid.tsx` |
| visual API | `part-measurement-visual-template.service.ts` · `GET …/visual-templates` |
| 一覧フィルタ（共有） | `InspectionDrawingLibraryFilterBar.tsx` |
| 資源 select（共有） | `InspectionDrawingResourceCdSelect.tsx` · `inspectionDrawingKioskUi.ts` |
| 作成/テンプレ編集 UI | `KioskInspectionDrawingCreatePage.tsx` |
| 測定点パネル（共有） | `InspectionDrawingPointSettingsPanel.tsx` |
| DEV プレビュー | `pages/dev/KioskInspectionDrawing*PreviewPage.tsx` · `KioskInspectionDrawingDevPreviewChrome.tsx` |
| 記録図面編集 UI | `KioskInspectionDrawingEditPage.tsx` |
| キャンバスズーム | `useInspectionDrawingZoom.ts` · `InspectionDrawingCanvasZoomControls.tsx` · `inspectionDrawingCanvasLayout.ts` |
| テンプレサービス | `part-measurement-template.service.ts`（`list/get/reviseKioskInspectionDrawing*`） |
| PDF preview API | `part-measurement-drawing-preview.ts` · `POST …/drawings/preview` |
| Web PDF preview | `usePartMeasurementDrawingLocalPreview.ts` · `partMeasurementDrawingLocalPreview.ts` |

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
- 手動（Pi5・PDF プレビュー）: 作成/編集で PDF 選択 → JPEG 表示 · 変換中保存不可 · 保存→再読込で座標一致（`8307c995` 以降 · **2026-06-02 目視 OK**）
- 手動（Pi5・図面ライブラリ）: **検査図面** → 図面ライブラリ **5列** · 検索「図面名で検索」· 図面登録 → ライブラリから新規作成 · テンプレ **4列**（`38b7583f` 以降 · **2026-06-08 目視 OK**）
- 手動（Mac DEV・密度調整第2弾）: `/dev/kiosk-inspection-drawing-library` で **1280px 前提**（`KioskInspectionDrawingDevPreviewChrome` の `min-w-[1280px]` により viewport を狭めても中身は 1280px 相当）· 図面ライブラリ **6列**（`lg` 有効）· 検索黒文字・**20% wrapper** · ヘッダーに「図面を登録」なし · Section 内に再読込/登録 · カード/ボタンはみ出しなし · 検索絞り込み動作
- 手動（Pi5・密度調整第2弾）: 図面ライブラリ **6列** · 検索黒文字 · ヘッダーに「図面を登録」なし · Section 内に再読込/登録1つ · はみ出しなし · 検索絞り込み（**2026-06-08 実機 OK**）
- 手動（Mac DEV）: `/dev/kiosk-inspection-drawing-library`（fixture 10件・API 無しプレビュー · **1280px 前提**）
- 手動（Pi4 未）: visual library + 密度改善（第1+第2弾）を `main` 反映後に各キオスクで同確認（強制リロード [verification-checklist §6.6.4](../guides/verification-checklist.md)）
