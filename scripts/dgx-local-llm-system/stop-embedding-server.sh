#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME="${EMBEDDING_CONTAINER_NAME:-system-prod-embedding}"

if ! docker ps -a --format '{{.Names}}' | grep -Fxq "${CONTAINER_NAME}"; then
  echo "embedding-server container not found"
  exit 0
fi

docker rm -f "${CONTAINER_NAME}" >/dev/null
echo "stopped container=${CONTAINER_NAME}"
