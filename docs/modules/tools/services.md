# 工具管理モジュール サービス層設計

## 概要

サービス層は、ルートハンドラーからビジネスロジックを分離し、再利用可能な形で提供します。Prismaクエリとビジネスロジックをカプセル化し、テスト容易性と保守性を向上させます。

## 設計原則

1. **単一責任の原則**: 各サービスは特定のドメインエンティティに責任を持つ
2. **依存性の注入**: サービス間の依存はコンストラクタで注入
3. **エラーハンドリング**: ビジネスロジックエラーは`ApiError`として投げる
4. **トランザクション管理**: 複数のDB操作は`prisma.$transaction`で管理

## EmployeeService

### 責務

従業員エンティティのCRUD操作とビジネスロジックを提供します。

### 主要メソッド

```typescript
class EmployeeService {
  // 一覧取得（検索・フィルタ対応）
  async findAll(query: EmployeeQuery): Promise<Employee[]>
  
  // IDで取得（存在しない場合は404エラー）
  async findById(id: string): Promise<Employee>
  
  // NFCタグUIDで取得（存在しない場合はnull）
  async findByNfcTagUid(nfcTagUid: string): Promise<Employee | null>
  
  // 作成
  async create(data: EmployeeCreateInput): Promise<Employee>
  
  // 更新
  async update(id: string, data: EmployeeUpdateInput): Promise<Employee>
  
  // 削除
  async delete(id: string): Promise<Employee>
}
```

### 使用例

```typescript
const employeeService = new EmployeeService();

// 従業員一覧取得（検索）
const employees = await employeeService.findAll({ 
  search: "Yamada",
  status: "ACTIVE" 
});

// NFCタグUIDで従業員取得
const employee = await employeeService.findByNfcTagUid("04DE8366BC2A81");
```

## ItemService

### 責務

アイテムエンティティのCRUD操作とビジネスロジックを提供します。

### 主要メソッド

```typescript
class ItemService {
  async findAll(query: ItemQuery): Promise<Item[]>
  async findById(id: string): Promise<Item>
  async findByNfcTagUid(nfcTagUid: string): Promise<Item | null>
  async create(data: ItemCreateInput): Promise<Item>
  async update(id: string, data: ItemUpdateInput): Promise<Item>
  async delete(id: string): Promise<Item>
}
```

## LoanService

### 責務

貸出・返却処理のビジネスロジックを提供します。複雑なトランザクション処理を含みます。

### 主要メソッド

```typescript
class LoanService {
  // クライアントID解決（clientIdまたはx-client-keyヘッダーから）
  async resolveClientId(
    clientId: string | undefined,
    apiKeyHeader: string | string[] | undefined
  ): Promise<string | undefined>
  
  // 持出処理（トランザクション内で実行）
  async borrow(
    input: BorrowInput,
    resolvedClientId?: string
  ): Promise<LoanWithRelations>
  
  // 返却処理（トランザクション内で実行）
  async return(
    input: ReturnInput,
    resolvedClientId?: string,
    performedByUserId?: string
  ): Promise<LoanWithRelations>
  
  // アクティブな貸出一覧取得
  async findActive(query: ActiveLoanQuery): Promise<LoanWithRelations[]>
}
```

### 持出処理のフロー

1. アイテムの存在確認（NFCタグUIDから）
2. アイテムステータス確認（RETIREDの場合はエラー）
3. 従業員の存在確認（NFCタグUIDから）
4. 既存貸出の確認（同じアイテムが未返却の場合はエラー）
5. トランザクション開始：
   - Loanレコード作成
   - Itemステータス更新（IN_USE）
   - Transactionレコード作成（BORROW、スナップショット含む）

### 返却処理のフロー

1. Loanレコードの存在確認
2. 返却済みチェック（既に返却済みの場合はエラー）
3. トランザクション開始：
   - Loanレコード更新（returnedAt設定）
   - Itemステータス更新（AVAILABLE）
   - Transactionレコード作成（RETURN、スナップショット含む）

## TransactionService

### 責務

トランザクション履歴の取得とフィルタリングを提供します。

### 主要メソッド

```typescript
class TransactionService {
  // トランザクション履歴取得（ページネーション・フィルタ対応）
  async findAll(query: TransactionQuery): Promise<TransactionListResult>
}
```

### フィルタリング

以下の条件でフィルタリング可能：

- `employeeId`: アクター従業員ID
- `itemId`: アイテムID（Loan経由）
- `clientId`: クライアントID
- `startDate` / `endDate`: 日時範囲

## テスト

サービス層は単体テストが容易です：

```typescript
import { EmployeeService } from './employee.service';

describe('EmployeeService', () => {
  it('should find employees by search query', async () => {
    const service = new EmployeeService();
    const result = await service.findAll({ search: 'Yamada' });
    expect(result).toHaveLength(1);
  });
});
```

## 依存関係

- `LoanService` → `ItemService`, `EmployeeService`
- すべてのサービス → `prisma` (PrismaClient)
- すべてのサービス → `ApiError` (エラーハンドリング)

## 将来の拡張

新規モジュール（documents, logistics）を追加する際は、同様のサービス層パターンを適用します：

```
services/
├── tools/
│   └── ...
├── documents/
│   └── document.service.ts
└── logistics/
    └── logistics.service.ts
```

