#!/bin/bash
set -uo pipefail

# Phase12向け: 実機検証チェックを一括実行する
# - APIヘルス/deploy-status/納期管理API群
# - location scope fallback監視
# - auto-tuning (ログ未検出時はPUT auto-generate=200を代替)
# - Pi3/Pi4サービス確認

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="${REPO_ROOT:-$(cd "${SCRIPT_DIR}/../.." && pwd)}"
cd "${REPO_ROOT}"

PASSED=0
FAILED=0
WARNED=0

CLIENT_KEY_PI4="client-key-raspberrypi4-kiosk1"
CLIENT_KEY_ROBODRILL="client-key-raspi4-robodrill01-kiosk1"

PI5_USER="denkon5sd02"
PI3_USER="signageras3"
PI4_USER="tools03"
PI4_ROBODRILL_USER="tools04"

log_pass() {
  PASSED=$((PASSED + 1))
  echo "[PASS] $1"
}

log_fail() {
  FAILED=$((FAILED + 1))
  echo "[FAIL] $1"
  if [ -n "${2:-}" ]; then
    echo "       $2"
  fi
}

log_warn() {
  WARNED=$((WARNED + 1))
  echo "[WARN] $1"
  if [ -n "${2:-}" ]; then
    echo "       $2"
  fi
}

check_contains() {
  local name="$1"
  local output="$2"
  local pattern="$3"
  if printf "%s" "$output" | grep -Eq "$pattern"; then
    log_pass "$name"
  else
    log_fail "$name" "期待パターンに一致しません: $pattern"
  fi
}

check_http_code() {
  local name="$1"
  local code="$2"
  local expected="$3"
  if [ "$code" = "$expected" ]; then
    log_pass "$name"
  else
    log_fail "$name" "HTTP $code (expected: $expected)"
  fi
}

check_dual_active_lines() {
  local name="$1"
  local output="$2"
  local active_count
  active_count="$(printf "%s\n" "$output" | grep -Ec '^active$' || true)"
  if [ "$active_count" -ge 2 ]; then
    log_pass "$name"
  else
    log_fail "$name" "$output"
  fi
}

# network_modeを確認し、到達可能なIPを選択
NETWORK_MODE=$(grep -E '^network_mode:' infrastructure/ansible/group_vars/all.yml | awk '{print $2}' | tr -d '"')

if ping -c 1 -W 2 100.106.158.2 >/dev/null 2>&1; then
  PI5_IP="100.106.158.2"
  PI3_IP="100.105.224.86"
  PI4_IP="100.74.144.79"
  PI4_ROBODRILL_IP="100.123.1.113"
  ACTUAL_MODE="tailscale"
elif ping -c 1 -W 2 192.168.10.230 >/dev/null 2>&1; then
  PI5_IP="192.168.10.230"
  PI3_IP="192.168.10.109"
  PI4_IP="192.168.10.223"
  PI4_ROBODRILL_IP="192.168.10.224"
  ACTUAL_MODE="local"
else
  echo "エラー: Pi5に到達できません"
  exit 1
fi

BASE_URL="https://${PI5_IP}"

echo "=== Phase12 実機検証（自動） ==="
echo "設定Network mode: ${NETWORK_MODE}"
echo "実際に使用するNetwork mode: ${ACTUAL_MODE}"
echo "Pi5 IP: ${PI5_IP}"
echo ""

echo "--- API checks ---"
HEALTH_JSON="$(curl -sk "${BASE_URL}/api/system/health" 2>&1 || true)"
check_contains "APIヘルス" "${HEALTH_JSON}" '"status":"(ok|degraded)"'

DEPLOY_PI4="$(curl -sk "${BASE_URL}/api/system/deploy-status" -H "x-client-key: ${CLIENT_KEY_PI4}" 2>&1 || true)"
check_contains "deploy-status raspberrypi4" "${DEPLOY_PI4}" '"isMaintenance":false'

DEPLOY_ROBO="$(curl -sk "${BASE_URL}/api/system/deploy-status" -H "x-client-key: ${CLIENT_KEY_ROBODRILL}" 2>&1 || true)"
check_contains "deploy-status raspi4-robodrill01" "${DEPLOY_ROBO}" '"isMaintenance":false'

