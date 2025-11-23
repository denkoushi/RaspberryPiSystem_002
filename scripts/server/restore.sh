#!/bin/bash
set -e

# リストアスクリプト
# 使用方法: ./scripts/server/restore.sh <バックアップファイルのパス>

if [ $# -lt 1 ]; then
  echo "使用方法: $0 <バックアップファイルのパス>"
  echo "例: $0 /opt/backups/db_backup_20250101_020000.sql.gz"
  exit 1
fi

BACKUP_FILE="$1"
PROJECT_DIR="/opt/RaspberryPiSystem_002"

if [ ! -f "${BACKUP_FILE}" ]; then
  echo "エラー: バックアップファイルが見つかりません: ${BACKUP_FILE}"
  exit 1
fi

echo "警告: この操作は既存のデータベースを上書きします。"
echo "バックアップファイル: ${BACKUP_FILE}"
read -p "続行しますか？ (yes/no): " CONFIRM

if [ "${CONFIRM}" != "yes" ]; then
  echo "リストアをキャンセルしました。"
  exit 0
fi

# データベースをリストア
echo "データベースをリストア中..."
# --cleanオプションで既存のオブジェクトを削除してからリストア
gunzip -c "${BACKUP_FILE}" | \
  docker compose -f "${PROJECT_DIR}/infrastructure/docker/docker-compose.server.yml" exec -T db \
  psql -U postgres -d borrow_return --set ON_ERROR_STOP=off

echo "リストア完了"

