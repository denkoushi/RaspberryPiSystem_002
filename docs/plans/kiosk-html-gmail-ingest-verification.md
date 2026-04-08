# 要領書 HTML Gmail 取り込み — 検証計画

**目的**: HTML 添付の Gmail 取り込み（PDF 化→既存パイプライン）の品質を、自動テストと手動確認で担保する。

**関連実装**: `GmailApiClient.listHtmlAttachments`・`getMessageInternalDateMs`、`PlaywrightHtmlToPdfAdapter`、`KioskDocumentService.createFromGmailHtmlAttachment`、`kiosk-document-gmail-logical-key`（`normalizeKioskGmailLogicalKey`）、`KioskDocumentGmailIngestionService`（`htmlImported` / `htmlUpdated` / `htmlSkippedDuplicate` / `htmlSkippedOlderMail` 等）。

## 単体テスト（Vitest）

| 項目 | ファイル | 確認内容 |
|------|----------|----------|
| HTML 添付の MIME / 拡張子で列挙 | `apps/api/src/services/backup/__tests__/gmail-api-client.test.ts` | `listHtmlAttachments` が `text/html` / `application/xhtml+xml` / `.html` / `.htm` を拾う |
| 保存 PDF ファイル名の派生 | `apps/api/src/services/kiosk-documents/__tests__/kiosk-document-gmail-ingestion.query.test.ts` | `deriveStoragePdfFilenameFromHtmlAttachment` |
| サービス: HtmlToPdf 未設定・モック経路 | `apps/api/src/services/kiosk-documents/__tests__/kiosk-document-html-gmail.service.test.ts` | アダプタ無しでエラー、モックで登録フロー |
| 論理キー正規化 | `apps/api/src/services/kiosk-documents/__tests__/kiosk-document-gmail-logical-key.test.ts` | `normalizeKioskGmailLogicalKey` |
| Gmail 上書き（PDF） | `apps/api/src/services/kiosk-documents/__tests__/kiosk-document-gmail-upsert.service.test.ts` | 同一メールスキップ・日付古いスキップ・更新時 `deletePageImages` |

**実行例**:

```bash
pnpm --filter @raspi-system/api exec vitest run \
  src/services/backup/__tests__/gmail-api-client.test.ts \
  src/services/kiosk-documents/__tests__/kiosk-document-gmail-ingestion.query.test.ts \
  src/services/kiosk-documents/__tests__/kiosk-document-html-gmail.service.test.ts \
  src/services/kiosk-documents/__tests__/kiosk-document-gmail-logical-key.test.ts \
  src/services/kiosk-documents/__tests__/kiosk-document-gmail-upsert.service.test.ts
```

## 統合・API（推奨）

| 項目 | 手順 | 期待結果 |
|------|------|----------|
| 手動 ingest | `POST /api/kiosk-documents/ingest-gmail`（ADMIN/MANAGER JWT）、対象 `scheduleId` を指定可 | レスポンスに各カウンタ ≥ 0 または対象メールなし。**同一メール再実行**は `htmlSkippedDuplicate`。**同名・別メールの更新**は `htmlUpdated` |
| DB・ページ URL | 取り込み直後 `GET /api/kiosk-documents/:id` | `pageUrls` が非空（PDF ページ画像化成功） |
| 重複・上書き | 同一未読メールの再処理は `htmlSkippedDuplicate`。**別メール・同一添付名**は `gmailLogicalKey` で **新しい** `internalDate` のみが既存行を更新（`htmlUpdated`）。古いメールは `htmlSkippedOlderMail` | 同一 `gmailDedupeKey` で二重登録されない。論理キーは DB 一意 |

**注意**: 実 Gmail・実 Chromium が必要。CI で常時実行しない場合はステージングまたはデプロイ後の手動で実施。

## 手動（運用）

