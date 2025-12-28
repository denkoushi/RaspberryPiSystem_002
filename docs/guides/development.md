---
title: 開発ガイド
tags: [開発, セットアップ, 環境構築]
audience: [開発者, 新規参加者]
last-verified: 2025-11-27
related: [deployment.md, ../architecture/overview.md]
category: guides
update-frequency: medium
---

# 開発ガイド

最終更新: 2025-12-28（UI検証手順追加）

## 概要

本ドキュメントでは、Raspberry Pi System 002の開発環境のセットアップと開発手順を説明します。

## 前提条件

- Node.js 20以上
- pnpm 9以上
- Python 3.11+
- Poetry
- Docker & Docker Compose
- Git

## セットアップ手順

### 1. リポジトリのクローン

```bash
git clone https://github.com/denkoushi/RaspberryPiSystem_002.git
cd RaspberryPiSystem_002
```

### 2. 依存関係のインストール

```bash
corepack enable
pnpm install
poetry install -C clients/nfc-agent
```

### 3. 環境変数の設定

```bash
# API環境変数
cp apps/api/.env.example apps/api/.env
# apps/api/.envを編集して、実際の値を設定

# NFCエージェント環境変数
cp clients/nfc-agent/.env.example clients/nfc-agent/.env
```

### 4. データベースのセットアップ

```bash
# Docker Composeでデータベースを起動
docker compose -f infrastructure/docker/docker-compose.server.yml up -d db

# マイグレーションを実行
cd apps/api
pnpm prisma migrate dev

# シードデータを投入（オプション）
pnpm prisma:seed
```

### 5. 開発サーバーの起動

#### APIサーバー

```bash
cd apps/api
pnpm dev
```

APIサーバーは`http://localhost:8080`で起動します。

#### Webアプリケーション

```bash
cd apps/web
pnpm dev
```

Webアプリケーションは`http://localhost:5173`で起動します。

## 開発ワークフロー

### ブランチ戦略

- `main`: 本番環境用ブランチ
- `develop`: 開発用ブランチ
- `feature/*`: 機能追加用ブランチ
- `refactor/*`: リファクタリング用ブランチ
- `fix/*`: バグ修正用ブランチ

### コミットメッセージ

コミットメッセージは以下の形式に従ってください：

```
<type>: <subject>

<body>
```

**Type**:
- `feat`: 新機能
- `fix`: バグ修正
- `docs`: ドキュメント
- `style`: コードスタイル
- `refactor`: リファクタリング
- `test`: テスト
- `chore`: その他

### 開発フロー

1. **ブランチ作成**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **コード編集**
   - API: `apps/api/src/`
   - Web UI: `apps/web/src/`
   - 共通型: `packages/shared-types/src/`

3. **ビルド確認**
   ```bash
   # API
   cd apps/api
   pnpm build

   # Web UI
   cd apps/web
   pnpm build

   # 共通型
   cd packages/shared-types
   pnpm build
   ```

4. **Lintチェック**
   ```bash
   # 全プロジェクトのlintチェック
   pnpm lint --max-warnings=0
   ```
   
   **注意**: pre-commitフックが有効になっているため、コミット時に自動的にlintチェックが実行されます。
   lint違反がある場合はコミットが拒否されます。

5. **テスト実行**
   ```bash
   # APIテスト
   cd apps/api
   pnpm test

   # Web UIテスト
   cd apps/web
   pnpm test

   # すべてのテスト
   pnpm -r test
   ```

6. **UI検証（デプロイ前推奨）**
   
   **重要**: UI変更を行った場合は、デプロイ前にCursor内のブラウザで検証することで、デプロイ時間を短縮し、効率的にUI確認ができます。
   
   ```bash
   # 1. データベースを起動（ローカル開発用にポートを公開）
   cd /path/to/RaspberryPiSystem_002
   # docker-compose.server.ymlでdbのportsを有効化（ローカル開発時のみ）
   docker compose -f infrastructure/docker/docker-compose.server.yml up -d db
   
   # 2. 環境変数を設定（必要に応じて）
   cd apps/api
   echo 'DATABASE_URL="postgresql://postgres:postgres@localhost:5432/borrow_return"' >> .env
   
   # 3. データベースのマイグレーションとシード
   pnpm prisma migrate deploy
   pnpm prisma:seed
   
   # 4. APIサーバーを起動（別ターミナル）
   pnpm dev
   # APIサーバーは http://localhost:8080 で起動
   
   # 5. Webアプリケーションを起動（別ターミナル）
   cd apps/web
   echo 'VITE_API_BASE_URL="http://localhost:8080/api"' > .env.local
   pnpm dev --host --port 5173
   # Webアプリケーションは http://localhost:5173 で起動
   
   # 6. Cursor内のブラウザで確認
   # Cursorのブラウザ機能を使用して http://localhost:5173 にアクセス
   # ログイン（admin / admin1234）してUI変更を確認
   ```
   
   **メリット**:
   - デプロイ前にUIを確認できるため、デプロイ時間を短縮
   - ローカル環境で高速に動作確認が可能
   - デプロイ後の不具合を事前に発見できる
   
   **注意**:
   - ローカル開発用の設定（データベースポート公開など）は本番環境とは異なる場合があります
   - 完全な動作確認には実機検証も必要です

