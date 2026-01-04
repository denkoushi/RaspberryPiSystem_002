#!/bin/bash
# ストレージメンテナンススクリプト
# 毎日実行され、不要なファイルを削除してストレージ使用量を最適化する
#
# 使用方法:
#   # 手動実行
#   /opt/RaspberryPiSystem_002/scripts/server/storage-maintenance.sh
#
#   # systemd timerで毎日実行（推奨）
#   # Ansibleで自動設定される

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
SIGNAGE_RENDER_DIR="${PROJECT_ROOT}/storage/signage-rendered"
ALERTS_DIR="${PROJECT_ROOT}/alerts"

log() {
  echo "[$(date +'%Y-%m-%d %H:%M:%S')] $1"
}

error_exit() {
  log "ERROR: $1"
  # アラートを生成
  if [ -f "${PROJECT_ROOT}/scripts/generate-alert.sh" ]; then
    "${PROJECT_ROOT}/scripts/generate-alert.sh" \
      "storage-maintenance-failed" \
      "ストレージメンテナンスが失敗しました" \
      "$1"
  fi
  exit 1
}

log "ストレージメンテナンスを開始します"

# 1. signage-renderedの履歴画像を削除（current.jpgは保持）
if [ -d "${SIGNAGE_RENDER_DIR}" ]; then
  log "signage-renderedディレクトリの履歴画像を削除中..."
  
  # current.jpgを除くsignage_*.jpgファイルを削除
  deleted_count=0
  if find "${SIGNAGE_RENDER_DIR}" -type f -name 'signage_*.jpg' 2>/dev/null | grep -q .; then
    deleted_count=$(find "${SIGNAGE_RENDER_DIR}" -type f -name 'signage_*.jpg' -delete -print | wc -l)
    log "履歴画像 ${deleted_count} 件を削除しました"
  else
    log "削除対象の履歴画像はありませんでした"
  fi
  
  # current.jpgが存在することを確認
  if [ ! -f "${SIGNAGE_RENDER_DIR}/current.jpg" ]; then
    log "WARNING: current.jpgが存在しません。サイネージ機能に影響する可能性があります"
  else
    log "current.jpgは正常に保持されています"
  fi
else
  log "WARNING: signage-renderedディレクトリが存在しません（${SIGNAGE_RENDER_DIR}）"
fi

# 2. Docker Build Cacheの削除（月初のみ）
CURRENT_DAY=$(date +%d)
if [ "${CURRENT_DAY}" = "01" ]; then
  log "月初のため、Docker Build Cacheを削除します"
  
  # 削除前の状態を確認
  before_size=$(docker builder du 2>/dev/null | tail -n 1 | awk '{print $NF}' || echo "0B")
  log "削除前のBuild Cacheサイズ: ${before_size}"
  
  # Build Cacheを削除（稼働中のコンテナには影響しない）
  if docker builder prune -a --force >/dev/null 2>&1; then
    after_size=$(docker builder du 2>/dev/null | tail -n 1 | awk '{print $NF}' || echo "0B")
    log "削除後のBuild Cacheサイズ: ${after_size}"
    log "Docker Build Cacheの削除が完了しました"
  else
    error_exit "Docker Build Cacheの削除に失敗しました"
  fi
else
  log "月初ではないため、Docker Build Cacheの削除をスキップします（日: ${CURRENT_DAY}）"
fi

# 3. ディスク使用量を確認
disk_usage=$(df -h / | awk 'NR==2 {print $5}' | sed 's/%//')
log "現在のディスク使用量: ${disk_usage}%"

if [ "${disk_usage}" -gt 90 ]; then
  log "WARNING: ディスク使用量が90%を超えています（${disk_usage}%）"
elif [ "${disk_usage}" -gt 80 ]; then
  log "WARNING: ディスク使用量が80%を超えています（${disk_usage}%）"
fi

log "ストレージメンテナンスが完了しました"

