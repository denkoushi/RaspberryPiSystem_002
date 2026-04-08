# 要領書 HTML Gmail 取り込み — 検証計画

**目的**: HTML 添付の Gmail 取り込み（PDF 化→既存パイプライン）の品質を、自動テストと手動確認で担保する。

**関連実装**: `GmailApiClient.listHtmlAttachments`、`PlaywrightHtmlToPdfAdapter`、`KioskDocumentService.createFromGmailHtmlAttachment`、`KioskDocumentGmailIngestionService`（`htmlImported` / `htmlSkippedDuplicate`）。

## 単体テスト（Vitest）

| 項目 | ファイル | 確認内容 |
|------|----------|----------|
| HTML 添付の MIME / 拡張子で列挙 | `apps/api/src/services/backup/__tests__/gmail-api-client.test.ts` | `listHtmlAttachments` が `text/html` / `application/xhtml+xml` / `.html` / `.htm` を拾う |
| 保存 PDF ファイル名の派生 | `apps/api/src/services/kiosk-documents/__tests__/kiosk-document-gmail-ingestion.query.test.ts` | `deriveStoragePdfFilenameFromHtmlAttachment` |
| サービス: HtmlToPdf 未設定・モック経路 | `apps/api/src/services/kiosk-documents/__tests__/kiosk-document-html-gmail.service.test.ts` | アダプタ無しでエラー、モックで登録フロー |

**実行例**:

```bash
pnpm --filter @raspi-system/api exec vitest run \
  src/services/backup/__tests__/gmail-api-client.test.ts \
  src/services/kiosk-documents/__tests__/kiosk-document-gmail-ingestion.query.test.ts \
  src/services/kiosk-documents/__tests__/kiosk-document-html-gmail.service.test.ts
```

## 統合・API（推奨）

| 項目 | 手順 | 期待結果 |
|------|------|----------|
| 手動 ingest | `POST /api/kiosk-documents/ingest-gmail`（ADMIN/MANAGER JWT）、対象 `scheduleId` を指定可 | レスポンスに `htmlImported` ≥ 0 または対象メールなし。重複時 `htmlSkippedDuplicate` |
| DB・ページ URL | 取り込み直後 `GET /api/kiosk-documents/:id` | `pageUrls` が非空（PDF ページ画像化成功） |
| 重複 | 同一未読メールを再度処理しない設計のため、初回後は `htmlSkippedDuplicate` またはメール既読でスキップ | 同一 `gmailDedupeKey` で二重登録されない |

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
