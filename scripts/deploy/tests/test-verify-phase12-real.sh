#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SCRIPT="${ROOT_DIR}/scripts/deploy/verify-phase12-real.sh"

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

bash -n "$SCRIPT"
grep -Fq 'name=^/bluegreen-api-(blue|green)-1$' "$SCRIPT" \
  || fail 'Phase12 does not discover the active Blue/Green API container'
grep -Fq 'if [ "${PI5_ACTIVE_API_COUNT}" = "1" ]' "$SCRIPT" \
  || fail 'Phase12 does not require exactly one active Blue/Green API container'
grep -Fq "docker exec '\${PI5_ACTIVE_API_CONTAINERS}' pnpm prisma migrate status" "$SCRIPT" \
  || fail 'Phase12 does not run Prisma status in the active Blue/Green API container'
grep -Fq 'docker compose -f infrastructure/docker/docker-compose.server.yml exec -T api pnpm prisma migrate status' "$SCRIPT" \
  || fail 'Phase12 lost the legacy API fallback'
grep -Fq "API_LOGS_10M_COMMAND=\"docker logs --since=10m '\${PI5_ACTIVE_API_CONTAINERS}'\"" "$SCRIPT" \
  || fail 'Phase12 does not inspect current Blue/Green API logs'

printf 'verify-phase12 Blue/Green migration contract passed\n'
