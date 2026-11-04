#!/usr/bin/env bash
set -euo pipefail

# Run immediately after migrate deploy, before starting any API/test connections.
# Vitest 4.1.11 reuses pool IDs 1..maxWorkers (not the increasing worker ID).
container=${1:?Usage: prepare-api-test-databases.sh CONTAINER WORKERS}
workers=${2:?Usage: prepare-api-test-databases.sh CONTAINER WORKERS}
if [[ ! "$workers" =~ ^[1-9][0-9]*$ ]]; then
  echo 'WORKERS must be a positive integer' >&2
  exit 1
fi

# Connect to postgres, never the template. Clear lingering migration connections;
# the caller must keep API/test processes stopped until all copies are ready.
docker exec "$container" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'borrow_return' AND pid <> pg_backend_pid();"
for ((worker = 1; worker <= workers; worker++)); do
  docker exec "$container" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 \
    -c "DROP DATABASE IF EXISTS borrow_return_w${worker};" \
    -c "CREATE DATABASE borrow_return_w${worker} TEMPLATE borrow_return;"
done
