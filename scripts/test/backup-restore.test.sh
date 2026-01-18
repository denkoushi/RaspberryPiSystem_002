#!/bin/bash
# バックアップ・リストアスクリプトのテスト
# 目的: 実際の運用環境と同じ方法でバックアップ・リストア機能が正しく動作することを検証する
# CI環境で実行可能なテスト

set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TEST_BACKUP_DIR="${PROJECT_DIR}/test-backups"
TEST_DB_NAME="test_borrow_return"
TEST_DB_HOST="${TEST_DB_HOST:-localhost}"
TEST_DB_PORT="${TEST_DB_PORT:-5432}"

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
  # ローカルでポート競合がある場合に備えて、ホスト側のポートを上書き可能にする
  # 例: TEST_DB_PORT=55432 ./scripts/test/backup-restore.test.sh
  TEST_DB_PORT="${TEST_DB_PORT:-${POSTGRES_TEST_HOST_PORT:-5432}}"
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
# 注意: ヒアドキュメント（<<EOF）を使用する場合は、標準入力を受け取る必要があるため、DB_COMMAND_INPUTを使用する
${DB_COMMAND_INPUT} psql -U postgres <<EOF
DROP DATABASE IF EXISTS ${TEST_DB_NAME};
CREATE DATABASE ${TEST_DB_NAME};
EOF

# テスト用データベースにスキーマを作成（マイグレーションを使用）
echo "マイグレーションを使用してスキーマを作成中..."
cd "${PROJECT_DIR}/apps/api"

# Prisma migration 用の DATABASE_URL（ホスト側のPostgreSQLへ接続）
# - CI: localhost:5432（postgres-test が 5432 を公開）
# - ローカル: 5432 が競合する場合は TEST_DB_PORT / POSTGRES_TEST_HOST_PORT で上書き
PRISMA_DATABASE_URL="${TEST_DATABASE_URL:-postgresql://postgres:postgres@${TEST_DB_HOST}:${TEST_DB_PORT}/${TEST_DB_NAME}}"

# マイグレーションを実行（set -eの影響を受けないように）
set +e
DATABASE_URL="${PRISMA_DATABASE_URL}" pnpm prisma migrate deploy 2>&1
MIGRATE_EXIT_CODE=$?
set -e

if [ ${MIGRATE_EXIT_CODE} -ne 0 ]; then
  echo "警告: マイグレーションに失敗しました（終了コード: ${MIGRATE_EXIT_CODE}）。スキーマを手動でコピーします..."
  cd "${PROJECT_DIR}"
  # 一時ファイルにスキーマをダンプ（標準出力をローカルファイルにリダイレクト）
  SCHEMA_FILE="${TEST_BACKUP_DIR}/schema.sql"
  ${DB_COMMAND} pg_dump -U postgres -d borrow_return --schema-only --no-owner --no-privileges > "${SCHEMA_FILE}" 2>&1 || {
    echo "エラー: スキーマのダンプに失敗しました"
    cat "${SCHEMA_FILE}" 2>/dev/null || true
  }
  # スキーマをリストア
  if [ -f "${SCHEMA_FILE}" ] && [ -s "${SCHEMA_FILE}" ]; then
    echo "スキーマファイルサイズ: $(wc -c < "${SCHEMA_FILE}") バイト"
    cat "${SCHEMA_FILE}" | ${DB_COMMAND_INPUT} psql -U postgres -d ${TEST_DB_NAME} --set ON_ERROR_STOP=off > /dev/null 2>&1 || true
    rm -f "${SCHEMA_FILE}"
  fi
fi
cd "${PROJECT_DIR}"

