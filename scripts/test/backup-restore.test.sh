#!/bin/bash
# バックアップ・リストアスクリプトのテスト
# 
# 目的: 実際の運用環境と同じ方法でバックアップ・リストア機能が正しく動作することを検証する
# 
# テストシナリオ（災害復旧を想定）:
#   1. テスト用DBを作成し、スキーマを適用
#   2. テストデータを挿入
#   3. フルダンプでバックアップ（本番と同じ方法）
#   4. DBを削除して空のDBを再作成
#   5. フルダンプをリストア（本番と同じ方法）
#   6. データが復元されたことを確認
#
# 前提条件:
#   - CI環境: postgres-testコンテナが起動していること
#   - ローカル環境: docker compose up -d db で dbコンテナが起動していること

set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TEST_BACKUP_DIR="${PROJECT_DIR}/test-backups"
TEST_DB_NAME="test_borrow_return"

echo "=========================================="
echo "バックアップ・リストアスクリプトのテスト"
echo "=========================================="
echo "テストシナリオ: 災害復旧（空DBへのフルダンプリストア）"
echo ""

# クリーンアップ関数
cleanup() {
  echo ""
  echo "クリーンアップ中..."
  rm -rf "${TEST_BACKUP_DIR}" 2>/dev/null || true
  ${DB_COMMAND} psql -U postgres -c "DROP DATABASE IF EXISTS ${TEST_DB_NAME};" 2>/dev/null || true
}

# エラー時にクリーンアップを実行
trap cleanup EXIT

# テスト用のバックアップディレクトリを作成
mkdir -p "${TEST_BACKUP_DIR}"

# Docker Composeファイルのパス
COMPOSE_FILE="${PROJECT_DIR}/infrastructure/docker/docker-compose.server.yml"

# 環境検出とDB接続コマンドの設定
if docker ps | grep -q "postgres-test"; then
  DB_CONTAINER="postgres-test"
  DB_COMMAND="docker exec ${DB_CONTAINER}"
  DB_COMMAND_INPUT="docker exec -i ${DB_CONTAINER}"
  echo "✓ CI環境を検出: postgres-testコンテナを使用"
elif docker compose -f "${COMPOSE_FILE}" ps db 2>/dev/null | grep -q "Up"; then
  DB_CONTAINER="db"
  DB_COMMAND="docker compose -f ${COMPOSE_FILE} exec -T db"
  DB_COMMAND_INPUT="docker compose -f ${COMPOSE_FILE} exec -T db"
  echo "✓ ローカル環境を検出: docker-composeのdbコンテナを使用"
else
  echo "✗ エラー: データベースコンテナが起動していません"
  exit 1
fi

echo ""
echo "─────────────────────────────────────────"
echo "Step 1: テスト用データベースの作成"
echo "─────────────────────────────────────────"

# 既存のテストDBがあれば削除
${DB_COMMAND} psql -U postgres -c "DROP DATABASE IF EXISTS ${TEST_DB_NAME};" 2>/dev/null || true
${DB_COMMAND} psql -U postgres -c "CREATE DATABASE ${TEST_DB_NAME};"
echo "✓ データベース ${TEST_DB_NAME} を作成しました"

echo ""
echo "─────────────────────────────────────────"
echo "Step 2: スキーマの適用（SQLで直接作成）"
echo "─────────────────────────────────────────"

# CI環境ではPrismaマイグレーションが動作しない場合があるため、
# 最小限のスキーマをSQLで直接作成する
${DB_COMMAND} psql -U postgres -d ${TEST_DB_NAME} <<'EOSQL'
-- 必要最小限のスキーマを作成（テスト用）
-- 本番環境ではPrismaマイグレーションを使用

-- Enum型の作成
DO $$ BEGIN
    CREATE TYPE "EmployeeStatus" AS ENUM ('ACTIVE', 'INACTIVE');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Employeeテーブルの作成
CREATE TABLE IF NOT EXISTS "Employee" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employeeCode" VARCHAR(50) NOT NULL,
    "displayName" VARCHAR(255) NOT NULL,
    "nfcTagUid" VARCHAR(100),
    "department" VARCHAR(255),
    "contact" VARCHAR(255),
    "status" "EmployeeStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Employee_employeeCode_key" UNIQUE ("employeeCode")
);
EOSQL

echo "✓ スキーマを適用しました"

# テーブル確認
TABLE_EXISTS=$(${DB_COMMAND} psql -U postgres -d ${TEST_DB_NAME} -t -c \
  "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'Employee');" | tr -d ' ')
if [ "${TABLE_EXISTS}" != "t" ]; then
  echo "✗ エラー: Employeeテーブルが作成されていません"
  exit 1
fi

echo ""
echo "─────────────────────────────────────────"
echo "Step 3: テストデータの挿入"
echo "─────────────────────────────────────────"

