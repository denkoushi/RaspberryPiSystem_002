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
- [ ] (2026-06-09) **図面ライブラリ名称変更 + テンプレ図面名検索 + 自主検査自動切替** — ブランチ `feat/kiosk-inspection-drawing-trio`（Mac 実装完了・未コミット）
  - `PATCH /visual-templates/:id`（name のみ）· `KioskInspectionDrawingVisualRenameModal`
  - `GET …/inspection-drawing/templates?visualName=` · `InspectionDrawingLibraryFilterBar`
  - 自主検査: `placeholderData` · `draftBoundKey` · 保存後次 slot 自動切替 · entry 単位 guided priming
- [x] (2026-07-01) **Pi4/Pi3 fleet 本番** — sibling group ブランチの全台デプロイで、visual library + 密度改善、parity / overflow / ズーム / 図面読込 / PDF preview の旧積み残しも現行 bundle へ収束（Deploy `20260701-183748-11286` · failed=0）
- [x] (2026-07-01) **検査図面 複数資源兄弟グループ** — ブランチ `feat/inspection-drawing-sibling-groups` · commit `580324b5`
  - 仕様: 1テンプレに複数資源を持たせず、資源CD別 `PartMeasurementTemplate` を `PartMeasurementTemplateSiblingGroup` で束ねる。個別改版は `detachFromSiblingGroup: true` でグループから外す。
  - UI: 新規作成の資源CD複数選択、`visualTemplate.name + 品番` のテンプレ名自動提案、保存条件 disabled、グループまとめて改版/個別改版、保存済み最新版からの資源追加、一覧のグループ1カード集約。
  - 検証: GitHub Actions `28507352316` success、全台デプロイ `20260701-183748-11286` exit 0、Phase12 実機検証 PASS 45 / WARN 0 / FAIL 0、読み取りスモーク `GET /inspection-drawing/templates` 200 と `GET /visual-templates?sort=recentlyUpdated&limit=5` 200。
  - 詳細な設計判断は [ADR-20260701](../decisions/ADR-20260701-part-measurement-template-sibling-groups.md)。この Plan は次回再開用の状態正本。
- [x] (2026-07-01) **検査図面テンプレートペイン UX/密度改善** — ブランチ `fix/inspection-drawing-template-pane-layout` · commit `b11e64ff`
  - 仕様: テンプレート検索を手動「更新」から、品番/図面名 400ms debounce・資源CD/工程/履歴即時反映の自動検索へ変更。ボタンは現在条件の `再読込` と、条件初期化の `リセット` に分離。
  - 実装: `useInspectionDrawingTemplateLibrary` を追加し、検索条件・リクエスト順序ガード・リセット/再読込をページから分離。テンプレートペインは見出しカードを廃止し、フィルタと一覧余白を圧縮。
  - UI: 資源CD chip は横一列 + `+N` 省略、`測定点 / 更新 / 図面` は1行メタ情報、図面名は `truncate` + `title`、カード縦幅を圧縮し、`編集` / `帳票` / `雛形新規` / `履歴` は外寸維持でフォントを拡大。
  - 検証: GitHub Actions `28514390128` success、全台デプロイ `20260701-204628-31038` 後に Pi3 限定再デプロイ `20260701-212100-29479` success、Phase12 実機検証 PASS 45 / WARN 0 / FAIL 0、実機画面 `/kiosk/part-measurement/inspection` でユーザー目視 OK。
