---
title: KB-313 キオスク要領書（PDF）一覧・Gmail取り込み
tags: [kiosk, pdf, gmail, api, ocr, metadata]
audience: [開発者, 運用者]
last-verified: 2026-03-26
category: knowledge-base
---

# KB-313: キオスク要領書（PDF）一覧・Gmail取り込み

## Context

キオスクに「要領書」タブ（`/kiosk/documents`）を追加し、PDFを一覧・検索・閲覧（1ページ/見開き・拡大）する。取り込み経路は **管理画面からの手動アップロード** と **Gmail 未読メールの PDF 添付**（`backup.json` 設定＋cron）の2系統。

## 主要コンポーネント

- **DB**: `KioskDocument`（`KioskDocumentSource`: `MANUAL` | `GMAIL`）、Gmail 重複防止に `gmailDedupeKey`（SHA-256）
  - OCR/分類拡張: `ocrStatus`、`extractedText`、候補値（`candidate*`）、確定値（`confirmed*`）、信頼度（`confidence*`）、`displayTitle`
  - 履歴: `KioskDocumentMetadataHistory`（変更前後値・更新者・更新時刻）
- **API**（`/api/kiosk-documents`）:
  - `GET` 一覧・`GET :id` 詳細（`pageUrls`）: `x-client-key` または JWT（ADMIN/MANAGER/VIEWER）
  - `POST` 手動アップロード: ADMIN/MANAGER
  - `POST /ingest-gmail`: ADMIN/MANAGER（手動トリガ）
  - `POST /:id/reprocess`: 文書1件の OCR/抽出再処理（ADMIN/MANAGER）
  - `POST /run-nightly-ocr`: 夜間OCR処理の手動実行（ADMIN/MANAGER）
  - `PATCH /:id/metadata`: 確定メタデータ編集（候補は保持）
  - `PATCH` / `DELETE`: ADMIN/MANAGER
- **ページ画像**: `PdfStorage.convertPdfToPages`（要領書は `PdfStorageRenderAdapter` 経由で **キオスク専用 DPI/品質** を指定可）→ `GET /api/storage/pdf-pages/:pdfId/:filename`（JPEG 時は `image/jpeg` を返却）
- **Gmail**: `GmailApiClient.listPdfAttachments` で PDF のみ列挙。検索クエリは `buildKioskDocumentGmailSearchQuery`（件名・任意 `from`・`is:unread`）

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

サイネージは従来どおり `SIGNAGE_PDF_DPI`（未設定時 150）を `convertPdfToPages` のデフォルトとして利用する。**要領書だけ** Pi4 向けに軽くしたい場合は上記 2 つを API コンテナに設定する。

**キャッシュ注意**: `pdf-pages/{文書UUID}/` に既に `.jpg` があると **再変換されない**。DPI/品質を変えたあと画質が変わらないときは、当該ディレクトリを削除するか、管理画面で該当文書を削除して再登録する（運用は [kiosk-documents.md runbook](../runbooks/kiosk-documents.md) 参照）。

### ストレージ掃除（孤児ファイル）

DB に無い `pdf-pages` サブディレクトリ（UUID 形式）や `pdfs` 内の未参照 `.pdf` を検出・削除する CLI がある（既定は dry-run）。

- `pnpm --filter @raspi-system/api run cleanup:pdf-orphans`（dry-run）
- `pnpm --filter @raspi-system/api exec tsx src/scripts/cleanup-pdf-storage-orphans.ts --execute`（実削除）

誤削除防止のため、**初回は必ず dry-run で一覧を確認**すること。

## Symptoms / よくある事象

- **Gmail から取り込まれない**: `storage.provider` が `gmail` でない、トークン欠落、`kioskDocumentGmailIngest` が空/無効、件名が一致しない、添付が PDF でない
- **一覧に出ない**: 管理画面で `enabled=false`、キオスクは有効なもののみ表示
- **画像が出ない**: PDF 変換失敗（Pi 上の変換ツール・ストレージパス）、`pageUrls` が空
- **抽出が失敗し続ける**: API コンテナに同梱された **NDLOCR-Lite** が見えているか（`which ndlocr-lite` / `ndlocr-lite --help`）。`KIOSK_DOCUMENT_NDLOCR_SCRIPT` を使う場合はパスの存在と Python 実行権限を確認。`pdftotext` だけではスキャン PDF は空になり、OCR 分岐に入る。
- **OCR なのに文字がほぼ空**: 旧実装は `ndlocr-lite <pdf>`（stdout 想定）で **NDLOCR-Lite 実 CLI と不一致**だった。現行は PDF→`pdftoppm`→ページごとに `--sourceimg`/`--output` で `.txt` を収集。独自ラッパーは `KIOSK_DOCUMENT_OCR_LEGACY_STDOUT=true` で従来契約に戻す。
- **拡大（ズーム）が効かない**: 表示モードが **幅いっぱい** のときは仕様で無効。**標準幅** に戻すと拡大 UI が有効になる

