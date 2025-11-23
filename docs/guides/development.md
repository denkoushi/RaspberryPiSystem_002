# 開発ガイド

## 開発環境セットアップ

### 必要な環境

- Node.js 18.18以上（推奨: 20.x）
- pnpm 9.x
- Python 3.11+
- Poetry
- Docker & Docker Compose

### セットアップ手順

```bash
# 1. リポジトリのクローン
git clone <repository-url>
cd RaspberryPiSystem_002

# 2. 依存関係のインストール
corepack enable
pnpm install
poetry install -C clients/nfc-agent

# 3. 環境変数の設定
cp apps/api/.env.example apps/api/.env
cp clients/nfc-agent/.env.example clients/nfc-agent/.env

# 4. データベースのセットアップ
cd apps/api
pnpm prisma migrate deploy
pnpm prisma db seed
```

## 開発ワークフロー

### 1. ブランチ作成

```bash
git checkout -b feature/your-feature-name
```

### 2. コード編集

- API: `apps/api/src/`
- Web UI: `apps/web/src/`
- 共通型: `packages/shared-types/src/`

### 3. ビルド確認

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

### 4. テスト実行

```bash
# APIテスト
cd apps/api
pnpm test

# Web UIテスト
cd apps/web
pnpm test
```

### 5. コミット・プッシュ

```bash
git add .
git commit -m "feat: your feature description"
git push origin feature/your-feature-name
```

## コーディング規約

### TypeScript

- 型定義を明示的に記述
- `any`の使用を避ける
- エラーハンドリングを適切に実装

### ファイル命名

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

### APIデバッグ

```bash
# ログ確認
docker compose -f infrastructure/docker/docker-compose.server.yml logs api

# コンテナ内でシェル実行
docker compose -f infrastructure/docker/docker-compose.server.yml exec api sh
```

### Web UIデバッグ

```bash
# 開発サーバー起動
cd apps/web
pnpm dev
```

## トラブルシューティング

詳細は [トラブルシューティングガイド](./troubleshooting.md) を参照してください。

## 関連ドキュメント

- [デプロイガイド](./deployment.md)
- [アーキテクチャ概要](../architecture/overview.md)
- [EXEC_PLAN.md](../../EXEC_PLAN.md)