7. **コミット・プッシュ**
   ```bash
   git add .
   git commit -m "feat: your feature description"
   git push origin feature/your-feature-name
   ```

## テストの実行

### ユニットテスト

```bash
# APIのテスト
cd apps/api
pnpm test

# Web UIのテスト
cd apps/web
pnpm test

# すべてのテスト
pnpm -r test
```

### E2Eテスト（Playwright）

前提: PostgreSQL、APIサーバー、Webサーバーが起動している必要があります。

```bash
# E2Eテスト実行
pnpm test:e2e

# E2Eテスト（UIモード）
pnpm test:e2e:ui

# E2Eテスト（ヘッドモード）
pnpm test:e2e:headed
```

## ビルド

```bash
# 共有型パッケージのビルド
cd packages/shared-types
pnpm build

# APIのビルド
cd apps/api
pnpm build

# Webのビルド
cd apps/web
pnpm build
```

## デバッグ時のクイックリファレンス

### 🔍 エラーが発生したら

**すべてのエラーレスポンスには`requestId`が含まれています。これを使ってログを検索できます。**

```bash
# 1. エラーレスポンスからrequestIdを取得
# 例: {"message": "...", "requestId": "req-abc123", ...}

# 2. ログでrequestIdを検索
docker compose -f infrastructure/docker/docker-compose.server.yml logs api | grep "req-abc123"

# 3. エラーコードで検索（構造化ログ）
docker compose -f infrastructure/docker/docker-compose.server.yml logs api | jq 'select(.errorCode == "VALIDATION_ERROR")'
```

### 📋 よく使うデバッグコマンド

```bash
# エラーログのみを表示（警告以上）
docker compose -f infrastructure/docker/docker-compose.server.yml logs api --tail 100 | grep -E '"level":(40|50)'

# 特定のエラーコードで検索
docker compose -f infrastructure/docker/docker-compose.server.yml logs api | jq 'select(.errorCode == "P2002")'

# バリデーションエラーの詳細を確認
curl -X POST http://localhost:8080/api/tools/employees \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"employeeCode": "0001"}' | jq '.issues'

# ログレベルを変更（デバッグ時）
# .envファイルで LOG_LEVEL=debug に設定して再起動
```

### 📚 詳細なドキュメント

- [エラーハンドリングガイド](./error-handling.md) - エラーレスポンス形式、エラーコード一覧
- [ログ出力ガイド](./logging.md) - ログレベルの設定、ログの確認方法

## コードスタイル

### Lint準拠の自動強制

本プロジェクトでは、**仕組み上、必ずlint準拠のコードが生成される**ようになっています：

1. **pre-commitフック**: コミット時に自動的にlintチェックが実行されます
   - lint違反がある場合はコミットが拒否されます
   - `.husky/pre-commit`で設定されています

2. **CI/CD**: GitHub Actionsで`pnpm lint --max-warnings=0`が実行されます
   - lint違反がある場合はCIが失敗し、マージできません
   - `.github/workflows/ci.yml`で設定されています

3. **開発時の手動チェック**: 必要に応じて`pnpm lint`を実行できます

### TypeScript

- ESLintとPrettierを使用
- 型安全性を重視
- 明示的な型注釈を推奨
- `any`の使用を避ける（lintで警告されます）
- エラーハンドリングを適切に実装

### 命名規則

- **変数・関数**: camelCase
- **クラス**: PascalCase
- **定数**: UPPER_SNAKE_CASE
- **ファイル**: 
  - ルート: `kebab-case.ts`（例: `employee-routes.ts`）
  - サービス: `camelCase.service.ts`（例: `employeeService.ts`）
  - コンポーネント: `PascalCase.tsx`（例: `EmployeePage.tsx`）

