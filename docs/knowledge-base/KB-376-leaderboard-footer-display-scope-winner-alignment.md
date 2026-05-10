---
title: KB-376 順位ボード・装飾APIの表示スコープとフッタwinner選定の整合
tags: [キオスク, 生産スケジュール, 順位ボード, フッタチップ, hydrate, ナレッジ]
audience: [開発者]
last-verified: 2026-05-10
related: [KB-375-kiosk-leaderboard-completion-integrity.md, ADR-20260508-leaderboard-board-aggregate-api.md, KB-374-leaderboard-board-continue-cursor-contract.md]
category: knowledge-base
update-frequency: medium
---

# KB-376: 順位ボード・装飾APIの表示スコープとフッタ winner 選定の整合

## Context

`leaderboard-decorations`・集約 `leaderboard-board`・`responseProfile=leaderboard` の **資源CDフッタチップ**は、DB 上で **同一の dedupe 5キー**（`FSEIBAN` / `ProductNo` / `FHINCD` / `FSIGENCD` / `FKOJUN`）を持つ **複数 `CsvDashboardRow`** に対して **1行（winner）**を選ぶ。一覧側の **行完了**とチップの **`isCompleted`** がずれると現場判断を誤る。

## Symptoms

- 順位ボードで **行は完了**なのに **021 などのフッタチップが未完**（またはその逆）。
- **表示対象行が 900 件を超える**リクエストで、**shell 装飾経路**のみ不整合（一覧の monolithic 経路では問題なし、など経路差が出る）。

## Investigation

- **CONFIRMED**: **装飾用 hydrate** が **1回の SQL で扱う ID 上限**（実務上 **900** 前後）により **入力 `rowIds` の後半が hydrate 対象外**になり得た。
- **CONFIRMED**: フッタ winner の `DISTINCT ON` は **`preferred`（表示中 rowId）優先**だが、**`preferred` が hydrate 済み行の id のみ**に偏ると、**画面上の表示行 id が優先集合に含まれず**別 winner が選ばれ得た。

## Root cause

1. **表示対象 ID 集合**（リクエスト境界）と **hydrate 取得集合**が分断され、**フッタ SQL の prefer 入力**が **画面の正しい境界**を表していなかった。
2. **board continue** などは chunked hydrate を持つ一方、**装飾直結 hydrate** の欠損により **経路間で同一原則が共有されなかった**。

## Fix（実装の要約）

| 領域 | 変更 |
|------|------|
| 表示スコープ | `leaderboard-display-row-scope.ts` に **正規化**（trim・重複除去・順序保持・硬上限）と **hydrate 用チャンク分割**を集約。 |
| hydrate | `fetchLeaderboardScheduleHydratedRowsOrderedByIds` が **全チャンクを順に実行**し、**入力順でマージ**。 |
| フッタ | `preferredDisplayRowIds` を **明示**でき、`buildLeaderboardFooterChipsByPartKeyForScheduleRows` が **選定境界**と **部品キー収集**を分離（collector）。 |
| 配線 | `decorateLeaderboardShellRowsForKiosk*` / `enrichLeaderboardListRowsAndFooter` / `leaderboard-composite-board` continue が **同一スコープ**をフッタへ渡す。 |

主要コード:  
[`leaderboard-display-row-scope.ts`](../../apps/api/src/services/production-schedule/leaderboard/leaderboard-display-row-scope.ts)·[`leaderboard-shell-hydrate.service.ts`](../../apps/api/src/services/production-schedule/leaderboard/leaderboard-shell-hydrate.service.ts)·[`leaderboard-part-footer-processes.service.ts`](../../apps/api/src/services/production-schedule/leaderboard/leaderboard-part-footer-processes.service.ts)·[`leaderboard-footer-part-key-collector.ts`](../../apps/api/src/services/production-schedule/leaderboard/leaderboard-footer-part-key-collector.ts)·[`production-schedule-query.service.ts`](../../apps/api/src/services/production-schedule/production-schedule-query.service.ts)·[`leaderboard-composite-board.service.ts`](../../apps/api/src/services/production-schedule/leaderboard/leaderboard-composite-board.service.ts)。

