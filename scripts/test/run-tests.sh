#!/bin/bash
set -e

# プロジェクトルートに移動
cd "$(dirname "$0")/../.."

# PostgreSQLコンテナが起動しているか確認
CONTAINER_NAME="postgres-test-local"
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo "PostgreSQLコンテナが起動していません。起動中..."
  bash scripts/test/start-postgres.sh
fi

# 環境変数を設定
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/borrow_return"
export JWT_ACCESS_SECRET="test-access-secret-1234567890"
export JWT_REFRESH_SECRET="test-refresh-secret-1234567890"

# Prismaマイグレーションを実行
echo "Prismaマイグレーションを実行中..."
cd apps/api
pnpm prisma migrate deploy

# テストを実行
echo "テストを実行中..."
pnpm test

echo "テスト完了！"