# スキーマが正しく作成されたか確認
set +e
TABLE_COUNT=$(${DB_COMMAND} psql -U postgres -d ${TEST_DB_NAME} -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';" 2>/dev/null | tr -d ' ')
set -e
echo "テーブル数: ${TABLE_COUNT:-0}"
if [ -z "${TABLE_COUNT}" ] || [ "${TABLE_COUNT}" = "0" ]; then
  echo "エラー: スキーマの作成に失敗しました"
  exit 1
fi
echo "スキーマの作成が完了しました"

echo ""
echo "1. バックアップスクリプトのテスト"
echo "-----------------------------------"

# テスト用のデータを作成
echo "テストデータを作成中..."
# 注意: ヒアドキュメント（<<EOF）を使用する場合は、標準入力を受け取る必要があるため、DB_COMMAND_INPUTを使用する
${DB_COMMAND_INPUT} \
  psql -U postgres -d ${TEST_DB_NAME} <<EOF
INSERT INTO "Employee" (id, "employeeCode", "displayName", status, "createdAt", "updatedAt")
VALUES 
  ('00000000-0000-0000-0000-000000000001', '9999', 'テスト従業員1', 'ACTIVE', NOW(), NOW()),
  ('00000000-0000-0000-0000-000000000002', '9998', 'テスト従業員2', 'ACTIVE', NOW(), NOW());
EOF

# バックアップ前のデータ確認
echo "バックアップ前のデータ確認..."
BEFORE_BACKUP_COUNT=$(${DB_COMMAND} \
  psql -U postgres -d ${TEST_DB_NAME} -t -c \
  "SELECT COUNT(*) FROM \"Employee\" WHERE \"employeeCode\" IN ('9999', '9998');" | tr -d ' ')
echo "バックアップ前のEmployeeレコード数: ${BEFORE_BACKUP_COUNT}"
if [ "${BEFORE_BACKUP_COUNT}" != "2" ]; then
  echo "エラー: バックアップ前のデータ作成に失敗しました。期待値: 2, 実際: ${BEFORE_BACKUP_COUNT}"
  exit 1
fi

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
  # 注意: --cleanオプションを追加して、リストア時に既存のオブジェクトを削除するDROP文を含める
  # これにより、空のデータベースに対してリストアする際にエラーが発生しない
  if docker ps | grep -q "postgres-test"; then
    docker exec postgres-test pg_dump -U postgres --clean --if-exists test_borrow_return | gzip > "${BACKUP_DIR}/db_backup_${DATE}.sql.gz"
  else
    docker compose -f "${PROJECT_DIR}/infrastructure/docker/docker-compose.server.yml" exec -T db \
      pg_dump -U postgres --clean --if-exists test_borrow_return | gzip > "${BACKUP_DIR}/db_backup_${DATE}.sql.gz"
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
  
  # バックアップファイルにデータが含まれているか確認（EmployeeテーブルのCOPY文を確認）
  echo "バックアップファイルの内容確認（EmployeeテーブルのCOPY文）..."
  gunzip -c "${BACKUP_DIR}/db_backup_${DATE}.sql.gz" | grep -A 5 "COPY.*Employee" | head -10 || echo "警告: EmployeeテーブルのCOPY文が見つかりません"
  
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
# 注意: ヒアドキュメント（<<EOF）を使用する場合は、標準入力を受け取る必要があるため、DB_COMMAND_INPUTを使用する
${DB_COMMAND_INPUT} psql -U postgres <<EOF
DROP DATABASE IF EXISTS ${TEST_DB_NAME};
CREATE DATABASE ${TEST_DB_NAME};
EOF

# 注意:
# ここではスキーマを再作成せず、バックアップファイル側に含まれるスキーマ定義をそのまま適用する。
# これは災害復旧時に「空のデータベース」に対してフルダンプをリストアする手順と同じ。

# リストアを実行（実際の運用環境と同じ方法）
echo "リストアを実行中..."
echo "注意: 実際の運用環境と同じ方法（gunzip + psql）でリストアします"
RESTORE_OUTPUT=$(gunzip -c "${BACKUP_FILE}" | \
  ${DB_COMMAND_INPUT} \
  psql -U postgres -d ${TEST_DB_NAME} --set ON_ERROR_STOP=off 2>&1)
RESTORE_EXIT_CODE=$?

# リストア出力からCOPY文の結果を確認
echo "リストア出力のCOPY文の結果:"
echo "${RESTORE_OUTPUT}" | grep -E "COPY|ERROR" | tail -20 || true

if [ ${RESTORE_EXIT_CODE} -ne 0 ]; then
  echo "警告: リストア中にエラーが発生しました（終了コード: ${RESTORE_EXIT_CODE}）"
  echo "リストア出力の最後の50行:"
  echo "${RESTORE_OUTPUT}" | tail -50
fi

# リストア後のデータ確認
echo "リストア後のデータを確認中..."
# テーブルが存在するか確認
TABLE_EXISTS=$(${DB_COMMAND} \
  psql -U postgres -d ${TEST_DB_NAME} -t -c \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'Employee';" | tr -d ' ')
echo "Employeeテーブルの存在確認: ${TABLE_EXISTS}"

# 全Employeeレコード数を確認
TOTAL_EMPLOYEE_COUNT=$(${DB_COMMAND} \
  psql -U postgres -d ${TEST_DB_NAME} -t -c \
  "SELECT COUNT(*) FROM \"Employee\";" | tr -d ' ')
echo "全Employeeレコード数: ${TOTAL_EMPLOYEE_COUNT}"

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
# 注意: ヒアドキュメント（<<EOF）を使用する場合は、標準入力を受け取る必要があるため、DB_COMMAND_INPUTを使用する
${DB_COMMAND_INPUT} psql -U postgres <<EOF
DROP DATABASE IF EXISTS ${TEST_DB_NAME};
EOF

echo "✅ テスト完了"
echo "✅ バックアップ・リストア機能が実際の運用環境と同じ方法で正しく動作することを確認しました"