- [x] (2026-07-01) **図面ライブラリ/テンプレート一覧 表形式化** — ブランチ `fix/inspection-drawing-table-panes` · commit `2a6db097`
  - 仕様: 図面ライブラリと検査図面テンプレートをカードからサムネイルなしのコンパクト表へ変更。ペインは内容幅ベースで横並び、横幅いっぱいには伸ばさない。
  - UI: 図面ライブラリは `図面名 / 更新 / 操作`、テンプレートは `品番 / 図面名 / 資源CD / 工程 / 点 / 更新 / 操作`。行内操作は `新規` / `名称` / `雛形` の短縮ラベルにし、意味は `title` で補足。
  - 検証: Web targeted tests **11 PASS**、`pnpm --filter @raspi-system/web build` PASS、`pnpm --filter @raspi-system/web lint` PASS、Mac DEV `/dev/kiosk-inspection-drawing-library` 1280px screenshot OK、GitHub Actions `28520681342` success。
  - 本番: 全台デプロイ `20260701-223712-23737` success / failed=0、Pi5 HEAD `2a6db097`、Phase12 実機検証 PASS 45 / WARN 0 / FAIL 0。
- [x] (2026-07-02) **検査図面一覧 2表・1.5行密度改善** — ブランチ `fix/inspection-drawing-two-table-density`（Web-only）
  - 仕様: 図面ライブラリ表は縦方向に画面下まで伸ばし、テンプレート一覧は単一横長表をやめて左右2表に分割。各テンプレートは上段 `品番 / 図面名 / 工程 / 点 / 更新`、下段 `資源CD` chip + `編集 / 帳票 / 雛形 / 履歴` の1.5行表示にする。
  - UI: 品番列は本体最大10桁 + 追番を想定して幅を確保。複数資源CDは最大4 chip + `+N` 省略。下段4ボタンは更新時刻の右端に揃え、図面ライブラリ側は図面名列を優先する。
  - 検証: Web targeted tests **12 PASS**、`pnpm --filter @raspi-system/web build` PASS、`pnpm --filter @raspi-system/web lint` PASS、Mac DEV `/dev/kiosk-inspection-drawing-library` 2048x1108 で2表・縦伸長・右端揃え・横 overflow なしを確認。
- [ ] (2026-07-01) **残り手動確認** — 本番DBを書き換える一括作成/まとめて改版/資源追加は実機で未実行。次回は検証用データまたは明示許可のある品番・資源CDで、作成→まとめて改版→個別分離→資源追加を画面操作で確認する。

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

- Observation: 複数資源を1テンプレ配列にすると、記録表・自主検査の資源CD単位解決と履歴管理を広範囲に変える
  Evidence: 2026-07-01 実装前調査 → `PartMeasurementTemplateSiblingGroup` で資源別テンプレを束ねる方針を採用（ADR-20260701）

- Observation: 図面ライブラリ表示名は `visualTemplates` 配列で返る。実機では `7161テーブル` などの表示名を取得でき、テンプレ名サジェストの入力源として使える
  Evidence: 2026-07-01 実機読み取りスモーク `GET /api/part-measurement/visual-templates?sort=recentlyUpdated&limit=5` → 200

- Observation: テンプレートペインの旧 `更新` は検索実行ボタンとして見え、図面ライブラリ側の入力連動検索と同一画面内で UX が不一致になる
  Evidence: 2026-07-01 実機フィードバック → `useInspectionDrawingTemplateLibrary` で自動検索 + `再読込` + `リセット` に分離（`b11e64ff`）

- Observation: 本番 bundle では DEV ルート `/dev/kiosk-inspection-drawing-library` は実機確認に使わず、実機目視は `/kiosk/part-measurement/inspection` で行う。本文検索で `更新` を探すとカードの更新日時メタ情報にも一致するため、旧ボタン確認は exact role name で見る
  Evidence: 2026-07-01 Playwright 実機スモーク。`button[name="更新"]` は 0、`再読込` は存在、`リセット` は条件なしで disabled・条件入力後 enabled・リセット後 disabled

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

- Decision: 検査図面の複数資源対応は **資源CD別テンプレ + 兄弟グループ**。グループ改版は現在 active なメンバーのみ、個別改版はグループから外す
  Rationale: `fhincd + processGroup + resourceCd + version` の既存正本キー、記録表・自主検査の資源CD単位解決、既存単一資源テンプレ互換を維持するため
  Date/Author: 2026-07-01 / agent（[ADR-20260701](../decisions/ADR-20260701-part-measurement-template-sibling-groups.md)）

