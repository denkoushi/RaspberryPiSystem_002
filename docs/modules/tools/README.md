# 工具管理モジュール

## 概要

工具管理モジュールは、工場内の工具・備品の持出・返却を管理する機能を提供します。NFCタグを使用した持出管理、従業員・アイテムのマスタ管理、トランザクション履歴の管理を行います。

## 責務

- **従業員管理**: 従業員のCRUD操作、NFCタグUIDの紐付け
- **アイテム管理**: 工具・備品のCRUD操作、NFCタグUIDの紐付け
- **貸出・返却処理**: NFCタグを使用した持出・返却の登録
- **トランザクション履歴**: 貸出・返却の履歴管理、CSVエクスポート

## APIエンドポイント

### 従業員管理

- `GET /api/tools/employees` - 従業員一覧取得（検索・フィルタ対応）
- `GET /api/tools/employees/:id` - 従業員詳細取得
- `POST /api/tools/employees` - 従業員作成
- `PUT /api/tools/employees/:id` - 従業員更新
- `DELETE /api/tools/employees/:id` - 従業員削除

**後方互換性**: 既存パス `/api/employees` も利用可能

### アイテム管理

- `GET /api/tools/items` - アイテム一覧取得（検索・フィルタ対応）
- `GET /api/tools/items/:id` - アイテム詳細取得
- `POST /api/tools/items` - アイテム作成
- `PUT /api/tools/items/:id` - アイテム更新
- `DELETE /api/tools/items/:id` - アイテム削除

**後方互換性**: 既存パス `/api/items` も利用可能

### 貸出・返却

- `POST /api/tools/borrow` - 持出登録（アイテムタグUID + 従業員タグUID）
- `POST /api/tools/return` - 返却登録（loanId）
- `GET /api/tools/loans/active` - アクティブな貸出一覧取得

**後方互換性**: 既存パス `/api/borrow`, `/api/return` も利用可能

### トランザクション履歴

- `GET /api/tools/transactions` - トランザクション履歴取得（ページネーション・フィルタ対応）

**後方互換性**: 既存パス `/api/transactions` も利用可能

詳細なAPI仕様は [API仕様書](./api.md) を参照してください。

## データモデル

### 主要エンティティ

- **Employee**: 従業員情報（employeeCode, displayName, nfcTagUid, department, status）
- **Item**: アイテム情報（itemCode, name, nfcTagUid, category, status）
- **Loan**: 貸出情報（itemId, employeeId, borrowedAt, returnedAt, clientId）
- **Transaction**: トランザクション履歴（loanId, action, actorEmployeeId, details）

