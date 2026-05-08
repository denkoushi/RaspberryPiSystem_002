---
title: KB-371 CSVダッシュボード DEDUP 取込の PostgreSQL バインド上限（32767）超過
tags: [CSV, csvDashboard, Prisma, PostgreSQL, インポート]
audience: [開発者, 運用者]
last-verified: 2026-05-08
related: [deployment.md, csv-import-export.md]
category: knowledge-base
---

# KB-371: CSVダッシュボード DEDUP 取込の PostgreSQL バインド上限超過

## Context

- **いつ**: 2026-05-08 以降の本番反映を記録
- **どこ**: 管理コンソールの **手動 CSV インポート** または **Gmail/Dropbox 経由の `csvDashboards` スケジュール**・Pi5 上の **API コンテナ**
- **前提**: `CsvDashboardIngestor` の **`ingestMode === DEDUP`** で、既存行照合に **`csvDashboardRow.findMany({ where: { dataHash: { in: incomingHashes }}})`** を使っていた

## Symptoms

- UI または API 経由でインポート実行後、**500** 相当で **`インポート実行に失敗しました:`** に続き、Prisma 経由で以下に近い文言:
  - `Invalid prisma.csvDashboardRow.findMany() invocation`
  - `Assertion violation on the database: too many bind variables in prepared statement, expected maximum of 32767, received 32768`
- **1 回の CSV** に **ユニークな `dataHash` が約 32767 件前後以上**（重複除去後でも IN 句が限界を超えると発生しやすい）

## Investigation

- **CONFIRMED**: PostgreSQL の prepared statement は **バインド変数に上限**（典型値 **32767**）。`where` に **`csvDashboardId`（1）** + **`dataHash IN (...)`（N）** があるため、**N が大きいと 32768 前後で確定エラー**になり得る
- **CONFIRMED**: 症状は **Pi5 API のみ**（キオスク Pi4 は API を載せない標準構成では **当該クエリは発生しない**）

## Root cause

- DEDUP 取込時に **全 `incomingHashes` を単一 `findMany` に載せていた**ため、超大規模 CSV で **IN リストのバインド数が DB 上限を超えた**

## Fix（実装）

- **チャンク分割照合**: [`csv-dashboard-existing-rows-by-hash.reader.ts`](../../apps/api/src/services/csv-dashboard/csv-dashboard-existing-rows-by-hash.reader.ts) の **`findCsvDashboardRowsByDataHashes`** で **`dataHash` を重複除去のうえ複数回 `findMany`**し、結果を結合
- **ingestor 差し替え**: [`csv-dashboard-ingestor.ts`](../../apps/api/src/services/csv-dashboard/csv-dashboard-ingestor.ts) が上記 reader を呼ぶ
- **代表コミット**: **`f4360e0d`**（ブランチ **`fix/csv-import-bind-limit-dedup`**）
- **回帰テスト**: [`csv-dashboard-existing-rows-by-hash.reader.test.ts`](../../apps/api/src/services/csv-dashboard/__tests__/csv-dashboard-existing-rows-by-hash.reader.test.ts)（32768 件境界など）

## Prevention / Troubleshooting

- **運用**: 修正後も **極大 CSV** は **処理時間・メモリ**が増えるため、分割運用は併用可能
- **切り分け**: 同文言が出る場合は **API イメージが修正コミット以降か**（Pi5 の `git log` / デプロイ Detach ログの **`Git: changed`**）
- **暫定回避（旧版のみ）**: 取込 CSV を **件数を下げる**（本修正後は原則不要）

## 本番記録（2026-05-08）

- **対象ホスト**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。Pi4／Pi3 playbook は **no hosts matched**（Pi3 専用手順 **不要**）
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh fix/csv-import-bind-limit-dedup infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` マージ後は引数 `main`**）
- **Detach Run ID**（接頭辞 `ansible-update-`）: **`20260508-202603-25493`**（**`PLAY RECAP` `ok=134` `changed=4` `failed=0` / `unreachable=0`**・リモート **`exit` `0`**・ローカル **`--follow` 約 783s（約 13.0 分）**）
- **マイグレーション**: **新規なし**（`prisma migrate deploy` / `status` 成功）
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（本記録 **約 134s**・Tailscale）

## References

- [deployment.md](../guides/deployment.md#csv-dedup-ingest-postgres-bind-limit-2026-05-08)
- [csv-import-export.md](../guides/csv-import-export.md)
- [api.md](./api.md)（索引）
