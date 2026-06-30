---
title: KB-297: キオスク納期管理（製番納期・部品優先・切削除外設定）の実装
tags: [production-schedule, kiosk, due-management, priority]
audience: [開発者, 運用者]
last-verified: 2026-06-30
related:
  - ../decisions/ADR-20260307-kiosk-due-management-model.md
  - ../decisions/ADR-20260319-production-schedule-manual-order-target-location.md
  - ../decisions/ADR-20260319-manual-order-device-scope-v2.md
  - ../guides/csv-import-export.md
  - ./KB-324-gmail-order-supplement-prisma-transaction.md
  - ./KB-326-manual-upload-order-supplement-sync.md
category: knowledge-base
---

# KB-297: キオスク納期管理（製番納期・部品優先・切削除外設定）の実装

## Context

- 生産スケジュールで「行単位の納期設定」だけでは、現場リーダーが製番単位で全体調整しづらい
- 切削判定が「研削以外すべて」だったため、塗装系コード（`10`, `MSZ`）が切削に混入する運用課題があった
- 既存画面との互換を保ちつつ、製番単位納期管理へ段階移行する必要があった

## Symptoms

- 製番納期を部品・工程へ反映する作業が手動で重い
- 部品優先順位の保存先がなく、提案順と実運用順を分離できない
- 工程カテゴリ（研削/切削）の切替結果が実態とずれる

## Investigation

- H1: `ProductionScheduleRowNote.dueDate` のみで製番単位運用を吸収できる  
  - Result: REJECTED（行単位のみで、製番全体更新/再読込が困難）
- H2: 製番納期を別テーブル化し、既存行へwritebackすれば互換維持できる  
  - Result: CONFIRMED
- H3: 切削除外リストをロケーション別設定にすれば、現場差異へ追従できる  
  - Result: CONFIRMED

## Root cause

- 既存モデルが「行単位最適化」で、製番単位の意思決定（納期・優先順）を保持する境界がなかった

## Fix

- DBに以下を追加
  - `ProductionScheduleSeibanDueDate`（製番納期）
  - `ProductionSchedulePartPriority`（製番内の部品優先順位）
  - `ProductionScheduleResourceCategoryConfig`（切削除外リスト）
- キオスク専用APIを追加
  - `GET /api/kiosk/production-schedule/due-management/summary`
  - `GET /api/kiosk/production-schedule/due-management/seiban/:fseiban`
  - `PUT /api/kiosk/production-schedule/due-management/seiban/:fseiban/due-date`
  - `PUT /api/kiosk/production-schedule/due-management/seiban/:fseiban/part-priorities`
- `DueDateWritebackService`で製番納期更新時に既存`row dueDate`へ反映（互換維持）
- 管理コンソールに切削除外設定API/UIを追加
  - `GET/PUT /api/production-schedule-settings/resource-categories`
- キオスクに新画面を追加
  - `/kiosk/production-schedule/due-management`

## Prevention

- ポリシー層を分離して、工程カテゴリ判定・表面処理優先を呼び出し側から隔離
- 切削除外リストはロケーション別設定で変更可能にし、コード修正なしで運用調整可能
- 回帰防止として、ポリシーユニットテストとキオスク統合テスト（due-management系）を追加

## 部品納期個数CSVの補助反映（2026-04-01）

- **Context**:
  - 全体ランキングの算出式改善を先に進める前に、`指示数`・`着手日`・`完了日` を既存生産日程へ安全に取り込みたい要件が発生。
  - 既存の winner 判定（`FSEIBAN + FHINCD + FSIGENCD + FKOJUN` で `ProductNo` 最大採用）は多数APIで共有されており、変更すると影響範囲が大きい。
- **Fix（境界分離）**:
  - 件名 `部品納期個数` は **別 `CsvDashboard`** で取り込み、既存生産日程本体CSVとは分離。
  - 補助情報は `ProductionScheduleOrderSupplement` テーブルで保持し、`rowData` へ直書きしない。
  - 照合キーは `FKOJUN + FSIGENCD + ProductNo`。サンプル検証で `FSIGENCD + ProductNo` のみだと衝突があるため不採用。
  - 一覧APIは `plannedQuantity` / `plannedStartDate` / `plannedEndDate` をトップレベルで返却し、`dueDate` と意味を混在させない。
- **Prevention**:
  - winner 判定ロジックは据え置き、補助反映ロジックは専用サービスへ閉じ込める。
  - 補助CSVの未照合行は unmatched として集計し、照合品質を継続監視できるようにする。
- **補助同期の Prisma トランザクション失敗（2026-04-02）**:
  - 長いインタラクティブトランザクション内の逐次 `upsert` や、winner 付け替えと複合一意制約の組み合わせで失敗しうる。**対策・手順の正本**: [KB-324](./KB-324-gmail-order-supplement-prisma-transaction.md)。
- **手動CSVアップロード経路の取り残し（2026-04-03 修正）**:
  - 補助ダッシュボードへの **`POST /api/csv-dashboards/:id/upload`** では、行取込後に **Gmail 経路と同じ** `syncFromSupplementDashboard` が走るよう統一した。**症状・原因・運用**: [KB-326](./KB-326-manual-upload-order-supplement-sync.md)。
- **補助は付くが特定行だけ納期・個数が空／上流の工程変更とのギャップ（2026-04 調査）**:
  - 本体の winner 論理キー（`FSEIBAN+FHINCD+FSIGENCD+FKOJUN`）と、補助照合3キー（`ProductNo+FSIGENCD+FKOJUN`）の関係、本体取込失敗・unmatched・管理UIの二重ファイル入力、上流クエリ（資源CD欠落）の知見を **[KB-328](./KB-328-production-schedule-supplement-key-mismatch-investigation.md)** に集約した（判断候補・トラブルシュート含む）。

### 補助 `plannedEndDate` の字句拡張（ISO datetime 等・2026-05-01） {#order-supplement-planned-end-date-parse-2026-05-01}

- **Context**: 部品納期個数 CSV の **`plannedEndDate`** が **`YYYY-MM-DDTHH:mm:ss`** 等で届く一方、`order-supplement-sync` の **`parsePlannedDate`** が受理せず **null** になり、`ProductionScheduleOrderSupplement` に **計画納期が載らない**。キオスクでは **`dueDate` 無し時の表示納期**（`plannedEndDate` フォールバック）が `-` になる。
- **Fix**: [`order-supplement-sync.pipeline.ts`](../../apps/api/src/services/production-schedule/order-supplement-sync.pipeline.ts) で日付字句を拡張（**ISO 接頭辞＋時刻**・**`YYYY/M/D`** 等）。**Prisma マイグレーションなし**。回帰: [`order-supplement-sync.service.test.ts`](../../apps/api/src/services/production-schedule/__tests__/order-supplement-sync.service.test.ts)（例: **`2026-05-08T00:00:00`**）。
- **本番反映（2026-05-01）**: [deployment.md](../guides/deployment.md) 標準・**`raspberrypi5` のみ**。**Detach Run ID**（`ansible-update-`）: **`20260501-122119-30686`**（**`failed=0` / `unreachable=0` / exit `0`**・**`ok=130` `changed=4`**）。**実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **28s**）。
- **トラブルシュート**: **既存行が null のまま**なら **補助の再取込／同期**が必要（コードだけでは過去行が自動では埋まらない）。CSV には日付があるのに unmatched のときは **[KB-328](./KB-328-production-schedule-supplement-key-mismatch-investigation.md)** で winner／3キーを確認。

### 補助 `plannedEndDate` の更新時空値維持とバックフィル（2026-05-01） {#order-supplement-planned-end-date-retain-2026-05-01}

- **仕様（同期ポリシー）**: 差分同期の **update** で **`mergePlannedEndDateForUpdate(fromCsv, existing) => fromCsv ?? existing`**。補助 CSV に当該キー行があり **`plannedEndDate` が空またはパース不能（null）** のとき、**既存の計画納期を null で上書きしない**（着手日の「CSV 空は既存維持」に同型）。**create** 経路は従来どおり CSV パース結果。
- **既存 null の回復（運用）**: [`backfill-order-supplement-planned-end-date.ts`](../../apps/api/src/scripts/backfill-order-supplement-planned-end-date.ts) が **`syncFromSupplementDashboard()` を 1 回**実行。手順の正本: [csv-import-export.md §D-補](../guides/csv-import-export.md#order-supplement-planned-end-date-backfill)·[deployment.md](../guides/deployment.md) 冒頭補足（2026-05-01）。
- **本番反映（2026-05-01）**: Pi5 **`raspberrypi5` のみ**（`--limit raspberrypi5`）。**Detach Run ID**（`ansible-update-`）: **`20260501-131827-4551`**（**`PLAY RECAP` `failed=0` / `unreachable=0`**・**`ok=130` `changed=4`**）。**実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **28s**）。
- **トラブルシュート**: **`pnpm backfill:order-supplement-planned-end-date:prod` が無い** → API イメージに `dist/scripts/backfill-order-supplement-planned-end-date.js` が乗っているか。**CSV 上も納期が空**なら **同期・バックフィル後も null**（更新は空を既存維持のため、ソースに字句が無いと埋まらない）。**字句あり・DB 空**はパース受理・[KB-328](./KB-328-production-schedule-supplement-key-mismatch-investigation.md) の winner／3キー切り分け。

### 着手日補助の差分同期・手動保護・保持期限（2026-05-01） {#order-supplement-incremental-sync-2026-05-01}

- **Context**: Gmail 取得頻度増加に伴い、補助CSVの **行欠落・着手日列の空** が増えると、旧実装の **テーブル全削除→再投入** により **既存の着手日まで消える**（順位ボード・購買照会で `-` が増える）。これは照合ロジックのバグではなく **入力ゆらぎに対する同期方式**の問題だった。
- **Fix（同期ポリシー）**:
  - `ProductionScheduleOrderSupplement` は **incremental**（**既存キーなし**→`createMany`、**既存キーあり**→`update`）。補助CSVに **当該論理キーが一時的に無い**だけでは **DB 行は残る**。
  - CSV で **`plannedStartDate` が空**でも、**自動同期では既存の非 null 着手日を NULL に戻さない**（現場で一度入った着手日を維持）。
  - **`plannedStartDateManuallySet=true`** の行は **着手日を CSV 同期で上書きしない**（DB でフラグを立てた行のみ。UI は別途要検討）。
  - **`lastSeenAt`**: 同期バッチに **キーが再出現した時刻**を記録（鮮度・将来拡張用）。
  - **保持期限**: **`plannedStartDate` が UTC 基準で 1 年以上前**かつ **`plannedStartDateManuallySet=false`** の行を **削除**（自動データの肥大化抑制）。手動保護行は削除しない。
  - **winner 行への既存補助と 3キー不整合（2026-05-06）**: `csvDashboardRowId` は本体 winner に **1:1**。DB の `productNo` / `resourceCd` / `processOrder` が CSV とずれていると、同期が **新規 create** に落ち **`P2002`** になり得た。**修正**: 同一 winner 行を指す既存行は **update で CSV 3キーへ整合**（[KB-328 §P2002](./KB-328-production-schedule-supplement-key-mismatch-investigation.md#order-supplement-sync-p2002-csv-dashboard-row-id)）。
  - **実装の正本**: [`order-supplement-sync.pipeline.ts`](../../apps/api/src/services/production-schedule/order-supplement-sync.pipeline.ts)·マイグレーション **`20260501015000_order_supplement_incremental_sync`**。
- **本番反映（2026-05-01）**: [deployment.md](../guides/deployment.md) 標準・**`raspberrypi5` のみ**。**Detach Run ID**（`ansible-update-`）: **`20260501-111010-10961`**（**`failed=0` / `unreachable=0`**）。**実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**。
- **本番反映（2026-05-06 · `P2002` / winner 行 update フォールバック）**: 同上標準・**`raspberrypi5` のみ**・`main`。**Detach Run ID**: **`20260505-223440-27566`**（**`PLAY RECAP` `ok=134` `changed=4` `failed=0`**）。**実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **61s**）。正本: [deployment.md](../guides/deployment.md)（2026-05-06 部品納期個数補助項）·[KB-328 §P2002](./KB-328-production-schedule-supplement-key-mismatch-investigation.md#order-supplement-sync-p2002-csv-dashboard-row-id)。
- **トラブルシュート**: 着手日が更新されないときは **補助CSVにその `(ProductNo, FSIGENCD, FKOJUN)` が存在するか**・**winner 照合（本体側）**・**手動フラグ**を確認。**Prisma の型**: relation 付きモデルで **`csvDashboardRowId` を更新する場合は `UncheckedUpdateInput` が必要**になり得る（ビルドで検知）。詳細計画: [`order-supplement-incremental-sync-execplan.md`](../plans/order-supplement-incremental-sync-execplan.md)。

**検証・本番反映（2026-04-01）**

- **実機回帰**: `./scripts/deploy/verify-phase12-real.sh` を全対象キオスクで実行し、**PASS 40 / WARN 0 / FAIL 0**（本リリースで `GET /api/kiosk/production-schedule` 応答に `"plannedQuantity"` を含むことの grep を追加したため、スクリプト合計 PASS が 39→40）。**2026-04-03**: 別機能のスモーク追加によりスクリプト基準は **PASS 41**（手動 upload 補助同期の Pi5 反映後も同基準で **PASS 41 / WARN 0 / FAIL 0** を確認）。
- **本番デプロイ**: `docs/guides/deployment.md` の `update-all-clients.sh` 標準のみ。**5台**を**1台ずつ**順次（Pi3 は従来どおり対象外）。GitHub Actions Detach Run ID: **20421618819**, **20421640357**, **20421660164**, **20421674891**, **20421685489** — いずれも Ansible `PLAY RECAP` **failed=0**。
- **トラブルシュート**: ローカルで統合テストが `localhost:5432` 接続失敗になる場合は Postgres 未起動の可能性が高い（`docker compose up -d postgres` 等）。実機スクリプト失敗時は `./tmp/phase12-real-<clientId>-<ts>.log` と `docs/guides/verification-checklist.md` §6.6 / §6.6.16 を参照。
- **本番 Gmail 取込・管理設定（2026-04-01・SSH/API/Prisma 経路）**:
  - **背景**: 管理コンソールのブラウザからは、埋め込みブラウザの証明書問題や Safari まわりの制約で UI 設定が困難な場合がある。**Pi5 に SSH できる管理者**は、[csv-import-export.md の production runbook 節](../guides/csv-import-export.md#production-runbook-gmail-csv-dashboard-import-via-ssh-and-api) に従い、`docker compose … exec api` と **管理 API** で **CsvDashboard の整合**と **`csvImports` 登録**を行える（Prisma は **api コンテナ内**が安定）。
  - **実績（部品納期個数）**: 本番の `backup.json` に補助用スケジュールが無い状態に加え、固定 ID `8f0b8d6e-4b77-4e7e-8d9a-6c8b2f5d1a31` の `CsvDashboard` が DB に存在しなかった。seed 同等の **`csvDashboard.upsert`** を本番で実施後、`POST /api/imports/schedule` で `csv-import-productionschedule_ordersupplement`（`provider: gmail`, `targets: [{ type: csvDashboards, source: 上記UUID }]`, cron `24,39,54 * * * *` ― 既存 Gmail 取り込みと分刻み衝突回避）を追加。**手動 1 回実行**は `POST .../run` に **`Content-Type: application/json` と body `{}`** が必要。取込 **76** 行・`ProductionScheduleOrderSupplement` 照合 **38** 行、Gmail 後処理（既読・ゴミ箱）まで確認済み。
  - **落とし穴**: ホストの `node` で `JWT_ACCESS_SECRET` を読めても、Prisma の `db:5432` に届かず失敗することがある。**JWT・Prisma・curl は api コンテナ内**で揃えて実行する。キオスク API 確認時の **`x-client-key` は実デバイス紐付けの `ClientDevice.apiKey`**（ダミーでは 401）。

## FKOJUNST status from Gmail CSV (2026-04-16)

- **Context**: Gmail 件名 **`FKOJUNST`** の CSV で工順ステータス（**C/P/S/R/X**）を取り込み、生産日程 **winner 行**へ反映してキオスク一覧・手動順に **「工順ST」** 列として出したい。既存の部品納期補助（`ProductionScheduleOrderSupplement`）とは意味が異なるため**混在させない**。
- **Fix（境界分離）**:
  - 専用 `CsvDashboard`（固定 ID **`9e4f2c1a-8b7d-4e6f-a5c4-1d2e3f4a5b6c`**・seed 名 `ProductionSchedule_FKOJUNST`）・`ingestMode: DEDUP`・`dedupKeyColumns: ['ProductNo','FSIGENCD','FKOJUN']`・`ProductNo` ヘッダ候補に **`FSESONO`**。
  - 保持テーブル **`ProductionScheduleFkojunstStatus`**（`sourceCsvDashboardId` 単位の **全削除→再作成**・winner 行 `csvDashboardRowId` へ紐付け）。一覧 API は **`LEFT JOIN`** で `rowData.FKOJUNST` に反映。
  - キオスク: `ProductionSchedulePage` / `ProductionScheduleManualOrderPage` に列追加（`displayRowDerivation` の `values.FKOJUNST`）。
- **運用（Gmail スケジュール）**: `backup.json` の `csvImports` に **固定ID** **`csv-import-productionschedule-fkojunst`**（`provider: gmail`・`targets: [{ type: csvDashboards, source: 9e4f2c1a-8b7d-4e6f-a5c4-1d2e3f4a5b6c }]`・cron **`0 0 * * *`**・1日1回深夜）を **API/スケジューラ読み込み時に自動補完**する。**`DELETE /api/imports/schedule/csv-import-productionschedule-fkojunst`** は **400**（システム固定で削除不可）。件名 `FKOJUNST` は **他用途と重複させない**（`CsvImportSubjectPattern` の一意制約）。手動で `POST /api/imports/schedule` して **同一ターゲットを足す必要は原則ない**（他の Gmail csvDashboards 運用は [csv-import-export.md の production runbook 節](../guides/csv-import-export.md#production-runbook-gmail-csv-dashboard-import-via-ssh-and-api) を参照）。
- **本番デプロイ（2026-04-16）**: [deployment.md](../guides/deployment.md) 標準（`export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh feature/fkojunst-gmail-status-import infrastructure/ansible/inventory.yml --limit "raspberrypi5" --detach --follow` **成功後**に同コマンドで `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`）。**Detach Run ID**（ログ接頭辞 `ansible-update-`）: `20260416-200358-17426` → `20260416-201513-2763` → `20260416-202019-27635` → `20260416-202436-9992` → `20260416-202952-27613`（各 **`failed=0` / `unreachable=0`**）。**Pi3**: 対象外。
- **本番デプロイ（2026-04-16・追記・Gmail スケジュール保証のみ）**: ブランチ **`feat/fkojunst-gmail-schedule-guarantee`**・コミット **`3a762893`**（`ImportScheduleAdminService` の DI 契約維持・`fkojunst-import-schedule.ensure` の `BackupConfigLoader.save` ガード・CI `import-schedule` / `csv-import-scheduler` 回帰）。**対象**: **`raspberrypi5` のみ**（API/DB のみのため Pi4・Pi3 は未デプロイ）。**コマンド**: `./scripts/update-all-clients.sh feat/fkojunst-gmail-schedule-guarantee infrastructure/ansible/inventory.yml --limit "raspberrypi5" --detach --follow`。**Detach Run ID**: `20260416-222237-18706`（**`failed=0` / `unreachable=0` / exit `0`**）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（初回 FKOJUNST 反映後は約 **89s**、Gmail スケジュール保証のみの Pi5 反映後は約 **56s**・いずれも既存の生産日程系チェックを含む）。
- **トラブルシュート**: 無効ステータス・winner 未照合は同期結果の **`skippedInvalidStatus` / `unmatched`** と API ログの **`[ProductionScheduleFkojunstSyncService] FKOJUNST rows skipped during sync`** を確認。`update-all-clients.sh` の **Mac 側ロック**（exit 3）は前ジョブ完了待ち。

## FKOJUNST_Status mail from Gmail CSV (2026-04-28) {#fkojunst_status-mail-from-gmail-csv-2026-04-28}

- **Context**: Gmail 件名 **`FKOJUNST_Status`** の CSV（**`FKOJUN`・`FKOTEICD`・`FSEZONO`・`FUPDTEDT`・`FKOJUNST`**）は、既存 **`FKOJUNST` 件名ルート**（`ProductNo`・`FSIGENCD`・`FKOJUN` キー）とは**別物**。**生産スケジュール本体 winner 行**に対して **`(FKOJUN, FKOTEICD→本体 `FSIGENCD`, FSEZONO→本体 `ProductNo`)** で照合し、一覧の **「工順ST」** 表示と **非表示制御**のみを担う（責務分離）。
- **Fix（境界分離）**:
  - 専用 `CsvDashboard`（固定 ID **`b7c8d9e0-f1a2-4b3c-9d4e-5f6a7b8c9d0e`**・`gmailSubjectPattern: FKOJUNST_Status`）・同一キーは **`FUPDTEDT` 最大**を正（字句は **`MM/DD/YYYY HH:mm:ss`** に加え **ISO8601（`…T…Z`・時刻必須）**・2026-05-01 以降は [`parseFkojunstStatusMailFupdteDt`](../../apps/api/src/services/csv-dashboard/csv-dashboard-datetime-parse.ts)）。
  - 保持テーブル **`ProductionScheduleFkojunstMailStatus`**（ソース毎 **全削除→再作成**・winner 行 `csvDashboardRowId` 一意）。**空・不正ステータス・日付パース不能**でも「メールでキーが当たった」判定のため **同期行に載せる**（DB 上は **`''`** / **`?`** と **epoch 代替日付**＋**不確実フラグ**で `FUPDTEDT` 競合時は不確実側を優先）。
  - 一覧 API（`listProductionScheduleRows`）: **`ProductionScheduleFkojunstMailStatus`（`fkmail`）を `LEFT JOIN`**（`fkst` は **一覧の FKOJUNST 表示・可視判定には使わない**）。可視条件は **`fkojunst-production-schedule-list-visibility.policy.ts`** で **COUNT と明細を同一 `WHERE`** に集約。**2026-05-09 改訂（順位ボードUX）**: **`fkmail` の `statusCode` が `S`/`R`/`C`/`X` のとき**一覧に残り、**`rowData.FKOJUNST`** は **`fkmail.statusCode`**。**`C`/`X`** は **完了**（実効完了・外部完了と整合）。**`fkmail` が無い** winner も **一覧から除外**。**`O`/`P`**・**`?`/`''`** 等は **一覧から除外**（**`O`/`P`** は **一覧非表示・未完了**で製番進捗集計の total には残る）。**歴史**: **2026-05-08** は **`S`/`R` のみ**可視とし **`C`/`X` 完了行が一覧から落ちた**ため、[deployment.md §2026-05-09](../guides/deployment.md#kiosk-leaderboard-fkojunst-cx-visible-2026-05-09) で **`C`/`X` を再表示**。
  - 取込後: **`CsvDashboardPostIngestService`** が当該ダッシュボード ID のとき **`ProductionScheduleFkojunstMailStatusSyncService.syncFromStatusMailDashboard`** を実行。手動アップロード応答に **`fkojunstMailSync`** を含め得る。
- **運用（Gmail スケジュール）**: 固定 ID **`csv-import-productionschedule-fkojunst-status-mail`**（cron **`5 1 * * *`**・既定 **`enabled: false`**・`targets` は **`b7c8d9e0-f1a2-4b3c-9d4e-5f6a7b8c9d0e`** へ強制）を **`ensureFkojunstStatusMailCsvImportSchedule`** が補完。**`DELETE …/csv-import-productionschedule-fkojunst-status-mail`** は **400**。
- **本番デプロイ（2026-04-28）**: [deployment.md](../guides/deployment.md) 補足（2026-04-28 FKOJUNST_Status）。**対象**: **`raspberrypi5` のみ**（**Pi4・Pi3 個別不要**）。**コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh feature/fkojunst-status-gmail-route infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` 取り込み後はブランチ名を `main` に**）。**Detach Run ID**（`ansible-update-`）: **`20260428-145623-7353`**（**`failed=0` / `unreachable=0` / exit `0`**）。
- **本番デプロイ（2026-04-28・追記・一覧 S/R のみ可視性・API のみ）**: ブランチ **`feat/production-schedule-fkojunst-sr-only-list`**・コミット **`06e62912`**（ポリシーモジュール・COUNT に `fkst` JOIN・キオスク統合テスト）。**対象**: **`raspberrypi5` のみ**。[deployment.md](../guides/deployment.md) 補足（**一覧 FKOJUNST S/R のみ**）。**コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh feat/production-schedule-fkojunst-sr-only-list infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`。**Detach Run ID**: **`20260428-181153-28174`**（**`failed=0` / `unreachable=0` / exit `0`**・所要 **約 1372s**）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（本記録 **約 62s**・FKOJUNST_Status 初回反映後）。**一覧 S/R のみ追補後**の再検証: **約 272s**（同一スクリプト・**PASS 43 / WARN 0 / FAIL 0**）。
- **トラブルシュート**: **キー不一致**（メールの **`FSEZONO` が本体 `ProductNo` と一致しない**等）は **`unmatched`** が増える。**一覧から消えた**がメールにはある行は **`statusCode` が `S`/`R`/`C`/`X` 以外**を確認（**`?`/`''` も非表示**・**`O`/`P`** も非表示）。**表示の正本は `fkmail` のみ**（旧 **`FKOJUNST`** Gmail ルートの `fkst` は **一覧・外部完了の判定に使わない**）。デプロイ fail-fast（未コミット/未追跡）は [KB-200](./infrastructure/ansible-deployment.md#kb-200-デプロイ標準手順のfail-fastチェック追加とデタッチ実行ログ追尾機能) どおり **commit** か **`git stash push -u`**。

### FKOJUNST_Status CSV 由来外部完了（`fkmail` status ベース・2026-05-08 改訂） {#fkojunst-status-external-completion-b-2026-05-02}

- **目的**: キオスクの手動チェックが無くても、**`FKOJUNST_Status` 同期済み `fkmail`** の **status** から **完了相当**を再計算する。**`rowData.FKOJUNST` は変更しない**（`ProductionScheduleExternalCompletion` で別管理）。
- **正本**: **`ProductionScheduleFkojunstMailStatus.statusCode` のみ**（旧 **dedupe キー消失差分**・**`fkst` フォールバック**は廃止）。仕様は [`fkojunst-mail-status-completion.policy.ts`](../../apps/api/src/services/production-schedule/completion/fkojunst-mail-status-completion.policy.ts) と同一。**一覧表示・完了**: **`C`/`X`**（キオスク順位ボードで完了カード/資源CDをグレーアウト確認できるよう 2026-05-09 に再表示）。**一覧表示・未完了**: **`S`/`R`**。**一覧非表示・未完了**: **`O`/`P`**（進捗集計の total に残る）。
- **メール同期後の再計算**: 全 winner に対し **`externallyCompletedFromFkojunstMailStatus`** = (**`C`/`X`**)、**`externallyCompletedFromFkojunstDisappeared`** は **常に false** に更新（列は後方互換のため残す）。**`isExternallyCompleted`** = メール完了 **OR** スケジュールCSV消失 **OR** 旧「消失」列（常に false のため実質メール+CSV）。
- **対象（生産日程CSV「消滅」同期）**: [**`buildFkojunstScheduleCsvDisappearanceEligibleScalarSql`**](../../apps/api/src/services/production-schedule/policies/fkojunst-production-schedule-list-visibility.policy.ts) — **`fkmail` あり**かつ **メール由来完了（`C`/`X`）以外**の winner に、本体CSVスナップショット差分で **`externallyCompletedFromScheduleCsvDisappeared`** を更新（**`fkmail` 無し**や **メール完了 `C`/`X`** の winner は CSV 消失で完了にしない。**`S`/`R` に限定しない**・`O`/`P`/その他も **消滅完了の対象になり得る**）。
- **異常時**: **正規化後・dedupe 後にキーが 1 つも無い**ときは **外部完了同期をスキップ**（誤って大量完了扱いにしない）。**`normalizedRows` が空で `fkmail` をクリアする**経路でも **外部完了テーブルは触らない**。
- **画面**: **`ProductionScheduleProgress.isCompleted` OR `isExternallyCompleted`** を **`progress` / `isCompleted` として同一表示**。適用: **進捗一覧**・**順位ボード**・**製番進捗集計**。
- **実装の正本**: [`fkojunst-external-completion-sync.repository.ts`](../../apps/api/src/services/production-schedule/external-completion/fkojunst-external-completion-sync.repository.ts)·[`fkojunst-external-completion-sync.service.ts`](../../apps/api/src/services/production-schedule/external-completion/fkojunst-external-completion-sync.service.ts)·[`production-schedule-effective-completion.sql.ts`](../../apps/api/src/services/production-schedule/production-schedule-effective-completion.sql.ts)·マイグレーション **`20260502103000_add_production_schedule_external_completion`**（**`ProductionScheduleFkojunstStatusMailDedupeKeySnapshot` テーブルは DB に残り得るが、アプリは 2026-05-08 以降参照しない**）。
- **再計算トリガ（運用）**:
  - **`FKOJUNST_Status` メール CSV** の取込成功後（Gmail / 手動 upload の両方）は、**`ProductionScheduleFkojunstMailStatusSyncService.syncFromStatusMailDashboard`** のあと **外部完了同期**が走る。
  - **生産日程本体 CSV**（固定 `CsvDashboard` ID **`PRODUCTION_SCHEDULE_DASHBOARD_ID`**）の取込成功後も [`CsvDashboardPostIngestService`](../../apps/api/src/services/csv-dashboard/csv-dashboard-post-ingest.service.ts) が **現行 Status CSV を読み直して**外部完了を **再同期**する（winner 変更への追従）。
- **本番デプロイ（2026-05-02）**: [deployment.md](../guides/deployment.md) 標準・**`raspberrypi5` のみ**（`--limit raspberrypi5`）。ブランチ **`feature/fkojunst-external-completion-b`**・代表コミット **`a83c5439`**。**Detach Run ID**（接頭辞 `ansible-update-`）: **`20260502-215033-1769`**（**`PLAY RECAP` `failed=0` / `unreachable=0` / exit `0`**・**`ok=130` `changed=4`**・所要 **約 1445s**）。
- **本番デプロイ（2026-05-05・キー消失差分）**: [deployment.md](../guides/deployment.md) 標準・**`raspberrypi5` のみ**。ブランチ **`feat/fkojunst-status-disappearance-external-completion`**・代表コミット **`6d9c3549`**。**Detach Run ID**: **`20260505-072811-487`**（**`PLAY RECAP` `ok=134` `changed=4` `failed=0` / `unreachable=0`**・exit **`0`**・**`--follow` 約 617s**）。**マイグレーション `20260504220000_fkojunst_status_mail_dedupe_key_snapshot`** は Pi5 **`prisma migrate deploy`** で適用済み（**2026-05-08 以降、アプリは当該スナップショットを使用しない**）。
- **本番デプロイ（2026-05-08・正本統一コード・Pi5）**: [deployment.md の FKOJUNST 唯一正本項](../guides/deployment.md#fkojunst-status-sole-source-2026-05-08) を正とする。ブランチ **`feat/fkojunst-status-cx-completion`**・代表コミット **`d12b40de`**（ポリシー **`fkojunst-mail-status-completion` / `fkojunst-production-schedule-list-visibility`**・外部完了同期からキー消失差分除去・`fkojunst-status-mail-dedupe-key-snapshot.repository` 削除・キオスク統合テスト追随）。**対象**: **`raspberrypi5` のみ**。**Detach Run ID**: **`20260508-192843-15997`**（**`PLAY RECAP` `ok=134` `changed=4` `failed=0` / `unreachable=0`**・リモート **`exit` `0`**・`--follow` **約 741s**）。**新規マイグレーションなし**。
- **本番デプロイ（2026-05-09・`C`/`X` 一覧再表示 + Web 既定 `all`・Pi5→Pi4×4）**: ブランチ **`fix/kiosk-leaderboard-completed-visibility`**・代表コミット **`ae6034c8`**（**`main` マージ後は `origin/main` HEAD**）。**API**: 一覧可視 **`S`/`R`/`C`/`X`**。**Web**: [`ProductionScheduleLeaderOrderBoardPage.tsx`](../../apps/web/src/pages/kiosk/ProductionScheduleLeaderOrderBoardPage.tsx) **`completionFilter` 初期 `all`**。**対象**: **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`**（**`--limit` 1 台ずつ**・**Pi3 除外**）。**Detach Run ID**: **`20260509-093716-30174`** / **`20260509-094901-17785`** / **`20260509-095434-23706`** / **`20260509-095842-2865`** / **`20260509-100237-8760`**（いずれも **`failed=0` / `unreachable=0`**・リモート **`exit` `0`**）。**実機**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（本記録 **約 67s**）。**正本**: [deployment.md §2026-05-09](../guides/deployment.md#kiosk-leaderboard-fkojunst-cx-visible-2026-05-09)。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（2026-05-05 記録 **約 82s**）/ 同日 **正本統一後**の再検証 **約 188s**（Tailscale）。
- **知見（運用・2026-05-08）**: **外部完了のメール由来は `status` のみ**。**CSV からキーが無くなった**だけでは完了にならない（**旧仕様の dedupe キー消失**は撤去）。**`O`/`P`** は **一覧に出ないが未完了のまま**（製番 **total** に含まれる）。
- **トラブルシュート**: **外部完了が期待とズレる** → **`fkmail.statusCode`**（**`C`/`X` だけがメール由来完了**）・**生産日程CSV消失**条件（**メール完了以外 × `occurredAt` ±3ヶ月母集団**・現 winner との差分）を確認。**Status CSV が空**（dedupe 後キー **0 件**）なら同期スキップ。**マイグレ未適用**は Pi5 **`deploy-status`** / Ansible **`Run prisma migrate deploy`** ログで確認する。**順位で `C`/`X` が見えるがグレーアウトしない** → API の **`progress`**（**`完了`** 字句）と Web の [`normalizeLeaderBoardRow`](../../apps/web/src/features/kiosk/leaderOrderBoard/normalizeLeaderBoardRow.ts) を確認し、Pi5 **`api` / Pi4 `web` の ref** が [deployment.md §2026-05-09](../guides/deployment.md#kiosk-leaderboard-fkojunst-cx-visible-2026-05-09) 以降か検証。

#### 2026-05-09 調査補遺: なぜ `C` が `fkmail` にほぼ載らないのか（キー空間不一致） {#fkojunst-status-c-key-domain-mismatch-2026-05-09}

- **現象**: `FKOJUNST_Status` ソースには `C` が大量にある一方、`fkmail` には `C` がほぼ現れない。
- **誤解しやすい点**: これは「同期ロジックが `C` だけ落としている」ことを直ちに意味しない。
- **調査結論**: 厳密 3 キー（`ProductNo + 資源CD + FKOJUN`）で本体 winner と突合すると、`C` 行は **未マッチが支配的**。`FKOJUN`（例: `801` 偏重）と `FKOTEICD` の分布が本体キー集合と交わらない。
- **運用含意**: 本体に対応行が無い `C` は、現行仕様では **反映しないのが正**（誤完了防止）。
- **意思決定**: 反映方針は [ADR-20260509](../decisions/ADR-20260509-fkojunst-status-completion-matching-policy.md) を正本とする。  
  （trim+upper、両取込で再計算、`FUPDTEDT` 最新優先、未マッチ `C` は無視）
- **詳細調査ログ**: [KB-373](./KB-373-fkojunst-status-c-key-domain-mismatch.md)

### PowerAutomate 由来の日時字句互換（ISO8601 等・2026-05-01） {#powerautomate-csv-datetime-compat-2026-05-01}

- **Context**: PowerAutomate 変更により **`FUPDTEDT`** が **`YYYY-MM-DDTHH:mm:ss[.SSS]Z`** で届くケースが増えた。旧実装は **`MM/DD/YYYY HH:mm:ss`** のみ受理のため **パース不能**→**epoch 代替**になり、**同一キーで「最新」を決める `FUPDTEDT` 最大**の選定が崩れ、一覧の **`fkmail` 紐付き・工順ST表示**に間接的に影響し得た（可視ポリシー自体は不変）。
- **仕様（共通パーサ）**: [`csv-dashboard-datetime-parse.ts`](../../apps/api/src/services/csv-dashboard/csv-dashboard-datetime-parse.ts) の **`parseFkojunstStatusMailFupdteDt`** が **従来形式＋上記 ISO8601（`Z` 終端・時刻必須）**を受理。**日付のみ**（`YYYY-MM-DD`）は **拒否**（誤って UTC 深夜 を最新扱いにしない）。
- **一般 CsvDashboard**: `CsvDashboardIngestor` の **`occurredAt`** は **`parseCsvDashboardDateColumnToUtc`**（**`YYYY/M/D H:M`（JST→UTC）**＋**同上 ISO8601**）。失敗時は **現在時刻**フォールバックし **`[CsvDashboardIngestor]`** へ **`dashboardId` / `dateColumnName`** 付き **warn**（例: 計測機器貸出ダッシュボード）。
- **Fix の正本**: [`fkojunst-status-mail-sync.pipeline.ts`](../../apps/api/src/services/production-schedule/fkojunst-status-mail-sync.pipeline.ts)·[`csv-dashboard-ingestor.ts`](../../apps/api/src/services/csv-dashboard/csv-dashboard-ingestor.ts)·テスト上記ファイル。
- **本番反映（2026-05-01）**: [deployment.md](../guides/deployment.md) 補足（PowerAutomate 日時互換）。**`raspberrypi5` のみ**。**Detach Run ID**（`ansible-update-`）: **`20260501-141453-4379`**（**`failed=0` / `unreachable=0`**・**`ok=130` `changed=4`**）。**実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **26s**）。
- **トラブルシュート**: 表示行がおかしいときは **まず** [§FKOJUNST_Status（2026-04-28）](#fkojunst_status-mail-from-gmail-csv-2026-04-28) の **キー・`S`/`R`/`C`/`X` 可視**を確認。パース周りは **API ログの warn** と **CSV 字句**を突き合わせる。**Pi4/Pi3**: **個別デプロイ不要**（API のみ）。

### `ProductionSchedule_Mishima_Grinding` CSV に実日付が無いこと（仕様・2026-05-01） {#mishima-grinding-csv-no-date-2026-05-01}

- **Context**: キオスク生産日程の本体 CSV の一つとして **`ProductionSchedule_Mishima_Grinding`**（固定 `CsvDashboard` ID **`3f2f6b0e-6a1e-4c0b-9d0b-1a4f3f0d2a01`**・seed 参照）がある。設定上の **`dateColumnName`** は **`registeredAt`**（列定義に **`registeredAt` / `updatedAt`** もある）だが、**上流 PowerAutomate が出す CSV には日時が載らない**（該当ヘッダが無い、または **全行空**）。**日時字句の PowerAutomate 変更**（上記 §）とは別件で、**欠損ではなく源流仕様**として扱う。
- **挙動（本システム）**: `CsvDashboardIngestor` は **`dateColumnName`** のセルをパースし **`occurredAt`** に使う。**空・受理不能**のときは **取込実行時刻**へフォールバックし **[CsvDashboardIngestor] warn**（`dashboardId` / `dateColumnName` 付き）になり得る。**削除ルール**の基準日は `max(rowData.updatedAt, occurredAt)` のため、`updatedAt` も空なら **`occurredAt`（≒取込時刻）**が効く。
- **調査（2026-05-01・手動取込）**: 本番 Pi5 で **手動 Gmail 取込 run** の一例 **`a1f180aa-9aba-4e3a-87c4-92ea0a83d26a`** について、保存 CSV と DB を確認。**BOM 付き**ヘッダ **`ProductNo` 始まり**・必須キー相当（**`ProductNo`・`FSEIBAN`・`FHINCD`・`FSIGENCD`・`FKOJUN`**）に欠損なし・**`FSIGENSHOYORYO`** は数値。**`registeredAt` / `updatedAt` は CSV 上すべて空**（源流に日付列が無いことと整合）。
- **トラブルシュート**: **「日付がパースできない」warn** が三島研削で出るのは **CSV に値が無い**場合の **想定内**。原因切り分けするなら **他ダッシュボード**と混同していないか（`dashboardId`）・**上流で列追加できるか**（運用）を確認。**表示欠落**や **キオスクの FKOJUNST 問題**は [§FKOJUNST_Status](#fkojunst_status-mail-from-gmail-csv-2026-04-28)・**FHINCD プレフィックス**ではなく **ステータス可視ポリシー**などを優先して見る。**正本（CSV ダッシュボード全般）**: [csv-import-export.md](../guides/csv-import-export.md)。

### 三島研削: 空に近い添付（BOM のみ）・`CSV_HEADER_MISMATCH`・NON_RETRIABLE 廃棄と同一バッチ成功（2026-05-06） {#mishima-grinding-empty-csv-bom-nonretriable-2026-05-06}

- **Context**: PowerAutomate から届く **`生産日程_三島_研削工程`** メールで、添付が **UTF-8 BOM のみ（数バイト）**に近いサイズになることがある（Gmail API の part `size` が **3** 程度・正常時は **約 1.4MB** 級）。**誤った MIME part 選択ではなく**、**送信側の空に近いファイル**が主因となる観測が取れる。
- **挙動（本システム）**: 最小コンテンツでは **必須列が解決できず** **`CSV_HEADER_MISMATCH`**（`ApiError`）→ エラー分類 **`NON_RETRIABLE`**。ポリシーどおり **Gmail 側でゴミ箱へ移動**し、**再試行の対象にしない**。
- **Fix（2026-05-06）**: `CsvDashboardImportService.ingestTargets` で **NON_RETRIABLE を廃棄（`trashMessage`）できたメッセージ**は、ループ終了時の **`failedMessageIdSuffixes` 集計から除外**する。これにより **同一ダッシュボード・同一バッチ内に正常なメールが続く場合**、全体が **最後の `lastError` で例外終了しない**。**実装**: [`csv-dashboard-import.service.ts`](../../apps/api/src/services/csv-dashboard/csv-dashboard-import.service.ts)。**単体**: [`csv-dashboard-import.service.ingest-behavior.test.ts`](../../apps/api/src/services/csv-dashboard/__tests__/csv-dashboard-import.service.ingest-behavior.test.ts)。
- **PR / マージ（済）**: [PR #259](https://github.com/denkoushi/RaspberryPiSystem_002/pull/259)（**`main` squash**・**`e47ad84c`**）。**本番反映**: **Pi5 API のみ** [deployment.md](../guides/deployment.md) 標準（`./scripts/update-all-clients.sh main … --limit raspberrypi5`・**デプロイ実績は別記**）。
- **トラブルシュート**: **「添付はあるのに取れない」**→ 管理実行の **`debug`**（`downloadedMessageIdSuffixes` / `disposedMessageIdSuffixes` 等）と **保存された raw CSV サイズ**を確認。**開発用 localhost への計測 POST** は **本番に含めない**（調査後はコードから除去する）。

## FKOBAINO purchase order lookup from Gmail CSV (2026-04-20) {#fkobaino-purchase-order-lookup-from-gmail-csv-2026-04-20}

- **Context**: Gmail 件名 **`FKOBAINO`** の CSV（注文番号・購買品名など）を **生産日程本体とは分離**して保持し、現品票の一次元バーコード（**10 桁 `FKOBAINO`**）から **製番・購買品名・既存マスタ品名（正規化 `FHINCD`）・機種名** をキオスクに表示する。
- **Fix（境界分離）**:
  - 専用 `CsvDashboard`（固定 ID **`c3d4e5f6-a7b8-49c0-d1e2-f3a4b5c6d7e8`**・seed 名 `PurchaseOrder_FKOBAINO`）・`ingestMode: DEDUP`。
  - 保持テーブル **`PurchaseOrderLookupRow`**（**2026-04-21 以降**: `sourceCsvDashboardId` + `purchaseOrderNo` + `seiban` + **`purchasePartCodeMatchKey`**（括弧除去 + 末尾の **数値のみ**`-NNN` 枝番除去）の複合一意で **upsert** し、Gmail 取り込みで **履歴を上書き全消ししない**。列 **`purchasePartCodeNormalized`** は括弧除去のみ（表示・互換）。マイグレ適用前に同一キー重複があれば **最新 `updatedAt`（同順位なら `id`）を残して削除**。購買 CSV の `FHINCD` は **`purchasePartCodeRaw` を保持**。既存生産日程 winner 行の **`FHINMEI`** と突合（**照合キー優先**、未取得時は **括弧除去のみ**のフォールバック）。機種名は既存 **`resolveSeibanMachineDisplayNamesBatched`**、未解決は **空文字**。
  - 照会時、生産日程 **`ProductionScheduleOrderSupplement.plannedStartDate`** を **`(FSEIBAN, 照合キーFHINCD)` 粒度で最古**（複数行ある場合の最小日付）として合成し、API 行 DTO に **`plannedStartDate`**（`YYYY-MM-DD` または `null`）を付与（**照合キー優先**、未取得時は **括弧除去のみ**のフォールバック）。Web は **`PurchaseOrderLookupResultList`** で **着手日**を **機種→製番→着手日→品名→品番→個数** の並びで表示。
  - API: **`GET /api/kiosk/purchase-order-lookup/:purchaseOrderNo`**（`purchaseOrderNo` は **10 桁数字**・`x-client-key`）。Web: **`/kiosk/purchase-order-lookup`**（バーコードスキャン・複数行は一覧）。
- **本番デプロイ（2026-04-22・購買照会バーコード読取安定化・Web のみ）**: ブランチ **`feat/purchase-order-scan-stability`**・代表 **`b2180b1e`**（`barcodeReadStability.ts`・`useBarcodeScanSession` / `BarcodeScanModal` の任意 **`stabilityConfig` / `readerOptions`**・購買照会のみ **`BARCODE_FORMAT_PRESET_PURCHASE_ORDER`** と **短時間の同一値2連続一致で確定**・`zxingVideoReader` の既定間隔は **呼び出し側未指定時は従来寄り**）。**対象**: **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`** を **`--limit` 1 台ずつ**（**Pi3 は対象外**）。`export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh feat/purchase-order-scan-stability infrastructure/ansible/inventory.yml --limit <host> --detach --follow`。**Detach Run ID**: `20260422-091400-26049` → `20260422-091829-21827` → `20260422-092256-32471` → `20260422-092617-8016` → `20260422-093223-17140`（各 **`failed=0` / `unreachable=0` / exit `0`**）。**実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **26s**）。**追加スモーク**: `GET https://100.106.158.2/kiosk/purchase-order-lookup` → **200**。**仕様**: 要領書など他画面のバーコード UI は **`stabilityConfig` 未指定で即確定**のまま。**知見**: 共有 `BarcodeScanModal` へ波及させず購買照会だけチューニングするため **オプション化**。**トラブルシュート**: **`update-all-clients.sh` の並列起動禁止**・プレフライト失敗後の **stale lock** は [deploy-status-recovery.md](../runbooks/deploy-status-recovery.md) §5.2。ラベルが **`BARCODE_FORMAT_PRESET_PURCHASE_ORDER` 外**なら `formatPresets.ts` の配列へ追加。
- **実機（Android Chrome・2026-04-24 追記）**: `feat/kiosk-barcode-reader-tuning`（`main`）反映後、**注番**（現品票一次元・**10 桁**）の **カメラ読取体感**が速くなったとの場内確認。Web は **`PurchaseOrderLookupPage`** で **`BARCODE_READER_OPTIONS_KIOSK_DEFAULT`（220/120ms）** を `BarcodeScanModal` に明示し、上記 **`PURCHASE_ORDER` プリセット**・**`stabilityConfig`（短時間2連続一致）**と併用。配膳の **製造order** 一次元も同リリースで体感改善の報告あり（[KB-339 V24](./KB-339-mobile-placement-barcode-survey.md#v24-barcode-reader-tuning-2026-04-23)）。照明・ピント・ラベル品質で変動。
- **本番デプロイ（2026-04-21・追記・FHINCD 照合キー v2・Pi5→Pi4×4）**: ブランチ **`fix/fhincd-normalization-v2`**・代表 **`65955268`**（Prisma `20260422120000_purchase_order_lookup_fhincd_match_key`・`purchase-fhincd-normalize.ts`・`purchase-fhincd-match-sql.ts`・照会の段階移行フォールバック）。**対象**: **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`** を **1 台ずつ**。**Pi3**: 対象外（本変更は Pi5 API + Pi4 キオスク Web）。[deployment.md](../guides/deployment.md) 標準・`export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh fix/fhincd-normalization-v2 infrastructure/ansible/inventory.yml --limit <host> --detach --follow`。**Detach Run ID**（ログ接頭辞 `ansible-update-`）: `20260421-211718-16570` → `20260421-213337-30126` → `20260421-213832-8006` → `20260421-214223-235` → `20260421-214721-3204`（各 **`failed=0` / `unreachable=0` / exit `0`**）。**実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **53s**）。**トラブルシュート**: **同一 Pi5 へ `update-all-clients.sh` を並列起動しない**（ローカル／リモートロック・exit 3）。
- **本番デプロイ（2026-04-21・蓄積 upsert・着手日・`Dockerfile.web` Caddy 依存 pin）**:
  - **ブランチ/対象**: **`feat/purchase-order-lookup-history-start-date`**・代表 **`92fd37e4`**。**`raspberrypi5` のみ**（Pi4/Pi3 未反映）。
  - **手順/実績**: [deployment.md](../guides/deployment.md) 標準・`export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh feat/purchase-order-lookup-history-start-date infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`。**Detach Run ID**: **`20260421-192642-23281`**（**`failed=0` / `unreachable=0` / exit `0`**）。
  - **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **94s**）。
  - **CI/Trivy**: `security-docker` の **`trivy image web`** 通過のため Caddy 同梱 `go.mod` で **`pgx` / `puddle` / `smallstep/certificates` / OTel SDK** 等を `replace` ピン（詳細 [KB-307](./ci-cd.md#kb-307-trivy-image-web-が-usrbincaddy-の-cve-を検出して-ci-が失敗する) 追記）。
  - **PR**: [#175](https://github.com/denkoushi/RaspberryPiSystem_002/pull/175)。
- **運用（Gmail スケジュール）**: `backup.json` / 管理 API 経由で **固定 ID** **`csv-import-purchase-order-fkobaino`**（`ImportScheduleAdminService` で **自動補完・削除不可**）を **`ensureFkobainoCsvImportSchedule`** が維持。件名 **`FKOBAINO`** は他用途と重複させない。
- **本番デプロイ（2026-04-20・追記・キオスク Web UX）**: ブランチ **`feat/kiosk-purchase-order-lookup-ux`**・代表コミット **`b0c2e68e`**（`PurchaseOrderLookupPage`・`usePurchaseOrderLookup`・進行中照会と短いスキャンで `loading` が残る不具合の修正・`buildPurchaseOrderRowLines`・Vitest・デザインプレビュー HTML）。**対象**: **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-kensaku-stonebase01`** を **`--limit` 1 台ずつ**・**`--detach --follow`**。**Detach Run ID**（ログ接頭辞 `ansible-update-`）: `20260420-185803-18736` → `20260420-191222-23450` → `20260420-191818-15715` → `20260420-193055-747`。**`raspi4-fjv60-80`**: プレフライト **SSH timeout**（**未デプロイ**）。**Pi3**: 対象外（`/kiosk` は Pi5 SPA + Pi4 キオスク）。**トラブルシュート**: `raspi4-fjv60-80` 失敗後に Pi5 に **stale lock**（`runPid: null`）が残り、続く **`raspi4-kensaku-stonebase01` でロック取得不能** → [deploy-status-recovery.md](../runbooks/deploy-status-recovery.md) §5.2。**実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 42 / WARN 1 / FAIL 0**。**追加スモーク**: `GET …/kiosk/purchase-order-lookup` → **200**。
- **本番デプロイ（2026-04-20・追記・モバイル注文入力スキャン専用化）**: ブランチ **`feat/scan-only-order-inputs-and-shelf-chip-mobile`**・代表 **`423e32bb`**。**Web**: **`/kiosk/purchase-order-lookup`** の注文番号は **`readOnly` + `inputMode="none"`**（**スキャンのみ**）・`usePurchaseOrderLookup` から手入力用 debounce / `onOrderNoChange` を除去。**配膳** `/kiosk/mobile-placement` メイン下半の **製造order** も同様（`onOrderBarcodeChange` 廃止）。**棚番チップ**: `mobilePlacementKioskTheme` で **`grid-cols-3 sm:grid-cols-4`** 等（詳細は [KB-339 §V23](../knowledge-base/KB-339-mobile-placement-barcode-survey.md#v23-scan-only-shelf-chip-2026-04-20)）。**対象**: **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-kensaku-stonebase01`** を **1 台ずつ**。**Detach Run ID**: `20260420-211100-899` → `20260420-211743-28526` → `20260420-212322-14477` → `20260420-213004-29970`。**`raspi4-fjv60-80`**: プレフライト **SSH timeout**（**未デプロイ**）。**Pi3**: 対象外。**トラブルシュート**: fjv60 失敗後 Pi5 ロックが **`runPid: null`** のまま残ると次ホストで **ロック取得不能**（本記録では runId **`20260420-212814-6231`**）→ [deploy-status-recovery.md](../runbooks/deploy-status-recovery.md) §5.2。**実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 42 / WARN 1 / FAIL 0**。**追加スモーク**: `GET …/kiosk/purchase-order-lookup`・`…/kiosk/mobile-placement` → **各 200**。
- **本番デプロイ（2026-04-20）**: [deployment.md](../guides/deployment.md) 標準。`feat/fkobaino-purchase-order-lookup` を **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-kensaku-stonebase01`** を **1 台ずつ**・**`--detach --follow`**。**Detach Run ID**（ログ接頭辞 `ansible-update-`）: `20260420-153825-14948` → `20260420-154924-28306` → `20260420-155406-1101` → `20260420-155936-12366`（各 **`failed=0` / `unreachable=0`**）。**`raspi4-fjv60-80`**: プレフライトで **Pi5 から `100.100.229.95:22` SSH timeout** のため **未デプロイ**（到達復旧後に **`--limit raspi4-fjv60-80` 単体**を推奨）。**Pi3**: 対象外。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 42 / WARN 1 / FAIL 0**（**WARN**: `raspi4-fjv60-80` の Pi5 経由 SSH・既存ベースラインと同型）。
- **トラブルシュート**: プレフライト失敗で Pi5 に **stale lock** が残る場合は [deploy-status-recovery.md](../runbooks/deploy-status-recovery.md) §5.2。マイグレーション適用後は Pi5 で **`pnpm prisma migrate status`**（[deployment.md のデプロイ後チェックリスト](../guides/deployment.md#デプロイ後チェックリスト)）を確認。
- **取込堅牢化（2026-04-20・追記）**:
  - **固定 `CsvDashboard` の欠落**: 取込ループ開始時に **`ensureProductionScheduleFkobainoDashboard`** で **DB に upsert**（seed 名 `PurchaseOrder_FKOBAINO` と整合）。ダッシュボード行が無いと件名パターンが解決されず **スキップ**され続ける。
  - **手動 Gmail 実行と履歴**: **`CsvImportScheduler`** は **手動**かつ **Gmail + `csvDashboards` ターゲット**のとき、サマリの **`csvDashboards` が空オブジェクト**なら **`No matching Gmail message found for CSV dashboard import`** で **失敗**とする（未読ゼロ・対象メール無しで **COMPLETED + 空サマリ**と誤記録されないようにする）。
  - **部分失敗の表示**: 管理コンソールの手動実行後、**一部メッセージで取込／Gmail 後処理に失敗**した場合は、応答サマリの **`debug.failedMessageIdSuffixes`** と **`debug.postProcessErrorByMessageIdSuffix`** を参照（一次エラー文言の表示に利用可能）。
  - **開発用計測の除去**: 調査用の **localhost ingest / `debug-sink`** は **本番に不要**のため削除済み（`DEBUG_SINK_ENABLED` による外部シンクも廃止）。

## 表示用納期 effectiveDueDate・計画列 UI（2026-04-01）

- **Context**: 部品納期個数 CSV の **`plannedEndDate`** を、行の **`dueDate`（手動・writeback 含む）が無いときの表示用納期**として扱いたい。一覧・納期詳細で意味を混在させず、API で「実効日付」とソースを明示したい。
- **Spec（API）**:
  - `GET /api/kiosk/production-schedule/due-management/seiban/:fseiban` の応答に **`effectiveDueDate`**（UTC 日付文字列・手動優先、無ければ補助の `plannedEndDate`）、**`effectiveDueDateSource`**（`manual` | `csv` | `null`）を付与。
  - 部品行は `ProductionScheduleOrderSupplement` を **FKOJUN + FSIGENCD + ProductNo** で集約し、詳細パネルへ反映（既存 `plannedQuantity` / `plannedStartDate` / `plannedEndDate` と整合）。
- **Spec（Web）**:
  - 生産スケジュール／手動順番: **指示数**・**着手日**列を表示。表示用納期は **`dueDate ?? plannedEndDate`**。**手動 `dueDate` のときのみ**納期セルを強調。
  - 手動順番モードのソート: **資源順番（`processingOrder`）→ 表示用納期**の二段。
- **ブランチ**: `feat/kiosk-planned-fields-due-fallback-ui`（コミット例: `875fe284`）。
- **本番デプロイ**: [deployment.md](../guides/deployment.md) の `update-all-clients.sh` のみ。**対象 5 台**（`raspberrypi5` → Pi4×4）を **`--limit` 1 台ずつ**・**`--detach --follow`**（**Pi3 対象外**）。Mac からは `RASPI_SERVER_HOST=denkon5sd02@100.106.158.2` 前提。同一 Pi5 へスクリプトを並列起動しない。
  - **Detach Run ID（実績・2026-04-01）**: `20260401-201019-17368`（Pi5）/ `20260401-201641-20955`（`raspberrypi4`）/ `20260401-202120-2571`（`raspi4-robodrill01`）/ `20260401-202509-5371`（`raspi4-fjv60-80`）/ `20260401-202901-20217`（`raspi4-kensaku-stonebase01`）。いずれも `PLAY RECAP` **`failed=0`**。
- **実機検証**:
  - `./scripts/deploy/verify-phase12-real.sh` → **PASS 40 / WARN 0 / FAIL 0**（2026-04-01・Tailscale。既存の `plannedQuantity` 検査を含む）。
  - **追加スモーク**: `GET .../due-management/triage` で得た `fseiban`（例: `BA1S3318`）に対し `GET .../due-management/seiban/<fseiban>`（`x-client-key` 必須）で **`effectiveDueDate`** と **`effectiveDueDateSource`** が JSON に含まれることを確認済。
- **Troubleshooting（ローカル統合テスト）**:
  - Vitest が **`localhost:5432` 接続不可**のときは Postgres 未起動。**`docker-compose.server.yml` + `docker-compose.mac-local.override.yml`** で DB を `5432:5432` 公開してから `pnpm --filter @raspi-system/api exec prisma migrate deploy` を実行し、続けて対象 integration を実行。
  - **マイグレ未適用**（`P2021` 等）時は上記 `migrate deploy` が必要。
- **CI**: `feat/kiosk-planned-fields-due-fallback-ui` push 後の GitHub Actions **CI** は **success**（Run 例: `23845117543`）。

## 生産順序モード拡張（手動順番/自動順番 + targetLocation、2026-03-19）

- **Context**:
  - 全体ランキング精度が改善途上のため、現場ではオペレーターの手動順番を並行運用する必要がある。
  - 現場リーダーが自席から代理設定できるよう、`targetLocation` を指定した更新基盤が必要になった。
- **Fix**:
  - 生産スケジュール画面に `自動順番 / 手動順番` を追加し、既定を `手動順番` に設定。
  - 手動順番は「単一資源CD表示時のみ」有効化し、それ以外は `資源順番` ドロップダウンをグレーアウト。
  - 手動順番の並びは `processingOrder` 昇順（未設定は末尾）へ分離し、`auto` は既存 `globalRank` 表示ロジックを維持。
  - `PUT /api/kiosk/production-schedule/:rowId/order` に `targetLocation`（任意）を追加。
    - 未指定: 従来どおり actor location を更新。
    - 指定時: 代理更新可否を境界でガードし、不正な他拠点更新は `403 TARGET_LOCATION_FORBIDDEN`。
  - 監査用に order 更新ログへ `actorLocation/targetLocation/actorClientKey/resourceCd/orderNumber` を記録。
  - 学習イベントに `manual_order_update` を追加し、`actorLocation/targetLocation/resourceCd/reorderDelta` を記録。
  - 納期管理画面に `手動順番 全体像` パネルを追加し、工程別設定件数・自動順位との乖離・最終更新時刻/更新者を可視化。
- **Verification**:
  - `pnpm --filter @raspi-system/web test -- src/features/kiosk/productionSchedule/displayRank.test.ts src/features/kiosk/productionSchedule/displayRowDerivation.machinePart.test.ts src/features/kiosk/productionSchedule/displayRowDerivation.sortMode.test.ts` 成功（9 tests）。
  - `pnpm --filter @raspi-system/web exec tsc --noEmit` 成功。
  - API側 `tsc --noEmit` は既存の `rootDir/include` 設定起因で失敗（今回差分起因ではないため既知）。
  - **デプロイ・実機検証（2026-03-19）**: ブランチ `feat/production-schedule-target-location-ordering`、Pi5 → raspberrypi4 → raspi4-robodrill01 の順に1台ずつ実行。Phase12 26項目PASS（manual-order-overview API チェック追加）、実機OK。
  - **CI修正**: `ProductionScheduleGlobalRank` の正しいカラムは `priorityOrder`（`rankOrder` は存在しない）。`due-management-manual-order-overview.service.ts` で誤参照していたため修正。
- **Prevention**:
  - `targetLocation` の変換・検証は route 境界に閉じ込め、service 契約は `locationKey` を維持。
  - 手動順番の有効条件を UI とソート戦略の両方で一致させ、単一資源CD条件の逸脱を防止。
  - 代理更新や学習イベント追加時も既存API互換（未指定時の挙動）を壊さない。

### Device-scope v2: manual order, Mac proxy, Pi4 scope, UI hints (2026-03-20)

- **Spec / progress**: `ProductionScheduleOrderAssignment.siteKey` と端末キー `deviceScopeKey`（`ClientDevice.location`）で手動順番を保存。工場俯瞰 API は `siteKey` 必須・`devices[]` 返却（`KIOSK_MANUAL_ORDER_DEVICE_SCOPE_V2_ENABLED`）。ADR: [ADR-20260319-manual-order-device-scope-v2](../decisions/ADR-20260319-manual-order-device-scope-v2.md)。
- **Leader ops（代理更新）**: API 上、**`ClientDevice.location === 'Mac'`** の端末だけが他端末向けに `targetDeviceScopeKey` を付与可能。**Apple 開発用 Mac 専用ではない**。現場リーダー用デスク PC を **`location=Mac` として登録し、専用 `clientKey` でキオスクを開く**運用とする。
- **Pi4 kiosk alone**: **その端末自身**の手動順番のみ変更可。他 Pi4 の代理は不可（`targetDeviceScopeKey` / `targetLocation` は 400）。
- **UI**: 文言「今日判断系」は無い。**当日計画への反映**内の **「今日対象候補（トリアージ属性）」** が相当。サマリは **製番登録・納期前提**内の対象候補/危険/注意/余裕。**手動順番 全体像**で v2 時に変わるのは主に**左レール内のシアン枠**（工場→端末の2段・端末切替で枠内の資源CD別集計が変わる）。
- **Deploy / verify（実績）**: `feat/device-scope-manual-order` を Pi5 → `raspberrypi4` → `raspi4-robodrill01` の順に `--limit` でデプロイ（Pi3 除外）。`./scripts/deploy/verify-phase12-real.sh` は v2 有効時 `global-rank` の `actorLocation` から `siteKey` を導出し `manual-order-overview?siteKey=...` を検証するよう更新済み。
- **Troubleshooting**:
  - Phase12 が `manual-order-overview` で失敗: v2 有効時は **無印 overview は 400**（`siteKey` 必須）。スクリプトが最新か、`siteKey` 付きで叩けているか確認。
  - ローカル API テストが大量失敗: **Postgres 未起動**のことが多い。Docker で DB 起動後 `prisma migrate deploy` を実施。
  - Web lint（import 順）: `pnpm exec eslint --fix` で自動修正可。

<a id="manual-order-pi4-target-device-scope-key-web-fix-2026-03-23"></a>

### 手動順番 Pi4 下ペイン「取得に失敗」— `targetDeviceScopeKey` の Web 付与誤り（2026-03-23）

- **Context**:
  - 手動順番専用ページで上ペインの「編集」を押すと、下ペインの `GET /api/kiosk/production-schedule`（および `order-usage`）にクエリ `targetDeviceScopeKey` が付与されていた。
  - device-scope v2 では **キオスク（Pi4 等）は `targetDeviceScopeKey` を送ってはならない**（`resolveProductionScheduleAssignmentLocationKey` が `TARGET_DEVICE_SCOPE_KEY_FORBIDDEN` で 400）。**Mac 相当（`ClientDevice.location === 'Mac'`）の端末のみ**代理指定可。
  - 通常の生産スケジュール画面（`ProductionSchedulePage`）は `isMacEnvironment(userAgent)` で **Mac のときだけ** `targetDeviceScopeKey` を付けていたが、`ProductionScheduleManualOrderPage` は **常に付与**しており、Mac ブラウザでは問題が表面化しにくく、**Pi4 キオスク（Linux arm User-Agent）では必ず 400** となり「取得に失敗しました」と表示された。
- **Fix（Web）**:
  - [`ProductionScheduleManualOrderPage.tsx`](../../apps/web/src/pages/kiosk/ProductionScheduleManualOrderPage.tsx) で `isMacEnvironment` と `VITE_KIOSK_MANUAL_ORDER_DEVICE_SCOPE_V2_ENABLED` から `macManualOrderV2` を導出し、**Mac かつ v2 のときだけ** `scheduleListParams` / `useProductionScheduleMutations` の `productionScheduleTargetDeviceScopeKey` / `useKioskProductionScheduleOrderUsage` の `targetDeviceScopeKey` を付与（`ProductionSchedulePage` と同型）。
  - API 変更なし。
- **Deploy / verify（実績）**:
  - ブランチ **`fix/phase12-verify-ping-retry`** に手動順番修正を含め、`infrastructure/ansible/inventory.yml` で **Pi5 → `raspberrypi4` → `raspi4-robodrill01` のみ**（Pi3 除外）、`--limit` 1 台ずつ、`--detach --follow`（`RASPI_SERVER_HOST` 必須）。
  - **Run ID 例**: `20260323-083523-8980`（Pi5）/ `20260323-084021-9264`（raspberrypi4）/ `20260323-084439-11342`（raspi4-robodrill01）。
  - **実機検証**: `./scripts/deploy/verify-phase12-real.sh` **PASS 28 / WARN 0 / FAIL 0**（2026-03-23）。
- **Troubleshooting**:
  - 下ペインが「取得に失敗」で、API が **400** + `errorCode: TARGET_DEVICE_SCOPE_KEY_FORBIDDEN**: キオスクから `targetDeviceScopeKey` が送られていないか、Web ビルドが古い可能性。Pi5 の `web` イメージ／キャッシュとキオスクのハードリロードを確認。
  - **Pi4 で他端末カードを選んだときのデータ**: キオスクは API 上 **自端末の assignment スコープ**のみ。上ペインで別端末を選んでも、クエリから `targetDeviceScopeKey` を外すと一覧は **actor（当該 Pi4）**基準で解決される（他端末の割当を Pi4 から代理閲覧する要件は別途 API ポリシー検討が必要）。

<a id="manual-order-sitekey-canonical-sync-2026-03-23"></a>

### 手動順番・全体ランキングの工場共有同期（`siteKey` 正本、2026-03-23）

- **Context**:
  - 手動順番は `deviceScopeKey` 保存、全体ランキング（globalShared）は `shared-global-rank` 保存で運用されており、同一工場内でも端末ごとに表示差分が発生した。
  - 要件は「資源CDごとの手動順番」と「全体ランキング（行単位表示含む）」の両方を工場単位で同期すること。
- **Fix（API/保存契約）**:
  - 手動順番:
    - `resolveProductionScheduleAssignmentLocationKey` は v2 有効時に **`siteKey` を返す**よう変更（Mac は `targetDeviceScopeKey` を検証した上でその工場へ、キオスクは自工場へ）。
    - `PUT /kiosk/production-schedule/:rowId/order` と `PUT /kiosk/production-schedule/:rowId/complete` は工場キーで更新。
    - 読み取りは `location=siteKey` を優先しつつ `siteKey=siteKey` の legacy 行をフォールバック参照（`processingOrder`/`order-usage`/assigned-only 条件）。
  - 全体ランキング:
    - `globalShared` の保存先を `shared-global-rank` 固定から **`siteKey` 保存**へ変更。
    - 参照時は `siteKey` を優先し、空の場合のみ `shared-global-rank` をフォールバック参照（互換）。
    - 生産スケジュール一覧の `globalRank` 参照優先順も `siteKey -> shared-global-rank -> locationKey` へ更新。
  - overview:
    - `manual-order-overview` は `siteKey` 正本行を各端末割当（resource assignments）へ再配分して表示できるよう調整。
- **Deploy / verify（実績）**:
  - ブランチ **`feat/sitekey-shared-manual-rank-sync`**。
  - **デプロイ**（Pi3 除外、1台ずつ）: `20260323-100741-24963`（Pi5）/ `20260323-101322-22407`（raspberrypi4）/ `20260323-101738-18203`（raspi4-robodrill01）。
  - **自動実機検証**: `./scripts/deploy/verify-phase12-real.sh` **PASS 28 / WARN 0 / FAIL 0**。
  - **同期実測（API）**:
    - `client-key-raspberrypi4-kiosk1` で手動順番を更新 -> `client-key-raspi4-robodrill01-kiosk1` で同一 row の `processingOrder` 反映を確認。
    - `global-rank`（`targetLocation=第2工場&rankingScope=globalShared`）を片側更新 -> 他端末で同順序反映を確認。
- **Troubleshooting**:
  - `global-rank` 手動保存の `reasonCode` は enum 制約があるため、任意文字列を送ると 400 になる。検証時は `reasonCode` 省略または許可コードを使う。
  - ローカル統合テストで `kiosk-production-schedule.integration.test.ts` が全落ちする場合、`localhost:5432` の Postgres 未起動が典型（`pnpm test:api` の起動スクリプト利用）。
  - **上ペインカードが「未設定」のまま増えない（2026-03-23 追記）**: `manual-order-resource-assignments` で資源割当済みでも、同端末に旧 `deviceScopeKey` 行（例: `resourceCd=500`）が残っていると `manual-order-overview` が端末sliceを優先し、`siteKey` 正本（例: `581`）を拾えず `rows: []` になることがある。対策として `manual-order-overview` の資源解決を **割当順 + siteKey 正本優先** に修正し、site に無い場合のみ端末sliceを補助参照する（旧データ削除は不要）。

<a id="manual-order-overview-assigned-resource-sitekey-priority-2026-03-23"></a>

### manual-order-overview 割当資源の siteKey 正本優先（旧 slice 行混在、2026-03-23）

- **Context**: 上記「工場共有同期」とは別コミットで、overview 集約のみを修正。端末に旧 `deviceScopeKey` 行が残ると derived が slice 優先となり、割当済み `siteKey` 正本が `mergeManualOrderOverviewResourcesWithAssignmentOrder` に渡らずカードが空に見える事象があった。
- **Fix（API）**: [`resolveManualOrderOverviewResourcesForAssignedDevice`](../../apps/api/src/services/production-schedule/due-management-manual-order-overview.service.ts) を追加し、割当スロットごとに **site 正本 → 無ければ端末 slice**。単体: [`merge-manual-order-resource-assignments.test.ts`](../../apps/api/src/services/production-schedule/__tests__/merge-manual-order-resource-assignments.test.ts)。
- **Deploy / verify（実績）**: ブランチ **`feat/sitekey-shared-manual-rank-sync`**（siteKey 同期デプロイに続く API 追従デプロイ）。Pi5 → raspberrypi4 → raspi4-robodrill01 のみ（Pi3 除外）、`--limit` 1 台ずつ、`RASPI_SERVER_HOST` + `--foreground`。**Ansible ログ timestamp**: `20260323-113105`（Pi5）/ `20260323-113715`（raspberrypi4）/ `20260323-114137`（raspi4-robodrill01）。**自動実機検証**: `./scripts/deploy/verify-phase12-real.sh` **PASS 28 / WARN 0 / FAIL 0**（2026-03-23、`manual-order-overview` v2・`siteKey` 導出含む）。
- **Troubleshooting**: 割当済みなのに上ペイン行が空に見えるときは `GET .../manual-order-overview?siteKey=<工場>` で当該端末の `resources[]` に正本 `resourceCd` と `rows[]` が載るか確認。旧 `location=...` 行が DB に残っていても本修正後は site 優先で表示される（データ削除不要）。

<a id="production-schedule-filter-dropdown-portal-2026-03-23"></a>

### 生産スケジュール 登録製番・資源CDドロップダウンを Portal 配置（overflow クリップ解消、2026-03-23）

- **Context**:
  - 折りたたみツールバー（[生産スケジュール本体 検索・資源フィルタ帯 ホバー展開](#production-schedule-main-toolbar-hover-2026-03-21)）内で、登録製番・資源CDのドロップダウンパネルが **親の `overflow` で切り取られる**ことがあった。
- **Fix（Web）**:
  - [`AnchoredDropdownPortal.tsx`](../../apps/web/src/components/kiosk/AnchoredDropdownPortal.tsx): `document.body` へ `createPortal` し、`fixed` + アンカー要素の `getBoundingClientRect()` で位置決め（右寄せは `translateX(-100%)`）。外側クリックはアンカーとパネルの両方を考慮。
  - [`ProductionScheduleSeibanFilterDropdown.tsx`](../../apps/web/src/components/kiosk/ProductionScheduleSeibanFilterDropdown.tsx) / [`ProductionScheduleResourceFilterDropdown.tsx`](../../apps/web/src/components/kiosk/ProductionScheduleResourceFilterDropdown.tsx) から利用。API 変更なし。
- **CI / 型**:
  - Docker ビルド（`pnpm run build`）で `RefObject<HTMLDivElement | null>` を `div` の `ref` に渡すと **TS2322**（`LegacyRef` 不一致）になる場合がある。props は `RefObject<HTMLElement>` / `RefObject<HTMLDivElement>`（`null` をジェネリクスに含めない）に揃える（`main`: `4b799762`）。
- **Deploy / verify（実績）**:
  - ブランチ **`main`**。対象は Pi5 → `raspberrypi4` → `raspi4-robodrill01` のみ（Pi3 除外）、[`deployment.md`](../guides/deployment.md) の **1台ずつ順番**（`--limit` 各ホスト、`--detach --follow`、`RASPI_SERVER_HOST` 必須）。
  - **Run ID**: `20260323-131306-17247`（Pi5）/ `20260323-132133-31976`（raspberrypi4）/ `20260323-132555-23983`（raspi4-robodrill01）。
  - **自動実機検証**: `./scripts/deploy/verify-phase12-real.sh` **PASS 28 / WARN 0 / FAIL 0**（2026-03-23）。
- **Troubleshooting**:
  - **CI の web ビルドのみ失敗**（`AnchoredDropdownPortal.tsx` TS2322）: 上記の `RefObject` 型定義を確認。ローカル `pnpm --filter @raspi-system/web build` で再現可能。
  - **見た目の確認**: Phase12 は API・サービス中心のため、ドロップダウンが画面端で切れないことは **実機/VNC** で `/kiosk/production-schedule` を開き、登録製番・資源CDのドロップダウンを展開して確認（自己署名で Mac 直ブラウザが失敗しうる件は [KB-306](./frontend.md#kb-306-キオスク進捗一覧-製番フィルタドロップダウン端末別保存) と同趣旨）。

<a id="manual-order-overview-card-two-line-header-2026-03-23"></a>

### 手動順番 上ペイン 端末カード2行ヘッダー・全体把握行のホバー格納（2026-03-23）

- **Context**:
  - 端末カード先頭を **1行**（ロケーション · 資源CD · 件数 · 操作）から **2行**にし、**資源名称**（`GET .../resources` の `resourceNameMap`）を2行目に載せたい。
  - 縦スペース確保のため、**カード一覧（空メッセージ含む）にポインタがある間**は [`ManualOrderPaneHeader`](../../apps/web/src/components/kiosk/manualOrder/ManualOrderPaneHeader.tsx)（手動順番見出し・工場選択｜全体把握｜N端末）を畳む。
- **Fix（Web・関心事分離）**:
  - **純関数**: [`manualOrderOverviewCardPresentation.ts`](../../apps/web/src/features/kiosk/manualOrder/manualOrderOverviewCardPresentation.ts)（`joinManualOrderResourceDisplayNames`・Vitest）。
  - **カード**: [`ManualOrderDeviceCardHeaderRow`](../../apps/web/src/components/kiosk/manualOrder/ManualOrderDeviceCardHeaderRow.tsx) — 1行目＝ロケーション＋編集・資源・編集中、2行目＝名称·資源CD·件数（名称はマスタ無しなら省略して CD·件数のみ）。
  - **上ペイン**: [`useToolbarCollapseWhileContentHovered`](../../apps/web/src/hooks/useToolbarCollapseWhileContentHovered.ts) — 下ペインの [`useTimedHoverReveal`](../../apps/web/src/hooks/useTimedHoverReveal.ts)（ホバーで**開く**）とは逆方向のため **別フック**。
  - **API/データ契約**: 変更なし（名称は既存 `resourceNameMap` をページから `resolveResourceDisplayName` 注入）。
- **Deploy / verify（実績）**:
  - ブランチ **`feat/kiosk-manual-order-card-two-line-header-hover-toolbar`**。Pi5 → `raspberrypi4` → `raspi4-robodrill01` のみ（Pi3 除外）、[`deployment.md`](../guides/deployment.md) の **1台ずつ**（`--limit` 各ホスト、`--detach --follow`、`RASPI_SERVER_HOST` 必須）。
  - **Detach Run ID**: `20260323-143949-27009`（Pi5）/ `20260323-144352-15929`（raspberrypi4）/ `20260323-144807-4866`（raspi4-robodrill01）。
  - **コミット（機能）**: `90520568`。
  - **自動実機検証**: `./scripts/deploy/verify-phase12-real.sh` **PASS 28 / WARN 0 / FAIL 0**（2026-03-23）。
- **Troubleshooting**:
  - **工場セレクトに触りたいのにヘッダが畳まれたまま**: カードグリッドからポインタを外す（約 280ms 後にヘッダ再表示）。タッチのみ運用ではホバー格納の恩恵は限定的。
  - **名称が出ない**: `resourceNameMap[cd]` が空のときは仕様どおり2行目は **資源CD·件数**のみ。

<a id="manual-order-overview-fkojun-display-only-2026-03-23"></a>

### 手動順番 上ペイン 工順(FKOJUN)のみ表示（processingType 混在解消、2026-03-23）

- **Context**:
  - 手動順番上ペインカードの行表示で「工順」が `processingType` と `FKOJUN` を混在させていた。実データで `processingType='塗装'` が1件だけ残っていた場合、上ペインでは「塗装」、下ペインでは `FKOJUN`（例: 200）と不整合になる事象があった。
  - 仕様として**上ペインは工順（FKOJUN）のみ**を表示し、下ペインと一貫させたい。
- **Fix（API・Web・関心事分離）**:
  - **API**: [`due-management-manual-order-overview.service.ts`](../../apps/api/src/services/production-schedule/due-management-manual-order-overview.service.ts) に `resolveProcessOrderLabel` を追加し、**FKOJUN のみ**を使用。`ManualOrderOverviewRow` に `processOrderLabel` を追加、`processLabel` は後方互換で維持。
  - **Web**: [`ManualOrderRowFields`](../../apps/web/src/features/kiosk/manualOrder/manualOrderRowPresentation.ts) / [`ManualOrderDeviceCard`](../../apps/web/src/components/kiosk/manualOrder/ManualOrderDeviceCard.tsx) を `processOrderLabel` ベースに変更。
  - **単体**: `merge-manual-order-resource-assignments.test.ts`、`manualOrderRowPresentation.test.ts`。
- **Deploy / verify（実績）**:
  - ブランチ **`feat/manual-order-overview-fkojun-display-only`**（**[PR #33](https://github.com/denkoushi/RaspberryPiSystem_002/pull/33)** で `main` へマージ。同一ブランチに [進捗一覧 納期列コンパクト](#progress-overview-due-column-compact-2026-03-23) の Web 変更も含む）。
  - Pi5 → raspberrypi4 → raspi4-robodrill01 のみ（Pi3 除外）、`--limit` 1台ずつ、`RASPI_SERVER_HOST` + **`--detach --follow`**（または `--foreground`）。
  - **Detach Run ID（Web 納期コンパクト含むデプロイ実績）**: `20260323-161714-15600`（Pi5）/ `20260323-162116-16052`（raspberrypi4）/ `20260323-162542-3008`（raspi4-robodrill01）。
  - **自動実機検証**: `./scripts/deploy/verify-phase12-real.sh` **PASS 28 / WARN 0 / FAIL 0**（2026-03-23）。
- **Troubleshooting**:
  - 上ペインと下ペインで「工順」表示が一致しない場合: API の `processOrderLabel`（FKOJUN）と `processLabel`（旧: processingType 優先）の使い分けを確認。本修正後は上ペインは **`processOrderLabel`** のみ使用。
  - 旧 `processLabel` は後方互換のため API には残るが、キオスク上ペインでは参照しない。

<a id="progress-overview-due-column-compact-2026-03-23"></a>

### 進捗一覧 納期列コンパクト表示（MM/DD_曜・資源CDチップ余白詰め、2026-03-23）

- **Context**:
  - 進捗一覧カード内テーブルで、品名・納期・資源CDチップの横並びにおいて、納期列の固定幅（`84px`）と `M/D(曜)` 表記が横方向を取り、資源CDチップ列が狭く折り返しやすかった。
  - 他画面の納期表記（`formatDueDate` の括弧付き曜日）と同一にすると列幅を削りにくいため、**進捗一覧専用**の短い表記に分離したい。
- **Fix（Web・境界分離）**:
  - **日付**: [`formatDueDate.ts`](../../apps/web/src/features/kiosk/productionSchedule/formatDueDate.ts) に `formatDueDateForProgressOverview` を追加。`YYYY-MM-DD` 接頭辞の解釈は内部ヘルパ `tryParseDueDatePartsFromIsoPrefix` に集約し、既存 `formatDueDate` と共有。**表示**: `MM/DD_曜`（ゼロ埋め、曜日は `_` 区切り・括弧なし。例: `03/23_月`）。
  - **レイアウト（初期）**: [`progressOverviewPresentation.ts`](../../apps/web/src/features/kiosk/productionSchedule/progressOverviewPresentation.ts) にセル／チップ用 Tailwind 定数と `progressOverviewProcessChipClassName` を集約。[`ProgressOverviewPartRow.tsx`](../../apps/web/src/components/kiosk/progressOverview/ProgressOverviewPartRow.tsx) は納期列をコンパクト化（`font-mono` `tabular-nums`・`text-[11px]` 等）、チップは `px-1`・`gap-0.5`・`leading-none`。品名は `line-clamp-2`。**余白詰め後の重なり対策**は [下記「納期と資源CDチップの重なり防止」](#progress-overview-due-resource-no-overlap-2026-03-23) を参照。
  - **API**: 変更なし（`GET /api/kiosk/production-schedule/progress-overview` 契約は従来どおり）。
  - **単体**: [`formatDueDate.test.ts`](../../apps/web/src/features/kiosk/productionSchedule/formatDueDate.test.ts) に `formatDueDateForProgressOverview` を追加。
- **Deploy / verify（実績）**:
  - **コード**: `main` 取り込みコミット `9d260a93`（**[PR #33](https://github.com/denkoushi/RaspberryPiSystem_002/pull/33)**）。手動順番 FKOJUN 修正と同一ブランチで本番反映。
  - **本番デプロイ**: Pi5 → raspberrypi4 → raspi4-robodrill01 のみ（Pi3 除外）・1台ずつ。上記 **Detach Run ID** 参照。
  - **自動実機検証**: `./scripts/deploy/verify-phase12-real.sh` **PASS 28 / WARN 0 / FAIL 0**（進捗一覧 API 200 を含む）。
- **Troubleshooting**:
  - **4枚並ばない**: 画面幅・資源CD文字数・品名列の取り方次第。納期列の削減だけでは保証されない。列数は [`PROGRESS_OVERVIEW_CARD_GRID_CLASS`](../../apps/web/src/features/kiosk/productionSchedule/progressOverviewPresentation.ts)（`xl:grid-cols-5`）もレバー。
  - **他画面の納期が変わった**: 進捗一覧以外は引き続き `formatDueDate`（`M/D(曜)`）。進捗一覧のみ `formatDueDateForProgressOverview`。
  - **Mac ブラウザでキオスク URL を開きたい**: 自己署名 TLS で `chrome-error` になりやすい（[KB-306](./frontend.md#kb-306-キオスク進捗一覧-製番フィルタドロップダウン端末別保存) と同趣旨）。レイアウトの目視は **実機 Pi4 / VNC** を推奨。

<a id="progress-overview-due-resource-no-overlap-2026-03-23"></a>

### 進捗一覧 納期と資源CDチップの重なり防止（オプションA・最小ギャップ、2026-03-23）

- **Context**:
  - [進捗一覧 納期列コンパクト](#progress-overview-due-column-compact-2026-03-23) の余白詰め後、**納期文字列と資源CDチップが視覚的に重なる**不具合が報告された。
  - 対処案は **オプションA（採用）**: 安全性優先で、納期列と資源列の境界に**最小限のギャップ**を常に確保し、重なりを防ぐ。**オプションB**（さらに詰めてチップ列を広げる）は却下（リスク大）。
- **Fix（Web・presentation 層）**:
  - [`progressOverviewPresentation.ts`](../../apps/web/src/features/kiosk/productionSchedule/progressOverviewPresentation.ts): 納期セル `PROGRESS_OVERVIEW_PART_ROW_DUE_CELL_CLASS` を `w-[78px]` `whitespace-nowrap`、資源セルに `pl-1`（納期との境界ギャップ）。コメントで「重なりを防ぐため最小限のギャップ」を明示。
  - [`ProgressOverviewPartRow.tsx`](../../apps/web/src/components/kiosk/progressOverview/ProgressOverviewPartRow.tsx): 上記定数を使用（API 不変）。
  - **日付表記**は引き続き `formatDueDateForProgressOverview`（`MM/DD_曜`）。
- **Deploy / verify（実績）**:
  - **PR**: [#35](https://github.com/denkoushi/RaspberryPiSystem_002/pull/35)（ブランチ `fix/kiosk-progress-overview-due-no-overlap`）。
  - **本番デプロイ**: Pi5 → raspberrypi4 → raspi4-robodrill01 のみ（Pi3 除外）・1台ずつ。Detach Run ID: `20260323-173508-8385`（Pi5）/ `20260323-174036-12818`（raspberrypi4）/ `20260323-174600-1356`（raspi4-robodrill01）。
  - **自動実機検証**: `./scripts/deploy/verify-phase12-real.sh` **PASS 28 / WARN 0 / FAIL 0**（2026-03-23、エージェント実行・進捗一覧 API 200 含む）。
  - **実機目視**: オペレーター確認済み（重なり解消）。
- **Troubleshooting**:
  - **まだ詰まりすぎる / 逆に空きすぎ**: `w-[78px]` と資源側 `pl-1`・チップ `px-1` のバランスを調整。他画面の `formatDueDate` は変更しない。
  - **Pi3 を更新したい**: 本変更は Web バンドル配信が中心だが、**Pi3 はリソース僅少のため** [deployment.md](../guides/deployment.md) の **Pi3 専用手順**に従う（本件では Pi5+Pi4×2 のみデプロイ）。

## 手動順番 上ペイン SOLID リファクタ（2026-03-20）

- **Context**:
  - 手動順番専用ページの上ペインがコンポーネント肥大しやすく、表示整形とテスト境界を固定したい。
- **Fix（仕様）**:
  - **純関数**: [`apps/web/src/features/kiosk/manualOrder/manualOrderRowPresentation.ts`](../../apps/web/src/features/kiosk/manualOrder/manualOrderRowPresentation.ts) の `presentManualOrderRow`（Vitest）、`ManualOrderOverviewRowBlock`、`ManualOrderPaneHeader`、`ManualOrderSiteToolbar` で JSX と表示ロジックを分離。
  - **API/データ契約**: 変更なし（`manual-order-overview` の `resources[].rows[]` 等は従来どおり）。
- **Deploy / verify（実績）**:
  - ブランチ **`feat/kiosk-manual-order-ui-solid`**。Pi5 → raspberrypi4 → raspi4-robodrill01 のみ（Pi3 除外）、`--limit` 1台ずつ、`--detach --follow`。
  - **Run ID 例**: `20260320-190147-27980`（Pi5）/ `20260320-190559-20664`（raspberrypi4）/ `20260320-191024-14641`（raspi4-robodrill01）。
  - **実機検証**: `./scripts/deploy/verify-phase12-real.sh` **PASS 27 / WARN 0 / FAIL 0**。
- **Troubleshooting**:
  - **`[ERROR] --detach requires RASPI_SERVER_HOST`**: Mac から `--detach` を付けて実行する場合、`RASPI_SERVER_HOST` 未設定で停止する。`export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"` を先に設定（[deployment.md](../guides/deployment.md)「デタッチ実行」、[KB-238](./infrastructure/ansible-deployment.md#kb-238-update-all-clientsshでraspberrypi5対象時にraspi_server_host必須チェックを追加)）。

## 手動順番 overview UI（上端ヘッダーリビール・カード密度・グリッド）（2026-03-21）

- **Context**:
  - 手動順番専用ルートでキオスク最上段メニューを畳みつつ操作領域を確保し、端末カードの情報密度とグリッド列数を調整したい。
- **Fix（仕様）**:
  - **ルート限定ヘッダー**: [`useKioskBottomCenterHeaderReveal`](../../apps/web/src/hooks/useKioskBottomCenterHeaderReveal.ts) と [`KioskLayout`](../../apps/web/src/layouts/KioskLayout.tsx) で **`/kiosk/production-schedule/manual-order` のときのみ** 既定で `KioskLayout` ヘッダーを非表示。現行は画面下辺中央付近へポインタを寄せるとスライドイン（タッチ専用代替は未実装）。
  - **カード**: `ManualOrderActiveDeviceBanner` を廃止。編集状態は [`ManualOrderDeviceCardHeaderRow`](../../apps/web/src/components/kiosk/manualOrder/ManualOrderDeviceCardHeaderRow.tsx) / [`ManualOrderDeviceCard`](../../apps/web/src/components/kiosk/manualOrder/ManualOrderDeviceCard.tsx) の「編集中」表示とグレーアウトで示す。複数資源時は先頭のみヘッダー1行、2件目以降はブロック内に `資源CD·件数`（全体仕様は本ファイル「手動順番 専用ページ」節の Spec を参照）。
  - **行表示**: [`presentManualOrderRow`](../../apps/web/src/features/kiosk/manualOrder/manualOrderRowPresentation.ts)（純関数・Vitest [`manualOrderRowPresentation.test.ts`](../../apps/web/src/features/kiosk/manualOrder/manualOrderRowPresentation.test.ts)）。
  - **グリッド**: [`ManualOrderOverviewPane`](../../apps/web/src/components/kiosk/manualOrder/ManualOrderOverviewPane.tsx) で `md:grid-cols-4` / `xl:grid-cols-6`。
  - **API**: 変更なし（`manual-order-overview` 契約は従来どおり）。
- **Deploy / verify（実績）**:
  - ブランチ **`feat/kiosk-manual-order-overview-ui`**。
  - Pi5 → raspberrypi4 → raspi4-robodrill01 のみ（Pi3 除外）、`--limit` 1台ずつ（[deployment.md](../guides/deployment.md)）。
  - **Run ID**: `20260321-094548-8867`（Pi5、`--limit server`、既定 detach のため **`./scripts/update-all-clients.sh --attach 20260321-094548-8867`** で完了待機）/ `20260321-095056`（raspberrypi4、`--foreground`）/ `20260321-095528`（raspi4-robodrill01、`--foreground`）。
  - **実機検証**: `./scripts/deploy/verify-phase12-real.sh` **PASS 27 / WARN 0 / FAIL 0**（2026-03-21）。
- **Troubleshooting**:
  - **Pi5 が detach で先に戻る**: Mac から `update-all-clients.sh` は既定でリモート detach。Pi5 実行後は **`--attach <run_id>`** で Ansible 完了を待ってから Pi4 を走らせるか、**`--foreground`** で最初からブロック実行する。
  - **順序**: Web バンドルは Pi5 の Docker `web` に載るため **必ず Pi5 を先**、続けて各 Pi4（`kiosk-browser` 再起動で新バンドルを取得）。

<a id="manual-order-resource-assignment-2026-03-20"></a>

## 手動順番 上ペイン 資源CD割り当て（DB・API・モーダル）（2026-03-20）

- **Context**:
  - device-scope v2 で工場内の各端末カードに、表示する資源CDを **複数・優先順** で明示したい。同一資源は1端末のみ。未設定時は上ペインを「資源未割り当て」とし、下ペインの鉛筆先頭資源は overview の先頭資源に追従させる。
- **Fix（仕様）**:
  - **DB**: `ProductionScheduleManualOrderResourceAssignment`（`csvDashboardId`, `siteKey`, `deviceScopeKey`, `resourceCd`, `priority`）。`@@unique` で **工場内の資源重複禁止**・端末内の順位・資源の一意性を担保。
  - **API**（`KIOSK_MANUAL_ORDER_DEVICE_SCOPE_V2_ENABLED` 時のみ有効、無効時は 404）:
    - `GET /api/kiosk/production-schedule/manual-order-resource-assignments?siteKey=...` → `{ siteKey, assignments: [{ deviceScopeKey, resourceCds[] }] }`
    - `PUT /api/kiosk/production-schedule/manual-order-resource-assignments` → body `{ siteKey, deviceScopeKey, resourceCds[] }`（端末単位の全置換）。他端末が使用中の資源を奪おうとした場合は **`409` / `RESOURCE_ALREADY_ASSIGNED`**。
  - **overview 統合**: [`listDueManagementManualOrderOverviewV2`](../../apps/api/src/services/production-schedule/due-management-manual-order-overview.service.ts) が **登録端末すべて** を `devices[]` に出し、**割当行が無い端末**は `resources: []`（資源未割り当て）。割当がある端末は [`mergeManualOrderOverviewResourcesWithAssignmentOrder`](../../apps/api/src/services/production-schedule/due-management-manual-order-overview.service.ts) で **割当に登録した資源CDのみを割当順で返す**（行なしは空 `rows[]`。割当に無い行集計は `resources[]` に載せない）。**レガシー**（`location === siteKey`）は割当0件のとき従来どおり行データから集計（後方互換）。
  - **Web**: カードヘッダーに **「資源」**（[`ManualOrderResourceAssignmentModal`](../../apps/web/src/components/kiosk/manualOrder/ManualOrderResourceAssignmentModal.tsx)）。候補は既存 `GET .../resources` 相当（ページの `visibleResourceCds`）。保存成功で **assignments + manual-order-overview** を invalidate。
- **Verification**:
  - API: `pnpm --filter @raspi-system/api test -- src/services/production-schedule/__tests__/merge-manual-order-resource-assignments.test.ts`
  - 実機一括: `./scripts/deploy/verify-phase12-real.sh`（v2 分岐で `manual-order-resource-assignments` の `assignments` を検証）
- **Deploy / verify（実績、2026-03-21）**:
  - ブランチ **`feat/manual-order-resource-assignment-ui`**。Pi5 → raspberrypi4 → raspi4-robodrill01 のみ（Pi3 除外）、`--limit` 1台ずつ、`--detach --follow`。
  - **Run ID**: `20260321-111725-4914`（Pi5）/ `20260321-112232-987`（raspberrypi4）/ `20260321-112706-12728`（raspi4-robodrill01）、いずれも success。
  - **実機検証**: `./scripts/deploy/verify-phase12-real.sh` **PASS 28 / WARN 0 / FAIL 0**（`manual-order-resource-assignments` の `assignments` 検証を含む）。
- **Troubleshooting**:
  - **409**: 同じ工場でその資源は既に別端末に割り当て済み。先に相手端末の割り当てを外す。

<a id="manual-order-pane-polish-2026-03-21"></a>

## 手動順番 overview 割当のみ・カードラベル短縮・下ペイン折りたたみ（2026-03-21）

- **Context**:
  - 上ペインに割当 UI に無い資源が載ると運用が紛らわしい。カード先頭の Location 行が工場ドロップダウンと重複し幅を圧迫する。下ペインのツールバー＋資源帯が縦に大きい。
- **Fix（仕様）**:
  - **API**: [`mergeManualOrderOverviewResourcesWithAssignmentOrder`](../../apps/api/src/services/production-schedule/due-management-manual-order-overview.service.ts) は **割当順が1件以上ある端末**では `assignmentOrder` のスロットのみ返し、割当に無い `derived` 資源は **末尾に付けない**。`assignmentOrder` が空のときは関数単体契約として `derived` をそのまま返す（v2 では割当0件端末は呼び出し側で `[]`）。Vitest: `merge-manual-order-resource-assignments.test.ts`。
  - **Web**:
    - [`stripSitePrefixFromDeviceLabel`](../../apps/web/src/features/kiosk/manualOrder/manualOrderDeviceDisplayLabel.ts) で `{siteKey} - ` プレフィックスのみ除去（[`useManualOrderPageController`](../../apps/web/src/features/kiosk/productionSchedule/useManualOrderPageController.ts) に集約）。
    - 下ペインのツールバー＋資源帯は [`ManualOrderLowerPaneCollapsibleToolbar`](../../apps/web/src/components/kiosk/manualOrder/ManualOrderLowerPaneCollapsibleToolbar.tsx) で包み、**見た目の開閉は [`useTimedHoverReveal`](../../apps/web/src/hooks/useTimedHoverReveal.ts) の `isVisible` のみ**（絞り込み有無とは独立）。
    - 一覧取得の `enabled`・空状態「検索してください」・`showFetching` 等は従来どおり [`hasScheduleFilterQuery`](../../apps/web/src/pages/kiosk/ProductionScheduleManualOrderPage.tsx)（`hasQuery || hasResourceCategoryResourceSelection`）。
    - キオスクヘッダーは [`useKioskBottomCenterHeaderReveal`](../../apps/web/src/hooks/useKioskBottomCenterHeaderReveal.ts) が同フック系を拡張利用。
- **Deploy / verify（実績、2026-03-21）**:
  - ブランチ **`feat/manual-order-pane-assignment-label-toolbar`**（API 割当のみ・ラベル短縮・当時の下ペイン折りたたみ初版）。[deployment.md](../guides/deployment.md) 標準。**対象**: Pi5 → raspberrypi4 → raspi4-robodrill01 のみ（Pi3 除外）、`--limit` 1台ずつ、`export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`、`--detach --follow`。
  - **Run ID**: `20260321-145746-1455`（Pi5）/ `20260321-150253-8405`（raspberrypi4）/ `20260321-150735-6173`（raspi4-robodrill01）、いずれも success。
  - **下ペイン右端ホバー・開閉と絞り込み分離**の本番反映は別ブランチ **`feat/manual-order-lower-pane-toolbar-hover`**（Run ID・Phase12 は [下ペイン帯ホバー節](#manual-order-lower-pane-toolbar-hover-2026-03-21)）。
  - **自動実機検証**: `./scripts/deploy/verify-phase12-real.sh` **PASS 28 / WARN 0 / FAIL 0**（上記各デプロイ後に再実行）。
- **UI（実機/VNC・推奨）**:
  - `/kiosk/production-schedule/manual-order` で上ペイン資源が割当と一致すること、Location 行の工場名重複が無いこと、下ペイン見出し行**右端アイコン**へマウスを乗せて帯が展開し、パネル外に出すと遅延後に折りたたまれることを確認（Phase12 はブラウザを開かない）。絞り込み有無で帯が常時開いたままにならないこと。
- **Troubleshooting**:
  - **下ペイン帯が開かない**: タッチのみ端末ではホバーできない（最上段メニューと同様 **マウス前提**）。**右端のスライダー型アイコン**（十分な hit area）へポインタを載せる。
  - **上ペインに想定外の資源が無い**: 割当モーダルで登録した CD のみが v2 overview に載る。DB に残る割当外の行は下ペイン一覧（別クエリ）で確認。

<a id="manual-order-lower-pane-toolbar-hover-2026-03-21"></a>

## 手動順番 下ペイン ツールバー帯 右端ホバー展開（2026-03-21）

- **Context**:
  - 下ペイン帯の展開を `hasScheduleFilterQuery` と OR すると、絞り込み有効時に常時展開となり上ペイン（ヘッダーはホバーのみ）と挙動が揃わない。細い `h-2` ホットゾーンは実機で発見しづらい。
- **Fix（仕様）**:
  - **Web**: [`ManualOrderLowerPaneCollapsibleToolbar`](../../apps/web/src/components/kiosk/manualOrder/ManualOrderLowerPaneCollapsibleToolbar.tsx) が見出し行（タイトル・ステータス・**右端トリガー**）と `max-height` 折りたたみ枠を担当。子は `children` で注入（SOLID: ページはフック＋業務 UI のみ）。**見た目の開閉**は [`useTimedHoverReveal`](../../apps/web/src/hooks/useTimedHoverReveal.ts) の `isVisible` のみ。`hasScheduleFilterQuery` は [`useKioskProductionSchedule`](../../apps/web/src/pages/kiosk/ProductionScheduleManualOrderPage.tsx) の `enabled`・空状態「検索してください」・`showFetching` 等にのみ使用。Vitest: [`ManualOrderLowerPaneCollapsibleToolbar.test.tsx`](../../apps/web/src/components/kiosk/manualOrder/ManualOrderLowerPaneCollapsibleToolbar.test.tsx)。
- **Deploy / verify（実績、2026-03-21）**:
  - ブランチ **`feat/manual-order-lower-pane-toolbar-hover`**。[deployment.md](../guides/deployment.md) 標準。**対象**: Pi5 → raspberrypi4 → raspi4-robodrill01 のみ（Pi3 除外）、`--limit` 1台ずつ、`export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`、`--detach --follow`。
  - **Run ID**: `20260321-162637-28864`（Pi5）/ `20260321-163112-2184`（raspberrypi4）/ `20260321-163710-15180`（raspi4-robodrill01）、いずれも success。
  - **自動実機検証**: `./scripts/deploy/verify-phase12-real.sh` **PASS 28 / WARN 0 / FAIL 0**（2026-03-21、Mac から実行）。
- **知見**:
  - 製番／資源のドロップダウンがポータルで body 側に出ると、マウスが折りたたみラッパー外に出て **`mouseleave` により帯が閉じうる**。運用上問題になったらコンポーネント境界で遅延クローズ等を最小追加する（実装計画上のリスク）。
- **Troubleshooting**:
  - **帯が開かない**: タッチのみ端末ではホバー不可（最上段メニューと同様 **マウス前提**）。**見出し行右端のスライダー型アイコン**へポインタを載せる。

<a id="production-schedule-main-toolbar-hover-2026-03-21"></a>

## 生産スケジュール本体 検索・資源フィルタ帯 ホバー展開（2026-03-21）

- **Context**:
  - キオスク **生産スケジュール本体**（`/kiosk/production-schedule`、沉浸式 allowlist 対象）は最上段メニューを上端ホバーで出す一方、検索バー＋資源フィルタが常時表示で表示領域を圧迫していた。手動順番下ペインと同様、**ホバーで帯を出す**挙動に揃えたい。
- **Fix（仕様）**:
  - **Web**: [`ProductionSchedulePage.tsx`](../../apps/web/src/pages/kiosk/ProductionSchedulePage.tsx) で [`ManualOrderLowerPaneCollapsibleToolbar`](../../apps/web/src/components/kiosk/manualOrder/ManualOrderLowerPaneCollapsibleToolbar.tsx) に [`ProductionScheduleToolbar`](../../apps/web/src/components/kiosk/ProductionScheduleToolbar.tsx) と [`ProductionScheduleResourceFilters`](../../apps/web/src/components/kiosk/ProductionScheduleResourceFilters.tsx) を包む。**見た目の開閉**は [`useTimedHoverReveal`](../../apps/web/src/hooks/useTimedHoverReveal.ts)。見出し文言は **「検索・資源フィルタ」**。Mac 向け端末選択バー（`macManualOrderV2`）は折りたたみ対象外のまま上段に配置。API 契約・DB 変更なし。
- **E2E / ローカル検証**:
  - 沉浸式ヘッダーと同様、ナビ・サイネージ／電源ボタン操作前に **上端ホバー**が必要。[`revealKioskHeader`](../../e2e/helpers.ts) を [`kiosk.spec.ts`](../../e2e/kiosk.spec.ts) と [`kiosk-smoke.spec.ts`](../../e2e/smoke/kiosk-smoke.spec.ts) で共有。
  - **Playwright（`CI=true`）**: `apps/api/.env` が `NODE_ENV=production` の開発マシンでは **CORS が無効**になり、Web(4173)→API(8080) の **OPTIONS が 404** → 管理画面バックアップ E2E 等が `waitForResponse` タイムアウトしうる。[`playwright.config.ts`](../../playwright.config.ts) の API `webServer.env` に **`NODE_ENV: development`** を明示（子プロセスでは dotenv が既存 env を上書きしない前提で有効）。
  - **Web Vitest**: シェルに **`NODE_ENV=production` が残っている**と React production ビルドとなり `act(...) is not supported in production builds` で大量失敗する → **`NODE_ENV=development`** で `pnpm --filter @raspi-system/web test` を実行。
- **Deploy / verify（実績、2026-03-21）**:
  - ブランチ **`feat/kiosk-production-schedule-collapsible-toolbar`**。[deployment.md](../guides/deployment.md) 標準の `scripts/update-all-clients.sh`。**対象**: Pi5 → raspberrypi4 → raspi4-robodrill01 のみ（**Pi3 除外**）、`--limit` で **1台ずつ順番**。`export RASPI_SERVER_HOST=100.106.158.2`（ホストのみの場合はスクリプトが `denkon5sd02@` を付与する運用に合わせる）。
  - **ログ接頭辞例**: Pi5 `ansible-update-20260321-214954`（以降 Pi4 は連続実行で別ログ）。
  - **自動実機検証**: `./scripts/deploy/verify-phase12-real.sh` **PASS 28 / WARN 0 / FAIL 0**（本変更は API 追加なしのため Phase12 は回帰中心。帯 UI はスクリプト外）。
- **Troubleshooting**:
  - **帯が開かない**: タッチのみでは不可。**「検索・資源フィルタ」行右端のスライダー型アイコン**へマウスを載せる。
  - **ローカル E2E が backup 系でタイムアウト**: Pi5 起動 API の `NODE_ENV` と CORS を確認（上記 `playwright.config.ts`）。

<a id="kiosk-immersive-allowlist-manual-order-row-2026-03-21"></a>

## キオスク沉浸式 allowlist 拡張 + 手動順番上ペイン行（品名を工順直後）（2026-03-21）

- **Context**:
  - 沉浸式（上端ホバーで `KioskLayout` 最上段をリビール）は当初 **手動順番ルートのみ** としていたが、タグ持出・計測/吊具持出・**生産スケジュール本体**・**進捗一覧**でも操作領域を広げたい要望があった。
  - 手動順番上ペインの行表示で、**品名を工順の直後（1行目）**に寄せ、**2行目は機種名のみ**とするレイアウトに変更した（現場の視線移動を減らす）。
- **Fix（仕様）**:
  - **沉浸式の単一判定源**: [`kioskImmersiveLayoutPolicy.ts`](../../apps/web/src/features/kiosk/kioskImmersiveLayoutPolicy.ts) の `usesKioskImmersiveLayout(pathname)`。[`KioskLayout.tsx`](../../apps/web/src/layouts/KioskLayout.tsx) がこれを参照し、該当ルートで `flex` 沉浸式＋上端リビールを有効化。allowlist・除外は [KB-311](./KB-311-kiosk-immersive-header-allowlist.md) を参照。
  - **手動順番行**: [`presentManualOrderRow`](../../apps/web/src/features/kiosk/manualOrder/manualOrderRowPresentation.ts) — **Row A**: 製番·品番·工順·品名（いずれかが空なら省略）、**Row B**: `normalizeMachineName` 適用済みの機種名のみ。Vitest: [`manualOrderRowPresentation.test.ts`](../../apps/web/src/features/kiosk/manualOrder/manualOrderRowPresentation.test.ts)。UI: [`ManualOrderOverviewRowBlock.tsx`](../../apps/web/src/components/kiosk/manualOrder/ManualOrderOverviewRowBlock.tsx)。
  - **E2E**: 沉浸式でヘッダー非表示のままナビを叩くと失敗するため、[`kiosk-smoke.spec.ts`](../../e2e/smoke/kiosk-smoke.spec.ts) に **`revealKioskHeader()`**（上端ホバー相当）を追加。
- **Deploy / verify（実績、2026-03-21）**:
  - ブランチ **`feat/kiosk-immersive-layout-manual-order-row`**。[deployment.md](../guides/deployment.md) 標準。**対象**: Pi5 → raspberrypi4 → raspi4-robodrill01 のみ（**Pi3 除外**・リソース僅少のため Pi3 は専用手順）、`--limit` で **1台ずつ順番**。
  - **Run ID**: `20260321-192700-29456`（Pi5 / server）/ `20260321-193059-19711`（raspberrypi4）/ `20260321-193547-13867`（raspi4-robodrill01）、いずれも success。
  - **自動実機検証**: `./scripts/deploy/verify-phase12-real.sh` **PASS 28 / WARN 0 / FAIL 0**（2026-03-21、Tailscale 経由で実施）。
- **知見**:
  - ルート追加時は **ポリシー＋Vitest** を同時更新しないと、沉浸式の有無がブレる（[KB-311](./KB-311-kiosk-immersive-header-allowlist.md)）。
  - ローカル Web テストで `NODE_ENV=production` が残ると React `act(...)` 警告・失敗が出ることがある → **`NODE_ENV=test`** を明示して `pnpm --filter @raspi-system/web test` を実行。
- **Troubleshooting**:
  - **某画面だけヘッダーが常時出る / 常に隠れる**: `usesKioskImmersiveLayout` の allowlist と pathname（末尾 `/` 正規化）を確認。`/kiosk/production-schedule` は **完全一致**、手動順番・進捗一覧は **接頭辞**。
  - **Phase12 はブラウザを開かない**: allowlist 各 URL の上端リビール・手動順番の Row A/B は **実機または Pi5 経由 VNC** で目視（Mac 直 `https` は自己署名で失敗しやすい → [deploy-status-recovery.md](../runbooks/deploy-status-recovery.md)）。

## 手動順番 overview 密度調整 + 機種名表示修正（2026-03-20）

- **Context**:
  - 手動順番専用ページ上ペインの本文フォントを生産スケジュール一覧（`text-xs`）と揃え、高密度表示を統一したい。
  - 部品行のみ割当のとき、上ペイン行明細で機種名が空になる事象が報告された。
- **Fix（仕様）**:
  - **Web**: [`manualOrderOverviewTypography.ts`](../../apps/web/src/features/kiosk/manualOrder/manualOrderOverviewTypography.ts) に `KIOSK_MANUAL_ORDER_OVERVIEW_BODY_TEXT_CLASS = 'text-xs'` を追加。`ManualOrderDeviceCard` と `ManualOrderOverviewRowBlock` で参照し、本文のみ `text-xs` を適用（カード全体にはかけない）。
  - **API**: [`due-management-manual-order-overview.service.ts`](../../apps/api/src/services/production-schedule/due-management-manual-order-overview.service.ts) で機種名解決を `buildSeibanToMachineName`（割当行のみから MH/SH を探す）から [`fetchSeibanProgressRows`](../../apps/api/src/services/production-schedule/seiban-progress.service.ts) 経由へ変更。CsvDashboardRow 全体から製番単位で機種名を取得し、割当が部品行のみのときも機種名が返るように修正。
- **Deploy / verify（実績）**:
  - ブランチ **`feat/manual-order-overview-density-align`**。Pi5 → raspberrypi4 → raspi4-robodrill01 のみ（Pi3 除外）、`--limit` 1台ずつ、`--detach --follow`。
  - **Run ID 例**: `20260320-201540-12802`（Pi5）/ `20260320-202332-28162`（raspberrypi4）/ `20260320-202831-30296`（raspi4-robodrill01）、いずれも success。
  - **実機検証**: `./scripts/deploy/verify-phase12-real.sh` **PASS 27 / WARN 0 / FAIL 0**。
- **Troubleshooting**:
  - **機種名が空**: 割当行のみから MH/SH を探していた旧実装が原因。`fetchSeibanProgressRows` で製番全体の CsvDashboardRow を参照するよう修正済み。

## 手動順番 下ペイン 鉛筆・工場変更時のフィルタリセット（2026-03-20）

- **Context**:
  - 上ペインで端末（鉛筆）や工場を切り替えたとき、下ペインの絞り込みが残ると誤操作しやすい。
  - 鉛筆選択直後は、当該端末の先頭資源に合わせて一覧を出したい（機種名未入力でも API は `resourceCds` + `resourceCategory` で絞り込み可能）。
- **Fix（仕様）**:
  - **鉛筆**: `selectedOrderNumbers` をクリアし、検索条件を `DEFAULT_SEARCH_CONDITIONS` 相当に戻したうえで、カード先頭資源 `resources[0].resourceCd` を1件選択し、`isGrindingResourceCd` に応じて研削/切削トグルを整合（純関数 `buildConditionsAfterPencilFromFirstResourceCd`）。**登録製番チップの選択（`activeQueries`）だけは直前状態を引き継ぐ**（`mergeManualOrderPencilPreservedSearchFields`）。**ツールバー検索欄の `inputQuery` はベース（空）に戻す**（チップのみ維持するため）。資源0件端末でも同様に `DEFAULT` へ戻しつつ `activeQueries` のみ継承。実装: [`manualOrderLowerPaneSearch.ts`](../../apps/web/src/features/kiosk/productionSchedule/manualOrderLowerPaneSearch.ts)。
  - **工場変更**: 編集端末をクリアしつつ、`resetSearchConditions` + `selectedOrderNumbers` クリア（先頭資源の自動指定はしない）。
  - **一覧取得**: 手動順番ページのみ、`hasQuery` に加え `useProductionScheduleQueryParams` の `hasResourceCategoryResourceSelection`（工程ONかつ資源選択あり）で `useKioskProductionSchedule` を有効化。ツールバー「取得中表示」や「検索してください」も同じ合成条件に合わせる。
  - **不変**: ソートモード（`MANUAL_ORDER_PAGE_SORT_MODE_STORAGE_KEY`）と共有登録製番履歴（`kioskProductionScheduleSharedStorageKeys`）はリセットしない。
- **Deploy / verify（実績、2026-03-20）**:
  - **第1弾（下ペイン初期化のみ）**: ブランチ **`feat/manual-order-pencil-lower-pane-reset`**（コミット例: `cf27935a`）。**対象**: Pi5 + Pi4×2 のみ（Pi3 除外）、[deployment.md](../guides/deployment.md) の **1台ずつ順番**（`export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"` → `--limit "raspberrypi5"` → `raspberrypi4` → `raspi4-robodrill01`、`--detach --follow`）。**Run ID 例**: `20260320-214327-13205`（Pi5）/ `20260320-215018-18468`（raspberrypi4）/ `20260320-215450-29665`（raspi4-robodrill01）、いずれも success。
  - **第2弾（登録製番チップ `activeQueries` 維持の実装反映）**: ブランチ **`feat/manual-order-pencil-preserve-seiban`**。**Run ID**: `20260320-223140-3362`（Pi5）/ `20260320-223518-30451`（raspberrypi4）/ `20260320-223949-27315`（raspi4-robodrill01）、いずれも success。手順は第1弾と同じ（Pi3 除外・1台ずつ）。
  - **自動実機検証**: `./scripts/deploy/verify-phase12-real.sh` **PASS 27 / WARN 0 / FAIL 0**（API・deploy-status・manual-order-overview v2・Pi5 リモート・Pi4/Pi3 サービス・`verify-services-real.sh` まで含むサマリ）。第2弾デプロイ後に再実行して確認。
  - **main 取り込み**: fast-forward、`a6ab547ee4aea70703a133685a348394f6200d12`（2026-03-20）。
- **UI（実機/VNC・推奨）**: Phase12 はブラウザを開かない。鉛筆で端末を切替えたとき、**登録製番チップ選択は維持**され、その他の下ペイン絞り込み（資源・製造order追加・備考/納期トグル・機種名など）は初期化され先頭資源が選ばれること、工場変更で下ペインがクリアされることは、キオスク実機または Pi5 経由 VNC で `/kiosk/production-schedule/manual-order` を開き目視確認する（[deploy-status-recovery.md](../runbooks/deploy-status-recovery.md) の該当行を参照）。
- **Troubleshooting**:
  - **鉛筆後にツールバー検索欄だけ空になる**: 不具合ではなく仕様。`inputQuery` はリセットし、**登録製番チップ（`activeQueries`）のみ**前状態を維持する。
  - **`pnpm -r test` だけでは API 統合テストが DB なしで失敗**: ローカルは `pnpm --filter @raspi-system/web test` と `pnpm test:api`（Docker `postgres-test-local`）に分ける。終了後 `bash scripts/test/stop-postgres.sh` でテスト用コンテナを削除する運用が既存ドキュメントと整合。
  - **機種名なしで先頭資源のみ**: メイン生産スケジュール画面の `hasQuery` は機種名付きの機械スコープ検索を想定しているが、手動順番ページでは `hasResourceCategoryResourceSelection` を追加し API の `resourceCds` + `resourceCategory` と整合させている。一覧が空のときは `activeDeviceScopeKey`・資源0件カード・検索条件を確認。

## 手動順番 専用ページ（キオスク）追加（2026-03-20）

- **Context**:
  - 現場リーダーが「全体把握（端末横断）→下ペイン編集（既存スケジュールUI）」を1画面で行いたい要求が明確化。
  - 既存 `ProductionSchedulePage` の丸ごと複製は責務肥大を招くため、部品再利用で専用ページを追加する方針にした。
- **Fix**:
  - ルート `/kiosk/production-schedule/manual-order` を追加し、ヘッダーに `手動順番` ナビを追加（生産スケジュールと進捗一覧の間）。
  - 上ペインは `site-devices` + `manual-order-overview` を統合し、工場内全端末カードを表示（空カード含む、返却順固定）。
  - 下ペインは既存 `ProductionScheduleToolbar` / `ProductionScheduleResourceFilters` / `ProductionScheduleTable` を再利用。
  - 端末選択はカードの **「編集」** で `targetDeviceScopeKey` を切替、順番変更は既存 `PUT /kiosk/production-schedule/:rowId/order` 契約で即保存。
  - 検索条件は専用 storage key に分離し、既存生産スケジュール画面と干渉しないようにした。
- **UX/State**:
  - 編集中端末は**該当カード**のヘッダー行に「編集中」と **「編集」** ボタンで示す（グローバル帯バナーは廃止）。
  - **沉浸式 allowlist** に含まれるルート（手動順番・進捗一覧・タグ/計測/吊具持出・生産スケジュール本体等。詳細は [KB-311](./KB-311-kiosk-immersive-header-allowlist.md)）では、キオスク最上段メニュー（`KioskLayout` ヘッダー）を既定で非表示にし、マウスを画面上端付近へ寄せるとスライド表示（`useKioskTopEdgeHeaderReveal`）。タッチ専用代替は未実装。
  - **下ペイン**の `ProductionScheduleToolbar` と資源帯は、[`ManualOrderLowerPaneCollapsibleToolbar`](../../apps/web/src/components/kiosk/manualOrder/ManualOrderLowerPaneCollapsibleToolbar.tsx) で **既定折りたたみ**、見出し行**右端ホットゾーン**へマウスを乗せると展開（`useTimedHoverReveal`）。**開閉は絞り込み条件と独立**（一覧取得の有効化は `hasScheduleFilterQuery`）。タッチのみ端末ではホバーできないため帯が畳んだままになりうる（最上段メニューと同様 **マウス前提**）。
  - 非編集中カードは読める程度にグレーアウト。
  - 保存中はカード単位で軽いローディング、失敗はカード強調 + 下ペイン上部バーで通知。
  - 保存成功メッセージは出さず、上ペイン反映でフィードバック。
- **Spec（契約・境界）**:
  - **ルート**: `/kiosk/production-schedule/manual-order`（`App.tsx`）。**ナビ**: `KioskHeader` に「手動順番」（生産スケジュールと進捗一覧の間）。
  - **データ**: 上ペインは `site-devices` + `manual-order-overview` を `useManualOrderPageController` で統合。下ペインは既存 `ProductionScheduleToolbar` / `ProductionScheduleResourceFilters` / `ProductionScheduleTable`。
  - **上辺1行（余白削減）**: `ManualOrderOverviewPane` に `siteToolbar`（手動順番見出し・工場 `<select>`）を渡し、**全体把握**・**N 端末**と同一フレックス行にまとめる（旧2段ヘッダを廃止）。重複していた「端末一覧: N」表記は **N 端末**に一本化。
  - **行表示のプレゼンテーション層（SOLID 寄せ）**: [`manualOrderRowPresentation.ts`](../../apps/web/src/features/kiosk/manualOrder/manualOrderRowPresentation.ts) の `presentManualOrderRow`（純関数・Vitest）。**行ブロックは2行（2026-03-21 更新）**: **Row A**＝製番·品番·**工順·品名**（空は省略）、**Row B**＝**機種名のみ**（[`normalizeMachineName`](../../apps/web/src/features/kiosk/productionSchedule/machineName.ts) で半角大文字）。UI は [`ManualOrderOverviewRowBlock.tsx`](../../apps/web/src/components/kiosk/manualOrder/ManualOrderOverviewRowBlock.tsx)。**端末カード最上段**は [`ManualOrderDeviceCardHeaderRow.tsx`](../../apps/web/src/components/kiosk/manualOrder/ManualOrderDeviceCardHeaderRow.tsx)（Location·先頭資源CD·件数·編集中·編集）。複数資源時は先頭のみヘッダー1行に含め、2件目以降はブロック内に `資源CD·件数` のみ。上ペイン本文の `text-xs` は [`manualOrderOverviewTypography.ts`](../../apps/web/src/features/kiosk/manualOrder/manualOrderOverviewTypography.ts)。**カード Location 行の重複削減**: 選択中工場の `siteKey` と一致する `{siteKey} - ` プレフィックスだけを [`stripSitePrefixFromDeviceLabel`](../../apps/web/src/features/kiosk/manualOrder/manualOrderDeviceDisplayLabel.ts) で除去（[`useManualOrderPageController`](../../apps/web/src/features/kiosk/productionSchedule/useManualOrderPageController.ts) で集約）。グリッド列数は [`ManualOrderOverviewPane.tsx`](../../apps/web/src/components/kiosk/manualOrder/ManualOrderOverviewPane.tsx)（例: `md:grid-cols-4` / `xl:grid-cols-6` でカード幅を圧縮）。パス接頭辞定数は [`kioskManualOrderRoutes.ts`](../../apps/web/src/features/kiosk/manualOrder/kioskManualOrderRoutes.ts)。上ペイン統合ヘッダは [`ManualOrderPaneHeader.tsx`](../../apps/web/src/components/kiosk/manualOrder/ManualOrderPaneHeader.tsx)、工場選択は [`ManualOrderSiteToolbar.tsx`](../../apps/web/src/components/kiosk/manualOrder/ManualOrderSiteToolbar.tsx)。沉浸式 allowlist・上端リビールは [KB-311](./KB-311-kiosk-immersive-header-allowlist.md) / [沉浸式拡張節](#kiosk-immersive-allowlist-manual-order-row-2026-03-21)。
  - **manual-order-overview の行明細 `resources[].rows[]`（2026-03-20）**: 資源 CD ごとに手動順の行を `orderNumber` 昇順で返す。各要素は `fseiban` / `fhincd` / `processLabel`（`ProductionScheduleRowNote.processingType` があれば優先、なければ `FKOJUN`）/ `machineName` / `partName`（API 解決経路は従来どおり上記サービス参照）。キオスク上ペインの**行ブロック表示**は `presentManualOrderRow` により **Row A: 製番·品番·工順·品名**、**Row B: 機種名のみ**（2026-03-21）。空セグメントは省略。**本文フォントは生産スケジュール一覧の `text-xs` と同じ。** `assignedCount` 等の集計は従来どおり。**手動 vs 自動順の差分はキオスク上ペインには表示しない**（デザイン方針）。静的プレビューは実装と乖離しうるため [design-previews](../design-previews/README.md) を参照。
  - **検索条件**: `useProductionScheduleSearchConditionsWithStorageKey` により **専用 localStorage キー**で通常の生産スケジュールページと干渉しない。
  - **登録製番（検索履歴）・search-state（2026-03-19 実装）**:
    - **上限（2026-03-31）**: 共有 `history` と複数検索 `activeQueries` は **`KIOSK_PRODUCTION_SCHEDULE_REGISTERED_SEIBAN_MAX = 50`**（`packages/shared-types`）。20→50 の経緯・CI（Trivy）・Phase12 実機検証は [KB-231](./api.md#kb-231-生産スケジュール登録製番上限の拡張8件20件とサイネージアイテム高さの最適化) 追記節を参照。
    - 通常の `ProductionSchedulePage` と同様、`GET/PUT .../kiosk/production-schedule/search-state`（共有ストレージ）と [`useSharedSearchHistory`](../../apps/web/src/features/kiosk/productionSchedule/useSharedSearchHistory.ts) を `ProductionScheduleManualOrderPage` に配線。
    - localStorage の履歴・非表示履歴キーは [`kioskProductionScheduleSharedStorageKeys.ts`](../../apps/web/src/features/kiosk/productionSchedule/kioskProductionScheduleSharedStorageKeys.ts)（`production-schedule-search-history` / `production-schedule-search-history-hidden`）で通常ページと **同一**（検索条件の専用キーとは分離したまま）。
    - `useProductionScheduleMutations` の `isSearchStateWriting` は `useUpdateKioskProductionScheduleSearchState` の `isPending` と整合。
  - **製番ドロップダウンの機種名**: `useKioskProductionScheduleHistoryProgress` の `progressBySeiban` を `ProductionScheduleSeibanFilterDropdown` へ渡す表示と、通常ページを揃える。
  - **保存**: `PUT /api/kiosk/production-schedule/:rowId/order` + `targetDeviceScopeKey`（device-scope v2 前提）。ミューテーションは `useProductionScheduleMutations` の `orderError` / `resetOrderError` でカード／バーに集約。
  - **静的プレビュー**: [docs/design-previews/README.md](../design-previews/README.md)（実装検討用 HTML、本番挙動の代替ではない）。
- **Deploy / verify（実績、2026-03-20）**:
  - **初回（専用ページ本体）**: ブランチ `feature/kiosk-manual-order-page`。[deployment.md](../guides/deployment.md) 標準。**1台ずつ順番**: `--limit "raspberrypi5"` → `--limit "raspberrypi4"` → `--limit "raspi4-robodrill01"`（Pi3 除外）、`--detach --follow`。
  - **追従（登録製番履歴共有 + CI/テスト安定化）**: ブランチ `feat/kiosk-manual-order-shared-search-history`。同じく Pi5 → raspberrypi4 → raspi4-robodrill01 を1台ずつ。**デプロイ Run ID 例**: `20260320-151334-11088`（Pi5）/ `20260320-152207-21899`（raspberrypi4）/ `20260320-152629-30597`（raspi4-robodrill01）、いずれも **exit 0 / success**。
  - **main 反映（overview 行明細 `rows[]` + 上ペイン高密度）**: ブランチ **`main`**（コミット例: `feat(kiosk): manual-order-overview に行明細 rows[] と上ペイン高密度表示`）。**CI**: GitHub Actions 成功（例: Run `23332683133`）。**デプロイ**: 対象 Pi5 + Pi4×2 のみ（Pi3 除外）、**1台ずつ順番**（`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01`）。**Run ID 例**: `20260320-175411-21044` / `20260320-180217-22594` / `20260320-180649-2465`（いずれも success）。
  - **自動実機検証**: `./scripts/deploy/verify-phase12-real.sh` — **PASS 27 / WARN 0 / FAIL 0**（`manual-order-overview` v2 は `siteKey` 導出付きで検証）。
  - **手動UI**: Phase12 はブラウザの専用ページを見ない。**実機/VNC** で `/kiosk/production-schedule/manual-order` を開き、(1) **最上段メニュー**は上端ホバーで表示できること（沉浸式 allowlist 拡張後は **タグ持出・計測/吊具・生産スケジュール本体・進捗一覧** でも同様。除外例は [KB-311](./KB-311-kiosk-immersive-header-allowlist.md)）、(2) **「編集」**で端末切替・下ペイン編集・保存フィードバック、(3) 登録製番履歴共有・製番ドロップダウン機種名、(4) 上ペイン行が **製番·品番·工順·品名（1行目）/ 機種名のみ（2行目）** であること、を確認（Mac 直ブラウザは自己署名で失敗しやすい → [deploy-status-recovery.md](../runbooks/deploy-status-recovery.md) 注記どおり）。
  - **注記（`rows[]` と空データ）**: device-scope v2 で `manual-order-overview?siteKey=...` の **`resources` が 0 件**のとき、API 上は `rows[]` の中身を検証できない。Phase12 の合格と、手動UIの「表示のみ」で代替可（データあり環境で再確認）。
- **ローカル品質ゲート（開発時）**:
  - `pnpm --filter @raspi-system/web lint` / `build` / `test`（Vitest）。
  - API 統合テスト: `pnpm test:api`（`scripts/test/run-tests.sh`、PostgreSQL `postgres-test-local`。終了後 `scripts/test/stop-postgres.sh` でテスト用コンテナ削除）。
- **Troubleshooting**:
  - **ESLint import/order**: `ProductionScheduleManualOrderPage.tsx` 等で import 順エラー → `eslint --fix` または deployment.md の import グループ規則に合わせる。
  - **型エラー（製番検索モーダル）**: `ProductionOrderSearchModal` は `useProductionOrderSearch` の戻り値（`productNoInput` 等）と props を一致させる（古い prop 名はビルド失敗）。
  - **Phase12 と overview**: device-scope v2 時は無印 `manual-order-overview` が 400 になるのは仕様。スクリプトが `global-rank` から `siteKey` を導出できているか確認（[KB-302](./ci-cd.md#kb-302-location-scope-resolverのブランド型ciビルド失敗とverify-phase12-realのping失敗) — ping 失敗時は手動 curl 代替）。
  - **`rows[]` が curl で見えない**: `resources` が空のときは `rows[]` も返らない。本番データで手動順の行が存在する端末・サイトで再確認する。
- **main マージ**: ドキュメント反映後、PR 経由で `main` へ統合（運用標準）。

## 切削除外リストで一部資源CDのみ除外される事象（2026-03-16 調査）

- **Context**:
  - キオスク進捗一覧と生産スケジュール設定（切削除外リスト）で、除外指定した資源CDが「一部のみ」反映される報告が継続。
  - Location Scope リファクタ後の運用しやすさは向上したが、切削除外の一貫性は未収束。
- **Symptoms**:
  - 管理画面で除外設定した資源CDが、画面によって除外されたり残ったりする。
  - 資源CDボタン一覧と実際の行データで、除外結果が一致しないケースがある。
- **Investigation**:
  - H1: DB保存値が壊れている  
    - Result: REJECTED（設定値は保存・取得できている）
  - H2: 判定ロジックが経路ごとに分岐し、比較規則が揃っていない  
    - Result: CONFIRMED
  - H3: 資源一覧APIが除外ポリシーを適用していない  
    - Result: CONFIRMED
- **Root cause**:
  - 除外判定の責務が分散し、データソース（静的デフォルト/DB設定）と正規化規則（trimのみ、uppercaseあり/なし）が統一されていない。
  - `GET /api/kiosk/production-schedule/resources` が除外前データを返却し、UI表示との整合が崩れる。
- **Fix plan（最小変更）**:
  - `resource-category-policy` を除外判定の単一入口にする。
  - `resourceCd` 比較を `trim + uppercase` に統一（保存時/読取時/比較時）。
  - `resources` API でも同ポリシーを適用し、ボタン表示と一覧結果の不整合を解消。
  - Web側の固定デフォルト依存を段階的に削減し、API設定値を正に寄せる。
- **Prevention**:
  - 大文字小文字・空白混在・複数除外CDの回帰テストを API/Web 双方に追加する。
  - 「切削除外は policy 経由のみ」の実装規約を維持し、呼び出し側で個別判定を増やさない。
- **References**:
  - `apps/api/src/services/production-schedule/policies/resource-category-policy.service.ts`
  - `apps/api/src/services/production-schedule/production-schedule-query.service.ts`
  - `apps/api/src/services/production-schedule/progress-overview-query.service.ts`
  - `apps/api/src/services/production-schedule/due-management-query.service.ts`
  - `apps/api/src/routes/kiosk/production-schedule/resources.ts`
  - `apps/web/src/features/kiosk/productionSchedule/resourceCategory.ts`

## 切削除外リスト追随修正（policy統一 + resources拡張、2026-03-16 実装）

- **Context**:
  - 管理コンソールで除外資源CDを追加/削除しても、画面経路によって追随しない状態が残っていた。
  - 運用上は「設定変更に自動追随」が必須。
- **Fix**:
  - API policy層に `resourceCd` 正規化（`trim + uppercase`）と除外判定を集約。
  - `production-schedule` / `progress-overview` / `due-management` / `resource-load-estimator` を共通判定へ統一。
  - `GET /api/kiosk/production-schedule/resources` を後方互換で拡張し、`resourceItems[{resourceCd, excluded}]` を追加。
  - Web の資源CDボタンを `resourceItems.excluded` 追随へ変更（静的既定値依存を回避）。
- **Verification**:
  - `pnpm -r lint --max-warnings=0` 成功
  - `pnpm --filter @raspi-system/api build` 成功
  - `pnpm --filter @raspi-system/web build` 成功
  - `pnpm --filter @raspi-system/api test -- src/services/production-schedule/__tests__/resource-category-policy.service.test.ts src/services/production-schedule/__tests__/production-schedule-query.service.test.ts` 成功（13 tests）
  - 補足: `pnpm --filter @raspi-system/api test` 全件はローカルDB未起動（`localhost:5432`）で統合テスト失敗。DB起動後に再実行が必要。
- **Prevention**:
  - 除外判定の新規実装は policy ヘルパー経由のみとし、呼び出し側の重複判定を禁止。
  - resources API は後方互換のまま拡張を継続し、段階移行を可能にする。
- **References**:
  - `apps/api/src/services/production-schedule/policies/resource-category-policy.service.ts`
  - `apps/api/src/services/production-schedule/production-schedule-query.service.ts`
  - `apps/api/src/routes/kiosk/production-schedule/resources.ts`
  - `apps/web/src/pages/kiosk/ProductionSchedulePage.tsx`

## 除外資源CD Location整合化（site優先 + shared互換、2026-03-16 実装）

- **Context**:
  - 実機で `KUMITATE2` が除外されず、`resources` API でも `excluded=false` が返る事象を再確認。
  - DB設定は `location=shared` に存在する一方、キオスク参照は `deviceScopeKey -> siteKey(第2工場)` に解決され、site側設定行が無いとデフォルト除外（`10`,`MSZ`）へフォールバックしていた。
- **Fix**:
  - `resource-category-policy` を `siteKey` 優先参照 + `shared` フォールバックに拡張。
  - `production-schedule-settings` の ResourceCategory 保存を `siteKey` + `shared` 二重保存（Tx）へ変更し、移行期間の整合性を担保。
  - ResourceCategory 取得も `siteKey` 優先 + `shared` フォールバックに統一。
- **Verification**:
  - `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/borrow_return pnpm --filter @raspi-system/api exec prisma migrate deploy` 成功
  - `pnpm --filter @raspi-system/api test -- src/services/production-schedule/__tests__/resource-category-policy.service.test.ts src/services/production-schedule/__tests__/production-schedule-settings.service.test.ts src/routes/__tests__/kiosk-production-schedule.integration.test.ts` 成功（61 tests）
  - `pnpm --filter @raspi-system/api build` 成功
  - `pnpm --filter @raspi-system/api lint` 成功
  - テスト用コンテナは `pnpm test:postgres:stop` で削除済み
  - 実機はデプロイ後に [deploy-status-recovery.md](../runbooks/deploy-status-recovery.md) のチェックリスト（`resources` の `resourceItems.excluded` / `progress-overview` での非表示）で最終確認
- **Prevention**:
  - ResourceCategory の参照は policy 経由に限定し、呼び出し側で location 解決を重複実装しない。
  - `siteKey` 行未作成の既存環境でも `shared` 互換で動作を維持し、段階的に site 正規へ移行する。
- **デプロイ結果（2026-03-16）**:
  - Pi5: Run ID 20260316-174822-31959、state success。
  - raspi4-robodrill01: Run ID 20260316-175659-32118、state success。
  - raspberrypi4（研削メイン）: 初回はプリフライトで SSH 接続タイムアウト（UNREACHABLE）のため未デプロイ。接続復旧後に `--limit "raspberrypi4"` で再デプロイし**デプロイ済み**（3台完了）。
- **実機検証**: OK。Pi5・raspi4-robodrill01 にて KUMITATE2 が除外され進捗一覧に表示されないこと、`GET /api/kiosk/production-schedule/resources` の `resourceItems[].excluded` が期待どおりであることを確認。
- **トラブルシュート（Pi4 研削メインがデプロイ時に接続不可の場合）**:
  - 症状: `ssh: connect to host 100.74.144.79 port 22: Connection timed out`、プリフライトで raspberrypi4 が UNREACHABLE。
  - 確認: Pi5 上で `tailscale status` で raspberrypi4 の online/offline と IP を確認。電源・ネットワーク（Tailscale）の状態を確認。必要なら `group_vars/all.yml` の `tailscale_network.kiosk_ip`（または該当 Pi4 の `ansible_host`）が現状の Tailscale IP と一致しているか確認。
  - 復旧後: `./scripts/update-all-clients.sh feat/resource-exclusion-policy-sync infrastructure/ansible/inventory.yml --limit "raspberrypi4" --detach --follow` で再デプロイ。
- **References**:
  - `apps/api/src/services/production-schedule/policies/resource-category-policy.service.ts`
  - `apps/api/src/services/production-schedule/production-schedule-settings.service.ts`
  - `apps/api/src/services/production-schedule/__tests__/production-schedule-settings.service.test.ts`
  - `apps/api/src/routes/__tests__/kiosk-production-schedule.integration.test.ts`
  - [deployment.md](../guides/deployment.md)（1台ずつ順番デプロイ）
  - [deploy-status-recovery.md](../runbooks/deploy-status-recovery.md)（実機検証チェックリスト）

## 生産スケジュール 機種名・部品名検索（2026-03-17）

- **仕様（A条件）**:
  - 機種名で絞るには「機種名」＋「工程（研削/切削）」＋「資源CD」の3つを指定する（AND条件）。
  - API: `GET /api/kiosk/production-schedule?resourceCategory=grinding&resourceCds=305&machineName=サーボストッパ` 等で 200 かつ該当製番のみ返却。
  - UI: 生産スケジュール画面で機種名ドロップダウン→工程と資源CDを選択→検索で該当機種の製番・部品のみ表示。
- **正規化（全角/半角）**:
  - フロント: `useProductionScheduleQueryParams.ts` で API 送信時に `toHalfWidthAscii(selectedMachineName.trim()).toUpperCase()` で正規化。
  - API: `production-schedule-query.service.ts` で `normalizeMachineNameForCompare` を追加。機種行（MH/SH）を取得して Node 側で正規化比較し、一致する FSEIBAN で IN 条件を組み立てる。
- **トラブルシュート（機種名検索が効かない）**:
  - 症状: 機種名を指定しても結果が0件または期待と異なる。
  - 原因: 実機API検証で全角/半角の不一致が判明。CSV由来の機種名とUI入力の正規化が揃っていなかった。
  - 対策: 上記のフロント・API両方の正規化を導入して解消。
- **トラブルシュート（機種名・部品名ドロップダウンが空になる）**:
  - 症状: API で `machineName` 絞り込みをすると MH/SH 行が返らず、クライアントの「機種→製番」インデックスが空になり、全件除外されて一覧が空になる。
  - 原因: 機種名指定時はAPIが該当製番の行のみ返すため、機種名を持つMH/SH行が結果に含まれず、ドロップダウン用の機種一覧が構築できない。
  - 対策: `displayRowDerivation.ts` の `filterRowsByMachineAndPart` にオプション `skipMachineFilterIfNoIndexHit: true` を追加。インデックス未ヒット時は機種名の再絞り込みをスキップし、API が返した行をそのまま表示。`useProductionScheduleDerivedRows.ts` からそのオプションを渡す。
- **実機検証（2026-03-17）**:
  - API: `machineName` 付き・なしとも 200 で応答することを確認。実機では production-schedule データが 0 件のため、絞り込み結果件数はデータあり環境で別途確認。
  - Phase12 一括検証（`verify-phase12-real.sh`）は全24項目 PASS。
- **References**:
  - `apps/api/src/services/production-schedule/production-schedule-query.service.ts`（`normalizeMachineNameForCompare`）
  - `apps/web/src/features/kiosk/productionSchedule/useProductionScheduleQueryParams.ts`（`toHalfWidthAscii`）
  - `apps/web/src/features/kiosk/productionSchedule/displayRowDerivation.ts`（`skipMachineFilterIfNoIndexHit`）
  - [deploy-status-recovery.md](../runbooks/deploy-status-recovery.md)（生産スケジュール 機種名検索チェック項目）

## Location Scope Phase1（挙動不変の境界導入、2026-03-14）

- **背景**:
  - `location` が「業務ロケーション」「端末別設定キー」「shared参照キー」で混在し、機能追加時に誤適用リスクが高かった。
  - 既存挙動を壊さずに段階移行するため、先に境界のみ導入する必要があった。
- **実装**:
  - `apps/api/src/lib/location-scope-resolver.ts` を追加し、用途別 resolver を実装。
    - `resolveDeviceScopeKey`
    - `resolveSiteKey`
    - `resolveDeviceName`
    - `resolveInfraHost`
    - `resolveCredentialIdentity`
    - `resolveLocationScopeContext`
  - `apps/api/src/routes/kiosk/shared.ts` の `resolveLocationKey` は互換ラッパーとして維持（挙動不変）。
  - `apps/api/src/routes/kiosk/production-schedule/shared.ts` に用途別 resolver 依存を追加し、次フェーズで差し替え可能な境界を明示。
- **検証**:
  - resolver 単体テストを追加（`apps/api/src/lib/__tests__/location-scope-resolver.test.ts`）。
  - 既存 API 契約・既存データ互換を維持（DBスキーマ変更なし）。
- **成果**:
  - `location` の意味をコード上で分離できる足場を構築。
  - Phase2 以降で `device/site/shared` の個別移行が可能になった。

## Location Scope Phase2（siteスコープ正規化の段階移行、2026-03-15）

- **仕様決定**:
  - `ProductionScheduleResourceCategoryConfig` は site スコープを正規とする（ADR-20260315）。
  - `legacyLocationKey` / `deviceScopeKey` が入力された場合も内部で site に正規化して参照する。
- **実装**:
  - `resource-category-policy.service.ts`
    - `resolveResourceCategorySiteKey()` を追加し、`siteKey` 優先で解決。
    - `getResourceCategoryPolicy()` は `string | { siteKey, deviceScopeKey, legacyLocationKey }` を受け取り、互換維持で段階移行可能にした。
  - `production-schedule-settings.service.ts`
    - ResourceCategory 設定の read/write は `resolveSiteKeyFromScopeKey()` で site 正規化して保存・参照。
  - ルート層（段階移行）
    - `list.ts` / `progress-overview.ts` / `due-management-seiban.ts` で `resolveLocationScopeContext()` を利用し、`deviceScopeKey` を明示利用。
  - 管理画面文言
    - `ProductionScheduleSettingsPage` で「拠点共通設定(site)」と「端末別設定(device)」を明示し、誤設定を抑止。
- **検証**:
  - resolver/policy テスト追加:
    - `location-scope-resolver.test.ts`
    - `resource-category-policy.service.test.ts`
  - `@raspi-system/api` 対象テスト、api/web lint、api/web build を通過。
- **実機検証（2026-03-15）**:
  - デプロイ: `feat/location-scope-phase2-migration`、Pi5 → raspberrypi4 → raspi4-robodrill01 の順に1台ずつ実行。
  - リモート自動チェック: APIヘルス、deploy-status（両Pi4で `isMaintenance: false`）、キオスクAPI、納期管理API（triage/summary/global-rank/actual-hours/stats/progress-overview/proposal）、resource-categories（401認証必須）、サイネージAPI、backup.json、マイグレーション52件適用済み、Pi4/Pi3サービス稼働を確認。全項目合格。
- **トラブルシューティング**:
  - `due-management-query.service.ts` への追加置換は、編集ツールの一時エラー（`SQLITE_CORRUPT`）を回避するため、今回は互換レイヤー（policy側の内部正規化）で挙動を担保した。次回差分で同ファイルの明示引数化を継続する。

## Location Scope Phase3（scope契約統一 + Flag段階切替、2026-03-15）

- **仕様決定**:
  - `production-schedule` 系ルートは `resolveLocationScopeContext()` 経由を必須化し、サービス層へ `deviceScopeKey` を明示入力する。
  - `LOCATION_SCOPE_PHASE3_ENABLED` により、`legacyLocationKey` 優先経路と `deviceScopeKey` 優先経路を切替可能にする。
- **実装**:
  - `due-management-location-scope-adapter.service.ts` を追加し、`string` 入力と `scopeContext` 入力の互換アダプタを導入。
  - `due-management-summary` / `due-management-seiban` / `due-management-triage` / `due-management-global-rank` など主要ルートを scopeContext 経由へ統一。
  - `due-management-triage.service.ts` / `due-management-scoring.service.ts` / `due-management-learning-evaluator.service.ts` に `locationScope` 互換入力を追加。
  - 設定系: `env.ts` / `.env.example` / `docker.env.j2` / `inventory.yml` に `LOCATION_SCOPE_PHASE3_ENABLED`（`location_scope_phase3_enabled`）を追加。
- **検証**:
  - `pnpm --filter @raspi-system/api lint`: pass
  - `pnpm --filter @raspi-system/api build`: pass
  - `pnpm --filter @raspi-system/api test -- src/services/production-schedule/__tests__/due-management-location-scope-adapter.service.test.ts src/services/production-schedule/__tests__/due-management-triage.service.test.ts src/services/production-schedule/__tests__/due-management-scoring.service.test.ts src/services/production-schedule/__tests__/due-management-learning-evaluator.service.test.ts`: pass
  - `pnpm --filter @raspi-system/web lint`: pass
  - `pnpm --filter @raspi-system/web build`: pass
  - `./scripts/deploy/verify-services-real.sh`: pass（Pi3 `signage-lite.service`/`signage-lite-update.timer` active、Pi4 `kiosk-browser.service` active）
- **既知事項**:
  - フル `pnpm --filter @raspi-system/api test` はローカルDB (`localhost:5432`) 非起動により backup系テストで失敗するため、実機検証前にDB起動状態で再実施が必要。

- **実機検証（2026-03-15）**:
  - **デプロイ**: `feat/location-scope-phase3-completion`、Pi5 → raspberrypi4 → raspi4-robodrill01 の順に1台ずつ実行（Run ID `20260315-123857-22423` / `20260315-124840-2507` / `20260315-125820-7779`）、約45分、Pi3除外。
  - **リモート自動チェック**: APIヘルス（status: ok）、deploy-status（両Pi4で `isMaintenance: false`）、キオスクAPI（loans/active 200）、納期管理API（triage/daily-plan/global-rank/proposal/learning-report/actual-hours/stats/summary すべて200）、サイネージAPI（layoutConfig 含む）、backup.json（15KB）、マイグレーション52件適用済み、Pi4×2サービス（kiosk-browser/status-agent.timer ともに active）を確認。全項目合格。
  - **Feature Flag**: `location_scope_phase3_enabled` は 2026-03-15 に `true` へ切替済み（`feat/location-scope-phase3-enable`）。
  - **参照**: [deploy-status-recovery.md](../runbooks/deploy-status-recovery.md) の実機検証チェックリスト

- **Phase3有効化デプロイ（2026-03-15）**:
  - **ブランチ**: `feat/location-scope-phase3-enable`
  - **変更**: `infrastructure/ansible/inventory.yml` の `location_scope_phase3_enabled` を `"true"` に変更
  - **デプロイ**: Pi5 → raspberrypi4 → raspi4-robodrill01 の順に1台ずつ実行（Run ID `20260315-134146-15083` / `20260315-134456-14921` / `20260315-135231-9809`）
  - **実機検証**: APIヘルス（`status: ok`）、deploy-status（両Pi4で `isMaintenance: false`）、キオスクAPI（`/api/tools/loans/active` 200）、納期管理API（triage/daily-plan/global-rank/proposal/learning-report/actual-hours/stats/summary すべて200）、global-rank の `targetLocation` / `actorLocation` / `rankingScope`、actual-hours/stats の `totalRawRows` / `totalCanonicalRows` / `totalFeatureKeys` / `topFeatures`、サイネージAPI（`layoutConfig` あり）、backup.json（14522 bytes）、マイグレーション52件 up to date、`LOCATION_SCOPE_PHASE3_ENABLED=true`（APIコンテナ）、両Pi4サービス（`kiosk-browser.service` / `status-agent.timer`）active を確認。

## Location Scope Phase4（due-management限定: scope契約明示 + legacy依存縮小、2026-03-15）

- **背景**:
  - Phase3有効化後、due-management 内では `locationKey` 直渡しと `locationScope` 入力が混在していた。
  - 破壊的変更を避けるため、DB契約は維持したまま「ルート境界でscope化 → サービス層でstorage解決」に統一した。
- **実装**:
  - `due-management-location-scope-adapter.service.ts` に `DueManagementScope` と `toDueManagementScope` / `toDueManagementScopeFromContext` を追加。
  - `due-management-global-rank` ルートで scope 変換を明示し、`auto-generate` / `proposal` / `learning-report` / `explanation` の呼び出しを scope入力へ統一。
  - `due-management-triage.service.ts` / `due-management-scoring.service.ts` / `due-management-learning-evaluator.service.ts` / `due-management-global-rank-auto.service.ts` を scope契約優先に更新。
  - `due-management-summary.ts` / `due-management-seiban.ts` / `due-management-triage.ts` のルート境界で `toDueManagementScopeFromContext` を適用。
  - auto-tuning オーケストレータと学習レポートテストを新契約に追随。
- **検証**:
  - `pnpm --filter @raspi-system/api lint`: pass
  - `pnpm --filter @raspi-system/api test -- src/services/production-schedule/__tests__/due-management-location-scope-adapter.service.test.ts src/services/production-schedule/__tests__/due-management-triage.service.test.ts src/services/production-schedule/__tests__/due-management-scoring.service.test.ts src/services/production-schedule/__tests__/due-management-learning-evaluator.service.test.ts`: pass
  - `pnpm --filter @raspi-system/api build`: pass
  - `pnpm --filter @raspi-system/web lint`: pass
  - `pnpm --filter @raspi-system/web build`: pass
- **デプロイ**:
  - ブランチ: `feat/location-scope-phase4-due-mgmt-legacy-retire`
  - Pi5 → raspberrypi4 → raspi4-robodrill01 の順に1台ずつ実行（Run ID `20260315-142550-21730` / `20260315-143257-13000` / `20260315-144526-7518`）
- **実機検証**:
  - APIヘルス（`status: ok`）
  - deploy-status（両Pi4で `isMaintenance: false`）
  - キオスクAPI（`/api/tools/loans/active` 200）
  - 納期管理API（triage/daily-plan/global-rank/proposal/learning-report/actual-hours/stats/summary/seiban すべて200）
  - global-rank の `targetLocation` / `actorLocation` / `rankingScope` 返却
  - actual-hours/stats の `totalRawRows` / `totalCanonicalRows` / `totalFeatureKeys` / `topFeatures` 返却
  - サイネージAPI（`/api/signage/content` 200、`layoutConfig` あり）
  - backup.json（14522 bytes）
  - マイグレーション（52件、up to date）
  - `LOCATION_SCOPE_PHASE3_ENABLED=true`（APIコンテナ）
  - Pi3/Pi4サービス（signage-lite / kiosk-browser / status-agent.timer）active


## Location Scope Phase5（due-management内の残存legacy配線整理、2026-03-15）

- **背景**:
  - Phase4 で scope 契約は導入済みだが、due-management の一部ルートに `deviceScopeKey` 直取りと未使用 legacy 注入配線が残っていた。
  - 破壊的変更を避けるため、互換解決は adapter に集約したまま、ルート境界の解決方式を統一した。
- **実装**:
  - `due-management-due-date.ts` / `due-management-note.ts` / `due-management-part-priorities.ts` / `due-management-processing.ts` / `due-management-processing-due-date.ts` / `due-management-actual-hours.ts` / `due-management-triage.ts` で `toDueManagementScopeFromContext()` + `resolveDueManagementStorageLocationKey()` を適用。
  - `KioskRouteDeps`（production-schedule shared）から未使用の `resolveLocationKey` 契約を削除。
  - `kiosk.ts` の production-schedule deps 注入から未使用 `resolveLocationKey` を削除。
- **検証**:
  - `pnpm --filter @raspi-system/api lint`: pass
  - `pnpm --filter @raspi-system/api test -- src/services/production-schedule/__tests__/due-management-location-scope-adapter.service.test.ts src/services/production-schedule/__tests__/due-management-triage.service.test.ts src/services/production-schedule/__tests__/due-management-scoring.service.test.ts src/services/production-schedule/__tests__/due-management-learning-evaluator.service.test.ts`: pass
  - `pnpm --filter @raspi-system/api build`: pass
  - `pnpm --filter @raspi-system/web lint`: pass
  - `pnpm --filter @raspi-system/web build`: pass
- **デプロイ**:
  - ブランチ: `feat/location-scope-phase5-due-mgmt-legacy-wire-cleanup`
  - Pi5 → raspberrypi4 → raspi4-robodrill01 の順に1台ずつ実行（Run ID `20260315-150720-6176` / `20260315-151510-9116` / `20260315-152306-24125`）
- **実機検証**:
  - APIヘルス（`status: degraded`、memory 使用率 95.7% の既知警告）
  - deploy-status（両Pi4で `isMaintenance: false`）
  - キオスクAPI（`/api/tools/loans/active` 200）
  - 納期管理API（triage/daily-plan/global-rank/proposal/learning-report/actual-hours/stats/summary/seiban すべて200）
  - global-rank の `targetLocation` / `actorLocation` / `rankingScope` 返却
  - actual-hours/stats の `totalRawRows` / `totalCanonicalRows` / `totalFeatureKeys` / `topFeatures` 返却
  - サイネージAPI（`/api/signage/content` 200、`layoutConfig` あり）
  - backup.json（14522 bytes）
  - マイグレーション（52件、up to date）
  - `LOCATION_SCOPE_PHASE3_ENABLED=true`（APIコンテナ）
  - Pi3/Pi4サービス（signage-lite / kiosk-browser / status-agent.timer）active

## Location Scope Phase10（compat内部限定化、2026-03-15）

- **背景**:
  - Phase9 で `kiosk/shared.ts` 側の互換公開整理は完了したが、`location-scope-resolver.ts` には互換コンテキストを返す公開シンボルが残っていた。
  - 公開境界を標準契約（`StandardLocationScopeContext`）へ固定し、互換情報を内部実装へ閉じ込める必要があった。
- **実装**:
  - `apps/api/src/lib/location-scope-resolver.ts`
    - `CompatLocationScopeContext` を非公開型へ変更（module内部限定）。
    - `resolveCompatLocationScopeContext()` を非公開関数へ変更し、互換解決を内部ヘルパー化。
    - `resolveStandardLocationScopeContext()` を追加し、標準契約の解決責務を分離。
    - 公開API `resolveLocationScopeContext()` は標準契約のみ返却し、`legacyLocationKey` を外部へ露出しない設計を維持。
  - `apps/api/src/lib/__tests__/location-scope-resolver.test.ts`
    - 互換公開関数の直接テストを削除。
    - 標準コンテキストに `legacyLocationKey` が含まれないことを検証する回帰テストへ更新。
- **検証**:
  - `pnpm --filter @raspi-system/api lint`: pass
  - `pnpm --filter @raspi-system/api test -- src/lib/__tests__/location-scope-resolver.test.ts src/services/production-schedule/__tests__/resource-category-policy.service.test.ts src/services/production-schedule/__tests__/due-management-location-scope-adapter.service.test.ts src/services/production-schedule/__tests__/due-management-triage.service.test.ts src/services/production-schedule/__tests__/due-management-scoring.service.test.ts src/services/production-schedule/__tests__/due-management-learning-evaluator.service.test.ts`: pass
  - `pnpm --filter @raspi-system/api build`: pass
  - `pnpm --filter @raspi-system/web lint`: pass
  - `pnpm --filter @raspi-system/web build`: pass
- **デプロイ（2026-03-15）**:
  - 対象: Pi5 + Pi4×2（raspberrypi4 / raspi4-robodrill01）。Pi3は影響なしのため対象外。
  - 手順: `scripts/update-all-clients.sh` で1台ずつ順番に実行（`--limit`）。
  - Run ID: `20260315-202628-23734`（Pi5）/ `20260315-203512-15802`（raspberrypi4）/ `20260315-204257-10897`（raspi4-robodrill01）
  - 所要時間: Pi5 約6分、raspberrypi4 約5分、raspi4-robodrill01 約5分
- **実機検証（2026-03-15）**:
  - リモート自動チェック全項目合格（APIヘルス degraded/memory 96%、deploy-status両Pi4、キオスクAPI、納期管理API群、global-rank targetLocation/rankingScope、Mac向け targetLocation 指定、actual-hours/stats、サイネージAPI、backup.json 15KB、マイグレーション52件、Pi3 signage-lite、Pi4×2 kiosk-browser/status-agent active）
- **知見**:
  - 互換ロジックを削除せず内部化する場合、公開関数を標準契約へ固定しつつ内部ヘルパーへ委譲する構成にすると、互換性を維持しながら責務分離（SRP）を進めやすい。
  - `kiosk/shared.ts` から互換再公開を行わない方針を継続することで、呼び出し側依存を標準契約へ収束できる。
  - デプロイ対象が複数台の場合は1台ずつ順番に実行する運用が安定（deployment.md の「1台ずつ順番デプロイ」を参照）。

## Location Scope 安全実装フォローアップ（Phase0-4、2026-03-15）

- **目的**:
  - Phase10 完了後の追加リファクタを「破壊なし」で進めるため、用語固定・境界単一化・移行監視を先行で整備する。
- **実装**:
  - `kiosk/production-schedule` 依存注入は `resolveLocationScopeContext` を単一入口として扱い、未使用の resolver 依存を削減。
  - `due-management-query.service.ts` の `getResourceCategoryPolicy()` 呼び出しを文字列直渡しから scope 形式（`{ deviceScopeKey }`）へ変更。
  - `resource-category-policy.service.ts` に `resolveResourceCategorySiteResolution()` を追加し、`siteKey` 解決経路（`siteKey` / `deviceScopeKey` / `default`）を返却可能化。
  - `siteKey` も `deviceScopeKey` も解決できない場合のみ `Resource category policy resolved via default fallback` を warning ログ出力し、例外検知として監視可能化。
- **運用**:
  - `deploy-status-recovery.md` のチェックリストに fallback 監視コマンドを追加し、`default fallback` 警告の増加を検知できるようにした。
- **意思決定（Phase4）**:
  - `ClientDevice.location` の即時廃止は見送り（No-Go）。
  - 既存互換を維持しつつ、resolver境界 + 監視で段階移行を継続する方針を採用。
  - 詳細は `ADR-20260315-location-scope-phase4-db-go-no-go.md` を参照。
- **デプロイ（2026-03-15）**:
  - ブランチ: `refactor/location-scope-safe-rollout-phase0-4`
  - 対象: Pi5 + Pi4×2（raspberrypi4 / raspi4-robodrill01）。Pi3は影響なしのため対象外。
  - 手順: `scripts/update-all-clients.sh` で1台ずつ順番に実行（`--limit`）。
  - Run ID: `20260315-212002-22974`（Pi5）/ `20260315-212725-14571`（raspberrypi4）/ `20260315-213409-8036`（raspi4-robodrill01）
- **実機検証（2026-03-15）**:
  - リモート自動チェック全項目合格（APIヘルス ok、deploy-status両Pi4 false、キオスクAPI・納期管理API群 200、global-rank targetLocation/rankingScope、Mac向け targetLocation 指定、actual-hours/stats、location scope fallback該当ログなし、サイネージAPI、backup.json 15K、マイグレーション52件、Pi3 signage + Pi4×2 kiosk/status-agent active、`verify-services-real.sh` 合格）
- **知見**:
  - Pi5に`rg`（ripgrep）は未導入のため、fallback 監視コマンドは`grep`を使用する（deploy-status-recovery.md に追記済み）

## Location Scope Phase11（完全収束、2026-03-15）

- **背景**:
  - Phase0-4 で境界整理と監視導入は完了したが、`resource-category-policy` と `due-management` の入力契約に `string` 互換が残り、境界契約が広い状態だった。
  - resolver も標準契約を返しつつ内部で compat コンテキスト経由になっており、責務が不必要に分散していた。
- **実装**:
  - `apps/api/src/services/production-schedule/policies/resource-category-policy.service.ts`
    - `getResourceCategoryPolicy()` / `resolveResourceCategorySiteResolution()` の入力を `ResourceCategoryPolicyScope` に固定（`string` 互換を排除）。
    - fallback ログを `default` のみで出力する仕様へ変更（warning）。
  - `apps/api/src/services/production-schedule/due-management-location-scope-adapter.service.ts`
    - `DueManagementLocationScopeInput` をオブジェクト契約（`deviceScopeKey` / `siteKey`）へ固定。
  - `apps/api/src/lib/location-scope-resolver.ts`
    - `resolveLocationScopeContext()` を compat 非依存の標準解決へ単純化。
  - `apps/api/src/routes/kiosk/production-schedule/shared.ts`
    - ルート依存の `ClientDeviceForScopeResolution` / `LocationScopeContext` を重複定義せず、`kiosk/shared` の型を利用する構成へ統一。
  - `apps/api/src/routes/kiosk/production-schedule/due-management-global-rank.ts`
    - `toDueManagementScopeFromContext()` 優先の呼び出しへ統一。
- **検証**:
  - `pnpm --filter @raspi-system/api lint`: pass
  - `pnpm --filter @raspi-system/api test -- src/lib/__tests__/location-scope-resolver.test.ts src/services/production-schedule/__tests__/resource-category-policy.service.test.ts src/services/production-schedule/__tests__/due-management-location-scope-adapter.service.test.ts src/services/production-schedule/__tests__/due-management-triage.service.test.ts src/services/production-schedule/__tests__/due-management-scoring.service.test.ts src/services/production-schedule/__tests__/due-management-learning-evaluator.service.test.ts`: pass
  - `pnpm --filter @raspi-system/api build`: pass
  - `pnpm --filter @raspi-system/web lint`: pass
  - `pnpm --filter @raspi-system/web build`: pass
- **デプロイ（2026-03-15）**:
  - 対象: Pi5 + Pi4×2（raspberrypi4 / raspi4-robodrill01）。Pi3は影響なしのため対象外。
  - 手順: `scripts/update-all-clients.sh` で1台ずつ順番に実行（`--limit`）。
  - Run ID: `20260315-223311-18659`（Pi5）/ `20260315-224040-6371`（raspberrypi4）/ `20260315-224829-13694`（raspi4-robodrill01）
- **実機検証（2026-03-15）**:
  - リモート自動チェック全項目合格（APIヘルス ok、deploy-status両Pi4 false、キオスクAPI・納期管理API群 200、global-rank targetLocation/rankingScope、Mac向け targetLocation 指定、actual-hours/stats、location scope fallback該当ログなし、サイネージAPI、backup.json 15K、マイグレーション52件、Pi3 signage + Pi4×2 kiosk/status-agent active、`verify-services-real.sh` 合格、PUT auto-generate 200）。
  - 監視コマンドは `default fallback` 警告ログを対象に更新（Pi5に`rg`は未導入のため`grep`を使用）。
- **知見**:
  - 互換入力を段階縮退する場合、**公開関数の入力契約を先に固定**し、互換は private ヘルパーへ閉じ込めると回帰範囲を限定しやすい。
  - Due management auto-tuning scheduler ログ（`Due management auto-tuning scheduler started`）は API 起動後ローテーションでコンテナログから見つからない場合がある。PUT auto-generate が 200 を返せば機能は正常と判断可能。
- **参照**: [deploy-status-recovery.md](../runbooks/deploy-status-recovery.md)

## Location Scope Phase12（完全体化、2026-03-16）

- **背景**:
  - Phase11 で契約収束は完了したが、運用面（再現検証、命名規約、横展開監査、UI最終確認記録）が分散していた。
- **実装**:
  - `scripts/deploy/verify-phase12-real.sh` を追加し、実機検証の主要API・fallback監視・`PUT /global-rank/auto-generate`・Pi3/Pi4サービス確認を1コマンド化。
  - `docs/guides/location-scope-naming.md` を新設し、`siteKey` / `deviceScopeKey` / `infraHost` の命名規約を固定。
  - `docs/plans/location-scope-phase12-cross-module-audit.md` を追加し、`production-schedule` ルート境界の命名監査結果を記録。
  - `apps/api/src/routes/kiosk/production-schedule/*.ts` のローカル変数命名を `locationKey` から `deviceScopeKey` 明示へ統一（サービス契約は不変）。
- **検証**:
  - `./scripts/deploy/verify-phase12-real.sh`: PASS 23 / WARN 1 / FAIL 0
  - WARN内容: `Due management auto-tuning scheduler started` ログは0件（ログローテーション想定）。`PUT /global-rank/auto-generate` 200 を代替正常判定として記録。
- **UI最終確認（手動項目）**:
  - 本作業ではリモート自動検証のみ実施。以下のUI手動項目は **現地実機での最終確認待ち** として記録:
    - 納期管理新UI（V2）
    - 納期管理UI Phase1/Phase2/Phase3
    - 左ペイン中規模改善（対象化/対象中導線）
    - 左ペイン3セクション色分け
    - 表面処理別納期の最終オペレーション確認
  - 手順は `deploy-status-recovery.md` セクション3に統一。
- **知見**:
  - 手動UI検証を除く運用検証は `verify-phase12-real.sh` で再現可能になった。
  - 境界変数名は `deviceScopeKey` / `siteKey` を使い、`locationKey` は既存サービス契約への橋渡し時のみ使用する方針が有効。

## Location Scope Phase13（安全リファクタ、2026-03-16）

- **背景**:
  - Phase12 のフォローアップとして、互換橋渡しを境界に集約し、`locationKey` 文字列再解釈の再発を防止する必要があった。
- **実装**:
  - `location-scope-resolver.ts`: 境界型（`SiteKey` / `DeviceScopeKey` / `DeviceName` / `InfraHost`）を明示化。`resolveStandardLocationScopeContext` で `asSiteKey` / `asDeviceName` によるブランド型キャストを追加。
  - `production-schedule/shared.ts`: `toLegacyLocationKeyFromDeviceScope()` を追加し、ルート境界で橋渡しを集約。
  - `production-schedule/*.ts`: 各ルートで `toLegacyLocationKeyFromDeviceScope(deviceScopeKey)` 経由に統一。
  - `shared.test.ts`: dedup と bridge ヘルパーの回帰テストを追加。
  - resource-category / due-management / ranking-scope にスコープ（site/device）のコメント・型を追加。
- **検証**:
  - CI: 初回は `resolveStandardLocationScopeContext` の `string` → ブランド型代入で型エラー。`asSiteKey` / `asDeviceName` で修正後 success。
  - デプロイ: Pi5 → raspberrypi4 → raspi4-robodrill01 の順に1台ずつ実行（Run ID `20260316-113951-26071` / `20260316-114704-25137` / `20260316-115552-26872`）。
- **実機検証**:
  - `verify-phase12-real.sh` は先頭の `ping` 判定で「Pi5に到達できません」と停止（ICMP ブロック環境）。runbook の curl/ssh 項目を手動実行して代替検証。
  - APIヘルス ok、deploy-status 両Pi4 false、キオスクAPI・納期管理API群 200、global-rank/actual-hours/stats、fallback 0件、PUT auto-generate 200、Pi3/Pi4 サービス active。
- **トラブルシューティング**: [KB-302](./ci-cd.md#kb-302-location-scope-resolverのブランド型ciビルド失敗とverify-phase12-realのping失敗)

## Location Scope Phase9（compat呼び出し棚卸し・公開面縮小、2026-03-15）

- **背景**:
  - Phase8 で標準契約と互換契約の分離は完了したが、`kiosk/shared.ts` には未使用の互換公開面（`resolveLocationKey` / `resolveCompatLocationScopeContext`）が残っていた。
  - `csv-import-execution.service.ts` には別責務の同名関数 `resolveLocationKey` があり、保守時に誤読しやすい状態だった。
- **実装**:
  - `apps/api/src/routes/kiosk/shared.ts`
    - 未使用の互換公開 `resolveLocationKey` / `resolveCompatLocationScopeContext` を削除。
    - `CompatLocationScopeContext` の再エクスポートを削除し、標準契約中心の公開面へ整理。
  - `apps/api/src/services/imports/csv-import-execution.service.ts`
    - ローカル関数 `resolveLocationKey` を `resolveImportMetadataLocationKey` へ改名（機能変更なし）。
- **検証**:
  - `pnpm --filter @raspi-system/api lint`: pass
  - `pnpm --filter @raspi-system/api test -- src/lib/__tests__/location-scope-resolver.test.ts src/services/production-schedule/__tests__/resource-category-policy.service.test.ts src/services/production-schedule/__tests__/due-management-location-scope-adapter.service.test.ts src/services/production-schedule/__tests__/due-management-triage.service.test.ts src/services/production-schedule/__tests__/due-management-scoring.service.test.ts src/services/production-schedule/__tests__/due-management-learning-evaluator.service.test.ts`: pass
  - `pnpm --filter @raspi-system/api build`: pass
  - `pnpm --filter @raspi-system/web lint`: pass
  - `pnpm --filter @raspi-system/web build`: pass
- **受け入れ確認（Runbookチェック）**:
  - APIヘルス（`status: degraded`、memory 95.4% の既知警告）
  - deploy-status（raspberrypi4 / raspi4-robodrill01 ともに `isMaintenance:false`）
  - 納期管理API（triage / daily-plan / global-rank / proposal / learning-report / actual-hours/stats 200）
  - Mac向けシナリオ確認: `global-rank?targetLocation=%E7%AC%AC2%E5%B7%A5%E5%A0%B4&rankingScope=globalShared` で応答整合
  - サイネージAPI（`/api/signage/content` 200、`layoutConfig` あり）
  - backup.json（15KB）存在、マイグレーション（52件、up to date）
  - Pi3/Pi4サービス確認（`verify-services-real.sh` + 個別systemctl で active）
- **デプロイ（2026-03-15）**:
  - 対象: Pi5 + Pi4×2（raspberrypi4 / raspi4-robodrill01）。Pi3は影響なしのため対象外。
  - 手順: `scripts/update-all-clients.sh` で1台ずつ順番に実行（`--limit`）。
  - Run ID: `20260315-184658-22375`（Pi5）/ `20260315-185604-21505`（raspberrypi4）/ `20260315-190338-11172`（raspi4-robodrill01）
  - 所要時間: Pi5 約7分、raspberrypi4 約6分、raspi4-robodrill01 約5分
- **実機検証（2026-03-15）**:
  - チェックリスト全14項目合格（APIヘルス、deploy-status両Pi4、キオスクAPI、納期管理API群、global-rank targetLocation/rankingScope、Mac向け targetLocation 指定、actual-hours/stats、サイネージAPI、backup.json、マイグレーション、Pi3 signage-lite、Pi4×2 kiosk-browser/status-agent active）
- **知見**:
  - デプロイ対象が複数台の場合は1台ずつ順番に実行する運用が安定（deployment.md の「1台ずつ順番デプロイ」を参照）
  - 実機検証は `docs/runbooks/deploy-status-recovery.md` のチェックリストに従い、API・サービス・マイグレーションを網羅的に確認する

## Location Scope Phase8（resolver互換境界の明示化、2026-03-15）

- **背景**:
  - Phase7 で `production-schedule` 境界の契約整理は完了したが、基盤側 resolver には `legacyLocationKey` を含む公開型が残っていた。
  - ルート/サービスを標準契約へ依存させつつ、互換情報は専用レイヤーへ閉じ込める必要があった。
- **実装**:
  - `apps/api/src/lib/location-scope-resolver.ts`
    - `StandardLocationScopeContext`（標準契約）と `CompatLocationScopeContext`（互換契約）を追加。
    - `resolveLocationScopeContext()` は標準契約（`deviceScopeKey/siteKey/deviceName/infraHost/credentialIdentity`）のみ返却するよう変更。
    - `resolveCompatLocationScopeContext()` を新設し、`legacyLocationKey` は互換契約側でのみ返却。
  - `apps/api/src/routes/kiosk/shared.ts`
    - 標準契約の既定公開を維持しつつ、互換関数 `resolveCompatLocationScopeContext()` を明示公開。
  - `apps/api/src/lib/__tests__/location-scope-resolver.test.ts`
    - 標準契約テストへ更新し、互換契約テストを追加。
- **検証**:
  - `pnpm --filter @raspi-system/api lint`: pass
  - `pnpm --filter @raspi-system/api test -- src/lib/__tests__/location-scope-resolver.test.ts src/services/production-schedule/__tests__/resource-category-policy.service.test.ts src/services/production-schedule/__tests__/due-management-location-scope-adapter.service.test.ts src/services/production-schedule/__tests__/due-management-triage.service.test.ts src/services/production-schedule/__tests__/due-management-scoring.service.test.ts src/services/production-schedule/__tests__/due-management-learning-evaluator.service.test.ts`: pass
  - `pnpm --filter @raspi-system/api build`: pass
  - `pnpm --filter @raspi-system/web lint`: pass
  - `pnpm --filter @raspi-system/web build`: pass
- **デプロイ**:
  - ブランチ: `feat/location-scope-phase8-resolver-compat-boundary`
  - Pi5 → raspberrypi4 → raspi4-robodrill01 の順に1台ずつ実行（Run ID `20260315-175908-9572` / `20260315-180808-10083` / `20260315-181456-29949`）
- **実機検証**:
  - APIヘルス（`status: ok`、memory warning 94.7%）
  - deploy-status（raspberrypi4 / raspi4-robodrill01 ともに `isMaintenance:false`）
  - 納期管理API（triage / daily-plan / global-rank / proposal / learning-report / actual-hours/stats 200）
  - Mac向けシナリオ確認: `global-rank?targetLocation=第2工場&rankingScope=globalShared` は **URLエンコード付き** クエリで `targetLocation` / `actorLocation` / `rankingScope` 応答を確認
  - サイネージAPI（`/api/signage/content` 200、`layoutConfig` あり）
  - Pi3/Pi4サービス確認（`verify-services-real.sh` + 個別systemctl で active）
  - マイグレーション（52件、up to date）
- **トラブルシューティング**:
  - ターミナルで日本語クエリ文字列を未エンコードのまま `curl` すると 400 になるケースがある。  
    `targetLocation=%E7%AC%AC2%E5%B7%A5%E5%A0%B4` のようにURLエンコードして実行する。

## Location Scope Phase7（production-schedule境界のscope契約整理、2026-03-15）

- **背景**:
  - Phase6 で due-management adapter の legacy補助経路は整理できたが、`production-schedule` 境界には `legacyLocationKey` を含む型互換が一部残っていた。
  - 次段として、API境界の契約を `deviceScopeKey` / `siteKey` 中心へ寄せ、Mac/Pi3 を含む受け入れ条件で回帰確認する。
- **実装**:
  - `apps/api/src/routes/kiosk/production-schedule/shared.ts`
    - `LocationScopeContext` から `legacyLocationKey` を除外し、`production-schedule` ルート契約を `deviceScopeKey/siteKey` 中心へ整理。
  - `apps/api/src/services/production-schedule/policies/resource-category-policy.service.ts`
    - `ResourceCategoryPolicyScope` から `legacyLocationKey` を削除。
    - `resolveResourceCategorySiteKey()` の legacy fallback 分岐を削除し、`siteKey -> deviceScopeKey -> default` の順へ明確化。
- **検証**:
  - `pnpm --filter @raspi-system/api lint`: pass
  - `pnpm --filter @raspi-system/api test -- src/services/production-schedule/__tests__/resource-category-policy.service.test.ts src/services/production-schedule/__tests__/due-management-location-scope-adapter.service.test.ts src/services/production-schedule/__tests__/due-management-triage.service.test.ts src/services/production-schedule/__tests__/due-management-scoring.service.test.ts src/services/production-schedule/__tests__/due-management-learning-evaluator.service.test.ts`: pass
  - `pnpm --filter @raspi-system/api build`: pass
  - `pnpm --filter @raspi-system/web lint`: pass
  - `pnpm --filter @raspi-system/web build`: pass
- **デプロイ**:
  - ブランチ: `feat/location-scope-phase7-api-scope-harmonize`
  - Pi5 → raspberrypi4 → raspi4-robodrill01 の順に1台ずつ実行（Run ID `20260315-172516-21463` / `20260315-173234-4410` / `20260315-173936-23557`）
- **実機検証**:
  - APIヘルス（`status: ok`、memory warning 92.8%）
  - deploy-status（raspberrypi4 / raspi4-robodrill01 ともに `isMaintenance:false`）
  - 納期管理API（summary/triage/global-rank 200）
  - Mac向けシナリオ確認: `global-rank?targetLocation=第2工場&rankingScope=globalShared` で `targetLocation` / `actorLocation` / `rankingScope` 返却
  - サイネージAPI（`/api/signage/content` 200、`layoutConfig` あり）
  - `verify-services-real.sh` で Pi3 signage-lite/service timer と Pi4 kiosk-browser を確認（active）
  - マイグレーション（52件、up to date）
  - APIコンテナ環境変数: `LOCATION_SCOPE_PHASE3_ENABLED=UNSET`
- **トラブルシューティング**:
  - Pi5ホスト上で `apps/api` 直下から `pnpm prisma migrate status` を実行すると `db:5432` 到達不可（`P1001`）になる。  
    実機検証では `docker compose ... exec -T api pnpm prisma migrate status` を使う。

## Location Scope Phase6（adapter内legacy補助経路廃止、2026-03-15）

- **背景**:
  - Phase5 時点で due-management のルート境界統一は完了したが、adapter 内には `legacyLocationKey` 補助経路と `LOCATION_SCOPE_PHASE3_ENABLED` 分岐が残っていた。
  - Phase3/4/5 の実機運用で `deviceScopeKey` 経路が安定したため、互換のためだけに残していた分岐を段階廃止した。
- **実装**:
  - `due-management-location-scope-adapter.service.ts`
    - `DueManagementLocationScopeInput` / `DueManagementScopeContextInput` / `ResolvedDueManagementLocationScope` から `legacyLocationKey` を削除。
    - `resolveDueManagementStorageLocationKey()` を `deviceScopeKey` 固定返却へ変更。
    - `isLocationScopePhase3Enabled()` を削除し、フラグ依存を除去。
  - `due-management-location-scope-adapter.service.test.ts`
    - 期待値を新契約（device/siteのみ）へ更新。
    - Phase3フラグON/OFF分岐テストを削除し、「常にdeviceScopeKeyを使う」テストへ集約。
  - 設定配線整理:
    - `env.ts` / `.env.example` / `docker.env.j2` / `inventory.yml` から `LOCATION_SCOPE_PHASE3_ENABLED`（`location_scope_phase3_enabled`）を削除。
- **検証**:
  - `pnpm --filter @raspi-system/api lint`: pass
  - `pnpm --filter @raspi-system/api test -- src/services/production-schedule/__tests__/due-management-location-scope-adapter.service.test.ts src/services/production-schedule/__tests__/due-management-triage.service.test.ts src/services/production-schedule/__tests__/due-management-scoring.service.test.ts src/services/production-schedule/__tests__/due-management-learning-evaluator.service.test.ts`: pass
  - `pnpm --filter @raspi-system/api build`: pass
  - `pnpm --filter @raspi-system/web lint`: pass
  - `pnpm --filter @raspi-system/web build`: pass
  - 補足: フル `pnpm --filter @raspi-system/api test` はローカルDB未起動時に backup系テストで失敗（既知）
- **デプロイ**:
  - ブランチ: `feat/location-scope-phase6-adapter-legacy-retire`
  - Pi5 → raspberrypi4 → raspi4-robodrill01 の順に1台ずつ実行（Run ID `20260315-164754-9966` / `20260315-165800-14681` / `20260315-170453-7369`）
- **実機検証**:
  - APIヘルス（`status: ok`、memory warning 87.7%）
  - deploy-status（`isMaintenance: false`）
  - 納期管理API（summary/triage 200）
  - サイネージAPI（`/api/signage/content` 200）
  - backup.json（14522 bytes）
  - マイグレーション（52件、up to date）
  - Pi4サービス（`kiosk-browser.service` / `status-agent.timer` active）
  - APIコンテナ環境変数: `ACTUAL_HOURS_SHARED_FALLBACK_ENABLED=true` / `LOCATION_SCOPE_PHASE3_ENABLED=UNSET`


## 進捗一覧復活（2026-03-15）

- **背景**: Location Scope Phase1 と同一ブランチ（`refactor/location-scope-boundary-phase1`）で、`feat/kiosk-progress-overview` の進捗一覧を最小差分で復元した。
- **復元元**: `feat/kiosk-progress-overview` の最新コミット `b5f5a57c`（4列化・除外CD反映・ホバー・納期色分けを含む）。
- **実装**:
  - API: `GET /api/kiosk/production-schedule/progress-overview`、`ProgressOverviewQueryService`（切削除外適用後、有効資源CDを持たない部品を非表示、製番カード内を納期昇順ソート）
  - Web: `ProductionScheduleProgressOverviewPage`（4列レイアウト xl以上、資源CDホバー resourceNames、納期超過時は日付赤字・ラベル黄色）
  - キオスクヘッダーに「進捗一覧」リンクを追加
- **デプロイ**: Pi5 → raspberrypi4 → raspi4-robodrill01 の順に1台ずつ実行（Run ID `20260315-101803-4865` / `20260315-102542-16017` / `20260315-103331-6156`）、約20分。
- **実機検証**: APIヘルス、deploy-status（両Pi4で `isMaintenance: false`）、キオスクヘッダーから進捗一覧画面への遷移・表示を確認。
- **トラブルシューティング**:
  - **Docker 再起動後**: Cursor サンドボックス経由で `pnpm test:api` 実行時に Docker ソケット EOF が発生することがある。Mac 上で Docker を再起動後、ターミナルから直接実行すれば正常に動作する。
  - **postgres-test-local 競合**: 既存コンテナが残っている場合は `docker rm -f postgres-test-local` で削除してから再実行。

## 進捗一覧製番フィルタ（2026-03-18）

- **背景**: 進捗一覧で製番単位の表示/非表示を切り替えられるよう、製番フィルタドロップダウンを追加。
- **実装**: 手動更新ボタン左に「製番フィルタ (n/m)」ドロップダウン。候補は `scheduled` 製番のみ、製番＋機種名を複数列表示。ON/OFFでカード表示を絞り込み、全OFF時は「フィルタで非表示にしています」を表示。状態は `localStorage`（`kiosk-progress-overview-seiban-filter`、schemaVersion付き）で端末別保存。`useProgressOverviewSeibanFilter` フック、`ProgressOverviewSeibanFilterDropdown` コンポーネントを新設。
- **デプロイ**: ブランチ `feat/kiosk-progress-overview-seiban-filter-dropdown`、Pi5 → raspberrypi4 → raspi4-robodrill01 の順に1台ずつ実行。
- **実機検証**: Phase12 全24項目PASS（`verify-phase12-real.sh` に progress-overview API チェックを追加）、実機UIで製番フィルタ・永続化を確認OK。詳細は [KB-306](./frontend.md#kb-306-キオスク進捗一覧-製番フィルタドロップダウン端末別保存) / [deploy-status-recovery.md](../runbooks/deploy-status-recovery.md) を参照。

<a id="progress-overview-five-cols-layout-2026-03-22"></a>

## 進捗一覧 5列グリッド・「納期」「実」ラベル削除・presentation 分割（2026-03-22）

- **Context**:
  - 進捗一覧（`/kiosk/production-schedule/progress-overview`）で、カード内の黄色ラベル「納期」「実」が横方向を圧迫していた。広い画面では **1行あたり5カード**（`xl:grid-cols-5`）にし、ラベルを外して日付・資源CDチップのみ表示する。
- **Fix（仕様）**:
  - **Web のみ**（API 不変）。[`ProductionScheduleProgressOverviewPage.tsx`](../../apps/web/src/pages/kiosk/ProductionScheduleProgressOverviewPage.tsx) は取得・フィルタ・空状態・グリッド枠のみ。カード・行は [`ProgressOverviewSeibanCard.tsx`](../../apps/web/src/components/kiosk/progressOverview/ProgressOverviewSeibanCard.tsx) / [`ProgressOverviewPartRow.tsx`](../../apps/web/src/components/kiosk/progressOverview/ProgressOverviewPartRow.tsx)。純関数・GRID 定数は [`progressOverviewPresentation.ts`](../../apps/web/src/features/kiosk/productionSchedule/progressOverviewPresentation.ts)（`PROGRESS_OVERVIEW_CARD_GRID_CLASS` 等）。
  - 部品名列・資源CD列に **`min-w-0`**（狭いカードでも折り返しが効くように）。納期列は **`w-[84px] whitespace-nowrap`** のまま。資源CDは **`flex`** で全件表示・**`flex-wrap`** で段数制限なし。
- **Deploy / verify（実績、2026-03-22）**:
  - **初回デプロイ（機能ブランチ）**: **`feat/kiosk-progress-overview-five-cols-layout`**。[deployment.md](../guides/deployment.md) 標準の `scripts/update-all-clients.sh`。**対象**: Pi5 → raspberrypi4 のみ成功。**Run ID（ログ接頭辞）**: Pi5 `ansible-update-20260322-084633-25240`、raspberrypi4 `ansible-update-20260322-085040-1342`。**raspi4-robodrill01** は当時 SSH タイムアウトのため **未デプロイ**。
  - **本番追従（`main`・3台順次）**: 通信復旧後、`main` を Pi5 → raspberrypi4 → raspi4-robodrill01 のみ（**Pi3 除外**）・`--limit` 1台ずつ・`RASPI_SERVER_HOST`・`--detach --follow`。**Run ID**: `20260322-212809-1338`（Pi5）/ `20260322-213031-27169`（raspberrypi4）/ `20260322-213507-5127`（raspi4-robodrill01）、いずれも success。
  - **自動実機検証**: `./scripts/deploy/verify-phase12-real.sh` **PASS 27 / WARN 1 / FAIL 0**（2026-03-22）。**WARN**: auto-tuning scheduler ログ件数 0（スクリプト上 PUT auto-generate=200 を代替判定）。進捗一覧 API・両 Pi4・Pi3 signage・`verify-services-real.sh` は **PASS**。
  - **Phase12 冒頭の Pi5 到達判定（知見・TS）**: 旧実装は **`ping -c 1 -W 2`** のみ。Tailscale で RTT が大きいと **ICMP が偶発失敗**し、「Pi5に到達できません」で **verify-phase12-real.sh** または **`verify-services-real.sh`** だけが落ちることがある（API/SSH は成功しているのに失敗する場合は本件を疑う）。**対策（実装済み）**: `verify-phase12-real.sh` / `verify-services-real.sh` で **短い再試行**（最大5回・各 `ping -c 1 -W 5`・間隔1秒）。
- **ローカルテスト（知見）**:
  - `pnpm test:api` はシェルに **`NODE_ENV=production` が残る**と JWT Zod が本番強度を要求し失敗しうる → **`NODE_ENV=test`** を付与。
  - `scripts/test/run-tests.sh` が **5432 利用ありと判断して `POSTGRES_PORT=55432`** に切り替える一方、既存 **`postgres-test-local` が 5432** のときは **`POSTGRES_PORT=5432` を明示**すると接続一致する。
- **Troubleshooting**:
  - **RoboDrill01 に SSH 不能**: Tailscale・電源・ケーブル・`inventory` の `ansible_host` を確認。復旧後に **単体 `--limit "raspi4-robodrill01"`** でデプロイし、`verify-phase12-real.sh` を再実行。
  - **Phase12 が「Pi5に到達できません」だけ失敗**: 上記 **ICMP 再試行** 前のスクリプトでは再現しうる。最新の `verify-phase12-real.sh` / `verify-services-real.sh` を使うか、しばらく待って再実行。TCP（`curl`/`ssh`）は通るが ping だけ落ちる場合は本件と整合。

## デプロイ・実機検証（2026-03-07）

- **デプロイ**: Run ID `20260307-093857-20934`、`state: success`、約15分（Pi5+Pi4×2、`--limit "server:kiosk"`）
- **実機検証結果**:
  - APIヘルス: 200 OK / `status: ok`
  - Prismaマイグレーション: 36件適用済み、スキーマ最新
  - キオスクAPI: `/api/tools/loans/active`（両Pi4）200、`/api/kiosk/production-schedule` 200、`/api/kiosk/production-schedule/due-management/summary` 200
  - deploy-status: `GET /api/system/deploy-status` に `x-client-key` 付与で `isMaintenance: false`
  - Pi4サービス: raspberrypi4・raspi4-robodrill01 ともに kiosk-browser.service / status-agent.timer が active

## 追加実装デプロイ・実機検証（2026-03-07）

- **デプロイ**: Run ID `20260307-110456-19744`、`state: success`、約12分30秒（Pi5+Pi4×2、`--limit "server:kiosk"`）
- **実機検証結果**:
  - APIヘルス: 200 OK / `status: degraded`（メモリ94%、既知の環境要因）
  - Prismaマイグレーション: 37件適用済み、スキーマ最新
  - キオスクAPI: `/api/tools/loans/active` 200、`/api/kiosk/production-schedule` 200、`/api/kiosk/production-schedule/due-management/summary` 200
  - 新機能API: `/api/kiosk/production-schedule/processing-type-options` 200（LSLH/カニゼン/塗装/その他01/その他02）、`/api/kiosk/production-schedule/search-state` 200（history連携）
  - due-management seiban detail: `machineName`・`parts[].processes[]`（resourceCd, resourceNames, isCompleted）・`completedProcessCount`/`totalProcessCount` を確認
  - deploy-status: 両Pi4で `isMaintenance: false`
  - Pi4サービス: raspberrypi4・raspi4-robodrill01 ともに kiosk-browser.service / status-agent.timer が active
  - backup.json: 存在・15K
  - サイネージAPI: `/api/signage/content` layoutConfig 正常

## FSIGENマスタ導入・実機検証（2026-03-11）

- **デプロイ**: Pi5 → raspberrypi4 → raspi4-robodrill01 の順で1台ずつ成功
- **FSIGENマスタ投入**: 本番DBは既存Employee等でシード競合のため、dataSIGEN.csvをSQLで直接投入（125件）
- **API検証**:
  - `GET /api/system/health`: 200 OK / `status: ok`
  - `GET /api/kiosk/production-schedule/resources`: 200、`resourceNameMap` に資源CD→日本語名のマッピング確認（例: `"501":["東芝MPE-2130"]`, `"500":["5軸加工機","5軸加工機（Vertex)"]`）
- **手動確認項目**（Tailscale接続可能な端末から）:
  - 生産スケジュール画面: 資源CDボタンにホバーで日本語名（title/aria-label）が表示されること
  - 納期管理画面: 工程カードの資源CDにホバーで日本語名が表示されること
- **実機検証結果**: OK（両画面で `title` 属性による標準ツールチップでホバー表示を確認済み）
- **トラブルシューティング**:
  - **本番DBで `pnpm prisma db seed` 失敗**: 既存EmployeeのNFC UID等他シードと競合し、seed全体が失敗。FSIGENマスタ（`ProductionScheduleResourceMaster`）は `dataSIGEN.csv` をSQLで直接投入して対応（125件）。類似事例は [KB-203](./infrastructure/ansible-deployment.md#kb-203-本番環境でのprisma-db-seed失敗と直接sql更新) 参照。
  - **ローカル統合テスト**: DB未起動時は `docker run` でPostgreSQL（例: postgres-test-local）を起動してから `kiosk-production-schedule.integration.test.ts` を実行。
- **知見**: 同一 `seed.ts` 内で複数テーブルを投入する場合、既存データとの競合に注意。本番DBは既存データありのため、新規マスタ追加はSQL直接投入で柔軟に対応可能。ホバー表示は `title` 属性で標準ツールチップが動作し、追加ライブラリ不要。

## GroupCDマスタ統合とCSV一括登録（2026-03-07）

- **目的**: 実績基準時間（`actualPerPieceMinutes`）のヒット率向上のため、資源CDを `GroupCD` で束ねて `strict -> mapped -> grouped` の順で探索できるようにする。
- **DB拡張**:
  - `ProductionScheduleResourceMaster.groupCd`（nullable）を追加。
  - マイグレーション: `20260312103000_add_resource_master_group_cd`
  - `prisma/seed.ts` を拡張し、`dataSIGEN.csv` の `GroupCD` 列を取り込み可能化。
- **ワンショット投入**:
  - `pnpm --filter @raspi-system/api import:resource-groupcd -- <csv-path>` を追加。
  - `FSIGENCD` / `GroupCD` を読み、該当 `resourceCd` の `groupCd` を更新（CP932自動判定あり）。
- **管理コンソールCSV一括登録**:
  - `POST /api/production-schedule-settings/resource-code-mappings/import-csv`
  - 入力: `location`, `csvText`, `dryRun`
  - 出力: `totalRows`, `rowsWithGroupCd`, `generatedMappings`, `skipped*`, `skippedUnknownResourceCds`
  - 動作: `FSIGENCD + GroupCD` から同一Group内マッピングを自動生成し、`dryRun=false` で既存設定を一括置換。
- **Resolver拡張**:
  - `ActualHoursFeatureResolver` を `strict -> mapped -> grouped` へ拡張。
  - `grouped` は `resourceMaster.groupCd` 由来の候補資源CDを使って解決（DBアクセスはQuery層で完結、resolverは純粋ロジック維持）。
- **検証**:
  - `actual-hours-feature-resolver.service.test.ts` に grouped 経路を追加。
  - `production-schedule-query.service.test.ts` に GroupCD経由解決ケースを追加。
  - `pnpm --filter @raspi-system/api build`
  - `pnpm --filter @raspi-system/web build`

## 実績基準時間のlocation優先+sharedフォールバック導入（2026-03-13）

- **背景**:
  - `actualPerPieceMinutes` は `x-client-key -> clientDevice.location` で解決先が分かれるため、`kensakuMain` にのみ特徴量がある状態では `RoboDrill01` / `Pi5` / `Mac` で `null` になっていた。
  - 同一製番でも端末ごとに表示有無が変わり、現場確認で混乱が発生した。
- **設計**:
  - 共通ポリシー `actual-hours-location-scope.service` を追加し、候補locationを `actor location -> shared-global-rank` の順で返す。
  - Feature Flag `ACTUAL_HOURS_SHARED_FALLBACK_ENABLED`（既定 `false`）で段階導入を可能化。
  - 同一 `(fhincd, resourceCd)` が複数locationに存在する場合は actor側を優先採用。
- **適用範囲**:
  - `GET /api/kiosk/production-schedule`
  - `GET /api/kiosk/production-schedule/due-management/summary`
  - `GET /api/kiosk/production-schedule/due-management/seiban/:fseiban`
- **運用**:
  - 段階導入時は `ACTUAL_HOURS_SHARED_FALLBACK_ENABLED=true` を対象環境で有効化。
  - 影響があれば `false` に戻すだけで従来挙動（actor locationのみ参照）に即時切替可能。
- **回帰テスト**:
  - actorのみ参照（fallback無効）
  - actor欠損時のshared参照（fallback有効）
  - actor/shared重複時のactor優先

### RoboDrill01 Pi4 で実績基準時間が非表示だった事象（2026-03）

- **事象**: 研削メイン（kensakuMain）Pi4 では実績基準時間が表示されるが、RoboDrill01 Pi4 では表示されない。
- **症状**: 同一製番・同一資源CDでも端末ごとに `actualPerPieceMinutes` の有無が異なり、現場確認で混乱が発生。
- **調査**:
  - H1: `ACTUAL_HOURS_SHARED_FALLBACK_ENABLED` が `false` のまま → CONFIRMED（inventory で未設定だった）
  - H2: `ProductionScheduleActualHoursFeature` の特徴量が `第2工場 - kensakuMain` のみで `shared-global-rank` が空 → CONFIRMED
  - H3: RoboDrill01 の actor location は `第2工場 - RoboDrill01` のため、actor のみ参照だとヒットしない → CONFIRMED
- **根因**: フォールバックフラグが無効のまま、かつ `shared-global-rank` に特徴量が存在しなかった。
- **対処**:
  1. `infrastructure/ansible/inventory.yml` に `actual_hours_shared_fallback_enabled: "true"` を追加（server グループ）
  2. `shared-global-rank` へ kensakuMain の特徴量を SQL でバックフィル（[actual-hours-canonical-backfill.md](../runbooks/actual-hours-canonical-backfill.md#shared-global-rank-へのバックフィル) 参照）
- **再発防止**: 新規 location 追加時は `shared-global-rank` へのバックフィル手順を実行する。fallback 有効化後は `false` に戻すだけで従来挙動へ即時切替可能。

## P2-3 Web Split デプロイ・実機検証（2026-03-13）

- **対象**: `ProductionSchedulePage` の責務分離（displayRowDerivation / useProductionScheduleDerivedRows / useProductionScheduleQueryParams / useSharedSearchHistory / ProductionScheduleResourceFilters / ProductionScheduleHistoryStrip / ProductionScheduleTable）
- **デプロイ**: ブランチ `feat/p2-3-web-split-production-schedule-part1`、Pi5 → raspberrypi4 → raspi4-robodrill01 の順に1台ずつ実行（Run ID `20260313-083304-7855` / `20260313-084019-6793` / `20260313-085016-4776`）、Pi3除外、約18分
- **実機検証**: [deploy-status-recovery.md](../runbooks/deploy-status-recovery.md) のチェックリスト全項目合格。生産スケジュール画面の資源CDフィルタ・登録製番・検索履歴・テーブル表示が従来どおり動作することを実機で確認
- **知見**: 表示派生ロジックを純粋関数（`displayRowDerivation`）に抽出するとテスト容易性と責務分離が向上。Container責務を縮小し、query/mutationオーケストレーション中心に寄せる構成は保守性向上に寄与

## P2-4 Web Split Part 2（mutation・副作用分離、2026-03-13）

- **対象**: `apps/web/src/pages/kiosk/ProductionSchedulePage.tsx` の mutation・副作用
- **実装**:
  - `useProductionScheduleMutations.ts` を追加し、`complete/order/processing/note/dueDate` の mutation 実行と pending 集約、書き込みクールダウン制御を分離
  - `useMutationFeedback.ts` を追加し、備考/納期モーダルの開閉・入力値管理・onSettled 後のクリーンアップを分離
  - `ProductionSchedulePage.tsx` は query とイベント委譲中心へ縮退
  - テスト追加: `useProductionScheduleMutations.test.ts` / `useMutationFeedback.test.ts`
- **デプロイ**: ブランチ `feat/p2-4-sideeffects`、Pi5 → raspberrypi4 → raspi4-robodrill01 の順に1台ずつ実行、Pi3除外、約18分
- **実機検証**: [deploy-status-recovery.md](../runbooks/deploy-status-recovery.md) のチェックリスト全項目合格（APIヘルス、deploy-status両Pi4、キオスクAPI、納期管理API、global-rank、actual-hours/stats、サイネージAPI、backup.json、マイグレーション49件、Pi4×2/Pi3サービス稼働）
- **トラブルシューティング**:
  - `pnpm test:e2e:smoke` はローカル DB 未起動時に失敗（`/api/tools/loans/active` ほかが 500）。根因は実装不整合ではなく、`localhost:5432` に到達できない実行環境要因（`PrismaClientInitializationError`）。対処: `./scripts/test/start-postgres.sh` で DB 起動後、`prisma migrate deploy` と `prisma db seed` を実行してから再実行
- **知見**: UI 層は「状態表示とイベント委譲」に限定し、mutation 実行と副作用管理を hook 境界に分離すると、差分確認と回帰テストが局所化される

## P2-5 Boundary Guard デプロイ・実機検証（2026-03-13）

- **対象**: `import/no-restricted-paths` の段階強化（API: `routes/system <-> routes/kiosk` 横断依存禁止、Web: `features/components/hooks/lib/api/layouts/utils -> pages` 逆依存禁止）、`normalizeClientKey` の `apps/api/src/lib/client-key.ts` への集約
- **デプロイ**: ブランチ `feat/p2-5-boundary-guard`、Pi5 → raspberrypi4 → raspi4-robodrill01 の順に1台ずつ実行、Pi3除外、約20分
- **実機検証**: [deploy-status-recovery.md](../runbooks/deploy-status-recovery.md) のチェックリスト全項目合格。APIヘルス、deploy-status（両Pi4で `isMaintenance: false`）、キオスクAPI、納期管理API、global-rank、actual-hours/stats、生産スケジュールAPI、サイネージAPI、backup.json、マイグレーション49件、Pi4×2サービス稼働を確認。Pi3 signage は接続タイムアウトのためスキップ
- **知見**: 境界ルールは `target/from` の向きを誤ると大量誤検知を誘発するため、小さく追加して即 lint 確認する運用が有効

## 納期管理新レイアウト（V2）有効化・デプロイ・実機検証（2026-03-13）

- **目的**: 納期管理画面のレイアウトを左レール・アクティブコンテキストバー・詳細パネル構成へ最適化し、操作中視認性を向上させる。段階導入のため Feature Flag で新旧切替可能にした。
- **仕様**:
  - Feature Flag: `VITE_KIOSK_DUE_MGMT_LAYOUT_V2_ENABLED`（既定 `false`）
  - 新UI: `DueManagementLayoutShell` / `DueManagementLeftRail` / `DueManagementActiveContextBar` / `DueManagementDetailPanel` に責務分割
  - ViewModel: `dueManagementViewModel.ts` で API hook 依存をページコンテナに閉じ込め
  - 設定経路: `inventory.yml` の `web_kiosk_due_mgmt_layout_v2_enabled` → `docker.env.j2` → `infrastructure/docker/.env` → Docker ビルド引数
- **デプロイ**:
  - ブランチ `feat/due-mgmt-layout-hybrid-flag`
  - 1回目（旧UI検証）: Pi5 → raspberrypi4 → raspi4-robodrill01 の順に1台ずつ、約20分
  - 2回目（新UI切替）: inventory で `web_kiosk_due_mgmt_layout_v2_enabled: "true"` に設定後、Pi5（web 再ビルド）→ raspberrypi4 → raspi4-robodrill01 の順にデプロイ
- **実機検証**: 新レイアウト（左レール・アクティブコンテキストバー・詳細パネル）、操作中視認、主要操作（製番一覧・選択・詳細表示・編集）が正常に動作することを確認。動作確認OK。
- **トラブルシューティング**:
  - **VITE_ 変更時に web が再ビルドされない**: `docker.env.j2` 変更時は `docker_env_result.changed` で web を `--build --force-recreate` するタスクを server role に追加済み。従来は api のみ再起動していたため、web のビルド引数変更が反映されなかった。
  - **旧UIへ戻す**: `inventory.yml` の `web_kiosk_due_mgmt_layout_v2_enabled` を `"false"` に変更し、Pi5 へ再デプロイ（web 再ビルドが走る）。
- **知見**: VITE_ 系環境変数はビルド時に埋め込まれるため、変更時は web コンテナの再ビルドが必須。`VITE_KIOSK_TARGET_LOCATION_SELECTOR_ENABLED` と同様の経路（docker.env.j2 → docker-compose build args → Dockerfile.web）で追加した。

## 納期管理UI Phase1（左ペイン開閉式・詳細パネル重複削除）デプロイ・実機検証（2026-03-13）

- **目的**: 納期管理V2レイアウトの左ペインを開閉式にし、詳細パネルから製番・機種の重複表示を削除して視認性を向上させる。
- **仕様**:
  - 左ペイン3セクション（今日判断候補・今日の計画順・全体ランキング）を `CollapsibleSection` / `CollapsibleCard` で開閉可能に
  - `ProductionScheduleDueManagementPage` で開閉状態を管理（`expandedSections`）
  - `DueManagementDetailPanel` から製番・機種を削除（左ペインのカードで既に表示されているため重複を排除）
- **実装ファイル**:
  - 新規: `CollapsibleSection.tsx`, `CollapsibleCard.tsx`
  - 変更: `DueManagementLeftRail.tsx`, `DueManagementDetailPanel.tsx`, `ProductionScheduleDueManagementPage.tsx`
- **デプロイ**:
  - ブランチ `feat/due-management-ui-phase1-collapsible`
  - Pi5 → raspberrypi4（kensakuMain）→ raspi4-robodrill01 の順に1台ずつ実行、約20分
- **実機検証**: [deploy-status-recovery.md](../runbooks/deploy-status-recovery.md) のチェックリスト全項目合格。APIヘルス、deploy-status（両Pi4で `isMaintenance: false`）、キオスクAPI、納期管理API（triage・daily-plan・global-rank・actual-hours/stats）、サイネージAPI、backup.json（15K）、マイグレーション（50件 up to date）、Pi4×2/Pi3サービス稼働を確認。実機で左ペイン開閉・詳細パネル表示・主要操作が正常に動作することを確認。動作確認OK。
- **知見**: 開閉状態はページコンテナで一元管理し、子コンポーネントへコールバックで伝播する構成にすると状態の一貫性を保ちやすい。共通の `CollapsibleSection` / `CollapsibleCard` を切り出しておくと他セクションへの適用が容易。

## 納期管理UI Phase2（開閉アイコン化・デフォルト閉じ・状態記憶・最下段カード削除）（2026-03-13）

- **目的**: 左ペインの情報密度を最適化し、操作に不要な重複表示を削減する。あわせて、開閉状態を再訪時も保持し、現場の操作コンテキストを維持する。
- **仕様**:
  - `CollapsibleSection` / `CollapsibleCard` のトグルを文字（開く/閉じる）からアイコンに変更
  - 左ペイン3セクション（トリアージ/全体ランキング/今日の計画順）をデフォルト閉じに変更
  - セクション開閉状態を `localStorage`（`due-management-section-open`）で永続化
  - 左ペイン最下段の `visibleSummaries` カードを削除（製番登録・削除は検索チップで継続）
- **実装ファイル**:
  - 新規: `apps/web/src/components/kiosk/dueManagement/CollapsibleToggleIcon.tsx`
  - 新規: `apps/web/src/hooks/useCollapsibleSectionPersistence.ts`
  - 変更: `apps/web/src/components/kiosk/dueManagement/CollapsibleSection.tsx`
  - 変更: `apps/web/src/components/kiosk/dueManagement/CollapsibleCard.tsx`
  - 変更: `apps/web/src/components/kiosk/dueManagement/DueManagementLeftRail.tsx`
  - 変更: `apps/web/src/features/kiosk/productionSchedule/dueManagementViewModel.ts`
  - 変更: `apps/web/src/pages/kiosk/ProductionScheduleDueManagementPage.tsx`
- **検証**:
  - `pnpm --filter @raspi-system/web lint` を実行し成功
  - `visibleSummaries` / `buildVisibleSummaries` 参照が `apps/web/src` から除去されていることを確認
- **デプロイ**:
  - ブランチ `feat/due-management-ui-phase2-improvements`
  - Pi5 → raspberrypi4（kensakuMain）→ raspi4-robodrill01 の順に1台ずつ実行、約20分
- **実機検証（2026-03-13）**:
  - **リモート自動チェック**: [deploy-status-recovery.md](../runbooks/deploy-status-recovery.md) のチェックリスト全項目合格。APIヘルス（`status: ok`）、deploy-status（両Pi4で `isMaintenance: false`）、キオスクAPI、納期管理API（triage・daily-plan・global-rank・global-rank/proposal・global-rank/learning-report・actual-hours/stats）、サイネージAPI、backup.json（15K）、マイグレーション（50件 up to date）、Pi4×2/Pi3サービス稼働を確認。
  - **実機UI確認（手動）**: 開閉ボタンがアイコン化されていること、初回表示で全セクションが閉じていること、開閉操作後にリロードしても状態が復元されること、最下段カードが表示されず製番登録・削除がチップで動作すること、製番一覧・選択・詳細・編集が正常に動作することを確認。
- **知見**:
  - 開閉状態の永続化はページコンテナから `useCollapsibleSectionPersistence` へ切り出すと、UIコンポーネントは表示責務に集中できる
  - 選択中製番の解決ロジックは、表示用カード配列ではなく `sharedHistory` を基準にすることで、表示構造変更に影響されない

## 納期管理UI Phase3（左ペイン導線再構成: 入力→全体ランキング→当日反映）（2026-03-14）

- **目的**: 現場リーダーの実運用（製番登録/納期設定 → 全体ランキング生成・微調整 → 当日反映）に合わせ、左ペインを3セクション導線に再構成する。
- **仕様**:
  - 左ペイン上段を `製番登録・納期前提` とし、検索入力・登録済みチップ・候補件数サマリ（危険/注意/余裕）を集約
  - 中段を `全体ランキング（主作業）` とし、生成/再生成保存、フィルタ（全件/今日対象/危険・注意）、カード上で今日対象化を実行可能化
  - 下段を `当日計画への反映（補助）` とし、今日対象候補の選択と計画順保存を統合
  - トリアージは独立主セクションから降格し、ランキングカード属性・候補選択UIとして利用
- **設計互換性**:
  - `global-rank` 保存API経路は変更しない
  - `daily-plan` 保存API経路は変更しない
  - 生産スケジュール側の `globalRank` は既存の `ProductionScheduleGlobalRowRank` 経路を維持
- **実装ファイル**:
  - 変更: `apps/web/src/components/kiosk/dueManagement/DueManagementLeftRail.tsx`
  - 変更: `apps/web/src/pages/kiosk/ProductionScheduleDueManagementPage.tsx`
  - 変更: `apps/web/src/features/kiosk/productionSchedule/dueManagementViewModel.ts`
  - 変更: `apps/web/src/hooks/useCollapsibleSectionPersistence.ts`（`triage` 旧キーを `registration` へ後方互換マップ）
- **ローカル検証**:
  - `pnpm --filter @raspi-system/web lint` 成功
  - `pnpm --filter @raspi-system/web test -- src/features/kiosk/productionSchedule/dueManagement.test.ts` 成功
- **知見**:
  - 主導線を「全体ランキング中心」に寄せつつ、保存経路を維持すれば納期管理/生産スケジュールの反映互換性を崩さずにUI再編できる
  - セクション永続化キーは旧データを吸収する後方互換を入れておくと、初回表示崩れを回避しやすい

### 納期管理UI 左ペイン中規模改善（選択/対象化導線の統合、2026-03-14）

- **目的**:
  - 左ペイン内で分散していた「選択/対象化」操作を統合し、誤操作リスクと理解コストを下げる。
  - API契約を変更せずに、UI責務を分離して保守性・再利用性を高める。
- **実装概要**:
  - `useDueManagementSelectionActions` を追加し、選択状態判定・選択切替・更新中状態を一元化。
  - 左ペインの選択UIを部品化:
    - `DueManagementSelectionToggleButton`
    - `DueManagementGlobalRankCardActions`
    - `DueManagementDailyTriageCandidateList`
  - `DueManagementLeftRail` は表示責務中心に縮小し、選択処理はコールバック経由に統一。
- **UI統一**:
  - 選択トグルの文言を `対象化 / 対象中` に統一。
  - フィルタ文言を `対象中のみ` に統一。
  - disabled 条件を更新中状態に統一。
- **実装ファイル**:
  - 追加: `apps/web/src/features/kiosk/productionSchedule/useDueManagementSelectionActions.ts`
  - 追加: `apps/web/src/components/kiosk/dueManagement/DueManagementSelectionToggleButton.tsx`
  - 追加: `apps/web/src/components/kiosk/dueManagement/DueManagementGlobalRankCardActions.tsx`
  - 追加: `apps/web/src/components/kiosk/dueManagement/DueManagementDailyTriageCandidateList.tsx`
  - 変更: `apps/web/src/components/kiosk/dueManagement/DueManagementLeftRail.tsx`
  - 変更: `apps/web/src/pages/kiosk/ProductionScheduleDueManagementPage.tsx`
- **ローカル検証**:
  - `pnpm --filter @raspi-system/web lint` 成功
  - `pnpm --filter @raspi-system/web test` 成功（66 tests passed）
  - `pnpm --filter @raspi-system/web build` 成功

### 納期管理UI 左ペイン中規模改善 デプロイ・実機検証（2026-03-14）

- **デプロイ**: ブランチ `feat/due-mgmt-leftrail-selection-unify`、Pi5 → raspberrypi4 → raspi4-robodrill01 の順に1台ずつ実行、約12分。
- **実機検証結果**:
  - リモート自動チェック全項目合格（APIヘルス、deploy-status両Pi4、キオスクAPI、納期管理API、サイネージAPI、backup.json、マイグレーション、Pi4×2サービス稼働）
  - **実機UI確認（raspberrypi4）**: 左ペイン3セクション（製番登録・納期前提、全体ランキング（主作業）、当日計画への反映（補助））、ランキングカード・今日対象候補の「対象化/対象中」トグル、フィルタ「対象中のみ」⇔「全件表示」、サマリ（対象候補/対象中/危険/注意/余裕）、バッジ（今日対象/対象外/引継ぎ）、製番選択→右ペイン表示、セクション開閉状態のlocalStorage永続化を確認
- **知見**: 自動生成で保存した製番はすべて「対象中」になる。個別に「対象中」をクリックすると「対象化」に戻り、今日の計画から外れる。

### 納期管理UI 左ペイン3セクション色分け（2026-03-14）

- **目的**: 左ペイン3セクションを同一色で視認しづらい問題を解消し、導線（製番登録→全体ランキング→当日反映）を色で区別できるようにする。
- **仕様**:
  - `CollapsibleSection` に `accent` prop を追加（`emerald` / `blue` / `amber`）
  - 製番登録・納期前提: emerald（緑）
  - 全体ランキング: blue（青）
  - 当日計画への反映: amber（黄）
  - 当日計画セクションは `contentOpen: ''` でコンテンツ背景なし（赤「危険」の視認性のため）
- **実装**:
  - 変更: `apps/web/src/components/kiosk/dueManagement/CollapsibleSection.tsx`（`accent` prop、`ACCENT_CLASSES`）
  - 変更: `apps/web/src/components/kiosk/dueManagement/DueManagementLeftRail.tsx`（各セクションに accent 指定）
- **デプロイ**: ブランチ `feat/due-mgmt-leftrail-section-accent`、Pi5 → raspberrypi4 → raspi4-robodrill01 の順に1台ずつ実行、約12分。
- **実機検証結果**:
  - リモート自動チェック全項目合格（APIヘルス、deploy-status両Pi4、キオスクAPI、納期管理API、サイネージAPI、backup.json、マイグレーション、Pi4×2サービス稼働）
  - 実機UI確認: 左ペイン3セクションの色分け（emerald/blue/amber）、当日計画セクションのコンテンツ背景なし、開閉・製番選択・既存機能の動作確認
- **知見**: 当日計画セクションは「危険」ラベルが赤で表示されるため、コンテンツ背景を付けない方が視認性が高い。`ACCENT_CLASSES` で accent ごとに `contentOpen` を個別指定可能。

### 納期管理UI Phase3 デプロイ・実機検証（2026-03-14）

- **デプロイ**: ブランチ `feat/due-mgmt-leftpane-workflow-refactor`、Pi5 → raspberrypi4 → raspi4-robodrill01 の順に1台ずつ実行（Run ID `20260314-104634-11479` / `20260314-105037-20151` / `20260314-105548-29471`）、約12分。
- **実機検証結果**:
  - リモート自動チェック全項目合格（APIヘルス degraded・メモリ95.9%は既知環境要因、deploy-status両Pi4 `isMaintenance: false`、キオスクAPI、納期管理API（triage・daily-plan・global-rank・global-rank/proposal・actual-hours/stats）、サイネージAPI、backup.json 15K、マイグレーション51件 up to date、Pi4×2サービス稼働）
  - **実機UI確認**: 左ペイン3セクション（上段: 製番登録・納期前提、中段: 全体ランキング、下段: 当日計画への反映）、トリアージのランキングカード属性・フィルタ・当日候補選択UIへの統合、開閉・状態記憶・主要操作が正常に動作することを確認
- **知見**: デプロイは1台ずつ順番実行（`--limit`）で安定。リモート検証は deploy-status-recovery.md のチェックリストに従う。

## 表面処理別納期ボタン追加（2026-03-13）

- **目的**: 製番納期をデフォルトとして維持しつつ、製番内の表面処理（例: LSLH / カニゼン / 塗装）ごとに納期を個別上書きできるようにする。
- **仕様**:
  - 右ペインヘッダーに `製番納期` ボタンを維持したまま、`製番内で実際に使われている表面処理のみ` 納期ボタンを追加
  - 優先規則: `processingType別納期 > 製番納期`
  - 製番納期の更新時は `processingType別上書きが存在しない行` のみ writeback 対象とする（上書き保持）
  - processingType別納期の解除時はレコード削除で表現し、製番納期へフォールバック
  - 左ペイン summary / triage は最早有効納期（min effective due date）で表示・判定する
- **データモデル**:
  - `ProductionScheduleSeibanProcessingDueDate`（`csvDashboardId + fseiban + processingType` 一意）を追加
  - migration: `20260313190000_add_seiban_processing_due_date`
- **API**:
  - 追加: `PUT /api/kiosk/production-schedule/due-management/seiban/:fseiban/processing/:processingType/due-date`
  - 既存: `PUT /api/kiosk/production-schedule/due-management/seiban/:fseiban/due-date` は `excludeProcessingTypes` 対応へ拡張
- **トラブルシューティング**:
  - **症状**: 製番納期を更新すると processingType別納期が消える  
    **確認**: `ProductionScheduleSeibanProcessingDueDate` に対象 `fseiban + processingType` の行が存在するか  
    **対処**: processingType別納期APIで再設定し、summary/triage/detail の最早納期反映を確認
  - **症状**: processingType別納期解除後に納期が空になる  
    **確認**: 製番納期（`ProductionScheduleSeibanDueDate`）が未設定ではないか  
    **対処**: 製番納期を先に設定してから processingType別納期を解除

### 表面処理別納期 デプロイ・実機検証（2026-03-14）

- **デプロイ**: ブランチ `feat/seiban-processing-type-due-date`、Pi5 → raspberrypi4 → raspi4-robodrill01 の順に1台ずつ実行（Run ID `20260314-080702-3787` / `20260314-081421-8883` / `20260314-081939-26141`）、約25分。
- **実機検証結果**:
  - リモート自動チェック全項目合格（APIヘルス、deploy-status両Pi4、キオスクAPI、納期管理API、global-rank、actual-hours/stats、サイネージAPI、backup.json、マイグレーション51件、Pi4×2サービス稼働）
  - **表面処理別納期 API**: `PUT /seiban/:fseiban/processing/:processingType/due-date` で設定（200 OK）、`dueDate: ""` で解除→製番納期へフォールバック確認。detail の `processingTypeDueDates` 返却確認
  - **実機UI確認**: 右ペインヘッダーに「製番納期」と「製番内で使用中の表面処理別納期」ボタンが併存、設定・解除・フォールバック動作OK
- **知見**: processingType別納期の解除は DELETE ではなく `PUT` に `dueDate: ""` を送る。製番内に存在しない processingType を指定すると 404「指定された製番内に対象の表面処理が見つかりません」を返す（想定どおり）

## 追加実装（2026-03-07）

- 登録製番同期: 納期管理の左ペインを `search-state.history` 同期に変更し、検索追加・保持・×削除を生産スケジュール画面と共通化
- 機種名表示: 納期管理サマリと部品優先順位ヘッダに `machineName` を追加
- 工程進捗表示（案A）: 部品行ごとに `processes[]` を表示し、完了工程をグレーアウト
- FHINCD単位表面処理: `ProductionSchedulePartProcessingType` を追加し、生産スケジュール画面/納期管理画面の更新を同一マスタへ集約
- 候補値の編集可能化: `ProductionScheduleProcessingTypeOption` を追加し、管理コンソールの設定画面で候補（code/label/priority/enabled）を編集可能化
- 検証: API統合テスト `kiosk-production-schedule.integration.test.ts` と `apps/api`,`apps/web` lint を通過

## A修正（画面整合・同期・遷移認証、2026-03-07）

- 左ペイン: 登録製番を最小chip表示へ変更（ボタン見た目を廃止し、`×`削除のみ維持）
- 検索入力: 納期管理画面にもソフトウェアキーボード（`KioskKeyboardModal`）を導入
- 機種名表示: 生産スケジュールと同じ半角化＋大文字化（`toHalfWidthAscii + toUpperCase`）に統一
- 右ペイン: `FHINCD` が `MH`/`SH` で始まる機種名アイテムを非表示化し、`製造order番号（ProductNo）` 列を追加
- 工程進捗: 切削除外設定済み資源CD（例: `10`, `MSZ`）を除外し、完了工程の色味を生産スケジュール側に近いグレーアウトへ統一
- 備考同期: 納期管理の部品備考を「製番+部品（`fseiban+fhincd`）」で保存し、保存時に同キーの全工程row noteへ一括同期
- 遷移認証: 納期管理ボタン押下時にパスワード確認を追加。管理コンソール（生産スケジュール設定）からshared単位で変更可能。未設定時は初期値 `2520` を許可（後方互換）
- ヘッダ発色: 納期管理遷移時に生産スケジュールボタンのactive色が残る不具合を修正（`/kiosk/production-schedule` に `end` を付与）
- 検証: `pnpm --filter @raspi-system/api test -- src/routes/__tests__/kiosk-production-schedule.integration.test.ts`（35件成功）、`apps/api` / `apps/web` lint 成功

## 資源CD名称マスタ導入とホバー表示（2026-03-11）

- 目的: 資源CDのみでは現場オペレーターが設備を識別しづらいため、`FSIGENCD` に紐づく `FSIGENMEI` をDBで一元管理し、既存UIのホバー導線で表示できるようにする
- DB:
  - `ProductionScheduleResourceMaster` を追加（`resourceCd`, `resourceName`, `resourceClassCd`, `resourceGroupCd`）
  - 制約: `resourceCd + resourceName` ユニーク（同一CDに複数名称を保持）
  - 参照性能: `resourceCd` インデックスを追加
- 初回投入:
  - `apps/api/prisma/seeds/dataSIGEN.csv` を追加し、`prisma/seed.ts` で upsert 取り込み
  - 取り込み時は `resourceCd + resourceName` をキーに重複を吸収し、`resourceClassCd` / `resourceGroupCd` を更新可能にした
- API:
  - `GET /api/kiosk/production-schedule/resources` を後方互換拡張
  - 既存 `resources: string[]` は維持し、追加で `resourceNameMap: Record<string, string[]>` を返却
  - 納期管理詳細の `parts[].processes[]` に `resourceNames: string[]` を追加
- UI:
  - 生産スケジュールの資源CDボタンに `title` / `aria-label` を追加（備考ホバーパターン流用）
  - 納期管理の工程進捗バッジに `title` / `aria-label` を追加
  - 同一資源CDに複数名称がある場合は連結表示（`title` は改行、`aria-label` は ` / ` 区切り）
- 検証:
  - APIユニットテスト更新（`production-schedule-query.service.test.ts`）
  - 統合テスト更新（`kiosk-production-schedule.integration.test.ts`）
  - `pnpm --filter @raspi-system/api prisma:generate`
  - `pnpm --filter @raspi-system/api build`
  - `pnpm --filter @raspi-system/web build`

## A修正デプロイ・実機検証（2026-03-07）

- **デプロイ**: Run ID `20260307-141453-31000`、`state: success`、約40分（Pi5+Pi4×2、`--limit "server:kiosk"`）
- **実機検証結果**:
  - APIヘルス: 200 OK / `status: degraded`（メモリ96.2%、既知の環境要因）
  - deploy-status: 両Pi4（raspberrypi4・raspi4-robodrill01）で `isMaintenance: false`
  - キオスクAPI: `/api/tools/loans/active` 200、`/api/kiosk/production-schedule` 200、`/api/kiosk/production-schedule/due-management/summary` 200
  - 納期管理認証API: `POST /api/kiosk/production-schedule/due-management/verify-access-password`（password: 2520）→ `{"success":true}`
  - Prismaマイグレーション: 38件適用済み、スキーマ最新（`ProductionScheduleAccessPasswordConfig` 含む）
  - backup.json: 存在・15K
  - サイネージAPI: `/api/signage/content` layoutConfig 正常
  - Pi4サービス: raspberrypi4・raspi4-robodrill01 ともに kiosk-browser.service / status-agent.timer が active

## B第1段階（納期管理トリアージ、2026-03-07）

- 目的: リーダーが全件を俯瞰せず「今日判断すべき製番」を選べるようにする
- DB:
  - `ProductionScheduleTriageSelection`（拠点共有、`csvDashboardId + location + fseiban` 一意）
- API:
  - `GET /api/kiosk/production-schedule/due-management/triage`
    - 返却: `zones.danger/caution/safe`, `reasons[]`, `isSelected`, `selectedFseibans`
  - `PUT /api/kiosk/production-schedule/due-management/triage/selection`
    - 返却: `selectedFseibans`
- 判定ロジック（第1段階）:
  - 納期基準（`daysUntilDue`）で `danger/caution/safe` を分類
  - 高件数（部品/工程）で1段階エスカレーション
  - 理由には納期由来コード（`DUE_DATE_*`）を優先して付与
  - 表面処理優先ルール（`LSLH > カニゼン > 塗装`）は `SURFACE_PRIORITY` として理由表示
- UI:
  - 納期管理左ペインに「今日判断候補（トリアージ）」を追加
  - 候補カードの選択/解除と「選択済みのみ」表示トグルを追加
- 検証:
  - `pnpm --filter @raspi-system/api test -- src/routes/__tests__/kiosk-production-schedule.integration.test.ts`（37件成功）
  - `pnpm --filter @raspi-system/api lint` / `pnpm --filter @raspi-system/web lint` 成功

## B第2最小（今日の計画順、2026-03-07）

- 目的: トリアージで選んだ製番を、その日の実行順として並べ替え・保存・再表示できるようにする
- DB:
  - `ProductionScheduleDailyPlan`（拠点×日付の計画ヘッダ）
  - `ProductionScheduleDailyPlanItem`（製番と順位）
- API:
  - `GET /api/kiosk/production-schedule/due-management/daily-plan`
    - 返却: `planDate`, `status`, `orderedFseibans`
    - 初回（未保存）時はトリアージ選択済み製番をフォールバック返却
  - `PUT /api/kiosk/production-schedule/due-management/daily-plan`
    - 入力: `orderedFseibans[]`
    - 返却: `success`, `orderedFseibans`
- UI:
  - 納期管理左ペインに「今日の計画順（選択済み製番）」を追加
  - カードの上下操作で順位変更、保存ボタンでAPIへ永続化
  - カードクリックで右ペイン詳細を開ける
- 不具合修正:
  - トリアージカード選択が右ペインに反映されない問題を修正
  - `selectedFseiban` の維持判定を `visibleSummaries` のみ依存から、トリアージ候補/計画順も含める方式へ変更
- 検証:
  - `pnpm --filter @raspi-system/api test -- src/routes/__tests__/kiosk-production-schedule.integration.test.ts`（39件成功）
  - `pnpm --filter @raspi-system/api build` / `pnpm --filter @raspi-system/web build` 成功
  - `pnpm --filter @raspi-system/api lint` / `pnpm --filter @raspi-system/web lint` 成功

## B第2最小デプロイ・実機検証（2026-03-07）

- **デプロイ**: Run ID `20260307-171320-24942`、`state: success`、約12分（Pi5+Pi4×2、`--limit "server:kiosk"`）
- **実機検証結果**:
  - APIヘルス: 200 OK / `status: ok`
  - Prismaマイグレーション: 40件適用済み、スキーマ最新
  - deploy-status: 両Pi4（raspberrypi4・raspi4-robodrill01）で `isMaintenance: false`
  - キオスクAPI: `/api/tools/loans/active` 200（両Pi4）
  - 納期管理API: `/api/kiosk/production-schedule/due-management/triage` 200、`/api/kiosk/production-schedule/due-management/daily-plan` 200（`planDate`/`status`/`orderedFseibans` 返却確認）
  - サイネージAPI: `/api/signage/content` 200
  - backup.json: 存在・15K
  - Pi4サービス: raspberrypi4・raspi4-robodrill01 ともに kiosk-browser.service / status-agent.timer が active

## B第2最小の操作説明

納期管理画面の「今日の計画順」機能の操作手順（リーダー向け）。

### 前提

- 納期管理画面へ遷移済み（パスワード認証済み）
- 「今日判断候補（トリアージ）」で製番を選択済み（選択済み製番が「今日の計画順」に表示される）

### 操作手順

1. **計画順の確認**: 左ペインの「今日の計画順（選択済み製番）」に、トリアージで選んだ製番が表示される
2. **順位の変更**: 各製番カードの上下矢印（↑/↓）を押して、実行順を変更する
3. **保存**: 順位を変更したら「保存」ボタンを押してAPIへ永続化する（未保存の変更があるとボタンが有効になる）
4. **詳細確認**: 製番カードをクリックすると右ペインに製番詳細（部品・工程進捗など）が表示される

### 補足

- 計画順は拠点×日付単位で保存される（他拠点・他日付の計画には影響しない）
- 初回（未保存時）はトリアージ選択済み製番がそのまま表示される
- 日付が変わると新しい計画として扱われ、前日の計画順は引き継がれない

### トラブルシュート（B第2最小）

| 症状 | 想定原因 | 対処 |
|------|----------|------|
| トリアージカードをクリックしても右ペインが更新されない | 選択維持ロジックの不具合（B2で修正済み） | 最新版へデプロイ済みか確認。未対応の場合は画面をリロード |
| 保存ボタンが押せない | 変更がない、または保存済み | 上下矢印で順位を変更してから保存 |
| 計画順が空 | トリアージで製番を未選択 | 「今日判断候補」で製番を選択してから計画順を編集 |

### 知見（B第2実装時）

- **daily-plan API フォールバック**: 未保存時は `ProductionScheduleTriageSelection` の選択済み製番をフォールバック返却。計画テーブルとトリアージテーブルは別管理で、日付キーは JST 基準
- **統合テストのフォールバック順序**: GET の初回取得でトリアージ選択の順序が保証されないため、アサーションは `.sort()` で比較する設計が安全

## B第3段階（全体ランキング・引継ぎ、2026-03-07）

- **目的**: 日次計画の順序を拠点全体で共有し、前日未完了製番を「引継ぎ」として後段に配置できるようにする
- **DB**:
  - `ProductionScheduleGlobalRank`（拠点×製番の優先順位、`csvDashboardId + location + fseiban` 一意、`priorityOrder` でソート）
- **API**:
  - `GET /api/kiosk/production-schedule/due-management/global-rank`
  - `PUT /api/kiosk/production-schedule/due-management/global-rank`
- **ロジック**:
  - 日次計画未保存時: 前日計画＋全体ランキング＋当日トリアージで初期順を生成。トリアージ外は「引継ぎ」として後段に配置
  - 日次計画保存時に global rank へマージ
- **UI**:
  - 「今日の計画順」で引継ぎ製番に「引継ぎ」バッジを表示

### B第3段階デプロイ・実機検証（2026-03-07）

- **デプロイ**: Run ID `20260307-182958-1095`、`state: success`、約11分（Pi5+Pi4×2、`--limit "server:kiosk"`）
- **実機検証結果**:
  - APIヘルス: 200 OK / `status: degraded`（メモリ95.5%、既知の環境要因）
  - Prismaマイグレーション: 41件適用済み、スキーマ最新
  - deploy-status: 両Pi4で `isMaintenance: false`
  - キオスクAPI: `/api/tools/loans/active` 200（両Pi4）
  - 納期管理API: triage / daily-plan / global-rank いずれも 200
  - サイネージAPI: `/api/signage/content` 200、`layoutConfig` 含む
  - backup.json: 存在・15K
  - Pi4サービス: Pi5経由SSHで raspberrypi4・raspi4-robodrill01 ともに kiosk-browser.service / status-agent.timer が active

### 知見（B第3実装・実機検証時）

- **Pi4サービス確認**: Macから直接Pi4にSSHするとタイムアウトする。Pi5経由（`ssh denkon5sd02@100.106.158.2 "ssh tools03@100.74.144.79 '...'"`）で接続する（[deploy-status-recovery.md](../runbooks/deploy-status-recovery.md) 参照）

## B第3次段（全体ランキング可視化・閲覧専用、2026-03-07）

- **目的**: B3で追加済みの `global-rank` を画面で可視化し、リーダー/オペレーターが同じ優先順位を見ながら運用できる状態にする
- **UI追加**:
  - 左ペインに「**全体ランキング（親）**」セクションを追加（閲覧専用）
  - 既存「今日の計画順」を「**子：全体ランキングから切り出し**」として文言整理
  - 全体ランキングカードに「今日対象 / 対象外 / 引継ぎ」バッジを表示
- **設計上の位置づけ**:
  - 変更は `ProductionScheduleDueManagementPage.tsx` に局所化（API追加なし）
  - 既存 `GET /api/kiosk/production-schedule/due-management/global-rank` を再利用
  - 編集（`PUT /global-rank`）は次段スコープとして見送り
- **制約（今回の仕様）**:
  - 全体ランキングは**閲覧のみ**（並べ替え・保存は未提供）
  - 当日実行順の編集は引き続き「今日の計画順」で実施
- **検証**:
  - `pnpm --filter @raspi-system/web test -- src/features/kiosk/productionSchedule/dueManagement.test.ts`（3件成功）
  - `pnpm --filter @raspi-system/web lint` 成功
  - `pnpm --filter @raspi-system/api test -- src/routes/__tests__/kiosk-production-schedule.integration.test.ts`（41件成功）

### B第3次段デプロイ・実機検証（2026-03-07）

- **デプロイ**: Run ID `20260307-193451-27230`、`state: success`、約10〜15分（Pi5+Pi4×2、`--limit "server:kiosk"`）
- **ブランチ**: `feat/due-mgmt-b4-global-rank-visibility`
- **実機検証結果**:
  - APIヘルス: 200 OK / `status: ok`
  - deploy-status: 両Pi4（raspberrypi4・raspi4-robodrill01）で `isMaintenance: false`
  - キオスクAPI: `/api/tools/loans/active` 200（両Pi4）
  - 納期管理API: triage / daily-plan / global-rank いずれも 200
  - global-rank: データ未登録時は `{"orderedFseibans":[]}` を返却（UIは「全体ランキングはまだ作成されていません」と表示）
  - サイネージAPI: `/api/signage/content` 200、`layoutConfig` 含む
  - backup.json: 存在・15K
  - マイグレーション: 41件適用済み、未適用なし
  - Pi4サービス: Pi5経由SSHで raspberrypi4・raspi4-robodrill01 ともに kiosk-browser.service / status-agent.timer が active
  - Pi3 signage-lite: active

### 知見（B第3次段実装・デプロイ時）

- **deriveGlobalRankFlags**: `isCarryover` が true のとき `isInTodayTriage` は常に false になる（引継ぎは今日対象外）。`isOutOfToday` は `!isInTodayTriage` で導出
- **global-rank 空データ**: 製番が1件も登録されていない場合、API は `orderedFseibans: []` を返す。UI は「全体ランキングはまだ作成されていません」と表示
- **デプロイ対象**: Web/キオスク変更は Pi5 + Pi4（`--limit "server:kiosk"`）で十分。Pi3（サイネージ）はサーバー側レンダリングのため Pi5 のみで影響完結

### トラブルシュート（B第3次段）

| 症状 | 想定原因 | 対処 |
|------|----------|------|
| 全体ランキングが空 | 製番が未登録、または global-rank に1件もない | トリアージで製番を選択し、今日の計画順を保存すると global-rank へマージされる。初回は空のままでも正常 |
| バッジが表示されない | dailyPlanItemMeta や selectedSet の取得失敗 | トリアージ・daily-plan API の応答を確認。画面リロードで再取得 |
| 「今日の計画順」と全体ランキングの整合が取れない | 保存タイミングのずれ | 今日の計画順で「順序を保存」を押すと global-rank へマージされる。保存後に全体ランキングを再読込 |

## B第4段階（全体ランキング自動生成・根拠表示、2026-03-07）

- **目的**: 製番単位トリアージと既存運用を維持しつつ、資源所要量を最上位重みとして全体ランキングを自動生成できるようにする
- **追加API**:
  - `GET /api/kiosk/production-schedule/due-management/global-rank/proposal`
  - `PUT /api/kiosk/production-schedule/due-management/global-rank/auto-generate`
  - `GET /api/kiosk/production-schedule/due-management/global-rank/explanation/:fseiban`
- **追加サービス**:
  - `resource-load-estimator.service.ts`（資源能力/混雑/未完了量シグナル）
  - `completion-history-analyzer.service.ts`（完了実績由来シグナル）
  - `due-management-scoring.service.ts`（重み付きスコア計算）
  - `due-management-global-rank-auto.service.ts`（安全ガードつき自動保存）
- **スコア方針（初期係数）**:
  - 資源所要量 45%
  - 納期切迫度 20%
  - 実績補正 15%
  - 引継ぎ/継続性 10%
  - 製番内優先（上位部品カバレッジ）10%
- **安全策（write policy）**:
  - 最小候補件数ガード（`minCandidateCount`）
  - 並び替え差分率ガード（`maxReorderDeltaRatio`）
  - 既存尾部保持（`keepExistingTail`）
- **UI**:
  - 「全体ランキング（親）」に「自動生成して保存」ボタンを追加
  - 各製番カードに `score` と理由バッジ（`reasons[]`）を表示
- **検証**:
  - `pnpm --filter @raspi-system/api test -- src/routes/__tests__/kiosk-production-schedule.integration.test.ts`
  - `pnpm --filter @raspi-system/api lint`
  - `pnpm --filter @raspi-system/web lint`
  - `pnpm --filter @raspi-system/web test`

### 知見（B第4実装時）

- `proposal` は保存前シミュレーションとして利用できるため、現場運用ではまず提案を確認してから `auto-generate` を実行すると安全
- `auto-generate` はガードに抵触した場合 `applied=false` で返し、既存順位を維持する
- 候補未選択時でも summary 全件を対象に提案を返せるため、運用開始時の初期ランキング作成に使える

## B第4段階デプロイ・実機検証（2026-03-07）

- **デプロイ**: Run ID `20260307-214452-32001`、`state: success`、約12分（Pi5+Pi4×2、`--limit "server:kiosk"`）
- **ブランチ**: `feat/due-mgmt-b5-auto-global-rank`
- **実機検証結果**:
  - APIヘルス: 200 OK / `status: ok`
  - deploy-status: 両Pi4（raspberrypi4・raspi4-robodrill01）で `isMaintenance: false`
  - キオスクAPI: `/api/tools/loans/active` 200（両Pi4）
  - 納期管理API: triage / daily-plan / global-rank いずれも 200
  - B5 global-rank/proposal: `GET /api/kiosk/production-schedule/due-management/global-rank/proposal` 200（`generatedAt`、`orderedFseibans`、`candidateCount` 返却確認）
  - サイネージAPI: `/api/signage/content` 200
  - backup.json: 存在・15K
  - マイグレーション: 41件適用済み、未適用なし
  - Pi4サービス: Pi5経由SSHで raspberrypi4・raspi4-robodrill01 ともに kiosk-browser.service / status-agent.timer が active

### トラブルシュート（B第4段階）

| 症状 | 想定原因 | 対処 |
|------|----------|------|
| 「自動生成して保存」が無効 | ガード（最小候補件数・差分率・尾部保持）に抵触 | proposal を確認し、`applied=false` の理由をログで確認。必要ならガード閾値を調整 |
| スコア・理由が表示されない | proposal API の取得失敗 | ネットワーク・APIヘルスを確認。画面リロードで再取得 |
| 保存後に順位が変わらない | ガードで `applied=false` | 提案内容と既存順位の差分率が閾値を超えている可能性。手動で今日の計画順を編集して保存 |

## B第4段階補正（納期設定済み限定候補 + 即時除外、2026-03-07）

- **目的**: 全体ランキング（親）を現場運用に合わせ、「納期設定済み製番のみ」を候補に統一
- **仕様変更**:
  - `GET /api/kiosk/production-schedule/due-management/global-rank/proposal` の候補は `dueDate != null` の製番のみ
  - `PUT /api/kiosk/production-schedule/due-management/global-rank/auto-generate` で、既存global-rankに残る納期未設定製番を**即時除外**（方針A）
  - `keepExistingTail=true` でも、納期未設定製番は尾部保持しない
  - 日数計算は JST 日境界で評価
- **実装ファイル**:
  - `apps/api/src/services/production-schedule/due-management-scoring.service.ts`
  - `apps/api/src/services/production-schedule/due-management-global-rank-auto.service.ts`
- **検証（ローカル）**:
  - `pnpm --filter @raspi-system/api test -- src/routes/__tests__/kiosk-production-schedule.integration.test.ts`（44件成功）
  - `pnpm --filter @raspi-system/api lint` 成功
  - `pnpm --filter @raspi-system/web lint` 成功

## B第4段階補正デプロイ・実機検証（2026-03-08）

- **デプロイ**: Run ID `20260308-080355-17100`、`state: success`、約12分（Pi5+Pi4×2、`--limit "server:kiosk"`）
- **実機検証結果**:
  - APIヘルス: 200 OK / `status: ok`（メモリ91.6%警告は既知）
  - deploy-status: 両Pi4（raspberrypi4・raspi4-robodrill01）で `isMaintenance: false`
  - キオスクAPI: `/api/tools/loans/active` 200（両Pi4）
  - 納期管理API: triage / daily-plan / global-rank / global-rank/proposal / summary いずれも 200
  - global-rank/proposal: `candidateCount: 0`（納期未設定製番のみの環境では空が想定どおり）
  - サイネージAPI: `/api/signage/content` 200、`layoutConfig` 含む
  - backup.json: 存在・15K
  - マイグレーション: 41件適用済み、スキーマ最新
  - Pi4サービス: Pi5経由SSHで raspberrypi4・raspi4-robodrill01 ともに kiosk-browser.service / status-agent.timer が active

### 知見（B第4段階補正デプロイ・実機検証時）

- **proposal 空応答**: 納期設定済み製番が1件もない場合、`global-rank/proposal` は `orderedFseibans: []`、`candidateCount: 0` を返す。運用開始時や納期未登録時は正常挙動
- **実機検証チェックリスト**: [deploy-status-recovery.md](../runbooks/deploy-status-recovery.md) の「3. 実機検証チェックリスト」を参照

## References

- [ci-troubleshooting.md](../guides/ci-troubleshooting.md)（8.5. ユニットテストで Prisma モデル未モック）— A修正実装時の CI 初回失敗（KB-298）対策
- [KB-298](../knowledge-base/ci-cd.md#kb-298-ユニットテストでprismaモデル未モックtyperror-cannot-read-properties-of-undefined-reading-findmany): ユニットテストで Prisma モデル未モック
- `apps/api/prisma/schema.prisma`
- `apps/api/src/services/production-schedule/due-management-query.service.ts`
- `apps/api/src/services/production-schedule/due-management-command.service.ts`
- `apps/api/src/services/production-schedule/due-management-triage.service.ts`
- `apps/api/src/services/production-schedule/due-management-selection.service.ts`
- `apps/api/src/services/production-schedule/due-management-daily-plan.service.ts`
- `apps/api/src/services/production-schedule/due-management-global-rank.service.ts`
- `apps/api/src/services/production-schedule/due-management-carryover.service.ts`
- `apps/api/src/services/production-schedule/due-management-scoring.types.ts`
- `apps/api/src/services/production-schedule/resource-load-estimator.service.ts`
- `apps/api/src/services/production-schedule/completion-history-analyzer.service.ts`
- `apps/api/src/services/production-schedule/due-management-scoring.service.ts`
- `apps/api/src/services/production-schedule/due-management-global-rank-auto.service.ts`
- `apps/api/src/routes/kiosk/production-schedule/due-management-global-rank.ts`
- `apps/web/src/pages/kiosk/ProductionScheduleDueManagementPage.tsx`
- `apps/web/src/features/kiosk/productionSchedule/dueManagement.ts`（`deriveGlobalRankFlags`）
- `apps/web/src/api/client.ts`
- `apps/web/src/api/hooks.ts`
- `apps/web/src/pages/admin/ProductionScheduleSettingsPage.tsx`

## B第5段階（オフライン学習評価 + イベントログ、2026-03-08）

### 実装前議論（設計方針・コンテキスト共有）

- **目的**: 納期遅れ最小化を主目的として、提案順位/現場決定/完了変化を追記専用で保存し、重み更新はオフライン評価のみに限定する
- **方針**:
  - 本番で重みを自動更新しない（オンライン学習を無効）
  - 提案と現場決定の一致度は副指標（Top-K/Spearman/Kendall）
  - 主指標は遅延側（overdue件数、overdue日数）
- **設計方針の背景**:
  - **オフライン評価のみ**: 本番での即時自己学習は、データ品質やサンプル不足時に挙動が不安定化するリスクがある。既存データはCSV再取込や保持期間削除の影響を受けるため、学習/監査向けの履歴としては欠損しうる
  - **代替案検討**: オンライン学習（本番で重みを逐次更新）は却下。データ品質/件数が安定する前に導入すると過学習・挙動不安定化を招く。既存テーブルのみで学習を行う案も、履歴欠損時に再現性・監査性を担保しにくいため却下
  - **イベントモデル**: 追記専用の3テーブル（Proposal/Decision/Outcome）で一次データを保持し、既存 `ProductionScheduleGlobalRank` は運用表示向け投影として維持
- **追加データモデル**:
  - `DueManagementProposalEvent`
  - `DueManagementOperatorDecisionEvent`
  - `DueManagementOutcomeEvent`
- **追加API**:
  - `GET /api/kiosk/production-schedule/due-management/global-rank/learning-report`（クエリ: `from` / `to` オプション、ISO 8601）
- **実装ポイント**:
  - `auto-generate` / 手動global-rank保存時に proposal/decision イベントを記録
  - 完了トグル・CSV進捗同期時に outcome イベントを記録
  - `due-management-learning-evaluator.service.ts` で期間集計レポートを生成
- **運用メモ**:
  - イベントテーブルは分析・再学習・監査の一次データとして扱い、既存ランキングテーブルは投影（運用表示）として扱う
  - 学習重みの本番反映は別ステップ（承認付き）で行う

### デプロイ・実機検証（2026-03-08）

- **デプロイ**: Run ID `20260308-092421-13920`、`state: success`、約12分（Pi5+Pi4×2、`--limit "server:kiosk"`）
- **実機検証チェック**:
  - APIヘルス: `status: ok`
  - deploy-status: 両Pi4（raspberrypi4・raspi4-robodrill01）で `isMaintenance: false`
  - キオスクAPI: `/api/tools/loans/active` 200
  - 納期管理API: triage・daily-plan・global-rank・global-rank/proposal・**global-rank/learning-report**・summary すべて 200
  - サイネージAPI: 200
  - backup.json: 存在・15K
  - マイグレーション: 42件適用済み、未適用なし
  - Pi4サービス: Pi5経由SSHで raspberrypi4・raspi4-robodrill01 ともに kiosk-browser.service / status-agent.timer が active
- **learning-report 応答例**: `locationKey`、`range`（from/to）、`summary`（proposalCount、decisionCount、outcomeCount、overdueSeibanCount、overdueTotalDays、avgTopKPrecision、avgSpearmanRho、avgKendallTau）、`recommendation` を返却

### トラブルシューティング（Prisma JSON型CI失敗）

- **事象**: 初回プッシュ後、CIの`Build API`で `tsc -p tsconfig.build.json` が失敗
- **エラー**: `due-management-learning-event.repository.ts` で `Record<string, unknown> | null` が Prisma の `InputJsonValue` / `NullableJsonNullValueInput` に代入できない
- **原因**: Prisma の JSON カラムでは、`null` を明示するには `Prisma.JsonNull` を指定する必要がある。`Record<string, unknown>` は `Prisma.InputJsonValue` へのキャストが必要
- **対策**: [KB-299](./ci-cd.md#kb-299-prisma-jsonカラムへのrecordstring-unknown-やnullの代入でciビルド失敗) を参照
- **再発防止**: 新規 JSON カラムへの書き込みには、既存 `signage.service.ts` の `toPrismaLayoutConfig` パターン（`null` → `Prisma.JsonNull`、オブジェクト → `as Prisma.InputJsonValue`）を参照する

### 知見（B第5段階）

- **実機検証チェックリスト**: [deploy-status-recovery.md](../runbooks/deploy-status-recovery.md) の「3. 実機検証チェックリスト」を参照。`learning-report` は納期管理APIの一環として追加済み

## B第6段階（行単位全体順位スナップショット導入・Phase 1、2026-03-09）

- **目的**: 全体ランキングを「製番単位の親順位」から「行単位の通し順位」へ投影し、生産スケジュールキオスクと納期管理キオスクが同じ順位基準を参照できるようにする
- **方針**:
  - 既存 `processingOrder`（資源CD別の実行順）は維持
  - 新設 `globalRank`（行単位全体順位）は読み取り専用で表示
  - フィルタ（製番/資源CD）は**順位計算後の表示絞り込み**とし、再ランキングしない
- **追加データモデル**:
  - `ProductionScheduleGlobalRowRank`（`csvDashboardRowId` ごとの `globalRank` スナップショット）
- **実装ポイント**:
  - `row-global-rank-generator.service.ts` で行単位順位を生成（製番順位 -> 部品優先 -> 工順 -> ProductNo）
  - `due-management-global-rank.service.ts` の保存処理後に再生成を実行（manual/auto双方）
  - `GET /api/kiosk/production-schedule` に `globalRank` を追加
  - 生産スケジュール画面に `全体順位` 列を追加し、既存 `順番` は `資源順番` に改称
- **検証**:
  - APIユニットテスト（query / generator）
  - API統合テスト（kiosk-production-schedule）
  - `apps/api` lint/build、`apps/web` lint

### デプロイ・実機検証（B第6段階 Phase 1）

- **初回デプロイ**: `--limit "server:kiosk"` で Pi5 + Pi4 を並列実行。Pi5 フェーズ完了後に Pi4 キオスクフェーズでハング（`TASK [common : Ensure repository parent directory exists]` で応答停止）
- **復旧**: [deploy-status-recovery.md](../runbooks/deploy-status-recovery.md) の「Pi4デプロイハング時の復旧手順」に従い、ハングプロセス kill → ロック削除 → Pi4 を単体で `--limit "raspberrypi4"` / `--limit "raspi4-robodrill01"` により再デプロイ
- **デプロイ結果（初回復旧）**: Run ID `20260309-165843-1497`（raspberrypi4）、`20260309-170927-5242`（raspi4-robodrill01）、両端末とも `state: success`
- **2回目デプロイ（1台ずつ順番実施）**: ブランチ `feat/global-row-rank-phase1` で、Pi5 → raspberrypi4 → raspi4-robodrill01 の順に `--limit` で1台ずつデプロイ。Run ID `20260309-180244-10720`（Pi5、約2.7分）、`20260309-180529-15837`（raspberrypi4、約9.3分）、`20260309-181644-11063`（raspi4-robodrill01、約4.0分）、3台とも `state: success`。推奨運用は [deployment.md](../guides/deployment.md) の「1台ずつ順番デプロイ」を参照
- **実機検証**: [deploy-status-recovery.md](../runbooks/deploy-status-recovery.md) の「3. 実機検証チェックリスト」を実施。APIヘルス、deploy-status（両Pi4で `isMaintenance: false`）、キオスクAPI、納期管理API（triage・daily-plan・global-rank・global-rank/proposal・global-rank/learning-report）、サイネージAPI、backup.json、マイグレーション（43件）、Pi4/Pi3サービス稼働を確認
- **トラブルシューティング**: Pi4 ハングの詳細は [KB-300](./infrastructure/ansible-deployment.md#kb-300-pi4デプロイ時のキオスクフェーズハングserverkiosk-並列実行時) を参照

### 知見（B第6段階）

- **意味分離が重要**: `全体順位`（全体最適の参照）と `資源順番`（現場実行順）は目的が異なるため、同一列へ統合しない方が運用上安全
- **保存型が有効**: 行単位順位をスナップショット保存することで、将来の「直近数日の妥当性評価」に再現性を持たせやすい

### 現場リーダー向け機能説明（全体順位 Phase 1）

**対象読者**: 納期管理画面を使う現場リーダー、生産スケジュール画面を使うオペレーター

#### 全体順位とは

- **全体順位（保存値）**は、拠点内の全工程行を「納期・製番・部品・工順」で並べたときの**通し順位**（1, 2, 3, …）です
- リーダーが納期管理で決めた「今日の計画順」や「全体ランキング」を、**行単位**に展開したものです
- **生産スケジュール画面の表示**は、資源CDフィルタ中のみ「表示対象内での連番（1..N）」を表示します（保存値は保持）

#### リーダーのワークフローとの関係

1. **納期管理画面**で「今日判断候補（トリアージ）」から製番を選択
2. 「**今日の計画順**」で上下矢印で順位を編集し、**保存**ボタンを押す
3. （オプション）「**全体ランキング**」の「自動生成して保存」で提案順位を反映
4. 保存が成功すると、**行単位の全体順位**が自動で再計算・保存される
5. **生産スケジュール画面**の「全体順位」列に、同じ順位が表示される

→ オペレーターは生産スケジュール画面で、リーダーが決めた順位をそのまま参照できます。

#### 画面ごとの表示

| 画面 | 表示内容 |
|------|----------|
| **納期管理** | 「全体ランキング（親）」で製番単位の順位を閲覧。「今日の計画順」で編集・保存 |
| **生産スケジュール** | 「**全体順位**」列で行単位の通し順位を閲覧（読み取り専用） |

#### 全体順位と資源順番の違い

| 項目 | 全体順位 | 資源順番 |
|------|----------|----------|
| **意味** | 拠点全体での優先順（リーダーが決めた順） | 各資源CD（加工機）ごとの実行順 |
| **編集** | 読み取り専用（納期管理で決める） | 編集可能（現場で調整） |
| **用途** | 全体最適の参照・オペレーターへの指示 | 現場の実行順の調整 |

#### 運用上の注意

- 資源CDフィルタ中は、オペレーターが作業順として使いやすいように、**全体順位表示を表示対象内で1..Nに再採番**する（保存値は変更しない）
- 資源CDフィルタ中は、**行の並び順も表示順位（1..N）で昇順ソート**し、1, 2, 3… の順で表示する（2026-03-11 補正）
- 登録製番（検索条件）を起点に研削/切削で表示範囲を絞っている場合も、**表示対象内の表示順位として1..Nに再採番**してソートする（保存値は変更しない）
- 資源CDフィルタを外すと、保存されている全体通し順位の表示に戻る
- 納期管理で「今日の計画順」や「全体ランキング」を保存した直後に、生産スケジュールの「全体順位」列が更新される

### 実績工数列の表示拡張（2026-03-11）

- **方針**: 単純平均は採用せず、実績工数CSV特徴量（`中央値` / `p75` / 件数）から導く値のみをUIへ表示
- **生産スケジュール**:
  - `実績基準時間(分/個)`: `p75PerPieceMinutes`（未定義時は中央値）
  - `実績推定工数(分)`: `実績基準時間(分/個) × ロット数`
- **納期管理（製番一覧・全体ランキング・部品表）**:
  - `実績推定工数(分)` と `実績カバー率(%)` を追加
  - 部品表に `実績基準時間(分/個)` と `実績推定工数(分)` を追加
- **命名ルール**:
  - 単価指標は `分/個` を列名に明示
  - 製番・部品合算値は `分` を列名に明示

### 実績工数列の整合化（2026-03-11 追補）

- **背景**:
  - 生産日程CSV（Gmail取得）には `FSEZOSIJISU` が存在せず、`実績推定工数(分)` は定義不能だった
  - `実績基準時間(分/個)` は `FHINCD + FSIGENCD` の厳密一致のみだと欠損が多かった（例: `26M` vs `25M/27M`）
- **仕様修正**:
  - 生産スケジュール画面から `実績推定工数(分)` 列を廃止
  - 納期管理画面も `実績推定工数(分)` 表示を廃止し、`実績カバー率(%)` と `実績基準時間(分/個)` を維持
  - `actualHoursScore` は数量依存推定を使わず、カバー率とサンプル信頼度で評価
- **実装**:
  - `ActualHoursFeatureResolver` を新設し、`strict一致 -> 手動マッピング一致` の順で探索
  - `ProductionScheduleResourceCodeMapping` を追加し、管理コンソールから `resource-code-mappings` を設定可能化
  - 生産スケジュール/納期管理の両APIを resolver 経由に統一
- **運用ルール**:
  - 資源CD不一致は自動推定しない（必ず管理コンソールで明示マッピング）
  - 誤マッピング防止のため、`fromResourceCd -> toResourceCd` は優先順付きで管理する

### 実績工数列の整合化 デプロイ・実機検証（2026-03-11）

- **デプロイ**: ブランチ `feat/global-rank-resource-local-display`。Pi5 → raspberrypi4 → raspi4-robodrill01 の順に `--limit` で1台ずつ実行（Run ID `20260311-142346-26409` / `20260311-142902-25781` / `20260311-143429-2874`）。合計約13分。
- **実機検証結果**（[deploy-status-recovery.md](../runbooks/deploy-status-recovery.md) のチェックリスト準拠）:
  - APIヘルス: 200 OK / `status: ok`（メモリ89.6%警告は既知の環境要因）
  - deploy-status: 両Pi4で `isMaintenance: false`
  - キオスクAPI・生産スケジュールAPI・納期管理API（triage・daily-plan・global-rank・global-rank/proposal・global-rank/learning-report・actual-hours/stats）: すべて 200
  - 生産スケジュールAPI: `actualPerPieceMinutes`（実績基準時間）返却確認、`actualEstimatedMinutes` は廃止済み
  - actual-hours/stats: `totalRawRows`, `totalCanonicalRows`, `totalFeatureKeys`, `topFeatures` 返却確認
  - resource-code-mappings: `GET /api/production-schedule-settings/resource-code-mappings` は管理画面用のため認証必須。未認証で 401 が返るのは想定どおり（エンドポイント存在確認として有効）
  - サイネージAPI: 200、layoutConfig 含む
  - backup.json: 存在・15K
  - マイグレーション: 48件、up to date
  - Pi4/Pi3サービス: 両Pi4で kiosk-browser.service / status-agent.timer が active、Pi3 signage-lite が active
- **知見**: 実機検証チェックリストは [deploy-status-recovery.md](../runbooks/deploy-status-recovery.md) を参照。管理API（resource-code-mappings）は JWT 認証必須のため、キオスク検証では 401 応答でエンドポイント存在を確認する運用で可。

### 全体順位 ソート補正（2026-03-11）

- **事象**: 資源CDフィルタ時に表示順位は1..Nに再採番されていたが、**行の並び順がその順位に従っていなかった**（実機検証で判明）
- **修正**: `displayRows` を表示順位（1..N）で昇順ソートするように変更（`displayRank.ts` / `ProductionSchedulePage.tsx`）
- **デプロイ**: Pi5 → raspberrypi4 → raspi4-robodrill01 の順に1台ずつ実行（Run ID: `20260311-082311` / `20260311-082345` / `20260311-083018`）
- **実機検証**: 資源CD押下後、1から順位付けされ、ソートもその順位基準になっていることを確認済み
- **知見**: 表示順位の再採番と行ソートは別実装であり、両方を揃える必要がある

### B第7段階（実績工数CSV連携 + 全体ランキング連携、2026-03-10）

- **実装概要**:
  - `ProductionScheduleActualHoursRaw` / `ProductionScheduleActualHoursCanonical` / `ProductionScheduleActualHoursFeature` を導入し、Raw保存（append-only）とCanonical正規化（winner選定）と特徴量集約を責務分離
  - Gmail CSV取込フローに `productionActualHours` ターゲットを追加し、既存スケジューラ経由で月次自動取込できるように拡張
  - 取込後に Canonical を再構築し、`FHINCD × FSIGENCD` 単位で `中央値 + 件数 + p75` を再集約（除外条件: 直近30日、0工数、明確な外れ値）
  - 全体ランキングスコアへ `actualHoursScore` を追加し、上位重みの一要素として反映（単独決定因子にはしない）
- **追加API**:
  - `POST /api/kiosk/production-schedule/due-management/actual-hours/import`（手動CSV投入 + 再集約）
  - `GET /api/kiosk/production-schedule/due-management/actual-hours/stats`（集約キー件数・上位特徴量の確認）
- **運用メモ**:
  - Gmailの月次自動取込は `csvImports.targets[].type = productionActualHours` で設定し、`metadata.locationKey` でロケーションを明示できる
  - CP932 CSVを自動判別し、UTF-8と混在しても取り込み可能
  - Raw fingerprint は source非依存（`sourceFileKey` を重複判定に含めない）へ変更し、同一データの再送時に不要な増加を抑制
  - Canonical winner は `workDate > raw.updatedAt > raw.createdAt > rawId` の優先順で決定（明示更新時刻が無いCSVに対応）
  - 特徴量が不足する製番は既存ロジックへフォールバックするため、既存運用を破壊しない
  - **Canonical差分化（2026-03-10 実装完了）**: Raw append-only + Canonical winner選定 + Feature再集約へ責務分離。`ActualHoursImportOrchestratorService` で手動APIとスケジューラを統合。既存Rawからのバックフィルは [actual-hours-canonical-backfill.md](../runbooks/actual-hours-canonical-backfill.md) を参照

### B第7段階デプロイ・実機検証（2026-03-10）

- **デプロイ**: Pi5 → raspberrypi4 → raspi4-robodrill01 の順に `--limit` で1台ずつ実行（Run ID `20260310-154937-13894` / `20260310-155444-12790` / `20260310-155947-3485`）。推奨運用は [deployment.md](../guides/deployment.md) の「1台ずつ順番デプロイ」を参照。
- **実機検証結果**:
  - APIヘルス: 200 OK / `status: ok`（メモリ87.6%警告は既知）
  - deploy-status: 両Pi4（raspberrypi4・raspi4-robodrill01）で `isMaintenance: false`
  - キオスクAPI: `/api/tools/loans/active` 200（両Pi4）
  - 納期管理API: triage / daily-plan / global-rank / global-rank/proposal / global-rank/learning-report / summary すべて 200
  - 実績工数API: `GET /api/kiosk/production-schedule/due-management/actual-hours/stats` 200（`totalRawRows`, `totalCanonicalRows`, `totalFeatureKeys`, `topFeatures` 返却）
  - サイネージAPI: `/api/signage/content` 200、`layoutConfig` 含む
  - backup.json: 存在・15K
  - マイグレーション: 45件適用済み、スキーマ最新
  - Pi4サービス: raspberrypi4・raspi4-robodrill01 ともに kiosk-browser.service / status-agent.timer が active
  - Pi3 signage: `tailscale status` で offline のため SSH タイムアウト、signage-lite 確認は未実施（スキップ可能）
- **知見**:
  - `actual-hours/stats` はCSV未取込時 `totalRawRows: 0`, `totalCanonicalRows: 0`, `totalFeatureKeys: 0`, `topFeatures: []` を返す（想定どおり）。Gmail月次取込または `POST /actual-hours/import` で手動投入後に再集約され、特徴量が反映される
  - 実機検証チェックリストは [deploy-status-recovery.md](../runbooks/deploy-status-recovery.md) の「3. 実機検証チェックリスト」を参照
  - **本番DBバックフィル**: Deploy後に既存RawをCanonical/Featureへ反映する場合は [actual-hours-canonical-backfill.md](../runbooks/actual-hours-canonical-backfill.md) を参照。実行順序は「コミット→CI→Deploy→バックフィル」
  - **大容量CSV手動投入**: 約 6MB 超の一括送信で `413 Payload Too Large` になる。約 25 万文字ごとに分割して順次投入で回避（[KB-301](../knowledge-base/api.md#kb-301-実績工数csv手動投入で-413-payload-too-large-になる)）。CP932 の CSV は `iconv -f CP932 -t UTF-8` で変換してから投入
  - **locationKey**: デフォルトは `default`。client-key の location に紐づく。Gmail 取込の `metadata.locationKey` で指定可能
  - **Pi3 offline**: `tailscale status` で offline の場合、SSH がタイムアウトする。実機検証時は Pi3（signage）のサービス確認をスキップ可能

### B第7段階 CSV取り込み・バックフィル結果（2026-03-10）

- **本番DBバックフィル**: 初回は Raw が 0 件のため、Canonical/Feature も 0 件（想定どおり）
- **手動CSV取り込み**: `data_20210101_20221231.csv`（6.4MB）、`data_20230101_20241231.csv`（5.5MB）を分割投入（48チャンク、約25万文字/チャンク）で実施
- **結果**: `totalRawRows: 205766`, `totalCanonicalRows: 146644`, `totalFeatureKeys: 10436`

<a id="実績基準時間-推定式見直し2026-03-23"></a>

### 実績基準時間 推定式見直し（2026-03-23）

- **背景**:
  - `actualPerPieceMinutes` は `p75PerPieceMinutes ?? medianPerPieceMinutes` で表示しており、代表値としては過大側に寄りやすかった。
  - 所要は総分だが、現行の生産スケジュール入力には個数が無いため、まずは `分/個` 指標の信頼性改善を優先した。
- **実DB評価（第2工場 - kensakuMain）**:
  - Canonical 期間: `2021-01-04` 〜 `2024-12-28`、件数 `146,644`。
  - 2024 holdout（学習: 2021-2023、評価: 2024）で比較:
    - `median`: `MAE 14.925`, `bias -6.815`
    - `p75`: `MAE 17.092`, `bias 3.036`
    - `shrinkage(k=3) + median`: `MAE 14.734`, `bias -7.756`
  - 直近1年（2023）学習 + 2024評価では `k=3` が最良（`MAE 14.663`）。
- **採用式**:
  - `w * median(FHINCD×FSIGENCD) + (1 - w) * median(FSIGENCD)`、`w = n / (n + 3)`。
  - `n` はキーの `sampleCount`。キー欠損時は資源中央値、さらに欠損時は全体中央値へフォールバック。
- **実装**:
  - `actual-hours` 共通読取コンテキストを新設し、query/scoring の特徴量解決経路を統一。
  - resolver は戦略差し替え可能化し、既定を `shrinkedMedianV1`、互換として `legacyP75` を維持。
  - Feature 集約は直近除外（30日）に加え lookback 365日を既定化。
- **非対象（次段）**:
  - 個数未取込のため、`所要(総分)` と `実績総工数` の厳密比較は今回の変更対象外。
  - 将来は個数取込後に総工数推定モジュールを追加する。
- **参照**:
  - [ADR-20260323-actual-hours-baseline-estimation](../decisions/ADR-20260323-actual-hours-baseline-estimation.md)
- **Deploy / verify（実績、2026-03-23）**:
  - **コード基準**: `main` の API 変更（例: `de0cb8fd`）を Pi5 に反映後、キオスク用に Pi4 を追随。
  - **デプロイ（Pi3 除外・1台ずつ）**: [`deployment.md`](../guides/deployment.md) の **`--limit` 順番**、`RASPI_SERVER_HOST` 必須、`--detach --follow`。
    - Detach Run ID: `20260323-194941-30819`（`raspberrypi5`）/ `20260323-195832-8661`（`raspberrypi4`）/ `20260323-200352-7201`（`raspi4-robodrill01`）。
  - **自動実機検証**: リポジトリルートで `./scripts/deploy/verify-phase12-real.sh` → **PASS 28 / WARN 0 / FAIL 0**（`actual-hours/stats`・納期管理 API 群・`manual-order-overview` v2・Pi4×2・Pi3 signage を含む）。
- **仕様（運用で押さえる点）**:
  - `actualPerPieceMinutes` の**既定**は **`shrinkedMedianV1`**（`w=n/(n+3)` の縮小中央値）。互換が必要な場合のみ resolver で **`legacyP75`**（従来 `p75 ?? median`）へ切替可能。
  - 公開 JSON に戦略ラベルが無い場合、デプロイ前後で**同じキーの数値が中央値寄りに変わる**ことが主な見え方の差分。
- **知見**:
  - Phase12 スクリプトは `actual-hours/stats` の**フィールド存在**を検査するに留まる。**数値が縮小中央値戦略に更新されたこと**の確認は、代表行の `GET .../production-schedule` や納期管理詳細の `actualPerPieceMinutes` をサンプル比較する、または本番読み取りのみの SQL で特徴量を確認する。
- **Troubleshooting**:
  - **200 だが実績列が空に近い**: Feature 集約は **lookback 365 日 + 直近 30 日除外**。古い実績だけのキーは窓外になりうる。取込期間・集約ウィンドウを確認（本 ADR・実装）。
  - **一覧とスコアの根拠が食い違う**: 本変更後は `actual-hours-read-context` で query / scoring の読取を統一済み。差が残る場合は **未更新 API コンテナ**・**古い Pi5 イメージ**を疑い、デプロイログと `docker compose ps` を確認。

### 全端末共有優先順位（Mac対象ロケーション指定）デプロイ・実機検証（2026-03-10）

- **実装概要**: `global-rank` API に `targetLocation` / `rankingScope`（`globalShared` / `locationScoped` / `localTemporary`）を拡張。`ProductionScheduleGlobalRankTemporaryOverride` テーブルを追加。Mac から対象拠点を明示指定可能。移行手順は [mac-target-location-migration.md](../runbooks/mac-target-location-migration.md) を参照。
- **デプロイ**: Pi5 → raspberrypi4 → raspi4-robodrill01 の順に `--limit` で1台ずつ実行（Run ID `20260310-193632-10428` / `20260310-194407-20877` / `20260310-195055-32546`）。ブランチ `feat/due-mgmt-actual-hours-pipeline`。
- **実機検証結果**:
  - APIヘルス: 200 OK / `status: ok`
  - deploy-status: 両Pi4で `isMaintenance: false`
  - 納期管理API: triage / daily-plan / global-rank / global-rank/proposal / global-rank/learning-report / actual-hours/stats すべて 200
  - **global-rank targetLocation/rankingScope**: `GET /global-rank` で `targetLocation`, `actorLocation`, `rankingScope` 返却確認。`?targetLocation=第2工場&rankingScope=globalShared` および `rankingScope=localTemporary` で Mac 向けシナリオ動作確認
  - マイグレーション: 46件適用済み、未適用なし
  - Pi4サービス: 両端末で kiosk-browser.service / status-agent.timer が active
  - Pi3 signage: offline のためスキップ（deploy-status-recovery.md に準拠）
- **2回目デプロイ（feature flag 本番制御経路）**: `VITE_KIOSK_TARGET_LOCATION_SELECTOR_ENABLED` を web.env.j2 / Dockerfile.web / docker-compose.server.yml に追加（既定 `true`）。Pi5 → raspberrypi4 → raspi4-robodrill01 の順に1台ずつ実行（Run ID `20260310-205506-28891` / `20260310-205946-5022` / `20260310-210522-15455`）。実機検証: APIヘルス、deploy-status、納期管理API、global-rank targetLocation/rankingScope、Pi4サービス稼働を確認。feature flag の無効化は inventory / host_vars で `web_kiosk_target_location_selector_enabled: false` を指定可能（[mac-target-location-migration.md](../runbooks/mac-target-location-migration.md) 参照）。

### 全体順位表示拡張と実績工数列追加・デプロイ・実機検証（2026-03-11）

- **実装概要**:
  - **全体順位表示拡張**: 資源CDだけでなく、登録製番＋研削/切削フィルタ時も表示順位を 1..N に再採番するよう拡張。`isDisplayRankContext` を導入し、`isResourceRankFilterActive` を拡張（`ProductionSchedulePage.tsx`）
  - **実績工数列追加**: 生産スケジュールに `実績基準時間(分/個)`・`実績推定工数(分)` を追加。納期管理の全体ランキング・製番一覧・部品表に `実績推定工数(分)`・`実績カバー率(%)` を追加
- **デプロイ**: ブランチ `feat/global-rank-resource-local-display`。Pi5 → raspberrypi4 → raspi4-robodrill01 の順に `--limit` で1台ずつ実行（Run ID `20260311-090951-8646` / `20260311-091447-18995` / `20260311-092307-13455`）。合計約13分
- **実機検証結果**（[deploy-status-recovery.md](../runbooks/deploy-status-recovery.md) のチェックリスト準拠）:
  - APIヘルス: 200 OK / `status: ok`
  - deploy-status: 両Pi4で `isMaintenance: false`
  - キオスクAPI・生産スケジュールAPI・納期管理API（triage・daily-plan・global-rank・global-rank/proposal・global-rank/learning-report・actual-hours/stats）: すべて 200
  - global-rank: `targetLocation`, `actorLocation`, `rankingScope` 返却確認
  - actual-hours/stats: `totalRawRows`, `totalCanonicalRows`, `totalFeatureKeys`, `topFeatures` 返却確認
  - サイネージAPI: 200、layoutConfig 含む
  - backup.json: 存在・15K
  - マイグレーション: 46件、up to date
  - Pi4/Pi3サービス: 両Pi4で kiosk-browser.service / status-agent.timer が active、Pi3 signage-lite が active

### 進捗同期スコープ分離（2026-03-11）

- **背景**:
  - 日程更新用CSVと進捗管理用CSVのメール件名が同一で、従来実装では生産日程CSV取り込み時に `progress_sync` が一律で走り得た
  - `progress` 列が無いCSVでも `undefined -> '' -> isCompleted=false` と解釈され、手動完了の意図しない上書きリスクがあった
- **実装方針**:
  - `ProgressSyncEligibilityPolicy` を追加し、`progress` 列がマッピングされるCSVだけ `progress_sync` 対象に限定
  - `CsvDashboardIngestor` で同期前に判定し、対象外は取り込み成功のまま同期だけスキップ（理由をログ出力）
  - `ProgressSyncFromCsvService` に `hasProgressColumn` ガードを追加し、防御的に二重ガード
- **影響範囲**:
  - 日程更新用CSV（`progress` 列なし）: `ProductionScheduleProgress` を更新しない
  - 進捗管理用CSV（`progress` 列あり）: 従来どおり `updatedAt` 比較で新しいもののみ反映
  - ProductNo繰り上がり判定および DEDUP 挙動には影響しない
- **検証**:
  - `progress-sync-from-csv.service.test.ts`: `hasProgressColumn=false` で同期しないことを追加確認
  - `progress-sync-eligibility.policy.test.ts`: 生産日程＋`progress` 列有無の判定を追加確認

### 進捗同期スコープ分離・デプロイ・実機検証（2026-03-11）

- **デプロイ**: ブランチ `feat/global-rank-resource-local-display`、Pi5 → raspberrypi4 → raspi4-robodrill01 の順に1台ずつ実行（Run ID `20260311-115254-25003` / `20260311-115759-20603` / `20260311-120301-28447`）、約13分。
- **実機検証結果**:
  - APIヘルス: 200 OK / `status: ok`
  - deploy-status: 両Pi4で `isMaintenance: false`
  - キオスクAPI: loans/active・production-schedule 200
  - 納期管理API: triage・daily-plan・global-rank・actual-hours/stats 200
  - サイネージAPI: 200、layoutConfig 含む
  - backup.json: 存在・15K
  - マイグレーション: 46件、up to date
  - Pi4/Pi3サービス: 両Pi4で kiosk-browser.service / status-agent.timer が active、Pi3 signage-lite が active
- **知見**: 今回の変更はAPIのみ（DBスキーマ変更なし）のため、デプロイ対象は Pi5 のみでも十分。運用標準に従い Pi5 + Pi4×2 を1台ずつ順番デプロイした。
- **運用注意**: 日程更新用CSV（`progress` 列なし）を取り込んでも `ProductionScheduleProgress` は更新されない。進捗管理用CSV（`progress` 列あり）のみ同期対象。

### ロケーション間同期共有化（納期・備考・表面処理、2026-03-11）

- **背景**:
  - `完了status`（`ProductionScheduleProgress`）は location 非依存で同期される一方、`納期` / `備考` / `表面処理` は location 依存モデルで保持していたため、Mac と第2工場で値が分岐していた。
  - 現場要件として、上記3項目は端末・拠点を跨いで同一値を参照できる必要があった。
- **実装方針**:
  - 同期ジョブ追加ではなく、`ProductionScheduleRowNote` / `ProductionScheduleSeibanDueDate` / `ProductionSchedulePartProcessingType` を **shared（location 非依存）** に移行。
  - 競合解決は **Last-Write-Wins（`updatedAt` 優先）** を採用し、migration で重複データを畳み込み。
  - route 契約（APIパス・入力）は維持し、内部永続化のみ shared repository 経由へ差し替え。
- **実装詳細**:
  - Prisma migration `20260311133000_make_schedule_fields_shared` を追加。
  - `shared-schedule-fields.repository.ts` を新設し、write/read の共通永続化責務を集約。
  - `production-schedule-query` / `due-management-query` / `due-management-triage` で note/dueDate/processingType の location 絞り込みを除去。
  - `due-management-global-rank-auto` の「納期設定済み製番」判定も shared dueDate を参照するよう更新。
- **検証**:
  - API統合テスト `kiosk-production-schedule.integration.test.ts` にロケーション間共有回帰を追加（`row note/processing/dueDate`、`due-management dueDate/note/processing`）。
  - 実行結果: `49 passed`。
  - lint: `apps/api` / `apps/web` ともに成功。
- **デプロイ・実機検証（2026-03-11）**:
  - **デプロイ**: Pi5 → raspberrypi4 → raspi4-robodrill01 の順に1台ずつ実行（Run ID `20260311-124752-19099` / `20260311-125302-686` / `20260311-125806-26510`）、約13分。
  - **実機検証結果**: APIヘルス（`status: degraded`、メモリ96.1%は既知の環境要因）、deploy-status（両Pi4で `isMaintenance: false`）、キオスクAPI、生産スケジュールAPI、納期管理API（triage・daily-plan・global-rank・global-rank/proposal・global-rank/learning-report・actual-hours/stats）、global-rank の `targetLocation`/`actorLocation`/`rankingScope` 返却、actual-hours/stats の `totalRawRows`/`totalCanonicalRows`/`totalFeatureKeys`/`topFeatures` 返却、サイネージAPI（layoutConfig 含む）、backup.json（15K）、マイグレーション（47件、up to date）、Pi4/Pi3サービス（kiosk-browser.service / status-agent.timer / signage-lite すべて active）を確認。チェックリストは [deploy-status-recovery.md](../runbooks/deploy-status-recovery.md) を参照。

### 全体ランキング自動調整（安全ガード付き、2026-03-14）

- **目的**:
  - 全体ランキング（工程/行の実行順）を、日次で自動改善する。
  - 人手は最小化しつつ、悪化時は自動ロールバックする。
- **実装概要**:
  - `auto-tuning` モジュールを追加（候補生成 / 評価 / ガード / ロールバック / 日次オーケストレーション）。
  - スコア計算は既存 `due-management-scoring.service` を維持し、調整値（重み + 閾値）だけ外部化。
  - 安定版パラメータ・履歴・失敗履歴をDBへ保存:
    - `ProductionScheduleDueManagementTuningStableSnapshot`
    - `ProductionScheduleDueManagementTuningHistory`
    - `ProductionScheduleDueManagementTuningFailureHistory`
  - 既存決定イベントに `reasonCode`（選択式5項目）を追加し、手動微調整理由を記録可能化。
- **運用仕様（初期値）**:
  - 実行頻度: 1日1回（`DUE_MGMT_TUNING_CRON`, 既定 `15 2 * * *`）
  - 対象ロケーション: `DUE_MGMT_TUNING_LOCATIONS`（CSV指定）
  - 採用条件: 連続改善回数が閾値以上（`DUE_MGMT_TUNING_IMPROVEMENT_STREAK_REQUIRED`）
  - 特殊日除外: 明示日付（`DUE_MGMT_TUNING_EXCLUDED_DATES`）と週末除外（`DUE_MGMT_TUNING_EXCLUDE_WEEKENDS`）
  - 安全ガード: 重み変動量上限（`DUE_MGMT_TUNING_MAX_WEIGHT_DELTA`）
  - 失敗時: 直前安定版へ自動ロールバックし、失敗履歴に記録
- **互換性**:
  - API契約は維持（`/global-rank`, `/global-rank/auto-generate`）。
  - 手動並べ替えUIは維持。理由コードは任意入力（未指定でも従来動作）。
- **デプロイ・実機検証（2026-03-14）**:
  - **デプロイ**: ブランチ `feat/global-rank-auto-tuning-v1`、Pi5 → raspberrypi4 → raspi4-robodrill01 の順に1台ずつ実行、約12分。
  - **実機検証結果**: リモート自動チェック全項目合格（APIヘルス、deploy-status両Pi4、キオスクAPI、納期管理API、global-rank/proposal、PUT auto-generate、actual-hours/stats、サイネージAPI、backup.json、マイグレーション、Pi4×2・Pi3サービス）。Pi5 APIコンテナログで `Due management auto-tuning scheduler started` を確認。チェックリストは [deploy-status-recovery.md](../runbooks/deploy-status-recovery.md) を参照。

## リーダー順位ボード（納期ベース整列・手動順 API 反映、2026-04-01）

### 仕様（要約）

- **URL**: `/kiosk/production-schedule/leader-order-board`（キオスクヘッダー「順位ボード」から遷移）。
- **目的**: リーダーが **表示用納期**（`plannedDueDisplay` 系・納期管理ページと同趣旨）で資源グループ内の順を把握し、**行単位**で既存の **手動順番 API**（`ProductionScheduleOrderAssignment`・`PUT .../order`）および **完了 API**（**主経路**: `PUT .../:rowId/completion` + JSON `{ "intent": "complete" | "incomplete" }`・**互換**: `PUT .../complete` はトグル）へ即時反映する（2026-04-02 拡張。**一括「納期順で反映」ボタンは廃止**）。**完了の誤反転防止・CSV空progressとの整合**は [KB-375](./KB-375-kiosk-leaderboard-completion-integrity.md)。
- **境界**: ドメインロジックは `apps/web/src/features/kiosk/leaderOrderBoard/`（正規化・`sortLeaderBoardRowsForDisplay`・`filterLeaderBoardRowsByCompletion`・`mergeMachineNameFallback`・Vitest）。API は order に加え **明示完了**（`/completion`）を主経路とする（`/complete` は残置）。
- **沉浸式**: `usesKioskImmersiveLayout` に `KIOSK_LEADER_ORDER_BOARD_PATH_PREFIX` を含む（[KB-311](./KB-311-kiosk-immersive-header-allowlist.md) と併読）。

### 状態の永続化・資源順序同期・製番フィルタ連動（2026-04-29） {#leader-order-board-device-and-slot-sync-2026-04-29}

- **対象端末（deviceScopeKey）**: キオスク localStorage に **工場（siteKey）単位**で保存し、ページ再入室で復元する。端末一覧に存在しない保存値は破棄し **先頭端末へフォールバック**。
- **資源スロットの資源 CD 順（端末間）**: 既存の `GET/PUT …/manual-order-resource-assignments` の **`resourceCds` 配列の順序**を正とし、各端末で **デバウンス PUT** して共有する。**スロット本数（slotCount）は端末ローカル**のまま（localStorage）。**サーバ割当が空 `[]` でローカルに選択がある初回**は、誤って空配列で上書きしない（ローカルから PUT してサーバと整合してからマージ）。
- **製番カードと一覧の連動**: 左パネルで **OR 検索用の製番集合**（`selectedFseibanFilters`）をトグルし、同一画面の生産スケジュール検索条件 **`activeQueries` に反映**して順位ボード一覧を絞り込む（**`q` のカンマ区切りが OR**・既存 `useProductionScheduleQueryParams` と整合）。**納期アシストの詳細**は **単一 `selectedFseiban`** で従来どおり（一覧フィルタと責務分離）。詳細は下記 **§製番チップ・複数選択**。
- **参照実装**: `usePersistedLeaderBoardDeviceScope`・`useLeaderBoardResourceSlotsWithServerSync`・[`ProductionScheduleLeaderOrderBoardPage.tsx`](../../apps/web/src/pages/kiosk/ProductionScheduleLeaderOrderBoardPage.tsx)。

- **本番デプロイ・実機検証（2026-04-29）**:
  - **ブランチ**: `feat/kiosk-leaderboard-device-memory-and-slot-sync`（代表コミット **`ba2e8da8`**）。
  - **対象**: **`raspberrypi5` のみ**（`--limit raspberrypi5`。**Pi4/Pi3 個別デプロイ不要**・キオスク SPA は Pi5 `web` 配信）。
  - **コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh feat/kiosk-leaderboard-device-memory-and-slot-sync infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`。**複数ホスト運用では `--limit` を 1 台ずつ**。**Pi3 単体は資源僅少のため別手順（`deployment.md` の Pi3 節）**。
  - **Detach Run ID**（接頭辞 `ansible-update-`）: **`20260429-114156-3453`**（**`PLAY RECAP` `failed=0` / `unreachable=0` / リモート `exit` `0`**・所要 **約 928s**。**Docker 再ビルド**含む）。
  - **自動実機検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **24s**・Tailscale）。

- **知見**: 複数端末間の資源順共有は **`manual-order-resource-assignments` の `resourceCds` 並び**のみ。**スロット本数・端末選択はローカル**に留め、DB/API を増やさない。

- **トラブルシュート**:
  - **サーバ割当マージ直後に古いローカル順で PUT が上書きしうる**: `lastPushedSigRef` 等でフェッチ済みより古い順序での PUT を抑止。**再現時**はブラウザの PUT 順と `useLeaderBoardResourceSlotsWithServerSync` を確認。
  - **製番未選択への遷移で一覧が絞られたまま**: `selectedFseibanFilters` を空にすると `activeQueries` も **空へ**（`ProductionScheduleLeaderOrderBoardPage` の同期 `useEffect`）。
  - **資源変更後ドロップダウンが不整合**: 一覧に無い **`selectedResourceCd` はクリア**。
  - **デプロイ fail-fast**: 未コミット・未追跡は [KB-200](./infrastructure/ansible-deployment.md#kb-200-デプロイ標準手順のfail-fastチェック追加とデタッチ実行ログ追尾機能)。

### 製番チップ・複数選択（OR）・全解除（2026-04-29） {#leader-board-seiban-or-filter-2026-04-29}

- **仕様**:
  - **トグル**: 登録済み製番チップを押すたびに **OR 検索集合**へ追加／除去（同じ製番を再押しで解除）。
  - **一覧**: **`selectedFseibanFilters`** を `ProductionScheduleLeaderOrderBoardPage` で **`searchConditions.activeQueries`** と同期（**`q` のカンマ区切りが OR**）。

  - **localStorage 復元**: hook 初期化に **`initialSeibanFilters: searchConditions.activeQueries`** を渡し、画面専用ストアの **`activeQueries`** と整合。

  - **納期詳細**: **`selectedFseiban`** は納期アシスト API・モーダル用の **単一製番**（一覧フィルタと分離）。

  - **全解除**: **製番 OR 検索のみ**空にする（履歴チップは残す・研削/切削・資源スロットは維持）。

  - **履歴整合**: 共有 `search-state` 取得後（**`searchStateQuery.isSuccess`**）、**履歴に存在しない製番はフィルタから除去**（初回ロード競合を避ける）。
- **参照実装**: [`leaderBoardSeibanFilterModel.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/leaderBoardSeibanFilterModel.ts)·[`useLeaderBoardDueAssist.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/useLeaderBoardDueAssist.ts)·[`LeaderBoardLeftToolStack.tsx`](../../apps/web/src/features/kiosk/leaderOrderBoard/LeaderBoardLeftToolStack.tsx)·[`ProductionScheduleLeaderOrderBoardPage.tsx`](../../apps/web/src/pages/kiosk/ProductionScheduleLeaderOrderBoardPage.tsx)。

- **本番デプロイ・実機検証（2026-04-29）**:
  - **ブランチ**: `feat/leaderboard-seiban-multiselect-or-clear`（代表コミット **`d26b50d3`**）。
  - **対象**: **`raspberrypi5` のみ**（`--limit raspberrypi5`。**Pi4/Pi3 個別デプロイ不要**）。
  - **コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh feat/leaderboard-seiban-multiselect-or-clear infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`。
  - **Detach Run ID**（接頭辞 `ansible-update-`）: **`20260429-123438-30137`**（**`failed=0` / `unreachable=0` / exit `0`**・所要 **約 348s**）。
  - **自動実機検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **23s**・Tailscale）。

- **トラブルシュート**:
  - **OR に入れたいのに一覧が変わらない**: Network で **`GET …/kiosk/production-schedule` のクエリ `q`**（カンマ区切り）を確認。
  - **詳細が空で開けない**: 先にチップで製番を選択するか **登録**して `selectedFseiban` を付与。

### 順位ボード製番登録と進捗一覧の共有履歴同期（2026-04-29） {#leaderboard-progress-overview-shared-history-sync-2026-04-29}

- **背景**: 順位ボードで触った製番が **進捗一覧** に現れないことがあった。進捗一覧の製番集合は **サーバ共有の製番履歴**／**progress-overview の `scheduled`/`unscheduled`** と整合している一方、順位ボード側で **フィルタのみ先行**すると共有履歴へ **まだ載っていない**状態になりうる。
- **仕様（要約）**:
  - **フィルタ ON**: 共有履歴に無い製番は **先に `addSeibanToHistory`**（`useLeaderBoardDueAssist`）。
  - **初回ハイドレート**: `search-state` 取得成功後、ローカル復元のみに残った製番を **順にサーバへ登録**（即時削除はしない）。`toggleFseibanFilter` は **async**。effect 依存に **`sharedHistory`** を含め、取得遅延時も **再剪定**しやすくする。
  - **共有履歴更新後**: `writeHistory` 成功で **`kiosk-production-schedule-progress-overview`** を invalidate（`useKioskSharedSearchHistoryActions`）。
  - **進捗一覧**: **`scheduled` + `unscheduled`** をカード表示・フィルタ候補に反映（`ProductionScheduleProgressOverviewPage`）。納期未割当製番は **`unscheduled`**。
- **参照実装**: [`leaderBoardSharedHistoryGate.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/leaderBoardSharedHistoryGate.ts)·[`useLeaderBoardDueAssist.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/useLeaderBoardDueAssist.ts)·[`useKioskSharedSearchHistoryActions.ts`](../../apps/web/src/features/kiosk/productionSchedule/useKioskSharedSearchHistoryActions.ts)·[`ProductionScheduleProgressOverviewPage.tsx`](../../apps/web/src/pages/kiosk/ProductionScheduleProgressOverviewPage.tsx)·[`ProductionScheduleLeaderOrderBoardPage.tsx`](../../apps/web/src/pages/kiosk/ProductionScheduleLeaderOrderBoardPage.tsx)。

- **本番デプロイ・実機検証（2026-04-29）**:
  - **ブランチ**: `fix/leaderboard-seiban-registration-sync`（代表コミット **`b4afb2d7`**）。
  - **対象**: **`raspberrypi5` のみ**（`--limit raspberrypi5`。**Pi4/Pi3 個別デプロイ不要**）。
  - **コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh fix/leaderboard-seiban-registration-sync infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`。
  - **Detach Run ID**（接頭辞 `ansible-update-`）: **`20260429-143937-21499`**（**`failed=0` / `unreachable=0` / exit `0`**）。
  - **自動実機検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**。

- **トラブルシュート**:
  - **順位ボードで選んだ製番が進捗一覧に出ない**: Network で **`GET …/search-state`** の製番集合と **`GET …/progress-overview`** の応答を確認。**履歴に無い製番**は本修正どおり **`addSeibanToHistory` 経由でサーバへ載るまで**一覧側とずれることがある。
  - **`scheduled` に無く `unscheduled` にだけある**: 製番レベル納期が無いケースとして仕様どおり。**フィルタ候補**は両バケツを見る。

### 備考モーダルから製番登録（共有履歴）（2026-04-29） {#leader-order-board-note-modal-seiban-register-2026-04-29}

- **目的**: カード上に **製番登録専用ボタンを増やさず**、備考（鉛筆）モーダル内から **当該行の製番を共有履歴へ登録**できるようにする（テンキー／検索以外の導線）。
- **仕様（要約）**:
  - **トリガー**: 順位ボード各行の鉛筆 → **備考モーダル**で **「製番登録」**（小型ボタン・説明文なし）。
  - **対象製番**: モーダルを開いた行の **`row.fseiban`** を **`noteModalTargetFseiban`** に保持（モーダルクローズでクリア）。
  - **登録処理**: [`useLeaderBoardDueAssist`](../../apps/web/src/features/kiosk/leaderOrderBoard/useLeaderBoardDueAssist.ts) の **`registerSeibanToSharedHistory`**（内部は **`addSeibanToHistory`** のみ・一覧フィルタ／詳細の選択状態は変えない）。
  - **成功後**: **`closeNoteModal()`** でモーダルを閉じる（**備考本文の保存はしない**。ユーザーが「保存」を押したときのみ既存の **`commitNote`** 経路）。
  - **無効化**: **`dueAssist.historyWriting`** または製番が空のとき。
  - **汎用 UI**: [`KioskNoteModal`](../../apps/web/src/components/kiosk/KioskNoteModal.tsx) の **`extraAction`**（他画面は未指定で従来どおり）。
- **参照実装**: [`ProductionScheduleLeaderOrderBoardPage.tsx`](../../apps/web/src/pages/kiosk/ProductionScheduleLeaderOrderBoardPage.tsx)·[`useLeaderBoardDueAssist.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/useLeaderBoardDueAssist.ts)·[`useKioskSharedSearchHistoryActions.ts`](../../apps/web/src/features/kiosk/productionSchedule/useKioskSharedSearchHistoryActions.ts)·[`KioskNoteModal.tsx`](../../apps/web/src/components/kiosk/KioskNoteModal.tsx)·[`KioskNoteModal.test.tsx`](../../apps/web/src/components/kiosk/KioskNoteModal.test.tsx)。

- **本番デプロイ・実機検証（2026-04-29）**:
  - **ブランチ**: `feat/leaderboard-seiban-register-modal-close`（代表コミット **`a3265139`**）。
  - **対象**: **`raspberrypi5` のみ**（`--limit raspberrypi5`。**Pi4/Pi3 個別デプロイ不要**）。
  - **コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh feat/leaderboard-seiban-register-modal-close infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`。
  - **Detach Run ID**（接頭辞 `ansible-update-`）: **`20260429-184211-20335`**（**`failed=0` / `unreachable=0` / exit `0`**・所要 **約 405s**）。
  - **自動実機検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（所要 **約 90s**・Tailscale）。
  - **未完了検証**: 認証済み順位ボードで **鉛筆** → **製番登録** → **左パネル履歴反映** を現場目視する。

- **トラブルシュート**:
  - **製番登録を押しても何も起きない**: Network で **`PUT …/search-state`** が **`428`（If-Match 欠如）**や **`409`（競合）**になっていないか確認。競合時は既存フックが **リベースしてリトライ**するが、連続失敗時は **`historyWriting`** が続きボタンが **`disabled`** のままになり得る → **ページ再読込**。
  - **登録したのに他画面の製番チップに出ない**: **`GET …/search-state`** のポーリング間隔（最大数秒）や **ブラウザキャッシュ**を疑う。**強制リロード**後に左パネル履歴を確認。

### 表示中製番一覧パネル（共有履歴トグル）（2026-04-29） {#leader-board-seiban-list-panel-2026-04-29}

- **目的**: **現在フィルタ後に順位ボードへ表示されている製番**だけを、テンキー入力なしで共有製番履歴へ **一括登録／解除**できるようにする。
- **仕様（要約）**:
  - **入口**: 左パネル「製番検索」行の **「製番一覧」** → 右半画面オーバーレイ [`LeaderBoardSeibanListPanel`](../../apps/web/src/features/kiosk/leaderOrderBoard/LeaderBoardSeibanListPanel.tsx)。
  - **対象集合**: [`buildLeaderBoardSortedGrouped`](../../apps/web/src/features/kiosk/leaderOrderBoard/buildLeaderBoardViewModel.ts) の結果をフラット化し、**`fseiban` で一意**（先勝ちで **`machineName`** を採用）。[`deriveVisibleSeibanEntries`](../../apps/web/src/features/kiosk/leaderOrderBoard/deriveVisibleSeibanEntries.ts)。
  - **トグル**: [`toggleSeibanInSharedHistory`](../../apps/web/src/features/kiosk/leaderOrderBoard/useLeaderBoardDueAssist.ts) — 共有履歴に **無ければ `addSeibanToHistory`**、**あれば `removeFromHistory`**（チップの × と同様に **OR フィルタ／詳細対象も整合**）。
  - **見た目（追補 2026-04-29）**: **共有履歴登録済み**は **グレーアウト**、未登録は **シアン系の境界線**でコントラストを確保。
  - **並べ替え（追補 2026-04-29）**: **共有履歴に登録済みの製番を先頭**に、その後は製番文字列の昇順（[`sortVisibleSeibanEntriesForDisplay`](../../apps/web/src/features/kiosk/leaderOrderBoard/sortVisibleSeibanEntriesForDisplay.ts)）。
  - **接頭辞フィルタ（追補 2026-04-29）**: パネル上部に **現在の接頭辞表示（最大9桁相当の固定幅）**と **次に続けられる文字のみ**のボタン（[`collectNextPrefixChars`](../../apps/web/src/features/kiosk/leaderOrderBoard/collectSeibanPrefixCharset.ts)）。押下で接頭辞を延長し（**最大9桁**）、一覧は **`fseiban.startsWith(prefix)`** で絞り込み。**末尾削除**（ミスタイプ修正）・**全解除**でリセット。状態遷移の正本: [`leaderBoardSeibanPrefixFilterActions.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/leaderBoardSeibanPrefixFilterActions.ts)。パネル閉鎖時も接頭辞はクリア。
  - **レイアウト（追補 2026-04-29）**: パネル横幅を **約2倍**（`w-[min(100vw,84rem)]`、`max-w-[92vw]` 維持）。接頭辞の **表示／操作ボタン／次文字ボタン**を **縦方向に分割**し余白を確保。一覧は **`grid-cols-1` / `sm:grid-cols-3`**。
  - **オーバーレイ**: **`z-[85]`**・背景クリック／**Esc**／ヘッダー「閉じる」で閉じる。
- **参照実装**: [`ProductionScheduleLeaderOrderBoardPage.tsx`](../../apps/web/src/pages/kiosk/ProductionScheduleLeaderOrderBoardPage.tsx)·[`LeaderBoardLeftToolStack.tsx`](../../apps/web/src/features/kiosk/leaderOrderBoard/LeaderBoardLeftToolStack.tsx)·[`LeaderBoardSeibanListPanel.tsx`](../../apps/web/src/features/kiosk/leaderOrderBoard/LeaderBoardSeibanListPanel.tsx)·[`deriveVisibleSeibanEntries.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/deriveVisibleSeibanEntries.ts)·[`useKioskSharedSearchHistoryActions.ts`](../../apps/web/src/features/kiosk/productionSchedule/useKioskSharedSearchHistoryActions.ts)·[`sortVisibleSeibanEntriesForDisplay.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/sortVisibleSeibanEntriesForDisplay.ts)·[`collectSeibanPrefixCharset.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/collectSeibanPrefixCharset.ts)·[`leaderBoardSeibanPrefixFilterActions.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/leaderBoardSeibanPrefixFilterActions.ts)。

- **本番デプロイ・実機検証（2026-04-29・初回・製番一覧パネル本体）**:
  - **ブランチ**: `feat/leaderboard-seiban-list-panel`（代表コミット **`f544a45c`**）。
  - **対象**: **`raspberrypi5` のみ**（`--limit raspberrypi5`。**Pi4/Pi3 個別デプロイ不要**）。
  - **コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh feat/leaderboard-seiban-list-panel infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`。
  - **Detach Run ID**（接頭辞 `ansible-update-`）: **`20260429-193317-26767`**（**`failed=0` / `unreachable=0` / exit `0`**・所要 **約 436s**）。
  - **自動実機検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（所要 **約 88s**・Tailscale）。
  - **未完了検証**: 認証済み順位ボードで **製番一覧の開閉**・**トグル登録/解除**・**左パネル履歴整合** を現場目視する。

- **本番デプロイ・実機検証（2026-04-29・追補・接頭辞UI改修／末尾削除／全解除／3列／9桁表示）**:
  - **ブランチ**: `feat/leaderboard-seiban-panel-layout-and-prefix-controls`（代表コミット **`74d360b6`**）。
  - **対象**: **`raspberrypi5` のみ**（`--limit raspberrypi5`。**Pi4/Pi3 個別デプロイ不要**）。
  - **コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh feat/leaderboard-seiban-panel-layout-and-prefix-controls infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`。
  - **Detach Run ID**（接頭辞 `ansible-update-`）: **`20260429-210617-3239`**（**`failed=0` / `unreachable=0` / exit `0`**）。
  - **自動実機検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（所要 **約 139s**・Tailscale）。

- **本番デプロイ・実機検証（2026-04-29・追補・接頭辞フィルタ／並べ替え／コントラスト／横幅）**:
  - **ブランチ**: `feat/leaderboard-seiban-panel-prefix-filter`（代表コミット **`900cb141`**）。
  - **対象**: **`raspberrypi5` のみ**（`--limit raspberrypi5`。**Pi4/Pi3 個別デプロイ不要**）。
  - **コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh feat/leaderboard-seiban-panel-prefix-filter infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`。
  - **Detach Run ID**（接頭辞 `ansible-update-`）: **`20260429-202355-27582`**（**`failed=0` / `unreachable=0` / exit `0`**）。
  - **自動実機検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（所要 **約 106s**・Tailscale）。

- **トラブルシュート**:
  - **パネルに製番が出ない**: **一覧が空**／**完了フィルタ**で行が消えている。**ページネーション超過**で見えている範囲外の製番は [`deriveVisibleSeibanEntries`](../../apps/web/src/features/kiosk/leaderOrderBoard/deriveVisibleSeibanEntries.ts) に **現れない**（現状仕様）。
  - **接頭辞が進められない**: **次文字ボタンが無い**ときは、現在の接頭辞では **一致する製番が無いか、完全一致のみ**（これ以上の深化なし）。**全解除**からやり直す。**末尾削除**で1文字戻す。
  - **トグルが効かない**: **`historyWriting`** または **`PUT …/search-state` が競合連続** → **ページ再読込**。

### 行アクション・機種名フォールバック（2026-04-02）

- **完了**: 各行の ✓ ボタンで生産スケジュール画面と同様に完了／未完了を切替。表示上の完了は `rowData.progress === '完了'` と同期（`LeaderBoardRow.isCompleted`）。
- **完了フィルタ**: 左端ドロワーに **両方 / 未完 / 完了**。**クライアント側のみ**で行一覧を絞り込み（API 変更なし）。
- **資源内順位**: 各行のドロップダウンで `processingOrder`（1〜10、空き番のみ）を **変更したら即 PUT**。**`-`（空選択）** で手動順を解除し、**納期＋安定タイブレーク**の自動並びに戻す。表示ソートは **`processingOrder` ありを常に先**（同一資源内で手動番号昇順、未設定どうしは納期順）。
- **機種名（MH/SH）**: スケジュール行だけでは `machineName` が空になりうるため、`GET .../history-progress` の `progressBySeiban` から **製番キー**で `machineName` を補完（`buildSeibanMachineNameMapFromProgressBySeiban` + `mergeMachineNameFallback`）。履歴側にも無い製番は空のまま。
- **React Query**: **完了**成功時は `kiosk-production-schedule-order-usage` に加え **`kiosk-production-schedule-due-management-manual-order-overview`** も invalidate（手動順番俯瞰と整合）。**資源内順位（PUT order）**については順位ボードのみ後述の **fast path** で一覧・usage の full invalidate を省略（生産スケジュール／手動順番画面は従来どおり full invalidate）。
- **参照実装**: `ProductionScheduleLeaderOrderBoardPage.tsx`・`LeaderOrderResourceCard.tsx`・`LeaderOrderRowOrderSelect.tsx`・`useKioskProductionScheduleHistoryProgress`・`useKioskProductionScheduleOrderUsage`。

### 順位変更キャッシュ高速化（leaderBoardFastPath、2026-04-02）

- **目的**: Pi4 等で順位ドロップダウン変更後の **大きい生産スケジュール一覧の再 GET** と **`manual-order-overview` の無効化**を避け、体感遅延を抑える（Web のみ・API 契約不変）。
- **仕様**:
  - `useUpdateKioskProductionScheduleOrder` の mutation 変数に `cachePolicy?: 'default' | 'leaderBoardFastPath'`。**省略時は `default`**（従来: `kiosk-production-schedule` / `order-usage` / `manual-order-overview` を invalidate）。
  - **`leaderBoardFastPath`**（`ProductionScheduleLeaderOrderBoardPage` が `useProductionScheduleMutations` に `productionScheduleOrderCachePolicy: 'leaderBoardFastPath'` を渡す）:
    - **onMutate**: 一覧キャッシュ・`order-usage` を楽観パッチ（純粋関数は `apps/web/src/features/kiosk/productionSchedule/cache/kioskProductionScheduleOrderCachePatch.ts`）。**一覧キャッシュ上で対象 `rowId` が特定できないときは `order-usage` を楽観パッチしない**（誤った占有表示を避ける）。
    - **onSuccess**: PUT 応答の `orderNumber` で一覧を再整合。**成功後はいずれのクエリも invalidate しない**（他端末との厳密同期は既存の schedule / usage **ポーリング**に委ねる）。
    - **onError**: onMutate 前スナップショットでロールバック。
- **デプロイ・実機検証（2026-04-02）**:
  - **ブランチ**: `feat/kiosk-leader-order-board-order-cache-fast-path`。
  - **手順**: [deployment.md](../guides/deployment.md) の `update-all-clients.sh`。**対象**: `raspberrypi5` → Pi4 キオスク 4 台（**Pi3 除外**・1 台ずつ `--limit`）。**本番反映後**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 40 / WARN 0 / FAIL 0**（Mac / Tailscale・本セッション実測）。
- **知見**: 遅延の主因は **順位 PUT 後のフル一覧 refetch** になりやすい。表示件数だけ UI で絞っても **pageSize が大きい限り**転送・パース負荷は残るため、キャッシュ戦略の方が効きやすい。
- **トラブルシューティング**:
  - **別のキオスクで順位占有表示が数秒〜数十秒古い**: fast path は意図的に invalidate しない。最大でも **ポーリング間隔**（schedule 30s / usage 15s 等）までの差は起こりうる。即時全体整合が必要なら **生産スケジュール本体**で同操作すると `default` policy で再取得される。
  - **順位 PUT が失敗したのに一覧だけ楽観更新された**: onError でロールバックする設計。継続する場合はネットワークログと API 応答を確認。

### UX polish: leader order board (2026-04-02)

- **目的**: 順位ボード子行の **読みやすさ**（個数表記・機種名整合）と **沉浸式 UI の操作性**（ヘッダー／左ドロワー／ホバー開閉系の反応速度）。**Web のみ**・API 契約不変。
- **仕様**:
  - **個数**: `formatPlannedQuantityInlineJa`（[`plannedDueDisplay.ts`](../../apps/web/src/features/kiosk/productionSchedule/plannedDueDisplay.ts)）で **`n個`**。欠損・NaN は **非表示**（FSEIBAN 横に出さない）。納期管理テーブル等の **`formatPlannedQuantityLabel`（数値のみ）は変更しない**。
  - **配置**: [`LeaderOrderResourceCard.tsx`](../../apps/web/src/features/kiosk/leaderOrderBoard/LeaderOrderResourceCard.tsx) で FSEIBAN 右横に個数、子行の縦余白を軽く詰め、資源カード `min-h` を一段下げ（`12rem`）。
  - **機種名**: [`presentLeaderOrderRow`](../../apps/web/src/features/kiosk/leaderOrderBoard/leaderOrderRowPresentation.ts) で **`machineName` のみ** [`normalizeMachineName`](../../apps/web/src/features/kiosk/productionSchedule/machineName.ts)（他キオスク画面と同趣旨の半角大文字化）。`machineTypeCode` / `fhincd` は従来どおり。**追記（2026-04-02）**: 子行の **製番優先レイアウト**により `productNo` は **表示しない**。詳細は後続の **Leader order board: child row layout** 節。
  - **開閉スピード**: [`kioskRevealUi.ts`](../../apps/web/src/hooks/kioskRevealUi.ts) に **`KIOSK_REVEAL_TRANSFORM_TRANSITION_CLASS`**（`duration-100`）と **`KIOSK_REVEAL_CLOSE_DELAY_MS`（200）** を集約。[`KioskLayout.tsx`](../../apps/web/src/layouts/KioskLayout.tsx) の沉浸式ヘッダー・[`ProductionScheduleLeaderOrderBoardPage.tsx`](../../apps/web/src/pages/kiosk/ProductionScheduleLeaderOrderBoardPage.tsx) の左ドロワーが同一 transition を参照。[`useTimedHoverReveal`](../../apps/web/src/hooks/useTimedHoverReveal.ts) の遅延閉じも同一定数。**トレードオフ**: `useTimedHoverReveal` を使う **手動順番下ペイン・要領書ツールバー・生産スケジュール検索帯** 等も **同じ閉じ待ち**になり、全体的に速く感じる／誤閉じが増えたら `kioskRevealUi.ts` の定数だけ調整する。
- **デプロイ・実機検証（2026-04-02）**:
  - **ブランチ**: `feat/kiosk-leader-order-board-ux-polish`。
  - **手順**: [deployment.md](../guides/deployment.md) の `update-all-clients.sh`。**Pi5 → Pi4×4** を **`--limit` 1 台ずつ**（**Pi3 除外**）。
  - **自動実機検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 40 / WARN 0 / FAIL 0**（Mac / Tailscale・本セッション）。
- **知見**: 表示の一貫性は **`normalizeMachineName` の適用範囲**（今回は機種名フィールドのみ）で調整。開閉は **1 モジュールの定数**に寄せると沉浸式とホバーツールバーが同期し運用判断がしやすい。
- **トラブルシューティング**:
  - **個数が出ない**: `plannedQuantity` が null の行では仕様どおり非表示。CSV 補助・API の `plannedQuantity` を疑う。
  - **バーが閉じすぎる**: `KIOSK_REVEAL_CLOSE_DELAY_MS` を 200→280ms 程度へ、`duration-100` を `duration-150` へ、など **単一定数**で緩める。

### Leader order board: opaque left panel (2026-04-29) {#leader-order-board-opaque-left-panel-2026-04-29}

- **目的**: 左端ホバーで開く **操作パネル**と **納期アシスト詳細**（第2シート）で、**半透明＋`backdrop-blur`** がページ背景グラデと重なり文字が読みづらかった問題を解消する。**Web のみ**・API 契約不変。
- **仕様**:
  - **左 `aside`（操作パネル）**: `bg-slate-950`（従来 `bg-slate-950/98`）。**製番検索内枠**: `bg-slate-900`（従来 `bg-white/5`）。
  - **納期アシスト**: `bg-slate-900`（従来 `bg-slate-900/95` + `backdrop-blur-md` を撤去）。**テーブル見出し（sticky）**: `bg-slate-900` で同色に揃える。
- **デプロイ・実機検証（2026-04-29）**:
  - **ブランチ**: `fix/kiosk-leaderboard-left-panel-opaque-bg`（コミット **`93e111c3`**）。
  - **手順**: [deployment.md](../guides/deployment.md) の `update-all-clients.sh`。**対象**: **`raspberrypi5` のみ**（**Pi3/Pi4 不要**）。
  - **Detach Run ID**（`ansible-update-`）: **`20260428-212925-25339`**（**`failed=0` / `unreachable=0` / exit `0`**）。
  - **自動実機検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **151s**）。
- **知見**: キオスク沉浸式画面は **装飾レイヤ**（`ProductionScheduleLeaderOrderBoardPage` の `radial-gradient`）の上にパネルを載せる。**ガラス表現（`/95` + `backdrop-blur`）** は現場環境では **コントラスト不足**になりやすい。読むテキスト面は **`bg-*` のアルファなし**または **実質不透明**を優先し、レイヤごと統一すると sticky との境もぶれない。
- **トラブルシューティング**: 体感が変わらないときは Pi5 **`web`** の **再ビルド**可否（`Rebuild/Restart docker compose services` が走ったか）と **ブラウザのハード再読込**を確認。**デプロイ前 fail-fast**: [KB-200](./infrastructure/ansible-deployment.md#kb-200-デプロイ標準手順のfail-fastチェック追加とデタッチ実行ログ追尾機能)。

### Leader order board: default completion filter incomplete (2026-04-30) {#leader-order-board-default-completion-filter-incomplete-2026-04-30}

- **目的**: 順位ボード左ペインの **完了フィルタ**（両方／未完／完了）の **初回表示**を **未完優先**にそろえ、オープン直後から **未完了行に集中**できるようにする。**Web のみ**・API・DB・共有状態の契約は不変。
- **仕様**:
  - [`ProductionScheduleLeaderOrderBoardPage`](../../apps/web/src/pages/kiosk/ProductionScheduleLeaderOrderBoardPage.tsx) で **`useState<LeaderOrderCompletionFilter>('incomplete')`**（従来 `'all'`）。
  - フィルタ値は [`filterLeaderBoardRowsByCompletion`](../../apps/web/src/features/kiosk/leaderOrderBoard/filterLeaderBoardRowsByCompletion.ts) 経由で [`buildLeaderBoardSortedGrouped`](../../apps/web/src/features/kiosk/leaderOrderBoard/buildLeaderBoardViewModel.ts) に渡る。**「両方」「完了」**への切り替えは従来どおり。
- **デプロイ・実機検証（2026-04-30）**:
  - **ブランチ**: `feat/kiosk-leaderboard-default-incomplete`（コミット **`e8d3943f`**）。
  - **手順**: [deployment.md](../guides/deployment.md) の `update-all-clients.sh`。**対象**: **`raspberrypi5` のみ**（**Pi3/Pi4 不要**）。
  - **Detach Run ID**（`ansible-update-`）: **`20260430-184641-30513`**（**`failed=0` / `unreachable=0` / exit `0`**・**`ok=130` `changed=4`**）。
  - **自動実機検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **153s**・Tailscale）。
- **知見**: 既定 UI 状態は **URL や localStorage に永続していない**限り **`useState` 初期値**がそのまま効く。キオスクは **キャッシュ**の影響を受けやすいため、反映確認は **強制リロード**を先に試すと早い。
- **トラブルシューティング**:
  - **開いた瞬間に完了行も並ぶ**: 古いバンドル／キャッシュを疑い **強制リロード**、Pi5 `web` のデプロイ取り込みコミットを確認。
  - **一覧が空**: **未完行がゼロ**のときは仕様どおり。**「両方」**へ切り替えて完了行を表示。

### Leader order board: 過去納期・資源035滞留調査（2026-06-01 · 調査中断） {#leader-order-board-stale-past-due-investigation-2026-06-01}

- **症状**: 資源 CD **`035`** などで **数か月前の表示納期**が順位ボードに残る（例: **`AA1S2M02`** / `2025-12-18`）。
- **調査結論（技術）**: アプリは **古い納期を除外せず**、**`FKOJUNST` 最新が `S/R` なら未完表示** — **バグではなく仕様 + 上流状態**。API 母集団の期限切れ **55 件**のうち、**初期「未完」フィルタで目立つのは `S/R`+未完 11 件**（`C/X`+完了 44 件は通常非表示）。
- **打ち切り**: **コード変更なし**・実装は **上流確認後**に **「長期滞留・要確認」分離**のみ検討。**強制完了・ProductNo 伝播完了・3 キー緩和・一括非表示は禁止**。
- **正本**: [KB-383](./KB-383-kiosk-leaderboard-stale-past-due-investigation.md)（上流確認リスト 11 件・本番 DB 集計・仮説ログ全文）。

### Leader order board: seiban visibility UX（資源進捗列・左ペイン2列・行左アクセント）（2026-05-01） {#leader-order-board-ux-seiban-accent-2026-05-01}

- **目的**: 順位ボードで **登録製番**と **納期アシスト内の工程進捗**を読みやすくし、製番で絞り込んだ行を **左縁アクセント**で一目で追いやすくする。**Web のみ**・API / DB 契約は不変。
- **仕様（要約）**:
  - **進捗チップ**: 生産スケジュール進捗一覧と共有の [`KioskResourceProcessChips`](../../apps/web/src/components/kiosk/resourceProgress/KioskResourceProcessChips.tsx)（一覧側は [`ProgressOverviewPartRow`](../../apps/web/src/components/kiosk/progressOverview/ProgressOverviewPartRow.tsx) から委譲）。
  - **納期アシスト**: [`LeaderBoardDueAssistPanel`](../../apps/web/src/features/kiosk/leaderOrderBoard/LeaderBoardDueAssistPanel.tsx) に **資源進捗**列・**横スクロール**。
  - **左ペイン**: [`LeaderBoardLeftToolStack`](../../apps/web/src/features/kiosk/leaderOrderBoard/LeaderBoardLeftToolStack.tsx) の **`w-72`**・登録製番 **`grid-cols-2`**・チップ大型化。
  - **製番フィルタ時の行強調**: [`seibanAccentPalette.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/seibanAccentPalette.ts) で **安定配色**、`ProductionScheduleLeaderOrderBoardPage` → `LeaderBoardGrid` → `LeaderOrderResourceCard` → `LeaderOrderResourceRow` へ **`activeQueries`** を伝播。**回帰**: [`seibanAccentPalette.test.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/__tests__/seibanAccentPalette.test.ts)。
- **デプロイ・実機検証（2026-05-01）**:
  - **ブランチ**: `feat/kiosk-leader-order-board-ux`（代表コミット **`84abca0b`**）。
  - **手順**: [deployment.md](../guides/deployment.md) の `update-all-clients.sh`・**`export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`**・**`--detach --follow`**。**対象**: **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`** を **`--limit` 1 台ずつ**。**Pi3 は除外**（ユーザー指定運用どおり）。
  - **Detach Run ID**（`ansible-update-`）: **`20260501-224248-30928`** / **`20260501-224814-26947`** / **`20260501-225329-28559`** / **`20260501-225740-4207`** / **`20260501-230236-8738`**（いずれも **`PLAY RECAP` `failed=0` / `unreachable=0` / exit `0`**）。
  - **自動実機検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **67s**・Tailscale）。
- **知見**: **`activeQueries`** は **クエリ駆動の「どの製番で絞っているか」**の単一ソースに寄せ、アクセントは **製番ごとにハッシュ安定色**へマップすると列が増えても見通しが保てる。**チップは 1 コンポーネント**にまとめると進捗一覧と納期アシストの **見え方ドリフト**を抑えられる。
- **トラブルシューティング**:
  - **アクセントが付かない**: **製番が空／無効でないか**確認。**2026-05-22 以降**: **全件表示（OR フィルタ OFF）では左縁なしが仕様** — 色が欲しい場合は **登録製番チップを押して OR フィルタ ON**（[§全件無色](#leader-order-board-seiban-accent-no-color-all-items-2026-05-22)）。**2026-05-02〜2026-05-21**: クエリ空でも製番行に付く（旧仕様）。旧 SPA の場合は **強制リロード**と Pi5 **`web`** / Pi4 **`kiosk-browser`** 更新を確認。
  - **納期アシストが横に伸びない / 進捗列が無い**: 古い SPA を疑う → Pi5 `web` と各 Pi4 **`kiosk-browser`** 再起動ログ・`/opt/RaspberryPiSystem_002` の **ブランチ**を確認。**デプロイ前 fail-fast**: [KB-200](./infrastructure/ansible-deployment.md#kb-200-デプロイ標準手順のfail-fastチェック追加とデタッチ実行ログ追尾機能)。

### Leader order board: 製番左縁アクセント 24 色（全件表示のハッシュ配色拡張）（2026-05-20） {#leader-order-board-seiban-accent-palette-24-2026-05-20}

- **Context（調査起点）**: 現場観測では **登録製番 OR フィルタ ON（同時 ~5 件）** では **同一製番が資源 CD スロット横断で同色**に見え、識別性は十分。**OR フィルタ OFF（全件表示）** では製番数に対し **8 色しか使われず**、**色被り**と **amber/orange・cyan/sky** 等の **近似色** により左縁だけでは製番を追いにくい。**バグではなく配色設計の限界**（[2026-05-02 常時化](#leader-order-board-seiban-accent-always-progress-resource-strip-2026-05-02) 時点の `% 8` ハッシュ仕様）。**スロット横断同色**のロジック自体は [`resolveSeibanAccentRowClass`](../../apps/web/src/features/kiosk/leaderOrderBoard/seibanAccentPalette.ts) が **`fseiban` 単位**で決定しており **変更不要**。
- **Decision（2026-05-20）**: **登録製番 OR フィルタ経路は現状維持**（先頭 8 色・リスト順割当）。**全件表示のみ**パレットを **8 → 24** に拡張しハッシュ分母を `% 24` へ。**履歴順固定色**・**近似色の再整理**は第2弾候補（未実装）。**API / DB 契約不変**。**Web のみ**。**（2026-05-22 追記）**: 全件表示のハッシュ着色は [§全件無色](#leader-order-board-seiban-accent-no-color-all-items-2026-05-22) で **撤回**。本節の **OR フィルタ向け 24 色パレット**は **維持**。
- **データフロー（着色契約）**:
  1. [`ProductionScheduleLeaderOrderBoardPage.tsx`](../../apps/web/src/pages/kiosk/ProductionScheduleLeaderOrderBoardPage.tsx) が **`activeQueries`**（製番 OR フィルタ文字列配列）を保持。
  2. `LeaderBoardGrid` → `LeaderOrderResourceCard` → [`LeaderOrderResourceRow.tsx`](../../apps/web/src/features/kiosk/leaderOrderBoard/LeaderOrderResourceRow.tsx) へ **`activeQueries` と行の `fseiban`** を伝播。
  3. 各行で **`resolveSeibanAccentRowClass(fseiban, activeQueries)`** を呼び、返却 Tailwind クラスを行コンテナ **`border-l-*`** に適用。
  4. **同一 `fseiban` は常に同一インデックス** → **全資源 CD スロットで同色**（フィルタ ON/OFF いずれも）。
- **モード別仕様**:

  | 条件 | インデックス決定 | 現場での見え方 |
  |------|------------------|----------------|
  | **`activeQueries` 空（全件表示）** | `seibanAccentPaletteIndexForString(fseiban) % 24`（FNV-1a） | 製番ごとに安定色。**8 色時代と色は変わり得る**（分母変更） |
  | **フィルタ 1 件以上・製番がリスト内** | `filters.indexOf(fseiban) % 24` | **1 番目〜8 番目は 2026-05-01 以前と同色**（先頭 8 色固定） |
  | **フィルタ 1 件以上・製番がリスト外** | ハッシュ `% 24` | リスト外行の補助色 |
  | **`fseiban` 空白** | `undefined` | 左縁なし |

- **パレット（`SEIBAN_ROW_ACCENT_PALETTE`・24 色・リテラル列挙）**:
  - **1〜8（不変・OR フィルタ ~5 件向け）**: amber-400 / cyan-400 / rose-400 / violet-400 / emerald-400 / orange-400 / sky-400 / fuchsia-400。
  - **9〜17（追加 400 系）**: red / yellow / lime / green / teal / blue / indigo / purple / pink。
  - **18〜24（追加 300 系）**: red / yellow / lime / green / blue / indigo / purple。
  - **実装**: [`seibanAccentPalette.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/seibanAccentPalette.ts)。**回帰**: [`seibanAccentPalette.test.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/__tests__/seibanAccentPalette.test.ts)（安定性・インデックス 0〜23・先頭 8 色順序不変）。
- **Git / マージ**:
  - **ブランチ**: `feat/kiosk-seiban-accent-palette-24`（実装 **`be936a6e`**）。
  - **PR**: [#307](https://github.com/denkoushi/RaspberryPiSystem_002/pull/307)（squash マージ **`f8c1f6d2`**）。
- **デプロイ・実機検証（2026-05-20）**:
  - **手順**: [deployment.md](../guides/deployment.md#kiosk-leaderboard-seiban-accent-palette-24-2026-05-20)·**`export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`**·`./scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --limit <host> --detach --follow`（**マージ後は `main`**）。**デプロイ前**: ローカル git **クリーン**必須（`update-all-clients.sh` fail-fast）。
  - **対象（1 台ずつ）**: **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`**。**Pi3**: **`skipping: no hosts matched`**（**Pi5 `web` SPA 配信** + Pi4 **`kiosk-browser` 再起動**のみ。**Pi3 専用手順は未実施で正**）。
  - **Detach Run ID**（`ansible-update-`）: **`20260520-141147-19965`**（Pi5·**`ok=134` `changed=4`**·Docker compose 再起動）/ **`20260520-141629-31940`**（Pi4·**`ok=122` `changed=10`**）/ **`20260520-142108-13167`**（robodrill·**`ok=122` `changed=9`**）/ **`20260520-142440-24963`**（fjv60-80·**`ok=122` `changed=9`**）/ **`20260520-142830-16409`**（StoneBase01·**`ok=129` `changed=10`**）。いずれも **`failed=0` / `unreachable=0` / exit `0`**。
  - **自動実機検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **31s**・Tailscale·Pi5 API `100.106.158.2`）。**`deploy-status`（Pi4×4）**: すべて **PASS**。
  - **現場目視（任意）**: [verification-checklist.md](../guides/verification-checklist.md#kiosk-leaderboard-seiban-accent-24-verification-2026-05-20) §6.6.23。
- **知見**:
  - **「色を増やすだけ」で全件表示の識別性は改善**するが、**24 色でも被りは残る**（製番数 ≫ 24）。**OR フィルタ ~5 件**は **先頭 8 色不変**のため **運用変更なし**。
  - **全件表示で色が変わる**のは **意図したトレードオフ**（`% 8` → `% 24`）。**同一製番のスロット横断一致**は維持。
  - **Pi5 `web` 再ビルドが必須**。Pi4 単体デプロイだけでは SPA バンドルが更新されない。
  - **第2弾候補（未実装・ユーザー判断待ち）**: (1) 近似色の整理、(2) **登録済み製番の履歴順固定色**（フィルタ OFF 時のみ）、(3) パレット以外の視覚手がかり（製番ラベル強調等）。
- **トラブルシューティング**:
  - **全件表示で左縁が無い** → **2026-05-22 以降は仕様**（[§全件無色](#leader-order-board-seiban-accent-no-color-all-items-2026-05-22)）。**2026-05-21 以前**の旧 SPA・**製番空行**を確認。
  - **色が 8 色時代のまま / 更新されない** → Pi5 `/opt/RaspberryPiSystem_002` の **ref が `f8c1f6d2` 以降**か、**`docker compose` で `web` 再ビルド**済みか。キオスク **強制リロード**（§6.6.4）。
  - **OR フィルタ ON（1〜5 件）で 1〜5 色目が変わった** → **先頭 8 色不変**のはず。**ref / キャッシュ**を疑う。
  - **OR フィルタ 9 件以上** → 9 色目以降は **新パレット**（通常運用 ~5 件では該当しにくい）。
  - **`verify-phase12-real.sh` のみ `deploy-status` FAIL** → 全台 `--limit` 完走後に再実行（[KB-369](./KB-369-leader-order-board-api-internal-latency.md)）。
- **関連**: [deployment §2026-05-20](../guides/deployment.md#kiosk-leaderboard-seiban-accent-palette-24-2026-05-20)·[EXEC_PLAN.md](../../EXEC_PLAN.md) Progress / Decision Log·[2026-05-01 UX 導入](#leader-order-board-ux-seiban-accent-2026-05-01)·[2026-05-02 常時化](#leader-order-board-seiban-accent-always-progress-resource-strip-2026-05-02)。**後続（2026-05-22）**: 全件表示のハッシュ着色は [§全件無色](#leader-order-board-seiban-accent-no-color-all-items-2026-05-22) で **撤回**（OR フィルタ ON 時の 24 色パレットは **維持**）。

### Leader order board: 製番左縁アクセント — 全件表示は無色・OR フィルタ時のみ色分け（2026-05-22） {#leader-order-board-seiban-accent-no-color-all-items-2026-05-22}

- **Context（調査起点）**: [§24色（2026-05-20）](#leader-order-board-seiban-accent-palette-24-2026-05-20) で全件表示（`activeQueries` 空）の識別性を **パレット 8→24 + ハッシュ `% 24`** で改善したが、現場では **製番数 ≫ 24** のため **色被り・近似色（amber/orange・cyan/sky 等）** が残り、**左縁だけでは製番を追えない**。**一方、登録製番 OR フィルタ ON（同時 ~5 件）** では **リスト順の 1〜N 色目**で **同一製番が資源 CD スロット横断で同色**に見え、識別性は十分。
- **Decision（2026-05-22 · 方針 A）**: **キオスク Web のみ**、**全件表示（OR フィルタ未選択）では左縁色を付けない**。**登録製番チップ押下（OR フィルタ ON）** 時は [§24色](#leader-order-board-seiban-accent-palette-24-2026-05-20) **どおり現状維持**（先頭 8 色固定·リスト外製番はハッシュ `% 24`）。**サイネージ JPEG**（`kiosk_leader_order_cards`）は **変更しない** — [`leader-order-seiban-accent-palette.ts`](../../apps/api/src/services/signage/leader-order-cards/leader-order-seiban-accent-palette.ts) が **常にハッシュ 24 色**（フィルタ状態の概念なし）。
- **用語（UI ↔ 実装）**:

  | ユーザー表現 | 実装上の条件 | 左ペイン表示 |
  |--------------|--------------|--------------|
  | **登録製番チップ押下** | `activeQueries` / `selectedFseibanFilters` に **1 件以上** | チップ **emerald 強調**·`OR検索: n件（…）` |
  | **押下なしの全件表示** | 上記が **空** | `OR検索: なし` — 資源スロット·完了フィルタ等のみ |

  - 順位ボード左ペインに **「登録製番」単一ラベルのボタンはない**。相当 UI は **登録済み製番チップ列**（[`LeaderBoardLeftToolStack.tsx`](../../apps/web/src/features/kiosk/leaderOrderBoard/LeaderBoardLeftToolStack.tsx)）。生産スケジュールの **「登録製番 (n/m)」** ドロップダウンは **別 UI**（`history` / `activeQueries` は search-state で端末間共有）。
- **仕様（着色契約 · 2026-05-22 以降）**:

  | 条件 | `resolveSeibanAccentRowClass` の返却 | 行コンテナ CSS |
  |------|--------------------------------------|----------------|
  | **`fseiban` 空白** | `undefined` | `px-2`（左縁なし） |
  | **`activeFilters` 空（全件表示）** | **`undefined`**（2026-05-22 変更） | `px-2` |
  | **フィルタ 1 件以上・製番がリスト内** | `filters.indexOf(fseiban) % 24` → 先頭 8 色は 2026-05-01 以前と同色 | `pl-2 pr-2` + `border-l-4 border-l-*` |
  | **フィルタ 1 件以上・リスト外** | ハッシュ `% 24` | 同上 |
  | **同一 `fseiban`** | 資源 CD スロット横断で **常に同色**（フィルタ ON 時） | — |

- **データフロー（不変）**:
  1. [`ProductionScheduleLeaderOrderBoardPage.tsx`](../../apps/web/src/pages/kiosk/ProductionScheduleLeaderOrderBoardPage.tsx) — `searchConditions.activeQueries` ⇔ `dueAssist.selectedFseibanFilters`。
  2. `LeaderBoardGrid` → `LeaderOrderResourceCard` → [`LeaderOrderResourceRow.tsx`](../../apps/web/src/features/kiosk/leaderOrderBoard/LeaderOrderResourceRow.tsx)。
  3. 各行: **`resolveSeibanAccentRowClass(row.fseiban, activeSeibanFilters ?? [])`**。
  4. **`seibanAccentRowClass` が `undefined`** のとき行は **`px-2`**（色あり時は **`pl-2 pr-2`** + 左縁クラス）。
- **実装（最小変更 · Web のみ）**:
  - [`seibanAccentPalette.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/seibanAccentPalette.ts) — `filters.length === 0` で **`return undefined`**（2026-05-20 までの **ハッシュ `% 24` 返却を撤回**）。
  - **24 色パレット列挙**・**`seibanAccentPaletteIndexForString`** は **OR フィルタ ON 時**および **リスト外フォールバック**で **引き続き使用**（削除しない）。
  - **回帰**: [`seibanAccentPalette.test.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/__tests__/seibanAccentPalette.test.ts) — `filters empty` → **`toBeUndefined()`**。
  - **触らない**: API / DB·サイネージ SVG·Pi4 Ansible 契約（**Pi5 `web` 再ビルド + Pi4 `kiosk-browser` 再起動**でキオスク反映）。
- **Git / 本番**:
  - **ブランチ**: `feat/kiosk-leaderboard-seiban-accent-no-color-all-items`（実装 **`44777ac7`** — `fix: hide leader board seiban accent on all-items view`）。
  - **本番（2026-05-22 · Pi5→Pi4×4 · 1 台ずつ）**:

    | ホスト | Detach Run ID | PLAY RECAP |
    |--------|---------------|------------|
    | `raspberrypi5` | `20260522-211412-3634` | `ok=134` `changed=4` `failed=0` |
    | `raspberrypi4` | `20260522-212202-22657` | `ok=122` `changed=10` `failed=0` |
    | `raspi4-robodrill01` | `20260522-212817-24357` | `ok=122` `changed=9` `failed=0` |
    | `raspi4-fjv60-80` | `20260522-213340-9415` | `ok=122` `changed=9` `failed=0` |
    | `raspi4-kensaku-stonebase01` | `20260522-213908-14986` | `ok=129` `changed=10` `failed=0` |

  - **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --limit <host> --detach --follow`（**マージ後 `main`**）。
  - **自動実機検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（本記録 **約 139s**·Tailscale）。
  - **Pi3**: **`skipping: no hosts matched`**（Pi5 SPA 配信 + Pi4 再起動のみ·**Pi3 専用手順は未実施で正**）。
- **知見**:
  - **「色を増やす」より「絞ったときだけ色を使う」**方が、全件表示の **視覚ノイズ**を減らし、2026-05-01 導入時の **「製番で絞った行を左縁で追う」** 意図に近い。
  - **24 色拡張（2026-05-20）の主目的（全件識別）は本変更で不要**になったが、**OR 9 件以上**・**リスト外製番**のフォールバックとして **パレット自体は残す**。
  - **キオスクとサイネージの意図的分岐**: サイネージは **常に未完行の集合**を表示し **フィルタ UI がない**ため、**左縁 24 色ハッシュを維持**（方針 A）。キオスク全件とサイネージで **左縁の有無が異なる**のは **仕様**。
  - **Pi5 `web` 再ビルド必須**。Pi4 単体だけでは SPA バンドルが更新されない（[§24色 知見](#leader-order-board-seiban-accent-palette-24-2026-05-20) と同趣旨）。
- **トラブルシューティング**:
  - **全件表示で左縁色が付いている** → 旧 SPA（**`44777ac7` より前**）·Pi5 **`web`** ref·**強制リロード**（[verification-checklist §6.6.4](../guides/verification-checklist.md)）。
  - **OR フィルタ ON なのに色が付かない** → **製番空行**·`activeQueries` が空のまま（チップ未押下）·ref 確認。
  - **OR フィルタ 1〜5 色目が 24 色導入前と違う** → **先頭 8 色不変**のはず。**ref / キャッシュ**を疑う（[§24色](#leader-order-board-seiban-accent-palette-24-2026-05-20)）。
  - **サイネージだけ左縁色がある** → **仕様**（方針 A）。キオスク全件無色と **揃えない**。
  - **§6.6.23 の「全件で色種類が増えている」チェック** → **2026-05-22 以降は [§6.6.28](../guides/verification-checklist.md#kiosk-leaderboard-seiban-accent-no-color-all-items-verification-2026-05-22) を正**とする。
- **関連**: [deployment §2026-05-22 全件無色](../guides/deployment.md#kiosk-leaderboard-seiban-accent-no-color-all-items-2026-05-22)·[verification-checklist §6.6.28](../guides/verification-checklist.md#kiosk-leaderboard-seiban-accent-no-color-all-items-verification-2026-05-22)·[EXEC_PLAN.md](../../EXEC_PLAN.md)·[§24色（履歴）](#leader-order-board-seiban-accent-palette-24-2026-05-20)·[KB-335 §サイネージ左縁24色](./infrastructure/signage.md#kb-335-キオスク順位ボード資源cdカードkiosk_leader_order_cardsサイネージ-jpeg)。


- **目的**: 順位ボードで **登録済み製番行**をクエリ状態に依存せず **左縁の安定配色**で追いやすくする。進捗一覧では **製番カード単位**で工程を跨いだ **資源CDの完了集約チップ帯**を一目で読めるようにする。**Web のみ**・API / DB 契約は不変。
- **仕様（要約）**:
  - **順位ボード左縁**: [`seibanAccentPalette.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/seibanAccentPalette.ts) は **`activeQueries` が空でも**有効な **`fseiban`** に **ハッシュ由来のクラス**を付与（**製番ブランクのみ** `undefined`）。[`LeaderBoardGrid.tsx`](../../apps/web/src/features/kiosk/leaderOrderBoard/LeaderBoardGrid.tsx) の製番強調状態とドキュメント整合。**回帰**: [`seibanAccentPalette.test.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/__tests__/seibanAccentPalette.test.ts)。
  - **進捗一覧**: [`collectAggregatedProgressOverviewResourceProcesses.ts`](../../apps/web/src/features/kiosk/productionSchedule/collectAggregatedProgressOverviewResourceProcesses.ts) が **`resourceProcesses` を資源ごとに AND 完了**でまとめ、**`resourceCd` 昇順**・安定 **`rowId`**。型 **`AggregatedProgressOverviewResourceProcess`** は **features で定義**し、presentation レイヤへの型逆流を避ける。[`ProgressOverviewSeibanCard.tsx`](../../apps/web/src/components/kiosk/progressOverview/ProgressOverviewSeibanCard.tsx) のヘッダ直下に [`KioskResourceProcessChips`](../../apps/web/src/components/kiosk/resourceProgress/KioskResourceProcessChips.tsx)。**回帰**: [`collectAggregatedProgressOverviewResourceProcesses.test.ts`](../../apps/web/src/features/kiosk/productionSchedule/__tests__/collectAggregatedProgressOverviewResourceProcesses.test.ts)。
- **デプロイ・実機検証（2026-05-02）**:
  - **ブランチ**: `feat/kiosk-seiban-accent-and-progress-resource-strip`（代表コミット **`924a2ff4`**）。
  - **手順**: [deployment.md](../guides/deployment.md) の `update-all-clients.sh`・**`export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`**・**`--detach --follow`**。**対象**: **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`** を **`--limit` 1 台ずつ**。**Pi3 は除外**。
  - **Detach Run ID**（`ansible-update-`）: **`20260502-094331-28033`** / **`20260502-094916-31090`** / **`20260502-095506-23348`** / **`20260502-095947-26960`** / **`20260502-100443-16279`**（いずれも **`PLAY RECAP` `failed=0` / `unreachable=0` / exit `0`**）。
  - **自動実機検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **114s**・Tailscale）。
- **知見**: 順位ボードのアクセントを **クエリ入力の有無から切り離す**と、「登録済みだが検索クエリ無し」の行も **同色で追える**。進捗側の資源チップは **純関数集約 + 一覧と共有コンポーネント**に寄せると、カード先頭での **一覧との見え方の一貫性**が保てる。
- **後続（2026-05-20）**: 本節導入時点の **`% 8` ハッシュ**は全件表示で被りが目立つため、**パレット 24 色拡張**を実施（[§24色](#leader-order-board-seiban-accent-palette-24-2026-05-20)）。**OR フィルタ ~5 件**の先頭 8 色は **本節から不変**。**（2026-05-22）**: 全件表示の左縁着色自体を [§全件無色](#leader-order-board-seiban-accent-no-color-all-items-2026-05-22) で **撤回** — 本節の「クエリ空でも色」は **2026-05-02〜2026-05-21 の履歴**。
- **トラブルシューティング**:
  - **`raspi4-kensaku-stonebase01`** のデプロイで **barcode-agent 待機が一時 RETRYING** が出ても、Ansible が **その後収束して `failed=0`** の場合がある（複合 Docker エージェント構成・リソース競合時）。異常終了時は該当ホストの **`docker compose ps`** / エージェントログを確認。
  - UI が旧のまま → [verification-checklist.md](../guides/verification-checklist.md) §6.6.4 **強制リロード**・Pi5 **`web`** 再構築の有無。

### Leader order board: 行下辺・製番単位の資源進捗チップ帯（2026-05-02） {#leader-order-board-row-footer-resource-chips-2026-05-02}

- **目的**: 順位ボードの **各資源行の直下**に、進捗一覧の製番カードと同様の **製番キー別・資源CD集約チップ**を出し、一覧を開かずに **工程完了状況を横スクロールで追える**ようにする。**Web のみ**・API / DB 契約は不変。
- **仕様（要約）**:
  - **データ**: [`useKioskProductionScheduleProgressOverview`](../../apps/web/src/api/hooks.ts) の **`scheduled` / `unscheduled`** を入力に、[`buildLeaderBoardFooterResourceChipsBySeiban`](../../apps/web/src/features/kiosk/leaderOrderBoard/collectLeaderBoardFooterResourceChips.ts) で **製番（trim）→ `KioskResourceChipData[]`** の `ReadonlyMap` を構築（進捗一覧の [`collectAggregatedProgressOverviewResourceProcesses`](../../apps/web/src/features/kiosk/productionSchedule/collectAggregatedProgressOverviewResourceProcesses.ts) と同様の **資源ごとの AND 完了**・**`resourceCd` 昇順**）。
  - **伝播**: [`ProductionScheduleLeaderOrderBoardPage.tsx`](../../apps/web/src/pages/kiosk/ProductionScheduleLeaderOrderBoardPage.tsx) で **`useMemo`** → [`LeaderBoardGrid.tsx`](../../apps/web/src/features/kiosk/leaderOrderBoard/LeaderBoardGrid.tsx) → [`LeaderOrderResourceCard.tsx`](../../apps/web/src/features/kiosk/leaderOrderBoard/LeaderOrderResourceCard.tsx) → 行の **`fseiban`** で lookup。
  - **表示**: [`LeaderOrderResourceRow.tsx`](../../apps/web/src/features/kiosk/leaderOrderBoard/LeaderOrderResourceRow.tsx) **下辺**に [`KioskResourceProcessChips`](../../apps/web/src/components/kiosk/resourceProgress/KioskResourceProcessChips.tsx)、**`flex-nowrap`** と横スクロール用ラッパ（カード下辺ヘッダ重复を避けるため **行側**に載せる）。
  - **回帰**: [`collectLeaderBoardFooterResourceChips.test.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/__tests__/collectLeaderBoardFooterResourceChips.test.ts)。
- **デプロイ・実機検証（2026-05-02）**:
  - **ブランチ**: `fix/leaderboard-row-footer-resource-chips`（代表コミット **`16911165`**）。
  - **手順**: [deployment.md](../guides/deployment.md) の `update-all-clients.sh`・**`export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`**・**`--detach --follow`**。**対象**: **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`** を **`--limit` 1 台ずつ**。**Pi3 は除外**。
  - **Detach Run ID**（`ansible-update-`）: **`20260502-105130-11663`** / **`20260502-105758-25070`** / **`20260502-110434-28709`** / **`20260502-110923-18185`** / **`20260502-111424-3838`**（いずれも **`PLAY RECAP` `failed=0` / `unreachable=0` / exit `0`**）。
  - **自動実機検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **130s**・Tailscale）。
- **知見**: カード単位のフッターより **行単位**にチップ帯を載せると、**複数行カード**でも **製番ごとの帯が一意**に付き、グルーピング都合のヘッダ重複を避けられる。集約ロジックは **進捗一覧と共有の純関数**に寄せると仕様ドリフトが減る。
- **トラブルシューティング**:
  - **チップが空**: 当該製番に **進捗 overview の `resourceProcesses` が無い**場合は仕様どおり。データは overview 取得に依存。
  - **表示が古い**: [verification-checklist.md](../guides/verification-checklist.md) §6.6.4 **強制リロード**・`deploy-status`・Pi5 / Pi4 の **取り込みブランチ**。

### Leader order board: progress-overview 部品行キーでの資源チップ結合・進捗一覧 `part.processes` 復元（2026-05-02） {#leader-order-board-resource-chips-part-key-overview-join-2026-05-02}

- **背景**: [行下辺チップ節](#leader-order-board-row-footer-resource-chips-2026-05-02) までは **製番単位**で進捗 overview から **`resourceProcesses` を AND 集約**していた。**部品行が複数**ある製番では、進捗一覧の **各部品行の `part.processes`** と **粒度が一致しない**問題があった。
- **仕様（要約）**:
  - **進捗一覧**: [**`progressOverviewPresentation`**](../../apps/web/src/features/kiosk/productionSchedule/progressOverviewPresentation.ts)・[**`ProgressOverviewPartRow`**](../../apps/web/src/components/kiosk/progressOverview/ProgressOverviewPartRow.tsx) で **部品行ごとに `part.processes`** を **[`KioskResourceProcessChips`](../../apps/web/src/components/kiosk/resourceProgress/KioskResourceProcessChips.tsx)** 表示へ復元。
  - **API**: [**`progress-overview-query.service.ts`**](../../apps/api/src/services/production-schedule/progress-overview-query.service.ts) が部品行のルックアップキーを **`productNo` + `fhincd`**（および製番側の join キー）に統一。
  - **順位ボード**: [**`buildLeaderBoardPartResourceProcessKey`**](../../apps/web/src/features/kiosk/leaderOrderBoard/buildLeaderBoardPartResourceProcessKey.ts) で **`seibanJoinKey`・`productNo`・`fhincd`** から安定キーを生成し、[**`collectLeaderBoardFooterResourceChips`**](../../apps/web/src/features/kiosk/leaderOrderBoard/collectLeaderBoardFooterResourceChips.ts) が **各部品行スコープ**の `resourceProcesses` を **`ReadonlyMap` の値**として保持。[`ProductionScheduleLeaderOrderBoardPage.tsx`](../../apps/web/src/pages/kiosk/ProductionScheduleLeaderOrderBoardPage.tsx)・[`LeaderBoardGrid.tsx`](../../apps/web/src/features/kiosk/leaderOrderBoard/LeaderBoardGrid.tsx)・[`LeaderOrderResourceCard.tsx`](../../apps/web/src/features/kiosk/leaderOrderBoard/LeaderOrderResourceCard.tsx) へ伝搬。
  - **Prisma**: 変更なし（クエリ応答組み立てのみ）。
- **デプロイ・実機検証（2026-05-02）**:
  - **ブランチ**: `fix/leaderboard-resource-chips-join-and-scope`（代表コミット **`44aea2d9`**）。
  - **手順**: [deployment.md](../guides/deployment.md) の `update-all-clients.sh`・**`export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`**・**`--detach --follow`**。**対象**: **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`** を **`--limit` 1 台ずつ**。**Pi3 は除外**。
  - **Detach Run ID**（`ansible-update-`）: **`20260502-125430-31676`** / **`20260502-130426-1173`** / **`20260502-131032-13145`** / **`20260502-131507-16128`** / **`20260502-132009-12509`**（いずれも **`PLAY RECAP` `failed=0` / `unreachable=0` / exit `0`**）。
  - **自動実機検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **152s**・Tailscale）。
- **知見**: **一覧（progress-overview）と順位ボードのチップは、集約関数の入力キーを部品行に揃える**と、「同じ製番・別部品」の取り違えを防げる。**API と Web でマップキー規約を二重に定義しない**よう、クエリ側の部品行キーを Web の **`buildLeaderBoardPartResourceProcessKey` と同趣旨に寄せた**。
- **トラブルシューティング**:
  - **実行環境で `update-all-clients.sh` が早い段階で失敗**: 手元の **事前 `git fetch origin …`** が **ネット未許可**だとブランチ解決できない。ネットワーク到達できる環境で **`git fetch`** してから **[再実行]**。
  - **チップは出るが中身が旧（製番一括のみ）**: Pi5 **`web` だけ**更新して **`api` が旧**だと overview の部品行構造だけ先行し得ないが、逆に **両方そろえる**まで観察。`deploy-status` と **コンテナ再起動ログ**で HEAD を確認。**強制リロード**: [verification-checklist.md](../guides/verification-checklist.md) §6.6.4。

### Leader order board: leaderboard 一覧へ行フッター工程チップを内包（2026-05-02） {#leader-order-board-leaderboard-footer-chips-contract-2026-05-02}

- **背景**: [progress-overview と部品行キーで結合する節](#leader-order-board-resource-chips-part-key-overview-join-2026-05-02) では、順位ボードが **一覧 + progress-overview の二重 GET** でフッター工程チップを組み立てていた。**一覧（`leaderboard` プロファイル）だけ**へ集約すると **ネットワークと Pi4 の再描画負荷**を抑えられる。
- **仕様（現行・要約）**:
  - **API**: キオスク生産スケジュール一覧の **`responseProfile=leaderboard`** 応答に **`leaderboardFooterChipsByPartKey`** を付与。**集約**は [`leaderboard-part-footer-processes.service.ts`](../../apps/api/src/services/production-schedule/leaderboard/leaderboard-part-footer-processes.service.ts)・キー規約 [`leaderboard-part-footer-chip-key.ts`](../../apps/api/src/services/production-schedule/leaderboard/leaderboard-part-footer-chip-key.ts)。組み込み経路 [`production-schedule-query.service.ts`](../../apps/api/src/services/production-schedule/production-schedule-query.service.ts)。
  - **Web**: [`ProductionScheduleLeaderOrderBoardPage.tsx`](../../apps/web/src/pages/kiosk/ProductionScheduleLeaderOrderBoardPage.tsx) が **`leaderboardFooterChipsByPartKey`** を [`collectLeaderBoardFooterResourceChips`](../../apps/web/src/features/kiosk/leaderOrderBoard/collectLeaderBoardFooterResourceChips.ts) に渡し **`partKey → chips` の `ReadonlyMap`** を構築。**順位ボード文脈では `useKioskProductionScheduleProgressOverview` を取得しない**。キャッシュ運用 [`kioskProductionScheduleListCache.ts`](../../apps/web/src/features/kiosk/productionSchedule/cache/kioskProductionScheduleListCache.ts)。
  - **完了ミューテーション後**: [`hooks.ts`](../../apps/web/src/api/hooks.ts) **`useCompleteKioskProductionScheduleRow`** が **`history-progress` と `progress-overview`** も **`invalidateQueries`** — 一覧以外の進捗画面との **即時整合**を維持。
  - **Prisma**: 変更なし。
- **デプロイ・実機検証（2026-05-02）**:
  - **ブランチ**: `feat/kiosk-leaderboard-footer-contract`（代表コミット **`a1be93a4`**。**`main` マージ後**は squash マージコミットを正とする）。
  - **手順**: [deployment.md](../guides/deployment.md) の **`update-all-clients.sh`**。**対象**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。**複数ホスト時は 1 台ずつ**。**Pi3 は除外**。
  - **Detach Run ID**（`ansible-update-`）: **`20260502-142341-11156`**（**`PLAY RECAP` `failed=0` / `unreachable=0` / exit `0`**・Pi4/Pi3 は **no hosts matched**）。
  - **自動実機検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **127s**・Tailscale）。
  - **性能追補（同日）**: API のフッター組み立てSQLを `targetKeys + matchedRows + winnerRows (DISTINCT ON)` へ変更したコミット **`1da74f2a`** を Pi5 のみ再デプロイ（Detach **`20260502-150239-22559`**）。Pi5 localhost 実測（`pageSize=400`）は **修正前** `leaderboard` **4.28–4.81s** / `full` **1.63–1.68s** → **修正後** `leaderboard` **1.40–1.43s** / `full` **1.61–1.82s**。応答契約（`leaderboardFooterChipsByPartKey`）の件数は維持。
- **知見**: **一覧に表示に必要な従属性を同梱**すると、`progress-overview` の **別エンドポイント全件**に依存しない。**invalidate の対象クエリキーは「一覧と矛盾しうるキャッシュ」を列挙**しておくと、楽観更新とキャッシュのみの画面が食い違いにくい。
- **トラブルシューティング**:
  - **チップ無しだが一覧は載る**: **`leaderboardFooterChipsByPartKey` が未定義または空**。API の **`leaderboard` 経路が旧**、`**web`** だけ先行等を疑う。**Pi5 で `api`/`web` ペア**を確認。
  - **[旧節・行下辺チップ](#leader-order-board-row-footer-resource-chips-2026-05-02) の記述と混同しない**: **現行順位ボードは overview フェッチ無し**。過去項は **`scheduled`/`unscheduled` から製番単位で集約**したフェーズの記録。

### Leader order board: 製番順評価モード（端末ローカルのみ）（2026-05-04） {#leader-order-board-seiban-priority-eval-mode-2026-05-04}

- **目的**: 順位ボードで **登録製番の並び**を、**他端末に影響を与えず**（共有履歴・サーバ順序はそのまま）**端末内だけ**で試し、**資源列内の表示順**に反映できるようにする。**Web のみ**・**API / Prisma / `search-state` 契約は不変**。
- **仕様（要約）**:
  - **左ペイン**（[`LeaderBoardLeftToolStack.tsx`](../../apps/web/src/features/kiosk/leaderOrderBoard/LeaderBoardLeftToolStack.tsx)）: **製番順評価**トグル。**ON 時の登録製番の並べ替え**は **[ランクピッカー（同日追補）](#leader-order-board-seiban-rank-picker-2026-05-04)**（**1…N** 選択・**↑↓ 廃止**）。
  - **永続化**: [`usePersistedLeaderBoardSeibanEval.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/usePersistedLeaderBoardSeibanEval.ts)・ストレージキーは [`constants.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/constants.ts)（**工場 + 端末スコープ**の `localStorage`）。
  - **データ合成**: [`mergeSharedHistoryWithLocalOrder.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/seibanPriority/mergeSharedHistoryWithLocalOrder.ts)·[`reorderSeibanInMergedList.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/seibanPriority/reorderSeibanInMergedList.ts)·[`buildSeibanRankMap.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/seibanPriority/buildSeibanRankMap.ts)。
  - **ソート**: **OFF** → 既存の資源列ソート（**納期・`processingOrder` 等**）。**ON** → 資源列内で **製番のローカル評価順を最優先**し、同順位帯は [`sortLeaderBoardRowsForSeibanEvalDisplay.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/sortLeaderBoardRowsForSeibanEvalDisplay.ts) から既存 **`compareLeaderBoardRowsForDisplay`** へ委譲。ビルドコンテキストは [`buildLeaderBoardViewModel.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/buildLeaderBoardViewModel.ts) の **`LeaderBoardRowSortContext`**。
  - **左ペインの製番一覧順**: **OFF** は **共有履歴順**、**ON** は **共有履歴とローカル評価順のマージ表示**（実装: `ProductionScheduleLeaderOrderBoardPage`）。
- **単体テスト**: `sortLeaderBoardRowsForSeibanEvalDisplay.test.ts`・`seibanPriority.pure.test.ts`・`buildLeaderBoardViewModel.test.ts` 拡張など。
- **本番デプロイ・実機検証（2026-05-04）**:
  - **ブランチ**: `feat/kiosk-seiban-priority-eval-mode`（代表 **`ffe250cb`**）。
  - **手順**: [deployment.md](../guides/deployment.md) の **`update-all-clients.sh`**・**`export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`**・**`--detach --follow`**。**対象**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。**Pi3 は対象外**（今回の Ansible limit では play 自体スキップ）。
  - **Detach Run ID**（`ansible-update-`）: **`20260504-203034-22339`**（**`PLAY RECAP` `ok=134` `changed=4` `failed=0` / `unreachable=0`**・exit **`0`**）。
  - **自動実機検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **156s**）。
- **知見**: 表示順の「試行」を **サーバに持ち込まない**ほうが、現場の一時並び替えと本番の手動順番 API の境界が曖昧にならない。**ランクは純粋関数でマップ化**してから既存比較器へ渡すと、テストが安定する。
- **トラブルシューティング**:
  - **評価 ON でも列の並びが変わらない**: **製番がその資源行に無い**・**同一製番のみ**・**既存ソートキーがすべて上流**で差が出ない場合は正常。**`web` バンドル**と **強制リロード**を確認。
  - **pre-commit で止まる**: **`import/order`** — `eslint-plugin-import` の **type/import グループ**に合わせ、`buildSeibanRankMap` 等を **同一グループ内の正しい位置**へ。

### Leader order board: 登録製番ランクピッカー（製番順評価 ON 時）（2026-05-04） {#leader-order-board-seiban-rank-picker-2026-05-04}

- **目的**: 製番順評価 ON 時に、**登録製番を目的ランクへ一発で移動**できるようにする（**多段 ↑↓ より誤操作が減る**）。**Web のみ**・**API / DB / `search-state` は不変**（[**製番順評価モード**](#leader-order-board-seiban-priority-eval-mode-2026-05-04)と同じ **端末ローカル `localStorage`**）。
- **仕様（要約）**:
  - **操作**: 左ペイン登録製番行の **先頭順位番号**タップ → **1…N** リスト（[`LeaderBoardSeibanRankPicker`](../../apps/web/src/features/kiosk/leaderOrderBoard/LeaderBoardSeibanRankPicker.tsx)）。**外側クリック**・**Esc** で閉じる。同じアンカー再タップでも閉じる。
  - **純関数**: 現在順と `targetRank1Based` から新しい製番配列を作る [`reorderSeibanToRank.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/seibanPriority/reorderSeibanToRank.ts)（Vitest: `seibanPriority.pure.test.ts`）。
  - **永続化**: [`usePersistedLeaderBoardSeibanEval.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/usePersistedLeaderBoardSeibanEval.ts) の **`moveRegisteredSeibanToRank(fseiban, targetRank1Based)`**（旧 **`moveRegisteredSeiban` は廃止**）。
  - **重なり順**: [`AnchoredDropdownPortal`](../../apps/web/src/components/kiosk/AnchoredDropdownPortal.tsx) の **`fixedZIndex`** と [`kioskRevealUi.ts`](../../apps/web/src/hooks/kioskRevealUi.ts) **`KIOSK_RANK_PICKER_Z_ABOVE_LEFT_STACK`**（左ツールスタックより前面）。
- **本番デプロイ・実機検証（2026-05-04）**:
  - **ブランチ**: `feat/leader-board-seiban-rank-picker`（代表 **`d4d6160c`**）。
  - **手順**: [deployment.md](../guides/deployment.md) の **`update-all-clients.sh`**。**対象**: **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`** を **`--limit` 1 台ずつ**。**Pi3 除外**。
  - **Detach Run ID**（`ansible-update-`）: **`20260504-211859-16303`** / **`20260504-212412-27756`** / **`20260504-212945-9891`** / **`20260504-213330-19891`** / **`20260504-213745-19344`**（各 **`failed=0` / `unreachable=0` / exit `0`**）。
  - **自動実機検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **60s**・Tailscale）。
- **知見**: 段階移動の矢印より **ランク直指定**のほうが、**長いリスト**で操作回数とミスタップが減る。**Portal の z-index** は左ペインの固定ツールスタックと **`kioskRevealUi` の定数**で揃えると、キオスクで隠れにくい。
- **トラブルシューティング**:
  - **ピッカーが見えない／背面**: `fixedZIndex`・`KIOSK_RANK_PICKER_Z_ABOVE_LEFT_STACK`・**強制リロード**（§6.6.4）。
  - **ピッカー左列が画面外** → [**左ペイン・ビューポートクランプ（2026-05-05）**](#leader-order-board-left-pane-viewport-clamp-2026-05-05)（`AnchoredDropdownPortal` の既定クランプ）。
  - **`AnchoredDropdownPortal` の型エラー（ref）**: アンカーの **型を `HTMLElement | null` の `MutableRefObject` に統一**（本変更で `anchorRef` / `panelRef` を緩和）。

### Leader order board: 手動順位付き行の背景ハイライト（案A改）（2026-05-22） {#leader-order-board-manual-order-row-highlight-2026-05-22}

> **2026-05-22 後半更新（正本）**: キオスク UI は **行背景ハイライトを撤回**し、**順位ドロップダウンのみ**強調に変更済み（[§行内順位ピッカー](#leader-order-board-row-order-rank-picker-2026-05-22)）。**サイネージ SVG の行背景ハイライト**（`LEADER_ORDER_SVG_ROW_BG_RANKED`）は **本節のとおり継続**。

- **目的（初回·2026-05-22 午前）**: **`processingOrder` が付与された未完行**を、同一スロット内の未設定行と区別しやすくする。**行ブロックのみ**背景を変更。**Web + サイネージ SVG** を同期する案。
- **現行仕様（キオスク Web · `949eea9c` 以降）**:
  - **行背景**: 常に **`bg-slate-800/80`**（`LeaderOrderResourceRow` — **`hasManualOrder` 分岐なし**）。
  - **順位 UI**: [**§行内順位ピッカー**](#leader-order-board-row-order-rank-picker-2026-05-22) を参照。
- **現行仕様（サイネージ API · 変更なし）**:
  - **条件**: **`processingOrder != null` かつ未完**（`hasManualOrder`）。
  - **色**: **`rgba(71, 85, 105, 0.82)`**（`LEADER_ORDER_SVG_ROW_BG_RANKED`）。
  - **実装**: `leader-board-pure.ts` → `leader-order-cards-svg-schedule-row.ts`。
- **経緯（キオスク）**:
  1. **`3acf4c5a`**（PR [#325](https://github.com/denkoushi/RaspberryPiSystem_002/pull/325)）: 行 **`bg-slate-600/82`** → **CSS 未生成**で背景透明（[§Tailwind `/82`](#leader-order-board-tailwind-opacity-82-pitfall-2026-05-22)）。
  2. **`f976bdd8`**（PR [#326](https://github.com/denkoushi/RaspberryPiSystem_002/pull/326)）: **`bg-slate-600/[0.82]`** → 実機で **行全体が明るすぎ**。
  3. **`949eea9c`**（PR [#327](https://github.com/denkoushi/RaspberryPiSystem_002/pull/327)）: 行背景を戻し **順位アンカーのみ**黄色強調 + 製番順位と同一 Portal。
- **本番デプロイ（初回·行背景案）**: Detach **`20260522-192111-31816`**（**`ok=134` `changed=4` `failed=0`**·約 **816s**）。**最終 UI** は Detach **`20260522-204821-6687`**（[§行内順位ピッカー](#leader-order-board-row-order-rank-picker-2026-05-22)）。
- **設計プレビュー（履歴）**: [leader-board-manual-order-row-highlight-preview.html](../design-previews/leader-board-manual-order-row-highlight-preview.html)（行背景案 — **キオスク不採用**）。
- **トラブルシューティング**:
  - **キオスク行全体が明るい** → **`949eea9c` 未反映**（旧行背景案）。
  - **サイネージのみ旧見た目** → Pi5 **`api`** 未更新（Pi3 単体デプロイ不可解）。
  - **`bg-slate-600/82` が効かない** → [§Tailwind `/82`](#leader-order-board-tailwind-opacity-82-pitfall-2026-05-22)。

### Leader order board: 行内順位ピッカー（製番順位 UI 統一）（2026-05-22） {#leader-order-board-row-order-rank-picker-2026-05-22}

- **目的**: 各行の **`processingOrder` 設定**を、左ペイン登録製番の順位ピッカーと **同一 UI**（アンカー + Portal 縦リスト）に統一。**資源カードサイズ不変**。2026-06-30 以降のアンカー寸法は `h-7 w-7`。
- **仕様**:
  - **対象ファイル**: [`LeaderOrderRowOrderSelect.tsx`](../../apps/web/src/features/kiosk/leaderOrderBoard/LeaderOrderRowOrderSelect.tsx) のみ。
  - **共通**: [`LeaderBoardRankPickerDropdown.tsx`](../../apps/web/src/features/kiosk/leaderOrderBoard/LeaderBoardRankPickerDropdown.tsx)（[`LeaderBoardSeibanRankPicker.tsx`](../../apps/web/src/features/kiosk/leaderOrderBoard/LeaderBoardSeibanRankPicker.tsx) も利用）。
  - **リスト**: 「-」+ `availableProcessingOrderOptions`（1–10·現在値 or 空き番）。**emerald 選択**·**白 hover**。
  - **アンカー**: **「-」** → `border-white/25 bg-slate-900/90 text-[11px] text-white`。**1–10** → `border-yellow-400 bg-slate-900/90 text-sm font-semibold text-yellow-300`。**disabled** → 従来の薄表示。
  - **不変**: API·DB·サイネージ SVG 行背景·ドロップダウン本体。アンカー幅は 2026-06-30 に `h-7 w-7` へ縮小。
  - **プレビュー**: [leader-board-ranked-order-select-highlight-preview.html](../design-previews/leader-board-ranked-order-select-highlight-preview.html)。
- **本番（Pi5 のみ）**: **`949eea9c`**·PR [#327](https://github.com/denkoushi/RaspberryPiSystem_002/pull/327)·CI **`26285460170` success**·Detach **`20260522-204821-6687`**（**`failed=0`**·約 **461s**）·Phase12 **43/0/0**（約 **116s**）·**現場目視 OK**（2026-05-22）。
- **トラブルシューティング**: 旧 `<select>` → **`web` ref + 強制リロード**（§6.6.4）。ポップアップ背面 → `KIOSK_RANK_PICKER_Z_ABOVE_LEFT_STACK`。黄色にならない → 「-」または完了 disabled。

### Leader order board: Tailwind 不透明度 `/82` が CSS に出ない（2026-05-22） {#leader-order-board-tailwind-opacity-82-pitfall-2026-05-22}

- **症状**: **`bg-slate-600/82`** が dist CSS に **存在せず**、背景透明 → カード背面と同色に見える。
- **原因**: Tailwind 3.4 の **`/82` はデフォルト opacity スケール外**（`/80` は可·`/82` は不可）。
- **対策**: **`bg-slate-600/[0.82]`** または **`/80`**。キオスク最終案は [§行内順位ピッカー](#leader-order-board-row-order-rank-picker-2026-05-22) へ移行。
- **再発防止**: `pnpm --filter @raspi-system/web build` 後、**dist CSS にクラス名があるか**確認。

### Leader order board: 資源CDスロット「順位」ボタン（製番順評価 ON 時）（2026-05-22） {#leader-order-board-slot-auto-rank-2026-05-22}

- **目的**: 製番順評価 ON で左ペインから製番並びを整えたあと、**各資源CDスロット内の未完行へ順位（`processingOrder`）を一括付与**し、**行ごとのドロップダウン操作**を減らす。**Web のみ**·**API / DB / `search-state` は不変**（既存 **`PUT …/:rowId/order`** と **`order-usage`** 契約をそのまま利用）。
- **現場ワークフロー（確定）**:
  1. 納期メールで早い製番を把握
  2. 左ペイン **製番順評価 ON** → 登録製番を並べる（端末ローカル `localStorage` — [§製番順評価](#leader-order-board-seiban-priority-eval-mode-2026-05-04)）
  3. スロット内行がその表示順で並ぶ
  4. 各資源CDカードの **「順位」** で、上から **未設定行**へ空き番を付与（最大 5 行/回）
- **仕様（要約）**:
  - **表示**: **製番順評価 ON** のときのみタイトル行右端に **「順位」**（OFF では非表示）。
  - **対象行**: 当該 `resourceCd`·**表示順**·**`processingOrder == null`**·**未完**（完了フィルタ既定 **`incomplete`**）。
  - **番号選択**: **`order-usage` に無い 1–10 を昇順**に最大 **`LEADER_BOARD_AUTO_RANK_MAX_ASSIGNMENTS`（5）** 個。例: 1,2 使用済 → 3,4,5,6,7。
  - **既存順位**: **維持**（未設定行のみ更新）。**手動ドロップダウン**は押下後も有効。
  - **無効**: **`listIncomplete`** ON·対象 0·空き番 0·実行中。
  - **実装**: [`buildLeaderBoardAutoRankAssignments.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/buildLeaderBoardAutoRankAssignments.ts)（Vitest）·[`applyLeaderBoardAutoRankAssignments.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/applyLeaderBoardAutoRankAssignments.ts)（直列 PUT）·[`useLeaderBoardSlotAutoRank.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/useLeaderBoardSlotAutoRank.ts)·[`useProductionScheduleMutations.ts`](../../apps/web/src/features/kiosk/productionSchedule/useProductionScheduleMutations.ts) の **`updateOrderAsync`**。
  - **設計判断**: **`buildReorderPlan`（全 clear→再付与）** は採用せず — 既存順位維持要件と不一致。
- **本番デプロイ・実機検証（2026-05-22）**:
  - **ブランチ**: `feat/kiosk-leader-board-slot-auto-rank`（代表 **`b74c54a9`**）。
  - **CI**: **`26279773441` success**。
  - **手順**: [deployment.md](../guides/deployment.md) の **`update-all-clients.sh`**。**対象**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。**Pi3 除外**。
  - **Detach Run ID**（`ansible-update-`）: **`20260522-183756-28111`**（**`PLAY RECAP` `ok=134` `changed=4` `failed=0` / `unreachable=0`**·exit **`0`**·`--follow` 約 **368s**）。
  - **自動実機検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **74s**·Tailscale）。
- **知見**:
  - **製番順評価**と **順位ボタン**は別レイヤ — 前者は **表示のみ**、後者は **DB 共有の `processingOrder`**。
  - Pi5 **`web` 再ビルド**だけで Pi4 キオスクにも反映（SPA 配信）。**Pi4 単体デプロイは不要**。
  - **`updateOrderAsync`** を **`Promise<void>`** に統一し、直列 PUT の型エラーを解消（pre-commit 前に **`tsc --noEmit`** 推奨）。
- **トラブルシューティング**:
  - **ボタン非表示** → 製番順評価 OFF / **`web` ref** / §6.6.4 強制リロード。
  - **無効のまま** → **`listIncomplete`**·全行順位済み·**`order-usage` 満杯**。
  - **飛び番** → 幽霊割当（[§A+α 自動解放](#leader-order-board-order-assignment-auto-release-a-alpha-2026-05-20)）·同期前は残り得る。

### Leader order board: 左ペイン・順位ピッカー ビューポートクランプ（2026-05-05） {#leader-order-board-left-pane-viewport-clamp-2026-05-05}

- **目的**: 左ドロワー直下で **順位ピッカーの左端がビューポート外に欠ける**のを防ぎ、**登録製番行で × と製番の視覚的な食い違い**を減らす。**Web のみ**・**API / DB 不変**。
- **仕様（要約）**:
  - **左ペイン** [`LeaderBoardLeftToolStack.tsx`](../../apps/web/src/features/kiosk/leaderOrderBoard/LeaderBoardLeftToolStack.tsx): **製番順評価 ON** 時 **`grid-cols-1`**（同一ブロック内は 1 列）。**OFF** は **`grid-cols-2` のまま**。アサイド幅 **OFF `w-80` / ON `w-96`**（従来より 1 段ずつ拡張）。
  - **幾何**: [`anchoredDropdownViewportClamp.ts`](../../apps/web/src/components/kiosk/anchoredDropdownViewportClamp.ts) の **`computeAnchoredPanelLeftEdge`**（純関数・Vitest あり）。[`AnchoredDropdownPortal.tsx`](../../apps/web/src/components/kiosk/AnchoredDropdownPortal.tsx): 既定 **`clampToViewport: true`**・**`viewportPaddingPx`**（既定 16）。パネル幅は **`panelRef.getBoundingClientRect().width`**。初回は **二重 `requestAnimationFrame`** でレイアウト後に再測定。**`isOpen === false`** で **`position` を null** に戻す。**rAF 内 `setState`** は **アンマウント時 `cancelled`** で抑止。
  - **後方互換**: 生産スケジュールの **広いフィルタパネル**で左クランプが気になる場合のみ、呼び出し側で **`clampToViewport={false}`**（ドキュメント: [deployment.md](../guides/deployment.md) 本項）。
- **本番デプロイ・実機検証（2026-05-05）**:
  - **ブランチ**: `feat/leader-board-left-pane-rank-picker-clamp`（代表 **`d8583f2d`**）。
  - **手順**: [deployment.md](../guides/deployment.md) の **`update-all-clients.sh`**。**対象**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。**Pi3 不要**。
  - **Detach Run ID**（`ansible-update-`）: **`20260505-081520-1295`**（**`PLAY RECAP` `ok=134` `changed=4` `failed=0` / `unreachable=0`**・exit **`0`**）。
  - **自動実機検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **60s**・Tailscale）。
- **知見**: **アンカーが画面左寄り**のとき **`translateX(-100%)` だけ**ではパネル左が負座標になり得る。**右端そろえ優先**を数式でクランプすると **再利用可能**（生産スケジュールの Portal と共有）。
- **トラブルシューティング**:
  - **まだ左が欠ける**: **`web` コミット**・キャッシュ・§6.6.4。**`clampToViewport` が意図せず false** になっていないか。
  - **フィルタdropdown の位置が変** → [deployment.md](../guides/deployment.md) の **「広い登録製番ドロップダウン」** 追記どおり **`clampToViewport={false}`** を検討。

### Leader order board: leaderboard `pageSize` server cap + remove debug ingest（2026-05-02） {#leader-order-board-leaderboard-pagesize-server-cap-2026-05-02}

- **症状**: 順位ボードの **一覧 GET** が再び重い。`Caddy access.log`（JSON）で **`pageSize=1240` 前後と `880` が混在**する。
- **原因**: **旧 Web バンドル**が大きな `pageSize` を送信し、その分 **行・フッターマップ・JSON が肥大化**。
- **対策**:
  - **API**: `GET …/kiosk/production-schedule` で **`responseProfile=leaderboard` のときだけ** **`pageSize` を最大 900 にクランプ**。実装 [`list.ts`](../../apps/api/src/routes/kiosk/production-schedule/list.ts)（定数 **`LEADERBOARD_PAGE_SIZE_HARD_CAP`**）。
  - **Web**: [`constants.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/constants.ts) の **`leaderOrderBoardQueryPageSize`** 調整（新バンドル側の要求を抑える）に加え、**サーバ側で旧クライアントを吸収**。
  - **計測撤去**: 開発用の **`127.0.0.1:7426` ingest `fetch`** と `#region agent log` を **本番経路から除去**（[KB-354 §D](../knowledge-base/KB-354-admin-loan-report-gmail-draft-deploy.md) と同趣旨）。
- **検証（Pi5）**: `pageSize=1240` リクエストでも応答 **`rows` が 900 に抑えられ**、応答バイト数が **約 1.1MB → 約 0.82MB** に減ることを確認。ウォーム時の **curl 総時間**も **旧平均より改善**（同一条件 8 本の簡易平均）。
- **実施記録（2026-05-02）**: PR **[#236](https://github.com/denkoushi/RaspberryPiSystem_002/pull/236)**（`0865cc56`）。Pi5 に **`./scripts/deploy/update-all-clients.sh --limit raspberrypi5`**（Detach **`20260502-175955-7198`**）。**`verify-phase12-real.sh`** → **PASS 43 / WARN 0 / FAIL 0**（約 **141s**）。
- **デプロイ**: [deployment.md](../guides/deployment.md) の **「`leaderboard` `pageSize` サーバ上限制御」** 補足を参照。**`main` 取込後** `update-all-clients.sh`・**Pi5 のみ**で可（全クライアントは **旧バンドルが残る Pi4** まで含めて段階展開してもよい）。

### Leader order board: `leaderboard` 一覧取得と手動順位・製番展開の整合（2026-05-05） {#leader-order-board-leaderboard-fetch-manual-priority-2026-05-05}

- **症状**: 資源 CD ごとの **`order-usage`**（使用済み `processingOrder`）では **1 や 2 が既に埋まっている**のに、順位ボードの **`responseProfile=leaderboard` 一覧**には **当該手動行が現れない**ことがある。現場からは「最高優先の手動順位なのに画面上に無い」と見える。
- **原因（設計不整合）**: **`order-usage`** は **DB 上の全割当**を返す一方、従来の一覧は **ページング付きの 1 本 SQL** で行を取っており、**`ORDER BY` が手動順位を最優先していない**（フロントのソートは **取得済み行のみ**に作用する）。その結果、**手動行が先頭ページの外**に落ち、**順位番号だけ占有**という状態になり得た。
- **対策（API）**:
  - **`responseProfile=leaderboard` のときだけ** [`fetchLeaderboardScheduleRowsWithSeibanAwarePriority`](../../apps/api/src/services/production-schedule/leaderboard/leaderboard-row-selection.service.ts) を使用。
  - **段階 1**: スコープ内の **手動割当行**を `processingOrder` 昇順で取得。
  - **段階 2**: 得られた製番集合に対し **`expansionWhere`**（**テキスト検索・機種名条件なし**）で **同一製番の全行**を追加（検索語句だけ別品目にマッチして製番が分裂する取りこぼしを防ぐ）。
  - **段階 3**: 残り枠を **納期系ソート**で補完。**手動＋展開が `pageSize` を超える場合も手動側を切り捨てない**。
  - **`full` プロファイル**は従来クエリのまま（影響隔離）。
- **検証**: Vitest [`production-schedule-query.service.test.ts`](../../apps/api/src/services/production-schedule/__tests__/production-schedule-query.service.test.ts)·[`leaderboard-row-selection.compare.test.ts`](../../apps/api/src/services/production-schedule/__tests__/leaderboard-row-selection.compare.test.ts)。CI 緑化済み（ブランチ push 時）。
- **本番デプロイ（2026-05-05）**: ブランチ **`feat/leaderboard-priority-selection-consistency`**・コミット **`e4a8417d`**。**`main` 反映**: [PR #251](https://github.com/denkoushi/RaspberryPiSystem_002/pull/251) squash（**`3a6a1a42`**）。**対象**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。**Detach Run ID**: **`20260505-181206-15069`**（**`PLAY RECAP` `ok=134` `changed=4` `failed=0` / `unreachable=0`**・exit **`0`**）。**実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **84s**）。
- **トラブルシュート**:
  - **まだ手動行が見えない** → Pi5 の `docker compose` **`api` イメージ**が **`e4a8417d` 以降**か、`deploy-status`・`/opt/RaspberryPiSystem_002` の ref を確認。キオスク **キャッシュ**を疑い [verification-checklist.md](../guides/verification-checklist.md) §6.6.4 で**強制リロード**。
  - **展開で余計な行が増えた** → 仕様上、手動行の **同一製番は意図的にまとめて載る**。資源・除外・FKOJUNST 可視など **他フィルタ**は従来どおり効く（展開は **`text` / `machineName` だけ緩める**）。
- **参照**: [deployment.md](../guides/deployment.md)（2026-05-05 evening 項）·[`shared.ts` JSDoc](../../apps/api/src/routes/kiosk/production-schedule/shared.ts)（`responseProfile=leaderboard` の契約説明）。

### Leader order board: 資源内順位割当の自動解放（A+α・2026-05-20） {#leader-order-board-order-assignment-auto-release-a-alpha-2026-05-20}

- **Context（症状）**: 順位ドロップダウンは **`order-usage`（DB 上の全 `ProductionScheduleOrderAssignment`）** に対し **空き番のみ**選択可（[`availableProcessingOrderOptions.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/availableProcessingOrderOptions.ts)）。一方、キオスク一覧は **FKOJUNST 可視**＋完了フィルタ（既定 **未完**）で **表示行が部分集合**。**完了済み（外部完了 `C`/`X` 等）**・**`fkmail` 無し winner**・**論理キー重複の非 winner 旧行**が **順位だけ DB に残る**と、現場では **「080 や 060 が選べず 5 からしか選べない」**等の **飛び番**に見える（操作ミスではなく **一覧可視集合と `order-usage` 母集団の設計ギャップ**）。
- **調査（2026-05-20 · 実装前）**:
  - **CONFIRMED**: `order-usage` は **画面フィルタを通過しない**全割当を返す（[§取得整合（2026-05-05）](#leader-order-board-leaderboard-fetch-manual-priority-2026-05-05) と同型の **部分集合 vs 全集合** 問題）。
  - **CONFIRMED**: 一覧は [`buildFkojunstProductionScheduleListVisibleScalarSql`](../../apps/api/src/services/production-schedule/policies/fkojunst-production-schedule-list-visibility.policy.ts) で **`S`/`R`/`C`/`X` かつ `fkmail` あり**のみ可視（`O`/`P`/`?`/`fkmail` 無しは非表示）。
  - **REJECTED**: Web 側ドロップダウン生成バグ単独（`order-usage` 契約どおり **占有番号を除外**しているだけ）。
- **Fix（API のみ・Web/`order-usage` 契約不変・DB マイグレーションなし）**:
  - **保持条件（A+α 統合）**: `retain ⇔ NOT 実効完了 AND キオスク一覧可視（fkmail ありかつ S/R/C/X）`。それ以外に **`ProductionScheduleOrderAssignment` が紐づく行**は **解放**（削除＋同一 `location`×`resourceCd` 内で **番号詰め**）。
  - **A（実効完了）**: 手動 `ProductionScheduleProgress.isCompleted` **OR** `ProductionScheduleExternalCompletion.isExternallyCompleted`（[`buildProductionScheduleEffectiveCompletedSql`](../../apps/api/src/services/production-schedule/production-schedule-effective-completion.sql.ts) 再利用）。
  - **α（一覧非可視）**: `fkmail` 無し / `O`/`P` / `?` 等。**手動 ✓ 完了**は従来どおり [`driveProductionScheduleRowCompletion`](../../apps/api/src/services/production-schedule/production-schedule-command.service.ts) 経由で **即時解放**（`releaseOrderAssignmentAtLocation` へ共通化）。
  - **α 拡張（コードレビュー追補）**: **論理キー重複で winner から外れた旧行**（同一 ProductNo×資源×FKOJUN だが **非 winner の `csvDashboardRowId`**）も **解放候補**に含める（[`findStaleOrderAssignmentCandidates`](../../apps/api/src/services/production-schedule/order-assignment/order-assignment-release.repository.ts) の SQL 修正）。
  - **実装モジュール**: [`order-assignment/`](../../apps/api/src/services/production-schedule/order-assignment/) — [`order-assignment-retention.policy.ts`](../../apps/api/src/services/production-schedule/order-assignment/order-assignment-retention.policy.ts)·[`order-assignment-release.repository.ts`](../../apps/api/src/services/production-schedule/order-assignment/order-assignment-release.repository.ts)·[`order-assignment-reconciliation.service.ts`](../../apps/api/src/services/production-schedule/order-assignment/order-assignment-reconciliation.service.ts)。
  - **トリガ（同期後・Pi5 API）**: [`FkojunstExternalCompletionSyncService`](../../apps/api/src/services/production-schedule/external-completion/fkojunst-external-completion-sync.service.ts)·[`ProductionScheduleCsvIngestExternalCompletionSyncService`](../../apps/api/src/services/production-schedule/external-completion/production-schedule-csv-ingest-external-completion-sync.service.ts)·[`ProductionScheduleFkojunstMailStatusSyncService`](../../apps/api/src/services/production-schedule/fkojunst-status-mail-sync.service.ts)（**`fkmail` 空クリア時も reconcile**）。
  - **バッチ順**: 解放対象は **`orderNumber` DESC** で処理（大番号から削除→詰めで番号衝突を避ける）。
  - **ログ**: 1 件以上解放時 `[ProductionScheduleOrderAssignmentReconciliation] stale order assignments released`（`scanned` / `released`）。
- **既存幽霊データ**: **次回 `FKOJUNST_Status` または生産日程本体 CSV 取込同期**で自動掃除（**一回性マイグレーション／手動 SQL は今回スコープ外**）。
- **ブランチ / コミット**: **`feat/kiosk-order-assignment-auto-release-a-alpha`**·**`8d2c582c`**（`fix(kiosk): auto-release stale leaderboard order assignments`）·**`643e4f4b`**（`fix(kiosk): merge reconcile deps for external completion sync tests` — CI 修正）。
- **CI**:
  - **初回失敗** run **`26146689419`**: `api-db-and-infra` で **4 件** — `orderAssignmentReconciliationService` が **部分 DI テスト**で `undefined`（`FkojunstExternalCompletionSyncService` / `ProductionScheduleCsvIngestExternalCompletionSyncService` のコンストラクタ注入漏れ）。
  - **修正後成功** run **`26147609881`**: 全ジョブ **success**。
- **ローカル検証**: order-assignment 関連 Vitest **15 PASS**（policy / release repository / reconciliation integration / command.service）。
- **本番デプロイ（2026-05-20 · 標準 `update-all-clients.sh` · `--limit` 1 台ずつ）**:
  - **必須**: **`raspberrypi5`**（**API のみ**·Docker 再ビルドあり）。**Pi4 キオスク単体デプロイは機能上不要**（Pi5 `api` が正本）だが、本セッションでは **Pi5→Pi4×4 全台**をユーザー指示で順次反映（`kiosk-browser` / `status-agent` 再起動のみ）。
  - **Detach Run ID**（接頭辞 `ansible-update-`）:
    - Pi5 初回 **`20260520-164356-7722`**（**Docker rebuild**·compose 再起動中 **SSH タイムアウト**が数回出たが **リモート exit 0**）
    - Pi5 再実行 **`20260520-174409-16528`**（**`PLAY RECAP` `ok=131` `changed=3` `failed=0`**·**Docker 再ビルド skip**·**`prisma migrate` OK**·新規マイグレなし）
    - **`raspi4-kensaku-stonebase01`** **`20260520-174713-7127`**（**`ok=129` `changed=10` `failed=0`**）
    - **`raspberrypi4`** **`20260520-180644-29504`**（**`ok=122` `changed=10` `failed=0`**）
    - **`raspi4-robodrill01`** **`20260520-181206-12995`**（**`ok=122` `changed=9` `failed=0`**）
    - **`raspi4-fjv60-80`** **`20260520-181622-32182`**（**`ok=122` `changed=9` `failed=0`**）
  - **Pi3**: 各 run **`skipping: no hosts matched`**（**Pi3 専用手順は未実施で正**）。
  - **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（本記録 **約 76–88s**·Tailscale·Pi5 `100.106.158.2`）。
- **知見**:
  - **API-only でも Pi4 をデプロイする理由**は **Ansible 慣行（キオスク repo 同期 + `kiosk-browser` 再起動）**であり、**本機能の正本は Pi5 `api` のみ**。
  - **Pi5 2 回目デプロイ**では diff が小さく **Docker 再ビルドが skip** されても、初回 **`164356-7722`** で API イメージは更新済み。**ref 確認**は `/opt/RaspberryPiSystem_002` の **`643e4f4b` 以降**。
  - **解放は同期後バッチ**のため、**デプロイ直後は幽霊が残り得る**（次の FKOJUNST / 本体 CSV 同期まで）。
- **トラブルシュート**:
  - **反映直後も飛び番** → **同期未実行**。Pi5 **`api` ref**（**`643e4f4b` 以降**）·FKOJUNST / 本体 CSV 取込スケジュール·API ログの **`stale order assignments released`** を確認。
  - **順位が消えた** → 対象行が **実効完了**または **一覧非可視**になった。**完了フィルタ「両方」**で行の有無を確認（意図どおりの解放）。
  - **CI で external completion sync テストが落ちる** → **`ProductionScheduleOrderAssignmentReconciliationService` の DI** を **部分コンストラクタ注入テスト**と揃える（**`643e4f4b`** 参照）。
  - **Pi5 デプロイ中 SSH タイムアウト** → **`PLAY RECAP` / リモート exit / `Summary success`** を正本とする（[deploy-status-recovery.md](../runbooks/deploy-status-recovery.md)）。
- **参照**: [deployment.md §A+α（2026-05-20）](../guides/deployment.md#kiosk-leaderboard-order-assignment-auto-release-a-alpha-2026-05-20)·[verification-checklist §6.6.24](../guides/verification-checklist.md#kiosk-leaderboard-order-assignment-auto-release-verification-2026-05-20)·[`EXEC_PLAN.md`](../../EXEC_PLAN.md) Progress 先頭項。

### Leader order board: `leaderboard` の COUNT と行 SELECT の並列化（2026-05-06） {#leader-order-board-api-count-parallel-2026-05-06}

- **目的**: `responseProfile=leaderboard` の **`GET /api/kiosk/production-schedule`** で、**可視行 `COUNT(*)`** と **製番-aware 行取得**の待ちを **壁時計時間の直列和**にしない（**API 契約・返却内容は不変**）。
- **実装（要約）**: [`countProductionScheduleDashboardVisibleRows`](../../apps/api/src/services/production-schedule/production-schedule-list-count.service.ts) に COUNT を分離し、[`listProductionScheduleRows`](../../apps/api/src/services/production-schedule/production-schedule-query.service.ts) で **`Promise.all([count, rowSelect])`**。**`full` 経路**は従来どおり **COUNT + 主 SELECT を並列**。
- **本番デプロイ（2026-05-06）**: ブランチ **`fix/leaderboard-internal-query-latency`**・コミット **`35629338`**。**対象**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。**Pi3 不要**。**Detach Run ID**: **`20260506-103441-24679`**（**`PLAY RECAP` `ok=134` `changed=4` `failed=0` / `unreachable=0`**・exit **`0`**）。**実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **80s**・Tailscale）。
- **ナレッジ（正本）**: [KB-369](./KB-369-leader-order-board-api-internal-latency.md)·[deployment.md](../guides/deployment.md)（2026-05-06 項）。
- **トラブルシュート**: 反映確認は Pi5 **`api` イメージ**・detach ログ。キオスクは **強制リロード**（本件は API のみ）。

### Leader order board: 順位ボード段階取得（leaderboard-shell／total／decorations）（2026-05-06） {#leader-order-board-leaderboard-phased-fetch-2026-05-06}

- **目的**: 初回表示の **壁時計時間**を短くする（**一覧の並び・件数定義・装飾の意味は従来と整合**）。**Web** は **シェル → 総件数 → 装飾**の順で取得し、**API** は責務分割した **GET/POST** を追加。
- **実装（要約）**: [`leaderboard-phased-read.ts`](../../apps/api/src/routes/kiosk/production-schedule/leaderboard-phased-read.ts)·[`production-schedule-query.service.ts`](../../apps/api/src/services/production-schedule/production-schedule-query.service.ts)·[`leaderboard-shell-hydrate.service.ts`](../../apps/api/src/services/production-schedule/leaderboard/leaderboard-shell-hydrate.service.ts)。**Web**: [`ProductionScheduleLeaderOrderBoardPage.tsx`](../../apps/web/src/pages/kiosk/ProductionScheduleLeaderOrderBoardPage.tsx)·[`hooks.ts`](../../apps/web/src/api/hooks.ts)·[`client.ts`](../../apps/web/src/api/client.ts)。
- **本番デプロイ（2026-05-06）**: ブランチ **`feat/leaderboard-phased-fetch-2s`**・コミット **`cd751a2a`**。**対象**: **`raspberrypi5` のみ**。**Detach Run ID**: **`20260506-113443-32585`**（**`PLAY RECAP` `ok=134` `changed=4` `failed=0` / `unreachable=0`**・exit **`0`**）。**実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **74s**・Tailscale）。
- **ナレッジ（正本）**: [KB-369](./KB-369-leader-order-board-api-internal-latency.md)·[deployment.md](../guides/deployment.md)（2026-05-06 段階取得項）。
- **トラブルシュート**: [KB-369](./KB-369-leader-order-board-api-internal-latency.md) の **hydrate raw SQL 知見**（`Prisma.join`・型・Fkojunst 可視 WHERE の連結）。キオスク **強制リロード**（API+Web のため **`api` と `web` の両方**を確認）。

### Leader order board: 資源CDカード単位・段階取得（製番展開の条件付きオフ・2026-05-07） {#leader-order-board-resource-card-phased-scope-2026-05-07}

> **Current spec note (2026-06-24)**: This is historical. After [ADR-20260508](../decisions/ADR-20260508-leaderboard-board-aggregate-api.md), the multi-slot kiosk board's main path is aggregate `leaderboard-board`; see [KB-392](./KB-392-kiosk-leaderboard-spec-source-of-truth.md).

- **目的**: **複数資源カード**を並べる順位ボードで、**各資源列**が **他資源の手動行に引きずられない**よう、段階取得の **選定プールを資源 CD 単位**に閉じる（**API+Web**）。
- **仕様（要約）**:
  - **API**: `resourceCds` が **1 要素**のときのみ **同一製番展開（`expansionWhere`）を無効化**。**複数資源を 1 リクエストに載せる**従来の一括経路では **展開あり**（[KB-297 §取得整合](#leader-order-board-leaderboard-fetch-manual-priority-2026-05-05) の精神を **複数リソース時に維持**）。
  - **Web**: [`useCompositeLeaderboardPhasedScheduleWithAutoAppend`](../../apps/web/src/features/kiosk/leaderOrderBoard/useCompositeLeaderboardPhasedScheduleWithAutoAppend.tsx) が **カード（資源）ごと**に shell/continue/total を走らせ、**`leaderboard-decorations` は結合 `rowIds` で 1 回**。
- **本番デプロイ（2026-05-07）**: ブランチ **`feature/kiosk-leaderboard-card-scope`**・コミット **`30a664f1`**。**対象**: **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`**（**`--limit` 順次**）。**Pi3 除外**（専用手順の対象外）。**Detach Run ID**（`ansible-update-`）: **`20260507-212820-17030`** / **`20260507-213838-14511`** / **`20260507-214421-9979`** / **`20260507-214913-28430`** / **`20260507-215416-19850`**（各 **`failed=0` / `unreachable=0` / exit `0`**）。**実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **121s**・Tailscale）。
- **ナレッジ（正本）**: [KB-369](./KB-369-leader-order-board-api-internal-latency.md)·[deployment.md](../guides/deployment.md)（2026-05-07 · カード単位項）。
- **トラブルシュート**: 挙動が **全カード同一製番に偏る**ときは **API が旧版**（一括＋常時展開）の疑い。**Network** で shell の **クエリ `resourceCds`** が **単一 CD**か確認。続き・失効は [KB-369](./KB-369-leader-order-board-api-internal-latency.md) の **snapshot / cursor** 項を参照。

### Leader order board: card row emphasis layout (2026-06-05) {#leader-order-board-card-row-emphasis-layout-2026-06-05}

- **目的**: **カード外寸を維持**したまま、現場からの可読性要望に応じ **納期・品名・製番・機種名**のフォントを拡大し、横余白を **2 列レイアウト**で活用する。**Web のみ** · API/Prisma 不変 · **サイネージ JPEG**（`kiosk_leader_order_cards`）は **別レンダラのため対象外**。
- **ブランチ / PR**: **`fix/kiosk-leaderboard-card-layout-2`** · [PR #390](https://github.com/denkoushi/RaspberryPiSystem_002/pull/390) · 代表コミット **`05ae1a70`**（`fix(kiosk): refine leaderboard card row emphasis layout`）。
- **仕様（フォント・レイアウト）**:
  | 要素 | 変更前（目安） | 変更後 | 備考 |
  |------|----------------|--------|------|
  | 納期 | `text-[10px]` | **`text-[20px]`** | 2 倍 |
  | 品名 | `text-[11px]` 相当 | **`text-[16.5px]`** | 1.5 倍 |
  | 製番（`fseiban`） | クラスタ行内 | **品名行の右** · **`text-[16.5px]`** | `font-mono` · semibold |
  | 機種名 | `text-[11px]` 相当 | **`text-[16.5px]`** | |
  | クラスタ行 | 製番+品目+個数 | **品目コード+個数+工順+資源所要量** | 製番は上表どおり分離 · 値だけを中黒区切り |
  | 顧客名 | `text-[11px]` | **変更なし** | クラスタ行右 |
  | 資源CDヘッダ | 15px / 12px | **変更なし** | `LeaderOrderResourceCard` |
  | カード外寸 | — | **変更なし** | 現場合意 |
  - **2 列幅（`pairLeftColumnClass`）**: 右側要素（顧客名 / 製番）が **あるときのみ** 左 **`max-w-[50%] flex-[0_0_50%]`** · **単独時は `flex-1` 全幅**。常時 50% 固定は **品目コード半幅・品名 truncate** の回帰源だったため却下。
  - **品名ホバー全文（2026-06-18）**: **`partNameLine`（`presentLeaderOrderRow` の trim 済み `fhinmei`）** は、製番と 2 列で **`truncate` されても** ネイティブ **`title` 属性**で **マウスホバー時に全文**を確認できる（工順・備考と同型。追加ライブラリ不要）。**Web のみ** · **サイネージ JPEG 対象外** · タッチ/キーボードの全文確認手段は追加しない。
  - **実装**: ブランチ **`feat/kiosk-leaderboard-fhinmei-hover-title`** · 代表 **`fc8e9c68`** · [`LeaderOrderResourceRow.tsx`](../../apps/web/src/features/kiosk/leaderOrderBoard/LeaderOrderResourceRow.tsx) に `title={pres.partNameLine}` · テスト [`LeaderOrderResourceRow.test.tsx`](../../apps/web/src/features/kiosk/leaderOrderBoard/__tests__/LeaderOrderResourceRow.test.tsx)
- **本番デプロイ（2026-06-18 · FHINMEI ホバー全文 · Web のみ）**:
  - **手順**: [deployment.md](../guides/deployment.md) 標準 · **`export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`** · **`./scripts/update-all-clients.sh feat/kiosk-leaderboard-fhinmei-hover-title infrastructure/ansible/inventory.yml --limit <host> --detach --follow`** · **1 台ずつ** · **Pi3 除外**
  - **対象順**: **`raspberrypi5` → `raspi4-kensaku-stonebase01` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80`**
  - **Detach Run ID**（接頭辞 `ansible-update-`）:

    | ホスト | Run ID | PLAY RECAP |
    |--------|--------|------------|
    | `raspberrypi5` | **`20260618-203129-1549`** | **`ok=134` `changed=4` `failed=0`** |
    | `raspi4-kensaku-stonebase01` | **`20260618-203732-31059`** | **`ok=129` `changed=10` `failed=0`** |
    | `raspberrypi4` | **`20260618-204244-26836`** | **`ok=122` `changed=10` `failed=0`** |
    | `raspi4-robodrill01` | **`20260618-204829-20421`** | **`ok=122` `changed=9` `failed=0`** |
    | `raspi4-fjv60-80` | **`20260618-205250-31431`** | **`ok=122` `changed=9` `failed=0`** |

  - **Pi5 web バンドル**: `index-DY2bp06B.js`（`title:N.partNameLine` 含有 · `curl` 確認済み）
  - **自動実機検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（Pi5 後 **約 62s** · 全台後 **約 58s**）
  - **ローカル/CI**: `LeaderOrderResourceRow.test.tsx` **2 passed** · web Vitest **1076 passed** · GitHub Actions CI **`27754461434`** **success**
  - **手動（任意·Pi4/VNC）**: [verification-checklist §6.6.30](../guides/verification-checklist.md#kiosk-leaderboard-card-row-emphasis-layout-verification-2026-06-05) — 製番ありで **長い品名 truncate 行**を **マウスオーバー**し **`title` 全文**を確認
  - **知見**: Pi5 の `--follow` 完走前に次 `--limit` を起動すると **Mac 側 local lock（exit 3）** — **前 run 完了後**に再実行する
  - **未完了**: なし（手動ホバー目視は現場任意）
- **本番デプロイ（2026-06-30 · クラスタ行/手動順位幅/slot解除 · Web のみ）**:
  - **変更**: クラスタ行は **`品目コード · 個数 · 工順 · 資源所要量`**。手動順位アンカーは **`h-7 w-7`**。選択済み資源 CD slot の再クリック/Enter/Space は **選択解除**し、全 slot を通常輝度へ戻す。
  - **正本実装**: commit **`317a6aa0`** · [`leaderOrderRowPresentation.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/leaderOrderRowPresentation.ts) · [`LeaderOrderResourceRow.tsx`](../../apps/web/src/features/kiosk/leaderOrderBoard/LeaderOrderResourceRow.tsx) · [`LeaderBoardGrid.tsx`](../../apps/web/src/features/kiosk/leaderOrderBoard/LeaderBoardGrid.tsx) · [`LeaderOrderRowOrderSelect.tsx`](../../apps/web/src/features/kiosk/leaderOrderBoard/LeaderOrderRowOrderSelect.tsx)
  - **不変**: API · DB · Prisma migration · SQL · Gantt 計算契約 · `+人` 合算契約 · サイネージ JPEG レンダラ。
  - **CI**: GitHub Actions **main CI `28412915194` success**、Secret scan **`28412915196` success**、CodeQL **`28412915197` success**、Pages **`28412914915` success**。
  - **本番反映**: [deployment.md §2026-06-30](../guides/deployment.md#kiosk-leaderboard-row-cluster-order-slot-toggle-2026-06-30)。標準全体 run **`20260630-101347-10287`** 後、`.git` 一時 lock 消失で未到達だった端末を **`20260630-103004-20424`**（stonebase）· **`20260630-103545-19235`**（sessaku）· **`20260630-104001-9466`**（Pi3）で収束。最終 PLAY RECAP は各対象 **`failed=0`**。
  - **自動実機検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 45 / WARN 0 / FAIL 0**（全対象収束後）。
  - **現場実機検証**: ユーザー確認 **OK**（2026-06-30）。
  - **AI再開メモ**: 状態は **完了**。仕様の正本は本節と実装コードで、再開時は `317a6aa0` と docs commit `4263368d` 以降の `main` を前提にする。未完了事項は **なし**。同種デプロイで wrapper が exit 0 でも PLAY RECAP に `failed=1` が出た場合は成功扱いにせず、該当 host を `--limit <host>` で再実行して service restart / UI reachable / Phase12 を確認する。
- **Presentation 契約（[`leaderOrderRowPresentation.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/leaderOrderRowPresentation.ts)）**:
  - **`fseibanLine`**: 品名行右に出す製番（trim 済み・空なら非表示）。
  - **`clusterTailSegments`**: クラスタ行先頭用（**`fhincd` のみ** · 製番は含めない）。表示時は `quantityInlineJa`・`fkojunInline`・`requiredMinutesInline` と連結する。
  - **`fkojunInline`**: クラスタ行に出す工順（trim 済み・空なら `—`）。
  - **`requiredMinutesInline`**: クラスタ行に出す資源所要量（例 `400分`・無効値/0以下なら `—`）。
  - **`clusterSegments`**: **`@deprecated`** — 後方互換（製番+品目の旧配列）。**新規表示は `fseibanLine` + `clusterTailSegments` を使う**。
  - **却下パターン**: component 側で `clusterSegments[0]` と `row.fseiban` を比較して製番を剥がす（presentation 変更時に重複/欠落しやすい）。
- **その他実装**:
  - [`LeaderOrderResourceRow.tsx`](../../apps/web/src/features/kiosk/leaderOrderBoard/LeaderOrderResourceRow.tsx) — 行 JSX・2 列グループ（`cluster-customer-row` / `part-fseiban-row`）。
  - [`leaderBoardRefetchPolicy.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/performance/leaderBoardRefetchPolicy.ts) — **`LEADER_BOARD_ROW_ESTIMATE_PX` 80→96**（行高増に追随）。
  - [`kiosk-rank-board-card-single-preview.html`](../design-previews/kiosk-rank-board-card-single-preview.html) — **本番相当プレビュー**（React と同期）。途中案 **`kiosk-rank-board-card-font-size-proposal-preview.html`** は **削除**（14px/13px 等の誤導線防止）。
- **設計経緯（要約）**:
  1. **v1（+1px）**: 現場フィードバックで効果不足 → 却下。
  2. **v2–v3**: フォント拡大 + 配置変更。全幅占有で余白が逆に目立つ → 却下。
  3. **v4**: 条件付き 50% / 単独全幅 + presentation 契約整理 → **採用**。
- **ローカル検証**: `leaderOrderRowPresentation.test.ts` **10 passed**（`fseibanLine` / `clusterTailSegments` 分割含む）· web lint · tsc · build OK。
- **CI**: GitHub Actions **`26993180248`** **success**（`05ae1a70` push 後 · lint-build-unit / security-docker / api-db-and-infra / e2e 全ジョブ）。
- **本番デプロイ（2026-06-05 · 標準 `update-all-clients.sh` · `--limit` 1 台ずつ）**:
  - **手順**: [deployment.md §2026-06-05 カード行強調](../guides/deployment.md#kiosk-leaderboard-card-row-emphasis-layout-2026-06-05) · **`export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`** · **`--detach --follow`**。
  - **順序**: **`raspberrypi5`** → **`raspi4-kensaku-stonebase01`（先行実機 OK）** → **`raspberrypi4`** → **`raspi4-robodrill01`** → **`raspi4-fjv60-80`**。**Pi3 除外**。
  - **Detach Run ID**（接頭辞 `ansible-update-`）:

    | ホスト | Run ID | PLAY RECAP |
    |--------|--------|------------|
    | `raspberrypi5` | **`20260605-123252-7617`** | **`ok=134` `changed=4` `failed=0`** |
    | `raspi4-kensaku-stonebase01` | **`20260605-123929-3009`** | **`ok=129` `changed=11` `failed=0`** |
    | `raspberrypi4` | **`20260605-124846-14986`** | **`ok=122` `changed=10` `failed=0`** |
    | `raspi4-robodrill01` | **`20260605-125308-28951`** | **`ok=122` `changed=9` `failed=0`** |
    | `raspi4-fjv60-80` | **`20260605-125638-9078`** | **`ok=122` `changed=9` `failed=0`** |

  - **Pi5 web バンドル**: `index-DvR9H4yG.js`（`text-[20px]` · `fseibanLine` · `clusterTailSegments` 含有確認済み）。
  - **自動実機検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（Pi5 後約 **29s** · 全台後約 **25s**）。
- **知見**:
  - **可読性と外寸のトレードオフ**はフォント+内部再配置で解決可能（外寸固定が現場要件のとき有効）。
  - **Presentation 境界に分割ロジックを置く**と、UI レイアウト変更がデータ契約と一緒に追跡できる。
  - **仮想化見積もり**（`LEADER_BOARD_ROW_ESTIMATE_PX`）はフォント変更時に忘れやすい — 行高が増えたら更新必須。
  - **Pi4 先行 1 台実機 OK → 残展開**は、Web-only 変更のリスク低減に有効（本件 stonebase 先行）。
- **トラブルシュート**:
  - **フォントが旧サイズ** → Pi5 `docker-web-1` の `/srv/site/assets/index-*.js` が **`05ae1a70` ビルドか** · Pi4 **強制リロード**（§6.6.4）。
  - **製番がクラスタ左に残る** → `fseibanLine` 未デプロイ（旧 `clusterSegments` 表示）。
  - **品名だけ半幅で切れる** → 製番が空なのに左 50% 固定 — **`pairLeftColumnClass(false)`** 版へ。**長い品名はホバーで `title` 全文**（[§品名ホバー全文（2026-06-18）](#leader-order-board-card-row-emphasis-layout-2026-06-05)）。
  - **プレビュー HTML と本番が不一致** → 正本は **`kiosk-rank-board-card-single-preview.html` のみ**（proposal ファイルは削除済み）。
  - **PR #390 作成時 `No commits between main and branch`** → リモート ref 不整合 — **`fix/kiosk-leaderboard-card-layout-2`** で再 push/PR（デプロイ HEAD **`05ae1a70`**）。
- **参照**: [deployment §2026-06-05](../guides/deployment.md#kiosk-leaderboard-card-row-emphasis-layout-2026-06-05) · [verification-checklist §6.6.30](../guides/verification-checklist.md#kiosk-leaderboard-card-row-emphasis-layout-verification-2026-06-05) · [§preview alignment（2026-04-17）](#leader-order-resource-card-preview-alignment-2026-04-17)（前身レイアウト） · [`EXEC_PLAN.md`](../../EXEC_PLAN.md) Progress 先頭項。

### Leader order resource card: preview alignment (2026-04-17) {#leader-order-resource-card-preview-alignment-2026-04-17}

- **目的**: レビュー済み静的プレビュー（[`kiosk-rank-board-card-single-preview.html`](../design-previews/kiosk-rank-board-card-single-preview.html)）と **キオスク順位ボードの資源カード**（`LeaderOrderResourceCard`・[`presentLeaderOrderRow`](../../apps/web/src/features/kiosk/leaderOrderBoard/leaderOrderRowPresentation.ts)）の **表示順・クラスタ行・個数色・完了ボタン（白系）・備考ありの鉛筆強調**を揃える。**Web のみ**・API 契約は不変。
- **後続（2026-06-05）**: フォント拡大・製番右配置・2 列幅 — [§カード行強調（2026-06-05）](#leader-order-board-card-row-emphasis-layout-2026-06-05)。
- **仕様（要約）**:
  - **クラスタ行**: `clusterSegments`（製番・品目コード・個数）を中黒区切りで 1 行（`LeaderOrderRowClusterLine`）。
  - **表示順**: クラスタブロック → 品名 → `machineTypeNameLine`（機種記号·機種名）。従来の **`machinePartLine`** は後方互換のため維持。
  - **備考**: 空はグレー鉛筆、有りは強調色（`KioskPencilGlyph`）。
- **デプロイ・実機検証（2026-04-17）**:
  - **ブランチ**: `feat/kiosk-leader-order-card-layout`（コミット **`d1a06409`**）。
  - **手順**: [deployment.md](../guides/deployment.md) の `update-all-clients.sh`・**`export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`**・**`--detach --follow`**。**対象 5 台**を **`--limit` 1 台ずつ**（**`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`**）。**Pi3 は対象外**（リソース僅少・専用手順のため）。
  - **Detach Run ID**: `20260417-191501-20151` → `20260417-192029-29544` → `20260417-192519-8157` → `20260417-192909-2265` → `20260417-193514-20516`（各 **`failed=0` / `unreachable=0`**）。
  - **自動実機検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **75s**）。
- **トラブルシューティング**:
  - **`RASPI_SERVER_HOST` 未設定**でスクリプトが接続に失敗: [deployment.md](../guides/deployment.md) 冒頭の例どおり **`export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`** を実行してから **`update-all-clients.sh`** を再実行。
  - **カードが旧レイアウト**: Pi4 の **`kiosk-browser` 再起動後**のバンドル／`deploy-status` を確認し、意図したブランチが各ホスト **`/opt/RaspberryPiSystem_002`** に取り込まれているかを見る。

### Leader order board Pi4 performance (2026-04-24)

- **目的**: Pi4 上の順位ボードで **一覧 GET のペイロードと再描画コスト**を抑え、**ポーリング・デバイス文脈**まわりの無駄な **`manual-order-overview` 取得**を減らす（**Web + API**・既存 URL は維持し **クエリ `responseProfile` を拡張**）。
- **API（要約）**: キオスク生産スケジュール一覧に **`responseProfile=leaderboard`**。**`leaderboard`** 時は **実績基準時間系の重い付与**を **省略**する。**件数取得（COUNT）と行選択の並列実行**は **2026-05-06** に **`leaderboard` 経路へも拡張**（[§COUNT 並列化（2026-05-06）](#leader-order-board-api-count-parallel-2026-05-06)·[KB-369](./KB-369-leader-order-board-api-internal-latency.md)）。**`resolvedMachineName` は 2026-04-28 追補以降 full と同じバッチ解決を維持**（`production-schedule-query.service.ts`・ルート `list.ts` / `shared.ts`・統合/ユニットテスト）。**省略時は従来どおり**（他画面の契約を壊さない）。
- **Web（要約）**: 順位ボード専用ビルドパス（例: `buildLeaderBoardViewModel.ts`・`LeaderBoardGrid.tsx`・`LeaderOrderResourceRow.tsx`・`LeaderBoardLeftToolStack.tsx`）、**`@tanstack/react-virtual`**、**`performance/leaderBoardRefetchPolicy.ts`**、**`useLeaderOrderBoardDeviceContext.ts`**（**`manual-order-overview` を順位ボード文脈から分離**）、**`useLeaderBoardDueAssist` / `useProductionScheduleMutations` の `useCallback` 安定化**・共有検索履歴 hooks の整理（`useKioskSharedSearchHistoryActions.ts` 等）。
- **Web 追補（2026-04-29）**: Pi4 の **15 秒ごとの `order-usage` 更新**で **全資源カード・全行に再レンダーが波及**しないよう、`LeaderBoardGrid.tsx` → `LeaderOrderResourceCard.tsx` → `LeaderOrderResourceRow.tsx` では **資源ごとの使用順位配列だけ**を渡す。`buildLeaderBoardViewModel.ts` は **中間配列を減らす 1 パス寄りのグループ化**へ寄せ、`LeaderOrderResourceCard.tsx` では **virtual row key を `row.id`** に固定し **overscan を抑制**、カード外枠の **`transition-all` は使わない**。見た目・API 契約は不変。
- **デプロイ・実機検証（2026-04-24）**:
  - **ブランチ**: `feat/kiosk-leaderboard-pi4-performance-solid`（機能コミット **`95bec8b7`**。**`main` マージ後**はマージコミットを正とする）。
  - **手順**: [deployment.md](../guides/deployment.md) の `update-all-clients.sh`・**`export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`**・**`--detach --follow`**。**対象 5 台**を **`--limit` 1 台ずつ**（**`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`**）。**Pi3 除外**。
  - **Detach Run ID**（`ansible-update-`）: **`20260424-153647-24567`** / **`20260424-154843-4943`** / **`20260424-155623-24544`** / **`20260424-160421-6565`** / **`20260424-161137-27861`**。いずれも **`failed=0` / `unreachable=0`**。
  - **自動実機検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（Mac / Tailscale・本セッション）。
- **本番デプロイ・実機検証（2026-04-29 追補・`order-usage` 再レンダー波及の追加抑制）**:
  - **ブランチ**: `feat/kiosk-leaderboard-pi4-followup`（代表コミット **`7902f5ac`**。**`main` マージ後**はマージコミットを正とする）。
  - **手順**: [deployment.md](../guides/deployment.md) の `update-all-clients.sh`・**`export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`**・**`--detach --follow`**。**対象 5 台**を **`--limit` 1 台ずつ**（**`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`**）。**Pi3 除外**（キオスク Web のみ・リソース僅少のため本節の Pi3 専用手順は不要）。
  - **Detach Run ID**（`ansible-update-`）: **`20260429-214453-13263`** / **`20260429-215053-15127`** / **`20260429-215805-17537`** / **`20260429-220418-1032`** / **`20260429-221048-28118`**。いずれも **`failed=0` / `unreachable=0`**。
  - **自動実機検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **64s**・Tailscale）。
- **知見**: **`responseProfile` は既定なし＝従来**にしておくと、**順位ボードだけ軽量経路**へ切り替えやすい。Pi4 は **DOM 数**も律速になりうるため **仮想化**と **API 削減**の両面が効く。**ポーリングはオブジェクト同一性だけでなく「渡す props の粒度」**でも再レンダーが伝播しうる → 資源単位の **配列参照**に分離すると **`order-usage` 周期での体感**が安定しやすい。
- **トラブルシューティング**:
  - **他画面の一覧が壊れた**: 順位ボード以外が **`responseProfile=leaderboard` を付けていないか**（Network タブ）を確認。付与ロジックは **プロファイル未指定時は従来**。
  - **`raspi4-kensaku-stonebase01` でデプロイログに barcode-agent 待機リトライ**: **1 回程度のリトライ後に成功**し得る。`PLAY RECAP` が **`failed=0`** なら完走扱い。繰り返す場合はエージェントと [deploy-status-recovery.md](../runbooks/deploy-status-recovery.md) を参照。

### Leader order board: child row layout + registered seiban panel (2026-04-02)

- **目的**: 順位ボード子行で **製番（`fseiban`）の視認性**を上げ、左端ホーバー内の **登録済み製番チップ**が **パネル下方の余白**まで使えるようにして、早すぎる内部スクロールを減らす。**Web のみ**・保存 API・順位 UI（ドロップダウン）は **不変**。
- **子行レイアウト**:
  - **上段**: 完了・**資源内順位**（`LeaderOrderRowOrderSelect`）・**工順（`fkojun`）**（truncate・`title` に全文）・納期・備考。
  - **中段**: [`presentLeaderOrderRow`](../../apps/web/src/features/kiosk/leaderOrderBoard/leaderOrderRowPresentation.ts) の **`machinePartLine`** — **機種記号 · 正規化機種名 · 製番 · 品目コード**。**`productNo`（製造 order 相当の部品行キー）は表示しない**（製番を優先するため）。
  - **下段**: **`partNameLine`** — **品名（`fhinmei`）のみ**（工順は上段へ移したため、`fkojun · fhinmei` 連結表示は廃止）。
  - **個数**: 従来どおり `quantityInlineJa`。配置は **中段の補助**（`fseiban` を含む `machinePartLine` の横）へ寄せ、上段の幅競合を減らす。
- **左ホーバー（製番検索カード）**: [`ProductionScheduleLeaderOrderBoardPage`](../../apps/web/src/pages/kiosk/ProductionScheduleLeaderOrderBoardPage.tsx) の `aside` に **`min-h-0`**、製番検索ブロックを **`flex-1 flex-col`**、登録済み一覧を **`min-h-0 flex-1 overflow-y-auto`** にし、旧 `max-h-28` 固定上限を撤去。下方の説明文・操作ボタンは **`shrink-0`**。
- **実装ブランチ**: `feat/leaderboard-card-and-hover-layout`。
- **本番デプロイ・実機検証（2026-04-03）**:
  - **手順**: [deployment.md](../guides/deployment.md) の `scripts/update-all-clients.sh` **のみ**。**`RASPI_SERVER_HOST`**（例: `100.106.158.2`）・**`--detach --follow`**。**対象**: **`raspberrypi5` → Pi4 キオスク 4 台**（`raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`）を **`--limit` 1 台ずつ**・**前段のリモート実行が成功してから次**。**Pi3 は対象外**（キオスク Web のみの変更。Pi3 が必要な変更では [deployment.md の Pi3 節](../guides/deployment.md) に従う）。
  - **Detach Run ID（実績）**: `20260403-073232-5264`（`raspberrypi5`）/ `20260403-073742-21502`（`raspberrypi4`）/ `20260403-074155-24422`（`raspi4-robodrill01`）/ `20260403-074502-2900`（`raspi4-fjv60-80`）/ `20260403-074901-19118`（`raspi4-kensaku-stonebase01`）。いずれも **`PLAY RECAP` `failed=0`**。Pi4 各ラウンドの後段プレイは **Pi3 signage で `no hosts matched`**（意図どおり）。
  - **自動実機検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 40 / WARN 0 / FAIL 0**（2026-04-03・Mac / Tailscale・実測 **約 25s**。チェック項目数は従来どおり）。
- **検証（開発者ローカル）**: `pnpm --filter @raspi-system/web lint` / `pnpm --filter @raspi-system/web test -- leaderOrderRowPresentation` / `pnpm --filter @raspi-system/web build`。
- **知見**:
  - **対象ホストを限定**し **1 本のシェルで順次** `&&` 連結すると、[deployment.md](../guides/deployment.md) の **Mac 側・Pi5 側の `update-all-clients` 排他ロック**と整合しやすい（**同一 Pi5 への並列起動はエラー**）。
  - **Pi5 を先に**載せ替えると、ブラウザが取りに行く **SPA/API** が先に更新される。続く Pi4 デプロイでは **`Git: changed`** と **kiosk-browser 再起動**が中心で、Pi4 側 **`Docker restart summary: []`** になりうる（サーバ側に Docker が無いため）。
- **トラブルシューティング**:
  - **ProductNo が見えなくなった**: 順位ボード子行では仕様どおり非表示。必要なら生産スケジュール本体一覧で確認する。
  - **工順が見切れる**: 上段は幅競合のため `truncate` 許容。ホバーで `title` 全文。
  - **左の登録チップがまだ低い窓のまま／子行が旧レイアウト**: **未反映 Pi4**・Pi5 **web イメージ**・ブランチ取り違えを疑う。`deploy-status`（各 `x-client-key`）と **`verify-phase12-real.sh`** で全体が健康なことを確認したうえ、[デプロイ・実機検証（2026-04-01）](#デプロイ実機検証2026-04-01) の **バンドル `curl` 手順**で `leader-order-board` が新バンドルに含まれるかを見る。
  - **Phase12 のみ失敗・Pi5 ping 失敗**: [KB-302](./ci-cd.md#kb-302-location-scope-resolverのブランド型ciビルド失敗とverify-phase12-realのping失敗)（Tailscale 遅延時の ICMP）。`verify-phase12-real.sh` の **再試行**後に再実行。
- **手動（任意・Pi4 / VNC）**: 長い製番・登録チップが多い状態で、左パネルが **下方まで伸びる**こと、子行が **上段＝工順・中段＝製番行・下段＝品名**になっていることを目視。

### デプロイ・実機検証（2026-04-01）

- **ブランチ**: `feat/kiosk-leader-order-board`（コミット例: `d887af88`）。
- **手順**: [deployment.md](../guides/deployment.md) の `scripts/update-all-clients.sh` **のみ**。**対象 5 台**を **1 台ずつ**・**`RASPI_SERVER_HOST`**・**`--detach --follow`**（**Pi3 は対象外**。Pi3 単体が必要な変更では [deployment.md の Pi3 節](../guides/deployment.md) に従う）。
- **Detach Run ID（実績）**:
  - `20260401-222838-29421`（`raspberrypi5`）
  - `20260401-223309-3294`（`raspberrypi4`）
  - `20260401-223736-22496`（`raspi4-robodrill01`）
  - `20260401-224101-487`（`raspi4-fjv60-80`）
  - `20260401-224506-23932`（`raspi4-kensaku-stonebase01`）  
  いずれも `PLAY RECAP` **`failed=0`**。
- **自動実機検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 40 / WARN 0 / FAIL 0**（2026-04-01・Mac / Tailscale）。
- **本番バンドル確認（任意）**: SPA の `index-*.js` は HTML 上 **`/assets/...`**（`/kiosk/assets/...` ではない）。`curl -sk https://<Pi5>/kiosk/` で `src` を確認のうえ、`curl -sk https://<Pi5>/assets/<hash>.js | grep -c leader-order-board` で新ルートが含まれることを確認できる。

### デプロイ・実機検証（2026-04-02・行アクション）

- **ブランチ**: `feat/kiosk-leader-order-board-row-actions`（機能コミット後、**ドキュメント＋`main` マージは本記録に続く PR**）。
- **手順**: [deployment.md](../guides/deployment.md) の `scripts/update-all-clients.sh` **のみ**。**Pi5 → Pi4×4** を **`--limit` 1 台ずつ**（**Pi3 除外**。既定どおり）。
- **先行デプロイ実績**: 会話セッション上、5 台順次デプロイ **`PLAY RECAP failed=0`** まで完走。**Detach Run ID** は GitHub Actions の Ansible ログ、または Pi5 の `logs/deploy/*.status.json` で確認（本 KB では固定 ID を省略）。
- **自動実機検証（本セッション）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 40 / WARN 0 / FAIL 0**（2026-04-02・Mac / Tailscale・デプロイ反映後の回帰）。
- **手動（任意・UI）**: 実機/VNC で順位ボードを開き、**未完/完了フィルタ**・**✓ 完了切替**・**順位ドロップダウン（`-` で自動並び復帰）**・**MH/SH 機種名表示**を確認（Mac ブラウザのみだと自己署名でエラーになりうる → [KB-306](./frontend.md) と同趣旨）。

### 順位ボード 納期アシスト（製番検索・詳細シート、2026-04-02）

- **目的**: 順位ボード上で **製番（`fseiban`）を検索**し、**共有検索履歴**（既存 `kiosk-production-schedule-search-history`）を更新しつつ、**詳細シート**で **部品一覧（最小列）** と **製番全体納期 / 処理区分別納期** を確認・更新する。**初期実装**は **右 `fixed` ペイン**だったが、**カレンダー（Dialog）の z-index** と **第1列↔第2列の `mouseLeave`** による誤閉じを避けるため、**左2段スタック**へ **追補**（下節）。
- **境界**: Web のみ。`useLeaderBoardDueAssist`（[`useLeaderBoardDueAssist.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/useLeaderBoardDueAssist.ts)）が **履歴 mutation・詳細 query・納期 mutation・日付モーダル**を束ね、`LeaderBoardDueAssistPanel`（[`LeaderBoardDueAssistPanel.tsx`](../../apps/web/src/features/kiosk/leaderOrderBoard/LeaderBoardDueAssistPanel.tsx)）が UI。既存 API（`GET .../due-management/seiban/:fseiban`、`PUT` 納期系、検索履歴更新）を利用。**新設 HTTP 契約なし**。
- **操作**: 左ドロワーで製番入力→確定で履歴先頭に追加し詳細オープン。履歴チップで再選択。詳細閉じ時は **`pointer-events-none` + `aria-hidden`** で背面操作を遮断。`Escape` で詳細のみ閉じる。日付は既存 `KioskDatePickerModal` を **製番全体 / 処理行** の2経路で再利用。
- **React Query**: `useUpdateKioskProductionScheduleSearchHistory` の `onSuccess` で **`kiosk-production-schedule-search-history`** を invalidate（履歴即時反映）。履歴・納期更新は try/catch で **未処理拒否**を避ける。
- **デプロイ・実機（2026-04-02）**:
  - **ブランチ**: `feat/leaderboard-due-assist`（コミット例: `382ad85e`）。
  - **手順**: [deployment.md](../guides/deployment.md) の `update-all-clients.sh` **のみ**。**Pi5 → Pi4×4** を **`--limit` 1 台ずつ**（**Pi3 除外**。サイネージ専用変更ではない）。
  - **Detach Run ID（実績）**:
    - `20260402-193759-29957`（`raspberrypi5`）
    - `20260402-194158-24725`（`raspberrypi4`）
    - `20260402-194636-6723`（`raspi4-robodrill01`）
    - `20260402-195000-30215`（`raspi4-fjv60-80`）
    - `20260402-195451-6422`（`raspi4-kensaku-stonebase01`）  
    いずれも `PLAY RECAP` **`failed=0`**。
  - **自動実機検証（マージ前・Mac / Tailscale）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 40 / WARN 0 / FAIL 0**（約 55s・本セッション）。
- **知見**: 順位ボードの **納期編集**は納期管理ページと同系の **seiban 詳細 + 日付モーダル** に寄せ、API を増やさずにリーダー導線を短縮できる。履歴 invalidate を hooks 側に寄せると左リストとサーバ状態のズレが減る。
- **トラブルシューティング**:
  - **検索確定しても履歴が変わらない / 詳細が開かない**: ネットワーク・`x-client-key`・検索履歴 API のエラーを確認。mutation 失敗時は **選択状態を変えない**設計のため、UI が動かないのは仕様。
  - **詳細シートが閉じているのにクリックできない**: 実装は閉じ時 `pointer-events-none`（幅 0・`opacity-0`）。古いビルドや CSS 競合を疑う。
  - **部品表が空**: 当該製番に納期管理の部品行が無い。**データ側**の triage / seiban 同期を確認。

### 順位ボード 共有登録製番・子行備考・機種名一括解決（2026-04-02）

- **登録製番**: 左ペインの履歴を **`PUT /kiosk/production-schedule/search-state`**（If-Match / 409 収束）に統一し、生産スケジュール本体と **同一の共有 `history`** を読み書きする（端末別 `search-history` からの移行）。実装: [`useKioskSharedSearchHistoryActions.ts`](../../apps/web/src/features/kiosk/productionSchedule/useKioskSharedSearchHistoryActions.ts)、[`useLeaderBoardDueAssist.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/useLeaderBoardDueAssist.ts)。
- **機種名**: **`POST /kiosk/production-schedule/seiban-machine-names`** がサーバ側で **`fetchSeibanProgressRows`** を呼び、手動順番 overview と同系の MH/SH 機種表示名を返す。一覧レスポンスに MH/SH 行が無い場合でも子行の機種名を安定させる。リクエストは **重複除去・trim 後最大 100 製番**（Zod + サービス側で整合）。Web: `useKioskProductionScheduleSeibanMachineNames`、`mergeLeaderBoardRowsWithResolvedMachineNames` → 既存 `mergeMachineNameFallback`（history-progress）で最終補完。
- **備考**: 子行は常に **鉛筆アイコン**（空＝グレーで追加、有り＝アンバーで編集）。`title` でホバー時全文（有りのみ）、タップで `KioskNoteModal`（`LeaderOrderResourceCard` / `ProductionScheduleLeaderOrderBoardPage`）。共有 SVG: `KioskPencilGlyph`。

- **本番デプロイ・実機検証（2026-04-02）**:
  - **ブランチ**: `feat/kiosk-leader-board-shared-history-notes-machine-names`（機能コミット例: `66b7ff9e`。**ドキュメント反映後**は `main` マージコミットを正とする）。
  - **手順**: [deployment.md](../guides/deployment.md) の **`scripts/update-all-clients.sh`** のみ。**Pi5 → Pi4×4** を **`--limit` 1 台ずつ**・**`--detach --follow`**・**`RASPI_SERVER_HOST`**（例: `denkon5sd02@100.106.158.2`）。**Pi3 は対象外**（本変更はキオスク/API。Pi3 専用手順は不要）。
  - **実績（デプロイ）**: `raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01` を順次実行し、各 **`PLAY RECAP` `failed=0`**（同一セッションで完走。**項目数は Phase12 と同じ 40**）。
  - **実機回帰（自動）**: リポジトリルートで `./scripts/deploy/verify-phase12-real.sh` → **PASS 40 / WARN 0 / FAIL 0**（2026-04-02・Mac / Tailscale・約 **54s**）。本 API はスクリプトに専用 grep が無いが、Pi5 `api` 更新込みの **全体回帰**で異常が無いことを確認。
  - **手動スモーク（任意・Pi4 / VNC）**: `/kiosk/production-schedule/leader-order-board` で **左の登録製番チップ**が生産スケジュール画面と **同じ履歴**に見えること。**子行の鉛筆**で備考モーダルが開き、保存後に **グレー↔アンバー**が切り替わること。**機種名**が一覧に MH/SH 行が無い製番でも埋まる場合があること（進捗基盤依存）。
  - **手動スモーク（任意・curl）**: `POST https://<Pi5>/kiosk/production-schedule/seiban-machine-names`・`Content-Type: application/json`・**`x-client-key`**（実キオスクの `ClientDevice.apiKey`）・body `{"fseibans":["<既知のFSEIBAN>"]}` → **200**・JSON **`machineNames`** がオブジェクトであること（空製番は **400** 想定）。

- **知見**:
  - 共有履歴は **search-state 一本化**により、順位ボード左ペインと本流スケジュールの「登録製番」**ドリフト**を防ぐ。競合は **If-Match + 409 リトライ**で収束（hook に閉じ込める）。
  - 機種名の **一覧外補完**は **BFF 集約 POST** にすると、キオスクが MH/SH 行の有無に依存せず表示を揃えられる（クライアントは **空の `machineName` だけ**サーバ解決値で上書き）。

- **トラブルシューティング**:
  - **履歴が端末ごとに違う（移行前のまま）**: Web が古い **`search-history`** を読んでいないか、Pi4 だけ未デプロイでないか確認。[`useKioskSharedSearchHistoryActions`](../../apps/web/src/features/kiosk/productionSchedule/useKioskSharedSearchHistoryActions.ts) が載ったバンドルか。
  - **備考を保存しても戻る / 428**: `search-state` の **ETag** 不整合。**他端末の同時更新**またはタブ多重を疑い、再フェッチ後に再試行。
  - **`seiban-machine-names` が 401**: **`x-client-key`** が実デバイスに紐づいていない（ダミー不可）。
  - **機種名が相変わらず空**: `fetchSeibanProgressRows` 側に当該製番の MH/SH が無い、または ERP データ空。**データ・同期**を先に確認（UI は補完のみ）。
  - **Phase12 のみ失敗・「Pi5に到達できません」**: [KB-302](./ci-cd.md#kb-302-location-scope-resolverのブランド型ciビルド失敗とverify-phase12-realのping失敗)（ICMP 偶発）。最新 `verify-phase12-real.sh` の **ping 再試行**、`curl`/SSH が通るなら再実行。

### 順位ボード 納期アシスト UI（左2段スタック・モーダル z-index、2026-04-02 追補）

- **目的（追補）**: 詳細が **右固定・高 z** のとき、日付 **`Dialog`（既定 `z-50`）** が詳細・全画面ディムより **下** に来て **カレンダー操作が不安定**／**第1 `aside` から第2シートへマウスが移る `mouseLeave`** で左ドロワーが **遅延閉じ** する問題を解消する。
- **配置**: **14px ホットゾーン＋第1 `aside`（操作パネル）＋第2 `aside`（`LeaderBoardDueAssistPanel`）** を **同一 flex 行**で囲み、`onMouseEnter` / `onMouseLeave` は **外枠のみ**。`useKioskLeftEdgeDrawerReveal(true, { keepOpen: dueAssist.isDetailOpen })` で **詳細中はホバーに依存せず左スタックを展開維持**（タッチ／カレンダー操作中の誤閉じ防止）。
- **ディム**: 詳細オープン時のみ **メイン（ボード）** を覆う（`fixed` で `left` を左スタック総幅に同期、`ResizeObserver`、`z-40`。左スタックは `z-50`）。クリックで `closeDetail`。
- **日付モーダル**: `Dialog` / `KioskDatePickerModal` に任意 **`overlayZIndex`**。納期アシスト用 **`KioskDatePickerModal` だけ** `KIOSK_DATE_PICKER_OVERLAY_Z_ABOVE_LEFT_STACK`（**80**・[`kioskRevealUi.ts`](../../apps/web/src/hooks/kioskRevealUi.ts)）。順位ボード **行の納期**用モーダルは **未指定**（既定 `z-50` のまま）。
- **参照実装**: [`useKioskLeftEdgeDrawerReveal.ts`](../../apps/web/src/hooks/useKioskLeftEdgeDrawerReveal.ts)、[`ProductionScheduleLeaderOrderBoardPage.tsx`](../../apps/web/src/pages/kiosk/ProductionScheduleLeaderOrderBoardPage.tsx)、[`LeaderBoardDueAssistPanel.tsx`](../../apps/web/src/features/kiosk/leaderOrderBoard/LeaderBoardDueAssistPanel.tsx)、[`Dialog.tsx`](../../apps/web/src/components/ui/Dialog.tsx)。
- **デプロイ・実機（2026-04-02 追補）**:
  - **ブランチ**: `feat/leaderboard-due-assist-left-stack`（コミット例: `cd25bae5`。ドキュメント追記後は `main` マージコミットを正とする）。
  - **手順**: [deployment.md](../guides/deployment.md) の `update-all-clients.sh`。**Pi5 → Pi4×4** を **`--limit` 1 台ずつ**（**Pi3 除外**）。
  - **実績**: 各回 `PLAY RECAP` **`failed=0`**（Mac / Tailscale・順次5回完走）。Pi5 デプロイログ例: `ansible-update-20260402-204715-25095.summary.json`（最終台処理に付随する命名）。
- **自動実機検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 40 / WARN 0 / FAIL 0**（2026-04-02・Mac / Tailscale・約 60s・**項目数は従来どおり**）。
- **知見**: キオスク **固定シート**と **Portal モーダル**の z-index 不整合は、見た目だけでなく **操作完了後の状態**（詳細が開いたままか）まで崩す。**重ね順だけオプションで上げる**と既存呼び出しへの影響が最小。
- **トラブルシューティング**:
  - **カレンダーがシートの下に隠れる・タップしても反応が不安定**: `overlayZIndex` 未配線・Pi5 未デプロイ・ブラウザが古いバンドルを表示を疑う。
  - **詳細中に左第1列だけ勝手に閉じる**: 外枠 hover 統合・`keepOpen`・ビルド世代を疑う。

### トラブルシューティング

- **デプロイが Pi5 で止まる / ローカルだけ未 push エラー**: `update-all-clients.sh` の fail-fast（[KB-200](./infrastructure/ansible-deployment.md#kb-200-デプロイ標準手順のfail-fastチェック追加とデタッチ実行ログ追尾機能)）、リモートロック二重起動（deployment.md 2026-03-29 追記）を参照。
- **キオスクに新画面が出ない**: Pi5 のみ更新して Pi4 を更新していない、またはブラウザキャッシュ。**5 台すべて**順次更新後、kiosk-browser 再起動済みか Ansible ログの `kiosk-browser.service` を確認。
- **順位ドロップダウンが選べない / 空**: 当該資源で **既に他行が 1〜10 を占有**していると、空き番＋現行値以外は選べない（生産スケジュールと同じ `order-usage` ルール）。**完了行**は順位変更を無効化。**占有行が画面に無い**場合は [§A+α 自動解放（2026-05-20）](#leader-order-board-order-assignment-auto-release-a-alpha-2026-05-20) を参照（次回 FKOJUNST/本体 CSV 同期で解放）。
- **機種名がまだ空**: スケジュールと `history-progress` の両方に製番が無い、またはどちらも機種名フィールドが空。**データ側**の MH/SH 行・進捗同期を疑う（本 UI は補完のみ）。
