# APIリファクタリングおよび改修計画

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document must be maintained in accordance with `.agent/PLANS.md`.

## Purpose / Big Picture

現在のシステムでは、以下の問題が発生しています：

1. **レート制限の問題**: ダッシュボードや履歴ページで429エラーが発生
2. **削除機能の問題**: 返却済みの貸出記録があっても削除できない
3. **インポート機能の問題**: USBメモリからのCSVインポートでP2002エラーが発生
4. **404エラーの発生**: 一部のエンドポイントで404エラーが発生

これらの問題は、部分的な修正では解決できません。全体的なリファクタリングと改修計画が必要です。

この計画の目的は、以下の改善を実現することです：

- **レート制限の統一的な管理**: すべてのエンドポイントで適切なレート制限設定を適用
- **エラーハンドリングの改善**: 一貫性のあるエラーメッセージと適切なHTTPステータスコード
- **削除機能の完全な実装**: 返却済みの貸出記録があっても削除可能にする
- **インポート機能の堅牢化**: CSVインポート時の重複チェックとエラーハンドリングの改善
- **APIエンドポイントの整理**: 一貫性のあるエンドポイント設計とルーティング

## Progress

- [x] (2025-11-25) 現状の問題分析と計画立案
- [x] (2025-11-25) レート制限設定の統一的な管理システムの実装（`apps/api/src/config/rate-limit.ts`を作成）
- [x] (2025-11-25) エンドポイントへのレート制限設定の適用（`/api/tools/employees`, `/api/tools/items`, `/api/tools/transactions`に`config: { rateLimit: false }`を追加）
- [x] (2025-11-25) フェーズ1のテスト実行と動作確認（従業員・アイテムの統合テストが成功）
- [x] (2025-11-25) エラーハンドリングの統一的な実装（P2002エラーの詳細メッセージ追加、P2003エラーメッセージの改善）
- [x] (2025-11-25) 削除機能の完全な実装とテスト（エラーメッセージの改善、ログの追加）
- [ ] インポート機能の堅牢化（エラーメッセージの一貫性向上）
- [ ] APIエンドポイントの整理とドキュメント化
- [ ] 統合テストの追加と実行
- [ ] パフォーマンステストと最適化

## Surprises & Discoveries

- Observation: `confdeltype`が`n`（NO ACTION）のままでも、`information_schema.referential_constraints`の`delete_rule`が`SET NULL`になっていれば、実際の動作は正しい
  Evidence: データベースの確認結果で`delete_rule`が`SET NULL`になっていることを確認

- Observation: レート制限の設定が不統一で、一部のエンドポイントのみ`config: { rateLimit: false }`が設定されている
  Evidence: `apps/api/src/routes/tools/loans/active.ts`には設定があるが、`apps/api/src/routes/tools/employees/list.ts`には設定がない

- Observation: フロントエンドが`/api/transactions`を使用しているが、バックエンドのルーティングが`/api/tools/transactions`になっている可能性がある
  Evidence: `apps/web/src/api/client.ts`で`/transactions`を使用、`apps/api/src/routes/tools/transactions/list.ts`で`/transactions`を登録

## Decision Log

- Decision: レート制限の設定を統一的なシステムで管理する
  Rationale: 現在は各エンドポイントで個別に`config: { rateLimit: false }`を設定しているが、これを統一的な設定システムで管理することで、保守性と一貫性を向上させる
  Date/Author: 2025-11-25

- Decision: エラーハンドリングを統一的なミドルウェアで実装する
  Rationale: 現在のエラーハンドリングは各エンドポイントで個別に実装されているが、統一的なミドルウェアで実装することで、一貫性のあるエラーメッセージと適切なHTTPステータスコードを提供できる
  Date/Author: 2025-11-25

- Decision: 削除機能の実装をデータベーススキーマの変更とAPIロジックの両方で実現する
  Rationale: データベーススキーマの変更だけでは不十分で、APIロジックでも適切なチェックとエラーハンドリングが必要
  Date/Author: 2025-11-25

## Outcomes & Retrospective

（実装完了後に記入）

## Context and Orientation

### 現在のアーキテクチャ

- **API**: Fastifyフレームワークを使用したRESTful API
- **データベース**: PostgreSQL（Prisma ORM）
- **フロントエンド**: React + Vite
- **レート制限**: `@fastify/rate-limit`プラグインを使用

### 主要なファイル

