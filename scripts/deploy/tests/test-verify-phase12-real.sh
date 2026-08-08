#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SCRIPT="${ROOT_DIR}/scripts/deploy/verify-phase12-real.sh"

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

bash -n "$SCRIPT"
if grep -Eq 'bluegreen-api|docker compose|docker exec|docker logs|prisma migrate|PI5_ACTIVE_API|MIGRATE_STATUS|API_LOGS' "$SCRIPT"; then
  fail 'Phase12 still contains retired Pi5 runtime inspection'
fi
grep -Fq 'APIヘルス' "$SCRIPT" \
  || fail 'Phase12 lost the shared application health smoke'
grep -Fq 'api/system/deploy-status' "$SCRIPT" \
  || fail 'Phase12 lost the shared deploy-status HTTP smoke'
grep -Fq 'api/signage/current-image' "$SCRIPT" \
  || fail 'Phase12 lost the shared signage HTTP smoke'
grep -Fq 'PUT "${BASE_URL}/api/kiosk/production-schedule/due-management/global-rank/auto-generate"' "$SCRIPT" \
  || fail 'Phase12 lost the shared auto-generate HTTP smoke'

printf 'verify-phase12 shared HTTP smoke contract passed\n'
