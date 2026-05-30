#!/usr/bin/env bash
# Read-only Pi5 snapshot for Discord /task + approval relay troubleshooting.
# Run on Pi5 as: sudo -u hermes bash verify-task-bridge-readonly-state-pi5.sh
set -euo pipefail

HERMES_USER="${HERMES_USER:-hermes}"
HOME_DIR="/home/${HERMES_USER}"

echo "=== time / user ==="
date -Is
id
echo "MAINPID hermes-gateway: $(systemctl show hermes-gateway -p MainPID --value 2>/dev/null || echo n/a)"
echo "MAINPID hermes-tools-gateway: $(systemctl show hermes-tools-gateway -p MainPID --value 2>/dev/null || echo n/a)"

echo "=== plugin mtimes ==="
ls -la "${HOME_DIR}/.hermes/plugins/private-pi5-discord-task-bridge/"*.py 2>/dev/null | tail -5 || true
ls -la "${HOME_DIR}/.hermes/plugins/private-pi5-discord-task-bridge/approval_relay/"*.py 2>/dev/null | tail -8 || true

echo "=== approvals ownership (root-owned rows) ==="
find "${HOME_DIR}/.hermes/task-bridge/approvals" -user root -maxdepth 3 -printf '%u:%g %p\n' 2>/dev/null | head -20 || true
echo "approvals file count: $(find "${HOME_DIR}/.hermes/task-bridge/approvals" -maxdepth 2 -type f 2>/dev/null | wc -l)"

echo "=== active by-user index ==="
find "${HOME_DIR}/.hermes/task-bridge/approvals/by-user" -type f -maxdepth 1 -print -exec cat {} \; 2>/dev/null || true

echo "=== DGX profile env ==="
grep -E '^DGX_MODEL_PROFILE_ID=' "${HOME_DIR}/.hermes-tools/.env" "${HOME_DIR}/.hermes/dgx-keep-warm.env" 2>/dev/null || true

echo "=== gateway log (/task, yes, approval) last 40 ==="
grep -E '/task|inbound message|task-approve|approval|delivery_failed|承認' \
  "${HOME_DIR}/.hermes/logs/gateway.log" 2>/dev/null | tail -40 || true

echo "=== done (read-only) ==="
