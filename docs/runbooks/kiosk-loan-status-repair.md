---
title: Runbook: キオスク貸出の取消混入と資産statusの修復
tags: [運用, キオスク, 貸出, 取消, データ修復, runbook]
audience: [運用者, 開発者]
last-verified: 2026-01-29
related:
  - ../knowledge-base/kb-kiosk-rigging-return-cancel-investigation.md
  - ../modules/tools/operations.md
category: runbooks
---

# Runbook: キオスク貸出の取消混入と資産statusの修復

## 目的

- 取消済みLoanが「貸出中」判定に混入して再スキャンでエラーになる事象を収束させる。
- 資産（工具/吊具/計測機器）の `status` を、実際のアクティブLoanと整合させる。

## 前提

- DBへの参照権限があること（本Runbookの更新は **status のみ**）。
- Loanの意味論を壊さないため、**`returnedAt` を勝手に埋めない**。

## 手順

### 1) タグUIDから対象資産を特定する

#### 吊具（Rigging）
```sql
SELECT rg.id, rg."managementNumber", rg.name, rg.status, rgt."rfidTagUid" AS tag_uid
FROM "RiggingGearTag" rgt
JOIN "RiggingGear" rg ON rg.id = rgt."riggingGearId"
WHERE upper(rgt."rfidTagUid") = upper('<TAG_UID>');
```

#### 計測機器（MeasuringInstrument）
```sql
SELECT mi.id, mi."managementNumber", mi.name, mi.status, mit."rfidTagUid" AS tag_uid
FROM "MeasuringInstrumentTag" mit
JOIN "MeasuringInstrument" mi ON mi.id = mit."measuringInstrumentId"
WHERE upper(mit."rfidTagUid") = upper('<TAG_UID>');
```

#### 工具（Item）
```sql
SELECT id, "itemCode", name, status, "nfcTagUid" AS tag_uid
FROM "Item"
WHERE upper("nfcTagUid") = upper('<TAG_UID>');
```

### 2) Loanの状態を確認する（貸出中/取消混入）

#### 吊具（riggingGearId を使う）
```sql
SELECT
  COUNT(*) FILTER (WHERE "returnedAt" IS NULL) AS returned_null_total,
  COUNT(*) FILTER (WHERE "returnedAt" IS NULL AND "cancelledAt" IS NOT NULL) AS returned_null_cancelled_notnull,
  COUNT(*) FILTER (WHERE "returnedAt" IS NULL AND "cancelledAt" IS NULL) AS returned_null_cancelled_null
FROM "Loan"
WHERE "riggingGearId" = '<RIGGING_GEAR_ID>';
```

#### 計測機器（measuringInstrumentId）
```sql
SELECT
  COUNT(*) FILTER (WHERE "returnedAt" IS NULL) AS returned_null_total,
  COUNT(*) FILTER (WHERE "returnedAt" IS NULL AND "cancelledAt" IS NOT NULL) AS returned_null_cancelled_notnull,
  COUNT(*) FILTER (WHERE "returnedAt" IS NULL AND "cancelledAt" IS NULL) AS returned_null_cancelled_null
FROM "Loan"
WHERE "measuringInstrumentId" = '<MEASURING_INSTRUMENT_ID>';
```

#### 工具（itemId）
```sql
SELECT
  COUNT(*) FILTER (WHERE "returnedAt" IS NULL) AS returned_null_total,
  COUNT(*) FILTER (WHERE "returnedAt" IS NULL AND "cancelledAt" IS NOT NULL) AS returned_null_cancelled_notnull,
  COUNT(*) FILTER (WHERE "returnedAt" IS NULL AND "cancelledAt" IS NULL) AS returned_null_cancelled_null
FROM "Loan"
WHERE "itemId" = '<ITEM_ID>';
```

**判断基準**:
- `returned_null_cancelled_null = 0` なら **アクティブLoanなし**。
- `returned_null_cancelled_notnull > 0` なら **取消混入**がある（再スキャンで「貸出中」になる原因）。

### 3) 資産statusの整合性を確認する

アクティブLoanが存在しないのに `status = IN_USE` の場合、不整合。

#### 吊具
```sql
SELECT id, status FROM "RiggingGear" WHERE id = '<RIGGING_GEAR_ID>';
```

#### 計測機器
```sql
SELECT id, status FROM "MeasuringInstrument" WHERE id = '<MEASURING_INSTRUMENT_ID>';
```

#### 工具
```sql
SELECT id, status FROM "Item" WHERE id = '<ITEM_ID>';
```

### 4) 修復（statusのみ更新）

**条件**: `returned_null_cancelled_null = 0`（アクティブLoanが無いことを確認済み）

#### 吊具
```sql
UPDATE "RiggingGear"
SET status = 'AVAILABLE'
WHERE id = '<RIGGING_GEAR_ID>' AND status = 'IN_USE';
```

#### 計測機器
```sql
UPDATE "MeasuringInstrument"
SET status = 'AVAILABLE'
WHERE id = '<MEASURING_INSTRUMENT_ID>' AND status = 'IN_USE';
```

#### 工具
```sql
UPDATE "Item"
SET status = 'AVAILABLE'
WHERE id = '<ITEM_ID>' AND status = 'IN_USE';
```

### 5) 修復後の検証

- **再度** 手順2・3のSELECTを実行して、`status` が `AVAILABLE` になったことを確認。
- 可能ならキオスクで再スキャンして「貸出中」エラーが出ないことを確認。

## 参考

- 取消混入と返却/取消の処理不整合についての調査結果:  
  `docs/knowledge-base/kb-kiosk-rigging-return-cancel-investigation.md`
