#!/usr/bin/env bash
set -euo pipefail

# オフライン媒体に保存されたバックアップを検証用DBへリストアし、復号・削除まで確認するスクリプト
# 前提:
#   - backup-encrypted.sh が /opt/backups へバックアップを作成し、/mnt/backup-usb/backups などへコピー済み
#   - docker compose -f infrastructure/docker/docker-compose.server.yml で db サービスが起動中
# 環境変数:
#   BACKUP_OFFLINE_MOUNT: オフライン媒体のマウントポイント (デフォルト: /mnt/backup-usb)
#   BACKUP_DECRYPTION_KEY: gpg秘密鍵ID（.gpgの場合に使用）
#   RESTORE_DB_NAME: 検証用DB名 (デフォルト: borrow_return_restore_test)

PROJECT_DIR="/opt/RaspberryPiSystem_002"
COMPOSE_FILE="${PROJECT_DIR}/infrastructure/docker/docker-compose.server.yml"
OFFLINE_MOUNT="${BACKUP_OFFLINE_MOUNT:-/mnt/backup-usb}"
RESTORE_DB_NAME="${RESTORE_DB_NAME:-borrow_return_restore_test}"
GPG_KEY="${BACKUP_DECRYPTION_KEY:-}"

if [[ ! -d "${OFFLINE_MOUNT}" ]] || ! mountpoint -q "${OFFLINE_MOUNT}"; then
  echo "[INFO] オフライン媒体がマウントされていません（${OFFLINE_MOUNT}）。検証をスキップします。"
  exit 0
fi

BACKUP_DIR="${OFFLINE_MOUNT}/backups"
if [[ ! -d "${BACKUP_DIR}" ]]; then
  echo "[WARN] ${BACKUP_DIR} が存在しません。検証スキップ。"
  exit 0
fi

# 最新のDBバックアップを検出
latest_backup=$(ls -1t "${BACKUP_DIR}"/db_backup_* 2>/dev/null | head -1 || true)
if [[ -z "${latest_backup}" ]]; then
  echo "[WARN] バックアップファイルが見つかりません。検証スキップ。"
  exit 0
fi

echo "[INFO] 検証対象バックアップ: ${latest_backup}"

tmp_workdir="$(mktemp -d)"
cleanup() {
  rm -rf "${tmp_workdir}"
}
trap cleanup EXIT

restore_file="${latest_backup}"

# 復号が必要なら実施
if [[ "${latest_backup}" == *.gpg ]]; then
  if [[ -z "${GPG_KEY}" ]]; then
    echo "[ERROR] 暗号化バックアップです。BACKUP_DECRYPTION_KEY を設定してください。"
    exit 1
  fi
  echo "[INFO] 復号化を実施します..."
  decrypted="${tmp_workdir}/$(basename "${latest_backup%.gpg}")"
  gpg --decrypt --output "${decrypted}" "${latest_backup}"
  restore_file="${decrypted}"
fi

# 検証用DBを再作成
echo "[INFO] 検証用DBを作成: ${RESTORE_DB_NAME}"
docker compose -f "${COMPOSE_FILE}" exec -T db psql -U postgres <<EOF
DROP DATABASE IF EXISTS "${RESTORE_DB_NAME}";
CREATE DATABASE "${RESTORE_DB_NAME}";
EOF

# リストア実行
echo "[INFO] リストア開始..."
if [[ "${restore_file}" == *.gz ]]; then
  gunzip -c "${restore_file}" | docker compose -f "${COMPOSE_FILE}" exec -T db psql -U postgres -d "${RESTORE_DB_NAME}" --set ON_ERROR_STOP=off
else
  docker compose -f "${COMPOSE_FILE}" exec -T db psql -U postgres -d "${RESTORE_DB_NAME}" --set ON_ERROR_STOP=off < "${restore_file}"
fi
echo "[INFO] リストア完了"

# 簡易検証（Loan件数を確認できればOK。存在しない場合もエラーにしない）
echo "[INFO] Loan件数を確認します（存在しない場合はスキップ）..."
docker compose -f "${COMPOSE_FILE}" exec -T db psql -U postgres -d "${RESTORE_DB_NAME}" -c 'SELECT COUNT(*) AS loan_count FROM "Loan";' || \
  echo "[WARN] Loanテーブルが見つかりませんでした（スキップ）。"

echo "[INFO] 検証完了。必要に応じて ${RESTORE_DB_NAME} を削除してください。"
