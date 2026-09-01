#!/usr/bin/env bash
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
PROJECT_ROOT="${STORAGE_MAINTENANCE_PROJECT_ROOT:-$(cd "${SCRIPT_DIR}/../.." && pwd)}"
SIGNAGE_RENDER_DIR="${STORAGE_MAINTENANCE_SIGNAGE_RENDER_DIR:-${PROJECT_ROOT}/storage/signage-rendered}"
RETENTION_HELPER="${STORAGE_MAINTENANCE_RETENTION_HELPER:-${SCRIPT_DIR}/docker-release-image-monthly.sh}"
DOCKER_BIN="${STORAGE_MAINTENANCE_DOCKER_BIN:-docker}"

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

alert_failure() {
  log "ERROR: $1"
  # アラートを生成するが、メンテナンスの残りの確認は継続する。
  if [ -f "${PROJECT_ROOT}/scripts/generate-alert.sh" ]; then
    if ! "${PROJECT_ROOT}/scripts/generate-alert.sh" \
      "storage-maintenance-failed" \
      "ストレージメンテナンスが失敗しました" \
      "$1"; then
      log "WARNING: 失敗アラートの生成にも失敗しました"
    fi
  fi
}

log "ストレージメンテナンスを開始します"

# 1. signage-renderedの履歴画像を削除（current.jpgは保持）
if [ -d "${SIGNAGE_RENDER_DIR}" ]; then
  log "signage-renderedディレクトリの履歴画像を削除中..."
  
  # current.jpgを除くsignage_*.jpgファイルを削除
  # 先にファイル数をカウントしてから削除（-deleteと-printの順序問題を回避）
  deleted_count=$(find "${SIGNAGE_RENDER_DIR}" -type f -name 'signage_*.jpg' 2>/dev/null | wc -l)
  if [ "${deleted_count}" -gt 0 ]; then
    find "${SIGNAGE_RENDER_DIR}" -type f -name 'signage_*.jpg' -delete 2>/dev/null || true
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

# 2. Docker旧リリースイメージの月次整理（月初に限らず、当月未完了なら日次再試行）
retention_status=0
if [ ! -x "${RETENTION_HELPER}" ]; then
  retention_status=1
  alert_failure "Docker旧リリース整理ヘルパーがありません: ${RETENTION_HELPER}"
elif "${RETENTION_HELPER}"; then
  :
else
  retention_status=$?
  log "ERROR: Docker旧リリース整理ヘルパーが失敗しました（ヘルパー側で既存アラート通知済み）"
fi

# 3. Docker Build Cacheの削除（月初のみ）
CURRENT_DAY="${STORAGE_MAINTENANCE_DAY:-$(TZ=Asia/Tokyo date +%d)}"
if [ "${CURRENT_DAY}" = "01" ]; then
  log "月初のため、Docker Build Cacheを削除します"
  
  # 削除前の状態を確認
  before_size=$("${DOCKER_BIN}" builder du 2>/dev/null | grep -E '^Total:' | awk '{print $2}' || echo "0B")
  if [ "${before_size}" = "0B" ]; then
    # フォールバック: 最後の行からサイズを取得
    before_size=$("${DOCKER_BIN}" builder du 2>/dev/null | tail -n 1 | awk '{print $NF}' || echo "0B")
  fi
  log "削除前のBuild Cacheサイズ: ${before_size}"
  
  # Build Cacheを削除（稼働中のコンテナには影響しない）
  if "${DOCKER_BIN}" builder prune -a --force >/dev/null 2>&1; then
    after_size=$("${DOCKER_BIN}" builder du 2>/dev/null | grep -E '^Total:' | awk '{print $2}' || echo "0B")
    if [ "${after_size}" = "0B" ]; then
      # フォールバック: 最後の行からサイズを取得
      after_size=$("${DOCKER_BIN}" builder du 2>/dev/null | tail -n 1 | awk '{print $NF}' || echo "0B")
    fi
    log "削除後のBuild Cacheサイズ: ${after_size}"
    log "Docker Build Cacheの削除が完了しました"
    log "Docker全体の使用量を確認します"
    "${DOCKER_BIN}" system df 2>&1 | while IFS= read -r line; do
      log "docker system df: ${line}"
    done
  else
    error_exit "Docker Build Cacheの削除に失敗しました"
  fi
else
  log "月初ではないため、Docker Build Cacheの削除をスキップします（日: ${CURRENT_DAY}）"
fi

# 4. ディスク使用量を確認
disk_usage=$(df -h / | awk 'NR==2 {print $5}' | sed 's/%//')
log "現在のディスク使用量: ${disk_usage}%"

if [ "${disk_usage}" -gt 90 ]; then
  log "WARNING: ディスク使用量が90%を超えています（${disk_usage}%）"
elif [ "${disk_usage}" -gt 80 ]; then
  log "WARNING: ディスク使用量が80%を超えています（${disk_usage}%）"
fi

if [ "${retention_status}" -ne 0 ]; then
  log "ERROR: Docker旧リリース整理の失敗を反映して、ストレージメンテナンスを失敗扱いにします"
  exit 1
fi

log "ストレージメンテナンスが完了しました"
