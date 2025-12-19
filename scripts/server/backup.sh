#!/bin/bash
set -e

# バックアップスクリプト
# 使用方法: ./scripts/server/backup.sh
#
# バックアップ対象:
# - PostgreSQLデータベース
# - 環境変数ファイル（.env）
# - 写真ディレクトリ
#
# バックアップ先:
# - ローカルディレクトリ: /opt/backups/
# - Dropbox（設定ファイルで有効化されている場合）: /backups/

BACKUP_DIR="/opt/backups"
PROJECT_DIR="/opt/RaspberryPiSystem_002"
COMPOSE_FILE="${PROJECT_DIR}/infrastructure/docker/docker-compose.server.yml"
API_URL="http://localhost:8080/api"
DATE=$(date +%Y%m%d_%H%M%S)
RETENTION_DAYS=30

# バックアップディレクトリを作成
mkdir -p "${BACKUP_DIR}"

# APIが利用可能か確認
check_api_available() {
  if ! curl -f -s "${API_URL}/system/health" > /dev/null 2>&1; then
    echo "警告: APIが利用できません。ローカルバックアップのみ実行します。"
    return 1
  fi
  return 0
}

# API経由でバックアップを実行
backup_via_api() {
  local kind="$1"
  local source="$2"
  local label="${3:-}"
  
  local metadata="{}"
  if [ -n "${label}" ]; then
    metadata="{\"label\":\"${label}\"}"
  fi
  
  local response=$(curl -s -X POST "${API_URL}/backup/internal" \
    -H "Content-Type: application/json" \
    -d "{\"kind\":\"${kind}\",\"source\":\"${source}\",\"metadata\":${metadata}}" 2>&1)
  
  if echo "${response}" | grep -q '"success":true'; then
    echo "✅ ${kind}バックアップ成功（API経由）"
    echo "${response}" | grep -o '"path":"[^"]*"' | head -1 | cut -d'"' -f4 || true
    return 0
  else
    echo "❌ ${kind}バックアップ失敗（API経由）: ${response}"
    return 1
  fi
}

# データベースURLを取得
get_database_url() {
  # Docker Composeの環境変数から取得
  local db_url=$(docker compose -f "${COMPOSE_FILE}" config 2>/dev/null | grep -A 5 "DATABASE_URL:" | grep -o "postgresql://[^ ]*" | head -1 || echo "")
  
  if [ -z "${db_url}" ]; then
    # 環境変数ファイルから取得
    if [ -f "${PROJECT_DIR}/apps/api/.env" ]; then
      db_url=$(grep "^DATABASE_URL=" "${PROJECT_DIR}/apps/api/.env" | cut -d'=' -f2- | tr -d '"' || echo "")
    fi
  fi
  
  if [ -z "${db_url}" ]; then
    # デフォルト値
    db_url="postgresql://postgres:postgres@db:5432/borrow_return"
  fi
  
  echo "${db_url}"
}

# バックアップ実行
echo "=========================================="
echo "バックアップを開始します: $(date '+%Y-%m-%d %H:%M:%S')"
echo "=========================================="

# APIが利用可能か確認
USE_API=false
if check_api_available; then
  USE_API=true
  echo "✅ API経由でバックアップを実行します（Dropbox設定があれば自動的に使用されます）"
else
  echo "⚠️  ローカルバックアップのみ実行します"
fi

# 1. データベースバックアップ
echo ""
echo "1. データベースバックアップを開始..."
if [ "${USE_API}" = true ]; then
  DB_URL=$(get_database_url)
  if backup_via_api "database" "${DB_URL}" "backup-${DATE}"; then
    echo "   → API経由でバックアップ完了"
  else
    echo "   → API経由のバックアップに失敗、ローカルバックアップにフォールバック"
    USE_API=false
  fi
fi

if [ "${USE_API}" != true ]; then
  # ローカルバックアップ（従来の方法）
  docker compose -f "${COMPOSE_FILE}" exec -T db \
    pg_dump -U postgres --clean --if-exists borrow_return | gzip > "${BACKUP_DIR}/db_backup_${DATE}.sql.gz"
  echo "   → ローカルバックアップ完了: ${BACKUP_DIR}/db_backup_${DATE}.sql.gz"
  echo "   → バックアップサイズ: $(du -h "${BACKUP_DIR}/db_backup_${DATE}.sql.gz" | cut -f1)"
fi