詳細は [データベース設計](../../architecture/database.md#tools-module) を参照してください。

## サービス層

### EmployeeService

従業員管理のビジネスロジックを提供します。

- `findAll(query: EmployeeQuery)` - 従業員一覧取得
- `findById(id: string)` - IDで従業員取得
- `findByNfcTagUid(nfcTagUid: string)` - NFCタグUIDで従業員取得
- `create(data: EmployeeCreateInput)` - 従業員作成
- `update(id: string, data: EmployeeUpdateInput)` - 従業員更新
- `delete(id: string)` - 従業員削除

### ItemService

アイテム管理のビジネスロジックを提供します。

- `findAll(query: ItemQuery)` - アイテム一覧取得
- `findById(id: string)` - IDでアイテム取得
- `findByNfcTagUid(nfcTagUid: string)` - NFCタグUIDでアイテム取得
- `create(data: ItemCreateInput)` - アイテム作成
- `update(id: string, data: ItemUpdateInput)` - アイテム更新
- `delete(id: string)` - アイテム削除

### LoanService

貸出・返却処理のビジネスロジックを提供します。

- `borrow(input: BorrowInput, clientId?: string)` - 持出処理
- `return(input: ReturnInput, clientId?: string, performedByUserId?: string)` - 返却処理
- `findActive(query: ActiveLoanQuery)` - アクティブな貸出一覧取得
- `resolveClientId(clientId?: string, apiKeyHeader?: string)` - クライアントID解決

### TransactionService

トランザクション履歴のビジネスロジックを提供します。

- `findAll(query: TransactionQuery)` - トランザクション履歴取得（ページネーション対応）

詳細は [サービス層設計](./services.md) を参照してください。

## ディレクトリ構造

```
apps/api/src/
├── routes/tools/
│   ├── employees/
│   │   ├── index.ts      # ルート登録
│   │   ├── list.ts       # GET /employees
│   │   ├── get.ts        # GET /employees/:id
│   │   ├── create.ts     # POST /employees
│   │   ├── update.ts     # PUT /employees/:id
│   │   ├── delete.ts     # DELETE /employees/:id
│   │   └── schemas.ts    # バリデーションスキーマ
│   ├── items/
│   │   ├── index.ts      # ルート登録
│   │   ├── list.ts       # GET /items
│   │   ├── get.ts        # GET /items/:id
│   │   ├── create.ts     # POST /items
│   │   ├── update.ts     # PUT /items/:id
│   │   ├── delete.ts     # DELETE /items/:id
│   │   └── schemas.ts    # バリデーションスキーマ
│   ├── loans/
│   │   ├── index.ts      # ルート登録
│   │   ├── borrow.ts     # POST /borrow
│   │   ├── return.ts     # POST /return
│   │   ├── active.ts     # GET /loans/active
│   │   └── schemas.ts    # バリデーションスキーマ
│   ├── transactions/
│   │   ├── index.ts      # ルート登録
│   │   ├── list.ts       # GET /transactions
│   │   └── schemas.ts    # バリデーションスキーマ
│   └── index.ts          # モジュールルート登録
└── services/tools/
    ├── employee.service.ts
    ├── item.service.ts
    ├── loan.service.ts
    ├── transaction.service.ts
    └── index.ts
```

### 設計方針

- **機能ごとのサブディレクトリ**: 各リソース（employees, items, loans, transactions）を独立したディレクトリに分割
- **バリデーションスキーマの分離**: 各サブディレクトリに`schemas.ts`を配置し、バリデーションロジックを集約
- **ファイルサイズの抑制**: 1ファイルあたり50-100行程度に収まり、可読性を向上

## 使用例

### 持出処理のフロー

1. キオスクでアイテムタグをスキャン
2. 従業員タグをスキャン
3. `POST /api/tools/borrow` を呼び出し
4. サービス層で以下を実行：
   - アイテム・従業員の存在確認
   - 既存貸出の確認
   - Loanレコード作成
   - Itemステータス更新（IN_USE）
   - Transactionレコード作成（BORROW）

### 返却処理のフロー

1. キオスクで返却ボタンをクリック
2. `POST /api/tools/return` を呼び出し（loanIdを指定）
3. サービス層で以下を実行：
   - Loanレコードの存在確認
   - returnedAtを更新
   - Itemステータス更新（AVAILABLE）
   - Transactionレコード作成（RETURN）

## テスト

```bash
# APIテスト
cd apps/api
pnpm test

# 特定のモジュールのテスト
pnpm test routes/tools
```

## データ構造とダッシュボード集計

### データの紐づけ

持出・返却・取消のデータは、**Loanテーブルの`id`（UUID）**で紐づけられています。ダッシュボードでの集計時に、このIDを使用して正確な集計が可能です。

#### Loanテーブル（貸出記録）

- `id`（UUID）: 主キー。持出・返却・取消を紐づける唯一のID
- `borrowedAt`: 持出日時
- `returnedAt`: 返却日時（返却済みの場合）
- `cancelledAt`: 取消日時（取消済みの場合）

#### Transactionテーブル（操作履歴）

- `loanId`: Loanテーブルへの外部キー（持出・返却・取消を紐づける）
- `action`: `'BORROW' | 'RETURN' | 'CANCEL'`

### ダッシュボードでの集計例

取消済みLoanを除外して集計する場合：

```sql
-- 持出と返却を紐づけて集計
SELECT 
  l.id AS loan_id,
  COUNT(CASE WHEN t.action = 'BORROW' THEN 1 END) AS borrow_count,
  COUNT(CASE WHEN t.action = 'RETURN' THEN 1 END) AS return_count,
  COUNT(CASE WHEN t.action = 'CANCEL' THEN 1 END) AS cancel_count
FROM "Loan" l
LEFT JOIN "Transaction" t ON t."loanId" = l.id
WHERE l."cancelledAt" IS NULL  -- 取消済みを除外（ダッシュボード用）
GROUP BY l.id;
```

詳細な集計例は、PowerBIなどのダッシュボードツールで`loanId`を使用してLoanテーブルとTransactionテーブルを結合することで実現できます。

## 運用・保守

工具管理システムの運用・保守に関する詳細な手順は、[運用・保守ガイド](./operations.md)を参照してください。

- **データ整合性の保証方法**: LoanとItemステータスの整合性、LoanとTransactionの整合性、写真ファイルとLoanの整合性
- **状態遷移の詳細**: Itemステータスの遷移ルール、Loanの状態定義
- **エラーハンドリングの詳細**: 各エラーケースの原因と対処方法
- **データ整合性チェック**: 整合性チェックスクリプトと実行方法
- **復旧手順**: 各種不整合の修復手順、バックアップからの復旧手順

## 関連ドキュメント

- [API仕様書](./api.md) - 詳細なAPIエンドポイント仕様
- [サービス層設計](./services.md) - サービス層の設計詳細
- [運用・保守ガイド](./operations.md) - 運用・保守の詳細手順
- [写真撮影持出機能](./photo-loan.md) - 写真撮影持出機能のモジュール仕様
- [EXEC_PLAN.md](../../EXEC_PLAN.md) - 全体の進捗とマイルストーン
- [キオスク工具スキャン重複＆黒画像対策 ExecPlan](../../plans/tool-management-debug-execplan.md) - 既知の問題の詳細調査・対策計画
- [アーキテクチャ概要](../../architecture/overview.md) - システム全体のアーキテクチャ