### ディレクトリ構造

新規モジュールを追加する際は、以下の構造に従う：

```
routes/{module}/
  ├── index.ts
  ├── {resource}/
  │   ├── index.ts
  │   ├── list.ts
  │   └── schemas.ts
```

## アーキテクチャ

### モノレポ構造

```
RaspberryPiSystem_002/
├── apps/
│   ├── api/          # Fastify APIサーバー
│   └── web/          # React Webアプリケーション
├── packages/
│   └── shared-types/ # 共有型定義
├── clients/
│   └── nfc-agent/   # NFCエージェント（Python）
└── infrastructure/
    └── docker/       # Docker設定
```

### API構造

- **Routes**: エンドポイントの定義
- **Services**: ビジネスロジック
- **Lib**: 共通ライブラリ（Prisma、認証など）
- **Plugins**: Fastifyプラグイン

### フロントエンド構造

- **Components**: Reactコンポーネント
- **Pages**: ページコンポーネント
- **Hooks**: カスタムフック
- **State**: XStateステートマシン
- **Services**: API呼び出し

## モジュール追加手順

### 1. APIルートの追加

```bash
# ディレクトリ作成
mkdir -p apps/api/src/routes/{module}/{resource}

# ルートファイル作成
touch apps/api/src/routes/{module}/{resource}/index.ts
```

### 2. サービス層の追加

```bash
# ディレクトリ作成
mkdir -p apps/api/src/services/{module}

# サービスファイル作成
touch apps/api/src/services/{module}/{resource}.service.ts
```

### 3. ルート登録

`apps/api/src/routes/index.ts`に新規モジュールのルートを登録：

```typescript
import { register{Module}Routes } from './{module}/index.js';

await register{Module}Routes(subApp);
```

### 4. フロントエンドページの追加

```bash
# ディレクトリ作成
mkdir -p apps/web/src/pages/{module}

# ページファイル作成
touch apps/web/src/pages/{module}/{Resource}Page.tsx
```

### 5. ルーティング登録

`apps/web/src/App.tsx`に新規ページのルートを登録：

```typescript
<Route path="{module}">
  <Route path="{resource}" element={<{Resource}Page />} />
</Route>
```

## デバッグ

### APIサーバー

```bash
# ログレベルを変更
LOG_LEVEL=debug pnpm dev

# データベースクエリのログを有効化
DATABASE_LOG=true pnpm dev

# Dockerコンテナのログ確認
docker compose -f infrastructure/docker/docker-compose.server.yml logs api

# コンテナ内でシェル実行
docker compose -f infrastructure/docker/docker-compose.server.yml exec api sh
```

### Webアプリケーション

```bash
# 開発モードで起動（ホットリロード有効）
cd apps/web
pnpm dev

# ブラウザの開発者ツールを使用
```

### リモートデバッグ（MacからRaspberry Pi 5へ）

**MacからRaspberry Pi 5にSSH接続してデバッグ:**

```bash
# SSH接続
ssh raspi5  # または ssh denkon5sd02@192.168.128.131

# Dockerログの確認
cd /opt/RaspberryPiSystem_002
docker compose -f infrastructure/docker/docker-compose.server.yml logs api --tail=100

# Git操作
git pull origin main
git status

# コンテナの再起動
docker compose -f infrastructure/docker/docker-compose.server.yml restart api
```

詳細は [MacからRaspberry Pi 5へのSSH接続ガイド](./mac-ssh-access.md) を参照してください。

## トラブルシューティング

### 依存関係のエラー

```bash
# 依存関係を再インストール
rm -rf node_modules pnpm-lock.yaml
pnpm install
```

### データベース接続エラー

```bash
# Dockerコンテナの状態を確認
docker compose -f infrastructure/docker/docker-compose.server.yml ps

# データベースログを確認
docker compose -f infrastructure/docker/docker-compose.server.yml logs db
```

### Prismaエラー

```bash
# Prismaクライアントを再生成
cd apps/api
pnpm prisma generate

# マイグレーションをリセット（開発環境のみ）
pnpm prisma migrate reset
```

詳細は [トラブルシューティングナレッジベース](../knowledge-base/troubleshooting-knowledge.md) を参照してください。

## 参考資料

- [API概要](../api/overview.md)
- [アーキテクチャ概要](../architecture/overview.md)
- [デプロイメントガイド](./deployment.md)
- [EXEC_PLAN.md](../../EXEC_PLAN.md)
