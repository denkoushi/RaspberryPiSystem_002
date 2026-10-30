#!/bin/bash
set -euo pipefail

LOG_DIR="/var/log/clamav"
LOG_FILE="${LOG_DIR}/clamav-scan.log"
mkdir -p "${LOG_DIR}"

# Run scans at the lowest CPU priority and cap their disk bandwidth so they do not starve the API/DB disk.
# ionice is ignored by mq-deadline, so the IO cap uses a cgroup v2 scope (io.max works with any scheduler).
LOW_PRIORITY=(nice -n 19)
if command -v systemd-run >/dev/null 2>&1 && [[ -d /run/systemd/system ]]; then
  LOW_PRIORITY=(systemd-run --scope --quiet --collect
    -p "IOReadBandwidthMax=/ 30M"
    -p "IOWriteBandwidthMax=/ 30M"
    nice -n 19)
fi

SCAN_TARGETS=(
"/opt/RaspberryPiSystem_002/storage"
"/opt/backups"
)

TIMESTAMP="$(date +%Y-%m-%dT%H:%M:%S)"
echo "[$TIMESTAMP] Starting ClamAV scan..." >> "${LOG_FILE}"

set +e
"${LOW_PRIORITY[@]}" /usr/bin/clamscan \
  --recursive \
  --infected \
  --quiet \
  --max-filesize=200M \
  --max-scansize=400M \
  "${SCAN_TARGETS[@]}" >> "${LOG_FILE}" 2>&1
SCAN_EXIT=$?
set -e

echo "[$(date +%Y-%m-%dT%H:%M:%S)] Scan completed." >> "${LOG_FILE}"

if [[ ${SCAN_EXIT} -eq 1 && -x "/usr/local/bin/generate-alert.sh" ]]; then
  DETAILS="$(grep -E 'FOUND' "${LOG_FILE}" | tail -n 20)"
  DETAILS=${DETAILS:-"ClamAV reported infected files. See ${LOG_FILE} for details."}
  "/usr/local/bin/generate-alert.sh" \
    "clamav-detection" \
    "ClamAVスキャンで感染ファイルを検知しました" \
    "${DETAILS}"
elif [[ ${SCAN_EXIT} -gt 1 && -x "/usr/local/bin/generate-alert.sh" ]]; then
  "/usr/local/bin/generate-alert.sh" \
    "clamav-scan-error" \
    "ClamAVスキャンでエラーが発生しました" \
    "詳細ログ: ${LOG_FILE}"
fi
