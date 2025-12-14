# imports.ts リファクタリング計画

最終更新: 2025-12-14

## 目的

`apps/api/src/routes/imports.ts`のリファクタリングにより、以下の問題を解決する：

1. **処理のシーケンスの可視性の欠如**: 長い関数内で処理の流れが追いにくい
2. **無意味なメソッド化**: 再利用されていないメソッドの乱立
3. **可読性の低下**: 処理があっちこっちに飛び、全体像が把握しにくい

## 現状の問題点

### 1. `importEmployees`関数（約220行）

**問題点**:
- 処理のシーケンスが不明確
- コメントはあるが、処理フローの可視性が低い
- 重複チェック、更新処理、作成処理が混在

**現在の構造**:
```typescript
async function importEmployees(...) {
  // 1. ログ出力
  // 2. replaceExisting=trueの場合の削除処理（50行）
  // 3. CSV内のnfcTagUid重複チェック（20行）
  // 4. 各行の処理ループ（150行）
  //    - 既存チェック
  //    - 更新処理（重複チェック含む）
  //    - 作成処理（重複チェック含む）
  //    - エラーハンドリング
}
```

### 2. `importItems`関数（約200行）

**問題点**:
- 同様に長く、処理の流れが追いにくい
- `importEmployees`と類似の処理パターンだが、コードが重複している

### 3. メインハンドラー（`registerImportRoutes`）

**問題点**:
- マルチパート処理、CSVパース、バリデーション、トランザクション処理が混在
- 処理のシーケンスは比較的明確だが、エラーハンドリングが複雑

## リファクタリング方針

### 基本原則

1. **メインロジックにコメント付きシーケンスを明記**: 処理の流れを可視化
2. **メソッド化は最小限に**: 実際に再利用される処理のみをメソッド化
3. **処理の流れを明確化**: シーケンスを明確化してから、必要最小限のメソッド化を検討

### リファクタリング後の構造

#### 1. メインハンドラー（`registerImportRoutes`）

```typescript
export async function registerImportRoutes(app: FastifyInstance): Promise<void> {
  const mustBeAdmin = authorizeRoles('ADMIN');

  app.post('/imports/master', { preHandler: mustBeAdmin, config: { rateLimit: false } }, async (request, reply) => {
    // === 処理シーケンス ===
    // 1. マルチパートリクエストの検証とファイル取得
    // 2. replaceExistingフラグの解析
    // 3. CSVファイルのパースとバリデーション
    // 4. 従業員とアイテム間のnfcTagUid重複チェック
    // 5. トランザクション内でインポート処理実行
    // 6. 結果を返す
  });
}
```

#### 2. `importEmployees`関数

```typescript
async function importEmployees(
  tx: Prisma.TransactionClient,
  rows: EmployeeCsvRow[],
  replaceExisting: boolean,
  logger?: { info: (obj: unknown, msg: string) => void; error: (obj: unknown, msg: string) => void }
): Promise<ImportResult> {
  // === 処理シーケンス ===
  // 1. 入力検証（rows.length === 0 の場合は早期リターン）
  // 2. replaceExisting=trueの場合: Loanレコードが存在しない従業員を削除
  // 3. CSV内のnfcTagUid重複チェック（CSV内での重複を検出）
  // 4. 各行をループ処理:
  //    4-1. 既存従業員の存在確認
  //    4-2. 既存の場合: 更新処理（DB内のnfcTagUid重複チェック含む）
  //    4-3. 新規の場合: 作成処理（DB内のnfcTagUid重複チェック含む）
  //    4-4. エラーハンドリング（P2002エラーの詳細化）
  // 5. 結果を返す
}
```

#### 3. `importItems`関数

```typescript
async function importItems(
  tx: Prisma.TransactionClient,
  rows: ItemCsvRow[],
  replaceExisting: boolean
): Promise<ImportResult> {
  // === 処理シーケンス ===
  // 1. 入力検証（rows.length === 0 の場合は早期リターン）
  // 2. replaceExisting=trueの場合: Loanレコードが存在しないアイテムを削除
  // 3. CSV内のnfcTagUid重複チェック（CSV内での重複を検出）
  // 4. 各行をループ処理:
  //    4-1. 既存アイテムの存在確認
  //    4-2. 既存の場合: 更新処理（DB内のnfcTagUid重複チェック含む）
  //    4-3. 新規の場合: 作成処理（DB内のnfcTagUid重複チェック含む）
  //    4-4. エラーハンドリング（P2002エラーの詳細化）
  // 5. 結果を返す
}
```

### メソッド化の方針

**メソッド化する処理**:
- ✅ `readFile`: マルチパートファイルの読み込み（再利用されている）
- ✅ `parseCsvRows`: CSVパース（再利用されている）
- ✅ `normalizeEmployeeStatus`: ステータスの正規化（再利用されている）
- ✅ `normalizeItemStatus`: ステータスの正規化（再利用されている）

