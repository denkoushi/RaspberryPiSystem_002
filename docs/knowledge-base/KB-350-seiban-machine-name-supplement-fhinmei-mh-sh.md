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
| 一覧 API（2026-04-17 追補） | 生産日程 **`listProductionScheduleRows`** の各行に **`resolvedMachineName`** を付与（`resolveSeibanMachineDisplayNamesBatched`・100件超はサーバ内バッチ）。キオスク順位ボードは **`POST …/seiban-machine-names` に依存しない**。機種名検索（`machineName` クエリ）は **MH/SH の FHINMEI** に加え **補完テーブル由来の表示名**と整合するよう `FSEIBAN` 集合で絞り込み |
| 取込後同期 | Gmail / 手動 `POST .../csv-dashboards/:id/upload` の **成功後**、`CsvDashboardPostIngestService` が補完同期を実行 |

## 運用メモ

- **マイグレーション**: `20260417150000_add_production_schedule_seiban_machine_name_supplement` を適用してから API 起動。
- **スケジュール**: `defaultBackupConfig.csvImports` に `csv-import-seiban-machine-name-supplement`（`15 6 * * 0`・**既定 disabled**）を追加済み。有効化するときは Gmail トークンと `targets` のダッシュボードIDを確認。
- **既存 `backup.json` への反映**: `defaultBackupConfig` に定義しただけでは、**既に本番にある `config/backup.json` へは増えない**。2026-04-17 の追補で、**`ImportScheduleAdminService` / `CsvImportScheduler` 起動時に固定スケジュールを保証して保存**するようにした（FKOJUNST と同系）。一覧 API で見えない場合は **`/api/imports/schedule`** がこの ensure 経路を通っているか確認する。
- **応答**: `machineNames` は従来どおり `Record<string, string \| null>` だが、**未解決は null ではなく `機種名未登録` 文字列**で埋める（空欄表示を廃止）。

## 本番デプロイ実績（2026-04-17）

- **ブランチ**: `feat/seiban-machine-name-supplement-gmail`（代表コミット **`c770cb9d`**）。
- **手順**: [deployment.md](../guides/deployment.md) の `update-all-clients.sh` 標準。`export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh feat/seiban-machine-name-supplement-gmail infrastructure/ansible/inventory.yml --limit <host> --detach --follow` を **対象ホストごとに 1 台ずつ**（**Pi3 除外**）。
- **Detach Run ID**（Pi5 上ログ接頭辞 `ansible-update-`）: `20260417-135407-32471`（`raspberrypi5`）→ `20260417-140318-6669`（`raspberrypi4`）→ `20260417-140736-11875`（`raspi4-robodrill01`）→ `20260417-141050-21814`（`raspi4-fjv60-80`）→ `20260417-141730-23351`（`raspi4-kensaku-stonebase01`）。各 **`PLAY RECAP` `failed=0` / `unreachable=0`**。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **29s**・Mac / Tailscale）。
- **追補（2026-04-17・Pi5 のみ）**: ブランチ `feat/seiban-machine-name-supplement-schedule-ensure`・コミット **`cb88b67b`**。**事象**: 実装・5台デプロイ済みでも、既存 **`config/backup.json`** に `csv-import-seiban-machine-name-supplement` が無く、管理画面一覧に出なかった。**対策**: 固定スケジュール ensure を追加し、Pi5 のみ `./scripts/update-all-clients.sh feat/seiban-machine-name-supplement-schedule-ensure infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow` で反映。**Detach Run ID**: `20260417-145842-8036`（`failed=0` / `unreachable=0`）。**確認**: Pi5 `backup.json` と `GET /api/imports/schedule` の双方で `csv-import-seiban-machine-name-supplement` が出現、`enabled=false`・cron `15 6 * * 0`・target `e2f3a4b5-c6d7-4e8f-9a0b-1c2d3e4f5a6b` を確認。Phase12 は **PASS 43 / WARN 0 / FAIL 0**。
- **トラブルシュート（ローカル DB）**: 一時 PostgreSQL で `prisma migrate deploy` する場合、**`vector` 拡張**が必要なマイグレーションがあるため、素の `postgres:16` では失敗しうる。**`pgvector/pgvector:pg16`** 等を使う（既知は [EXEC_PLAN.md](../../EXEC_PLAN.md) Surprises・[deployment.md](../guides/deployment.md) 2026-03-31 知見）。

## 追補（2026-04-17）: Gmail 手動 run 前の固定ダッシュボード ensure + Pi5 デプロイ（Trivy APT 鍵）

