---
title: 工具管理モジュール 運用・保守ガイド
tags: [工具管理, 運用, 保守, データ整合性, 復旧]
audience: [運用者, 管理者]
last-verified: 2025-12-01
related: [README.md, services.md, api.md, ../../guides/backup-and-restore.md]
category: operations
update-frequency: medium
---

# 工具管理モジュール 運用・保守ガイド

最終更新: 2025-12-01

## 概要

本ドキュメントでは、工具管理モジュールの運用・保守に関する詳細な手順を説明します。データ整合性の保証方法、復旧手順、エラーハンドリング、状態遷移の詳細を含みます。

## 目次

1. [データ整合性の保証方法](#データ整合性の保証方法)
2. [状態遷移の詳細](#状態遷移の詳細)
3. [エラーハンドリングの詳細](#エラーハンドリングの詳細)
4. [データ整合性チェック](#データ整合性チェック)
5. [復旧手順](#復旧手順)
6. [トラブルシューティング](#トラブルシューティング)

---

## データ整合性の保証方法

### 整合性ルール

工具管理システムでは、以下の整合性ルールが保証されています：

#### 1. LoanとItemステータスの整合性

**ルール**: 
- `Item.status = IN_USE` の場合、必ず `Loan.returnedAt IS NULL` かつ `Loan.cancelledAt IS NULL` のLoanレコードが1件存在する
- `Item.status = AVAILABLE` の場合、`Loan.returnedAt IS NULL` かつ `Loan.cancelledAt IS NULL` のLoanレコードは存在しない
- `Item.status = RETIRED` の場合、新しいLoanレコードは作成できない

**保証方法**:
- 持出処理（`borrow`）: トランザクション内で `Loan` 作成 → `Item.status` を `IN_USE` に更新
- 返却処理（`return`）: トランザクション内で `Loan.returnedAt` を設定 → `Item.status` を `AVAILABLE` に更新
- 取消処理（`cancel`）: トランザクション内で `Loan.cancelledAt` を設定 → `Item.status` を `AVAILABLE` に更新

**トランザクション処理**:
```typescript
// 持出処理の例
await prisma.$transaction(async (tx) => {
  const loan = await tx.loan.create({ ... });
  await tx.item.update({ where: { id: item.id }, data: { status: ItemStatus.IN_USE } });
  await tx.transaction.create({ ... });
});
```

#### 2. LoanとTransactionの整合性

**ルール**:
- すべての `Loan` レコードには、少なくとも1件の `Transaction` レコードが存在する（`action = BORROW`）
- `Loan.returnedAt IS NOT NULL` の場合、`action = RETURN` の `Transaction` レコードが存在する
- `Loan.cancelledAt IS NOT NULL` の場合、`action = CANCEL` の `Transaction` レコードが存在する

**保証方法**:
- すべてのLoan操作（持出・返却・取消）は、トランザクション内で `Transaction` レコードを作成する

#### 3. 写真ファイルとLoanの整合性

**ルール**:
- `Loan.photoUrl IS NOT NULL` の場合、対応する写真ファイルが `storage/photos/` に存在する
- `Loan.photoUrl IS NOT NULL` の場合、対応するサムネイルファイルが `storage/thumbnails/` に存在する

**保証方法**:
- 写真撮影持出（`photoBorrow`）: トランザクション内で写真ファイルを保存 → `Loan.photoUrl` を設定
- Loan削除（`delete`）: `Loan.photoUrl` が存在する場合、写真ファイルも削除

---

## 状態遷移の詳細

### Itemステータスの遷移

```
AVAILABLE ──[持出処理]──> IN_USE ──[返却処理]──> AVAILABLE
   │                          │
   │                          └──[取消処理]──> AVAILABLE
   │
   └──[廃棄処理]──> RETIRED
```

#### 遷移ルール

1. **AVAILABLE → IN_USE**
   - **トリガー**: `POST /api/tools/borrow`（持出処理）
   - **条件**: 
     - アイテムが存在する
     - アイテムステータスが `AVAILABLE` または `IN_USE`（既存Loanチェックで除外）
     - アイテムステータスが `RETIRED` でない
     - 既存の未返却Loanが存在しない
   - **処理**: 
     - `Loan` レコード作成（`returnedAt = NULL`, `cancelledAt = NULL`）
     - `Item.status` を `IN_USE` に更新
     - `Transaction` レコード作成（`action = BORROW`）

2. **IN_USE → AVAILABLE（返却）**
   - **トリガー**: `POST /api/tools/return`（返却処理）
   - **条件**:
     - Loanレコードが存在する
     - `Loan.returnedAt IS NULL`
     - `Loan.cancelledAt IS NULL`
   - **処理**:
     - `Loan.returnedAt` を現在日時に設定
     - `Item.status` を `AVAILABLE` に更新
     - `Transaction` レコード作成（`action = RETURN`）

3. **IN_USE → AVAILABLE（取消）**
   - **トリガー**: `POST /api/tools/loans/:id/cancel`（取消処理）
   - **条件**:
     - Loanレコードが存在する
     - `Loan.returnedAt IS NULL`
     - `Loan.cancelledAt IS NULL`
   - **処理**:
     - `Loan.cancelledAt` を現在日時に設定
     - `Item.status` を `AVAILABLE` に更新
     - `Transaction` レコード作成（`action = CANCEL`）

4. **AVAILABLE → RETIRED**
   - **トリガー**: `PUT /api/tools/items/:id`（アイテム更新）
   - **条件**: 管理者権限が必要
   - **処理**: `Item.status` を `RETIRED` に更新
   - **注意**: `RETIRED` 状態のアイテムは持出できない

### Loanの状態

```
[新規作成]
    │
    ├──[返却]──> returnedAt IS NOT NULL
    │
    └──[取消]──> cancelledAt IS NOT NULL
```

#### 状態定義

- **アクティブ**: `returnedAt IS NULL` かつ `cancelledAt IS NULL`
- **返却済み**: `returnedAt IS NOT NULL`
- **取消済み**: `cancelledAt IS NOT NULL`

**注意**: `returnedAt` と `cancelledAt` は同時に設定されることはない（ビジネスロジックで保証）

---

## エラーハンドリングの詳細

### 持出処理（borrow）のエラーケース

#### 1. アイテムが見つからない（404）

**エラー**: `対象アイテムが登録されていません`

**原因**:
- NFCタグUIDに対応するアイテムがデータベースに存在しない
- NFCタグUIDが未設定または不正

**対処方法**:
1. NFCタグUIDを確認: `GET /api/tools/items?search=<itemCode>` でアイテムを検索
2. アイテムにNFCタグUIDを設定: `PUT /api/tools/items/:id` で `nfcTagUid` を更新
3. アイテムを新規作成: `POST /api/tools/items` でアイテムを作成

#### 2. 廃棄済みアイテム（400）

**エラー**: `廃棄済みアイテムは持出できません`

**原因**:
- アイテムステータスが `RETIRED`

**対処方法**:
1. アイテムステータスを確認: `GET /api/tools/items/:id`
2. 必要に応じてステータスを `AVAILABLE` に変更: `PUT /api/tools/items/:id` で `status: "AVAILABLE"` を設定

#### 3. 従業員が見つからない（404）

**エラー**: `対象従業員が登録されていません`

**原因**:
- NFCタグUIDに対応する従業員がデータベースに存在しない
- NFCタグUIDが未設定または不正

**対処方法**:
1. NFCタグUIDを確認: `GET /api/tools/employees?search=<employeeCode>` で従業員を検索
2. 従業員にNFCタグUIDを設定: `PUT /api/tools/employees/:id` で `nfcTagUid` を更新
3. 従業員を新規作成: `POST /api/tools/employees` で従業員を作成

#### 4. 既に貸出中（400）

**エラー**: `このアイテムはすでに貸出中です`

**原因**:
- 同じアイテムに対して、未返却のLoanレコードが既に存在する

**対処方法**:
1. アクティブな貸出を確認: `GET /api/tools/loans/active`
2. 既存のLoanを返却: `POST /api/tools/return` で `loanId` を指定
3. 既存のLoanを取消: `POST /api/tools/loans/:id/cancel`（誤スキャンの場合）

### 返却処理（return）のエラーケース

#### 1. Loanが見つからない（404）

**エラー**: `貸出レコードが見つかりません`

**原因**:
- 指定された `loanId` が存在しない
- `loanId` が不正

**対処方法**:
1. `loanId` を確認: `GET /api/tools/loans/active` でアクティブな貸出を確認
2. トランザクション履歴を確認: `GET /api/tools/transactions?loanId=<loanId>` で履歴を確認

#### 2. 既に返却済み（400）

**エラー**: `すでに返却済みです`

**原因**:
- `Loan.returnedAt IS NOT NULL`

**対処方法**:
1. Loanの状態を確認: `GET /api/tools/loans/active` で確認（返却済みは表示されない）
2. トランザクション履歴を確認: `GET /api/tools/transactions?loanId=<loanId>` で返却履歴を確認

#### 3. 関連アイテムが見つからない（400）

**エラー**: `この貸出記録に関連するアイテムが見つかりません`

**原因**:
- `Loan.itemId` が設定されているが、対応する `Item` レコードが存在しない
- データベースの整合性が破壊されている

**対処方法**:
1. データ整合性チェックを実行（後述）
2. 必要に応じてLoanを削除または修正

#### 4. 関連従業員が見つからない（400）

**エラー**: `この貸出記録に関連する従業員が見つかりません`

**原因**:
- `Loan.employeeId` に対応する `Employee` レコードが存在しない
- データベースの整合性が破壊されている

**対処方法**:
1. データ整合性チェックを実行（後述）
2. 必要に応じてLoanを削除または修正

### トランザクション失敗時のロールバック

すべてのLoan操作（持出・返却・取消）は、`prisma.$transaction` 内で実行されます。トランザクション内でエラーが発生した場合、すべての変更がロールバックされます。

**例**: 持出処理で `Transaction` レコード作成に失敗した場合
- `Loan` レコードの作成はロールバックされる
- `Item.status` の更新はロールバックされる
- データベースの整合性は保たれる

**注意**: トランザクション外で実行される処理（写真ファイルの保存など）は、ロールバックされません。これらの処理は、トランザクション成功後に実行されるか、エラーハンドリングで適切に処理されます。

---

## データ整合性チェック

### 整合性チェックスクリプト

以下のSQLクエリを使用して、データ整合性をチェックできます：

#### 1. ItemステータスとLoanの整合性チェック

```sql
-- IN_USE状態のアイテムで、未返却Loanが存在しない場合
SELECT 
  i.id AS item_id,
  i.item_code,
  i.name,
  i.status,
  COUNT(l.id) AS active_loan_count
FROM "Item" i
LEFT JOIN "Loan" l ON l."itemId" = i.id 
  AND l."returnedAt" IS NULL 
  AND l."cancelledAt" IS NULL
WHERE i.status = 'IN_USE'
GROUP BY i.id, i.item_code, i.name, i.status
HAVING COUNT(l.id) = 0;

-- AVAILABLE状態のアイテムで、未返却Loanが存在する場合
SELECT 
  i.id AS item_id,
  i.item_code,
  i.name,
  i.status,
  COUNT(l.id) AS active_loan_count
FROM "Item" i
LEFT JOIN "Loan" l ON l."itemId" = i.id 
  AND l."returnedAt" IS NULL 
  AND l."cancelledAt" IS NULL
WHERE i.status = 'AVAILABLE'
GROUP BY i.id, i.item_code, i.name, i.status
HAVING COUNT(l.id) > 0;
```

#### 2. LoanとTransactionの整合性チェック

```sql
-- BORROW Transactionが存在しないLoan
SELECT 
  l.id AS loan_id,
  l."borrowedAt",
  l."returnedAt",
  l."cancelledAt"
FROM "Loan" l
LEFT JOIN "Transaction" t ON t."loanId" = l.id AND t.action = 'BORROW'
WHERE t.id IS NULL;

-- RETURN Transactionが存在しない返却済みLoan
SELECT 
  l.id AS loan_id,
  l."borrowedAt",
  l."returnedAt"
FROM "Loan" l
WHERE l."returnedAt" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "Transaction" t 
    WHERE t."loanId" = l.id AND t.action = 'RETURN'
  );

-- CANCEL Transactionが存在しない取消済みLoan
SELECT 
  l.id AS loan_id,
  l."borrowedAt",
  l."cancelledAt"
FROM "Loan" l
WHERE l."cancelledAt" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "Transaction" t 
    WHERE t."loanId" = l.id AND t.action = 'CANCEL'
  );
```

#### 3. 写真ファイルとLoanの整合性チェック

```bash
# データベースに存在するが、ファイルが存在しない写真
# （PostgreSQLからデータを取得して、ファイルシステムをチェック）

# 1. PostgreSQLからphotoUrlを取得
docker compose -f infrastructure/docker/docker-compose.server.yml exec -T db \
  psql -U postgres -d borrow_return -c \
  "SELECT id, \"photoUrl\" FROM \"Loan\" WHERE \"photoUrl\" IS NOT NULL;" \
  > /tmp/loans_with_photos.csv

# 2. ファイルの存在確認（手動で確認）
# photoUrlの形式: /api/storage/photos/YYYY/MM/YYYYMMDD_HHMMSS_{employeeId}.jpg
# 実際のファイルパス: /opt/RaspberryPiSystem_002/storage/photos/YYYY/MM/YYYYMMDD_HHMMSS_{employeeId}.jpg
```

### 整合性チェックの実行方法

```bash
# ラズパイ5で実行
cd /opt/RaspberryPiSystem_002

# 1. ItemステータスとLoanの整合性チェック
docker compose -f infrastructure/docker/docker-compose.server.yml exec -T db \
  psql -U postgres -d borrow_return -c "
SELECT 
  i.id AS item_id,
  i.item_code,
  i.name,
  i.status,
  COUNT(l.id) AS active_loan_count
FROM \"Item\" i
LEFT JOIN \"Loan\" l ON l.\"itemId\" = i.id 
  AND l.\"returnedAt\" IS NULL 
  AND l.\"cancelledAt\" IS NULL
WHERE i.status = 'IN_USE'
GROUP BY i.id, i.item_code, i.name, i.status
HAVING COUNT(l.id) = 0;
"

# 2. LoanとTransactionの整合性チェック
docker compose -f infrastructure/docker/docker-compose.server.yml exec -T db \
  psql -U postgres -d borrow_return -c "
SELECT 
  l.id AS loan_id,
  l.\"borrowedAt\",
  l.\"returnedAt\",
  l.\"cancelledAt\"
FROM \"Loan\" l
LEFT JOIN \"Transaction\" t ON t.\"loanId\" = l.id AND t.action = 'BORROW'
WHERE t.id IS NULL;
"
```

---

## 復旧手順

### 1. ItemステータスとLoanの不整合の修復

#### ケース1: IN_USE状態のアイテムで、未返却Loanが存在しない

**症状**: アイテムが `IN_USE` 状態だが、対応するLoanレコードが存在しない

**原因**:
- データベースの直接操作による不整合
- トランザクションの部分的な失敗（稀）

**修復手順**:

```bash
# 1. 不整合を確認
docker compose -f infrastructure/docker/docker-compose.server.yml exec -T db \
  psql -U postgres -d borrow_return -c "
SELECT 
  i.id AS item_id,
  i.item_code,
  i.name,
  i.status
FROM \"Item\" i
LEFT JOIN \"Loan\" l ON l.\"itemId\" = i.id 
  AND l.\"returnedAt\" IS NULL 
  AND l.\"cancelledAt\" IS NULL
WHERE i.status = 'IN_USE'
GROUP BY i.id, i.item_code, i.name, i.status
HAVING COUNT(l.id) = 0;
"

# 2. アイテムステータスをAVAILABLEに戻す
# （item_idを実際のIDに置き換える）
docker compose -f infrastructure/docker/docker-compose.server.yml exec -T db \
  psql -U postgres -d borrow_return -c "
UPDATE \"Item\" 
SET status = 'AVAILABLE' 
WHERE id = '<item_id>';
"
```

#### ケース2: AVAILABLE状態のアイテムで、未返却Loanが存在する

**症状**: アイテムが `AVAILABLE` 状態だが、対応する未返却Loanレコードが存在する

**原因**:
- データベースの直接操作による不整合
- 返却処理の部分的な失敗（稀）

**修復手順**:

```bash
# 1. 不整合を確認
docker compose -f infrastructure/docker/docker-compose.server.yml exec -T db \
  psql -U postgres -d borrow_return -c "
SELECT 
  i.id AS item_id,
  i.item_code,
  i.name,
  i.status,
  l.id AS loan_id,
  l.\"borrowedAt\"
FROM \"Item\" i
JOIN \"Loan\" l ON l.\"itemId\" = i.id 
  AND l.\"returnedAt\" IS NULL 
  AND l.\"cancelledAt\" IS NULL
WHERE i.status = 'AVAILABLE';
"

# 2. Loanを返却済みにする（返却日時を設定）
# （loan_idを実際のIDに置き換える）
docker compose -f infrastructure/docker/docker-compose.server.yml exec -T db \
  psql -U postgres -d borrow_return -c "
UPDATE \"Loan\" 
SET \"returnedAt\" = NOW() 
WHERE id = '<loan_id>';
"

# 3. RETURN Transactionを作成（必要に応じて）
docker compose -f infrastructure/docker/docker-compose.server.yml exec -T db \
  psql -U postgres -d borrow_return -c "
INSERT INTO \"Transaction\" (\"loanId\", action, \"actorEmployeeId\", \"createdAt\", details)
SELECT 
  l.id,
  'RETURN',
  l.\"employeeId\",
  NOW(),
  '{}'::jsonb
FROM \"Loan\" l
WHERE l.id = '<loan_id>'
  AND NOT EXISTS (
    SELECT 1 FROM \"Transaction\" t 
    WHERE t.\"loanId\" = l.id AND t.action = 'RETURN'
  );
"
```

### 2. 写真ファイルが削除された場合の復旧

#### ケース1: storage/photos/ ディレクトリが削除された

**症状**: 管理画面で写真が表示されない、404エラーが発生する

**原因**:
- `git clean` などの操作で `storage/` ディレクトリが削除された
- ファイルシステムのエラー

**復旧手順**:

```bash
# 1. storage/ディレクトリを再作成
cd /opt/RaspberryPiSystem_002
mkdir -p storage/photos storage/thumbnails

# 2. 権限を設定（必要に応じて）
chmod 755 storage/photos storage/thumbnails

# 3. バックアップから復旧（バックアップが存在する場合）
# バックアップファイルのパスを確認
ls -lh /opt/backups/photos_backup_*.tar.gz

# バックアップから復旧
tar -xzf /opt/backups/photos_backup_YYYYMMDD_HHMMSS.tar.gz -C storage/

# 4. データベースとファイルシステムの整合性を確認
# （photoUrlが設定されているが、ファイルが存在しないLoanを確認）
docker compose -f infrastructure/docker/docker-compose.server.yml exec -T db \
  psql -U postgres -d borrow_return -c "
SELECT 
  l.id AS loan_id,
  l.\"photoUrl\",
  l.\"borrowedAt\"
FROM \"Loan\" l
WHERE l.\"photoUrl\" IS NOT NULL;
" | while read loan_id photo_url borrowed_at; do
  # photo_urlからファイルパスを抽出
  # /api/storage/photos/YYYY/MM/filename.jpg -> /opt/RaspberryPiSystem_002/storage/photos/YYYY/MM/filename.jpg
  file_path=$(echo "$photo_url" | sed 's|/api/storage/photos/|/opt/RaspberryPiSystem_002/storage/photos/|')
  if [ ! -f "$file_path" ]; then
    echo "Missing photo file: $file_path (Loan ID: $loan_id)"
  fi
done
```

#### ケース2: 特定の写真ファイルが削除された

**症状**: 特定のLoanの写真が表示されない

**復旧手順**:

```bash
# 1. 削除されたファイルを特定
# （photoUrlが設定されているが、ファイルが存在しないLoanを確認）

# 2. バックアップから該当ファイルを復旧（バックアップが存在する場合）
# photo_urlからファイルパスを抽出して復旧

# 3. ファイルが復旧できない場合、LoanのphotoUrlをNULLに更新
docker compose -f infrastructure/docker/docker-compose.server.yml exec -T db \
  psql -U postgres -d borrow_return -c "
UPDATE \"Loan\" 
SET \"photoUrl\" = NULL 
WHERE id = '<loan_id>';
"
```

### 3. バックアップからの完全復旧

#### データベースの復旧

```bash
# 1. 最新のバックアップを確認
ls -lh /opt/backups/db_backup_*.sql.gz | tail -1

# 2. データベースを復旧
# （注意: 既存のデータが上書きされます）
cd /opt/RaspberryPiSystem_002
./scripts/server/restore.sh /opt/backups/db_backup_YYYYMMDD_HHMMSS.sql.gz
```

#### 写真ファイルの復旧

```bash
# 1. 最新の写真バックアップを確認
ls -lh /opt/backups/photos_backup_*.tar.gz | tail -1

# 2. storage/ディレクトリを再作成
mkdir -p storage/photos storage/thumbnails

# 3. バックアップから復旧
tar -xzf /opt/backups/photos_backup_YYYYMMDD_HHMMSS.tar.gz -C storage/

# 4. 権限を設定
chmod -R 755 storage/photos storage/thumbnails
```

### 4. 部分的なデータ損失の復旧

#### ケース1: 一部のアイテムデータが削除された

**復旧手順**:

```bash
# 1. バックアップから該当アイテムを復旧
# （PostgreSQLのpg_dumpから特定のテーブルを復旧）

# 2. または、CSVインポート機能を使用して再登録
# （管理画面からCSVファイルをアップロード）
```

#### ケース2: 一部のLoanデータが削除された

**注意**: Loanデータは履歴データのため、完全な復旧は困難です。

**復旧手順**:

```bash
# 1. バックアップから該当Loanを復旧（可能な場合）
# 2. 復旧できない場合、Transaction履歴からLoanを再構築（手動）
```

---

## トラブルシューティング

### よくある問題と対処方法

#### 1. アイテムが持出できない

**症状**: `POST /api/tools/borrow` でエラーが発生する

**確認項目**:
1. アイテムが存在するか: `GET /api/tools/items?search=<itemCode>`
2. アイテムステータスが `AVAILABLE` か: `GET /api/tools/items/:id`
3. 既存の未返却Loanが存在しないか: `GET /api/tools/loans/active`
4. NFCタグUIDが正しく設定されているか: `GET /api/tools/items/:id`

**対処方法**:
- アイテムステータスが `RETIRED` の場合: `PUT /api/tools/items/:id` で `status: "AVAILABLE"` に変更
- 既存の未返却Loanが存在する場合: `POST /api/tools/return` で返却、または `POST /api/tools/loans/:id/cancel` で取消

#### 2. 返却できない

**症状**: `POST /api/tools/return` でエラーが発生する

**確認項目**:
1. Loanが存在するか: `GET /api/tools/loans/active`
2. Loanが既に返却済みでないか: `GET /api/tools/transactions?loanId=<loanId>`

**対処方法**:
- Loanが存在しない場合: データ整合性チェックを実行
- 既に返却済みの場合: トランザクション履歴を確認

#### 3. 写真が表示されない

**症状**: 管理画面で写真が表示されない、404エラーが発生する

**確認項目**:
1. 写真ファイルが存在するか: `ls -lh /opt/RaspberryPiSystem_002/storage/photos/YYYY/MM/`
2. LoanのphotoUrlが設定されているか: `GET /api/tools/loans/:id`
3. ファイルパスが正しいか: `photoUrl` と実際のファイルパスを比較

**対処方法**:
- ファイルが存在しない場合: バックアップから復旧、または `photoUrl` を `NULL` に更新
- ファイルパスが不正な場合: `PUT /api/tools/loans/:id` で `photoUrl` を修正（手動）

#### 4. データ整合性エラー

**症状**: データ整合性チェックで不整合が検出された

**対処方法**:
1. 不整合の詳細を確認（上記の整合性チェックスクリプトを実行）
2. 復旧手順に従って修復
3. 修復後、再度整合性チェックを実行して確認

---

## 定期メンテナンス

### 推奨される定期作業

#### 1. データ整合性チェック（週次）

```bash
# 毎週実行する整合性チェック
cd /opt/RaspberryPiSystem_002
./scripts/tools/check-consistency.sh
```

#### 2. バックアップ確認（日次）

```bash
# バックアップが正常に作成されているか確認
ls -lh /opt/backups/db_backup_*.sql.gz | tail -1
ls -lh /opt/backups/photos_backup_*.tar.gz | tail -1
```

#### 3. 古い写真ファイルの削除（年次）

```bash
# 2年前の写真ファイルを削除（1月中に実行）
# （自動削除機能が実装されている場合は不要）
```

---

## 関連ドキュメント

- [工具管理モジュール概要](./README.md) - モジュールの概要とAPIエンドポイント
- [API仕様書](./api.md) - 詳細なAPIエンドポイント仕様
- [サービス層設計](./services.md) - サービス層の設計詳細
- [バックアップ・リストア手順](../../guides/backup-and-restore.md) - システム全体のバックアップ・リストア手順
- [写真撮影持出機能](./photo-loan.md) - 写真撮影持出機能の詳細