# 2. 環境変数ファイルのバックアップ
echo ""
echo "2. 環境変数ファイルのバックアップを開始..."
if [ "${USE_API}" = true ]; then
  # API経由でバックアップ（file kindを使用）
  if [ -f "${PROJECT_DIR}/apps/api/.env" ]; then
    backup_via_api "file" "${PROJECT_DIR}/apps/api/.env" "api-env-${DATE}" || true
  fi
  if [ -f "${PROJECT_DIR}/apps/web/.env" ]; then
    backup_via_api "file" "${PROJECT_DIR}/apps/web/.env" "web-env-${DATE}" || true
  fi
  if [ -f "${PROJECT_DIR}/infrastructure/docker/.env" ]; then
    backup_via_api "file" "${PROJECT_DIR}/infrastructure/docker/.env" "docker-env-${DATE}" || true
  fi
  if [ -f "${PROJECT_DIR}/clients/nfc-agent/.env" ]; then
    backup_via_api "file" "${PROJECT_DIR}/clients/nfc-agent/.env" "nfc-agent-env-${DATE}" || true
  fi
fi

# ローカルバックアップも実行（API経由のバックアップが失敗した場合のフォールバック）
if [ -f "${PROJECT_DIR}/apps/api/.env" ]; then
  cp "${PROJECT_DIR}/apps/api/.env" "${BACKUP_DIR}/api_env_${DATE}.env" 2>/dev/null || true
fi
if [ -f "${PROJECT_DIR}/apps/web/.env" ]; then
  cp "${PROJECT_DIR}/apps/web/.env" "${BACKUP_DIR}/web_env_${DATE}.env" 2>/dev/null || true
fi
if [ -f "${PROJECT_DIR}/infrastructure/docker/.env" ]; then
  cp "${PROJECT_DIR}/infrastructure/docker/.env" "${BACKUP_DIR}/docker_env_${DATE}.env" 2>/dev/null || true
fi
if [ -f "${PROJECT_DIR}/clients/nfc-agent/.env" ]; then
  cp "${PROJECT_DIR}/clients/nfc-agent/.env" "${BACKUP_DIR}/nfc_agent_env_${DATE}.env" 2>/dev/null || true
fi

# 3. 写真ディレクトリのバックアップ
echo ""
echo "3. 写真ディレクトリのバックアップを開始..."
PHOTO_STORAGE_DIR="${PROJECT_DIR}/storage"
if [ -d "${PHOTO_STORAGE_DIR}/photos" ] || [ -d "${PHOTO_STORAGE_DIR}/thumbnails" ]; then
  if [ "${USE_API}" = true ]; then
    if backup_via_api "image" "photo-storage" "photos-${DATE}"; then
      echo "   → API経由でバックアップ完了"
    else
      echo "   → API経由のバックアップに失敗、ローカルバックアップにフォールバック"
      USE_API=false
    fi
  fi
  
  if [ "${USE_API}" != true ]; then
    # ローカルバックアップ（従来の方法）
    tar -czf "${BACKUP_DIR}/photos_backup_${DATE}.tar.gz" -C "${PHOTO_STORAGE_DIR}" photos thumbnails 2>/dev/null || {
      echo "警告: 写真ディレクトリのバックアップに失敗しました（スキップします）"
    }
    if [ -f "${BACKUP_DIR}/photos_backup_${DATE}.tar.gz" ]; then
      echo "   → ローカルバックアップ完了: ${BACKUP_DIR}/photos_backup_${DATE}.tar.gz"
      echo "   → バックアップサイズ: $(du -h "${BACKUP_DIR}/photos_backup_${DATE}.tar.gz" | cut -f1)"
    fi
  fi
else
  echo "   → 写真ディレクトリが見つかりません（スキップします）"
fi

# 4. CSVバックアップ（従業員・アイテム）
if [ "${USE_API}" = true ]; then
  echo ""
  echo "4. CSVバックアップを開始..."
  backup_via_api "csv" "employees" "employees-${DATE}" || true
  backup_via_api "csv" "items" "items-${DATE}" || true
fi

# 5. 古いバックアップを削除（30日以上前）
echo ""
echo "5. 古いバックアップを削除中..."
find "${BACKUP_DIR}" -name "*.gz" -mtime +${RETENTION_DAYS} -delete 2>/dev/null || true
find "${BACKUP_DIR}" -name "*.tar.gz" -mtime +${RETENTION_DAYS} -delete 2>/dev/null || true
find "${BACKUP_DIR}" -name "*.env" -mtime +${RETENTION_DAYS} -delete 2>/dev/null || true

echo ""
echo "=========================================="
echo "バックアップ完了: $(date '+%Y-%m-%d %H:%M:%S')"
echo "=========================================="
if [ -f "${BACKUP_DIR}/db_backup_${DATE}.sql.gz" ]; then
  echo "ローカルバックアップ: ${BACKUP_DIR}/db_backup_${DATE}.sql.gz"
  echo "バックアップサイズ: $(du -h "${BACKUP_DIR}/db_backup_${DATE}.sql.gz" | cut -f1)"
fi
if [ "${USE_API}" = true ]; then
  echo "API経由のバックアップ: 設定ファイル（/opt/RaspberryPiSystem_002/config/backup.json）でDropboxが有効化されている場合、自動的にDropboxにアップロードされます"
fi

