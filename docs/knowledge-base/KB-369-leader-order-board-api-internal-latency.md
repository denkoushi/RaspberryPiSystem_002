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

## Production deploy & verification（2026-05-06）

- **対象ホスト**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。Pi4／Pi3 は **本変更の必須デプロイ対象外**（inventory 上 **no hosts matched**）。
- **リポジトリ**: ブランチ **`fix/leaderboard-internal-query-latency`**・代表コミット **`35629338`**（**`main` マージ後は `main` 先端**を正とする）。
- **標準手順**: [deployment.md](../guides/deployment.md) の **`update-all-clients.sh`**（`export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・**`--detach --follow`**）。
- **Detach Run ID**（接頭辞 `ansible-update-`）: **`20260506-103441-24679`**（**`PLAY RECAP` `ok=134` `changed=4` `failed=0` / `unreachable=0`**・リモート **`exit` `0`**）。
- **広域自動検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（本記録 **約 80s**・Tailscale）。

## Troubleshooting

- **まだ遅い／反映されない**: Pi5 の **`api` コンテナ**が当該コミット以降か（detach ログの **`Git: changed`**・リモート `git log -1`）。**Mac 側 `--follow` が途中で途切れても**、**`PLAY RECAP` / `summary.json` / `*.exit`** を正本とする（[deployment.md](../guides/deployment.md) の detach 運用どおり）。
- **キオスク側の挙動**: 本変更は **API のみ**。ブラウザは **強制リロード**（[verification-checklist.md](../guides/verification-checklist.md) §6.6.4）。

## 段階取得（leaderboard-shell / leaderboard-total / leaderboard-decorations）

順位ボードページは **初回のみ** 互換の単一 `responseProfile=leaderboard` ではなく、責務分割した以下を利用できる（**並びは `fetchLeaderboardScheduleRowsWithSeibanAwarePriority` 再利用・再ソートしないマージ**）。

| メソッド | パス | 役割 |
|---------|------|------|
| GET | `/api/kiosk/production-schedule/leaderboard-shell` | 装飾なし行（`pageSize` 既定 160・上限 160） |
| GET | `/api/kiosk/production-schedule/leaderboard-total` | 一覧と同一条件の可視行件数のみ |
| POST | `/api/kiosk/production-schedule/leaderboard-decorations` | `{ rowIds[], targetDeviceScopeKey? }` で機種名・顧客名・フッターチップ |

実装: [`leaderboard-phased-read.ts`](../../apps/api/src/routes/kiosk/production-schedule/leaderboard-phased-read.ts)・[`production-schedule-query.service.ts`](../../apps/api/src/services/production-schedule/production-schedule-query.service.ts)（`listLeaderboardShellProductionScheduleRows` 等）。統合テスト: [`kiosk-production-schedule.integration.test.ts`](../../apps/api/src/routes/__tests__/kiosk-production-schedule.integration.test.ts) の phased ケース。

## References

- 計画メモ（ローカル）: 「仕様不変の順位ボード高速化計画」（`leaderboard-spec-preserving-speedup`）
- [deployment.md](../guides/deployment.md)（2026-05-06 · leaderboard COUNT 並列化項）
- [KB-297 · 順位ボード節（2026-05-06 追補）](./KB-297-kiosk-due-management-workflow.md#leader-order-board-api-count-parallel-2026-05-06)
