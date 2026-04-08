---
title: KB-313 キオスク要領書（PDF）一覧・Gmail取り込み
tags: [kiosk, pdf, gmail, api, ocr, metadata]
audience: [開発者, 運用者]
last-verified: 2026-04-08
category: knowledge-base
---

# KB-313: キオスク要領書（PDF）一覧・Gmail取り込み

## Context

キオスクに「要領書」タブ（`/kiosk/documents`）を追加し、PDFを一覧・検索・閲覧（1ページ/見開き・拡大）する。取り込み経路は **管理画面からの手動アップロード** と **Gmail 未読メールの PDF または HTML 添付**（HTML は API 内で PDF 化、`backup.json` の `kioskDocumentGmailIngest` ＋ cron）の2系統。

## 主要コンポーネント

- **DB**: `KioskDocument`（`KioskDocumentSource`: `MANUAL` | `GMAIL`）、Gmail 重複防止に `gmailDedupeKey`（SHA-256）
  - OCR/分類拡張: `ocrStatus`、`extractedText`、候補値（`candidate*`）、確定値（`confirmed*`）、信頼度（`confidence*`）、`displayTitle`
  - 文書番号・要約（2026-03-27）: `candidateDocumentNumber`、`confidenceDocumentNumber`、`confirmedDocumentNumber`、`summaryCandidate1`〜`summaryCandidate3`、`confirmedSummaryText`。OCR/メタデータラベラーは **候補と信頼度のみ** 更新し、**確定文書番号・確定要約は自動では書かない**（管理画面で人手確定）。
  - 履歴: `KioskDocumentMetadataHistory`（変更前後値・更新者・更新時刻）
- **API**（`/api/kiosk-documents`）:
  - `GET` 一覧・`GET :id` 詳細（`pageUrls`）: `x-client-key` または JWT（ADMIN/MANAGER/VIEWER）
  - `POST` 手動アップロード: ADMIN/MANAGER
  - `POST /ingest-gmail`: ADMIN/MANAGER（手動トリガ）
  - `POST /:id/reprocess`: 文書1件の OCR/抽出再処理（ADMIN/MANAGER）
  - `POST /run-nightly-ocr`: 夜間OCR処理の手動実行（ADMIN/MANAGER）
  - `PATCH /:id/metadata`: 確定メタデータ編集（候補は保持）。`confirmedDocumentNumber` / `confirmedSummaryText` を含む。**確定文書番号**は形式 `^[\u4e00-\u9fff][0-9]+-[A-Z0-9]+$`（先頭1文字が漢字、続けて数字、ハイフン、**大文字英数字のみ**の接尾。小文字不可）。不一致は **400**（`KIOSK_DOC_INVALID_DOCUMENT_NUMBER`）。
  - `PATCH /:id`: `enabled` の更新のみ（ADMIN/MANAGER）
  - `DELETE /:id`: ADMIN/MANAGER
- **ページ画像**: `PdfStorage.convertPdfToPages`（要領書は `PdfStorageRenderAdapter` 経由で **キオスク専用 DPI/品質** を指定可）→ `GET /api/storage/pdf-pages/:pdfId/:filename`（JPEG 時は `image/jpeg` を返却）
- **Gmail**: `GmailApiClient.listPdfAttachments` で PDF 列挙、`listHtmlAttachments` で HTML 列挙。HTML は `PlaywrightHtmlToPdfAdapter`（共有 Chromium）で PDF 化のうえ `createFromGmailHtmlAttachment` へ。検索クエリは `buildKioskDocumentGmailSearchQuery`（件名・任意 `from`・`is:unread`）。手動取り込み結果に `htmlImported` / `htmlSkippedDuplicate` が含まれる。

### 環境変数（要領書の軽量化・サイネージとの分離）

| 変数 | 役割 | 既定（未設定時） |
|------|------|------------------|
| `KIOSK_DOCUMENT_PDF_DPI` | 要領書 PDF→JPEG の解像度（`pdftoppm -r`） | `120` |
| `KIOSK_DOCUMENT_JPEG_QUALITY` | JPEG 品質（1–100） | `78` |
| `KIOSK_DOCUMENT_OCR_CRON` | 夜間OCRバッチ時刻（JST cron） | `30 2 * * *` |
| `KIOSK_DOCUMENT_OCR_BATCH_SIZE` | 夜間OCRバッチの1回あたり処理件数 | `100` |
| `KIOSK_DOCUMENT_PROCESS_TIMEOUT_MS` | 1文書あたりOCR/抽出タイムアウト | `180000` |
| `KIOSK_DOCUMENT_OCR_LEGACY_STDOUT` | `true` のときのみ、`KIOSK_DOCUMENT_OCR_COMMAND` に PDF を1引数渡し stdout を全文とみなす（独自ラッパー向け） | 未設定（無効） |
| `KIOSK_DOCUMENT_OCR_COMMAND` | 上記レガシーモード時の実行ファイル名またはパス | `ndlocr-lite` |
| `KIOSK_DOCUMENT_NDLOCR_CLI` | 既定の NDLOCR-Lite パイプラインで呼ぶコマンド（`--sourceimg` / `--output` 形式） | `ndlocr-lite` |
| `KIOSK_DOCUMENT_NDLOCR_SCRIPT` | 設定時は `KIOSK_DOCUMENT_NDLOCR_PYTHON` でこの `ocr.py` を実行（git clone 配置向け）。未設定なら `KIOSK_DOCUMENT_NDLOCR_CLI` のみ起動 | 未設定 |
| `KIOSK_DOCUMENT_NDLOCR_PYTHON` | `KIOSK_DOCUMENT_NDLOCR_SCRIPT` 使用時の Python | `python3` |
| `KIOSK_DOCUMENT_OCR_RASTER_DPI` | OCR 用 `pdftoppm -r`（API コンテナに poppler 必須） | `150` |
| `KIOSK_DOCUMENT_OCR_ENGINE_TIMEOUT_MS` | 1ページあたりの NDLOCR / レガシー OCR 子プロセスのタイムアウト（ms） | `180000` |
| `KIOSK_DOCUMENT_OCR_RASTER_TIMEOUT_MS` | `pdftoppm` のタイムアウト（ms） | `120000` |
| `PDF_PAGES_CACHE_CONTROL` | `GET /api/storage/pdf-pages/...` の `Cache-Control`（キオスク・サイネージ共通のページ画像）。未設定時は `public, max-age=86400, stale-while-revalidate=604800` | 未設定（コード既定を使用） |
| `KIOSK_DOCUMENT_HTML_TO_PDF_TIMEOUT_MS` | Gmail HTML 添付の `page.setContent` タイムアウト（ms） | `120000` |
| `KIOSK_DOCUMENT_SUMMARY_INFERENCE_ENABLED` | `true` のとき、OCR 後にテキスト要約推論を試行（失敗時は機械スニペットへフォールバック） | `false` |
| `INFERENCE_PROVIDERS_JSON` | 推論プロバイダ配列（JSON）。未設定時は `LOCAL_LLM_*` から `id=default` を合成 | 未設定 |
| `INFERENCE_DOCUMENT_SUMMARY_PROVIDER_ID` | 要約推論のプロバイダ id | `default` |
| `INFERENCE_DOCUMENT_SUMMARY_MODEL` | 要約推論のモデル（未指定時はプロバイダの `defaultModel`） | 未設定 |
| `INFERENCE_DOCUMENT_SUMMARY_MAX_TOKENS` / `INFERENCE_DOCUMENT_SUMMARY_INPUT_MAX_CHARS` / `INFERENCE_DOCUMENT_SUMMARY_TEMPERATURE` | 要約推論の上限・入力切り詰め・温度 | `512` / `24000` / `0.2` |

