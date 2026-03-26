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
| `KIOSK_DOCUMENT_OCR_COMMAND` | OCRエンジン実行コマンド（NDLOCR-Lite想定） | `ndlocr-lite` |

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
- **抽出が失敗し続ける**: OCRコマンド未導入/失敗、`ocrFailureReason` と alert delivery を確認
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

### キオスクビューア UI（`/kiosk/documents`・2026-03）

- 左ペイン（検索・取込元フィルタ・一覧）は **既定で表示**。「**一覧を隠す**」で閉じ、ビューア側の表示幅を広げられる。
- 右側: **1ページ** / **見開き**、**標準幅** / **幅いっぱい**（ビュー幅にフィット）、縦スクロール。
- **拡大（ズーム）**は **標準幅** 表示時のみ有効。**幅いっぱい** 時は無効（二重スケールを避ける仕様）。
- **コントラスト（ダーク UI）**: ビューア上部ツールバー等で `Button` の **`ghostOnDark`** variant を使う（従来 `ghost` は `!text-slate-900` 系で **暗背景では文字が見えない**）。ライト専用の `ghost` と分離する。
- **ツールバー**: `KioskDocumentsViewerToolbar` でタイトル行と操作行を分離し、長い文書名でも **2行目にタイトル**を回して溢れを抑える。
- **Pi4 スクロール負荷軽減**: `useKioskDocumentNearVisibleRows` がスクロールコンテナを `root` とする `IntersectionObserver` で **近傍のページ行だけ** `<img>` をマウント。`KioskDocumentViewerPageRow` は **プレースホルダ**・`loading="lazy"`・`decoding="async"`。近傍インデックス計算は `kioskDocumentViewerVisibility.ts` の純関数＋ Vitest（`kioskDocumentViewerVisibility.test.ts`）で固定。
- 実装の主たる分割先: `apps/web/src/features/kiosk/documents/`（ページは `apps/web/src/pages/kiosk/KioskDocumentsPage.tsx`）。

## 実機検証

- **デプロイ（要領書・ビューア改修）**: ブランチ `feature/kiosk-documents-v1` を [deployment.md](../guides/deployment.md) に従い **Pi5 → `raspberrypi4` → `raspi4-robodrill01` を `--limit` で1台ずつ**（キオスク要領書の対象は Pi5 + Pi4 キオスク。Pi3 サイネージ本体へのデプロイは [deployment.md §Pi3](../guides/deployment.md) の専用手順のみ別途）。
- **一括自動（Phase12）**: `./scripts/deploy/verify-phase12-real.sh`。**`GET /api/kiosk-documents` が 200** かつ JSON に **`"documents"`** があることを検証（要領書 API の回帰）。
- **サマリの目安**: Pi3・各 Pi4 へ Pi5 経由 SSH がすべて通るとき **PASS 30 / WARN 0 / FAIL 0**。Pi3 が offline のときは Pi3 行が **WARN** となり **PASS 29 / WARN 1** になりうる（全体は FAIL にしない設計）。
- **記録（2026-03-25）**: 初回要領書デプロイ後に **PASS 30 / WARN 0 / FAIL 0** を確認。**ビューア改修**（コントラスト・ツールバー・近傍マウント／lazy、`06239cb1` 相当）を Pi5 → `raspberrypi4` → `raspi4-robodrill01` のみ **`--limit` 1台ずつ**で反映後、Detach Run ID 例: `20260325-214430-20154` / `214839-2765` / `215311-11636`。その後 **再度** `./scripts/deploy/verify-phase12-real.sh` を実行し **PASS 30 / WARN 0 / FAIL 0**（本セッション実測・Pi3 online 時）。
- **API の手動確認例**（Tailscale 主運用・Pi5 の例。キーは inventory の kiosk 用に合わせる）:

```bash
curl -sk -o /dev/null -w "%{http_code}\n" "https://100.106.158.2/api/kiosk-documents" \
  -H "x-client-key: client-key-raspberrypi4-kiosk1"
curl -sk "https://100.106.158.2/api/kiosk-documents" \
  -H "x-client-key: client-key-raspberrypi4-kiosk1" | head -c 500
```

- **UI（実機/VNC）**: キオスクで **「要領書」タブ** → `/kiosk/documents` で一覧・検索・「一覧を隠す」・1ページ/見開き・標準幅/幅いっぱい・（標準幅時）拡大が使えること。管理画面 `/admin/kiosk-documents` でアップロードした PDF が一覧に出ること。

## 知見・トラブルシュート（Phase12・SSH・デプロイ）

- **`update-all-clients.sh --limit <単一ホスト>`**: プリフライトの `ansible ping` も **同じ `--limit`** が付く。Pi3 を今回の対象に含めなければ、Pi3 offline でも Pi5→Pi4 の順次デプロイを進められる（Pi3 本体の更新は別途、リソース制約向け手順に従う）。
- **`Pi4 robodrill01 kiosk/status-agent` が FAIL（SSH timeout）**: Mac→Pi5→RoboDrill の **ジャンプ SSH** が一時的にタイムアウトすることがある。Tailscale・現地電源・`tailscale status` を確認し、**数分後に `./scripts/deploy/verify-phase12-real.sh` を再実行**すると PASS に戻る例がある（2026-03-25 に初回 timeout → 再実行で PASS）。
- **Pi3 が WARN**: スクリプトは Pi3 未到達時 **WARN** にし、全体は FAIL にしない設計。サイネージの専用手順は [deployment.md §Pi3](../guides/deployment.md) および [deploy-status-recovery.md](../runbooks/deploy-status-recovery.md) を参照。
- **Mac ブラウザでキオスク UI を見たい**: 自己署名 HTTPS で `chrome-error` になりやすい。**実機キオスクまたは VNC** で `/kiosk/documents` を確認する（[KB-306](./frontend.md#kb-306-キオスク進捗一覧-製番フィルタドロップダウン端末別保存) と同趣旨）。
- **ツールバーのアイコン／文字が暗背景で見えない**: 要領書ビューアは `ghostOnDark` を使う。`ghost` のままだと意図せず非表示に近い色になる → 当該 `Button` の variant を見直す（`apps/web/src/components/ui/Button.tsx`）。
- **開発時 ESLint `import/order`**: `features/kiosk/documents` 配下でコンポーネント分割すると、**型 import と値 import のブロック順・空行**で `import/order` が落ちうる。`pnpm --filter @raspi-system/web lint` で先に確認する。

## References

- Runbook: [docs/runbooks/kiosk-documents.md](../runbooks/kiosk-documents.md)
- 実機一括検証: [scripts/deploy/verify-phase12-real.sh](../../scripts/deploy/verify-phase12-real.sh)
- 実装: `apps/api/src/routes/kiosk-documents.ts`, `apps/api/src/services/kiosk-documents/`, `apps/web/src/pages/kiosk/KioskDocumentsPage.tsx`, `apps/web/src/features/kiosk/documents/`
- 孤児掃除 CLI: `apps/api/src/scripts/cleanup-pdf-storage-orphans.ts`（`pnpm --filter @raspi-system/api run cleanup:pdf-orphans`）
- 設定スキーマ: `apps/api/src/services/backup/backup-config.ts`（`kioskDocumentGmailIngest`）
