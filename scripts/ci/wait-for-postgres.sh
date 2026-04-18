#!/usr/bin/env bash
# Wait until PostgreSQL inside a Docker container accepts connections.
# Usage: wait-for-postgres.sh <container_name> [timeout_seconds]
set -euo pipefail

CONTAINER="${1:?container name required}"
TIMEOUT="${2:-60}"

elapsed=0
until docker exec "$CONTAINER" pg_isready -U postgres 2>/dev/null; do
  if [ "$elapsed" -ge "$TIMEOUT" ]; then
    echo "PostgreSQL in $CONTAINER failed to start within ${TIMEOUT}s"
    docker logs "$CONTAINER" || true
    exit 1
  fi
  echo "Waiting for PostgreSQL in $CONTAINER... ($elapsed/${TIMEOUT}s)"
  sleep 2
  elapsed=$((elapsed + 2))
done

echo "PostgreSQL in $CONTAINER is ready!"