**推論基盤の全体方針**（写真持出 VLM との共用・複数 PC）: [ADR-20260402](../decisions/ADR-20260402-inference-foundation-phase1.md)。

サイネージは従来どおり `SIGNAGE_PDF_DPI`（未設定時 150）を `convertPdfToPages` のデフォルトとして利用する。**要領書だけ** Pi4 向けに軽くしたい場合は上記 2 つを API コンテナに設定する。

**キャッシュ注意**: `pdf-pages/{文書UUID}/` に既に `.jpg` があると **再変換されない**。DPI/品質を変えたあと画質が変わらないときは、当該ディレクトリを削除するか、管理画面で該当文書を削除して再登録する（運用は [kiosk-documents.md runbook](../runbooks/kiosk-documents.md) 参照）。

### ストレージ掃除（孤児ファイル）

DB に無い `pdf-pages` サブディレクトリ（UUID 形式）や `pdfs` 内の未参照 `.pdf` を検出・削除する CLI がある（既定は dry-run）。

- `pnpm --filter @raspi-system/api run cleanup:pdf-orphans`（dry-run）
- `pnpm --filter @raspi-system/api exec tsx src/scripts/cleanup-pdf-storage-orphans.ts --execute`（実削除）

誤削除防止のため、**初回は必ず dry-run で一覧を確認**すること。

## Symptoms / よくある事象

