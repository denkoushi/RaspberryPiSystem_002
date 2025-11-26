#!/bin/bash
# バックアップ・リストアスクリプトのテスト
# 
# 目的: 実際の運用環境と同じ方法でバックアップ・リストア機能が正しく動作することを検証する
# 
# テストシナリオ（災害復旧を想定）:
#   1. テスト用DBを作成し、Prisma Migrateでスキーマを適用
#   2. テストデータ（Employee 2件）を挿入
#   3. 本番用backup.shを呼び出してフルダンプを作成
#   4. DBを削除して空のDBを再作成
#   5. 本番用restore.shを呼び出してフルダンプをリストア
#   6. データが復元されたことを確認
#
# 前提条件:
#   - CI環境: postgres-testコンテナが起動していること
#   - ローカル環境: docker compose up -d db で dbコンテナが起動していること

set -Eeuo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TEST_BACKUP_DIR="${PROJECT_DIR}/test-backups"
TEST_DB_NAME="test_borrow_return"

# DB接続URL（外部レビューで提案された標準モデルに基づく）
# ADMIN_DB_URL: CREATE/DROP DATABASE用（postgres DBに接続）
# TEST_DB_URL: migrate/INSERT/SELECT用（test_borrow_return DBに接続）
ADMIN_DB_URL="postgresql://postgres:postgres@localhost:5432/postgres"
TEST_DB_URL="postgresql://postgres:postgres@localhost:5432/${TEST_DB_NAME}"

echo "=========================================="
echo "バックアップ・リストアスクリプトのテスト"
echo "=========================================="
echo "テストシナリオ: 災害復旧（空DBへのフルダンプリストア）"
echo ""

# テスト用のバックアップディレクトリを作成
mkdir -p "${TEST_BACKUP_DIR}"

# Docker Composeファイルのパス
COMPOSE_FILE="${PROJECT_DIR}/infrastructure/docker/docker-compose.server.yml"

# 環境検出とDB接続コマンドの設定
if docker ps | grep -q "postgres-test"; then
  DB_CONTAINER="postgres-test"
  ADMIN_PSQL() { docker exec ${DB_CONTAINER} psql -U postgres "$@"; }
  TEST_PSQL() { docker exec ${DB_CONTAINER} psql -U postgres -d ${TEST_DB_NAME} "$@"; }
  echo "✓ CI環境を検出: postgres-testコンテナを使用"
elif docker compose -f "${COMPOSE_FILE}" ps db 2>/dev/null | grep -q "Up"; then
  DB_CONTAINER="db"
  ADMIN_PSQL() { docker compose -f "${COMPOSE_FILE}" exec -T db psql -U postgres "$@"; }
  TEST_PSQL() { docker compose -f "${COMPOSE_FILE}" exec -T db psql -U postgres -d ${TEST_DB_NAME} "$@"; }
  echo "✓ ローカル環境を検出: docker-composeのdbコンテナを使用"
else
  echo "✗ エラー: データベースコンテナが起動していません"
  exit 1
fi

# クリーンアップ関数（環境検出後に定義）
cleanup() {
  echo ""
  echo "クリーンアップ中..."
  rm -rf "${TEST_BACKUP_DIR}" 2>/dev/null || true
  ADMIN_PSQL -c "DROP DATABASE IF EXISTS ${TEST_DB_NAME};" 2>/dev/null || true
}

# エラー時にクリーンアップを実行
trap cleanup EXIT

echo ""
echo "─────────────────────────────────────────"
echo "Step 1: テスト用データベースの作成"
echo "─────────────────────────────────────────"

# 既存のテストDBがあれば削除し、新規に作成（ADMIN_DB_URL経由）
ADMIN_PSQL -c "DROP DATABASE IF EXISTS ${TEST_DB_NAME};" 2>/dev/null || true
ADMIN_PSQL -c "CREATE DATABASE ${TEST_DB_NAME};"
echo "✓ データベース ${TEST_DB_NAME} を作成しました"

echo ""
echo "─────────────────────────────────────────"
echo "Step 2: スキーマの適用（Prismaマイグレーション）"
echo "─────────────────────────────────────────"

# Prismaマイグレーションを使って、test_borrow_return に本番と同じスキーマを作成
echo "Prismaマイグレーションを実行中..."
cd "${PROJECT_DIR}/apps/api"
if ! DATABASE_URL="${TEST_DB_URL}" pnpm prisma migrate deploy; then
  echo "✗ エラー: Prismaマイグレーションに失敗しました"
  exit 1
fi
cd "${PROJECT_DIR}"

# テーブル確認（マイグレーションでEmployeeテーブルが作成されていることを前提）
if ! TEST_PSQL -c 'SELECT COUNT(*) FROM "Employee";' > /dev/null 2>&1; then
  echo "✗ エラー: Employeeテーブルが存在しません（マイグレーション結果を要確認）"
  echo "現在のpublicスキーマのテーブル一覧:"
  TEST_PSQL -c "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';" || true
  exit 1