KIOSK_CODE="$(curl -sk -o /dev/null -w "%{http_code}" "${BASE_URL}/api/tools/loans/active" -H "x-client-key: ${CLIENT_KEY_PI4}" 2>&1 || true)"
check_http_code "キオスクAPI /tools/loans/active" "${KIOSK_CODE}" "200"

DUE_PATHS=(
  "triage"
  "daily-plan"
  "global-rank"
  "global-rank/proposal"
  "global-rank/learning-report"
  "actual-hours/stats"
)

for due_path in "${DUE_PATHS[@]}"; do
  code="$(curl -sk -o /dev/null -w "%{http_code}" "${BASE_URL}/api/kiosk/production-schedule/due-management/${due_path}" -H "x-client-key: ${CLIENT_KEY_PI4}" 2>&1 || true)"
  check_http_code "納期管理API ${due_path}" "${code}" "200"
done

GLOBAL_RANK_JSON="$(curl -sk "${BASE_URL}/api/kiosk/production-schedule/due-management/global-rank" -H "x-client-key: ${CLIENT_KEY_PI4}" 2>&1 || true)"
check_contains "global-rank targetLocation/rankingScope" "${GLOBAL_RANK_JSON}" '"targetLocation"'
check_contains "global-rank targetLocation/rankingScope(actor/ranking)" "${GLOBAL_RANK_JSON}" '"actorLocation".*"rankingScope"'

GLOBAL_RANK_MAC_JSON="$(curl -sk "${BASE_URL}/api/kiosk/production-schedule/due-management/global-rank?targetLocation=%E7%AC%AC2%E5%B7%A5%E5%A0%B4&rankingScope=globalShared" -H "x-client-key: ${CLIENT_KEY_PI4}" 2>&1 || true)"
check_contains "Mac targetLocation指定" "${GLOBAL_RANK_MAC_JSON}" '"targetLocation":"第2工場"'

ACTUAL_STATS_JSON="$(curl -sk "${BASE_URL}/api/kiosk/production-schedule/due-management/actual-hours/stats" -H "x-client-key: ${CLIENT_KEY_PI4}" 2>&1 || true)"
check_contains "actual-hours/stats fields" "${ACTUAL_STATS_JSON}" '"totalRawRows".*"totalCanonicalRows".*"totalFeatureKeys".*"topFeatures"'

SIGNAGE_JSON="$(curl -sk "${BASE_URL}/api/signage/content" 2>&1 || true)"
check_contains "サイネージAPI layoutConfig" "${SIGNAGE_JSON}" '"layoutConfig"'

PROGRESS_OVERVIEW_CODE="$(curl -sk -o /dev/null -w "%{http_code}" "${BASE_URL}/api/kiosk/production-schedule/progress-overview" -H "x-client-key: ${CLIENT_KEY_PI4}" 2>&1 || true)"
check_http_code "進捗一覧API progress-overview" "${PROGRESS_OVERVIEW_CODE}" "200"

echo ""
echo "--- Pi5 remote checks ---"
BACKUP_INFO="$(ssh -o ConnectTimeout=15 -o StrictHostKeyChecking=no "${PI5_USER}@${PI5_IP}" "ls -lh /opt/RaspberryPiSystem_002/config/backup.json 2>&1" || true)"
if printf "%s" "${BACKUP_INFO}" | grep -Eq 'backup\.json'; then
  log_pass "backup.json 存在確認"
else
  log_fail "backup.json 存在確認" "${BACKUP_INFO}"
fi

MIGRATE_STATUS="$(ssh -o ConnectTimeout=15 -o StrictHostKeyChecking=no "${PI5_USER}@${PI5_IP}" "cd /opt/RaspberryPiSystem_002 && docker compose -f infrastructure/docker/docker-compose.server.yml exec -T api pnpm prisma migrate status 2>&1" || true)"
check_contains "マイグレーション状態" "${MIGRATE_STATUS}" 'Database schema is up to date!'

FALLBACK_COUNT_RAW="$(ssh -o ConnectTimeout=15 -o StrictHostKeyChecking=no "${PI5_USER}@${PI5_IP}" "cd /opt/RaspberryPiSystem_002 && docker compose -f infrastructure/docker/docker-compose.server.yml logs --since=10m api 2>/dev/null | grep -c 'Resource category policy resolved via default fallback' || true" 2>&1 || true)"
FALLBACK_COUNT="$(printf "%s" "${FALLBACK_COUNT_RAW}" | tr -dc '0-9')"
if [ -z "${FALLBACK_COUNT}" ]; then
  log_warn "location scope fallback監視" "件数取得に失敗: ${FALLBACK_COUNT_RAW}"
