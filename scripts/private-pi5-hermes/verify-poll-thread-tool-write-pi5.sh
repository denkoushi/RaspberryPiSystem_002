#!/usr/bin/env bash
# Pi5 post-deploy: poll thread must not consume tool:* approval responses (Phase D5.1).
set -euo pipefail
PY="/home/hermes/.hermes/hermes-agent/venv/bin/python3"
PLUGIN="/home/hermes/.hermes/plugins/private-pi5-discord-task-bridge"
STORE="/tmp/verify-poll-thread-$$"
TASK_ID="verify-poll-$(date +%s)"

"${PY}" - <<PY
import sys
import tempfile
import threading
import time
from pathlib import Path

sys.path.insert(0, "${PLUGIN}")
from approval_relay.models import ApprovalChoice
from approval_relay.runner import _poll_responses_until_stop, _poll_thread_should_consume_response
from approval_relay.store import FileApprovalStore

store_dir = Path("${STORE}")
store_dir.mkdir(parents=True, exist_ok=True)
task_id = "${TASK_ID}"
store = FileApprovalStore(store_dir, task_id)
store.write_request(
    {
        "command": "write_file path=/workspace/x.txt",
        "description": "write",
        "pattern_key": "tool:write_file",
        "pattern_keys": ["tool:write_file"],
    }
)
if _poll_thread_should_consume_response(store):
    raise SystemExit("FAIL: poll would consume tool write request")

stop = threading.Event()
thread = threading.Thread(
    target=_poll_responses_until_stop,
    kwargs={
        "store_dir": store_dir,
        "task_id": task_id,
        "session_key": f"task-bridge:{task_id}",
        "poll_interval_seconds": 0.05,
        "stop_event": stop,
    },
    daemon=True,
)
thread.start()
time.sleep(0.15)
store.write_response(ApprovalChoice.ONCE, discord_user_id="verify-bot")
time.sleep(0.25)
stop.set()
thread.join(timeout=2.0)

response = store.read_response()
if response is None or response.choice != ApprovalChoice.ONCE:
    raise SystemExit("FAIL: response.json was consumed by poll thread")
print("OK: poll thread left tool write response for waiter")
PY

rm -rf "${STORE}"
echo "OK: poll thread tool write verify"