- Decision: テンプレートペイン検索は **自動検索 + `再読込` + `リセット`** とし、図面ライブラリ検索と操作モデルを揃える。`再読込` は検索実行ではなく、現在条件の再取得だけを担う
  Rationale: 検索条件変更後に `更新` を押さないと反映されない UX は、同一画面内の図面ライブラリ検索と不整合。リセットがないとキオスクで条件解除の手数が多い
  Date/Author: 2026-07-01 / agent（`b11e64ff`）

- Decision: 図面ライブラリと検査図面テンプレートの一覧は **カードではなく表形式**。サムネイルは表示しない
  Rationale: 図面名・品番・資源CD・更新日時を比較して探す画面であり、カード余白と大きいボタンが一覧性を下げていたため
  Date/Author: 2026-07-01 / agent

- Decision: 検査図面テンプレート一覧は、広いキオスク幅では **左右2表 + 1.5行** で表示する。単一横長表にはしない
  Rationale: 今後テンプレート件数が増える前提では、横長1表より左右2表の方が1画面同時表示件数を増やせる。資源CDと操作ボタンを下段へ逃がすことで、品番・図面名・更新日時の見切れも抑えられるため
  Date/Author: 2026-07-02 / agent

## Outcomes & Retrospective

- **評価用作成（互換）**: `/kiosk/part-measurement/inspection/create` は残置。評価用 API は UI 主導線から外した。
- **一覧ハブ**: ヘッダー **「検査図面」** → 一覧 → 新規/編集/履歴。専用 API + 要約 DTO。旧版は閲覧専用・有効化後に再取得。
- **本番編集（数量1のみ）**: 変更なし（`inspection/edit` + 通常 sheet API）。
- **隔離**: 評価用バケットと **409** 相互ブロックは維持。
- **デプロイ**: Pi5 で MVP 導線・タブ・一覧ハブ・**プレビュー parity（`ccacef85`）**・**フィルタ overflow（`e19f9b07`）**・**キャンバスズーム（`364aa184`）**・**図面読込/ズーム痙攣（`e12a5a9c`/`f6a9544a`）**・**PDF プレビュー整合（`8307c995`）** まで反映。**Pi4×4 は `main` マージ後の次タスク**。
- **PDF プレビュー（2026-06-02）**: Pi5 Detach `20260602-190538-1780` · キオスク目視 OK · preview API は副作用なし JPEG 契約で save と座標一致。
- **DEV プレビュー**: `/dev/kiosk-inspection-drawing-*` で本番コンポーネントを Mac 上で反復可能（fixture）。
- **図面ライブラリ（2026-06-08）**: Pi5 で **standalone visual 登録 → ライブラリ → 新規作成** 導線 + **5列/4列** 密度レイアウトまで反映。当時 Pi4×4 は未、2026-07-01 の全台デプロイで現行 branch へ収束。
- **図面ライブラリ密度調整（第2弾 · 2026-06-08）**: **6列**・検索 wrapper・登録導線一本化 — **`ddc3ce8b`**。**Pi5 本番・実機目視 OK**。当時 Pi4×4 は未、2026-07-01 の全台デプロイで現行 branch へ収束。
- **複数資源兄弟グループ（2026-07-01）**: `feat/inspection-drawing-sibling-groups` · `580324b5` を全台デプロイ。既存DB/既存コンテナはローカル検証で変更せず、一時 Postgres で migration / integration / EXPLAIN を確認。実機では読み取りスモークまで実施し、本番データを書き換える一括作成系の画面操作は未実施。
- **テンプレートペイン UX/密度改善（2026-07-01）**: `fix/inspection-drawing-template-pane-layout` · `b11e64ff` を全台デプロイ。テンプレート検索は自動検索 + `再読込` + `リセット`、カードは資源chip横一列・1行メタ情報・フォント拡大ボタンへ圧縮。実機 `/kiosk/part-measurement/inspection` で目視 OK。
- **図面ライブラリ/テンプレート一覧 表形式化（2026-07-01）**: `fix/inspection-drawing-table-panes` · `2a6db097` でカードを廃止し、両ペインを内容幅ベースのコンパクト表に変更。API/DB契約は変更なし。CI `28520681342` success、全台デプロイ `20260701-223712-23737` failed=0、Phase12 **45/0/0**。
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
| `580324b5` | `feat/inspection-drawing-sibling-groups` | 複数資源兄弟グループ・まとめて改版・資源追加・一覧集約 |
| `b11e64ff` | `fix/inspection-drawing-template-pane-layout` | テンプレートペイン自動検索・再読込/リセット・カード密度改善 |
| `2a6db097` | `fix/inspection-drawing-table-panes` | 図面ライブラリ/テンプレート一覧をカードからコンパクト表へ変更 |

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
| テンプレ一覧表 | `InspectionDrawingLibraryTemplateTable.tsx` |
| visual API | `part-measurement-visual-template.service.ts` · `GET …/visual-templates` |
| 一覧フィルタ（共有） | `InspectionDrawingLibraryFilterBar.tsx` |
| テンプレ一覧 hook | `useInspectionDrawingTemplateLibrary.ts` |
| 資源 select（共有） | `InspectionDrawingResourceCdSelect.tsx` · `inspectionDrawingKioskUi.ts` |
| 作成/テンプレ編集 UI | `KioskInspectionDrawingCreatePage.tsx` |
| 測定点パネル（共有） | `InspectionDrawingPointSettingsPanel.tsx` |
| DEV プレビュー | `pages/dev/KioskInspectionDrawing*PreviewPage.tsx` · `KioskInspectionDrawingDevPreviewChrome.tsx` |
| 記録図面編集 UI | `KioskInspectionDrawingEditPage.tsx` |
| キャンバスズーム | `useInspectionDrawingZoom.ts` · `InspectionDrawingCanvasZoomControls.tsx` · `inspectionDrawingCanvasLayout.ts` |
| テンプレサービス | `part-measurement-template.service.ts`（`list/get/reviseKioskInspectionDrawing*`） |
| 兄弟グループ schema | `apps/api/prisma/migrations/20260701120000_part_measurement_template_sibling_groups` |
| 兄弟グループ API | `apps/api/src/routes/part-measurement/index.ts`（`inspection-drawing/template-groups*`） |
| 兄弟グループ service | `apps/api/src/services/part-measurement/part-measurement-template.service.ts`（`create/revise/addResources*SiblingGroup`） |
| 複数資源選択 UI | `apps/web/src/features/part-measurement/inspection-drawing/InspectionDrawingResourceCdMultiSelect.tsx` |
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
- 自動（2026-07-01・複数資源兄弟グループ）: GitHub Actions `28507352316` success（lint/build/unit, api-db-and-infra, security-docker, e2e-smoke, e2e-tests）
- 自動（2026-07-01・ローカル一時 Postgres）: migration deploy/generate、API integration `part-measurement.integration.test.ts` **63 PASS**、`siblingGroupId + isActive` と既存3キー lookup の `EXPLAIN` index scan、検証後に一時コンテナ削除
- 自動（2026-07-01・全台実機）: `./scripts/update-all-clients.sh feat/inspection-drawing-sibling-groups infrastructure/ansible/inventory.yml --detach --follow` → Run `20260701-183748-11286` success / failed=0、Pi5 HEAD `580324b5`
- 自動（2026-07-01・Phase12）: `./scripts/deploy/verify-phase12-real.sh` → **PASS 45 / WARN 0 / FAIL 0**
- 読み取りスモーク（2026-07-01・実機API）: `GET /api/part-measurement/inspection-drawing/templates` → 200、`GET /api/part-measurement/visual-templates?sort=recentlyUpdated&limit=5` → 200（`visualTemplates` に `7161テーブル` 等）
- 自動（2026-07-01・テンプレートペイン UX）: `pnpm --filter @raspi-system/web test -- useInspectionDrawingTemplateLibrary.test.ts InspectionDrawingLibraryFilterBar.test.tsx InspectionDrawingLibraryTemplateGrid.test.tsx` PASS、`pnpm --filter @raspi-system/web build` PASS、`pnpm --filter @raspi-system/web lint` PASS
- 自動（2026-07-01・CI）: GitHub Actions `28514390128` success（lint/build/unit, api-db-and-infra, e2e-smoke, security-docker, e2e-tests）
- 自動（2026-07-01・全台実機）: `./scripts/update-all-clients.sh fix/inspection-drawing-template-pane-layout infrastructure/ansible/inventory.yml --detach --follow` → Run `20260701-204628-31038`。Pi3 は `signage-lite-update.timer` 起動タスクで一度 recap failure になったが、実状態は healthy。Pi3 限定再デプロイ `20260701-212100-29479` は failed=0、最終 Phase12 は **PASS 45 / WARN 0 / FAIL 0**
- 手動（2026-07-01・実機テンプレートペイン）: `/kiosk/part-measurement/inspection` で `再読込` / `リセット` 表示、旧検索ボタンとしての `更新` なし、リセット disabled/復帰、カード密度改善、ユーザー目視 OK
- 自動（2026-07-01・表形式化）: `pnpm --filter @raspi-system/web test -- InspectionDrawingLibraryTemplateTable.test.tsx KioskInspectionDrawingVisualLibrarySection.test.tsx InspectionDrawingLibraryFilterBar.test.tsx useInspectionDrawingTemplateLibrary.test.ts` → **11 PASS**、`pnpm --filter @raspi-system/web build` PASS、`pnpm --filter @raspi-system/web lint` PASS
- 手動（2026-07-01・Mac DEV 表形式化）: `/dev/kiosk-inspection-drawing-library` を 1280x760 Chrome headless screenshot で確認。図面ライブラリ/テンプレートとも表形式、サムネイルなし、短縮操作ボタン横並び、更新日時列の見切れ改善。
- 自動（2026-07-01・CI 表形式化）: GitHub Actions `28520681342` success（lint/build/unit, api-db-and-infra, security-docker, e2e-smoke, e2e-tests）
- 自動（2026-07-01・全台実機 表形式化）: `./scripts/update-all-clients.sh fix/inspection-drawing-table-panes infrastructure/ansible/inventory.yml --detach --follow` → Run `20260701-223712-23737` success / failed=0、Pi5 HEAD `2a6db097`
- 自動（2026-07-01・Phase12 表形式化）: `./scripts/deploy/verify-phase12-real.sh` → **PASS 45 / WARN 0 / FAIL 0**
- 自動（2026-07-02・2表/1.5行密度改善）: `pnpm --filter @raspi-system/web test -- InspectionDrawingLibraryTemplateTable.test.tsx KioskInspectionDrawingVisualLibrarySection.test.tsx InspectionDrawingLibraryFilterBar.test.tsx useInspectionDrawingTemplateLibrary.test.ts` → **12 PASS**、`pnpm --filter @raspi-system/web build` PASS、`pnpm --filter @raspi-system/web lint` PASS
- 手動（2026-07-02・Mac DEV 2表/1.5行密度改善）: `/dev/kiosk-inspection-drawing-library` を 2048x1108 で確認。図面ライブラリ表は縦に伸長、テンプレートは左右2表、資源CDと4操作ボタンは下段、ボタン右端は更新時刻の右端に揃う。本文 `scrollWidth` は viewport 内で横 overflow なし。React Router future warning と WebRTC signaling error は既存DEVログ。
- 手動（残り）: 本番DBを書き換える一括作成・まとめて改版・個別分離・資源追加は未確認。次回は検証用データを決めてから画面操作で確認する。
