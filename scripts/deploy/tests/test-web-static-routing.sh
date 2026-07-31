#!/usr/bin/env bash
# Validate the Web image's SPA/asset boundary with an isolated Caddy listener.
# This test creates no Docker volume or network and never touches existing containers.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
CADDY_IMAGE="${WEB_STATIC_ROUTING_CADDY_IMAGE:-caddy:2}"
DIST_DIR="${WEB_STATIC_ROUTING_DIST_DIR:-$ROOT/apps/web/dist}"
RUN_ID="web-static-routing-$$"
CONTAINER_NAME="raspi-$RUN_ID"
RUN_LABEL="raspi.test.run=$RUN_ID"
TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/raspi-web-static-routing.XXXXXX")"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

cleanup() {
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  rm -rf "$TEMP_DIR"
}
trap cleanup EXIT HUP INT TERM

for command in docker curl grep sed node pnpm; do
  command -v "$command" >/dev/null 2>&1 || fail "required command is missing: $command"
done
docker info >/dev/null 2>&1 || fail 'a running Docker daemon is required'

node -e '
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 20 || (major === 20 && minor < 9)) process.exit(1);
' || fail 'Node 20.9 or newer is required'

if [[ "${WEB_STATIC_ROUTING_SKIP_BUILD:-0}" != 1 ]]; then
  (cd "$ROOT" && pnpm --filter @raspi-system/web build)
fi
[[ -f "$DIST_DIR/index.html" ]] || fail "Web build is missing: $DIST_DIR/index.html"

if ! docker image inspect "$CADDY_IMAGE" >/dev/null 2>&1; then
  docker pull "$CADDY_IMAGE" >/dev/null
fi

for config in Caddyfile Caddyfile.production Caddyfile.local.template; do
  docker run --rm --label "$RUN_LABEL" -e DOMAIN=example.test \
    --volume "$ROOT/infrastructure/docker/$config:/etc/caddy/Caddyfile:ro" \
    "$CADDY_IMAGE" caddy adapt --config /etc/caddy/Caddyfile >/dev/null
done
sed 's|${SLOT_API_UPSTREAM}|api-slot:8080|g' \
  "$ROOT/infrastructure/docker/Caddyfile.slot.template" \
  | docker run --rm --interactive --label "$RUN_LABEL" \
      "$CADDY_IMAGE" caddy adapt --config - >/dev/null

docker run --detach --rm \
  --name "$CONTAINER_NAME" \
  --label "$RUN_LABEL" \
  --publish 127.0.0.1::80 \
  --volume "$DIST_DIR:/srv/site:ro" \
  --volume "$ROOT/infrastructure/docker/Caddyfile:/etc/caddy/Caddyfile:ro" \
  "$CADDY_IMAGE" >/dev/null

port="$(docker port "$CONTAINER_NAME" 80/tcp | sed -nE 's/.*:([0-9]+)$/\1/p' | head -n 1)"
[[ -n "$port" ]] || fail 'could not determine the Caddy host port'
base_url="http://127.0.0.1:$port"

status=''
for _attempt in $(seq 1 40); do
  status="$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 2 "$base_url/" || true)"
  [[ "$status" == 200 ]] && break
  sleep 0.25
done
[[ "$status" == 200 ]] || fail "Caddy did not become ready; last HTTP status: ${status:-none}"

deep_status="$(curl --silent --show-error \
  --dump-header "$TEMP_DIR/deep.headers" \
  --output "$TEMP_DIR/deep.body" \
  --write-out '%{http_code}' \
  "$base_url/kiosk/part-measurement/inspection")"
[[ "$deep_status" == 200 ]] || fail "SPA deep link returned HTTP $deep_status"
grep -Eiq '^Content-Type:[[:space:]]*text/html' "$TEMP_DIR/deep.headers" \
  || fail 'SPA deep link was not HTML'
grep -Eiq '^Cache-Control:.*no-store' "$TEMP_DIR/deep.headers" \
  || fail 'SPA deep link did not disable HTML caching'
grep -Fq '<div id="root"></div>' "$TEMP_DIR/deep.body" \
  || fail 'SPA deep link did not return the Web entry document'

asset_path="$(
  sed -nE 's#.*src="(/assets/[^\"]+\.js)".*#\1#p' "$DIST_DIR/index.html" | head -n 1
)"
[[ -n "$asset_path" ]] || fail 'could not find a built JavaScript asset in index.html'
asset_status="$(curl --silent --show-error \
  --dump-header "$TEMP_DIR/asset.headers" \
  --output "$TEMP_DIR/asset.body" \
  --write-out '%{http_code}' \
  "$base_url$asset_path")"
[[ "$asset_status" == 200 ]] || fail "built JavaScript asset returned HTTP $asset_status"
grep -Eiq '^Content-Type:[[:space:]]*(text|application)/javascript' "$TEMP_DIR/asset.headers" \
  || fail 'built JavaScript asset had the wrong content type'

missing_status="$(curl --silent --show-error \
  --dump-header "$TEMP_DIR/missing.headers" \
  --output "$TEMP_DIR/missing.body" \
  --write-out '%{http_code}' \
  "$base_url/assets/old-missing-chunk.js")"
[[ "$missing_status" == 404 ]] || fail "missing JavaScript asset returned HTTP $missing_status"
if grep -Eiq '^Content-Type:[[:space:]]*text/html' "$TEMP_DIR/missing.headers" \
  || grep -Fq '<div id="root"></div>' "$TEMP_DIR/missing.body"; then
  fail 'missing JavaScript asset was rewritten to the SPA document'
fi

cleanup
trap - EXIT HUP INT TERM
if docker ps --all --quiet --filter "label=$RUN_LABEL" | grep -q .; then
  fail "temporary Docker resources remain for $RUN_LABEL"
fi

echo 'PASS: Web static routing keeps missing assets out of the SPA fallback'