## Investigation

1. 管理 `/admin/kiosk-documents` で手動アップロードが成功するか
2. API `GET /api/kiosk-documents`（端末の `x-client-key`）で `documents` が返るか
3. `GET /api/kiosk-documents/:id` で `pageUrls` が非空か
4. Gmail: `backup.json` の `kioskDocumentGmailIngest` と Gmail トークン、API ログ `[KioskDocumentGmailIngestion]`

## 仕様（運用で押さえる点）

- **キオスク URL**: `/kiosk/documents`。沉浸式レイアウト（上端ホバーでヘッダー表示）は [KB-311](./KB-311-kiosk-immersive-header-allowlist.md) の allowlist に含める。
- **認可**: 一覧・詳細は **登録端末の `x-client-key`** または **JWT（ADMIN / MANAGER / VIEWER）**。アップロード・Gmail 取り込み・PATCH/DELETE は **ADMIN / MANAGER**。
- **キオスク一覧**: `enabled=true` の行のみ（無効化した文書は管理画面では見えるがキオスクでは出ない）。
- **重複**: Gmail は `gmailDedupeKey`（メッセージID＋添付ファイル名などから生成）で一意。手動は Gmail と別系統で複数可。

### フリーワード検索（`q`）

- 一覧 API の `q` は、ルートで `normalizeDocumentText`（NFKC・連続空白の圧縮・小文字化）したあと、**タイトル系・ファイル名・`extractedText`・確定メタ**（管理画面では `includeCandidates=true` のとき **候補メタ**も）に対して **部分一致**でマッチする。実装は Prisma の `contains`（PostgreSQL では `ILIKE '%…%'` 相当、大文字小文字は区別しない）。
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
- **表示速度・スクロール（2026-03-26 以降）**: 一覧行の **ホバー／フォーカス**で `GET /api/kiosk-documents/:id` を **デバウンス付きでプリフェッチ**（`useKioskDocumentListPrefetch`・React Query `prefetchQuery`）。IO の `activeIndex` 更新は **requestAnimationFrame で 1 フレームに 1 回**に間引き、近傍半径・`rootMargin` は `kioskDocumentViewerScrollPolicy.ts` に集約（Pi で重い場合は定数調整）。ページ画像 `GET /api/storage/pdf-pages/...` は **ETag**（`size-mtimeMs`）と **304**、および **`Cache-Control`**（既定は長めの `public` + `stale-while-revalidate`。上書きは `PDF_PAGES_CACHE_CONTROL`）でブラウザキャッシュを効かせる。
- **実装分割**: `apps/web/src/features/kiosk/documents/`（`search/kiosk-document-search-snippets.ts`・`KioskDocumentSearchSnippetStrip.tsx`・`kioskDocumentsToolbarIcons.tsx`・`kioskDocumentQueryKeys.ts`・`useKioskDocumentListPrefetch.ts`・`kioskDocumentViewerScrollPolicy.ts`）。ページは `apps/web/src/pages/kiosk/KioskDocumentsPage.tsx`。

## 実機検証

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
- **ページ画像の 304 が効かない／常に 200**: ブラウザやプロキシが `If-None-Match` を **複数値・配列**で送る場合がある。API 側は `ifNoneMatchSatisfied` で **文字列と配列の両方**を解釈する（`apps/api/src/routes/storage/pdf-page-http-cache.ts`・2026-03-26）。`curl -I` で `ETag` / `Cache-Control` を確認する。

## References

- 検索方式の判断: [ADR-20260326](../decisions/ADR-20260326-kiosk-document-free-text-substring-search.md)
- Runbook: [docs/runbooks/kiosk-documents.md](../runbooks/kiosk-documents.md)
- 実機一括検証: [scripts/deploy/verify-phase12-real.sh](../../scripts/deploy/verify-phase12-real.sh)
- 実装: `apps/api/src/routes/kiosk-documents.ts`, `apps/api/src/services/kiosk-documents/`, `apps/api/src/routes/storage/pdf-pages.ts`, `apps/api/src/routes/storage/pdf-page-http-cache.ts`, `apps/web/src/pages/kiosk/KioskDocumentsPage.tsx`, `apps/web/src/features/kiosk/documents/`
- 孤児掃除 CLI: `apps/api/src/scripts/cleanup-pdf-storage-orphans.ts`（`pnpm --filter @raspi-system/api run cleanup:pdf-orphans`）
- 設定スキーマ: `apps/api/src/services/backup/backup-config.ts`（`kioskDocumentGmailIngest`）
