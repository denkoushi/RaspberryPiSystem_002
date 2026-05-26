#!/usr/bin/env bash
# Pi5 post-deploy: verify write_file triggers request.json before approval (Phase D5.1).
set -euo pipefail
TID="verify-write-gate-$(date +%s)"
STORE="/home/hermes/.hermes/task-bridge/approvals"
TASK_DIR="${STORE}/${TID}"
PY="/home/hermes/.hermes/hermes-agent/venv/bin/python3"
RUNNER="/home/hermes/.hermes/plugins/private-pi5-discord-task-bridge/approval_relay/runner.py"
TARGET="/home/hermes/.hermes-tools/workspace/${TID}.txt"

rm -f "${TARGET}"
mkdir -p "${STORE}"

approve_when_ready() {
  for _ in $(seq 1 150); do
    if [ -f "${TASK_DIR}/request.json" ]; then
      "${PY}" - <<PY
from pathlib import Path
import sys
sys.path.insert(0, "/home/hermes/.hermes/plugins/private-pi5-discord-task-bridge")
from approval_relay.models import ApprovalChoice
from approval_relay.store import FileApprovalStore
store = FileApprovalStore(Path("${STORE}"), "${TID}")
store.write_response(ApprovalChoice.ONCE, discord_user_id="verify-bot")
PY
      return 0
    fi
    sleep 0.2
  done
  return 1
}

approve_when_ready &
APID=$!

set +e
timeout 120 "${PY}" "${RUNNER}" \
  --task-id "${TID}" \
  --store-dir "${STORE}" \
  --session-key "task-bridge:${TID}" \
  --tools-home "/home/hermes/.hermes-tools/home" \
  --tools-env "/home/hermes/.hermes-tools/.env" \
  --hermes-bin "/home/hermes/.local/bin/hermes" \
  --prompt "Create ${TID}.txt in workspace with content gate-verify-ok" \
  --toolsets file \
  --request-timeout 100 \
  --poll-interval 0.5 \
  >/tmp/verify-write-gate.out 2>&1
RC=$?
set -e
wait "${APID}" 2>/dev/null || true

if [ ! -f "${TASK_DIR}/request.json" ]; then
  echo "FAIL: request.json was not created (approval gate did not fire)"
  exit 1
fi
echo "ok: request.json created"

if [ -f "${TARGET}" ]; then
  echo "ok: file created after simulated approval"
else
  echo "WARN: target file missing (runner rc=${RC}); check /tmp/verify-write-gate.out"
  if [ "${RC}" -ne 0 ]; then
    tail -30 /tmp/verify-write-gate.out
    exit 1
  fi
fi

echo "OK: tool write approval gate verify"
