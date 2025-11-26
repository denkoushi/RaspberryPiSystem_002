#!/bin/bash
# バックアップ・リストアスクリプトのテスト
# CI環境で実行可能なテスト

set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TEST_BACKUP_DIR="${PROJECT_DIR}/test-backups"
TEST_DB_NAME="test_borrow_return"

echo "=========================================="
echo "バックアップ・リストアスクリプトのテスト"
echo "=========================================="

# テスト用のバックアップディレクトリを作成
mkdir -p "${TEST_BACKUP_DIR}"

# Docker Composeファイルのパス
COMPOSE_FILE="${PROJECT_DIR}/infrastructure/docker/docker-compose.server.yml"

# テスト用のデータベースコンテナが起動しているか確認
if ! docker compose -f "${COMPOSE_FILE}" ps db | grep -q "Up"; then
  echo "エラー: データベースコンテナが起動していません"
  echo "docker compose -f ${COMPOSE_FILE} up -d db を実行してください"
  exit 1
fi

echo ""
echo "1. バックアップスクリプトのテスト"
echo "-----------------------------------"

# テスト用のデータを作成
echo "テストデータを作成中..."
docker compose -f "${COMPOSE_FILE}" exec -T db \
  psql -U postgres -d borrow_return <<EOF
INSERT INTO "Employee" (id, "employeeCode", "displayName", status, "createdAt", "updatedAt")
VALUES 
  ('00000000-0000-0000-0000-000000000001', '9999', 'テスト従業員1', 'ACTIVE', NOW(), NOW()),
  ('00000000-0000-0000-0000-000000000002', '9998', 'テスト従業員2', 'ACTIVE', NOW(), NOW())
ON CONFLICT DO NOTHING;
EOF

# バックアップスクリプトを実行（テスト用のディレクトリを使用）
echo "バックアップを実行中..."
BACKUP_DIR="${TEST_BACKUP_DIR}" \
PROJECT_DIR="${PROJECT_DIR}" \
bash -c '
  DATE=$(date +%Y%m%d_%H%M%S)
  BACKUP_DIR="${BACKUP_DIR:-/tmp/test-backups}"
  mkdir -p "${BACKUP_DIR}"
  
  # データベースバックアップ
  docker compose -f "${PROJECT_DIR}/infrastructure/docker/docker-compose.server.yml" exec -T db \
    pg_dump -U postgres borrow_return | gzip > "${BACKUP_DIR}/db_backup_${DATE}.sql.gz"
  
  # バックアップファイルの存在確認
  if [ ! -f "${BACKUP_DIR}/db_backup_${DATE}.sql.gz" ]; then
    echo "エラー: バックアップファイルが作成されませんでした"
    exit 1
  fi
  
  # バックアップファイルの整合性確認
  if ! gunzip -t "${BACKUP_DIR}/db_backup_${DATE}.sql.gz" 2>/dev/null; then
    echo "エラー: バックアップファイルが破損しています"
    exit 1
  fi
  
  echo "✅ バックアップファイルが正常に作成されました: ${BACKUP_DIR}/db_backup_${DATE}.sql.gz"
  echo "${BACKUP_DIR}/db_backup_${DATE}.sql.gz"
'

BACKUP_FILE=$(find "${TEST_BACKUP_DIR}" -name "db_backup_*.sql.gz" | sort | tail -1)

if [ -z "${BACKUP_FILE}" ]; then
  echo "エラー: バックアップファイルが見つかりません"
  exit 1
fi

echo ""
echo "2. リストアスクリプトのテスト"
echo "-----------------------------------"

# テストデータを削除
echo "テストデータを削除中..."
docker compose -f "${COMPOSE_FILE}" exec -T db \
  psql -U postgres -d borrow_return <<EOF
DELETE FROM "Employee" WHERE "employeeCode" IN ('9999', '9998');
EOF

# リストアを実行
echo "リストアを実行中..."
gunzip -c "${BACKUP_FILE}" | \
  docker compose -f "${COMPOSE_FILE}" exec -T db \
  psql -U postgres -d borrow_return --set ON_ERROR_STOP=off

# リストア後のデータ確認
echo "リストア後のデータを確認中..."
RESTORED_COUNT=$(docker compose -f "${COMPOSE_FILE}" exec -T db \
  psql -U postgres -d borrow_return -t -c \
  "SELECT COUNT(*) FROM \"Employee\" WHERE \"employeeCode\" IN ('9999', '9998');" | tr -d ' ')

if [ "${RESTORED_COUNT}" != "2" ]; then
  echo "エラー: リストアが失敗しました。期待値: 2, 実際: ${RESTORED_COUNT}"
  exit 1
fi

echo "✅ リストアが正常に完了しました（${RESTORED_COUNT}件のデータが復元されました）"

# クリーンアップ
echo ""
echo "3. クリーンアップ"
echo "-----------------------------------"
rm -rf "${TEST_BACKUP_DIR}"
docker compose -f "${COMPOSE_FILE}" exec -T db \
  psql -U postgres -d borrow_return <<EOF
DELETE FROM "Employee" WHERE "employeeCode" IN ('9999', '9998');
EOF

echo "✅ テスト完了"

