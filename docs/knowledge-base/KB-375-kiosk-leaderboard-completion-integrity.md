---
title: KB-375 順位ボード・生産日程の完了整合（明示完了API・CSV同期・実効完了）
tags: [キオスク, 生産スケジュール, 順位ボード, 完了, CSV, ナレッジ]
audience: [開発者, 運用者]
last-verified: 2026-05-26
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

### 2026-05-26 追補: 生産日程CSV差分消失完了の廃止

- **完了正本**は **手動完了** + **FKOJUNST_Status `C` / `X`** に限定する（[ADR-20260526](../decisions/ADR-20260526-production-schedule-completion-status-only.md)）。
- 生産日程CSV差分消失は、Status `R` や Status 欠落期間でも現場残存行を完了グレーにし得るため、実効完了から外した。
- `externallyCompletedFromScheduleCsvDisappeared` は互換列として残すが、既存 true は migration で false に収束し、以後の取込では完了へ寄与しない。

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

## Production（2026-05-26 · **完了正本を手動 + `C`/`X` のみ**） {#production-2026-05-26-completion-status-only}

- **ブランチ**: **`fix/kiosk-completion-status-only`**（代表 **`a970e795`**）
- **対象ホスト**: **`raspberrypi5` のみ**（**`--limit raspberrypi5`・1 台**）。Pi4／Pi3 **no hosts matched**（**Pi3 専用手順不要**）
- **Detach Run ID**: **`20260526-121604-8450`**（`ok=134` `changed=4` `failed=0`）
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **30s**）
- **DB 事後**: **`externallyCompletedFromScheduleCsvDisappeared=true` → 0 件**（effective completion は **手動 OR メール `C`/`X`** のみ）
- **運用スモーク（自動·DB）**: 製番 **BA1S6202** / **`FSIGENCD=035`** で **`csv_disappeared=f`**。**`fk_status=C`** の行は **意図どおりグレー**（5/22 の **`R` + 消失完了** は再現しない）
- **記録**: [deployment.md §2026-05-26](../guides/deployment.md#kiosk-completion-status-only-2026-05-26)·[ADR-20260526](../decisions/ADR-20260526-production-schedule-completion-status-only.md)

## Production（2026-06-01 · **完了後フッタ工程チップ装飾の再同期**） {#production-2026-06-01-completion-decoration-resync}

> **Current spec note (2026-06-24)**: This section records the 2026-06-01 / Phase 2 context. Current regular leaderboard refetch/cache freshness is **300秒**; see [KB-392](./KB-392-kiosk-leaderboard-spec-source-of-truth.md).

- **ブランチ**: **`fix/kiosk-leaderboard-completion-decoration-resync`**（代表 **`fe31aa99`**）
- **スコープ**: **Web のみ**（`leaderboardDecorationStalePolicy.ts` · `useLeaderboardDeferredBoardDecorations` · `useCompositeLeaderboardPhasedScheduleWithAutoAppend` · `leaderboardBoardDisplayMutationCoordinator`）。**API / DB 不変**。
- **完了意味の正本**: [§2026-05-26](#production-2026-05-26-completion-status-only) の **手動 + `C`/`X`** を維持。本 Fix は **表示層**で **実効完了（`row.isCompleted`）と footer チップ**の **見え方を再同期**する（完了判定ロジックそのものは変更しない）。
- **再同期トリガー（要約）**:

| トリガー | 挙動 | 意図 |
|----------|------|------|
| `rowData.progress` 変化 | 当該 **rowId** を decorations pending | CSV / shell 更新で progress が変わった行の機種名・顧客名も追従 |
| `boardNetworkSyncToken` 変化 | **partKey 代表 row 1 件**のみ pending（同一 part の複数表示行はまとめる） | 120s ポーリング・shell refetch 後に **footer チップだけ古い**状態を解消。**全行 POST はしない**（負荷・PR レビュー指摘対応） |
| 手動 **completion** mutation | `markDecorationRowsStale` + `resolveStaleDecorationRowIds` | **✓ 操作直後**にチップを即再取得 |

- **対象ホスト**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。Pi4 / Pi3 **`no hosts matched`**（SPA 配信元は Pi5·Pi4 順次デプロイは **不要**）。
- **Detach Run ID**: **`20260601-210522-21919`**（`failed=0` · `changed=4`）
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **63s**）
- **運用スモーク（手動·推奨）**:
  1. 順位ボードで行 **✓** → **行本体とフッタ工程チップが同時に完了表示**（グレー）。
  2. 同一 **製番×品番×部品** の **別工程行**を別経路で完了 → **ポーリング / 手動 refetch 後**にフッタが追従（最大 **120s** SLA は [KB-374 Phase 2](./KB-374-leaderboard-board-continue-cursor-contract.md#端末キャッシュ-phase-2-改訂120s-同期swr-操作ロック2026-05-20--featkiosk-leaderboard-cache-120s-swr-lock) と併用）。
  3. **操作即表示**（[KB-374 §操作即表示](./KB-374-leaderboard-board-continue-cursor-contract.md#操作即表示--120秒キャッシュ両立2026-05-20--featkiosk-leaderboard-mutation-instant-display)）後も **チップだけ巻き戻らない**こと。
- **トラブルシュート**:
  - **行だけ完了・チップ未完** → 装飾後取り bundle 未反映 / **`fe31aa99` 未デプロイ** / 強制リロード。
  - **ポーリングごとに decorations POST が数十件** → **代表行 1 件/partKey** 未適用の旧 JS。
  - **他端末完了が即反映されない** → **120s キャッシュ SLA**（仕様）·本 Fix は **自端末の stale 検出**が主目的。
- **記録**: [deployment.md §2026-06-01](../guides/deployment.md#kiosk-leaderboard-completion-decoration-resync-2026-06-01)·[KB-374 §装飾 stale](./KB-374-leaderboard-board-continue-cursor-contract.md#完了後フッタ工程チップ装飾の再同期2026-06-01--fixkiosk-leaderboard-completion-decoration-resync)·[verification-checklist §6.6.29](../guides/verification-checklist.md#kiosk-leaderboard-completion-decoration-resync-verification-2026-06-01)

## References

- [deployment.md §KB-375 本番（2026-05-10）](../guides/deployment.md#kiosk-leaderboard-completion-integrity-2026-05-10)
- [deployment.md §完了正本限定（2026-05-26）](../guides/deployment.md#kiosk-completion-status-only-2026-05-26)
- [KB-297 §リーダー順位ボード](./KB-297-kiosk-due-management-workflow.md#リーダー順位ボード納期ベース整列手動順-api-反映2026-04-01)
- [KB-369 順位ボードAPI内部レイテンシ](./KB-369-leader-order-board-api-internal-latency.md)
- [KB-376 装飾スコープとフッタwinner整合](./KB-376-leaderboard-footer-display-scope-winner-alignment.md)
- [KB-377 資源CDチップ・グレーアウトと差分消失の検証ナレッジ](./KB-377-kiosk-leaderboard-resource-chip-completion-verification.md)
- [KB-383 過去納期・資源035滞留調査（2026-06-01・調査中断）](./KB-383-kiosk-leaderboard-stale-past-due-investigation.md)
- [docs INDEX](../INDEX.md)
