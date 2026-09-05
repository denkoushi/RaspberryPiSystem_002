#!/usr/bin/env bash
set -euo pipefail

# Exercise the pinned egress image with the same read-only/cap-drop boundary
# as the production Compose service. A Docker-managed volume is used to create
# a different-owner source file, then its daemon mountpoint is bind-mounted so
# the fixture retains Linux ownership semantics on Docker Desktop too.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
IMAGE="${BUSINESS_HERMES_EGRESS_IMAGE:-node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293}"
VOLUME="business-hermes-egress-permission-${PPID}-${RANDOM}"

if ! command -v docker >/dev/null 2>&1 || ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "Business Hermes egress permission fixture requires the pinned image: $IMAGE" >&2
  exit 77
fi

cleanup() {
  docker volume rm "$VOLUME" >/dev/null 2>&1 || true
}
trap cleanup EXIT HUP INT TERM

docker volume create "$VOLUME" >/dev/null
VOLUME_MOUNTPOINT="$(docker volume inspect --format '{{.Mountpoint}}' "$VOLUME")"
PROXY_SOURCE="$ROOT_DIR/infrastructure/docker/business-hermes-egress/proxy.mjs"

docker run --rm \
  --mount "type=bind,src=$PROXY_SOURCE,dst=/repo/proxy.mjs,readonly" \
  --mount "type=volume,src=$VOLUME,dst=/fixture" \
  "$IMAGE" sh -c 'cp /repo/proxy.mjs /fixture/proxy.mjs && chown 1001:1001 /fixture/proxy.mjs && chmod 0600 /fixture/proxy.mjs'

set +e
EACCES_OUTPUT="$(docker run --rm --read-only --cap-drop=ALL \
  --security-opt no-new-privileges:true \
  --user 0:0 \
  --mount "type=bind,src=$VOLUME_MOUNTPOINT/proxy.mjs,dst=/opt/business-hermes-egress/proxy.mjs,readonly" \
  "$IMAGE" node /opt/business-hermes-egress/proxy.mjs 2>&1)"
EACCES_STATUS=$?
set -e
if [[ "$EACCES_STATUS" -eq 0 ]] || [[ "$EACCES_OUTPUT" != *"EACCES"* ]]; then
  echo "Expected cap-drop egress startup to fail with EACCES for mode 0600 source" >&2
  exit 1
fi

docker run --rm \
  --mount "type=volume,src=$VOLUME,dst=/fixture" \
  "$IMAGE" chmod 0644 /fixture/proxy.mjs

docker run --rm --read-only --cap-drop=ALL \
  --security-opt no-new-privileges:true \
  --tmpfs /tmp:rw,nosuid,nodev,mode=1777,size=16m \
  --user 0:0 \
  --mount "type=bind,src=$VOLUME_MOUNTPOINT/proxy.mjs,dst=/opt/business-hermes-egress/proxy.mjs,readonly" \
  "$IMAGE" sh -c '
    node /opt/business-hermes-egress/proxy.mjs >/dev/null 2>&1 &
    pid=$!
    for attempt in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
      if node -e "fetch(\"http://127.0.0.1:3128/health\").then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
        kill "$pid" 2>/dev/null || true
        wait "$pid" 2>/dev/null || true
        exit 0
      fi
      sleep 0.1
    done
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
    exit 1
  '

echo "business-hermes egress permission fixture passed"
