#!/bin/bash
set -e

CONTAINER_NAME="postgres-test-local"

if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo "PostgreSQLコンテナを停止・削除中..."
  docker stop "${CONTAINER_NAME}" >/dev/null 2>&1 || true
  docker rm "${CONTAINER_NAME}" >/dev/null 2>&1 || true
  echo "完了しました"
else
  echo "コンテナ '${CONTAINER_NAME}' は存在しません"
fi