| # | 手順 | 期待 |
|---|------|------|
| 1 | `backup.json` に `kioskDocumentGmailIngest`（例: `subjectPattern`: `要領書HTML研削`）、`storage.provider=gmail`、OAuth 済み | スケジュールが有効 |
| 2 | **未読**で件名一致・HTML 添付のメールを送信 | cron または管理画面「Gmailから取り込み」で取り込まれる |
| 3 | `/admin/kiosk-documents` | 新規行、ソース GMAIL、必要なら OCR 進行を確認 |
| 4 | `/kiosk/documents` | 一覧・閲覧・検索が既存 PDF と同様に動く |
| 5 | 失敗時 | API ログ `[PlaywrightHtmlToPdf]`、`KIOSK_DOCUMENT_HTML_TO_PDF_TIMEOUT_MS`、[Runbook: kiosk-documents](../runbooks/kiosk-documents.md) |

## 回帰

- 従来の **PDF のみ** 添付メールは従来どおり `pdfsImported` で取り込まれること。
- 同一メッセージに PDF と HTML がある場合、**両方**処理されうる（添付ごとに重複キーが異なる）。

## 本番デプロイ後（Phase12 自動検証）

- **API 変更の反映先**: [deployment.md](../guides/deployment.md) に従い **Pi5（`raspberrypi5`）のみ**で可（**API/DBのみ**の判断）。
- **コマンド**: `./scripts/deploy/verify-phase12-real.sh`（**`GET /api/kiosk-documents`** を含む）。
- **知見（2026-04-08）**: 匿名 **`GET /api/signage/content`** が **`contentType: TOOLS`**（工場表示の持出一覧等）のとき、レスポンスに **`layoutConfig` が無いのは正常**。`verify-phase12-real.sh` は当該ケースを **PASS** とみなすよう更新済み。

### 本番記録（2026-04-08・運用指示）

- **デプロイスコープ**: **`raspberrypi5` のみ**（API/DB。キオスク Pi4・サイネージ Pi3 は今回の変更不要。**Pi3 のリソース制約向け専用手順は未実施**）。
- **手順**: [deployment.md](../guides/deployment.md) の `update-all-clients.sh`・`RASPI_SERVER_HOST`・`--limit raspberrypi5`・`--detach --follow`。
- **結果**: Pi5 上 `logs/deploy/ansible-update-20260408-154206-25754.summary.json`（**`PLAY RECAP` `failed=0` / `unreachable=0`**）。
- **Phase12（Mac / Tailscale）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 42 / WARN 1 / FAIL 0**（**WARN**: auto-tuning スケジューラのログ件数 0。スクリプトは **PUT auto-generate=200** を代替合格とする）。
- **手動 E2E（2026-04-08/09 反映済）**: 未読・件名一致・HTML 添付の初回取り込みに加え、**同一 HTML を別メールで再送**するケースを本番で確認。根拠データ・SQL/ストレージ手順は [KB-313 §実機検証（本番データ）](../knowledge-base/KB-313-kiosk-documents.md#実機検証)・[kiosk-documents Runbook](../runbooks/kiosk-documents.md)。

### 本番記録（2026-04-08/09・同名 HTML・別メール上書き）

- **事象**: 運用で **同一内容の HTML 添付**を **別メール**から送信（前夜〜翌朝のスケジュール取り込み）。
- **確認先**: Pi5 **`KioskDocument`** テーブル（PostgreSQL `borrow_return`）・API コンテナ **`/app/storage/pdf-pages/{文書UUID}/`**。
- **観測（代表・タイトル `SD000032603_研削_OP-01`）**:
  - **有効**1 行: `gmailLogicalKey`=`sd000032603_研削_op-01.html`（正規化済み）・`gmailInternalDateMs` が **新メール側**・`gmailMessageId` が **新メールの ID** に更新・`updatedAt` が取り込み実行時刻付近。
  - **旧行**: `enabled=false`・論理キーなし（一覧・キオスクは有効行のみ）。
  - **ページ JPEG**: 同一文書 UUID 配下で **再生成**（mtime 取り込み直後・**1490×2108** = 180dpi 既定と一致）。
- **結論**: **`gmailLogicalKey` + `internalDate` による upsert**が本番で意図どおり動作。**参照**: [KB-313](../knowledge-base/KB-313-kiosk-documents.md)・[kiosk-documents.md](../runbooks/kiosk-documents.md)。
