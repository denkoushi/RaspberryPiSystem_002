---
title: KB-375 順位ボード・生産日程の完了整合（明示完了API・CSV同期・実効完了）
tags: [キオスク, 生産スケジュール, 順位ボード, 完了, CSV, ナレッジ]
audience: [開発者, 運用者]
last-verified: 2026-05-09
related: [KB-297-kiosk-due-management-workflow.md, KB-369-leader-order-board-api-internal-latency.md]
category: knowledge-base
update-frequency: medium
---

# KB-375: 順位ボード・生産日程の完了整合（明示完了・CSVガード・実効完了）

## Context

キオスクの **生産日程一覧・順位ボード**では、行の **✓（完了）** と **資源CDフッタチップ**・**納期管理側の集計**が **同じ完了意味**を指す必要がある。一方で **生産日程CSV** の `progress` 列は **空や欠落**があり得るため、**手動で完了にした行**が **CSV再取込だけで未完に戻る**と現場混乱の原因になる。また **従来の `PUT …/complete` はトグル**のため、**同一操作の二重送信**で **意図せず未完へ戻る**リスクがある。

## Symptoms

- 手動完了したはずの行が、**CSV同期後**に **グレーアウトが外れる**（`ProductionScheduleProgress.isCompleted` が落ちる）。
- **同じ「完了」操作**を繰り返した際、**トグル**で **未完了に戻る**。
- 一覧行と **フッタチップ**／**納期アシスト集計**で **完了の見え方が食い違う**（実装ごとに判定が分岐していた）。

## Investigation

- **CONFIRMED**: `PUT /api/kiosk/production-schedule/:rowId/complete` は **`driveProductionScheduleRowCompletion` の `toggle`**（`production-schedule-command.service.ts`）。
- **CONFIRMED**: **`PUT …/completion`** + `{ intent: 'complete' | 'incomplete' }` は **目標状態へ収束**。**同じ intent の再適用**は **`unchanged: true`** で **DB更新なし**。
- **CONFIRMED**: CSV→`ProductionScheduleProgress` 同期は **`progress-csv-sync-decision.policy.ts`** で **`progress === ''` かつ既存 `isCompleted === true`** のとき **apply しない**（`ProgressSyncFromCsvService`）。

## Root cause

1. **完了操作の契約**が「反転」のみだと、**リトライ・二重タップ・楽観更新の重なり**で **意図しない反転**が起きうる。
2. **CSVの空 `progress`** を **「未完確定」**とみなして **手動完了を上書き**すると、**情報欠落**が **状態退行**になる。
3. **表示系SQL**が **manual / external / effective** の合成規約を共有していないと、**チップ・行・集計**がずれる。

## Fix（実装の要約）

| 領域 | 変更 |
|------|------|
| API | `PUT …/completion` + `intent`。**`unchanged`** を応答に含める。`/complete` は互換トグルとして維持。 |
| Web | `setKioskProductionScheduleRowCompletion`・`useSetKioskProductionScheduleRowCompletion`。UI は **`row.isCompleted` に応じ `complete`/`incomplete` を送信**。 |
| CSV同期 | `decideCsvProgressSyncForProductionScheduleRow`：**`完了` のみ true**、**空は手動完了済みなら skip**、他値は skip。 |
| 表示・集計 | **effective completion** SQL／クエリを **`production-schedule-effective-completion.sql.ts` 等で共有**（一覧・チップ・納期集計を寄せる）。 |

主要コード:  
[`production-schedule-command.service.ts`](../../apps/api/src/services/production-schedule/production-schedule-command.service.ts)・[`complete.ts`](../../apps/api/src/routes/kiosk/production-schedule/complete.ts)・[`progress-csv-sync-decision.policy.ts`](../../apps/api/src/services/production-schedule/progress-csv-sync-decision.policy.ts)・[`progress-sync-from-csv.service.ts`](../../apps/api/src/services/production-schedule/progress-sync-from-csv.service.ts)・Web [`client.ts`](../../apps/web/src/api/client.ts) / [`hooks.ts`](../../apps/web/src/api/hooks.ts) / [`useProductionScheduleMutations.ts`](../../apps/web/src/features/kiosk/productionSchedule/useProductionScheduleMutations.ts)。

## Prevention

- **新規クライアント**は **`/completion`** のみ使用。**`/complete` はレガシー**として残すが **主経路にしない**。
- **CSV sync の「意味→真偽」変換**は **policy に閉じ**、本体サービスにifを散らさない。
- **回帰テスト**: `progress-csv-sync-decision.policy.test.ts`・`progress-sync-from-csv.service.test.ts`・`kiosk-production-schedule.integration.test.ts`（**intent 二重 complete**・**トグル二重で戻る**の対比）・`useProductionScheduleMutations.test.ts`。

## References

- [KB-297 §リーダー順位ボード](./KB-297-kiosk-due-management-workflow.md#リーダー順位ボード納期ベース整列手動順-api-反映2026-04-01)
- [KB-369 順位ボードAPI内部レイテンシ](./KB-369-leader-order-board-api-internal-latency.md)
- [docs INDEX](../INDEX.md)
