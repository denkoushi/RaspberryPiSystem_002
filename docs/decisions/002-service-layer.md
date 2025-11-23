# ADR 002: サービス層の導入

## 状況

ルートハンドラーにPrismaクエリとビジネスロジックが直接記述されており、以下の問題があった：

1. ビジネスロジックの重複
2. テストの困難さ
3. 再利用性の欠如
4. 責務の混在

## 決定

サービス層を導入し、ルートハンドラーからビジネスロジックを分離する。

## 構造

```
routes/tools/employees.ts
  ↓ (呼び出し)
services/tools/employee.service.ts
  ↓ (呼び出し)
lib/prisma.ts (PrismaClient)
```

## 理由

1. **責務の分離**: ルートハンドラーはHTTP層、サービス層はビジネスロジック層に責任を持つ
2. **テスト容易性**: サービス層を単体テスト可能になり、モック化が容易
3. **再利用性**: サービス層を他のルートやバッチ処理から再利用可能
4. **保守性**: ビジネスロジックの変更がルートハンドラーに影響しない

## 影響

- **既存コード**: 全ルートハンドラーをサービス層を使用する構造に変更済み
- **新規コード**: すべての新規モジュールでサービス層パターンを適用
- **パフォーマンス**: 影響なし（同じPrismaクエリを実行）

## 実装例

### Before

```typescript
// routes/employees.ts
app.get('/employees', async (request) => {
  const where: Prisma.EmployeeWhereInput = { ... };
  const employees = await prisma.employee.findMany({ where });
  return { employees };
});
```

### After

```typescript
// routes/tools/employees.ts
app.get('/employees', async (request) => {
  const employees = await employeeService.findAll(query);
  return { employees };
});

// services/tools/employee.service.ts
class EmployeeService {
  async findAll(query: EmployeeQuery): Promise<Employee[]> {
    const where: Prisma.EmployeeWhereInput = { ... };
    return await prisma.employee.findMany({ where });
  }
}
```

## 日付

2025-01-XX

