---
title: "KB-326: 手動CSVダッシュボード取込で部品納期個数（補助）がキオスクに反映されない"
tags: [csv-dashboard, production-schedule, ProductionScheduleOrderSupplement, manual-upload]
audience: [開発者, 運用者]
last-verified: 2026-04-03
related:
  - ./KB-324-gmail-order-supplement-prisma-transaction.md
  - ../guides/csv-import-export.md
category: knowledge-base
---

# KB-326: 手動CSVダッシュボード取込で部品納期個数（補助）がキオスクに反映されない

## Context

- 部品納期個数は **補助CSVダッシュボード**（ID: `PRODUCTION_SCHEDULE_ORDER_SUPPLEMENT_DASHBOARD_ID`）を取り込んだあと、`ProductionScheduleOrderSupplement` へ同期され、キオスクAPIの `plannedQuantity` / `plannedEndDate` 等として返る。
- 運用で **管理画面からCSVを手動アップロード**（`POST /api/csv-dashboards/:id/upload`）した場合、補助CSVは `CsvDashboardRow` には入るが、画面上の個数・納期が空のままという報告があった。

## Symptoms

- 補助CSVの行はダッシュボード側に取り込めるが、生産スケジュール画面で納期・指示数が `-` のまま。
- Gmail経由の同じ補助CSVでは期待どおり反映される（または以前はGmailのみ同期が走っていた）。

## Investigation

- **H1（CONFIRMED）**: Gmail取込は `CsvDashboardImportService` 内で取込直後に `syncFromSupplementDashboard()` を呼んでいたが、手動アップロードは `ingestFromGmail` のみで **同期呼び出しが無かった**。

## Root cause

- 取込後処理（補助同期）が **Gmail経路にだけ実装**され、**HTTP手動アップロード経路が取り残されていた**（実装非対称）。

## Fix

- `CsvDashboardPostIngestService` を追加し、補助ダッシュボードIDのときに **`ProductionScheduleOrderSupplementSyncService.syncFromSupplementDashboard()` を1箇所から実行**する。
- `CsvDashboardImportService`（Gmail）と `csv-dashboards` ルート（手動upload）の両方から当該サービスを呼ぶ。
- 手動uploadの応答に、運用向けに `orderSupplementSync`（matched/unmatched 等）を **値があるときのみ** 付与。

## Prevention

- 取込後フックを増やす場合は `CsvDashboardPostIngestService` に集約し、**経路別にロジックを複製しない**。

## Production verification（2026-04-03）

- **デプロイ**: Pi5 のみ `scripts/update-all-clients.sh`（`--limit raspberrypi5 --detach --follow`）。`PLAY RECAP` で **failed=0**。
- **実機回帰**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 41 / WARN 0 / FAIL 0**（補助予定 `plannedQuantity` 系の grep 含む。スクリプト項目数は他機能追加に伴い 40→41 へ増加済み）。
- **ブランチ**: `fix/manual-upload-order-supplement-post-ingest`（本番反映後に上記を実行）。

## Troubleshooting

- **手動アップロード後も `-` のまま**: 補助ダッシュボード ID かどうか（`PRODUCTION_SCHEDULE_ORDER_SUPPLEMENT_DASHBOARD_ID`）を確認。本体ダッシュボードへアップロードした場合は post-ingest の対象外。
- **応答の `orderSupplementSync`**: 補助ダッシュボードかつ同期結果があるときのみ JSON に含まれる。401/権限は管理コンソールのセッションとルートを確認。
- **Gmail は動くが手動だけダメだった旧症状**: 本 KB の Root cause（経路非対称）を修正済み。Prisma `Transaction not found` 系は [KB-324](./KB-324-gmail-order-supplement-prisma-transaction.md) を参照。

## References

- 実装: `apps/api/src/services/csv-dashboard/csv-dashboard-post-ingest.service.ts`
- 手動upload: `apps/api/src/routes/csv-dashboards/index.ts`
- Gmail取込: `apps/api/src/services/csv-dashboard/csv-dashboard-import.service.ts`
- 関連: [KB-324](./KB-324-gmail-order-supplement-prisma-transaction.md)
