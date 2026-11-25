# CSVインポート機能のP2003エラーに関する相談

## 問題の概要

Fastify + Prisma + PostgreSQLを使用したCSVインポート機能で、`replaceExisting: false`（既存データを置き換えない）設定でもP2003エラー（外部キー制約違反）が発生しています。

## 現在の状況

### エラーの詳細
- **エラーコード**: P2003（外部キー制約違反）
- **エラーメッセージ**: `{"message": "データベースエラー: P2003"}`
- **エラーメタ**: `{"modelName":"Employee","field_name":"Loan_employeeId_fkey (index)"}`
- **発生条件**: `replaceExisting: false`でも発生（想定外）

### 期待される動作
- `replaceExisting: false`の場合: 既存データを削除せず、CSVのデータで更新または新規作成のみ
- `replaceExisting: true`の場合: 既存データを削除してからCSVのデータをインポート（ただし、Loanレコードが存在する従業員/アイテムは削除しない）

### 実際の動作
- `replaceExisting: false`でもP2003エラーが発生
- エラーメッセージが詳細にならない
- ログに「インポート処理エラー」が表示されず、エラーハンドラーで直接処理されている

## 技術スタック
- **フレームワーク**: Fastify
- **ORM**: Prisma
- **データベース**: PostgreSQL
- **言語**: TypeScript

## 関連するコード

### 主要なファイル
- `apps/api/src/routes/imports.ts` - インポート処理のメインロジック
- `apps/api/src/plugins/error-handler.ts` - エラーハンドラー

### 問題のコード箇所

#### 1. `importEmployees`関数（`apps/api/src/routes/imports.ts` 96-171行目）
```typescript
async function importEmployees(
  tx: Prisma.TransactionClient,
  rows: EmployeeCsvRow[],
  replaceExisting: boolean,
  logger?: { info: (obj: unknown, msg: string) => void; error: (obj: unknown, msg: string) => void }
): Promise<ImportResult> {
  // ... 省略 ...
  
  if (replaceExisting) {
    // Loanレコードが存在する従業員は削除できないため、Loanレコードが存在しない従業員のみを削除
    try {
      const loans = await tx.loan.findMany({
        select: { employeeId: true },
        where: { employeeId: { not: null } }
      });
      const employeeIdsWithLoans = new Set(loans.map(l => l.employeeId).filter((id): id is string => id !== null));
      
      if (employeeIdsWithLoans.size > 0) {
        await tx.employee.deleteMany({
          where: {
            id: {
              notIn: Array.from(employeeIdsWithLoans)
            }
          }
        });
      } else {
        await tx.employee.deleteMany();
      }
    } catch (error) {
      logger?.error({ err: error }, '[importEmployees] Error in deleteMany');
      throw error;
    }
  } else {
    logger?.info({}, '[importEmployees] Skipping deleteMany (replaceExisting=false)');
  }
  
  // CSVの各行を処理（更新または作成）
  for (const row of rows) {
    const existing = await tx.employee.findUnique({ where: { employeeCode: row.employeeCode } });
    if (existing) {
      await tx.employee.update({
        where: { employeeCode: row.employeeCode },
        data: payload
      });
    } else {
      await tx.employee.create({
        data: {
          employeeCode: row.employeeCode,
          ...payload
        }
      });
    }
  }
}
```

#### 2. トランザクション処理（`apps/api/src/routes/imports.ts` 350-380行目）
```typescript
try {
  await prisma.$transaction(async (tx) => {
    if (employeeRows.length > 0) {
      summary.employees = await importEmployees(tx, employeeRows, replaceExisting, request.log);
    }
    if (itemRows.length > 0) {
      summary.items = await importItems(tx, itemRows, replaceExisting);
    }
  }, {
    timeout: 30000,
    isolationLevel: 'ReadCommitted'
  });
} catch (error) {
  request.log.error({ 
    err: error,
    errorName: error instanceof Error ? error.name : typeof error,
    errorMessage: error instanceof Error ? error.message : String(error),
    errorCode: (error as any)?.code,
    errorMeta: (error as any)?.meta
  }, 'インポート処理エラー');
  
  if (error instanceof PrismaClientKnownRequestError) {
    if (error.code === 'P2003') {
      // 詳細メッセージを返す
      throw new ApiError(400, `外部キー制約違反: ...`);
    }
  }
  // ...
}
```

#### 3. エラーハンドラー（`apps/api/src/plugins/error-handler.ts` 54-96行目）
```typescript
if (error instanceof PrismaClientKnownRequestError) {
  request.log.error({
    prismaCode: error.code,
    meta: error.meta,
    // ...
  }, 'Database error');
  
  if (error.code === 'P2003') {
    const fieldName = (error.meta as any)?.field_name || '不明なフィールド';
    const modelName = (error.meta as any)?.model_name || '不明なモデル';
    reply.status(400).send({ 
      message: `外部キー制約違反: ${modelName}の${fieldName}に関連するレコードが存在するため、削除できません。`,
      code: error.code,
      details: error.meta
    });
    return;
  }
  // ...
}
```

## 試したこと

1. **エラーハンドリングの改善**
   - トランザクション内のcatchブロックでPrismaエラーをApiErrorとしてラップ
   - エラーハンドラーでP2003エラーの詳細メッセージを返すように修正

2. **デバッグログの追加**
   - `replaceExisting`の値をログに出力
   - トランザクション開始前、トランザクション内、各処理の前後にログを追加

3. **`replaceExisting`の値の確認**
   - フォームから取得した値をログに出力
   - `Boolean()`で明示的に変換

4. **削除処理の改善**
   - Loanレコードが存在する従業員は削除しないように修正
   - `notIn`を使用して削除対象をフィルタリング

## 観察された問題点

1. **ログが表示されない**
   - 追加したデバッグログ（`[importEmployees] Starting import`など）がログに表示されない
   - 「インポート処理エラー」のログも表示されない
   - エラーハンドラーで直接「Database error」として処理されている

2. **エラーメッセージが詳細にならない**
   - エラーハンドラーで詳細メッセージを返すようにしているが、「データベースエラー: P2003」のまま

3. **`replaceExisting: false`でもエラーが発生**
   - 削除処理が実行されないはずなのに、外部キー制約違反が発生

## データベーススキーマ

```prisma
model Employee {
  id           String         @id @default(uuid())
  employeeCode String         @unique
  // ... その他のフィールド
  loans        Loan[]
}

model Loan {
  id           String        @id @default(uuid())
  itemId       String
  employeeId   String
  // ... その他のフィールド
  employee     Employee      @relation(fields: [employeeId], references: [id])
}

// 外部キー制約: ON DELETE RESTRICT
```

## 質問

1. **なぜ`replaceExisting: false`でもP2003エラーが発生するのか？**
   - 削除処理が実行されていないはずなのに、外部キー制約違反が発生する原因は？

2. **なぜログが表示されないのか？**
   - 追加したデバッグログが表示されない原因は？
   - エラーがトランザクション内でキャッチされていない可能性は？

3. **エラーメッセージが詳細にならない原因は？**
   - エラーハンドラーで詳細メッセージを返すようにしているが、反映されない

4. **根本的な解決策は？**
   - この問題を解決するためのアプローチを教えてください

## 追加情報

- GitHubリポジトリ: `denkoushi/RaspberryPiSystem_002`
- ブランチ: `main`
- 最新のコミット: `7f117d1` - "fix: replaceExistingの値を確実に取得して渡すように修正"

## お願い

この問題の根本原因を特定し、解決策を提案してください。特に、`replaceExisting: false`でもP2003エラーが発生する理由と、ログが表示されない理由を教えてください。

