#!/usr/bin/env bash
# Run the guarded monthly Docker release-image retention cycle.
#
# This coordinator intentionally contains no image-selection policy.  The
# Python helper owns state validation, allowlisting, candidate calculation, and
# Docker deletion; this script owns only the daily schedule boundary, locks,
# and the atomic month-completion marker.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="${STORAGE_MAINTENANCE_PROJECT_ROOT:-$(cd "${SCRIPT_DIR}/../.." && pwd)}"
STATE_FILE="${IMAGE_RETENTION_STATE_FILE:-${RETENTION_STATE_FILE:-/var/lib/raspi-release/image-retention.json}}"
STATE_DIR="${IMAGE_RETENTION_STATE_DIR:-$(dirname "${STATE_FILE}")}"
MARKER_FILE="${IMAGE_RETENTION_MARKER_FILE:-${RETENTION_COMPLETION_MARKER:-${STATE_DIR}/image-retention.last-success}}"
MAINTENANCE_LOCK="${IMAGE_RETENTION_LOCK_FILE:-${MAINTENANCE_LOCK_FILE:-${STATE_DIR}/image-retention-maintenance.lock}}"
FLEET_LOCK="${IMAGE_RETENTION_FLEET_DEPLOY_LOCK:-${FLEET_DEPLOY_LOCK_FILE:-${PROJECT_ROOT}/logs/deploy/fleet-release-state.lock}}"
HELPER="${IMAGE_RETENTION_SCRIPT:-${SCRIPT_DIR}/docker-release-image-maintenance.py}"
PYTHON_BIN="${IMAGE_RETENTION_PYTHON:-${PYTHON_COMMAND:-python3}}"
FLOCK_BIN="${IMAGE_RETENTION_FLOCK:-${FLOCK_COMMAND:-flock}}"
MINIMUM_AGE_HOURS="${IMAGE_RETENTION_MINIMUM_AGE_HOURS:-24}"
CURRENT_MONTH="${STORAGE_MAINTENANCE_MONTH:-$(TZ=Asia/Tokyo date +%Y-%m)}"
MARKER_STATE='missing'
MARKER_VALUE=''

log() {
  echo "[$(date +'%Y-%m-%d %H:%M:%S')] $1"
}

error_exit() {
  log "ERROR: $1"
  if [ -f "${PROJECT_ROOT}/scripts/generate-alert.sh" ]; then
    "${PROJECT_ROOT}/scripts/generate-alert.sh" \
      "storage-maintenance-failed" \
      "ストレージメンテナンスが失敗しました" \
      "$1"
  fi
  exit 1
}

validate_marker() {
  MARKER_STATE='missing'
  MARKER_VALUE=''
  if [[ ! -e "${MARKER_FILE}" && ! -L "${MARKER_FILE}" ]]; then
    return 0
  fi

  # Treat anything other than one regular, readable file containing exactly
  # YYYY-MM plus one LF as corruption.  In particular, do not accept a valid
  # first line followed by stale or attacker-controlled extra content.
  if [[ ! -f "${MARKER_FILE}" || -L "${MARKER_FILE}" || ! -r "${MARKER_FILE}" ]]; then
    MARKER_STATE='invalid'
    return 1
  fi
  local marker_size=''
  if ! marker_size="$(wc -c < "${MARKER_FILE}" | tr -d '[:space:]')"; then
    MARKER_STATE='invalid'
    return 1
  fi
  if [[ "${marker_size}" != '8' ]]; then
    MARKER_STATE='invalid'
    return 1
  fi
  if ! IFS= read -r MARKER_VALUE < "${MARKER_FILE}"; then
    MARKER_STATE='invalid'
    MARKER_VALUE=''
    return 1
  fi
  if [[ ! "${MARKER_VALUE}" =~ ^[0-9]{4}-(0[1-9]|1[0-2])$ ]]; then
    MARKER_STATE='invalid'
    MARKER_VALUE=''
    return 1
  fi
  local final_byte=''
  if ! final_byte="$(tail -c 1 "${MARKER_FILE}" | od -An -tx1 | tr -d '[:space:]')"; then
    MARKER_STATE='invalid'
    MARKER_VALUE=''
    return 1
  fi
  if [[ "${final_byte}" != '0a' ]]; then
    MARKER_STATE='invalid'
    MARKER_VALUE=''
    return 1
  fi
  MARKER_STATE='valid'
  return 0
}