- `apps/api/src/plugins/rate-limit.ts`: レート制限プラグインの設定
- `apps/api/src/plugins/error-handler.ts`: エラーハンドリングの実装
- `apps/api/src/routes/index.ts`: ルーティングの登録
- `apps/api/src/routes/tools/`: ツール管理モジュールのルート
- `apps/web/src/api/client.ts`: フロントエンドのAPIクライアント
- `apps/web/src/pages/admin/DashboardPage.tsx`: ダッシュボードページ
- `apps/web/src/pages/tools/HistoryPage.tsx`: 履歴ページ

### 現在の問題

1. **レート制限の問題**
   - ダッシュボードページで`useActiveLoans`, `useEmployees`, `useItems`を使用
   - これらのエンドポイントがレート制限に引っかかっている
   - `/api/tools/loans/active`は`config: { rateLimit: false }`が設定されているが、`/api/tools/employees`と`/api/tools/items`には設定されていない

2. **404エラーの発生**
   - 履歴ページで`/api/transactions`を使用
   - バックエンドのルーティングが`/api/tools/transactions`になっている可能性

3. **削除機能の問題**
   - データベースの設定は正しいが、実際の削除が動作していない
   - APIロジックでのチェックが不十分な可能性

4. **インポート機能の問題**
   - CSVインポート時にP2002エラー（ユニーク制約違反）が発生
   - 重複チェックのロジックが不十分

## Plan of Work

### フェーズ1: レート制限の統一的な管理

1. **レート制限設定の統一的な管理システムの実装**
   - `apps/api/src/config/rate-limit.ts`を作成
   - エンドポイントごとのレート制限設定を定義
   - デフォルトのレート制限と個別の設定を管理

2. **既存のエンドポイントへの適用**
   - ダッシュボードで使用されるエンドポイントにレート制限の除外設定を追加
   - 履歴ページで使用されるエンドポイントにレート制限の除外設定を追加
   - キオスクエンドポイントのレート制限設定を確認

### フェーズ2: エラーハンドリングの統一的な実装

1. **エラーハンドリングミドルウェアの改善**
   - `apps/api/src/plugins/error-handler.ts`を改善
   - 一貫性のあるエラーメッセージの実装
   - 適切なHTTPステータスコードの返却

2. **エンドポイントごとのエラーハンドリングの統一**
   - すべてのエンドポイントで統一的なエラーハンドリングを適用
   - 個別のエラーハンドリングロジックを削除

### フェーズ3: 削除機能の完全な実装

1. **データベーススキーマの確認**
   - マイグレーションが正しく適用されているか確認
   - 外部キー制約が正しく設定されているか確認

2. **APIロジックの改善**
   - `apps/api/src/routes/tools/employees/delete.ts`を改善
   - `apps/api/src/routes/tools/items/delete.ts`を改善
   - 返却済みの貸出記録があっても削除可能にする

3. **テストの追加**
   - 削除機能の統合テストを追加
   - エッジケースのテストを追加

### フェーズ4: インポート機能の堅牢化

1. **重複チェックの改善**
   - CSV内の重複チェックを改善
   - 既存データとの重複チェックを改善
   - エラーメッセージの改善

2. **トランザクション処理の改善**
   - トランザクションのロールバック処理を改善
   - エラー時の適切な処理を実装

### フェーズ5: APIエンドポイントの整理

1. **ルーティングの統一**
   - すべてのエンドポイントを`/api/tools/*`に統一
   - 後方互換性のためのリダイレクトを実装

2. **ドキュメントの更新**
   - APIドキュメントを更新
   - エンドポイントの一覧を整理

## Concrete Steps

### ステップ1: レート制限設定の統一的な管理システムの実装

```bash
# 1. レート制限設定ファイルの作成
cd /Users/tsudatakashi/RaspberryPiSystem_002
touch apps/api/src/config/rate-limit.ts

# 2. 設定ファイルの実装
# （内容は後述）

# 3. レート制限プラグインの更新
# apps/api/src/plugins/rate-limit.tsを更新

# 4. テストの実行
cd apps/api
pnpm test
```

### ステップ2: エンドポイントへのレート制限設定の適用

```bash
# 1. ダッシュボードで使用されるエンドポイントの確認
grep -r "useEmployees\|useItems\|useActiveLoans" apps/web/src

# 2. 対応するバックエンドエンドポイントにレート制限の除外設定を追加
# apps/api/src/routes/tools/employees/list.ts
# apps/api/src/routes/tools/items/list.ts
# apps/api/src/routes/tools/loans/active.ts（既に設定済み）

# 3. 履歴ページで使用されるエンドポイントの確認
grep -r "getTransactions\|useTransactions" apps/web/src

# 4. 対応するバックエンドエンドポイントにレート制限の除外設定を追加
# apps/api/src/routes/tools/transactions/list.ts
```

