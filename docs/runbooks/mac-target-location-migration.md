# Mac ロケーションデータ移行 Runbook

## 目的

- `location = 'Mac'` に蓄積された納期管理データを、実運用ロケーション（例: `第2工場`）へ安全に移行する。
- 全端末共有の基準順位（global shared）へ統合する。

## 対象テーブル

- `ProductionScheduleGlobalRank`（基準順位）
- `ProductionScheduleGlobalRowRank`（行単位順位）
- `ProductionScheduleSeibanDueDate`
- `ProductionSchedulePartPriority`
- `ProductionSchedulePartProcessingType`
- `ProductionScheduleRowNote`
- `ProductionScheduleTriageSelection`
- `ProductionScheduleDailyPlan`（本日計画は原則移行しない。必要時のみ手動）

## 事前確認

1. 移行先ロケーション（例: `第2工場`）を決める。
2. 移行時間帯に Mac 端末からの納期管理更新を停止する。
3. DBバックアップを取得する（必須）。

## 手順（SQL）

以下は `target_location = '第2工場'` の例。

```sql
BEGIN;

-- 1) 全端末共有順位へ統合（重複時は Mac を優先）
DELETE FROM "ProductionScheduleGlobalRank"
WHERE "csvDashboardId" = '3f2f6b0e-6a1e-4c0b-9d0b-1a4f3f0d2a01'
  AND "location" = 'shared-global-rank';

INSERT INTO "ProductionScheduleGlobalRank" (
  "id","csvDashboardId","location","fseiban","priorityOrder","sourceType","createdAt","updatedAt"
)
SELECT
  gen_random_uuid(),
  "csvDashboardId",
  'shared-global-rank',
  "fseiban",
  "priorityOrder",
  "sourceType",
  now(),
  now()
FROM "ProductionScheduleGlobalRank"
WHERE "csvDashboardId" = '3f2f6b0e-6a1e-4c0b-9d0b-1a4f3f0d2a01'
  AND "location" = 'Mac'
ORDER BY "priorityOrder" ASC;

-- 2) ロケーション個別データを移送（競合時は Mac を優先上書き）
DELETE FROM "ProductionScheduleSeibanDueDate" WHERE "csvDashboardId" = '3f2f6b0e-6a1e-4c0b-9d0b-1a4f3f0d2a01' AND "location" = '第2工場';
INSERT INTO "ProductionScheduleSeibanDueDate" ("id","csvDashboardId","location","fseiban","dueDate","createdAt","updatedAt")
SELECT gen_random_uuid(),"csvDashboardId",'第2工場',"fseiban","dueDate",now(),now()
FROM "ProductionScheduleSeibanDueDate"
WHERE "csvDashboardId" = '3f2f6b0e-6a1e-4c0b-9d0b-1a4f3f0d2a01' AND "location" = 'Mac';

DELETE FROM "ProductionSchedulePartPriority" WHERE "csvDashboardId" = '3f2f6b0e-6a1e-4c0b-9d0b-1a4f3f0d2a01' AND "location" = '第2工場';
INSERT INTO "ProductionSchedulePartPriority" ("id","csvDashboardId","location","fseiban","fhincd","priorityRank","createdAt","updatedAt")
SELECT gen_random_uuid(),"csvDashboardId",'第2工場',"fseiban","fhincd","priorityRank",now(),now()
FROM "ProductionSchedulePartPriority"
WHERE "csvDashboardId" = '3f2f6b0e-6a1e-4c0b-9d0b-1a4f3f0d2a01' AND "location" = 'Mac';

COMMIT;
```

## 検証

```sql
SELECT "location", count(*) FROM "ProductionScheduleGlobalRank"
WHERE "csvDashboardId" = '3f2f6b0e-6a1e-4c0b-9d0b-1a4f3f0d2a01'
GROUP BY "location";
```

- `shared-global-rank` に順位が存在すること。
- `Mac` でのみ保持していた順位/納期が移行先で参照できること。

## ロールバック

- バックアップから対象テーブルを復元する。
- 復元後、`shared-global-rank` レコードを削除して旧運用に戻す。