validate_inputs() {
  [[ "${CURRENT_MONTH}" =~ ^[0-9]{4}-(0[1-9]|1[0-2])$ ]] || \
    error_exit "現在月の形式が不正です: ${CURRENT_MONTH}"
  [[ "${MINIMUM_AGE_HOURS}" =~ ^[0-9]+$ ]] || \
    error_exit "イメージ最小経過時間が不正です: ${MINIMUM_AGE_HOURS}"
  command -v "${FLOCK_BIN}" >/dev/null 2>&1 || \
    error_exit "必要なコマンドが見つかりません: ${FLOCK_BIN}"
}

acquire_locks() {
  local fleet_dir maintenance_dir
  fleet_dir="$(dirname "${FLEET_LOCK}")"
  maintenance_dir="$(dirname "${MAINTENANCE_LOCK}")"
  if [[ "${FLEET_LOCK}" == "${MAINTENANCE_LOCK}" ]]; then
    return 1
  fi
  if ! mkdir -p "${fleet_dir}" "${maintenance_dir}"; then
    return 1
  fi

  # fd 9 is the same fleet lock used by standard-ansible-release.py.  fd 8
  # serializes this maintenance job with itself.  Both are non-blocking.
  if ! exec 9>>"${FLEET_LOCK}"; then
    return 1
  fi
  if "${FLOCK_BIN}" -n 9; then
    :
  else
    local flock_result=$?
    exec 9>&-
    if [[ "${flock_result}" -eq 1 || "${flock_result}" -eq 75 ]]; then
      log "INFO: デプロイ実行中のためDocker旧リリース整理を延期します（翌日再試行）"
      return 75
    fi
    return 1
  fi

  if ! exec 8>>"${MAINTENANCE_LOCK}"; then
    "${FLOCK_BIN}" -u 9 >/dev/null 2>&1 || true
    exec 9>&-
    return 1
  fi
  if "${FLOCK_BIN}" -n 8; then
    :
  else
    local flock_result=$?
    "${FLOCK_BIN}" -u 9 >/dev/null 2>&1 || true
    exec 8>&-
    exec 9>&-
    if [[ "${flock_result}" -eq 1 || "${flock_result}" -eq 75 ]]; then
      log "INFO: 別のDocker旧リリース整理が実行中のため延期します（翌日再試行）"
      return 75
    fi
    return 1
  fi
  return 0
}

release_locks() {
  "${FLOCK_BIN}" -u 8 >/dev/null 2>&1 || true
  "${FLOCK_BIN}" -u 9 >/dev/null 2>&1 || true
  exec 8>&- || true
  exec 9>&- || true
}

