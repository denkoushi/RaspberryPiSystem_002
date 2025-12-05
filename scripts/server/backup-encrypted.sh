#!/bin/bash
set -e

# 暗号化バックアップスクリプト
# 使用方法: ./scripts/server/backup-encrypted.sh
# 
# 環境変数:
#   BACKUP_ENCRYPTION_KEY: GPG公開鍵のIDまたはパス（オプション、デフォルトは環境変数から読み込み）
#   BACKUP_OFFLINE_MOUNT: オフライン保存用のマウントポイント（オプション、例: /mnt/backup-usb）
#   BACKUP_RETENTION_DAYS: バックアップ保持日数（デフォルト: 30日）

BACKUP_DIR="/opt/backups"
PROJECT_DIR="/opt/RaspberryPiSystem_002"
DATE=$(date +%Y%m%d_%H%M%S)
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
OFFLINE_MOUNT="${BACKUP_OFFLINE_MOUNT:-/mnt/backup-usb}"

# GPG公開鍵のIDまたはパス（環境変数から読み込み、またはデフォルト値）
GPG_RECIPIENT="${BACKUP_ENCRYPTION_KEY:-}"

# バックアップディレクトリを作成
mkdir -p "${BACKUP_DIR}"

# GPG鍵の確認
if [ -z "${GPG_RECIPIENT}" ]; then
  echo "警告: BACKUP_ENCRYPTION_KEYが設定されていません。"
  echo "暗号化なしでバックアップを続行しますか？ (yes/no): "
  read -r CONFIRM
  if [ "${CONFIRM}" != "yes" ]; then
    echo "バックアップをキャンセルしました。"
    exit 1
  fi
  ENCRYPT_ENABLED=false
else
  # GPG鍵の存在確認
  if ! gpg --list-keys "${GPG_RECIPIENT}" >/dev/null 2>&1; then
    echo "エラー: GPG鍵 '${GPG_RECIPIENT}' が見つかりません。"
    echo "暗号化なしでバックアップを続行しますか？ (yes/no): "
    read -r CONFIRM
    if [ "${CONFIRM}" != "yes" ]; then
      echo "バックアップをキャンセルしました。"
      exit 1
    fi
    ENCRYPT_ENABLED=false
  else
    ENCRYPT_ENABLED=true
  fi
fi

# データベースバックアップ
echo "データベースバックアップを開始..."
DB_BACKUP_FILE="${BACKUP_DIR}/db_backup_${DATE}.sql.gz"
docker compose -f "${PROJECT_DIR}/infrastructure/docker/docker-compose.server.yml" exec -T db \
  pg_dump -U postgres --clean --if-exists borrow_return | gzip > "${DB_BACKUP_FILE}"

# 暗号化（GPG鍵が設定されている場合）
if [ "${ENCRYPT_ENABLED}" = true ]; then
  echo "バックアップファイルを暗号化中..."
  gpg --encrypt --recipient "${GPG_RECIPIENT}" --trust-model always --output "${DB_BACKUP_FILE}.gpg" "${DB_BACKUP_FILE}"
  rm -f "${DB_BACKUP_FILE}"  # 暗号化後、元のファイルを削除
  DB_BACKUP_FILE="${DB_BACKUP_FILE}.gpg"
  echo "暗号化完了: ${DB_BACKUP_FILE}"
else
  echo "警告: 暗号化なしでバックアップを作成しました。"
fi

# 環境変数ファイルのバックアップ
ENV_BACKUP_FILES=()
if [ -f "${PROJECT_DIR}/apps/api/.env" ]; then
  ENV_FILE="${BACKUP_DIR}/api_env_${DATE}.env"
  cp "${PROJECT_DIR}/apps/api/.env" "${ENV_FILE}"
  if [ "${ENCRYPT_ENABLED}" = true ]; then
    gpg --encrypt --recipient "${GPG_RECIPIENT}" --trust-model always --output "${ENV_FILE}.gpg" "${ENV_FILE}"
    rm -f "${ENV_FILE}"
    ENV_FILE="${ENV_FILE}.gpg"
  fi
  ENV_BACKUP_FILES+=("${ENV_FILE}")
fi

if [ -f "${PROJECT_DIR}/apps/web/.env" ]; then
  ENV_FILE="${BACKUP_DIR}/web_env_${DATE}.env"
  cp "${PROJECT_DIR}/apps/web/.env" "${ENV_FILE}"
  if [ "${ENCRYPT_ENABLED}" = true ]; then
    gpg --encrypt --recipient "${GPG_RECIPIENT}" --trust-model always --output "${ENV_FILE}.gpg" "${ENV_FILE}"
    rm -f "${ENV_FILE}"
    ENV_FILE="${ENV_FILE}.gpg"
  fi
  ENV_BACKUP_FILES+=("${ENV_FILE}")
fi

if [ -f "${PROJECT_DIR}/clients/nfc-agent/.env" ]; then
  ENV_FILE="${BACKUP_DIR}/nfc_agent_env_${DATE}.env"
  cp "${PROJECT_DIR}/clients/nfc-agent/.env" "${ENV_FILE}"
  if [ "${ENCRYPT_ENABLED}" = true ]; then
    gpg --encrypt --recipient "${GPG_RECIPIENT}" --trust-model always --output "${ENV_FILE}.gpg" "${ENV_FILE}"
    rm -f "${ENV_FILE}"
    ENV_FILE="${ENV_FILE}.gpg"
  fi
  ENV_BACKUP_FILES+=("${ENV_FILE}")
