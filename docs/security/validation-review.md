# セキュリティ検証レビュー

最終更新: 2025-01-XX

## 入力バリデーション

### 現状

- **zodによる入力バリデーション**: すべてのAPIエンドポイントで実装済み
- **バリデーションスキーマ**: 各ルートの`schemas.ts`で定義
- **エラーハンドリング**: `ZodError`を適切に処理し、詳細なエラーメッセージを返却

### 確認結果

✅ **良好**: 121箇所でzodが使用されており、すべてのAPIエンドポイントで入力バリデーションが実装されています。

#### 実装例

```typescript
// apps/api/src/routes/tools/employees/schemas.ts
export const employeeBodySchema = z.object({
  employeeCode: z.string().min(1),
  displayName: z.string().min(1),
  nfcTagUid: z.string().min(4).optional().or(z.literal('').transform(() => undefined)).nullable(),
  department: z.string().optional().nullable(),
  contact: z.string().optional().nullable(),
  status: z.nativeEnum(EmployeeStatus).optional()
});
```

### 推奨事項

- 現状の実装で十分です
- 将来的に、より厳密なバリデーション（例：メールアドレス形式、電話番号形式）が必要になった場合は、zodのバリデーションメソッドを追加してください

---

## XSS対策

### 現状

- **Reactのデフォルトエスケープ**: ReactはデフォルトでXSS対策が実装されています
- **dangerouslySetInnerHTMLの使用**: 検索結果では使用されていません
- **CSVエクスポート**: ダブルクォートのエスケープ処理が実装されています

### 確認結果

✅ **良好**: 
- `dangerouslySetInnerHTML`や`innerHTML`の使用は見つかりませんでした
- Reactのデフォルトのエスケープ機能により、XSS攻撃は防止されています
- CSVエクスポート時のエスケープ処理も適切に実装されています

#### 実装例

```typescript
// apps/web/src/pages/tools/HistoryPage.tsx
const csv = [header, ...rows]
  .map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
  .join('\n');
```

### 推奨事項

- 現状の実装で十分です
- 将来的にHTMLコンテンツを表示する必要がある場合は、`DOMPurify`などのサニタイズライブラリの使用を検討してください

---

## SQLインジェクション対策

### 現状

- **Prismaの使用**: Prismaはパラメータ化クエリを使用するため、SQLインジェクション対策が自動的に実装されています

### 確認結果

✅ **良好**: Prismaを使用しているため、SQLインジェクション攻撃は防止されています。

---

## 認証・認可

### 現状

- **JWT認証**: アクセストークンとリフレッシュトークンの分離
- **ロールベースアクセス制御（RBAC）**: `authorizeRoles`関数で実装
- **APIレート制限**: 認証エンドポイント（5リクエスト/分）、一般API（100リクエスト/分）

### 確認結果

✅ **良好**: 認証・認可の実装は適切です。

---

## HTTPSの強制

### 現状

- **開発環境**: HTTPで動作
- **本番環境**: HTTPSの強制は未実装（CaddyによるTLS終端は可能）

### 推奨事項

- 本番環境では、Caddyの設定でHTTPSを強制してください
- 環境変数でHTTPSの強制を制御できるようにすることを推奨します

---

## まとめ

### 完了したセキュリティ対策

- ✅ 入力バリデーション（zod）
- ✅ XSS対策（Reactのデフォルトエスケープ）
- ✅ SQLインジェクション対策（Prisma）
- ✅ 認証・認可（JWT、RBAC）
- ✅ APIレート制限

### 今後の推奨事項

1. **本番環境でのHTTPS強制**: Caddyの設定でHTTPSを強制
2. **セキュリティヘッダーの追加**: `helmet`などのミドルウェアを使用してセキュリティヘッダーを追加
3. **定期的なセキュリティ監査**: 依存関係の脆弱性スキャン（`pnpm audit`）

