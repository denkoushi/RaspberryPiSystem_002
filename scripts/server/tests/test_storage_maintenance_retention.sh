#!/usr/bin/env bash
# Focused contract tests for storage-maintenance scheduling and locking.
# Docker image policy itself is covered by docker-release-image-maintenance.py;
# these cases only prove that the daily wrapper invokes it safely.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SCRIPT="${ROOT}/scripts/server/storage-maintenance.sh"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

BIN_DIR="${TMP_DIR}/bin"
mkdir -p "${BIN_DIR}"
ORIGINAL_PATH="${PATH}"

cat > "${BIN_DIR}/fake-flock" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

operation="${1:-}"
fd="${2:-}"
if [[ "${operation}" == "-n" ]]; then
  if [[ "${FAKE_FLOCK_MODE:-free}" == "fleet-busy" ]]; then
    exit 1
  fi
  if [[ "${FAKE_FLOCK_MODE:-free}" == "maintenance-busy" && "${fd}" == "8" ]]; then
    exit 1
  fi
  exit 0
fi
if [[ "${operation}" == "-u" ]]; then
  exit 0
fi
exit 64
SH
chmod +x "${BIN_DIR}/fake-flock"

cat > "${BIN_DIR}/fake-docker" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

printf '%s\n' "$*" >> "${FAKE_DOCKER_CALL_LOG}"
case "$*" in
  'builder du')
    printf 'Total: 1GB\n'
    ;;
  'builder prune -a --force')
    ;;
  'system df')
    printf 'TYPE TOTAL ACTIVE SIZE RECLAIMABLE\n'
    ;;
  *)
    exit 64
    ;;
esac
SH
chmod +x "${BIN_DIR}/fake-docker"

cat > "${BIN_DIR}/date" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

format="${1:-}"
case "${format}" in
  +%Y-%m|+%d)
    [[ "${TZ:-}" == 'Asia/Tokyo' ]] || exit 91
    if [[ "${format}" == '+%Y-%m' ]]; then
      printf '2026-09\n'
    else
      printf '01\n'
    fi
    ;;
  *)
    printf '2026-09-01 00:00:00\n'
    ;;
esac
SH
chmod +x "${BIN_DIR}/date"

cat > "${BIN_DIR}/fake-python" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

printf '%s\n' "$*" >> "${FAKE_CORE_CALL_LOG}"
subcommand="${2:-}"
case "${FAKE_CORE_MODE:-success}:${subcommand}" in
  plan-failed:plan)
    echo 'fixture plan failure' >&2
    exit 31
    ;;
  apply-failed:apply)
    echo 'fixture apply failure' >&2
    exit 32
    ;;
  apply-partial:apply)
    echo '{"status":"partial","success":false,"failedCount":1}'
    exit 33
    ;;
esac