${DB_COMMAND} psql -U postgres -d ${TEST_DB_NAME} <<'EOSQL'
INSERT INTO "Employee" (id, "employeeCode", "displayName", status, "createdAt", "updatedAt")
VALUES 
  ('00000000-0000-0000-0000-000000000001', '9999', 'テスト従業員1', 'ACTIVE', NOW(), NOW()),
  ('00000000-0000-0000-0000-000000000002', '9998', 'テスト従業員2', 'ACTIVE', NOW(), NOW());
EOSQL

# データ確認
DATA_COUNT=$(${DB_COMMAND} psql -U postgres -d ${TEST_DB_NAME} -t -c \
  "SELECT COUNT(*) FROM \"Employee\";" | tr -d ' ')
echo "✓ テストデータを挿入しました（${DATA_COUNT}件）"

echo ""
echo "─────────────────────────────────────────"
echo "Step 4: バックアップ（pg_dump フルダンプ）"
echo "─────────────────────────────────────────"

BACKUP_FILE="${TEST_BACKUP_DIR}/db_backup_test.sql.gz"

# フルダンプを作成（本番と同じ方法: スキーマ + データ）
${DB_COMMAND} pg_dump -U postgres ${TEST_DB_NAME} | gzip > "${BACKUP_FILE}"

# バックアップファイルの検証
if [ ! -f "${BACKUP_FILE}" ]; then
  echo "✗ エラー: バックアップファイルが作成されませんでした"
  exit 1
fi

if ! gunzip -t "${BACKUP_FILE}" 2>/dev/null; then
  echo "✗ エラー: バックアップファイルが破損しています"
  exit 1
fi

BACKUP_SIZE=$(ls -lh "${BACKUP_FILE}" | awk '{print $5}')
echo "✓ バックアップを作成しました（サイズ: ${BACKUP_SIZE}）"

echo ""
echo "─────────────────────────────────────────"
echo "Step 5: データベースを空にして再作成"
echo "─────────────────────────────────────────"

# データベースを削除して再作成（災害復旧シナリオ: 空のDBに対してリストア）
${DB_COMMAND} psql -U postgres -c "DROP DATABASE IF EXISTS ${TEST_DB_NAME};"
${DB_COMMAND} psql -U postgres -c "CREATE DATABASE ${TEST_DB_NAME};"

# 空であることを確認
TABLE_COUNT=$(${DB_COMMAND} psql -U postgres -d ${TEST_DB_NAME} -t -c \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';" | tr -d ' ')
if [ "${TABLE_COUNT}" != "0" ]; then
  echo "✗ エラー: データベースが空ではありません（テーブル数: ${TABLE_COUNT}）"
  exit 1
fi
echo "✓ 空のデータベースを再作成しました"

echo ""
echo "─────────────────────────────────────────"
echo "Step 6: リストア（gunzip + psql）"
echo "─────────────────────────────────────────"

# フルダンプをリストア（本番と同じ方法）
# ON_ERROR_STOP=offにすることで、一部のエラーがあっても継続
gunzip -c "${BACKUP_FILE}" | ${DB_COMMAND_INPUT} psql -U postgres -d ${TEST_DB_NAME} --set ON_ERROR_STOP=off > /dev/null 2>&1

echo "✓ リストアを実行しました"

echo ""
echo "─────────────────────────────────────────"
echo "Step 7: データの検証"
echo "─────────────────────────────────────────"

# テーブルが復元されたか確認
TABLE_EXISTS=$(${DB_COMMAND} psql -U postgres -d ${TEST_DB_NAME} -t -c \
  "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'Employee');" | tr -d ' ')
if [ "${TABLE_EXISTS}" != "t" ]; then
  echo "✗ エラー: Employeeテーブルが復元されていません"
  exit 1
fi
echo "✓ スキーマが復元されました"

# データが復元されたか確認
RESTORED_COUNT=$(${DB_COMMAND} psql -U postgres -d ${TEST_DB_NAME} -t -c \
  "SELECT COUNT(*) FROM \"Employee\" WHERE \"employeeCode\" IN ('9999', '9998');" | tr -d ' ')

if [ "${RESTORED_COUNT}" != "2" ]; then
  echo "✗ エラー: データが復元されていません（期待: 2件, 実際: ${RESTORED_COUNT}件）"
  exit 1
fi
echo "✓ データが復元されました（${RESTORED_COUNT}件）"

echo ""
echo "=========================================="
echo "✅ テスト成功"
echo "=========================================="
echo "バックアップ・リストア機能が正しく動作することを確認しました"
echo ""
echo "検証内容:"
echo "  - pg_dump でフルダンプを作成"
echo "  - 空のDBに対して gunzip + psql でリストア"
echo "  - スキーマとデータが正しく復元されることを確認"
