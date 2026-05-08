---
title: KB-372 FKOJUNST メール同期 winner 解決の bind 上限と長時間化
tags: [FKOJUNST_Status, fkmail, Prisma, PostgreSQL, 生産スケジュール]
audience: [開発者, 運用者]
last-verified: 2026-05-08
related: [deployment.md, KB-371, ADR-20260508-fkojunst-status-sole-source]
category: knowledge-base
---

# KB-372: FKOJUNST メール同期 winner 解決の bind 上限と長時間化

## Context

- **いつ**: 2026-05-08 以降の本番反映を記録
- **どこ**: Pi5 **API コンテナ**・`FKOJUNST_Status` **Gmail CSV** 取込経路（[`fkojunst-status-mail-sync.pipeline.ts`](../../apps/api/src/services/production-schedule/fkojunst-status-mail-sync.pipeline.ts)）
- **前提**: [ADR-20260508-fkojunst-status-sole-source](../decisions/ADR-20260508-fkojunst-status-sole-source.md) により **`fkmail` が一覧・メール完了の正本**。幕（生産スケジュール `CsvDashboard`）上の **winner 行 ID** を、メール側の **3キー**（`FKOJUN` / `FSIGENCD` 相当の資源CD / `FSEIBAN` 相当）で解決する処理がボトルネックになった

## Symptoms

- 初期症状: メール同期バッチまたは関連 API ログで **500** 級・Prisma / DB 側に近い文言:
  - `Assertion violation on the database: too many bind variables in prepared statement, expected maximum of 32767, received …`
- 次の症状: bind 上限を避けても、Pi5 実データでは **リクエスト timeout** が継続し、Pi5 API / PostgreSQL で `stack depth limit exceeded` や長時間実行が観測された
- 実データ規模: `FKOJUNST_Status` の **dedupedRows 91,998 件**、生産日程 winner 側 **22,418 行**

## Investigation

- **CONFIRMED**: PostgreSQL の prepared statement は **バインド変数に上限**（典型 **32767**）。旧実装は **複数列に対する巨大 `IN`** を **少数クエリ**に載せ、**総バインド数が上限を超えうる**
- **CONFIRMED**: bind 上限回避のため **1000 件チャンク**へ落としても、Pi5 実データでは **約 92 チャンク**となり、winner 解決 SQL を何度も再走査して長時間化した
- **CONFIRMED**: 1-pass 化後は Pi5 本番で **mail sync 完了 37.3s**、次に **外部完了同期の Prisma interactive transaction 既定 5s** が `P2028` を起こした

## Root cause

- 第1段: **winner 解決**で **全候補キーを単一 `IN`** に載せていたため、大規模メール差分時に **バインド数が DB 上限を超えた**
- 第2段: bind を避けるための **チャンク分割**も、Pi5 実データでは **同じ winner 走査を約 92 回**繰り返し、実運用時間に収まらなかった
- 第3段: winner 解決短縮後に、続く **外部完了再計算 transaction** が **既定 5s timeout** で `P2028` を起こした

## Fix（実装）

- **初動回避**: [`postgres-prepared-statement-bind-limit.ts`](../../apps/api/src/lib/postgres-prepared-statement-bind-limit.ts) の **`POSTGRES_PREPARED_STATEMENT_MAX_BIND_PARAMS`** と **`maxTuplePlaceholdersPerQuery`** で bind 上限を明文化
- **最終 fix（winner 解決）**: [`fkojunst-mail-winner-by-triple.reader.ts`](../../apps/api/src/services/production-schedule/fkojunst-mail-winner-by-triple.reader.ts) の **`findFkojunstMailWinnerIdsByMailTriples`** を **winner 全件 1 回読込 + `Map` フィルタ**へ変更し、Pi5 実データでも repeated scan を避けた
- **論理キー**: [`fkojunst-mail-status-key.ts`](../../apps/api/src/services/production-schedule/fkojunst-mail-status-key.ts) の **`buildFkojunstMailStatusKey`**
- **pipeline 配線**: [`fkojunst-status-mail-sync.pipeline.ts`](../../apps/api/src/services/production-schedule/fkojunst-status-mail-sync.pipeline.ts) が reader を使用
- **最終 fix（外部完了）**: [`fkojunst-external-completion-sync.service.ts`](../../apps/api/src/services/production-schedule/external-completion/fkojunst-external-completion-sync.service.ts) に **`timeout: 60000` / `maxWait: 15000`** を明示し、winner 解決短縮後の `P2028` を解消
- **関連**: [`csv-dashboard-existing-rows-by-hash.reader.ts`](../../apps/api/src/services/csv-dashboard/csv-dashboard-existing-rows-by-hash.reader.ts) は **同一系統の「巨大入力をそのまま DB へ渡さない」知見**
- **代表コミット**: **`ef9e3125`**（bind/stack depth 初動）→ **`b144fb40`**（winner 1-pass）→ **`b6bb449a`**（external completion timeout）
- **テスト**: [`fkojunst-mail-winner-by-triple.reader.test.ts`](../../apps/api/src/services/production-schedule/__tests__/fkojunst-mail-winner-by-triple.reader.test.ts)·（任意）Docker 一時 Postgres による統合テスト

## Prevention / Troubleshooting

- **切り分け**: 同種 timeout が出る場合は、Pi5 上で **winner 解決時間** と **外部完了同期** を分けて確認する。`stack depth` が消えていても **repeated scan** や **transaction timeout** が残り得る
- **開発時**: 一時 DB での統合テストは **`prisma migrate deploy` 済み**であること。**テスト行の 3キー**は **本番と同じ正規化**（資源CD の normalize 等）に揃えないと winner 解決のアサートが偽陰性になり得る
- **類似**: [KB-371](./KB-371-csv-dashboard-dedup-postgres-bind-limit.md)（`dataHash IN` のチャンク）

## 本番記録（2026-05-08）

- **対象ホスト**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。Pi4／Pi3 playbook は **no hosts matched**（Pi3 専用手順 **不要**）
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh fix/fkojunst-mail-winner-stack-depth infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` マージ後は引数 `main`**）
- **最終 Detach Run ID**（接頭辞 `ansible-update-`）: **`20260508-230134-12773`**（**`PLAY RECAP` `ok=134` `changed=4` `failed=0` / `unreachable=0`**・リモート **`exit` `0`**）
- **マイグレーション**: **新規なし**（`prisma migrate deploy` / `status` 成功）
- **Pi5 本処理確認**: `ProductionScheduleFkojunstMailStatusSyncService.syncFromStatusMailDashboard()` をコンテナ内で直接実行し、**`FKOJUNST_Status mail sync completed`**・**`external completion recalculated`**・**`RESULT=...`** を確認（**real 37.309s**）
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（本記録 **約 141s**・Tailscale）

## References

- [deployment.md](../guides/deployment.md#fkojunst-mail-winner-triple-tuple-in-chunk-2026-05-08)
- [KB-371](./KB-371-csv-dashboard-dedup-postgres-bind-limit.md)
- [ADR-20260508-fkojunst-status-sole-source](../decisions/ADR-20260508-fkojunst-status-sole-source.md)
- **Git**: [PR #274](https://github.com/denkoushi/RaspberryPiSystem_002/pull/274)（squash merge **`411a635c`**）