- **実装**: **`CsvDashboardImportService.ensureFixedDashboardIfNeeded`** が、Gmail 由来の **`CsvDashboard` 取込パス**の前に **固定 ID**（`PRODUCTION_SCHEDULE_SEIBAN_MACHINE_NAME_SUPPLEMENT_DASHBOARD_ID`・列 **`FHINMEI_MH_SH` / `FSEIBAN`**）の `CsvDashboard` を **upsert**。定義の単一ソースは `seiban-machine-name-supplement-dashboard.definition.ts`（seed も同定義を参照）。
- **ブランチ**: `debug/gmail-csv-manual-run-not-trashing`・代表コミット **`b1d6af9b`**。
- **本番デプロイ（対象 Pi5 のみ・Pi3 除外）**: [deployment.md](../guides/deployment.md) 標準。`export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh debug/gmail-csv-manual-run-not-trashing infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`。
- **失敗（apt / Trivy）**: Detach **`20260417-160004-10564`** / **`20260417-160131-23680`** は **`server` ロール**の **`apt update`** が **Trivy 用リポジトリ**（`/etc/apt/sources.list.d/trivy.list`・`signed-by=/usr/share/keyrings/trivy.gpg`）の **GPG 署名検証失敗**で **`PLAY RECAP failed=1`**。**Pi5 での復旧例**: `sudo rm -f /usr/share/keyrings/trivy.gpg` のうえで `curl -fsSL https://aquasecurity.github.io/trivy-repo/deb/public.key | sudo gpg --batch --no-tty --dearmor -o /usr/share/keyrings/trivy.gpg` → `sudo chmod 644 /usr/share/keyrings/trivy.gpg` → `sudo apt-get update` がエラーなく完走することを確認（**非対話 SSH** では `gpg` に **`--batch --no-tty`** が必要）。
- **成功**: Detach **`20260417-160328-2759`**（**`failed=0` / `unreachable=0`**）・**Phase12** `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **24s**）。
- **PR**: [#157](https://github.com/denkoushi/RaspberryPiSystem_002/pull/157)（**`main` マージ**・merge **`ea76da7e`**）。

## 追補（2026-04-17）: 一覧API `resolvedMachineName` 共通化 + Pi5→Pi4 順次デプロイ

- **実装**: 生産日程一覧（`listProductionScheduleRows`）の各行に **`resolvedMachineName`** を付与（`production-schedule-machine-name-enrichment.service.ts`・`resolveSeibanMachineDisplayNamesBatched`）。**100件超**のユニーク製番は **サーバ内で 100 件単位に分割**して既存解決ロジックを再利用。キオスク **`ProductionScheduleLeaderOrderBoardPage`** は `POST .../seiban-machine-names` を呼ばず**一覧レスポンスのみ**表示に利用。サイネージ用 **`leader-board-pure`** も `resolvedMachineName` を優先。**機種名フィルタ**（`machineName`）は **補完テーブル由来の表示名**と表示がずれないよう、`CsvDashboardRow` の MH/SH と **`ProductionScheduleSeibanMachineNameSupplement`** の両方から一致する `FSEIBAN` を集約して条件化。
- **ブランチ**: `feat/production-schedule-machine-name-common-api`・代表コミット **`6ed72f83`**。
- **本番デプロイ（対象 Pi5 のみ → 続けて Pi4 のみ・Pi3 除外）**: [deployment.md](../guides/deployment.md) 標準。`export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh feat/production-schedule-machine-name-common-api infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow` **成功後**に `./scripts/update-all-clients.sh feat/production-schedule-machine-name-common-api infrastructure/ansible/inventory.yml --limit raspberrypi4 --detach --follow`。
- **Detach Run ID**（Pi5 上ログ接頭辞 `ansible-update-`）: **`20260417-175707-4538`**（`raspberrypi5`）→ **`20260417-180747-13902`**（`raspberrypi4`）、各 **`PLAY RECAP` `failed=0` / `unreachable=0`**。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **61s**）。**トラブルシュート**: 同一 Mac から `update-all-clients.sh` を並列起動しない（exit 3・[deploy-status-recovery.md](../runbooks/deploy-status-recovery.md)）。**知見**: 旧 **`POST …/seiban-machine-names`** はリクエストに **最大 100 製番**（Zod）があり、ユニーク製番が 100 を超えると **400** となり順位ボードに機種名が出なかった。一覧側で解決する方式に寄せて回避。

## References

- 一覧付与: `apps/api/src/services/production-schedule/production-schedule-machine-name-enrichment.service.ts`
- 実装: `apps/api/src/services/production-schedule/seiban-machine-name-supplement-sync.service.ts`
- 解決: `apps/api/src/services/production-schedule/seiban-machine-display-names.service.ts`
- ガイド: [csv-import-export.md](../guides/csv-import-export.md)
