---
title: KB-375 順位ボード・生産日程の完了整合（明示完了API・CSV同期・実効完了）
tags: [キオスク, 生産スケジュール, 順位ボード, 完了, CSV, ナレッジ]
audience: [開発者, 運用者]
last-verified: 2026-05-10
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

## Production（2026-05-10 · 本番反映・実機検証）

- **ブランチ**: **`fix/leaderboard-completion-integrity`**（代表コミット **`c063ab57`**・メッセージ `fix(kiosk): stabilize leaderboard completion state`）。**`main` マージ後**は **`./scripts/update-all-clients.sh main … --limit <host>`** が標準。
- **対象ホスト（1 台ずつ・ユーザー指定 5 台のみ）**: **`raspberrypi5`** → **`raspberrypi4`** → **`raspi4-robodrill01`** → **`raspi4-fjv60-80`** → **`raspi4-kensaku-stonebase01`**。
- **Pi3**: **本ロールアウトの `--limit` には含めない**（Ansible では **Pi3 signage play が `no hosts matched`**）。Pi3 を更新対象に含める要件がある場合は、**省メモリ手順・専用 playbook**（`deployment.md` 他節・Runbook）に従い、**フル `update-all-clients` を Pi3 に当てない**。
- **Detach Run ID**（接頭辞 `ansible-update-`、Pi5 上 `/opt/RaspberryPiSystem_002/logs/deploy/`）:
  - `20260510-074230-10392` — `raspberrypi5` · `ok=134` `changed=4` `failed=0` · `Git: changed` · Docker 再起動は **Ansible 上で一度 `FAILED - RETRYING` 後に成功**（長引く場合は `PLAY RECAP` / `*.exit` / `summary.json` を正本とする）。
  - `20260510-075520-22663` — `raspberrypi4` · `ok=122` `changed=10` · kiosk / status-agent 再起動 **ok**。
  - `20260510-080053-3965` — `raspi4-robodrill01` · `ok=122` `changed=9`。
  - `20260510-080512-13265` — `raspi4-fjv60-80` · `ok=122` `changed=9`。
  - `20260510-080941-22009` — `raspi4-kensaku-stonebase01` · `ok=129` `changed=10`。
- **実機（自動）**: **`RASPI_SERVER_HOST=denkon5sd02@100.106.158.2`** 前提で **`./scripts/deploy/verify-phase12-real.sh`** → **PASS 43 / WARN 0 / FAIL 0**（本記録 **約 74s**）。**`deploy-status`**（4 Pi4 キオスク）**すべて PASS**。**Pi3**：スクリプトの **signage / timer チェックは PASS**（本変更の Ansible 適用対象外）。
- **ローカル preflight の失敗例**: デプロイ実行ユーザのリポに **未追跡ファイル**（例: 診断用 `scripts/diagnose-*.ts`）があると **`ensure_local_repo_ready_for_deploy` が exit 2**。**`git stash push -u`** でツリーをクリーンにしてから再実行。
- **運用スモーク（手動・推奨）**: キオスク **生産日程一覧**と**順位ボード**で、同一行の **✓** と **資源 CD チップ**・**納期側集計**の完了表示が一致すること。**完了操作**後に **同じ操作を繰り返しても未完に戻らない**（`/completion` の **`unchanged`**）。**CSV 同期**後も **手動完了**が **`progress` 空**だけで落ちないこと（現場で問題になった経路）。

## References

- [deployment.md §KB-375 本番（2026-05-10）](../guides/deployment.md#kiosk-leaderboard-completion-integrity-2026-05-10)
- [KB-297 §リーダー順位ボード](./KB-297-kiosk-due-management-workflow.md#リーダー順位ボード納期ベース整列手動順-api-反映2026-04-01)
- [KB-369 順位ボードAPI内部レイテンシ](./KB-369-leader-order-board-api-internal-latency.md)
- [KB-376 装飾スコープとフッタwinner整合](./KB-376-leaderboard-footer-display-scope-winner-alignment.md)
- [KB-377 資源CDチップ・グレーアウトと差分消失の検証ナレッジ](./KB-377-kiosk-leaderboard-resource-chip-completion-verification.md)
- [docs INDEX](../INDEX.md)