fi

# 写真ディレクトリのバックアップ（存在する場合のみ）
PHOTO_STORAGE_DIR="${PROJECT_DIR}/storage"
PHOTO_BACKUP_FILE=""
if [ -d "${PHOTO_STORAGE_DIR}/photos" ] || [ -d "${PHOTO_STORAGE_DIR}/thumbnails" ]; then
  echo "写真ディレクトリのバックアップを開始..."
  PHOTO_BACKUP_FILE="${BACKUP_DIR}/photos_backup_${DATE}.tar.gz"
  tar -czf "${PHOTO_BACKUP_FILE}" -C "${PHOTO_STORAGE_DIR}" photos thumbnails 2>/dev/null || {
    echo "警告: 写真ディレクトリのバックアップに失敗しました（スキップします）"
    PHOTO_BACKUP_FILE=""
  }
  if [ -n "${PHOTO_BACKUP_FILE}" ] && [ -f "${PHOTO_BACKUP_FILE}" ]; then
    if [ "${ENCRYPT_ENABLED}" = true ]; then
      gpg --encrypt --recipient "${GPG_RECIPIENT}" --trust-model always --output "${PHOTO_BACKUP_FILE}.gpg" "${PHOTO_BACKUP_FILE}"
      rm -f "${PHOTO_BACKUP_FILE}"
      PHOTO_BACKUP_FILE="${PHOTO_BACKUP_FILE}.gpg"
    fi
    echo "写真バックアップ完了: ${PHOTO_BACKUP_FILE}"
    echo "写真バックアップサイズ: $(du -h "${PHOTO_BACKUP_FILE}" | cut -f1)"
  fi
fi

# オフライン保存用のUSBメモリ/外部HDDへのコピー
if [ -d "${OFFLINE_MOUNT}" ] && mountpoint -q "${OFFLINE_MOUNT}"; then
  echo "オフライン保存先へのコピーを開始..."
  OFFLINE_BACKUP_DIR="${OFFLINE_MOUNT}/backups"
  mkdir -p "${OFFLINE_BACKUP_DIR}"
  
  # データベースバックアップをコピー
  cp "${DB_BACKUP_FILE}" "${OFFLINE_BACKUP_DIR}/"
  
  # 環境変数ファイルをコピー
  for env_file in "${ENV_BACKUP_FILES[@]}"; do
    cp "${env_file}" "${OFFLINE_BACKUP_DIR}/"
  done
  
  # 写真バックアップをコピー（存在する場合）
  if [ -n "${PHOTO_BACKUP_FILE}" ] && [ -f "${PHOTO_BACKUP_FILE}" ]; then
    cp "${PHOTO_BACKUP_FILE}" "${OFFLINE_BACKUP_DIR}/"
  fi
  
  echo "オフライン保存完了: ${OFFLINE_BACKUP_DIR}"
else
  echo "警告: オフライン保存先（${OFFLINE_MOUNT}）がマウントされていません。スキップします。"
fi

# 古いバックアップを削除（保持日数を超えたもの）
echo "古いバックアップを削除中..."
find "${BACKUP_DIR}" -name "*.gz" -mtime +${RETENTION_DAYS} -delete 2>/dev/null || true
find "${BACKUP_DIR}" -name "*.tar.gz" -mtime +${RETENTION_DAYS} -delete 2>/dev/null || true
find "${BACKUP_DIR}" -name "*.env" -mtime +${RETENTION_DAYS} -delete 2>/dev/null || true
find "${BACKUP_DIR}" -name "*.gpg" -mtime +${RETENTION_DAYS} -delete 2>/dev/null || true

# オフライン保存先の古いバックアップも削除
if [ -d "${OFFLINE_MOUNT}" ] && mountpoint -q "${OFFLINE_MOUNT}"; then
  OFFLINE_BACKUP_DIR="${OFFLINE_MOUNT}/backups"
  if [ -d "${OFFLINE_BACKUP_DIR}" ]; then
    find "${OFFLINE_BACKUP_DIR}" -name "*.gz" -mtime +${RETENTION_DAYS} -delete 2>/dev/null || true
    find "${OFFLINE_BACKUP_DIR}" -name "*.tar.gz" -mtime +${RETENTION_DAYS} -delete 2>/dev/null || true
    find "${OFFLINE_BACKUP_DIR}" -name "*.env" -mtime +${RETENTION_DAYS} -delete 2>/dev/null || true
    find "${OFFLINE_BACKUP_DIR}" -name "*.gpg" -mtime +${RETENTION_DAYS} -delete 2>/dev/null || true
  fi
fi

echo "バックアップ完了: ${DB_BACKUP_FILE}"
echo "バックアップサイズ: $(du -h "${DB_BACKUP_FILE}" | cut -f1)"
if [ "${ENCRYPT_ENABLED}" = true ]; then
  echo "暗号化: 有効（GPG鍵: ${GPG_RECIPIENT}）"
else
  echo "暗号化: 無効"
fi

