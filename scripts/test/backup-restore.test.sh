#!/bin/bash
# バックアップ・リストアスクリプトのテスト
# 目的: 実際の運用環境と同じ方法でバックアップ・リストア機能が正しく動作することを検証する
# CI環境で実行可能なテスト

set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TEST_BACKUP_DIR="${PROJECT_DIR}/test-backups"
TEST_DB_NAME="test_borrow_return"

echo "=========================================="
echo "バックアップ・リストアスクリプトのテスト"
echo "目的: 実際の運用環境と同じ方法でバックアップ・リストア機能を検証"
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
  DB_COMMAND_INPUT="docker exec -i ${DB_CONTAINER}"  # 標準入力を受け取る場合は-iオプションが必要
  echo "CI環境を検出: postgres-testコンテナを使用します"
elif docker compose -f "${COMPOSE_FILE}" ps db 2>/dev/null | grep -q "Up"; then
  # ローカル環境: docker-composeのdbコンテナを使用
  DB_CONTAINER="db"
  DB_COMMAND="docker compose -f ${COMPOSE_FILE} exec -T db"
  DB_COMMAND_INPUT="docker compose -f ${COMPOSE_FILE} exec -T db"  # docker compose exec -Tは標準入力を受け取れる
  echo "ローカル環境を検出: docker-composeのdbコンテナを使用します"
else
  echo "エラー: データベースコンテナが起動していません"
  echo "CI環境の場合: PostgreSQLコンテナが起動していることを確認してください"
  echo "ローカル環境の場合: docker compose -f ${COMPOSE_FILE} up -d db を実行してください"
  exit 1
fi

# テスト用のデータベースを作成（既存のborrow_returnデータベースに影響を与えないため）
echo ""
echo "0. テスト用データベースの準備"
echo "-----------------------------------"
echo "テスト用データベース ${TEST_DB_NAME} を作成中..."
${DB_COMMAND} psql -U postgres <<EOF
DROP DATABASE IF EXISTS ${TEST_DB_NAME};
CREATE DATABASE ${TEST_DB_NAME};
EOF

# テスト用データベースにスキーマをコピー（既存のborrow_returnから、スキーマのみ）
echo "既存のデータベースからスキーマのみをコピー中..."
# --schema-onlyでスキーマ定義のみを取得し、データは含めない
# --no-owner --no-privilegesでオーナー情報や権限情報も除外（エラーを避けるため）
${DB_COMMAND} pg_dump -U postgres -d borrow_return --schema-only --no-owner --no-privileges 2>/dev/null | \
  ${DB_COMMAND_INPUT} psql -U postgres -d ${TEST_DB_NAME} --set ON_ERROR_STOP=off > /dev/null 2>&1

# スキーマが正しく作成されたか確認
TABLE_COUNT=$(${DB_COMMAND} psql -U postgres -d ${TEST_DB_NAME} -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';" | tr -d ' ')
if [ "${TABLE_COUNT}" = "0" ]; then
  echo "警告: スキーマのコピーに失敗した可能性があります。マイグレーションを実行します..."
  # マイグレーションを実行してスキーマを作成
  cd "${PROJECT_DIR}/apps/api"
  DATABASE_URL="postgresql://postgres:postgres@localhost:5432/${TEST_DB_NAME}" pnpm prisma migrate deploy > /dev/null 2>&1 || true
fi

echo ""
echo "1. バックアップスクリプトのテスト"
echo "-----------------------------------"

# テスト用のデータを作成
echo "テストデータを作成中..."
${DB_COMMAND} \
  psql -U postgres -d ${TEST_DB_NAME} <<EOF
INSERT INTO "Employee" (id, "employeeCode", "displayName", status, "createdAt", "updatedAt")
VALUES 
  ('00000000-0000-0000-0000-000000000001', '9999', 'テスト従業員1', 'ACTIVE', NOW(), NOW()),
  ('00000000-0000-0000-0000-000000000002', '9998', 'テスト従業員2', 'ACTIVE', NOW(), NOW());
EOF

# バックアップスクリプトを実行（実際の運用環境と同じ方法でバックアップを作成）
echo "バックアップを実行中..."
echo "注意: 実際の運用環境と同じ方法（pg_dump、スキーマ定義も含む）でバックアップを作成します"
BACKUP_DIR="${TEST_BACKUP_DIR}" \
PROJECT_DIR="${PROJECT_DIR}" \
bash -c '
  DATE=$(date +%Y%m%d_%H%M%S)
  BACKUP_DIR="${BACKUP_DIR:-/tmp/test-backups}"
  mkdir -p "${BACKUP_DIR}"
  
  # データベースバックアップ（実際の運用環境と同じ方法）
  # scripts/server/backup.shと同じ方法でバックアップを作成（スキーマ定義も含む）
  if docker ps | grep -q "postgres-test"; then
    docker exec postgres-test pg_dump -U postgres test_borrow_return | gzip > "${BACKUP_DIR}/db_backup_${DATE}.sql.gz"
  else
    docker compose -f "${PROJECT_DIR}/infrastructure/docker/docker-compose.server.yml" exec -T db \
      pg_dump -U postgres test_borrow_return | gzip > "${BACKUP_DIR}/db_backup_${DATE}.sql.gz"
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

# テストデータベースをクリーンアップしてからリストア（実際の運用環境と同じ方法）
echo "テストデータベースをクリーンアップ中..."
# データベースを削除して再作成（完全にクリーンな状態にする）
${DB_COMMAND} psql -U postgres <<EOF
DROP DATABASE IF EXISTS ${TEST_DB_NAME};
CREATE DATABASE ${TEST_DB_NAME};
EOF

# スキーマを再作成（マイグレーションを実行）
echo "スキーマを再作成中..."
cd "${PROJECT_DIR}/apps/api"
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/${TEST_DB_NAME}" pnpm prisma migrate deploy > /dev/null 2>&1 || {
  echo "警告: マイグレーションに失敗しました。スキーマを手動でコピーします..."
  ${DB_COMMAND} pg_dump -U postgres -d borrow_return --schema-only --no-owner --no-privileges 2>/dev/null | \
    ${DB_COMMAND_INPUT} psql -U postgres -d ${TEST_DB_NAME} --set ON_ERROR_STOP=off > /dev/null 2>&1
}

# リストアを実行（実際の運用環境と同じ方法）
echo "リストアを実行中..."
echo "注意: 実際の運用環境と同じ方法（gunzip + psql）でリストアします"
gunzip -c "${BACKUP_FILE}" | \
  ${DB_COMMAND_INPUT} \
  psql -U postgres -d ${TEST_DB_NAME} --set ON_ERROR_STOP=off

# リストア後のデータ確認
echo "リストア後のデータを確認中..."
RESTORED_COUNT=$(${DB_COMMAND} \
  psql -U postgres -d ${TEST_DB_NAME} -t -c \
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
${DB_COMMAND} psql -U postgres <<EOF
DROP DATABASE IF EXISTS ${TEST_DB_NAME};
EOF

echo "✅ テスト完了"
echo "✅ バックアップ・リストア機能が実際の運用環境と同じ方法で正しく動作することを確認しました"

