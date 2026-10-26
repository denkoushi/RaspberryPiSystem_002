#!/usr/bin/env bash
set -euo pipefail

ADAPTER="${BLUE_SERVER_ADAPTER:-}"
case "${ADAPTER}" in
  dsv41_tensorfold_2x)
    LABEL="DeepSeek V4.1"
    LOG_SUBDIR="dsv41-tensorfold"
    ;;
  glm53_tensorfold_2x)
    LABEL="GLM 5.3 Flash"
    LOG_SUBDIR="tensorfold-glm53"
    ;;
  *)
    echo "unsupported BLUE_SERVER_ADAPTER: ${ADAPTER}" >&2
    exit 1
    ;;
esac

# Launch only: rank 0/API is remote; readiness is probed outside this command.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODE="${BLUE_SERVER_MODE:-${TRTLLM_SERVER_MODE:-container}}"
WORKER_SSH="${BLUE_WORKER_SSH_TARGET:-}"
RECIPE_DIR="${BLUE_QWEN38_RECIPE_DIR:-}"
EXPECTED_REVISION="${BLUE_QWEN38_RECIPE_REVISION:-}"
ABLITERATED="${BLUE_ABLITERATED:-0}"
VENV_BIN="${BLUE_REMOTE_VENV_BIN:-}"
MARKER="${BLUE_REMOTE_WORKER_MARKER_PATH:-/srv/dgx/system-prod/state/blue-remote-worker.json}"

fail() { echo "${LABEL} adapter: $*" >&2; exit 1; }
[[ "${MODE}" == "container" ]] || fail "requires container mode"
[[ "${WORKER_SSH}" =~ ^[a-zA-Z0-9_][a-zA-Z0-9_.-]*@[a-zA-Z0-9_][a-zA-Z0-9_.-]*$ ]] || fail "invalid worker ssh target (user@host required)"
[[ "${EXPECTED_REVISION}" =~ ^[a-fA-F0-9]{40}$ ]] || fail "expected revision must be full 40-hex"
[[ "${ABLITERATED}" == "0" || "${ABLITERATED}" == "1" ]] || fail "ABLIT must be 0 or 1"
for path in "${RECIPE_DIR}" "${MARKER}" "${VENV_BIN:-/}"; do
  [[ "${path}" == /* && "${path}" != *:* && "${path}" != *$'\n'* ]] || fail "invalid absolute path: ${path}"
done

# SSH joins arguments into shell text; quote every argument for the remote sh.
worker() {
  local command
  command="$(python3 - "$@" <<'PY'
import shlex
import sys
print(shlex.join(sys.argv[1:]))
PY
  )"
  ssh -o BatchMode=yes -o ConnectTimeout=10 -- "${WORKER_SSH}" "${command}"
}

bash "${SCRIPT_DIR}/stop-trtllm-server.sh"
REVISION="$(worker git -C "${RECIPE_DIR}" rev-parse HEAD)" || fail "cannot read recipe revision"
[[ "${REVISION}" == "${EXPECTED_REVISION}" ]] || fail "recipe revision mismatch"
STATUS="$(worker git -C "${RECIPE_DIR}" status --porcelain)" || fail "cannot read recipe status"
[[ -z "${STATUS}" ]] || fail "recipe checkout has uncommitted changes"

# Preserve recovery information even if SSH fails after starting the launcher.
install -d "$(dirname "${MARKER}")"
python3 - "${MARKER}" "${WORKER_SSH}" "${RECIPE_DIR}" "${VENV_BIN}" "${ADAPTER}" <<'PY'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
marker = {"adapter": sys.argv[5], "sshTarget": sys.argv[2], "cloneDir": sys.argv[3]}
if sys.argv[4]:
    marker["venvBin"] = sys.argv[4]
tmp = path.with_suffix(path.suffix + ".tmp")
tmp.write_text(json.dumps(marker) + "\n", encoding="utf-8")
tmp.replace(path)
PY

# Business has priority over a leftover private lease.
worker docker stop dgx-private-comfyui >/dev/null 2>&1 || true
# All three streams are detached so SSH returns without waiting for cold start.
# shellcheck disable=SC2016 # Variables are expanded only by the remote sh.
worker sh -eu -c '
cd "$1"
if [ -n "$2" ]; then export PATH="$2:$PATH"; fi
mkdir -p "$HOME/.cache/'"${LOG_SUBDIR}"'"
ABLIT='"${ABLITERATED}"' setsid nohup ./start.sh restart > "$HOME/.cache/'"${LOG_SUBDIR}"'/start.log" 2>&1 < /dev/null &
' sh "${RECIPE_DIR}" "${VENV_BIN}"
echo "launched ${LABEL} at ${WORKER_SSH}; readiness pending"
