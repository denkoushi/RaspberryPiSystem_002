#!/bin/bash
set -e

# プロジェクトルートに移動
cd "$(dirname "$0")/../.."

# テスト用PostgreSQLのポート（既定: 5432）。開発用DBが5432を使っている場合に衝突するため、自動で回避する。
DEFAULT_TEST_PORT=5432
FALLBACK_TEST_PORT=55432

# 明示指定があればそれを尊重
if [ -z "${POSTGRES_PORT:-}" ]; then
  # 5432が既に利用中（特にdocker-db-1等のコンテナ）なら、衝突回避ポートに切り替える
  if docker ps --format '{{.Names}}\t{{.Ports}}' | grep -E "(:|->)${DEFAULT_TEST_PORT}" >/dev/null 2>&1; then
    export POSTGRES_PORT="${FALLBACK_TEST_PORT}"
  else
    export POSTGRES_PORT="${DEFAULT_TEST_PORT}"
  fi
fi

# PostgreSQLコンテナが起動しているか確認（POSTGRES_PORTを確定してから起動する）
CONTAINER_NAME="postgres-test-local"
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo "PostgreSQLコンテナが起動していません。起動中..."
  bash scripts/test/start-postgres.sh
fi

# 環境変数を設定
export DATABASE_URL="postgresql://postgres:postgres@localhost:${POSTGRES_PORT}/borrow_return"
export JWT_ACCESS_SECRET="test-access-secret-1234567890"
export JWT_REFRESH_SECRET="test-refresh-secret-1234567890"

# Prismaマイグレーションを実行
echo "Prismaマイグレーションを実行中..."
cd apps/api
pnpm prisma migrate deploy

# Prisma Clientを生成（schema変更時に必要）
echo "Prisma Clientを生成中..."
pnpm prisma generate

# テストを実行
echo "テストを実行中..."
pnpm test

echo "テスト完了！"

