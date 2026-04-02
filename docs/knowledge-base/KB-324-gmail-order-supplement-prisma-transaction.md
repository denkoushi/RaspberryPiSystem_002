---
title: "KB-324: Gmail 部品納期個数 CSV 取込で ProductionScheduleOrderSupplement 同期が Prisma Transaction not found で失敗"
tags: [gmail, csv-import, production-schedule, prisma, ProductionScheduleOrderSupplement]
audience: [開発者, 運用者]
last-verified: 2026-04-02
related:
  - ./KB-297-kiosk-due-management-workflow.md
  - ../guides/csv-import-export.md
category: knowledge-base
---

# KB-324: Gmail 部品納期個数 CSV 取込で ProductionScheduleOrderSupplement 同期が Prisma Transaction not found で失敗

## Context

- 件名 `部品納期個数` の補助 CSV を Gmail 経由で取り込む際、手動実行で **`Transaction not found` / `Transaction ID is invalid`** 系の Prisma エラーが出る事象があった。
- 同期失敗時は [`CsvDashboardImportService`](../../apps/api/src/services/csv-dashboard/csv-dashboard-import.service.ts) の設計どおり、**Gmail 既読化・ゴミ箱移動まで到達しない**ため、**受信箱に未読のまま残る**。

## Symptoms

- 管理 UI / API の手動インポートで、`prisma.productionScheduleOrderSupplement.upsert`（インタラクティブトランザクション内）で失敗。
- ログに `Transaction API error: Transaction not found` 等が出る。
- Gmail 側は未読のまま（再試行のため意図的に残る挙動と整合）。

## Investigation

- **H1（CONFIRMED）**: 1 つの `$transaction(async (tx) => …)` の中で **`$queryRaw` の後、照合成功行ぶん逐次 `await tx…upsert`** しており、件数・DB 遅延次第で **インタラクティブトランザクションの既定タイムアウト付近を超えうる**。
- **H2（CONFIRMED）**: `ProductionScheduleOrderSupplement` に **`csvDashboardRowId` 一意**と **`(csvDashboardId, sourceCsvDashboardId, productNo, resourceCd, processOrder)` 一意**の両方がある。旧 winner 行 ID に紐づく行が残ったまま新 winner へ **`upsert` の create 分岐**に入ると、**複合一意衝突（P2002）や中途失敗**を誘発しうる（削除/prune が upsert **後**だった旧実装）。

## Root cause

- 補助同期を **長いインタラクティブトランザクション + 行単位 upsert** で実装していたこと。
- 上記に加え、**winner 行の付け替え**と **2 系統のユニーク制約**の組み合わせで、**upsert 順序だけでは衝突を避けきれない**構造だった。

## Fix

- 実装をパイプライン化: **読み取り・正規化・照合はトランザクション外**、`ProductionScheduleOrderSupplement` への反映は **「当該ソースの行をすべて削除 → 照合済み行を `createMany` でバッチ投入」** の **短い**インタラクティブトランザクションに変更。
- `$transaction` に **`timeout` / `maxWait` を明示**し、Pi 等の遅い環境でも既定 5 秒帽に縛られにくくする。
- コード配置: [`order-supplement-sync.pipeline.ts`](../../apps/api/src/services/production-schedule/order-supplement-sync.pipeline.ts)（純関数・読み取り・書き込み計画）＋[`order-supplement-sync.service.ts`](../../apps/api/src/services/production-schedule/order-supplement-sync.service.ts)（オーケストレーション）。

## Prevention

- 補助同期の回帰テストで **deleteMany → createMany** と **winner 行 ID 付け替え**をカバー（[`order-supplement-sync.service.test.ts`](../../apps/api/src/services/production-schedule/__tests__/order-supplement-sync.service.test.ts)）。
- 大量行時は `createMany` のチャンクサイズ（既定 200）で負荷を抑える。さらに増える場合はチャンク定数の見直しまたは運用で CSV 分割を検討。

## References

- 関連ドキュメント: [KB-297 §部品納期個数](./KB-297-kiosk-due-management-workflow.md#部品納期個数csvの補助反映2026-04-01)
- Runbook: [csv-import-export.md](../guides/csv-import-export.md)
