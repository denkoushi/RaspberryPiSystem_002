# データ集計時の紐づけについて

## 概要

持出・返却・取消のデータは、**Loanテーブルの`id`（UUID）**で完璧に紐づけられています。ダッシュボードでの集計時に、このIDを使用して正確な集計が可能です。

## データ構造

### Loanテーブル（貸出記録）

```sql
Loan {
  id           UUID (主キー)  -- 持出・返却・取消を紐づける唯一のID
  itemId       UUID?          -- アイテムID（写真撮影持出の場合はnull）
  employeeId   UUID?          -- 従業員ID
  clientId     UUID?          -- クライアント端末ID
  borrowedAt   DateTime        -- 持出日時
  returnedAt   DateTime?      -- 返却日時（返却済みの場合）
  cancelledAt  DateTime?      -- 取消日時（取消済みの場合）
  ...
}
```

### Transactionテーブル（操作履歴）

```sql
Transaction {
  id       UUID (主キー)
  loanId   UUID?  -- Loanテーブルへの外部キー（持出・返却・取消を紐づける）
  action   TransactionAction  -- 'BORROW' | 'RETURN' | 'CANCEL'
  ...
}
```

## データの紐づけ方法

### 1. 持出時（BORROW）

1. **Loanレコードを作成**
   - `id`が自動生成される（例: `loan-123`）
   - `borrowedAt`に持出日時が設定される

2. **Transactionレコードを作成**
   - `loanId = loan-123`
   - `action = 'BORROW'`

### 2. 返却時（RETURN）

1. **同じLoanレコードを更新**
   - `id = loan-123`（持出時のIDと同じ）
   - `returnedAt`に返却日時が設定される

2. **Transactionレコードを作成**
   - `loanId = loan-123`（持出時のIDと同じ）
   - `action = 'RETURN'`

### 3. 取消時（CANCEL）

1. **同じLoanレコードを更新**
   - `id = loan-123`（持出時のIDと同じ）
   - `cancelledAt`に取消日時が設定される

2. **Transactionレコードを作成**
   - `loanId = loan-123`（持出時のIDと同じ）
   - `action = 'CANCEL'`

## ダッシュボードでの集計例

### 例1: 持出と返却の紐づけ

```sql
-- 持出と返却を紐づけて集計
SELECT 
  l.id AS loan_id,
  l.borrowedAt,
  l.returnedAt,
  l.cancelledAt,
  COUNT(CASE WHEN t.action = 'BORROW' THEN 1 END) AS borrow_count,
  COUNT(CASE WHEN t.action = 'RETURN' THEN 1 END) AS return_count,
  COUNT(CASE WHEN t.action = 'CANCEL' THEN 1 END) AS cancel_count
FROM "Loan" l
LEFT JOIN "Transaction" t ON t."loanId" = l.id
WHERE l."cancelledAt" IS NULL  -- 取消済みを除外（ダッシュボード用）
GROUP BY l.id, l.borrowedAt, l.returnedAt, l.cancelledAt;
```

### 例2: 返却率の計算

```sql
-- 返却率を計算（取消済みは除外）
SELECT 
  COUNT(CASE WHEN l."returnedAt" IS NOT NULL THEN 1 END) * 100.0 / 
  COUNT(*) AS return_rate
FROM "Loan" l
WHERE l."cancelledAt" IS NULL;  -- 取消済みを除外
```

### 例3: アイテム別の持出・返却・取消の集計

```sql
-- アイテム別に持出・返却・取消を集計
SELECT 
  l."itemId",
  i.name AS item_name,
  COUNT(CASE WHEN t.action = 'BORROW' THEN 1 END) AS borrow_count,
  COUNT(CASE WHEN t.action = 'RETURN' THEN 1 END) AS return_count,
  COUNT(CASE WHEN t.action = 'CANCEL' THEN 1 END) AS cancel_count
FROM "Loan" l
LEFT JOIN "Item" i ON i.id = l."itemId"
LEFT JOIN "Transaction" t ON t."loanId" = l.id
WHERE l."cancelledAt" IS NULL  -- 取消済みを除外（ダッシュボード用）
GROUP BY l."itemId", i.name;
```

### 例4: 従業員別の持出・返却・取消の集計

```sql
-- 従業員別に持出・返却・取消を集計
SELECT 
  l."employeeId",
  e."displayName" AS employee_name,
  COUNT(CASE WHEN t.action = 'BORROW' THEN 1 END) AS borrow_count,
  COUNT(CASE WHEN t.action = 'RETURN' THEN 1 END) AS return_count,
  COUNT(CASE WHEN t.action = 'CANCEL' THEN 1 END) AS cancel_count
FROM "Loan" l
LEFT JOIN "Employee" e ON e.id = l."employeeId"
LEFT JOIN "Transaction" t ON t."loanId" = l.id
WHERE l."cancelledAt" IS NULL  -- 取消済みを除外（ダッシュボード用）
GROUP BY l."employeeId", e."displayName";
```

## 重要なポイント

1. **Loan.idが唯一の紐づけキー**
   - 持出・返却・取消は全て同じ`Loan.id`で紐づけられる
   - Transactionテーブルの`loanId`でLoanと紐づく

2. **取消済みデータの除外**
   - ダッシュボードでは`WHERE cancelledAt IS NULL`で取消済みを除外
   - データは削除されないため、必要に応じて取消データも集計可能

3. **Transactionテーブルで操作履歴を追跡**
   - 各操作（持出・返却・取消）がTransactionレコードとして記録される
   - `loanId`でグループ化することで、1つのLoanに対する全操作を取得可能

4. **データの整合性**
   - 外部キー制約により、データの整合性が保証される
   - Loanが削除されても、Transactionレコードは残る（`loanId`はNULLになる）

## PowerBIでの使用例

PowerBIでデータをインポートする場合：

1. **LoanテーブルとTransactionテーブルを`loanId`で結合**
2. **取消済みLoanを除外**（`cancelledAt IS NULL`）
3. **Transaction.actionでグループ化**して持出・返却・取消を集計

これにより、正確な集計が可能です。

