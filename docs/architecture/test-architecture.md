# テストアーキテクチャ設計

このドキュメントは、CI/テスト環境の設計方針を定義します。

## 概要

### 分離すべき責務

| 責務 | 本番環境 | CI環境 |
|------|----------|--------|
| スキーマ管理 | Prismaマイグレーション | SQL直接実行 or マイグレーション |
| シードデータ | `prisma db seed` | テストごとに必要なデータを挿入 |
| バックアップ | `pg_dump`（フルダンプ） | 同左 |
| リストア | `psql`（空DBへリストア） | 同左 |

### 設計原則

1. **本番手順とテスト手順の分離**
   - 本番手順: 複雑でも許容（Prismaマイグレーション、シード、バックアップ/リストア）
   - テスト手順: シンプルで確実に動作（依存関係を最小化）

2. **CI環境の制約を考慮**
   - Prismaマイグレーションが失敗する場合がある
   - Node.jsの依存関係が不完全な場合がある
   - SQLで直接実行する方が確実

3. **テストの目的を明確化**
   - 「CIを通す」ことが目的ではない
   - 「機能が正しく動作することを検証する」ことが目的

## テスト種別

### 1. ユニットテスト

```
対象: 個々の関数・クラス
環境: Node.js（DB不要）
ツール: Vitest
場所: apps/api/src/**/*.test.ts
```

- モック使用可
- 高速実行が重要
- カバレッジ重視

### 2. 統合テスト

```
対象: APIエンドポイント
環境: Node.js + PostgreSQL
ツール: Vitest + Fastify inject
場所: apps/api/src/routes/__tests__/*.integration.test.ts
```

- 実際のDBを使用
- テストごとにデータをリセット
- トランザクションロールバック推奨

### 3. E2Eテスト

```
対象: ブラウザ操作
環境: Playwright + 実行中のアプリ
ツール: Playwright
場所: e2e/*.spec.ts
```

- CI環境では不安定な場合がある
- 重要なフローのみテスト
- タイミング問題に注意

### 4. インフラテスト

```
対象: バックアップ/リストア、監視
環境: シェルスクリプト + PostgreSQL
ツール: Bash
場所: scripts/test/*.test.sh
```

- 本番手順を再現
- CI環境での制約を考慮
- 最小限の依存関係

## バックアップ/リストアテストの設計

### テストシナリオ（災害復旧）

```mermaid
sequenceDiagram
    participant Test as テストスクリプト
    participant DB as PostgreSQL
    participant File as ファイルシステム
    
    Note over Test,File: Step 1-3: 準備
    Test->>DB: テスト用DB作成（CREATE DATABASE）
    Test->>DB: スキーマ適用（Prisma Migrate）
    Test->>DB: テストデータ挿入
    
    Note over Test,File: Step 4: バックアップ
    Test->>DB: pg_dump（フルダンプ）
    DB-->>File: backup.sql.gz
    
    Note over Test,File: Step 5: 災害発生をシミュレート
    Test->>DB: DB削除
    Test->>DB: 空のDB作成
    
    Note over Test,File: Step 6-7: リストア＆検証
    File-->>Test: backup.sql.gz
    Test->>DB: psql（リストア）
    Test->>DB: データ確認
```

### ポイント

1. **テスト用DBを使用**: 本番DB（`borrow_return`）に影響を与えない
2. **スキーマはPrismaマイグレーションで適用**: 本番と同じマイグレーションを `test_borrow_return` に適用して検証する
3. **フルダンプ**: 本番と同じ方法（スキーマ + データ）
4. **空DBへリストア**: 災害復旧シナリオを再現

## CI環境での考慮事項

### PostgreSQLコンテナ

```yaml
# .github/workflows/ci.yml
services:
  postgres:
    image: postgres:15-alpine
    env:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: borrow_return
    options: >-
      --health-cmd pg_isready
      --health-interval 10s
      --health-timeout 5s
      --health-retries 5
```

- `postgres-test`という名前でアクセス可能
- ポート5432がホスト側にマッピング

### 環境変数

```bash
# CI環境
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/borrow_return
NODE_ENV=test  # APIサーバーは起動しない（main.tsの条件分岐）

# APIサーバーを起動する場合
NODE_ENV=production
```

### 不安定なテストの対処

1. **スキップ**: CI環境でのみスキップ

```typescript
test.skip(process.env.CI, '説明');
```

2. **リトライ**: Playwrightの設定

```typescript
retries: process.env.CI ? 2 : 0,
```

3. **タイムアウト延長**: Vitestの設定

```typescript
testTimeout: 30000,
hookTimeout: 30000,
```

## ディレクトリ構造

```
scripts/
├── test/                      # テストスクリプト
│   ├── backup-restore.test.sh # バックアップ/リストアテスト
│   ├── monitor.test.sh        # 監視テスト
│   ├── start-postgres.sh      # ローカルPostgreSQL起動
│   ├── stop-postgres.sh       # ローカルPostgreSQL停止
│   └── run-tests.sh           # テスト実行
├── server/                    # 本番用スクリプト
│   ├── backup.sh              # バックアップ
│   ├── restore.sh             # リストア
│   └── monitor.sh             # 監視
└── ci/                        # CI用スクリプト
    └── analyze-failure.sh     # 失敗分析
```

## 今後の改善計画

### Phase 5 完了後

1. [ ] テストカバレッジの可視化
2. [ ] パフォーマンステストの自動化
3. [ ] E2Eテストの安定化（CI環境で動作する範囲に限定）

### 長期的な改善

1. [ ] テストデータファクトリの整備
2. [ ] テスト並列実行の最適化
3. [ ] CIキャッシュの活用