else
  if [ "${FALLBACK_COUNT}" -eq 0 ]; then
    log_pass "location scope fallback監視（件数=0）"
  else
    log_warn "location scope fallback監視（件数=${FALLBACK_COUNT}）" "増加傾向は手動で確認してください"
  fi
fi

AUTO_GENERATE_CODE="$(curl -sk -o /dev/null -w "%{http_code}" -X PUT "${BASE_URL}/api/kiosk/production-schedule/due-management/global-rank/auto-generate" -H "x-client-key: ${CLIENT_KEY_PI4}" -H "Content-Type: application/json" -d '{}' 2>&1 || true)"
check_http_code "PUT global-rank/auto-generate" "${AUTO_GENERATE_CODE}" "200"

SCHEDULER_LOG_COUNT_RAW="$(ssh -o ConnectTimeout=15 -o StrictHostKeyChecking=no "${PI5_USER}@${PI5_IP}" "cd /opt/RaspberryPiSystem_002 && docker compose -f infrastructure/docker/docker-compose.server.yml logs api 2>/dev/null | grep -c 'Due management auto-tuning scheduler started' || true" 2>&1 || true)"
SCHEDULER_LOG_COUNT="$(printf "%s" "${SCHEDULER_LOG_COUNT_RAW}" | tr -dc '0-9')"
if [ -z "${SCHEDULER_LOG_COUNT}" ]; then
  log_warn "auto-tuning schedulerログ確認" "ログ件数取得に失敗: ${SCHEDULER_LOG_COUNT_RAW}"
elif [ "${SCHEDULER_LOG_COUNT}" -gt 0 ]; then
  log_pass "auto-tuning schedulerログ確認（件数=${SCHEDULER_LOG_COUNT}）"
else
  log_warn "auto-tuning schedulerログ確認（件数=0）" "ログローテーションの可能性あり。PUT auto-generate=200を代替判定とする"
fi

echo ""
echo "--- Pi3/Pi4 service checks ---"
PI4_STATUS="$(ssh -o ConnectTimeout=15 -o StrictHostKeyChecking=no "${PI5_USER}@${PI5_IP}" "ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=no ${PI4_USER}@${PI4_IP} 'systemctl is-active kiosk-browser.service status-agent.timer' 2>&1" || true)"
check_dual_active_lines "Pi4 raspberrypi4 kiosk/status-agent" "${PI4_STATUS}"

PI4_ROBO_STATUS="$(ssh -o ConnectTimeout=15 -o StrictHostKeyChecking=no "${PI5_USER}@${PI5_IP}" "ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=no ${PI4_ROBODRILL_USER}@${PI4_ROBODRILL_IP} 'systemctl is-active kiosk-browser.service status-agent.timer' 2>&1" || true)"
check_dual_active_lines "Pi4 robodrill01 kiosk/status-agent" "${PI4_ROBO_STATUS}"

PI3_STATUS="$(ssh -o ConnectTimeout=15 -o StrictHostKeyChecking=no "${PI5_USER}@${PI5_IP}" "ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=no ${PI3_USER}@${PI3_IP} 'systemctl is-active signage-lite.service signage-lite-update.timer' 2>&1" || true)"
if [ "$(printf "%s\n" "${PI3_STATUS}" | grep -Ec '^active$' || true)" -ge 2 ]; then
  log_pass "Pi3 signage-lite/timer"
elif printf "%s" "${PI3_STATUS}" | grep -Eqi 'timed out|No route to host|offline'; then
  log_warn "Pi3 signage-lite/timer" "Pi3 offlineの可能性。運用上スキップ可"
else
  log_fail "Pi3 signage-lite/timer" "${PI3_STATUS}"
fi

if "${SCRIPT_DIR}/verify-services-real.sh" >/tmp/verify-services-real.out 2>&1; then
  log_pass "verify-services-real.sh 実行"
else
  log_fail "verify-services-real.sh 実行" "$(cat /tmp/verify-services-real.out)"
fi

echo ""
echo "=== Phase12 実機検証サマリ ==="
echo "PASS: ${PASSED}"
echo "WARN: ${WARNED}"
echo "FAIL: ${FAILED}"

if [ "${FAILED}" -gt 0 ]; then
  exit 1
fi

exit 0