**メソッド化しない処理**:
- ❌ CSV内のnfcTagUid重複チェック（`importEmployees`と`importItems`で異なる実装）
- ❌ 各行の処理ループ（処理の流れを可視化するため、メインロジックに残す）
- ❌ エラーハンドリング（各処理のコンテキストに依存するため）

## 実装タスク

### Phase 1: メインロジックの可視化 ✅ 完了

- [x] `registerImportRoutes`のメインハンドラーにコメント付きシーケンスを追加（2025-12-14）
- [x] `importEmployees`関数にコメント付きシーケンスを追加（2025-12-14）
- [x] `importItems`関数にコメント付きシーケンスを追加（2025-12-14）

### Phase 2: コードの整理 🔄 進行中

- [x] 不要なデバッグログ（`console.log`）を削除（2025-12-14）
- [ ] 不要なデバッグログ（`logger?.error`）を削除または適切なレベルに変更
- [ ] 重複コードの整理（`importEmployees`と`importItems`の共通パターンを確認）
- [ ] エラーハンドリングの統一

### Phase 3: テストの追加・更新 ⏳ 未着手

- [ ] 既存のテストが動作することを確認
- [ ] リファクタリング後の動作確認テストを追加
- [ ] エッジケースのテストを追加

## 実装進捗

### 2025-12-14

**Phase 1完了**:
- ✅ メインハンドラー、`importEmployees`、`importItems`にコメント付きシーケンスを追加
- ✅ 処理の流れが明確に可視化された

**Phase 2進行中**:
- ✅ `fieldSchema`の不要な`console.log`を削除
- ⏳ 残りのデバッグログの整理が必要

## テスト計画

### 単体テスト

**テスト対象**:
- `readFile`: マルチパートファイルの読み込み
- `parseCsvRows`: CSVパース
- `normalizeEmployeeStatus`: ステータスの正規化
- `normalizeItemStatus`: ステータスの正規化

**テストケース**:
- 正常系: 正しいCSVファイルの処理
- 異常系: 不正なCSVファイルの処理
- エッジケース: 空のCSV、1行のみのCSV

### 統合テスト

**テスト対象**:
- `POST /api/imports/master`エンドポイント

**テストケース**:
1. **正常系**:
   - 従業員CSVのみのインポート
   - アイテムCSVのみのインポート
   - 従業員CSVとアイテムCSVの同時インポート
   - `replaceExisting: false`でのインポート（既存データの更新）
   - `replaceExisting: true`でのインポート（既存データの削除）

2. **バリデーションエラー**:
   - 不正な`employeeCode`形式（数字4桁以外）
   - 不正な`itemCode`形式（TO + 数字4桁以外）
   - 必須項目の欠如（`displayName`, `name`）

3. **重複エラー**:
   - CSV内での`nfcTagUid`重複
   - 従業員とアイテム間での`nfcTagUid`重複
   - DB内での`nfcTagUid`重複

4. **エラーハンドリング**:
   - マルチパートリクエストではない場合
   - CSVファイルがアップロードされていない場合
   - トランザクションエラー（P2002, P2003）

### E2Eテスト

**テスト対象**:
- 管理画面からのCSVインポート機能

**テストケース**:
- CSVファイルのアップロード
- インポート結果の表示
- エラーメッセージの表示

## CI/CD計画

### リントチェック

- [ ] ESLintの実行（`pnpm lint`）
- [ ] TypeScriptの型チェック（`pnpm type-check`）

### テスト実行

- [ ] 単体テストの実行（`pnpm test`）
- [ ] 統合テストの実行（`pnpm test:integration`）
- [ ] E2Eテストの実行（`pnpm test:e2e`）

### ビルドチェック

- [ ] APIのビルド（`cd apps/api && pnpm build`）
- [ ] Webアプリのビルド（`cd apps/web && pnpm build`）

## 実装手順

1. **ブランチ作成**: `refactor/imports-ts-refactoring`
2. **計画ドキュメント作成**: 本ドキュメント
3. **Phase 1実装**: メインロジックの可視化
4. **Phase 2実装**: コードの整理
5. **Phase 3実装**: テストの追加・更新
6. **CI/CD確認**: すべてのチェックが通過することを確認
7. **レビュー**: コードレビューと動作確認
8. **マージ**: `main`ブランチへのマージ

## 成功基準

- ✅ 処理のシーケンスが明確に可視化されている
- ✅ コードの可読性が向上している
- ✅ 既存のテストがすべて通過する
- ✅ 新しいテストが追加されている
- ✅ CI/CDがすべて通過する
- ✅ 既存の機能が正常に動作する（リグレッションテスト）

## 関連ドキュメント

- [CSVインポート・エクスポート仕様](../guides/csv-import-export.md)
- [Validation 7: USB一括登録の実機検証ガイド](../guides/validation-7-usb-import.md)
- [開発ガイド](../guides/development.md)