### ステップ3: エラーハンドリングの統一的な実装

```bash
# 1. エラーハンドリングミドルウェアの改善
# apps/api/src/plugins/error-handler.tsを更新

# 2. エンドポイントごとのエラーハンドリングの統一
# 各エンドポイントのエラーハンドリングロジックを削除

# 3. テストの実行
cd apps/api
pnpm test
```

### ステップ4: 削除機能の完全な実装

```bash
# 1. データベーススキーマの確認
docker compose -f infrastructure/docker/docker-compose.server.yml exec db psql -U postgres -d borrow_return -c "SELECT tc.constraint_name, tc.table_name, kcu.column_name, rc.delete_rule FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name JOIN information_schema.referential_constraints rc ON tc.constraint_name = rc.constraint_name WHERE tc.table_name = 'Loan' AND tc.constraint_type = 'FOREIGN KEY' AND kcu.column_name IN ('itemId', 'employeeId');"

# 2. APIロジックの改善
# apps/api/src/routes/tools/employees/delete.tsを更新
# apps/api/src/routes/tools/items/delete.tsを更新

# 3. テストの追加と実行
cd apps/api
pnpm test -- src/routes/__tests__/employees.integration.test.ts
pnpm test -- src/routes/__tests__/items.integration.test.ts
```

### ステップ5: インポート機能の堅牢化

```bash
# 1. 重複チェックの改善
# apps/api/src/routes/imports.tsを更新

# 2. テストの追加と実行
cd apps/api
pnpm test -- src/routes/__tests__/imports.integration.test.ts
```

### ステップ6: APIエンドポイントの整理

```bash
# 1. ルーティングの統一
# apps/api/src/routes/index.tsを更新

# 2. 後方互換性のためのリダイレクトを実装
# 必要に応じてリダイレクトエンドポイントを追加

# 3. ドキュメントの更新
# docs/api/overview.mdを更新
```

## Validation and Acceptance

### レート制限の統一的な管理

- ダッシュボードページで429エラーが発生しないことを確認
- 履歴ページで429エラーが発生しないことを確認
- キオスクページで429エラーが発生しないことを確認
- レート制限の設定が統一されていることを確認

### エラーハンドリングの統一的な実装

- すべてのエンドポイントで一貫性のあるエラーメッセージが返却されることを確認
- 適切なHTTPステータスコードが返却されることを確認
- エラーログが適切に記録されることを確認

### 削除機能の完全な実装

- 返却済みの貸出記録があっても従業員/アイテムを削除できることを確認
- 未返却の貸出記録がある場合は削除できないことを確認
- エラーメッセージが適切に表示されることを確認

### インポート機能の堅牢化

- CSVインポート時に重複エラーが適切に処理されることを確認
- エラーメッセージが適切に表示されることを確認
- トランザクションが適切にロールバックされることを確認

### APIエンドポイントの整理

- すべてのエンドポイントが`/api/tools/*`に統一されていることを確認
- 後方互換性が保たれていることを確認
- APIドキュメントが更新されていることを確認

## Idempotence and Recovery

すべてのステップは冪等性を持ち、複数回実行しても問題ありません。データベースの変更はマイグレーションで管理されているため、安全にロールバックできます。

## Artifacts and Notes

（実装中に追加）

## Interfaces and Dependencies

### レート制限設定

`apps/api/src/config/rate-limit.ts`で定義：

```typescript
export interface RateLimitConfig {
  max: number;
  timeWindow: string;
  skip?: boolean;
}

export const rateLimitConfigs: Record<string, RateLimitConfig> = {
  '/api/tools/employees': { max: 100, timeWindow: '1 minute', skip: false },
  '/api/tools/items': { max: 100, timeWindow: '1 minute', skip: false },
  '/api/tools/loans/active': { max: 100, timeWindow: '1 minute', skip: true },
  '/api/tools/transactions': { max: 100, timeWindow: '1 minute', skip: true },
  // ...
};
```

### エラーハンドリング

`apps/api/src/plugins/error-handler.ts`で統一的なエラーハンドリングを実装。

### 削除機能

`apps/api/src/routes/tools/employees/delete.ts`と`apps/api/src/routes/tools/items/delete.ts`で実装。

