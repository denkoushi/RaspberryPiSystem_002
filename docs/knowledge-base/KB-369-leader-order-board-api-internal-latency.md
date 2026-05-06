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

### 追補（2026-05-06）: ProductNo winner の materialization（相関除去・仕様同一）

- **課題**: `baseWhere` に含まれる `buildMaxProductNoWinnerCondition`（同一論理キー内で最大 ProductNo の行）は **WHERE ごとに相関評価**され、順位ボードの **複数クエリ × ページ行** でコストが積み上がることがある。
- **方針（同値変換のみ）**: 正本の PARTITION / ORDER は [`max-product-no-winner-spec.ts`](../../apps/api/src/services/production-schedule/row-resolver/max-product-no-winner-spec.ts) に集約し、**`fetchMaxProductNoWinnerRowIdsForDashboard`**（`ROW_NUMBER … rn=1`）で winner id を **1 クエリ確定**。`responseProfile=leaderboard` と `listLeaderboardShellProductionScheduleRows` と装飾 **hydrate** では、`buildProductionScheduleLeaderboardMaterializedBaseWhere` 由来の **`csvDashboardId` + `id IN (...)`** を **`COUNT`** と **`fetchLeaderboardScheduleRowsWithSeibanAwarePriority`** が **共有**。`prepareProductionScheduleDashboardFilters` の correlated `baseWhere` は **`full` 一覧**など従来どおり維持。
- **関連モジュール**: [`max-product-no-winner-materialization.ts`](../../apps/api/src/services/production-schedule/row-resolver/max-product-no-winner-materialization.ts)·[`leaderboard-row-selection.service.ts`](../../apps/api/src/services/production-schedule/leaderboard/leaderboard-row-selection.service.ts)（`leaderboardMaterializedBaseWhere` 引数へ変更）·[`leaderboard-shell-hydrate.service.ts`](../../apps/api/src/services/production-schedule/leaderboard/leaderboard-shell-hydrate.service.ts)

## Prevention

- [`production-schedule-query.service.test.ts`](../../apps/api/src/services/production-schedule/__tests__/production-schedule-query.service.test.ts)（leaderboard を含むケース）。**追補**: [`max-product-no-winner-materialization.test.ts`](../../apps/api/src/services/production-schedule/__tests__/max-product-no-winner-materialization.test.ts)（モック）。
- [`kiosk-production-schedule.integration.test.ts`](../../apps/api/src/routes/__tests__/kiosk-production-schedule.integration.test.ts) の **winner materialization と相関 winner の集合一致**（シード済みダッシュボード）。

## Production deploy & verification（2026-05-06 · leaderboard-shell winner materialization）

- **対象ホスト**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。Pi4／Pi3 は **必須対象外**（play **no hosts matched**。**Pi3 専用手順不要**）。
- **リポジトリ**: ブランチ **`fix/leaderboard-shell-winner-materialization`**・代表コミット **`b05baa5f`**（**`main` 取り込み後は `origin/main` HEAD を正とする**）。
- **標準手順**: [`deployment.md` のデプロイ運用](../guides/deployment.md) と同じく **`update-all-clients.sh`**（`export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·**`--detach --follow`**）。
- **Detach Run ID**（接頭辞 `ansible-update-`）: **`20260506-190944-2060`**（**`PLAY RECAP` `ok=134` `changed=4` `failed=0` / `unreachable=0`**・リモート **`exit` `0`**・ローカル **`--follow` 約 888s**）。
- **広域自動検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（本記録 **約 132s**・Tailscale）。
- **トラブルシュート**: 体感が変わらない／挙動が期待と違う → Pi5 **`api` イメージ**が当該コミット以降か（detach ログ・`git log -1`）。**相関 winner と materialize の集合**は統合テストで一致を確認済み。

## Production deploy & verification（2026-05-06 · leaderboard COUNT 並列化）

- **対象ホスト**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。Pi4／Pi3 は **本変更の必須デプロイ対象外**（inventory 上 **no hosts matched**）。
- **リポジトリ**: ブランチ **`fix/leaderboard-internal-query-latency`**・代表コミット **`35629338`**（**`main` マージ後は `main` 先端**を正とする）。
- **標準手順**: [deployment.md](../guides/deployment.md) の **`update-all-clients.sh`**（`export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・**`--detach --follow`**）。
- **Detach Run ID**（接頭辞 `ansible-update-`）: **`20260506-103441-24679`**（**`PLAY RECAP` `ok=134` `changed=4` `failed=0` / `unreachable=0`**・リモート **`exit` `0`**）。
- **広域自動検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（本記録 **約 80s**・Tailscale）。

## Production deploy & verification（2026-05-06 · 段階取得 leaderboard-shell／total／decorations）

- **対象ホスト**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。Pi4／Pi3 は **必須対象外**（play **no hosts matched**）。
- **リポジトリ**: ブランチ **`feat/leaderboard-phased-fetch-2s`**・代表実装コミット **`cd751a2a`**（**`main` で squash マージされたら `main` 先端 SHA を正とする**）。
- **標準手順**: [`deployment.md` のデプロイ運用](../guides/deployment.md) と同じく **`update-all-clients.sh`**（`export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・**`--detach --follow`**）。
- **Detach Run ID**（接頭辞 `ansible-update-`）: **`20260506-113443-32585`**（**`PLAY RECAP` `ok=134` `changed=4` `failed=0` / `unreachable=0`**・リモート **`exit` `0`**・ローカル **`--follow` 約 849s**）。
- **広域自動検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（本記録 **約 74s**・Tailscale）。
- **知見（装飾 hydrate の raw SQL）**: `Prisma.sql` の **`Prisma.join(array, ',')`** は **カンマ区切りの単一プレースホルダ**ではなく **断片連結**として解釈されるため、**`ARRAY[...]::uuid[]`** や **`IN (...)`** には **`Prisma.join` を 1 回だけ**渡す。**UUID 順序付け**は **`::text` 比較の `text[]` + `array_position`** が型安全。**Fkojunst 可視 SQL** は既存 leaderboard と同様、**連結済みフラグメントの先頭に余計な `AND` を付けない**（二重 AND になる）。

## Troubleshooting

- **まだ遅い／反映されない**: Pi5 の **`api` コンテナ**が当該コミット以降か（detach ログの **`Git: changed`**・リモート `git log -1`）。**Mac 側 `--follow` が途中で途切れても**、**`PLAY RECAP` / `summary.json` / `*.exit`** を正本とする（[deployment.md](../guides/deployment.md) の detach 運用どおり）。
- **キオスク側の挙動（COUNT 並列化のみ）**: 当該リリースは **API のみ**。ブラウザは **強制リロード**（[verification-checklist.md](../guides/verification-checklist.md) §6.6.4）。
- **段階取得（API+Web）**: 初回のみ **複数 GET/POST**。挙動が古いときは Pi5 **`api` と `web` の両方**を確認し、同上 **強制リロード**。**装飾欠落の切り分け**は上記 **hydrate raw SQL** 知見と Network 順序を参照。

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
- [deployment.md](../guides/deployment.md)（2026-05-06 · winner materialization 項·leaderboard COUNT 並列化項·段階取得項）
- [KB-297 · COUNT 並列化（2026-05-06）](./KB-297-kiosk-due-management-workflow.md#leader-order-board-api-count-parallel-2026-05-06)
- [KB-297 · 段階取得（2026-05-06）](./KB-297-kiosk-due-management-workflow.md#leader-order-board-leaderboard-phased-fetch-2026-05-06)
