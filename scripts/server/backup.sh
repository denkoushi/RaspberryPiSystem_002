#!/bin/bash
set -e

# バックアップスクリプト
# 使用方法: ./scripts/server/backup.sh

BACKUP_DIR="/opt/backups"
PROJECT_DIR="/opt/RaspberryPiSystem_002"
DATE=$(date +%Y%m%d_%H%M%S)
RETENTION_DAYS=30

# バックアップディレクトリを作成
mkdir -p "${BACKUP_DIR}"

# データベースバックアップ
echo "データベースバックアップを開始..."
docker compose -f "${PROJECT_DIR}/infrastructure/docker/docker-compose.server.yml" exec -T db \
  pg_dump -U postgres borrow_return | gzip > "${BACKUP_DIR}/db_backup_${DATE}.sql.gz"

# 環境変数ファイルのバックアップ
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

echo "バックアップ完了: ${BACKUP_DIR}/db_backup_${DATE}.sql.gz"
echo "バックアップサイズ: $(du -h "${BACKUP_DIR}/db_backup_${DATE}.sql.gz" | cut -f1)"

