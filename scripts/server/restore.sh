#!/bin/bash
set -e

# リストアスクリプト
# 使用方法: ./scripts/server/restore.sh <バックアップファイルのパス>
# または: BACKUP_FILE=... DB_NAME=... ./scripts/server/restore.sh
# 環境変数でカスタマイズ可能:
#   DB_NAME: データベース名（デフォルト: borrow_return）
#   BACKUP_FILE: バックアップファイルのパス（引数または環境変数）
#   DB_CONTAINER: Dockerコンテナ名（デフォルト: db）
#   COMPOSE_FILE: docker-compose.ymlのパス
#   SKIP_CONFIRM: yes に設定すると確認をスキップ（CI環境用）

DB_NAME="${DB_NAME:-borrow_return}"
PROJECT_DIR="${PROJECT_DIR:-/opt/RaspberryPiSystem_002}"
COMPOSE_FILE="${COMPOSE_FILE:-${PROJECT_DIR}/infrastructure/docker/docker-compose.server.yml}"
DB_CONTAINER="${DB_CONTAINER:-db}"

# バックアップファイルのパス決定（引数 > 環境変数 > エラー）
if [ $# -ge 1 ]; then
  BACKUP_FILE="$1"
elif [ -n "${BACKUP_FILE:-}" ]; then
  # 環境変数から取得
  :
else
  echo "使用方法: $0 <バックアップファイルのパス>"
  echo "または: BACKUP_FILE=... $0"
  echo "例: $0 /opt/backups/db_backup_20250101_020000.sql.gz"
  exit 1
fi

if [ ! -f "${BACKUP_FILE}" ]; then
  echo "エラー: バックアップファイルが見つかりません: ${BACKUP_FILE}"
  exit 1
fi

# 確認プロンプト（CI環境ではスキップ）
if [ "${SKIP_CONFIRM:-}" != "yes" ]; then
  echo "警告: この操作は既存のデータベースを上書きします。"
  echo "データベース: ${DB_NAME}"
  echo "バックアップファイル: ${BACKUP_FILE}"
  read -p "続行しますか？ (yes/no): " CONFIRM
  
  if [ "${CONFIRM}" != "yes" ]; then
    echo "リストアをキャンセルしました。"
    exit 0
  fi
fi

# データベースをリストア
echo "データベースをリストア中..."
echo "データベース: ${DB_NAME}"
echo "バックアップファイル: ${BACKUP_FILE}"

# CI環境ではpostgres-testコンテナを直接使用、ローカル環境ではdocker composeを使用
if docker ps --format '{{.Names}}' | grep -q "^${DB_CONTAINER}$"; then
  # CI環境: docker exec -iで標準入力を受け取る
  gunzip -c "${BACKUP_FILE}" | docker exec -i ${DB_CONTAINER} psql -U postgres -d ${DB_NAME} --set ON_ERROR_STOP=off
else
  # ローカル環境: docker compose exec -Tを使用
  gunzip -c "${BACKUP_FILE}" | \
    docker compose -f "${COMPOSE_FILE}" exec -T ${DB_CONTAINER} \
    psql -U postgres -d ${DB_NAME} --set ON_ERROR_STOP=off
fi

echo "リストア完了"