if [[ "${subcommand}" == "plan" ]]; then
  output=''
  while (($#)); do
    if [[ "$1" == "--output" ]]; then
      output="${2:-}"
      shift 2
    else
      shift
    fi
  done
  [[ -n "${output}" ]] || exit 64
  printf '{"status":"planned","candidateCount":0}\n' > "${output}"
  printf '{"phase":"plan","status":"ok"}\n'
  exit 0
fi

if [[ "${subcommand}" == "apply" ]]; then
  printf '{"status":"success","success":true,"removedCount":0}\n'
  exit 0
fi
exit 64
SH
chmod +x "${BIN_DIR}/fake-python"

new_case() {
  CASE_DIR="$(mktemp -d "${TMP_DIR}/case.XXXXXX")"
  mkdir -p "${CASE_DIR}/project/scripts" "${CASE_DIR}/state"
  printf '{}\n' > "${CASE_DIR}/state/image-retention.json"
  printf '#!/usr/bin/env bash\nprintf "%%s\\n" "$*" >> "%s/alerts.log"\n' \
    "${CASE_DIR}" > "${CASE_DIR}/project/scripts/generate-alert.sh"
  chmod +x "${CASE_DIR}/project/scripts/generate-alert.sh"
  : > "${CASE_DIR}/calls.log"

  export STORAGE_MAINTENANCE_PROJECT_ROOT="${CASE_DIR}/project"
  export STORAGE_MAINTENANCE_SIGNAGE_RENDER_DIR="${CASE_DIR}/missing-signage"
  export STORAGE_MAINTENANCE_MONTH='2026-09'
  export STORAGE_MAINTENANCE_DAY='02'
  export STORAGE_MAINTENANCE_DOCKER_BIN="${BIN_DIR}/fake-docker"
  export IMAGE_RETENTION_STATE_FILE="${CASE_DIR}/state/image-retention.json"
  export IMAGE_RETENTION_STATE_DIR="${CASE_DIR}/state"
  export IMAGE_RETENTION_MARKER_FILE="${CASE_DIR}/state/month.marker"
  export IMAGE_RETENTION_LOCK_FILE="${CASE_DIR}/state/maintenance.lock"
  export IMAGE_RETENTION_FLEET_DEPLOY_LOCK="${CASE_DIR}/state/fleet.lock"
  export IMAGE_RETENTION_SCRIPT="${CASE_DIR}/state/docker-release-image-maintenance.py"
  export IMAGE_RETENTION_PYTHON="${BIN_DIR}/fake-python"
  export IMAGE_RETENTION_FLOCK="${BIN_DIR}/fake-flock"
  export FAKE_CORE_CALL_LOG="${CASE_DIR}/calls.log"
  export FAKE_DOCKER_CALL_LOG="${CASE_DIR}/docker-calls.log"
  export FAKE_CORE_MODE='success'
  export FAKE_FLOCK_MODE='free'
  export PATH="${ORIGINAL_PATH}"
  : > "${IMAGE_RETENTION_SCRIPT}"
}

run_case() {
  OUTPUT_FILE="${CASE_DIR}/output.log"
  if bash "${SCRIPT}" >"${OUTPUT_FILE}" 2>&1; then
    CASE_RC=0
  else
    CASE_RC=$?
  fi
}

# Normal stale-month execution invokes plan then apply, and only then writes a
# marker.  The plan path passed to apply must be the same generated file.
new_case
run_case
[[ "${CASE_RC}" -eq 0 ]]
[[ "$(<"${IMAGE_RETENTION_MARKER_FILE}")" == '2026-09' ]]
[[ "$(wc -l < "${FAKE_CORE_CALL_LOG}")" -eq 2 ]]
grep -Fq 'plan --state-file ' "${FAKE_CORE_CALL_LOG}"
grep -Fq -- '--minimum-age-hours 24' "${FAKE_CORE_CALL_LOG}"
grep -Fq 'apply --state-file ' "${FAKE_CORE_CALL_LOG}"
plan_path="$(sed -n '1p' "${FAKE_CORE_CALL_LOG}" | sed -n 's/.* --output \([^ ]*\) --minimum-age-hours.*/\1/p')"
apply_path="$(sed -n '2p' "${FAKE_CORE_CALL_LOG}" | sed -n 's/.* --plan \([^ ]*\)$/\1/p')"
[[ -n "${plan_path}" && "${plan_path}" == "${apply_path}" ]]

# A current marker makes the daily timer a no-op for image retention.
: > "${FAKE_CORE_CALL_LOG}"
run_case
[[ "${CASE_RC}" -eq 0 ]]
[[ ! -s "${FAKE_CORE_CALL_LOG}" ]]

# A marker with an extra line is corrupt even when its first line names the
# current month; fail closed before taking Docker locks or invoking the core.
new_case
printf '2026-09\nextra\n' > "${IMAGE_RETENTION_MARKER_FILE}"
run_case
[[ "${CASE_RC}" -ne 0 ]]
[[ ! -s "${FAKE_CORE_CALL_LOG}" ]]
grep -Fq 'storage-maintenance-failed' "${CASE_DIR}/alerts.log"

# A deployment lock conflict is an expected skip: no helper call and no alert.
new_case
printf '2026-08\n' > "${IMAGE_RETENTION_MARKER_FILE}"
export FAKE_FLOCK_MODE='fleet-busy'
run_case
[[ "${CASE_RC}" -eq 0 ]]
[[ ! -s "${FAKE_CORE_CALL_LOG}" ]]
[[ "$(<"${IMAGE_RETENTION_MARKER_FILE}")" == '2026-08' ]]
[[ ! -e "${CASE_DIR}/alerts.log" || ! -s "${CASE_DIR}/alerts.log" ]]

# A maintenance lock conflict is also a no-op and leaves the stale marker.
new_case
printf '2026-08\n' > "${IMAGE_RETENTION_MARKER_FILE}"
export FAKE_FLOCK_MODE='maintenance-busy'
run_case
[[ "${CASE_RC}" -eq 0 ]]
[[ ! -s "${FAKE_CORE_CALL_LOG}" ]]
[[ "$(<"${IMAGE_RETENTION_MARKER_FILE}")" == '2026-08' ]]

# Missing state is fail-closed and follows the existing alert path.
new_case
rm -f -- "${IMAGE_RETENTION_STATE_FILE}"
run_case
[[ "${CASE_RC}" -ne 0 ]]
[[ ! -s "${FAKE_CORE_CALL_LOG}" ]]
grep -Fq 'storage-maintenance-failed' "${CASE_DIR}/alerts.log"
[[ ! -e "${IMAGE_RETENTION_MARKER_FILE}" ]]

# A partial apply exits non-zero, so the wrapper leaves the stale marker and
# emits the existing failure alert for the next day's retry.
new_case
printf '2026-08\n' > "${IMAGE_RETENTION_MARKER_FILE}"
export FAKE_CORE_MODE='apply-partial'
run_case
[[ "${CASE_RC}" -ne 0 ]]
[[ "$(<"${IMAGE_RETENTION_MARKER_FILE}")" == '2026-08' ]]
grep -Fq 'storage-maintenance-failed' "${CASE_DIR}/alerts.log"

# A retention helper failure must not skip the existing day-1 BuildKit cleanup
# or disk check.  The helper already emitted the one alert, so the coordinator
# must only return non-zero without sending a duplicate alert.
new_case
export STORAGE_MAINTENANCE_DAY='01'
export FAKE_CORE_MODE='apply-failed'
run_case
[[ "${CASE_RC}" -ne 0 ]]
grep -Fxq 'builder prune -a --force' "${FAKE_DOCKER_CALL_LOG}"
grep -Fq '現在のディスク使用量:' "${CASE_DIR}/output.log"
[[ "$(wc -l < "${CASE_DIR}/alerts.log")" -eq 1 ]]

# A missing retention helper follows the coordinator's alert path once, while
# still allowing day-1 BuildKit and disk checks to complete.
new_case
export STORAGE_MAINTENANCE_DAY='01'
export STORAGE_MAINTENANCE_RETENTION_HELPER="${CASE_DIR}/missing-monthly-helper.sh"
run_case
[[ "${CASE_RC}" -ne 0 ]]
grep -Fxq 'builder prune -a --force' "${FAKE_DOCKER_CALL_LOG}"
grep -Fq '現在のディスク使用量:' "${CASE_DIR}/output.log"
[[ "$(wc -l < "${CASE_DIR}/alerts.log")" -eq 1 ]]

# Production schedule boundaries are fixed to JST.  The fake date command
# exits unless both the month and day queries carry TZ=Asia/Tokyo.
new_case
printf '2026-08\n' > "${IMAGE_RETENTION_MARKER_FILE}"
unset STORAGE_MAINTENANCE_MONTH STORAGE_MAINTENANCE_DAY
export PATH="${BIN_DIR}:${ORIGINAL_PATH}"
run_case
[[ "${CASE_RC}" -eq 0 ]]
[[ "$({ cat "${IMAGE_RETENTION_MARKER_FILE}"; printf x; } | tr -d x)" == '2026-09' ]]
grep -Fxq 'builder prune -a --force' "${FAKE_DOCKER_CALL_LOG}"

echo 'PASS: storage maintenance retention scheduling and locking'
