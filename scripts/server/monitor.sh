#!/bin/bash
set -e

# 監視スクリプト
# 使用方法: ./scripts/server/monitor.sh

PROJECT_DIR="/opt/RaspberryPiSystem_002"
API_URL="http://localhost:8080/api"
LOG_FILE="/var/log/system-monitor.log"
ALERT_EMAIL=""  # アラート送信先メールアドレス（設定されている場合）

# ログファイルのパスを決定（書き込み可能な場所を選択）
if [ -w "$(dirname "${LOG_FILE}")" ] 2>/dev/null; then
  # /var/logに書き込み権限がある場合
  LOG_FILE="/var/log/system-monitor.log"
elif [ -w "${HOME}" ] 2>/dev/null; then
  # ホームディレクトリに書き込み権限がある場合
  LOG_FILE="${HOME}/system-monitor.log"
else
  # どちらも書き込み不可の場合は一時ディレクトリを使用
  LOG_FILE="/tmp/system-monitor.log"
fi

# ログディレクトリを作成
mkdir -p "$(dirname "${LOG_FILE}")" 2>/dev/null || true

log() {
  local log_msg="[$(date '+%Y-%m-%d %H:%M:%S')] $1"
  echo "${log_msg}"
  echo "${log_msg}" >> "${LOG_FILE}" 2>/dev/null || true
}

check_api_health() {
  local response=$(curl -s -w "\n%{http_code}" "${API_URL}/system/health" 2>/dev/null || echo -e "\n000")
  local body=$(echo "${response}" | head -n -1)
  local status_code=$(echo "${response}" | tail -n 1)

  if [ "${status_code}" != "200" ]; then
    log "ERROR: API health check failed (HTTP ${status_code})"
    return 1
  fi

  # JSONからstatusフィールドを抽出（jqが使えない場合の代替方法）
  local status=$(echo "${body}" | grep -o '"status":"[^"]*"' | head -1 | cut -d'"' -f4)
  if [ -z "${status}" ]; then
    # jqが使える場合はjqを使用
    if command -v jq >/dev/null 2>&1; then
      status=$(echo "${body}" | jq -r '.status' 2>/dev/null || echo "")
    fi
  fi

  if [ "${status}" != "ok" ]; then
    log "WARNING: API health check returned degraded status: ${status:-unknown}"
    return 1
  fi

  log "INFO: API health check passed"
  return 0
}

check_docker_containers() {
  # jqが使える場合はJSON形式で、使えない場合はテキスト形式でチェック
  local stopped_containers=""
  if command -v jq >/dev/null 2>&1; then
    stopped_containers=$(docker compose -f "${PROJECT_DIR}/infrastructure/docker/docker-compose.server.yml" ps --format json 2>/dev/null | jq -r '.[] | select(.State != "running") | .Name' 2>/dev/null || echo "")
  else
    # jqが使えない場合は、docker compose psの出力から停止しているコンテナを検出
    stopped_containers=$(docker compose -f "${PROJECT_DIR}/infrastructure/docker/docker-compose.server.yml" ps 2>/dev/null | grep -v "Up" | grep -v "NAME" | awk '{print $1}' | grep -v "^$" || echo "")
  fi

  if [ -n "${stopped_containers}" ]; then
    log "ERROR: Some containers are not running: ${stopped_containers}"
    return 1
  fi

  log "INFO: All Docker containers are running"
  return 0
}

check_disk_usage() {
  local usage=$(df -h / | awk 'NR==2 {print $5}' | sed 's/%//')
  local alert_generated=false
  
  # 段階的な閾値で監視（10年運用対応）
  if [ "${usage}" -gt 90 ]; then
    log "ERROR: Disk usage is above 90%: ${usage}%"
    # アラートを生成（重複生成を避けるため、既存のアラートをチェック）
    if [ -f "${PROJECT_DIR}/scripts/generate-alert.sh" ]; then
      # 過去1時間以内に同じアラートが生成されていないか確認
      local recent_alerts=$(find "${PROJECT_DIR}/alerts" -name "alert-*.json" -mmin -60 2>/dev/null | \
        xargs grep -l "storage-usage-high" 2>/dev/null | wc -l || echo "0")
      if [ "${recent_alerts}" -eq 0 ]; then
        "${PROJECT_DIR}/scripts/generate-alert.sh" \
          "storage-usage-high" \
          "ディスク使用量が90%を超えています（クリティカル）" \
          "現在の使用量: ${usage}%。ストレージメンテナンスを確認してください。"
        alert_generated=true
      fi
    fi
    return 1
  elif [ "${usage}" -gt 80 ]; then
    log "ALERT: Disk usage is above 80%: ${usage}%"
    # アラートを生成（重複生成を避けるため、既存のアラートをチェック）
    if [ -f "${PROJECT_DIR}/scripts/generate-alert.sh" ]; then
      local recent_alerts=$(find "${PROJECT_DIR}/alerts" -name "alert-*.json" -mmin -60 2>/dev/null | \
        xargs grep -l "storage-usage-high" 2>/dev/null | wc -l || echo "0")
      if [ "${recent_alerts}" -eq 0 ]; then
        "${PROJECT_DIR}/scripts/generate-alert.sh" \
          "storage-usage-high" \
          "ディスク使用量が80%を超えています（アラート）" \
          "現在の使用量: ${usage}%。ストレージメンテナンスを確認してください。"
        alert_generated=true
      fi
    fi
    return 0
  elif [ "${usage}" -gt 70 ]; then
    log "WARNING: Disk usage is above 70%: ${usage}%"
    return 0
  fi

  log "INFO: Disk usage is normal: ${usage}%"
  return 0
}

check_memory_usage() {
  local mem_total=$(free | awk 'NR==2 {print $2}')
  local mem_used=$(free | awk 'NR==2 {print $3}')
  local mem_percent=$((mem_used * 100 / mem_total))

  if [ "${mem_percent}" -gt 90 ]; then
    log "ERROR: Memory usage is above 90%: ${mem_percent}%"
    return 1
  elif [ "${mem_percent}" -gt 80 ]; then
    log "WARNING: Memory usage is above 80%: ${mem_percent}%"
    return 0
  fi

  log "INFO: Memory usage is normal: ${mem_percent}%"
  return 0
}

# メイン処理
log "Starting system monitoring..."

ERRORS=0

check_api_health || ERRORS=$((ERRORS + 1))
check_docker_containers || ERRORS=$((ERRORS + 1))
check_disk_usage || ERRORS=$((ERRORS + 1))
check_memory_usage || ERRORS=$((ERRORS + 1))

if [ "${ERRORS}" -gt 0 ]; then
  log "ERROR: Monitoring detected ${ERRORS} issue(s)"
  if [ -n "${ALERT_EMAIL}" ]; then
    echo "System monitoring detected ${ERRORS} issue(s). Check ${LOG_FILE} for details." | \
      mail -s "System Alert" "${ALERT_EMAIL}" || true
  fi
  exit 1
else
  log "INFO: All checks passed"
  exit 0
fi