- **Gmail から取り込まれない**: `storage.provider` が `gmail` でない、トークン欠落、`kioskDocumentGmailIngest` が空/無効、件名が一致しない、添付が **PDF / HTML** のいずれでもない、または既読
- **HTML は取り込めないが PDF は取り込める**: API ログ `[PlaywrightHtmlToPdf]`。Chromium 同梱・`KIOSK_DOCUMENT_HTML_TO_PDF_TIMEOUT_MS`。HTML が外部リソースのみの場合オフラインで描画失敗しうる（[kiosk-documents Runbook](../runbooks/kiosk-documents.md)）
- **Pi5 デプロイで git 同期失敗（`unable to unlink` / `pull` 中止）**: `apps/api/src/services/signage/**` 等が **root 所有**だと `git reset`/`pull` が壊れる（[deployment.md](../guides/deployment.md) の「ワークツリー権限」、[KB-325](./infrastructure/signage.md#kb-325-split-compact24-loan-cards-pi5-git)）。**`git clean -fd`** は **未追跡を削除**する。ホスト専用の作業ディレクトリがある場合は事前に退避してから同期・再デプロイ。
- **一覧に出ない**: 管理画面で `enabled=false`、キオスクは有効なもののみ表示
- **要領書画面で Gmail スケジュール一覧が取得失敗（赤字メッセージ）**: JWT 権限（ADMIN/MANAGER）・`GET /api/backup/config` のネットワーク/502。CSV インポートのスケジュール画面とは別 API ではなく **同一バックアップ設定**を参照しているため、`backup.json` 自体は Pi5 上で存在するか [Phase12 の backup.json 確認](../../scripts/deploy/verify-phase12-real.sh) も併用。
- **画像が出ない**: PDF 変換失敗（Pi 上の変換ツール・ストレージパス）、`pageUrls` が空
- **要領書の LLM 要約が載らない／常に機械スニペットのまま**: **既定は推論 OFF**（`KIOSK_DOCUMENT_SUMMARY_INFERENCE_ENABLED` が `true` でない）。ON にしても **`document_summary` ルート**が解決できない（`INFERENCE_PROVIDERS_JSON` 不整合・`LOCAL_LLM_*` 未配線・upstream down）は推論をスキップし機械候補のみ。**意図どおり ON なのに推論しない**ときは API ログの `component: inference`・`useCase: document_summary`・`errorReason` を確認（本文は出ない）。**2026-03-31 追記（本番切り分け）**: `errorReason: upstream_http_403` は **Pi5 の `LOCAL_LLM_SHARED_TOKEN`（`X-LLM-Token`）が Ubuntu 側 `api-token` と不一致**なことが多い（vault / `infrastructure/docker/.env` / コンテナ内 `printenv` で両者を揃える。[KB-318](./infrastructure/ansible-deployment.md#kb-318-pi5-local-llm-via-docker-env)）。`LOCAL_LLM_RUNTIME_MODE=on_demand` 時、起動直後は **`/healthz` や `/v1/models` が 200 でも `/v1/chat/completions` が 503** になりうる。API 側は **用途ごとのモデルで chat をポーリング**してから推論に入る実装へ更新済み（[ADR-20260403](../decisions/ADR-20260403-on-demand-local-llm-runtime-control.md)・[local-llm-tailscale-sidecar.md](../runbooks/local-llm-tailscale-sidecar.md)）。
- **`INFERENCE_PROVIDERS_JSON` を入れたら警告だけで従来どおり動く**: JSON 構文エラー時は **警告ログのうえ `LOCAL_LLM_*` から合成**（[ADR-20260402](../decisions/ADR-20260402-inference-foundation-phase1.md)）。デプロイ前に `python3 -m json.tool` 等で検証する。
- **抽出が失敗し続ける**: API コンテナに同梱された **NDLOCR-Lite** が見えているか（`which ndlocr-lite` / `ndlocr-lite --help`）。`KIOSK_DOCUMENT_NDLOCR_SCRIPT` を使う場合はパスの存在と Python 実行権限を確認。`pdftotext` だけではスキャン PDF は空になり、OCR 分岐に入る。
- **OCR なのに文字がほぼ空**: 旧実装は `ndlocr-lite <pdf>`（stdout 想定）で **NDLOCR-Lite 実 CLI と不一致**だった。現行は PDF→`pdftoppm`→ページごとに `--sourceimg`/`--output` で `.txt` を収集。独自ラッパーは `KIOSK_DOCUMENT_OCR_LEGACY_STDOUT=true` で従来契約に戻す。
- **拡大（ズーム）が効かない**: 表示モードが **幅いっぱい** のときは仕様で無効。**標準幅** に戻すと拡大 UI が有効になる
- **別文書を選んでもビューアの縦位置が前の文書のまま／ページがずれる**: 文書 ID 切替時に **スクロール位置**と**近傍表示の active インデックス**をリセットしていないと起きうる。`documentKey`（選択 ID）変更で `activeIndex` を 0 に戻す、`selectedId` 変更で `scrollTop = 0`（`useLayoutEffect`）を確認（`useKioskDocumentNearVisibleRows`・`KioskDocumentsViewerPanel`）。
- **一覧で連続選択すると右ペインが縦にガタつく（チャタリング）**: DevTools で同一 ID の `GET /api/kiosk-documents/:id` が **短間隔で複数本**ないか確認。**別機能として意図的に二重 GET を入れたわけではなく**、`prefetchQuery` と `useQuery` の **キャッシュ方針不一致**（既定 `staleTime` で先読み直後に再フェッチ）や **`pointerenter` + `focus` の二重先読み**が重なると起きうる。対策は [ADR-20260327](../decisions/ADR-20260327-kiosk-document-detail-react-query-cache.md)（共有 `kioskDocumentDetailQueryOptions`・キオスク一覧は pointer のみ先読み）。
- **確定文書番号が保存できない（`PATCH /api/kiosk-documents/:id/metadata` が 400）**: `confirmedDocumentNumber` が **`KIOSK_DOCUMENT_NUMBER_PATTERN`**（`apps/api/src/services/kiosk-documents/kiosk-document-number.ts`）に合わない。接尾の英数字は **大文字のみ**（例: `産1-G025AAK` は可、`産1-g025aak` は不可）。OCR 抽出は本文中のパターンに合致した候補のみ。手入力で正規化して再試行。
- **右ペインで一覧・見開き・ズームが見えない（イマーシブ時）**: 仕様。**「表示オプション」右のスライダー型アイコン**にマウスを載せてツールバー帯を展開する。検索ヒット抜粋も同じ折りたたみ内。

## Investigation

1. 管理 `/admin/kiosk-documents` で手動アップロードが成功するか
2. API `GET /api/kiosk-documents`（端末の `x-client-key`）で `documents` が返るか
3. `GET /api/kiosk-documents/:id` で `pageUrls` が非空か
4. Gmail: `backup.json` の `kioskDocumentGmailIngest` と Gmail トークン、API ログ `[KioskDocumentGmailIngestion]`

## 仕様（運用で押さえる点）

- **キオスク URL**: `/kiosk/documents`。沉浸式レイアウト（上端ホバーでヘッダー表示）は [KB-311](./KB-311-kiosk-immersive-header-allowlist.md) の allowlist に含める。
- **認可**: 一覧・詳細は **登録端末の `x-client-key`** または **JWT（ADMIN / MANAGER / VIEWER）**。アップロード・Gmail 取り込み・PATCH/DELETE は **ADMIN / MANAGER**。
- **管理画面（2026-04-08）**: `/admin/kiosk-documents` に **`kioskDocumentGmailIngest` の読み取り専用一覧**（`GET /api/backup/config`）を表示。CSV インポート画面の `csvImports` とは別設定。行の **「IDを手動実行欄に反映」** で既存の Gmail 手動取り込み（`POST /ingest-gmail`）のスケジュール ID 入力を補助。編集は引き続きバックアップ設定経由。
- **キオスク一覧**: `enabled=true` の行のみ（無効化した文書は管理画面では見えるがキオスクでは出ない）。
- **重複**: Gmail は `gmailDedupeKey`（メッセージID＋添付ファイル名などから生成）で一意。手動は Gmail と別系統で複数可。

### フリーワード検索（`q`）

- 一覧 API の `q` は、ルートで `normalizeDocumentText`（NFKC・連続空白の圧縮・小文字化）したあと、**タイトル系・ファイル名・`extractedText`・確定メタ**（管理画面では `includeCandidates=true` のとき **候補メタ**も）に対して **部分一致**でマッチする。**2026-03-27 以降**は OR 条件に **`candidateDocumentNumber` / `confirmedDocumentNumber`**、**`summaryCandidate1`〜`3` / `confirmedSummaryText`** も含む（`buildKioskDocumentSearchOrConditions`）。実装は Prisma の `contains`（PostgreSQL では `ILIKE '%…%'` 相当、大文字小文字は区別しない）。
- **PostgreSQL `simple` 辞書の全文検索（`to_tsvector` / `plainto_tsquery`）は使わない**。日本語の文中の連続文字列にもヒットしやすい代わりに、関連度ランキングはなく **並びは `createdAt` 降順**。
- 検索文字列に含まれる **`%` はリポジトリ側で除去**し、ILIKE のワイルドカードとしての誤動作（意図しない広い一致）を防ぐ。`_` は ILIKE の1文字ワイルドカードとして解釈されうるが、品番などに `_` が含まれるため現状は除去しない（トレードオフは [ADR-20260326](../decisions/ADR-20260326-kiosk-document-free-text-substring-search.md)）。

### キオスクビューア UI（`/kiosk/documents`・2026-03）

- 左ペイン（検索・取込元フィルタ・一覧）は **既定で表示**。**一覧の表示/非表示**はツールバー左の **アイコン**（`aria-label` / `title` あり）で切り替え、ビューア側の表示幅を広げられる。
- 右側（メイン）: **1ページ** / **見開き**（テキストトグル）、**標準幅** / **幅いっぱい**（**アイコン**＋`aria-label`/`title`）、縦スクロール。
- **拡大（ズーム）**は **標準幅** 表示時のみ有効。**幅いっぱい** 時は無効（二重スケールを避ける仕様）。無効時は `%` が `—` になり、説明文は出さない（2026-03-26 以降）。
- **コントラスト（ダーク UI）**: ビューア上部ツールバー等で `Button` の **`ghostOnDark`** variant を使う（従来 `ghost` は `!text-slate-900` 系で **暗背景では文字が見えない**）。ライト専用の `ghost` と分離する。
- **ツールバーとタイトル**: ビューア直下の **重複ファイル名行は廃止**（左一覧と役割が重なるため）。長い文書名は一覧側で確認する。
- **検索ヒット抜粋（2026-03-26）**: 左の検索語が **空でないときだけ**、ツールバー右に **`extractedText` 由来の抜粋**（最大 **3** 箇所、前後約 **60** 文字、`buildKioskDocumentSearchSnippetModel`）。ヒットは `<mark>` で強調。本文が無い・一致なしのときは **「一致する箇所は見つかりませんでした」**。検索語が空のときは **右パネル非表示**（要領書画像の縦スペースを確保）。
  - **一覧 API の `q` との差**: 一覧は `normalizeDocumentText`（NFKC 等）後に DB へ **ILIKE 部分一致**。抜粋はクライアントで **原文に対する大文字小文字無視の部分一致**（正規表現メタ文字はエスケープ）。**通常は一致**するが、表記ゆれでは **一覧に出るのに抜粋が空**、またはその逆が稀に起こりうる。
- **Pi4 スクロール負荷軽減**: `useKioskDocumentNearVisibleRows` がスクロールコンテナを `root` とする `IntersectionObserver` で **近傍のページ行だけ** `<img>` をマウント。`KioskDocumentViewerPageRow` は **プレースホルダ**・`loading="lazy"`・`decoding="async"`。近傍インデックス計算は `kioskDocumentViewerVisibility.ts` の純関数＋ Vitest（`kioskDocumentViewerVisibility.test.ts`）で固定。
- **表示速度・スクロール（2026-03-26 以降）**: 一覧行の **ホバー**で `GET /api/kiosk-documents/:id` を **デバウンス付きでプリフェッチ**（`useKioskDocumentListPrefetch`・React Query `prefetchQuery`）。**2026-03-27 以降**: キオスク一覧は **タッチ時の二重イベント抑止**のため **`onRowFocus` からの先読みは接続しない**（`KioskDocumentsPage`）。`useKioskDocumentDetail` と `prefetchQuery` は **`apps/web/src/api/kioskDocumentDetailQueryOptions.ts`** で **`staleTime`（60s）・`gcTime`（5m）・`queryKey`・`queryFn` を共有**し、先読み直後の不要な再フェッチを抑える（判断は [ADR-20260327](../decisions/ADR-20260327-kiosk-document-detail-react-query-cache.md)）。IO の `activeIndex` 更新は **requestAnimationFrame で 1 フレームに 1 回**に間引き、近傍半径・`rootMargin` は `kioskDocumentViewerScrollPolicy.ts` に集約（Pi で重い場合は定数調整）。ページ画像 `GET /api/storage/pdf-pages/...` は **ETag**（`size-mtimeMs`）と **304**、および **`Cache-Control`**（既定は長めの `public` + `stale-while-revalidate`。上書きは `PDF_PAGES_CACHE_CONTROL`）でブラウザキャッシュを効かせる。
- **文書切替時のリセット（2026-03-27）**: 別文書を選んだときに前文書の **スクロール位置・近傍インデックス**を持ち越さないよう、`useKioskDocumentNearVisibleRows` の `documentKey` で `activeIndex` を 0 に戻し、`KioskDocumentsViewerPanel` で `selectedId` 変更時に `scrollTop = 0`（`useLayoutEffect`）。
- **左一覧の文書番号・要約（2026-03-27）**: 各行 **上段**は `confirmedDocumentNumber` があればそれを、無ければ従来の表示タイトル系（`displayTitle` / ファイル名など）。**下段**は `confirmedSummaryText`（長い場合は省略）。管理画面 `/admin/kiosk-documents` に **文書番号列・要約列**と、候補から確定へコピーする編集 UI あり。
- **左一覧 要約の全文表示（2026-03-27 追記）**: 下段は `line-clamp-2` のため 2 行で切れる。**マウスオーバーでブラウザ標準ツールチップ**（`title`）に全文を出す。表示文字列は `resolveKioskDocumentSummaryText`（`kioskDocumentListSummary.ts`）で **候補→確定→「本文要約なし」** を一元化（他画面の `truncate` + `title` と同パターン）。
- **右ペイン ツールバー折りたたみ（2026-03-27）**: イマーシブ対象ルート（`usesKioskImmersiveLayout`、[KB-311](./KB-311-kiosk-immersive-header-allowlist.md)）では、ビューア上部の **一覧トグル・1ページ/見開き・幅・ズーム・リセット・検索ヒット抜粋まで含む帯**を既定で折りたたみ、**「表示オプション」行右のスライダー型アイコン**へホバーで展開（`useTimedHoverReveal`・遅延クローズは手動順番下ペインと同じ `TIMED_HOVER_REVEAL_CLOSE_DELAY_MS`）。枠は共通コンポーネント **`HoverRevealCollapsibleToolbar`**（`apps/web/src/components/kiosk/HoverRevealCollapsibleToolbar.tsx`）。`ManualOrderLowerPaneCollapsibleToolbar` は同枠への薄いラッパ（amber スタイル・既存 `aria-label` 維持）。**トレードオフ**: 検索語があるときも抜粋は折りたたみ内のため、ヒット確認前にホットゾーンへ触れる必要がある（現場判断で仕様化済み）。
- **実装分割**: `apps/web/src/features/kiosk/documents/`（`search/kiosk-document-search-snippets.ts`・`KioskDocumentSearchSnippetStrip.tsx`・`kioskDocumentsToolbarIcons.tsx`・`kioskDocumentQueryKeys.ts`・`useKioskDocumentListPrefetch.ts`・`kioskDocumentViewerScrollPolicy.ts`・`kioskDocumentListSummary.ts`）。API 層に **`kioskDocumentDetailQueryOptions.ts`**。ページは `apps/web/src/pages/kiosk/KioskDocumentsPage.tsx`。
- **バーコード／QR スキャン検索（2026-03-29）**: キオスク要領書の検索欄横 **スキャンボタン** でモーダルを開き、**カメラはセッション中のみ ON**（写真持出と同趣旨で Pi 負荷回避）。デコードは **`@zxing/library` を npm バンドル**（Firefox キオスク向けに **`BarcodeDetector` は前提にしない**）。汎用モジュールは `apps/web/src/features/barcode-scan/`（`formatPresets.ts`・`zxingVideoReader.ts`・`useBarcodeScanSession.ts`・`BarcodeScanModal.tsx`）。**要領書画面**では `BARCODE_FORMAT_PRESET_ONE_DIMENSIONAL`（主要な一次元形式。QR・DataMatrix 等は除外）。**成功時**: 読取文字列を **trim** し検索欄へ反映、`search` / `debouncedSearch` を同時更新して **即検索**、直後にモーダルを閉じてカメラ停止。**キャンセル・タイムアウト（30 秒未検出）・起動失敗後の閉じる**: 検索欄は **空にクリア**（スキャン開始前の手入力も含め）。カメラ不可時のユーザー向け表示は **短文のみ**。判断の根拠は [ADR-20260329](../decisions/ADR-20260329-kiosk-document-barcode-scan-zxing.md)。

## 実機検証

- **デプロイ（要領書 Gmail スケジュール一覧 UI・Web のみ・Pi5 のみ・2026-04-08）**: ブランチ `feat/kiosk-doc-gmail-schedules-list`（コミット例 `35aa97bf`）。`KioskGmailIngestScheduleListSection`・`BackupConfig.kioskDocumentGmailIngest` 型・表示ユーティリティ＋Vitest。API 契約不変。**手順**: [deployment.md](../guides/deployment.md)・`export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh feat/kiosk-doc-gmail-schedules-list infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`。**Ansible ログ**: `ansible-update-20260408-185957-2678`（**`PLAY RECAP` `failed=0` / `unreachable=0`**・所要約 **15 分**強）。**Phase12**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **55s**）。**手動（推奨）**: 管理 `/admin/kiosk-documents` で **「要領書Gmailスケジュール一覧（読み取り）」** が `backup.json` の `kioskDocumentGmailIngest` と一致すること・**ID反映**で手動取り込み欄に入ること。
- **デプロイ（要領書 HTML Gmail 取り込み・API・Pi5 のみ・2026-04-08）**: 運用指示により **HTML 添付を Playwright で PDF 化する API** を **Pi5 だけ**反映（[deployment.md](../guides/deployment.md)・**`--limit raspberrypi5`**・`RASPI_SERVER_HOST`・`--detach --follow`）。**Pi3 / Pi4 への Ansible デプロイは不要**（Pi3 のメモリ制約向け **単独・プレフライト手順**も今回は未使用）。**Ansible サマリ**: `ansible-update-20260408-154206-25754`（**`failed=0` / `unreachable=0`**）。**追従 `main` 例**: `895a1060`。**Phase12**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 42 / WARN 1 / FAIL 0**（**WARN**: auto-tuning ログ件数 0）。**手動（残）**: 件名「要領書HTML研削」・**未読**・HTML 添付の E2E（`kioskDocumentGmailIngest`・`POST /ingest-gmail` の `htmlImported`・`GET :id` の `pageUrls`）。詳細は [kiosk-html-gmail-ingest-verification.md](../plans/kiosk-html-gmail-ingest-verification.md)。
- **デプロイ（推論基盤フェーズ1・API・Pi5 のみ）**: ブランチ `feat/inference-foundation-phase1`（`services/inference`・要領書オプトイン推論・写真ラベル `photo_label` ルート）。[deployment.md](../guides/deployment.md) に従い **`--limit raspberrypi5` のみ**・`RASPI_SERVER_HOST`・`--detach --follow`。Detach Run ID 例: `20260330-171021-10204`。**Phase12（2026-03-30）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 37 / WARN 0 / FAIL 0**（約 95s）。要領書 LLM 要約は既定 OFF のため、本スクリプトは **要領書 API 200 + `documents`** の回帰まで（詳細は [ADR-20260402](../decisions/ADR-20260402-inference-foundation-phase1.md) Verification）。
- **デプロイ（要領書: バーコードスキャン検索・Web のみ）**: ブランチ `feat/kiosk-documents-barcode-scan`（コミット例 `043f3228`）。API 契約不変。`@zxing/library` バンドル・`features/barcode-scan`・`KioskDocumentsPage` / `KioskDocumentsListPanel` の `searchAccessory`。[deployment.md](../guides/deployment.md) に従い **Pi5 → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`** を **`--limit` 1 台ずつ**・Pi3 除外・`export RASPI_SERVER_HOST=denkon5sd02@100.106.158.2`（例）・`--detach --follow`。**Phase12（2026-03-29 実測）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 34 / WARN 0 / FAIL 0**（約 47s）。**残りの実機確認（オペレーター向け）**: Pi4 Firefox で `/kiosk/documents` にてスキャンボタン・カメラ許可・実ラベル読取・一覧絞り込みを目視確認（自動スクリプトではブラウザカメラを使わない）。
- **デプロイ（要領書: ビューアツールバー折りたたみ・左一覧要約 `title`・Web のみ）**: ブランチ `feat/kiosk-documents-hover-toolbar-and-summary-tooltip`（`HoverRevealCollapsibleToolbar`・`kioskDocumentListSummary.ts`・`KioskDocumentsViewerPanel` の `toolbarRevealEnabled`＋`usesKioskImmersiveLayout`）。API 契約不変。[deployment.md](../guides/deployment.md) に従い **Pi5 → `raspberrypi4` → `raspi4-robodrill01` のみ** `--limit` 1 台ずつ・Pi3 除外・`export RASPI_SERVER_HOST=denkon5sd02@100.106.158.2`（例）・`--detach --follow`。リモートログ basename 例: `ansible-update-20260327-162247-*`（Pi5）/ `ansible-update-20260327-162734-14602`（raspberrypi4）/ `ansible-update-20260327-163150-32497`（raspi4-robodrill01）。**Phase12**: `./scripts/deploy/verify-phase12-real.sh` で **PASS 29 / WARN 1 / FAIL 0**（約 41s・2026-03-27、Pi3 `signage-lite/timer` が **WARN**・exit 0）。**知見**: Mac に `RASPI_SERVER_HOST` が無いと `update-all-clients.sh` 実行前に `export` が必要。
- **デプロイ（要領書: 文書番号・要約候補3・確定要約・API+Web+DB）**: ブランチ `feat/kiosk-documents-doc-number-summary`（実装例: `kiosk-document-number.ts`・`kiosk-document-summary-candidates.ts`・`kiosk-documents` ルート DTO/`PATCH` 検証・`buildKioskDocumentSearchOrConditions`・`KioskDocumentsAdminPage` / `KioskDocumentsListPanel`）。Prisma `20260327120000_add_kiosk_document_number_summary`。[deployment.md](../guides/deployment.md) に従い **Pi5 → `raspberrypi4` → `raspi4-robodrill01` のみ** `--limit` 1台ずつ・Pi3 除外（要領書対象外のためキオスク Pi4 と Pi5 API のみ更新）。**Phase12**: `./scripts/deploy/verify-phase12-real.sh` で **PASS 30 / WARN 0 / FAIL 0**（約22s・2026-03-27、Pi3 到達時・全ホスト成功）。**知見**: 確定値は運用スナップショット。OCR パイプラインは候補列のみ自動更新。
- **デプロイ（要領書: 文書切替リセット + 詳細クエリキャッシュ共有・チャタリング抑制・Web）**: ブランチ `feat/kiosk-documents-viewer-reset-on-switch`（実装例: `kioskDocumentDetailQueryOptions.ts`・`useKioskDocumentDetail` の `staleTime`/`gcTime`・一覧 `onRowFocus` 先読み削除・ビューア/近傍フックのリセット）。[deployment.md](../guides/deployment.md) に従い **Pi5 → `raspberrypi4` → `raspi4-robodrill01` のみ** `--limit` 1 台ずつ・Pi3 除外。Ansible Detach Run ID 例: `20260327-104657-10125`（Pi5）/ `20260327-105045-23756`（raspberrypi4）/ `20260327-105453-27111`（raspi4-robodrill01）。**Phase12**: `./scripts/deploy/verify-phase12-real.sh` で **PASS 29 / WARN 1 / FAIL 0**（約 38s・2026-03-27、Pi3 `signage-lite/timer` WARN）。**現場 Pi4**: チャタリング解消を運用確認（2026-03-27）。
- **デプロイ（要領書ビューア表示速度・スクロール改善・Web+API）**: ブランチ `feat/kiosk-documents-viewer-perf`（実装 `713af8cd`、追従修正 `0dcb631b`）。一覧の **ホバー/フォーカスで詳細プリフェッチ**、ビューア **IO+rAF**・**近傍バッファ**、`GET /api/storage/pdf-pages/...` の **ETag・304・Cache-Control**（`PDF_PAGES_CACHE_CONTROL` で上書き可）、**If-None-Match の配列値**対応。本番反映は [deployment.md](../guides/deployment.md) に従い **Pi5 → `raspberrypi4` → `raspi4-robodrill01` のみ** `--limit` 1台ずつ・Pi3 は要領書対象外。**`main` マージ**: [PR #46](https://github.com/denkoushi/RaspberryPiSystem_002/pull/46) merge `b5552153`（2026-03-26）。**Phase12（デプロイ反映後・2026-03-26 実測）**: `./scripts/deploy/verify-phase12-real.sh` で **PASS 29 / WARN 1 / FAIL 0**（**約 105s**、Pi3 `signage-lite/timer` が **WARN**・exit 0）。**マージ後再検証（同一スクリプト・2026-03-26）**: **PASS 29 / WARN 1 / FAIL 0**（**約 103s**）。全ホスト到達時は **PASS 30/0/0** が目安。
- **デプロイ（要領書ツールバー改修・検索ヒット抜粋・Web）**: ブランチ `feat/kiosk-documents-toolbar-search-snippets`（コミット例 `931a48f3` の perf 修正含む）を [deployment.md](../guides/deployment.md) に従い **Pi5 → `raspberrypi4` → `raspi4-robodrill01` のみ** `--limit` 1台ずつ・`--detach --follow`・`RASPI_SERVER_HOST=denkon5sd02@100.106.158.2`（2026-03-26）。**Pi3 は対象外**。Ansible Detach Run ID 例: `20260326-190104-11317`（Pi5）/ `20260326-190608-6864`（raspberrypi4）/ `20260326-191127-3225`（raspi4-robodrill01）。**Phase12**: `./scripts/deploy/verify-phase12-real.sh` で **PASS 29 / WARN 1 / FAIL 0**（Pi3 が SSH 未到達のとき Pi3 行 **WARN**・全体 exit 0。全ホスト到達時は **PASS 30 / WARN 0 / FAIL 0** が目安）。
- **デプロイ（要領書フリーワード検索・部分一致化）**: ブランチ `docs/phase12-verification-2026-03-26`（API: `contains`/ILIKE 部分一致、`buildKioskDocumentSearchOrConditions`、FTS raw SQL 削除。仕様は [ADR-20260326](../decisions/ADR-20260326-kiosk-document-free-text-substring-search.md)）を [deployment.md](../guides/deployment.md) に従い **Pi5 → `raspberrypi4` → `raspi4-robodrill01` のみ** `--limit` 1台ずつ・`--detach --follow`・`RASPI_SERVER_HOST=denkon5sd02@100.106.158.2`（2026-03-26）。**Pi3 は対象外**（要領書対象外のためデプロイ未実施）。Ansible Detach Run ID 例: `20260326-154038-14101`（Pi5）/ `20260326-154739-7415`（raspberrypi4）/ `20260326-155316-6698`（raspi4-robodrill01）。**Phase12**: `./scripts/deploy/verify-phase12-real.sh` で **PASS 30 / WARN 0 / FAIL 0**（実行時間の目安 約100〜110s）。**知見**: 検索は `q` 正規化後にタイトル・ファイル名・`extractedText`・確定/候補メタの OR 部分一致。一覧の並びは `createdAt` 降順。`%` は入力から除去（`escapeLikePattern`）。`_` は ILIKE の1文字ワイルドカードになりうるが品番向けに現状は除去しない（KB「フリーワード検索」節・ADR 参照）。
- **デプロイ（OCR・メタデータ・全文検索）**: ブランチ `feature/kiosk-documents-ocr-metadata-v1` を [deployment.md](../guides/deployment.md) に従い **Pi5 → `raspberrypi4` → `raspi4-robodrill01` を `--limit` で1台ずつ**（2026-03-26）。Prisma `20260326100000_add_kiosk_document_ocr_metadata`。Pi3 は今回のキオスク要領書対象外（リソース制約・専用手順は deployment §Pi3）。
- **Phase12 自動検証（2026-03-26・feature ブランチ直後）**: `./scripts/deploy/verify-phase12-real.sh` を実行。**1回目**は Pi5 経由の Pi3 SSH が `Connection closed` となり **Pi3 行が FAIL**（全体 exit 1）。**数分後に再実行**し **PASS 30 / WARN 0 / FAIL 0** を確認（Pi3 も `signage-lite` / timer が active）。偶発切断時は再実行を優先。スクリプト側は同一メッセージを **WARN** 扱いに寄せる修正済み（`verify-phase12-real.sh`）。
- **`main` 追従デプロイ後の再検証（2026-03-26）**: [deployment.md](../guides/deployment.md) に従い **`main`**（例: HEAD `eb745ee5`）を **Pi5 → `raspberrypi4` → `raspi4-robodrill01` のみ** `--limit` 1台ずつ・`--detach --follow`（Pi3 除外）。Ansible Detach Run ID 例: `20260326-141356-9335` / `20260326-142755-12083` / `20260326-143327-21480`。**Phase12**: 初回実行で **PASS 30 / WARN 0 / FAIL 0**（Pi3 含む全 SSH 成功）。**OCR コンテナ**: Pi5 上で `docker compose ... exec -T api` 経由の `which ndlocr-lite` / `ndlocr-lite --help` が成功。stderr に **ONNX Runtime の GPU device discovery** 警告が出ることがあるが、CPU 推論運用では **無害**。
- **API 追加確認（RoboDrill 端末キー）**: `GET /api/kiosk-documents` に `x-client-key: client-key-raspi4-robodrill01-kiosk1` を付与し、応答 `documents[]` に `ocrStatus`・`candidate*`・`confirmed*`・`extractedText` 等の拡張フィールドが載ることを確認（本セッション・curl + JSON キー一覧）。

- **デプロイ（要領書・ビューア改修）**: ブランチ `feature/kiosk-documents-v1` を [deployment.md](../guides/deployment.md) に従い **Pi5 → `raspberrypi4` → `raspi4-robodrill01` を `--limit` で1台ずつ**（キオスク要領書の対象は Pi5 + Pi4 キオスク。Pi3 サイネージ本体へのデプロイは [deployment.md §Pi3](../guides/deployment.md) の専用手順のみ別途）。
- **一括自動（Phase12）**: `./scripts/deploy/verify-phase12-real.sh`。**`GET /api/kiosk-documents` が 200** かつ JSON に **`"documents"`** があることを検証（要領書 API の回帰）。
- **サマリの目安**: Pi3・各 Pi4 へ Pi5 経由 SSH がすべて通るとき **PASS 30 / WARN 0 / FAIL 0**。Pi3 が offline / SSH 切断（`timed out` / `No route` / `offline` / **`Connection closed`**）のときは Pi3 行が **WARN** となり **PASS 29 / WARN 1** になりうる（全体は exit 0 想定。2026-03-26 より `Connection closed` を WARN に分類）。
- **記録（2026-03-25）**: 初回要領書デプロイ後に **PASS 30 / WARN 0 / FAIL 0** を確認。**ビューア改修**（コントラスト・ツールバー・近傍マウント／lazy、`06239cb1` 相当）を Pi5 → `raspberrypi4` → `raspi4-robodrill01` のみ **`--limit` 1台ずつ**で反映後、Detach Run ID 例: `20260325-214430-20154` / `214839-2765` / `215311-11636`。その後 **再度** `./scripts/deploy/verify-phase12-real.sh` を実行し **PASS 30 / WARN 0 / FAIL 0**（本セッション実測・Pi3 online 時）。
- **API の手動確認例**（Tailscale 主運用・Pi5 の例。キーは inventory の kiosk 用に合わせる）:

```bash
curl -sk -o /dev/null -w "%{http_code}\n" "https://100.106.158.2/api/kiosk-documents" \
  -H "x-client-key: client-key-raspberrypi4-kiosk1"
curl -sk "https://100.106.158.2/api/kiosk-documents" \
  -H "x-client-key: client-key-raspberrypi4-kiosk1" | head -c 500
```

- **UI（実機/VNC）**: キオスクで **「要領書」タブ** → `/kiosk/documents` で一覧・検索・一覧トグル **アイコン**・1ページ/見開き・標準幅/幅いっぱい **アイコン**・（標準幅時）拡大が使えること。検索語入力時はツールバー右に **ヒット抜粋**（または一致なしメッセージ）が出ること。管理画面 `/admin/kiosk-documents` でアップロードした PDF が一覧に出ること。

## 知見・トラブルシュート（Phase12・SSH・デプロイ）

- **推論まわりのログ確認**: 業務経路は pino で **`component: inference`**（`useCase`・`providerId`・`model`・`latencyMs`・`result` 等。**本文はログに出さない**）。`GET/POST /api/system/local-llm/*` は管理用の既定プロバイダ疎通（[ADR-20260402](../decisions/ADR-20260402-inference-foundation-phase1.md)）。
- **`update-all-clients.sh --limit <単一ホスト>`**: プリフライトの `ansible ping` も **同じ `--limit`** が付く。Pi3 を今回の対象に含めなければ、Pi3 offline でも Pi5→Pi4 の順次デプロイを進められる（Pi3 本体の更新は別途、リソース制約向け手順に従う）。
- **`Pi4 robodrill01 kiosk/status-agent` が FAIL（SSH timeout）**: Mac→Pi5→RoboDrill の **ジャンプ SSH** が一時的にタイムアウトすることがある。Tailscale・現地電源・`tailscale status` を確認し、**数分後に `./scripts/deploy/verify-phase12-real.sh` を再実行**すると PASS に戻る例がある（2026-03-25 に初回 timeout → 再実行で PASS）。
- **Phase12 で `Pi3 signage-lite/timer` が FAIL（`Connection closed`）**: Pi5 経由の Pi3 SSH が途中で切断されると、スクリプトが **FAIL** になることがあった（2026-03-26 実測）。**再実行**で Pi3 が応答すれば **PASS 30** に戻る。`verify-phase12-real.sh` は `Connection closed` を **WARN**（未到達想定）に分類するよう更新済み。Pi3 本体の保守は [deployment.md §Pi3](../guides/deployment.md) に従う。
- **`ndlocr-lite --help` で ONNX GPU discovery WARN**: API コンテナ内実行時、stderr に `GPU device discovery failed` / `/sys/class/drm/...` 参照失敗が出ることがある。**終了コード 0** かつ `which` でパスが取れればヘルスチェックは合格とみなしてよい（CPU 推論前提）。
- **Pi3 が WARN**: スクリプトは Pi3 未到達時 **WARN** にし、全体は FAIL にしない設計。サイネージの専用手順は [deployment.md §Pi3](../guides/deployment.md) および [deploy-status-recovery.md](../runbooks/deploy-status-recovery.md) を参照。
- **Mac ブラウザでキオスク UI を見たい**: 自己署名 HTTPS で `chrome-error` になりやすい。**実機キオスクまたは VNC** で `/kiosk/documents` を確認する（[KB-306](./frontend.md#kb-306-キオスク進捗一覧-製番フィルタドロップダウン端末別保存) と同趣旨）。
- **ツールバーのアイコン／文字が暗背景で見えない**: 要領書ビューアは `ghostOnDark` を使う。`ghost` のままだと意図せず非表示に近い色になる → 当該 `Button` の variant を見直す（`apps/web/src/components/ui/Button.tsx`）。
- **開発時 ESLint `import/order`**: `features/kiosk/documents` 配下でコンポーネント分割すると、**型 import と値 import のブロック順・空行**で `import/order` が落ちうる。`pnpm --filter @raspi-system/web lint` で先に確認する。
- **一覧にヒットするのにツールバー抜粋が空／逆**: 上記 **キオスクビューア UI** 節の「一覧 API の `q` との差」を参照。`extractedText` が未生成（`ocrStatus` が `PENDING` 等）のときも抜粋は出ない。
- **長大な `extractedText` で抜粋生成が重い**: `buildKioskDocumentSearchSnippetModel` は **先頭から最大3マッチまで** `RegExp#exec` で走査し、全マッチ配列は作らない（2026-03-26）。
- **バーコードが読めない／遅い（Pi4 Firefox）**: 照明・距離・ピント・ラベル汚れの影響が大きい。**一次元のみ** preset でも ZXing の連続デコードは負荷があるため、実装は **解像度・デコード間引き**を Pi 向けに調整済み（`zxingVideoReader.ts`）。改善の手戻りは **カメラ解像度制約**・**間引き間隔**・必要なら **対象形式の絞り込み**（`formatPresets`）で切り分ける。読取速度の **1 秒以内 SLA** は現場実測で確認すること（ブラウザ・CPU・コード種別で変動）。
- **スキャンを閉じたら検索欄が空になる**: **仕様**（キャンセル・未検出タイムアウト・失敗後の閉じる）。手入力の途中状態はスキャン開始前に退避しない運用。
- **ページ画像の 304 が効かない／常に 200**: ブラウザやプロキシが `If-None-Match` を **複数値・配列**で送る場合がある。API 側は `ifNoneMatchSatisfied` で **文字列と配列の両方**を解釈する（`apps/api/src/routes/storage/pdf-page-http-cache.ts`・2026-03-26）。`curl -I` で `ETag` / `Cache-Control` を確認する。
- **Network に詳細 GET が2本／チャタリング**: 上記 Symptoms のとおり **意図的な「二重取得機能」ではない**。`kioskDocumentDetailQueryOptions` の共有とキオスク一覧の **pointer のみ先読み**で切り分け（[ADR-20260327](../decisions/ADR-20260327-kiosk-document-detail-react-query-cache.md)）。
- **文書番号の大文字固定**: 確定文書番号は **接尾を大文字英数字に限定**（小文字は API バリデーションで拒否）。OCR テキスト由来の候補抽出も同一パターンに合致したものだけが候補になりうる。運用上、紙面が小文字でも確定時に大文字へ寄せる。

## References

- バーコードスキャン（ZXing・Firefox キオスク）: [ADR-20260329](../decisions/ADR-20260329-kiosk-document-barcode-scan-zxing.md)
- 詳細クエリキャッシュ方針: [ADR-20260327](../decisions/ADR-20260327-kiosk-document-detail-react-query-cache.md)
- 検索方式の判断: [ADR-20260326](../decisions/ADR-20260326-kiosk-document-free-text-substring-search.md)
- Runbook: [docs/runbooks/kiosk-documents.md](../runbooks/kiosk-documents.md)
- 実機一括検証: [scripts/deploy/verify-phase12-real.sh](../../scripts/deploy/verify-phase12-real.sh)
- 実装: `apps/api/src/routes/kiosk-documents.ts`, `apps/api/src/services/kiosk-documents/`（`kiosk-document-number.ts`・`kiosk-document-summary-candidates.ts`・検索 `search/build-kiosk-document-search-or.ts`）, `apps/api/src/routes/storage/pdf-pages.ts`, `apps/api/src/routes/storage/pdf-page-http-cache.ts`, `apps/web/src/pages/kiosk/KioskDocumentsPage.tsx`, `apps/web/src/pages/admin/KioskDocumentsAdminPage.tsx`, `apps/web/src/features/kiosk/documents/`, `apps/web/src/features/admin/kiosk-gmail-ingest-schedules/`, `apps/web/src/features/barcode-scan/`
- 孤児掃除 CLI: `apps/api/src/scripts/cleanup-pdf-storage-orphans.ts`（`pnpm --filter @raspi-system/api run cleanup:pdf-orphans`）
- 設定スキーマ: `apps/api/src/services/backup/backup-config.ts`（`kioskDocumentGmailIngest`）