fi
echo "✓ スキーマを適用しました（Prismaマイグレーション）"

echo ""
echo "─────────────────────────────────────────"
echo "Step 3: テストデータの挿入"
echo "─────────────────────────────────────────"

# テストデータを挿入（TEST_DB_URL経由）
TEST_PSQL -v ON_ERROR_STOP=1 <<'EOSQL'
INSERT INTO "Employee" (id, "employeeCode", "displayName", status, "createdAt", "updatedAt")
VALUES 
  ('00000000-0000-0000-0000-000000000001', '9999', 'テスト従業員1', 'ACTIVE', NOW(), NOW()),
  ('00000000-0000-0000-0000-000000000002', '9998', 'テスト従業員2', 'ACTIVE', NOW(), NOW());
EOSQL

# データ確認（2件入っていることを前提に検証）
DATA_COUNT=$(TEST_PSQL -t -c \
  "SELECT COUNT(*) FROM \"Employee\" WHERE \"employeeCode\" IN ('9999','9998');" | tr -d ' ')
if [ "${DATA_COUNT}" != "2" ]; then
  echo "✗ エラー: テストデータの挿入に失敗しました（期待: 2件, 実際: ${DATA_COUNT}件）"
  echo "現在のEmployeeテーブル内容:"
  TEST_PSQL -c 'TABLE "Employee";' || true
  exit 1
fi
echo "✓ テストデータを挿入しました（${DATA_COUNT}件）"

echo ""
echo "─────────────────────────────────────────"
echo "Step 4: バックアップ（本番用backup.shを呼び出し）"
echo "─────────────────────────────────────────"

BACKUP_FILE="${TEST_BACKUP_DIR}/db_backup_test.sql.gz"

# 本番用backup.shを呼び出し（環境変数でDB名とファイルパスを指定）
DB_NAME="${TEST_DB_NAME}" \
BACKUP_FILE="${BACKUP_FILE}" \
DB_CONTAINER="${DB_CONTAINER}" \
COMPOSE_FILE="${COMPOSE_FILE}" \
PROJECT_DIR="${PROJECT_DIR}" \
BACKUP_FILE_SPECIFIED=1 \
bash "${PROJECT_DIR}/scripts/server/backup.sh"

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
ADMIN_PSQL -c "DROP DATABASE IF EXISTS ${TEST_DB_NAME};"
ADMIN_PSQL -c "CREATE DATABASE ${TEST_DB_NAME};"

# 空であることを確認
TABLE_COUNT=$(TEST_PSQL -t -c \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';" | tr -d ' ')
if [ "${TABLE_COUNT}" != "0" ]; then
  echo "✗ エラー: データベースが空ではありません（テーブル数: ${TABLE_COUNT}）"
  exit 1
fi
echo "✓ 空のデータベースを再作成しました"

echo ""
echo "─────────────────────────────────────────"
echo "Step 6: リストア（本番用restore.shを呼び出し）"
echo "─────────────────────────────────────────"

# 本番用restore.shを呼び出し（環境変数でDB名とファイルパスを指定、確認をスキップ）
DB_NAME="${TEST_DB_NAME}" \
BACKUP_FILE="${BACKUP_FILE}" \
DB_CONTAINER="${DB_CONTAINER}" \
COMPOSE_FILE="${COMPOSE_FILE}" \
PROJECT_DIR="${PROJECT_DIR}" \
SKIP_CONFIRM=yes \
bash "${PROJECT_DIR}/scripts/server/restore.sh"

echo "✓ リストアを実行しました"

echo ""
echo "─────────────────────────────────────────"
echo "Step 7: データの検証"
echo "─────────────────────────────────────────"

# テーブルが復元されたか確認（直接SELECTして存在を確認）
if ! TEST_PSQL -c 'SELECT COUNT(*) FROM "Employee";' > /dev/null 2>&1; then
  echo "✗ エラー: Employeeテーブルが復元されていません（SELECTに失敗）"
  echo "現在のpublicスキーマのテーブル一覧:"
  TEST_PSQL -c "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';" || true
  exit 1
fi
echo "✓ スキーマが復元されました"

# データが復元されたか確認
RESTORED_COUNT=$(TEST_PSQL -t -c \
  "SELECT COUNT(*) FROM \"Employee\" WHERE \"employeeCode\" IN ('9999', '9998');" | tr -d ' ')

if [ "${RESTORED_COUNT}" != "2" ]; then
  echo "✗ エラー: データが復元されていません（期待: 2件, 実際: ${RESTORED_COUNT}件）"
  echo "現在のEmployeeテーブル内容:"
  TEST_PSQL -c 'TABLE "Employee";' || true
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
echo "  - 本番用backup.shでフルダンプを作成"
echo "  - 空のDBに対して本番用restore.shでリストア"
echo "  - スキーマとデータが正しく復元されることを確認"
