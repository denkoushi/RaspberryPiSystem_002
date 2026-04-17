---
title: 'KB-350: 製番→機種名補完（Gmail FHINMEI_MH_SH）'
tags: [生産スケジュール, CSVダッシュボード, キオスク, 機種名]
audience: [開発者, 運用者]
last-verified: 2026-04-17
category: knowledge-base
---

# KB-350: 製番→機種名補完（Gmail `FHINMEI_MH_SH`）

## Context

リーダー順位ボード等で製番ごとの機種表示名を安定させるため、生産日程本体CSVに **MH/SH 行が無い**製番向けに、別CSVで **製番→機種名** を補う。

## 仕様（確定）

| 項目 | 内容 |
|------|------|
| Gmail 件名 | **`FHINMEI_MH_SH`**（`CsvDashboard.gmailSubjectPattern`） |
| 列（内部名） | **`FSEIBAN`**, **`FHINMEI_MH_SH`** |
| ダッシュボードID（固定・seed） | `e2f3a4b5-c6d7-4e8f-9a0b-1c2d3e4f5a6b`（定数 `PRODUCTION_SCHEDULE_SEIBAN_MACHINE_NAME_SUPPLEMENT_DASHBOARD_ID`） |
| 取り込みモード | **APPEND**（履歴行が蓄積される想定） |
| 重複 `FSEIBAN` | **今回の ingest run で追加された `CsvDashboardRow` のみ**を対象に、**`createdAt` / `id` 昇順**で走査し、**同一製番は末尾行の `FHINMEI_MH_SH` が正**。空の機種名で終わる場合はその製番は補完テーブルに行を作らない（= 未登録扱いへ） |
| 解決順（API） | 既存 **`fetchSeibanProgressRows`（MH/SH の FHINMEI）** → 補完テーブル → どちらも無い／空は **`機種名未登録`**（定数 `SEIBAN_MACHINE_NAME_UNREGISTERED_LABEL`） |
| 取込後同期 | Gmail / 手動 `POST .../csv-dashboards/:id/upload` の **成功後**、`CsvDashboardPostIngestService` が補完同期を実行 |

## 運用メモ

- **マイグレーション**: `20260417150000_add_production_schedule_seiban_machine_name_supplement` を適用してから API 起動。
- **スケジュール**: `defaultBackupConfig.csvImports` に `csv-import-seiban-machine-name-supplement`（`15 6 * * 0`・**既定 disabled**）を追加済み。有効化するときは Gmail トークンと `targets` のダッシュボードIDを確認。
- **応答**: `machineNames` は従来どおり `Record<string, string \| null>` だが、**未解決は null ではなく `機種名未登録` 文字列**で埋める（空欄表示を廃止）。

## 本番デプロイ実績（2026-04-17）

- **ブランチ**: `feat/seiban-machine-name-supplement-gmail`（代表コミット **`c770cb9d`**）。
- **手順**: [deployment.md](../guides/deployment.md) の `update-all-clients.sh` 標準。`export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh feat/seiban-machine-name-supplement-gmail infrastructure/ansible/inventory.yml --limit <host> --detach --follow` を **対象ホストごとに 1 台ずつ**（**Pi3 除外**）。
- **Detach Run ID**（Pi5 上ログ接頭辞 `ansible-update-`）: `20260417-135407-32471`（`raspberrypi5`）→ `20260417-140318-6669`（`raspberrypi4`）→ `20260417-140736-11875`（`raspi4-robodrill01`）→ `20260417-141050-21814`（`raspi4-fjv60-80`）→ `20260417-141730-23351`（`raspi4-kensaku-stonebase01`）。各 **`PLAY RECAP` `failed=0` / `unreachable=0`**。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **29s**・Mac / Tailscale）。
- **トラブルシュート（ローカル DB）**: 一時 PostgreSQL で `prisma migrate deploy` する場合、**`vector` 拡張**が必要なマイグレーションがあるため、素の `postgres:16` では失敗しうる。**`pgvector/pgvector:pg16`** 等を使う（既知は [EXEC_PLAN.md](../../EXEC_PLAN.md) Surprises・[deployment.md](../guides/deployment.md) 2026-03-31 知見）。

## References

- 実装: `apps/api/src/services/production-schedule/seiban-machine-name-supplement-sync.service.ts`
- 解決: `apps/api/src/services/production-schedule/seiban-machine-display-names.service.ts`
- ガイド: [csv-import-export.md](../guides/csv-import-export.md)
