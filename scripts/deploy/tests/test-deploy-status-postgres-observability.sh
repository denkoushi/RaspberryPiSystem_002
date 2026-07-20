#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TARGET="${ROOT}/scripts/deploy/tests/test-deploy-status-postgres.sh"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

bash -n "$TARGET"

set +e
failure_output="$(bash -c '
docker() {
  case "$1" in
    ps|network|volume|run|rm) return 0 ;;
    exec) return 1 ;;
    inspect) printf "%s\\n" "state=exited exitCode=1 error=fixture health=unhealthy" ;;
    logs) printf "%s\\n" "fixture PostgreSQL log" ;;
    *) return 0 ;;
  esac
}
sleep() { :; }
export -f docker sleep
bash "$1"
' bash "$TARGET" 2>&1)"
failure_status=$?
set -e

[[ "$failure_status" -eq 1 ]] || fail "readiness fixture returned ${failure_status}, expected 1"
grep -Fq '[ERROR] PostgreSQL did not become ready within 30 seconds' <<<"$failure_output" \
  || fail 'readiness timeout was not reported'
grep -Fq 'stage=wait for PostgreSQL readiness exit=1' <<<"$failure_output" \
  || fail 'failed stage and exit code were not reported'
grep -Fq 'state=exited exitCode=1 error=fixture health=unhealthy' <<<"$failure_output" \
  || fail 'container state was not reported'
grep -Fq 'fixture PostgreSQL log' <<<"$failure_output" \
  || fail 'container log tail was not reported'

echo 'PASS: deploy-status PostgreSQL failure diagnostics'
