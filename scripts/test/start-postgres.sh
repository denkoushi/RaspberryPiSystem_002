#!/bin/bash
set -e

CONTAINER_NAME="postgres-test-local"
PORT="${POSTGRES_PORT:-5432}"

# 既存のコンテナがあれば停止・削除
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo "既存のコンテナを停止・削除中..."
  docker stop "${CONTAINER_NAME}" >/dev/null 2>&1 || true
  docker rm "${CONTAINER_NAME}" >/dev/null 2>&1 || true
fi

echo "PostgreSQLコンテナを起動中..."
docker run -d \
  --name "${CONTAINER_NAME}" \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=borrow_return \
  -p "${PORT}:5432" \
  --health-cmd="pg_isready -U postgres" \
  --health-interval=10s \
  --health-timeout=5s \
  --health-retries=5 \
  postgres:15-alpine

echo "PostgreSQLの起動を待機中..."
timeout=60
elapsed=0
until docker exec "${CONTAINER_NAME}" pg_isready -U postgres 2>/dev/null; do
  if [ $elapsed -ge $timeout ]; then
    echo "PostgreSQLが${timeout}秒以内に起動しませんでした"
    docker logs "${CONTAINER_NAME}"
    exit 1
  fi
  echo "待機中... (${elapsed}/${timeout}秒)"
  sleep 2
  elapsed=$((elapsed + 2))
done

echo "PostgreSQLが起動しました！"
echo "コンテナ名: ${CONTAINER_NAME}"
echo "ポート: ${PORT}"

