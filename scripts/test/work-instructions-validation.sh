#!/usr/bin/env bash
set -euo pipefail

# Run a command against a disposable pgvector PostgreSQL instance without
# touching the repository's shared postgres-test-local container or any
# operator-provided DATABASE_URL.  The caller's command inherits all test
# paths and connection variables exported below.

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required" >&2
  exit 1
fi

if ! docker image inspect pgvector/pgvector:pg15 >/dev/null 2>&1; then
  echo "pgvector/pgvector:pg15 is not available locally; pulling the pinned test image" >&2
  docker pull pgvector/pgvector:pg15
fi

RUN_ID="$(date +%Y%m%d%H%M%S)-$$-${RANDOM}"
CONTAINER_NAME="rps-wi-test-${RUN_ID}"
VOLUME_NAME="${CONTAINER_NAME}-data"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/rps-wi-test.XXXXXX")"
CONTAINER_ID=""
VOLUME_CREATED=0

BEFORE_CONTAINERS="$(mktemp "${TEST_ROOT}/containers.before.XXXXXX")"
BEFORE_VOLUMES="$(mktemp "${TEST_ROOT}/volumes.before.XXXXXX")"
BEFORE_NETWORKS="$(mktemp "${TEST_ROOT}/networks.before.XXXXXX")"

docker ps -a --format '{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Ports}}' | sort >"${BEFORE_CONTAINERS}"
docker volume ls --format '{{.Name}}' | sort >"${BEFORE_VOLUMES}"
docker network ls --format '{{.Name}}\t{{.Driver}}' | sort >"${BEFORE_NETWORKS}"

cleanup() {
  local status=$?
  local cleanup_failed=0
  set +e

  # Only the ID returned by this invocation may be removed.  Never remove by
  # a guessed name, and never use a broad prune operation.
  if [[ -n "${CONTAINER_ID}" ]]; then
    docker container rm --force --volumes "${CONTAINER_ID}" >/dev/null 2>&1 || true
  fi
  if [[ "${VOLUME_CREATED}" -eq 1 ]]; then
    docker volume rm "${VOLUME_NAME}" >/dev/null 2>&1 || true
  fi

  if ! docker info >/dev/null 2>&1; then
    echo "could not verify cleanup because Docker is unavailable" >&2
    cleanup_failed=1
  else
    if [[ -n "${CONTAINER_ID}" ]] && docker container inspect "${CONTAINER_ID}" >/dev/null 2>&1; then
      echo "created container still exists after cleanup: ${CONTAINER_ID}" >&2
      cleanup_failed=1
    fi
    if [[ "${VOLUME_CREATED}" -eq 1 ]] && docker volume inspect "${VOLUME_NAME}" >/dev/null 2>&1; then
      echo "created volume still exists after cleanup: ${VOLUME_NAME}" >&2
      cleanup_failed=1
    fi
  fi

  local after_containers="${TEST_ROOT}/containers.after"
  local after_volumes="${TEST_ROOT}/volumes.after"
  local after_networks="${TEST_ROOT}/networks.after"
  docker ps -a --format '{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Ports}}' | sort >"${after_containers}"
  docker volume ls --format '{{.Name}}' | sort >"${after_volumes}"
  docker network ls --format '{{.Name}}\t{{.Driver}}' | sort >"${after_networks}"

  if ! cmp -s "${BEFORE_CONTAINERS}" "${after_containers}"; then
    echo "container inventory changed during validation:" >&2
    diff -u "${BEFORE_CONTAINERS}" "${after_containers}" >&2 || true
  fi
  if ! cmp -s "${BEFORE_VOLUMES}" "${after_volumes}"; then
    echo "volume inventory changed during validation:" >&2
    diff -u "${BEFORE_VOLUMES}" "${after_volumes}" >&2 || true
  fi
  if ! cmp -s "${BEFORE_NETWORKS}" "${after_networks}"; then
    echo "network inventory changed during validation:" >&2
    diff -u "${BEFORE_NETWORKS}" "${after_networks}" >&2 || true
  fi

  if [[ -d "${TEST_ROOT}" ]]; then
    rm -rf "${TEST_ROOT}"
  fi
  if [[ "${cleanup_failed}" -ne 0 ]] && [[ "${status}" -eq 0 ]]; then
    status=1
  fi
  if [[ "${cleanup_failed}" -eq 0 ]]; then
    echo "TEMP_RESOURCE_REMAINING=0"
  fi
  exit "${status}"
}
if grep -Fxq "${CONTAINER_NAME}" <(docker ps -a --format '{{.Names}}'); then
  echo "refusing to reuse an existing container name: ${CONTAINER_NAME}" >&2
  exit 1
fi
if grep -Fxq "${VOLUME_NAME}" <(docker volume ls --format '{{.Name}}'); then
  echo "refusing to reuse an existing volume name: ${VOLUME_NAME}" >&2
  exit 1
fi
trap 'exit 130' INT
trap 'exit 143' TERM
trap cleanup EXIT

docker volume create "${VOLUME_NAME}" >/dev/null
VOLUME_CREATED=1
CONTAINER_ID="$(docker run --pull=never --detach \
  --name "${CONTAINER_NAME}" \
  --label "rps.validation=sharepoint-work-instructions" \
  --mount "type=volume,source=${VOLUME_NAME},target=/var/lib/postgresql/data" \
  --env POSTGRES_PASSWORD=postgres \
  --env POSTGRES_DB=borrow_return \
  --publish 127.0.0.1::5432 \
  --health-cmd="pg_isready -U postgres -d borrow_return" \
  --health-interval=2s \
  --health-timeout=5s \
  --health-retries=30 \
  pgvector/pgvector:pg15)"

TEST_PORT="$(docker port "${CONTAINER_ID}" 5432/tcp | sed -n 's/.*:\([0-9][0-9]*\)$/\1/p')"
if [[ -z "${TEST_PORT}" ]]; then
  echo "could not resolve the allocated PostgreSQL host port" >&2
  exit 1
fi

export WORK_INSTRUCTION_CONTAINER="${CONTAINER_NAME}"
export WORK_INSTRUCTION_CONTAINER_ID="${CONTAINER_ID}"
export WORK_INSTRUCTION_VOLUME="${VOLUME_NAME}"
export WORK_INSTRUCTION_TEST_ROOT="${TEST_ROOT}"
export WORK_INSTRUCTION_TEST_PORT="${TEST_PORT}"
export DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:${TEST_PORT}/borrow_return"
export FILE_STORAGE_ROOT="${TEST_ROOT}/files"
export PDF_STORAGE_DIR="${TEST_ROOT}/files"
export PHOTO_STORAGE_DIR="${TEST_ROOT}/files"
export BACKUP_STORAGE_DIR="${TEST_ROOT}/backups"
export BACKUP_CONFIG_PATH="${TEST_ROOT}/backup.json"
export NODE_ENV="test"
export JWT_ACCESS_SECRET="test-access-secret-1234567890"
export JWT_REFRESH_SECRET="test-refresh-secret-1234567890"
mkdir -p "${FILE_STORAGE_ROOT}" "${BACKUP_STORAGE_DIR}"

POSTGRES_HOST=127.0.0.1 POSTGRES_PORT="${TEST_PORT}" \
  scripts/ci/wait-for-postgres.sh "${CONTAINER_ID}" 60

echo "work-instructions validation environment ready"
echo "  container=${CONTAINER_NAME}"
echo "  container_id=${CONTAINER_ID}"
echo "  port=${TEST_PORT}"
echo "  file_storage_root=${FILE_STORAGE_ROOT}"

if [[ "$#" -gt 0 ]]; then
  "$@"
fi
