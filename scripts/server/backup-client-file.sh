#!/bin/bash
set -e

# クライアント端末のファイルをAnsible経由でバックアップするスクリプト
# 使用方法: ./scripts/server/backup-client-file.sh <client_host> <file_path> <backup_destination>
#
# 例: ./scripts/server/backup-client-file.sh raspberrypi4 /opt/RaspberryPiSystem_002/clients/nfc-agent/.env /tmp/backup

CLIENT_HOST="${1}"
FILE_PATH="${2}"
BACKUP_DESTINATION="${3}"

if [ -z "${CLIENT_HOST}" ] || [ -z "${FILE_PATH}" ] || [ -z "${BACKUP_DESTINATION}" ]; then
  echo "Usage: $0 <client_host> <file_path> <backup_destination>"
  exit 1
fi

PROJECT_DIR="/opt/RaspberryPiSystem_002"
ANSIBLE_INVENTORY="${PROJECT_DIR}/infrastructure/ansible/inventory.yml"
ANSIBLE_PLAYBOOK="${PROJECT_DIR}/infrastructure/ansible/playbooks/backup-clients.yml"

# Ansible Playbookを実行
cd "${PROJECT_DIR}"
ansible-playbook \
  -i "${ANSIBLE_INVENTORY}" \
  "${ANSIBLE_PLAYBOOK}" \
  -e "client_host=${CLIENT_HOST}" \
  -e "client_file_path=${FILE_PATH}" \
  -e "backup_destination=${BACKUP_DESTINATION}"

# 出力ファイルのパスを表示
OUTPUT_FILE="${BACKUP_DESTINATION}/${CLIENT_HOST}_$(basename "${FILE_PATH}")"
if [ -f "${OUTPUT_FILE}" ]; then
  echo "${OUTPUT_FILE}"
else
  echo "Error: Backup file not found: ${OUTPUT_FILE}" >&2
  exit 1
fi