log_output() {
  local phase="$1"
  local output_file="$2"
  local line=''
  while IFS= read -r line || [[ -n "${line}" ]]; do
    [[ -n "${line}" ]] || continue
    # Keep JSON summaries parseable in journald.  The summary's mode field
    # distinguishes plan from apply; journal metadata supplies time.
    if [[ "${line}" == \{* ]]; then
      printf '%s\n' "${line}"
    else
      log "image-retention ${phase}: ${line}"
    fi
  done < "${output_file}"
}

write_marker() {
  local marker_dir marker_name temporary
  marker_dir="$(dirname "${MARKER_FILE}")"
  marker_name="$(basename "${MARKER_FILE}")"
  if ! mkdir -p "${marker_dir}"; then
    error_exit "月次完了マーカーのディレクトリを作成できません: ${marker_dir}"
  fi
  temporary="$(mktemp "${marker_dir}/.${marker_name}.tmp.XXXXXX")" || \
    error_exit "月次完了マーカーの一時ファイルを作成できません: ${MARKER_FILE}"
  if ! printf '%s\n' "${CURRENT_MONTH}" > "${temporary}"; then
    rm -f -- "${temporary}"
    error_exit "月次完了マーカーを書き込めません: ${MARKER_FILE}"
  fi
  chmod 0644 "${temporary}" || {
    rm -f -- "${temporary}"
    error_exit "月次完了マーカーの権限を設定できません: ${MARKER_FILE}"
  }
  if ! mv -f -- "${temporary}" "${MARKER_FILE}"; then
    rm -f -- "${temporary}"
    error_exit "月次完了マーカーを原子的に更新できません: ${MARKER_FILE}"
  fi
}

validate_inputs
if ! validate_marker; then
  error_exit "月次完了マーカーが不正です（YYYY-MMと改行1行だけが必要です）: ${MARKER_FILE}"
fi
if [[ "${MARKER_STATE}" == 'valid' && "${MARKER_VALUE}" == "${CURRENT_MONTH}" ]]; then
  log "INFO: Docker旧リリース整理は今月分を実施済みのためスキップします（月: ${CURRENT_MONTH}）"
  exit 0
fi

if acquire_locks; then
  :
else
  lock_result=$?
  if [[ "${lock_result}" -eq 75 ]]; then
    exit 0
  fi
  error_exit "Docker旧リリース整理のロック取得に失敗しました（終了コード: ${lock_result}）"
fi

PLAN_FILE=''
PLAN_OUTPUT=''
APPLY_OUTPUT=''
cleanup() {
  [[ -z "${PLAN_FILE}" ]] || rm -f -- "${PLAN_FILE}" || true
  [[ -z "${PLAN_OUTPUT}" ]] || rm -f -- "${PLAN_OUTPUT}" || true
  [[ -z "${APPLY_OUTPUT}" ]] || rm -f -- "${APPLY_OUTPUT}" || true
  release_locks
}
trap cleanup EXIT

[[ -f "${STATE_FILE}" ]] || \
  error_exit "Dockerイメージ保持状態ファイルがありません: ${STATE_FILE}"
[[ -f "${HELPER}" ]] || \
  error_exit "Dockerイメージ保持スクリプトがありません: ${HELPER}"

PLAN_FILE="$(mktemp "${STATE_DIR}/.image-retention-plan.XXXXXX")" || \
  error_exit "Docker旧リリース整理のplan一時ファイルを作成できません"
PLAN_OUTPUT="$(mktemp "${STATE_DIR}/.image-retention-plan-output.XXXXXX")" || \
  error_exit "Docker旧リリース整理のplan出力一時ファイルを作成できません"
APPLY_OUTPUT="$(mktemp "${STATE_DIR}/.image-retention-apply-output.XXXXXX")" || \
  error_exit "Docker旧リリース整理のapply出力一時ファイルを作成できません"

if "${PYTHON_BIN}" "${HELPER}" plan \
    --state-file "${STATE_FILE}" \
    --output "${PLAN_FILE}" \
    --minimum-age-hours "${MINIMUM_AGE_HOURS}" >"${PLAN_OUTPUT}" 2>&1; then
  log_output "plan" "${PLAN_OUTPUT}"
else
  log_output "plan-failed" "${PLAN_OUTPUT}"
  error_exit "Docker旧リリース整理のplanに失敗しました"
fi

[[ -s "${PLAN_FILE}" ]] || error_exit "Docker旧リリース整理のplanファイルが空です"

if "${PYTHON_BIN}" "${HELPER}" apply \
    --state-file "${STATE_FILE}" \
    --plan "${PLAN_FILE}" >"${APPLY_OUTPUT}" 2>&1; then
  log_output "apply" "${APPLY_OUTPUT}"
else
  log_output "apply-failed" "${APPLY_OUTPUT}"
  error_exit "Docker旧リリース整理のapplyに失敗しました"
fi

# The core helper returns non-zero for any failed or unresolved deletion.  The
# marker is therefore advanced only after the complete apply command succeeds.
write_marker
log "INFO: Docker旧リリース整理が完了しました（月: ${CURRENT_MONTH}、完了マーカー: ${MARKER_FILE}）"
