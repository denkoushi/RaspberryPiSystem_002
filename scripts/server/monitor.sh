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
  local response=$(curl -s -w "\n%{http_code}" "${API_URL}/system/health" || echo "000")
  local body=$(echo "${response}" | head -n -1)
  local status_code=$(echo "${response}" | tail -n 1)

  if [ "${status_code}" != "200" ]; then
    log "ERROR: API health check failed (HTTP ${status_code})"
    return 1
  fi

  local status=$(echo "${body}" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
  if [ "${status}" != "ok" ]; then
    log "WARNING: API health check returned degraded status: ${status}"
    return 1
  fi

  log "INFO: API health check passed"
  return 0
}

check_docker_containers() {
  local containers=$(docker compose -f "${PROJECT_DIR}/infrastructure/docker/docker-compose.server.yml" ps --format json | jq -r '.[] | select(.State != "running") | .Name')

  if [ -n "${containers}" ]; then
    log "ERROR: Some containers are not running: ${containers}"
    return 1
  fi

  log "INFO: All Docker containers are running"
  return 0
}

check_disk_usage() {
  local usage=$(df -h / | awk 'NR==2 {print $5}' | sed 's/%//')
  if [ "${usage}" -gt 90 ]; then
    log "ERROR: Disk usage is above 90%: ${usage}%"
    return 1
  elif [ "${usage}" -gt 80 ]; then
    log "WARNING: Disk usage is above 80%: ${usage}%"
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

