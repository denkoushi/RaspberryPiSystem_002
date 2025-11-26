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
    participant Backup as backup.sh
    participant Restore as restore.sh
    participant DB as PostgreSQL
    participant File as ファイルシステム
    
    Note over Test,File: Step 1-3: 準備
    Test->>DB: テスト用DB作成（CREATE DATABASE、ADMIN_DB_URL経由）
    Test->>DB: スキーマ適用（Prisma Migrate、TEST_DB_URL経由）
    Test->>DB: テストデータ挿入（TEST_DB_URL経由）
    
    Note over Test,File: Step 4: バックアップ（本番スクリプトを呼び出し）
    Test->>Backup: 環境変数でDB名・ファイルパスを指定して実行
    Backup->>DB: pg_dump（フルダンプ）
    DB-->>File: backup.sql.gz
    
    Note over Test,File: Step 5: 災害発生をシミュレート
    Test->>DB: DB削除（ADMIN_DB_URL経由）
    Test->>DB: 空のDB作成（ADMIN_DB_URL経由）
    
    Note over Test,File: Step 6-7: リストア＆検証（本番スクリプトを呼び出し）
    Test->>Restore: 環境変数でDB名・ファイルパスを指定して実行
    File-->>Restore: backup.sql.gz
    Restore->>DB: psql（リストア）
    Test->>DB: データ確認（TEST_DB_URL経由）
```

### ポイント

1. **テスト用DBを使用**: 本番DB（`borrow_return`）に影響を与えない
2. **スキーマはPrismaマイグレーションで適用**: 本番と同じマイグレーションを `test_borrow_return` に適用して検証する
3. **フルダンプ**: 本番と同じ方法（スキーマ + データ）
4. **空DBへリストア**: 災害復旧シナリオを再現
5. **本番スクリプトを直接呼び出す**: `backup.sh`/`restore.sh`を環境変数で切り替え可能にし、テストからも本番からも同じスクリプトを使う
6. **ADMIN_DB_URL/TEST_DB_URLの分離**: CREATE/DROPは`postgres`DB、migrate/INSERT/SELECTは`test_borrow_return`DBに接続

### 実装詳細（2025-11-26完了）

**外部レビュー結果**: 「空DB作成 → Prisma Migrate 適用 → テストデータ投入 → pg_dump フルバックアップ → 空DBにリストア → データ検証」の流れは、PostgreSQLの論理バックアップ（pg_dump）を使った災害復旧テストとして**標準的・妥当**と評価された（Level 2〜3 相当のテストレベル）。

**実装方針（外部レビュー提案の「標準モデル」）**:
- テストスクリプトの責務を「前提状態を作る」「本番スクリプトを呼ぶ」「結果を1〜2箇所だけ検証する」に絞る
- `backup.sh`/`restore.sh`を環境変数でDB名・ファイルパス・コンテナ名を切り替え可能に
- ADMIN_DB_URL（CREATE/DROP用）とTEST_DB_URL（migrate/INSERT/SELECT用）を明確に分離
- `docker exec -i`フラグを追加してヒアドキュメントを受け取れるように修正（CI環境）

**実装ファイル**:
- `scripts/server/backup.sh`: 環境変数対応（`DB_NAME`, `BACKUP_FILE`, `DB_CONTAINER`, `COMPOSE_FILE`）
- `scripts/server/restore.sh`: 環境変数対応（`DB_NAME`, `BACKUP_FILE`, `DB_CONTAINER`, `COMPOSE_FILE`, `SKIP_CONFIRM`）
- `scripts/test/backup-restore.test.sh`: 本番スクリプトを直接呼び出す形に変更

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

## CIワークフローの構成

`.github/workflows/ci.yml`は以下の3つのジョブで構成されています:

1. **lint-and-test**: リント、ビルド、APIテスト、バックアップ/リストアテスト、監視テスト
2. **e2e-tests**: E2Eテスト（Playwright）
3. **docker-build**: Dockerイメージのビルド

### lint-and-test ジョブの主要ステップ

#### 1. 環境セットアップ
- pnpm 9のインストール
- Node.js 20のセットアップ
- 依存関係のインストール（`pnpm install --frozen-lockfile`）

#### 2. ビルド
- `packages/shared-types`のビルド
- Prisma Clientの生成
- APIのビルド

#### 3. PostgreSQLセットアップ
- `postgres-test`コンテナの起動（`postgres:15-alpine`）
- ヘルスチェックによる起動確認（最大60秒待機）
- Prismaマイグレーションの適用（`pnpm prisma migrate deploy`）

#### 4. APIテスト
- Vitestによる統合テストの実行（`pnpm test --reporter=verbose`）
- 環境変数: `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`

#### 5. バックアップ/リストアテスト
```yaml
- name: Test backup/restore scripts
  run: |
    bash scripts/test/backup-restore.test.sh || {
      echo "Backup/restore tests failed!"
      exit 1
    }
```

**前提条件**:
- PostgreSQLコンテナ（`postgres-test`）が起動していること
- Prismaマイグレーションが適用可能な状態であること

**実行環境**:
- CI環境: `postgres-test`コンテナを使用（`docker exec -i`）
- ローカル環境: `docker compose`の`db`コンテナを使用（`docker compose exec -T`）

#### 6. 監視テスト
```yaml
- name: Test monitoring scripts
  run: |
    API_URL=http://localhost:8080/api pnpm test:monitor || {
      echo "Monitoring tests failed!"
      exit 1
    }
```

**前提条件**:
- APIサーバーが起動していること（`NODE_ENV=production`で起動）
- `/api/system/health`エンドポイントが利用可能であること

**APIサーバーの起動**:
- `NODE_ENV=production pnpm start`でバックグラウンド起動
- `/api/system/health`エンドポイントが応答するまで最大30秒待機
- テスト完了後、`if: always()`で確実に停止

#### 7. Webビルド
- `apps/web`のビルド（最後に実行）

### e2e-tests ジョブ

- `lint-and-test`ジョブの成功後に実行
- 別のPostgreSQLコンテナ（`postgres-e2e`）を使用
- PlaywrightによるE2Eテストを実行
- テスト結果をArtifactとして保存

### docker-build ジョブ

- `lint-and-test`ジョブの成功後に実行
- Docker Buildxを使用してAPI/Webイメージをビルド
- GitHub Actions Cacheを活用してビルド時間を短縮

## 今後の改善計画

### Phase 5 完了後

1. [x] バックアップ/リストアテストの再設計（2025-11-26完了）
2. [ ] E2Eテストの安定化（CI環境で動作する範囲に限定）
3. [ ] CIの継続的な成功確認（複数回実行して安定性を検証）
4. [ ] テストカバレッジの可視化
5. [ ] パフォーマンステストの自動化

### 長期的な改善

1. [ ] テストデータファクトリの整備
2. [ ] テスト並列実行の最適化
3. [ ] CIキャッシュの活用
4. [ ] CIワークフローのドキュメント化（各ステップの説明）

