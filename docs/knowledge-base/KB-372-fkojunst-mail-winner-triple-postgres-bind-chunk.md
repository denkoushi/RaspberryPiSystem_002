---
title: KB-372 FKOJUNST メール winner 照合の PostgreSQL バインド上限（複合3キー・チャンク）
tags: [FKOJUNST_Status, fkmail, Prisma, PostgreSQL, 生産スケジュール]
audience: [開発者, 運用者]
last-verified: 2026-05-08
related: [deployment.md, KB-371, ADR-20260508-fkojunst-status-sole-source]
category: knowledge-base
---

# KB-372: FKOJUNST メール winner 照合の PostgreSQL バインド上限（複合3キー・チャンク）

## Context

- **いつ**: 2026-05-08 以降の本番反映を記録
- **どこ**: Pi5 **API コンテナ**・`FKOJUNST_Status` **Gmail CSV** 取込経路（[`fkojunst-status-mail-sync.pipeline.ts`](../../apps/api/src/services/production-schedule/fkojunst-status-mail-sync.pipeline.ts)）
- **前提**: [ADR-20260508-fkojunst-status-sole-source](../decisions/ADR-20260508-fkojunst-status-sole-source.md) により **`fkmail` が一覧・メール完了の正本**。幕（生産スケジュール `CsvDashboard`）上の **winner 行 ID** を、メール側の **3キー**（`FKOJUN` / `FSIGENCD` 相当の資源CD / `FSEIBAN` 相当）で解決する処理が **`$queryRaw` + 巨大 `IN`** になっていた

## Symptoms

- メール同期バッチまたは関連 API ログで **500** 級・Prisma / DB 側に近い文言:
  - `Assertion violation on the database: too many bind variables in prepared statement, expected maximum of 32767, received …`
- **1 回の同期**で **ユニークな複合3キー候補が極端に多い**ときに発生しやすい（3 本の `IN` + 結合条件で **バインド総数が積み上がる**）

## Investigation

- **CONFIRMED**: PostgreSQL の prepared statement は **バインド変数に上限**（典型 **32767**）。旧実装は **複数列に対する巨大 `IN`** を **少数クエリ**に載せ、**総バインド数が上限を超えうる**
- **CONFIRMED**: 症状は **Pi5 API のみ**（キオスク Pi4 は当該クエリを載げない標準構成では **発生しない**）

## Root cause

- **winner 解決**で **全候補キーを単一（またはバインド過密な）`$queryRaw`** に載せていたため、大規模メール差分時に **バインド数が DB 上限を超えた**

## Fix（実装）

- **上限定数・タプル安全件数**: [`postgres-prepared-statement-bind-limit.ts`](../../apps/api/src/lib/postgres-prepared-statement-bind-limit.ts) の **`POSTGRES_PREPARED_STATEMENT_MAX_BIND_PARAMS`** と **`maxTuplePlaceholdersPerQuery`**
- **チャンク reader**: [`fkojunst-mail-winner-by-triple.reader.ts`](../../apps/api/src/services/production-schedule/fkojunst-mail-winner-by-triple.reader.ts) の **`findFkojunstMailWinnerIdsByMailTriples`** — **`(fkojun, fkoteicd, fsezono)` タプルの `IN` をチャンク分割**し **複数回 `$queryRaw`**、**`Map` をマージ**
- **論理キー**: [`fkojunst-mail-status-key.ts`](../../apps/api/src/services/production-schedule/fkojunst-mail-status-key.ts) の **`buildFkojunstMailStatusKey`**
- **pipeline 配線**: [`fkojunst-status-mail-sync.pipeline.ts`](../../apps/api/src/services/production-schedule/fkojunst-status-mail-sync.pipeline.ts) が reader を使用
- **関連**: [`csv-dashboard-existing-rows-by-hash.reader.ts`](../../apps/api/src/services/csv-dashboard/csv-dashboard-existing-rows-by-hash.reader.ts) は **同一 lib の定数**を参照（KB-371 と同系）
- **代表コミット**: **`a9fd7fcf`**（ブランチ **`fix/fkojunst-mail-winner-triple-chunk`**）·**`main`**: [PR #274](https://github.com/denkoushi/RaspberryPiSystem_002/pull/274)（squash **`411a635c`**）
- **テスト**: [`fkojunst-mail-winner-by-triple.reader.test.ts`](../../apps/api/src/services/production-schedule/__tests__/fkojunst-mail-winner-by-triple.reader.test.ts)·（任意）Docker 一時 Postgres による統合テスト

## Prevention / Troubleshooting

- **切り分け**: 同文言が出る場合は **API イメージが修正コミット以降か**（Pi5 `git log` / Detach **`Git: changed`**）
- **開発時**: 一時 DB での統合テストは **`prisma migrate deploy` 済み**であること。**テスト行の 3キー**は **本番と同じ正規化**（資源CD の normalize 等）に揃えないと winner 解決のアサートが偽陰性になり得る
- **類似**: [KB-371](./KB-371-csv-dashboard-dedup-postgres-bind-limit.md)（`dataHash IN` のチャンク）

## 本番記録（2026-05-08）

- **対象ホスト**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。Pi4／Pi3 playbook は **no hosts matched**（Pi3 専用手順 **不要**）
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh fix/fkojunst-mail-winner-triple-chunk infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` マージ後は引数 `main`**）
- **Detach Run ID**（接頭辞 `ansible-update-`）: **`20260508-211407-25543`**（**`PLAY RECAP` `ok=134` `changed=4` `failed=0` / `unreachable=0`**・リモート **`exit` `0`**・ローカル **`--follow` 約 1063s（約 17.7 分）**）
- **マイグレーション**: **新規なし**（`prisma migrate deploy` / `status` 成功）
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（本記録 **約 167s**・Tailscale）

## References

- [deployment.md](../guides/deployment.md#fkojunst-mail-winner-triple-tuple-in-chunk-2026-05-08)
- [KB-371](./KB-371-csv-dashboard-dedup-postgres-bind-limit.md)
- [ADR-20260508-fkojunst-status-sole-source](../decisions/ADR-20260508-fkojunst-status-sole-source.md)
- **Git**: [PR #274](https://github.com/denkoushi/RaspberryPiSystem_002/pull/274)（squash merge **`411a635c`**）
