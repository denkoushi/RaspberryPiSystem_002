#!/bin/bash
set -e

# 暗号化バックアップのリストアスクリプト
# 使用方法: ./scripts/server/restore-encrypted.sh <バックアップファイルのパス>
# 
# 環境変数:
#   BACKUP_DECRYPTION_KEY: GPG秘密鍵のIDまたはパス（オプション、デフォルトは環境変数から読み込み）

if [ $# -lt 1 ]; then
  echo "使用方法: $0 <バックアップファイルのパス>"
  echo "例: $0 /opt/backups/db_backup_20250101_020000.sql.gz.gpg"
  exit 1
fi

BACKUP_FILE="$1"
PROJECT_DIR="/opt/RaspberryPiSystem_002"

if [ ! -f "${BACKUP_FILE}" ]; then
  echo "エラー: バックアップファイルが見つかりません: ${BACKUP_FILE}"
  exit 1
fi

# GPG鍵の確認
GPG_KEY="${BACKUP_DECRYPTION_KEY:-}"

# 暗号化ファイルかどうかを確認
if [[ "${BACKUP_FILE}" == *.gpg ]]; then
  if [ -z "${GPG_KEY}" ]; then
    echo "エラー: 暗号化されたバックアップファイルです。BACKUP_DECRYPTION_KEYを設定してください。"
    exit 1
  fi
  
  # 復号化
  DECRYPTED_FILE="${BACKUP_FILE%.gpg}"
  echo "バックアップファイルを復号化中..."
  gpg --decrypt --output "${DECRYPTED_FILE}" "${BACKUP_FILE}"
  BACKUP_FILE="${DECRYPTED_FILE}"
  echo "復号化完了: ${BACKUP_FILE}"
fi

echo "警告: この操作は既存のデータベースを上書きします。"
echo "バックアップファイル: ${BACKUP_FILE}"
read -p "続行しますか？ (yes/no): " CONFIRM

if [ "${CONFIRM}" != "yes" ]; then
  echo "リストアをキャンセルしました。"
  # 復号化したファイルを削除
  if [ -f "${DECRYPTED_FILE}" ]; then
    rm -f "${DECRYPTED_FILE}"
  fi
  exit 0
fi

# データベースをリストア
echo "データベースをリストア中..."
# --cleanオプションで既存のオブジェクトを削除してからリストア
if [[ "${BACKUP_FILE}" == *.gz ]]; then
  gunzip -c "${BACKUP_FILE}" | \
    docker compose -f "${PROJECT_DIR}/infrastructure/docker/docker-compose.server.yml" exec -T db \
    psql -U postgres -d borrow_return --set ON_ERROR_STOP=off
else
  docker compose -f "${PROJECT_DIR}/infrastructure/docker/docker-compose.server.yml" exec -T db \
    psql -U postgres -d borrow_return --set ON_ERROR_STOP=off < "${BACKUP_FILE}"
fi

# 復号化したファイルを削除（セキュリティのため）
if [ -f "${DECRYPTED_FILE}" ]; then
  rm -f "${DECRYPTED_FILE}"
  echo "復号化ファイルを削除しました。"
fi

echo "リストア完了"

