---
title: KB-313 キオスク要領書（PDF）一覧・Gmail取り込み
tags: [kiosk, pdf, gmail, api]
audience: [開発者, 運用者]
last-verified: 2026-03-25
category: knowledge-base
---

# KB-313: キオスク要領書（PDF）一覧・Gmail取り込み

## Context

キオスクに「要領書」タブ（`/kiosk/documents`）を追加し、PDFを一覧・検索・閲覧（1ページ/見開き・拡大）する。取り込み経路は **管理画面からの手動アップロード** と **Gmail 未読メールの PDF 添付**（`backup.json` 設定＋cron）の2系統。

## 主要コンポーネント

- **DB**: `KioskDocument`（`KioskDocumentSource`: `MANUAL` | `GMAIL`）、Gmail 重複防止に `gmailDedupeKey`（SHA-256）
- **API**（`/api/kiosk-documents`）:
  - `GET` 一覧・`GET :id` 詳細（`pageUrls`）: `x-client-key` または JWT（ADMIN/MANAGER/VIEWER）
  - `POST` 手動アップロード: ADMIN/MANAGER
  - `POST /ingest-gmail`: ADMIN/MANAGER（手動トリガ）
  - `PATCH` / `DELETE`: ADMIN/MANAGER
- **ページ画像**: 既存 `PdfStorage.convertPdfToPages` → `GET /api/storage/pdf-pages/:pdfId/:filename`（JPEG 時は `image/jpeg` を返却）
- **Gmail**: `GmailApiClient.listPdfAttachments` で PDF のみ列挙。検索クエリは `buildKioskDocumentGmailSearchQuery`（件名・任意 `from`・`is:unread`）

## Symptoms / よくある事象

- **Gmail から取り込まれない**: `storage.provider` が `gmail` でない、トークン欠落、`kioskDocumentGmailIngest` が空/無効、件名が一致しない、添付が PDF でない
- **一覧に出ない**: 管理画面で `enabled=false`、キオスクは有効なもののみ表示
- **画像が出ない**: PDF 変換失敗（Pi 上の変換ツール・ストレージパス）、`pageUrls` が空

## Investigation

1. 管理 `/admin/kiosk-documents` で手動アップロードが成功するか
2. API `GET /api/kiosk-documents`（端末の `x-client-key`）で `documents` が返るか
3. `GET /api/kiosk-documents/:id` で `pageUrls` が非空か
4. Gmail: `backup.json` の `kioskDocumentGmailIngest` と Gmail トークン、API ログ `[KioskDocumentGmailIngestion]`

## References

- Runbook: [docs/runbooks/kiosk-documents.md](../runbooks/kiosk-documents.md)
- 実装: `apps/api/src/routes/kiosk-documents.ts`, `apps/api/src/services/kiosk-documents/`, `apps/web/src/pages/kiosk/KioskDocumentsPage.tsx`
- 設定スキーマ: `apps/api/src/services/backup/backup-config.ts`（`kioskDocumentGmailIngest`）
