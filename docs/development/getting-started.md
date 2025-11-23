# 開発者向けガイド

最終更新: 2025-01-XX

## 概要

本ドキュメントでは、Raspberry Pi System 002の開発環境のセットアップと開発手順を説明します。

## 前提条件

- Node.js 20以上
- pnpm 9以上
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
pnpm install
```

### 3. 環境変数の設定

```bash
# API環境変数
cp apps/api/.env.example apps/api/.env
# apps/api/.envを編集して、実際の値を設定
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

### テストの実行

```bash
# APIのテスト
cd apps/api
pnpm test

# すべてのテスト
pnpm -r test
```

### ビルド

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

## コードスタイル

### TypeScript

- ESLintとPrettierを使用
- 型安全性を重視
- 明示的な型注釈を推奨

### 命名規則

- **変数・関数**: camelCase
- **クラス**: PascalCase
- **定数**: UPPER_SNAKE_CASE
- **ファイル**: kebab-case（TypeScriptファイルはcamelCase）

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

## デバッグ

### APIサーバー

```bash
# ログレベルを変更
LOG_LEVEL=debug pnpm dev

# データベースクエリのログを有効化
DATABASE_LOG=true pnpm dev
```

### Webアプリケーション

```bash
# 開発モードで起動（ホットリロード有効）
pnpm dev

# ブラウザの開発者ツールを使用
```

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

## 参考資料

- [API概要](../api/overview.md)
- [アーキテクチャ概要](../architecture/overview.md)
- [デプロイメントガイド](../guides/deployment.md)

