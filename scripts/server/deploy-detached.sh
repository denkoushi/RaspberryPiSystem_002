#!/usr/bin/env bash
set -euo pipefail

# Pi5上でデタッチ実行するためのラッパー
# 使用方法: ./scripts/server/deploy-detached.sh [ブランチ名]

BRANCH="${1:-main}"
PROJECT_DIR="/opt/RaspberryPiSystem_002"
LOG_DIR="${PROJECT_DIR}/logs/deploy"
RUN_ID="${RUN_ID:-$(date -u +%Y%m%d-%H%M%S)-$RANDOM}"
STATUS_FILE="${LOG_DIR}/deploy-detached-${RUN_ID}.status.json"
EXIT_FILE="${LOG_DIR}/deploy-detached-${RUN_ID}.exit"
PID_FILE="${LOG_DIR}/deploy-detached-${RUN_ID}.pid"
LOG_FILE="${LOG_DIR}/deploy-detached-${RUN_ID}.log"
UNIT_NAME="deploy-detached-${RUN_ID}"

mkdir -p "${LOG_DIR}"

cat > "/tmp/deploy-detached-${RUN_ID}.sh" <<EOF
#!/usr/bin/env bash
set -euo pipefail

BRANCH="${BRANCH}"
PROJECT_DIR="${PROJECT_DIR}"
STATUS_FILE="${STATUS_FILE}"
EXIT_FILE="${EXIT_FILE}"
UNIT_NAME="${UNIT_NAME}"
RUNNER="${RUNNER}"

write_status() {
  local state="\$1"
  local exit_code="\${2:-}"
  python3 - <<'PY' "\${STATUS_FILE}" "${RUN_ID}" "${BRANCH}" "\${state}" "\${exit_code}" "\${UNIT_NAME}" "\${RUNNER}"
import json, sys, time
path, run_id, branch, state, exit_code, unit_name, runner = sys.argv[1:]
data = {
    "runId": run_id,
    "branch": branch,
    "state": state,
    "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
}
if state == "running":
    data["startedAt"] = data["updatedAt"]
if state in ("success", "failed"):
    data["endedAt"] = data["updatedAt"]
    data["exitCode"] = exit_code
if unit_name:
    data["unitName"] = unit_name
if runner:
    data["runner"] = runner
with open(path, "w", encoding="utf-8") as fh:
    json.dump(data, fh, ensure_ascii=False)
PY
}

write_status running

/opt/RaspberryPiSystem_002/scripts/server/deploy.sh "\${BRANCH}"
exit_code=\$?

if [ "\${exit_code}" -eq 0 ]; then
  write_status success "\${exit_code}"
else
  write_status failed "\${exit_code}"
fi

echo "\${exit_code}" > "\${EXIT_FILE}"
exit "\${exit_code}"
EOF

chmod +x "/tmp/deploy-detached-${RUN_ID}.sh"
if command -v systemd-run >/dev/null 2>&1; then
  RUNNER="systemd-run" UNIT_NAME="${UNIT_NAME}" systemd-run --unit="${UNIT_NAME}" --collect --property=WorkingDirectory="${PROJECT_DIR}" --property=StandardOutput=append:${LOG_FILE} --property=StandardError=append:${LOG_FILE} /bin/bash "/tmp/deploy-detached-${RUN_ID}.sh" >/dev/null 2>&1 || true
  systemctl show -p MainPID --value "${UNIT_NAME}" > "${PID_FILE}" || true
else
  RUNNER="nohup" UNIT_NAME="" nohup "/tmp/deploy-detached-${RUN_ID}.sh" >> "${LOG_FILE}" 2>&1 & echo $! > "${PID_FILE}"
fi

echo "[INFO] Detach run started: ${RUN_ID}"
echo "[INFO] Log: ${LOG_FILE}"
echo "[INFO] Status: ${STATUS_FILE}"
echo "[INFO] Exit: ${EXIT_FILE}"
echo "[INFO] PID: ${PID_FILE}"
