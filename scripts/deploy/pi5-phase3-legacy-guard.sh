#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="${PI5_PROJECT_DIR:-/opt/RaspberryPiSystem_002}"
STATE_FILE="${PI5_BLUE_GREEN_STATE_FILE:-${PROJECT_DIR}/logs/deploy/pi5-blue-green-state.json}"

[[ -f "$STATE_FILE" ]] || exit 0

event="$(python3 - "$STATE_FILE" <<'PY'
import json,sys
try:
    with open(sys.argv[1],encoding='utf-8') as f: state=json.load(f)
except Exception as exc:
    print(f'ERROR: cannot validate Phase 3 state: {exc}',file=sys.stderr)
    raise SystemExit(2)
print(state.get('event') or 'absent')
PY
)" || {
  echo 'ERROR: Phase 3 state is unreadable; refusing legacy deployment fail-closed.' >&2
  exit 1
}

case "$event" in
  absent|not-initialized|legacy-restored) exit 0 ;;
  *)
    cat >&2 <<EOF
ERROR: Phase 3 Blue/Green is live (event=${event}).
Legacy API/Web deployment is blocked because it can collide with the fixed gateway.
Use only scripts/deploy/pi5-blue-green.sh, or explicitly run:
  scripts/deploy/pi5-blue-green.sh reconcile --restore-legacy
EOF
    exit 1
    ;;
esac
