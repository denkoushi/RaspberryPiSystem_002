---
title: KB-369 キオスク順位ボード API の内部レイテンシ（COUNT + 行取得）
tags: [kiosk, production-schedule, leader-order-board, api, performance]
audience: [開発者]
last-verified: 2026-05-06
category: knowledge-base
---

# KB-369: キオスク順位ボード API の内部レイテンシ（COUNT + 行取得）

## Context

- 対象: `GET /api/kiosk/production-schedule`（`responseProfile=leaderboard`）
- 主経路: `listProductionScheduleRows` → 可視行 `COUNT(*)` + `fetchLeaderboardScheduleRowsWithSeibanAwarePriority`
- 目的: **UI/API 契約・並び・件数定義を変えず**、サーバ内部の待ち時間を短縮する

## Symptoms

- 順位ボード初回表示で API 応答が遅い（体感遅延）
- 計測・調査では **COUNT と leaderboard 行 SELECT の合算**が支配的になりやすい

## Investigation

- **仮説**: `leaderboard` 経路で COUNT 完了を待ってから行取得を開始していたため、壁時計時間が **2 クエリの直列和**になっていた
- **検証**: COUNT は行 SELECT の結果に依存しない（同一 `baseWhere` + `queryWhere` + Fkojunst 可視 WHERE）
- **結果**: **CONFIRMED**（並列化しても意味は不変）

## Root cause

- `responseProfile=leaderboard` 時に **COUNT の `await` の後に** `fetchLeaderboardScheduleRowsWithSeibanAwarePriority` を実行していた

## Fix（最小変更・仕様同一）

1. **COUNT 専用関数**に抽出: [`production-schedule-list-count.service.ts`](../../apps/api/src/services/production-schedule/production-schedule-list-count.service.ts)（SQL は従来の `COUNT(*)` と同一条件）
2. **leaderboard 経路**: `Promise.all([count, rowSelect])` で **COUNT と行取得を並列実行**
3. **enrich + footer**: `enrichLeaderboardListRowsAndFooter` に集約（機種名・顧客名・`leaderboardFooterChipsByPartKey` は従来どおり）

`responseProfile=full` はもともと `Promise.all([count, mainSelect])` のため論点は leaderboard 側。

## Prevention

- [`production-schedule-query.service.test.ts`](../../apps/api/src/services/production-schedule/__tests__/production-schedule-query.service.test.ts)（leaderboard を含む 17 ケース）で回帰監視

## References

- 計画メモ（ローカル）: 「仕様不変の順位ボード高速化計画」（`leaderboard-spec-preserving-speedup`）
