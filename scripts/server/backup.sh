#!/bin/bash
set -e

# バックアップスクリプト
# 使用方法: ./scripts/server/backup.sh
# 環境変数でカスタマイズ可能:
#   DB_NAME: データベース名（デフォルト: borrow_return）
#   BACKUP_FILE: バックアップファイルのパス（デフォルト: 自動生成）
#   DB_CONTAINER: Dockerコンテナ名（デフォルト: db）
#   COMPOSE_FILE: docker-compose.ymlのパス

DB_NAME="${DB_NAME:-borrow_return}"
PROJECT_DIR="${PROJECT_DIR:-/opt/RaspberryPiSystem_002}"
COMPOSE_FILE="${COMPOSE_FILE:-${PROJECT_DIR}/infrastructure/docker/docker-compose.server.yml}"
DB_CONTAINER="${DB_CONTAINER:-db}"
RETENTION_DAYS=30

# バックアップファイルのパス決定
if [ -z "${BACKUP_FILE:-}" ]; then
  BACKUP_DIR="${BACKUP_DIR:-/opt/backups}"
  DATE=$(date +%Y%m%d_%H%M%S)
  BACKUP_FILE="${BACKUP_DIR}/db_backup_${DATE}.sql.gz"
  mkdir -p "${BACKUP_DIR}"
else
  mkdir -p "$(dirname "${BACKUP_FILE}")"
fi

# データベースバックアップ
echo "データベースバックアップを開始..."
echo "データベース: ${DB_NAME}"
echo "バックアップファイル: ${BACKUP_FILE}"

# CI環境ではpostgres-testコンテナを直接使用、ローカル環境ではdocker composeを使用
if docker ps --format '{{.Names}}' | grep -q "^${DB_CONTAINER}$"; then
  # CI環境: docker execで直接実行
  docker exec ${DB_CONTAINER} pg_dump -U postgres ${DB_NAME} | gzip > "${BACKUP_FILE}"
else
  # ローカル環境: docker compose execを使用
  docker compose -f "${COMPOSE_FILE}" exec -T ${DB_CONTAINER} \
    pg_dump -U postgres ${DB_NAME} | gzip > "${BACKUP_FILE}"
fi

# 環境変数ファイルのバックアップ（BACKUP_FILEが自動生成の場合のみ）
if [ -z "${BACKUP_FILE_SPECIFIED:-}" ] && [ -n "${BACKUP_DIR:-}" ]; then
  DATE=$(date +%Y%m%d_%H%M%S)
  if [ -f "${PROJECT_DIR}/apps/api/.env" ]; then
    cp "${PROJECT_DIR}/apps/api/.env" "${BACKUP_DIR}/api_env_${DATE}.env"
  fi
  if [ -f "${PROJECT_DIR}/apps/web/.env" ]; then
    cp "${PROJECT_DIR}/apps/web/.env" "${BACKUP_DIR}/web_env_${DATE}.env"
  fi
  if [ -f "${PROJECT_DIR}/clients/nfc-agent/.env" ]; then
    cp "${PROJECT_DIR}/clients/nfc-agent/.env" "${BACKUP_DIR}/nfc_agent_env_${DATE}.env"
  fi
  
  # 古いバックアップを削除（30日以上前）
  find "${BACKUP_DIR}" -name "*.gz" -mtime +${RETENTION_DAYS} -delete 2>/dev/null || true
  find "${BACKUP_DIR}" -name "*.env" -mtime +${RETENTION_DAYS} -delete 2>/dev/null || true
fi

echo "バックアップ完了: ${BACKUP_FILE}"
echo "バックアップサイズ: $(du -h "${BACKUP_FILE}" | cut -f1)"

