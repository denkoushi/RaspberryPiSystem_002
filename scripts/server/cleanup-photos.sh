#!/bin/bash
# 写真自動削除スクリプト
# 1月中に毎日チェックして、2年前のデータを削除する
#
# 使用方法:
#   # 手動実行
#   /opt/RaspberryPiSystem_002/scripts/server/cleanup-photos.sh
#
#   # cronで毎日実行（1月中のみ実行する場合）
#   0 2 1-31 1 * /opt/RaspberryPiSystem_002/scripts/server/cleanup-photos.sh >> /var/log/photo-cleanup.log 2>&1
#
#   # cronで毎日実行（毎日チェックして1月かどうかを判定）
#   0 2 * * * /opt/RaspberryPiSystem_002/scripts/server/cleanup-photos.sh >> /var/log/photo-cleanup.log 2>&1

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
COMPOSE_FILE="${PROJECT_ROOT}/infrastructure/docker/docker-compose.server.yml"

# 現在の月を取得
CURRENT_MONTH=$(date +%m)

# 1月でない場合は何もしない
if [ "${CURRENT_MONTH}" != "01" ]; then
  echo "[$(date +'%Y-%m-%d %H:%M:%S')] INFO: 現在は1月ではないため、写真削除処理をスキップします（月: ${CURRENT_MONTH}）"
  exit 0
fi

echo "[$(date +'%Y-%m-%d %H:%M:%S')] INFO: 写真自動削除処理を開始します"

# 2年前の年を計算
CURRENT_YEAR=$(date +%Y)
TARGET_YEAR=$((CURRENT_YEAR - 2))

echo "[$(date +'%Y-%m-%d %H:%M:%S')] INFO: ${TARGET_YEAR}年の写真を削除します"

# Dockerコンテナ内でTypeScriptスクリプトを実行
docker compose -f "${COMPOSE_FILE}" exec -T api sh -c "cd /app/apps/api && pnpm tsx src/scripts/cleanup-photos.ts" || {
  echo "[$(date +'%Y-%m-%d %H:%M:%S')] ERROR: 写真削除処理に失敗しました"
  exit 1
}

echo "[$(date +'%Y-%m-%d %H:%M:%S')] INFO: 写真自動削除処理が完了しました"