## Prevention

- **回帰テスト**: `kiosk-production-schedule.integration.test.ts`（**>900 `rowIds` + 重複 winner**）・`leaderboard-display-row-scope.test.ts`・`leaderboard-footer-part-key-collector.test.ts`。
- **新規経路**では **hydrate 上限**を単独で二次実装せず、`leaderboard-display-row-scope` / `fetchLeaderboardScheduleHydratedRowsOrderedByIds` に寄せる。

## Production rollout（2026-05-10）

- **スコープ**: **API のみ**（キオスク Web のビルド対象変更なし）。**対象ホスト**: **`raspberrypi5` のみ**（`./scripts/update-all-clients.sh … --limit raspberrypi5`）。**Pi4 キオスク／Pi3 サイネージ**: 当該 **`--limit`** では Ansible **`skipping: no hosts matched`**（**Pi3 専用手順は未実施**・本変更は Pi5 API コンテナのみで足りる判断）。
- **ブランチ**: 先行反映 **`feature/leaderboard-footer-winner-rearchitecture`**。マージ後の運用正本は **`main` HEAD**（`./scripts/update-all-clients.sh main … --limit raspberrypi5`）。
- **代表コミット（先行本番時点）**: **`c2e7438a`**（`fix(kiosk): align leaderboard footer winners with displayed rows`）。
- **Detach Run ID**（接頭辞 `ansible-update-`）: **`20260510-091316-7496`**（`raspberrypi5`·**`PLAY RECAP` `ok=134` `changed=4` `failed=0` / `unreachable=0`**·リモート **`exit` `0`**·ローカル **`--follow` 約 615s**·サマリ **`Git: changed`**·**Docker compose 再起動 `changed`**·**`prisma migrate deploy` / `status` `ok`**）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh`（Tailscale・Pi5 `100.106.158.2`）→ **PASS 43 / WARN 0 / FAIL 0**（本記録 **約 57s**）。**`deploy-status`（Pi4×4）**: すべて **PASS**。**`auto-tuning scheduler` ログ**: **件数=1**。
- **ローカル開発・回帰の知見**:
  - Vitest 統合で Postgres 未起動と分かった場合は、リポジトリの **`scripts/test/start-postgres.sh`** で一時コンテナ起動→**`pnpm prisma migrate deploy`** 後に再実行。
  - **`>900` 件境界**の回帰は、**`leaderboard-decorations` を単体で叩く**より **`buildLeaderboardFooterChipsByPartKeyForScheduleRows` にダミー UUID を 900 件載せた上で、末尾の表示行 id を `preferredDisplayRowIds` で渡す**形が安定（materialization 経路との結合度を下げる）。
- **トラブルシュート（本番）**:
  - **フッタがまだ一覧とズレる** → Pi5 **`api` イメージ**が **`c2e7438a` 以降（またはマージ後 `main`）**か、Detach サマリの **`Git: changed`** と **Docker 再起動**有無を確認。
  - **`verify-phase12-real.sh` で `deploy-status` のみ FAIL** → [KB-369](./KB-369-leader-order-board-api-internal-latency.md)·Pi5 **`config/deploy-status.json`**・連続デプロイ直後は **再実行**。
- **運用コマンド（記録どおり）**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feature/leaderboard-footer-winner-rearchitecture infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**マージ後は第2引数を `main`**）。

## References

- [KB-375](./KB-375-kiosk-leaderboard-completion-integrity.md)（完了意味の共有）
- [ADR-20260508](../decisions/ADR-20260508-leaderboard-board-aggregate-api.md)
- [KB-374](./KB-374-leaderboard-board-continue-cursor-contract.md)
- [docs INDEX](../INDEX.md)
- [deployment.md §KB-376](../guides/deployment.md#leaderboard-footer-display-scope-winner-alignment-2026-05-10)
