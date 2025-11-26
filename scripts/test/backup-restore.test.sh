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

# CI環境ではpostgres-testコンテナを使用、ローカル環境ではdocker-composeのdbコンテナを使用
if docker ps | grep -q "postgres-test"; then
  # CI環境: postgres-testコンテナを使用
  DB_CONTAINER="postgres-test"
  DB_COMMAND="docker exec ${DB_CONTAINER}"
  echo "CI環境を検出: postgres-testコンテナを使用します"
elif docker compose -f "${COMPOSE_FILE}" ps db 2>/dev/null | grep -q "Up"; then
  # ローカル環境: docker-composeのdbコンテナを使用
  DB_CONTAINER="db"
  DB_COMMAND="docker compose -f ${COMPOSE_FILE} exec -T db"
  echo "ローカル環境を検出: docker-composeのdbコンテナを使用します"
else
  echo "エラー: データベースコンテナが起動していません"
  echo "CI環境の場合: PostgreSQLコンテナが起動していることを確認してください"
  echo "ローカル環境の場合: docker compose -f ${COMPOSE_FILE} up -d db を実行してください"
  exit 1
fi

echo ""
echo "1. バックアップスクリプトのテスト"
echo "-----------------------------------"

# テスト用のデータを作成
echo "テストデータを作成中..."
${DB_COMMAND} \
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
  # CI環境とローカル環境の両方に対応
  if docker ps | grep -q "postgres-test"; then
    docker exec postgres-test pg_dump -U postgres borrow_return | gzip > "${BACKUP_DIR}/db_backup_${DATE}.sql.gz"
  else
    docker compose -f "${PROJECT_DIR}/infrastructure/docker/docker-compose.server.yml" exec -T db \
      pg_dump -U postgres borrow_return | gzip > "${BACKUP_DIR}/db_backup_${DATE}.sql.gz"
  fi
  
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
${DB_COMMAND} \
  psql -U postgres -d borrow_return <<EOF
DELETE FROM "Employee" WHERE "employeeCode" IN ('9999', '9998');
EOF

# リストアを実行
echo "リストアを実行中..."
gunzip -c "${BACKUP_FILE}" | \
  ${DB_COMMAND} \
  psql -U postgres -d borrow_return --set ON_ERROR_STOP=off

# リストア後のデータ確認
echo "リストア後のデータを確認中..."
RESTORED_COUNT=$(${DB_COMMAND} \
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
${DB_COMMAND} \
  psql -U postgres -d borrow_return <<EOF
DELETE FROM "Employee" WHERE "employeeCode" IN ('9999', '9998');
EOF

echo "✅ テスト完了"

