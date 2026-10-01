#!/usr/bin/env bash
# Validate the Web image's SPA/asset boundary with an isolated Caddy listener.
# This test creates no Docker volume or network and never touches existing containers.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
PNPM="${ROOT}/scripts/ci/pnpm-exact.sh"
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

for command in docker curl grep sed node corepack; do
  command -v "$command" >/dev/null 2>&1 || fail "required command is missing: $command"
done
docker info >/dev/null 2>&1 || fail 'a running Docker daemon is required'

node -e '
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 20 || (major === 20 && minor < 9)) process.exit(1);
' || fail 'Node 20.9 or newer is required'

if [[ "${WEB_STATIC_ROUTING_SKIP_BUILD:-0}" != 1 ]]; then
  (
    cd "$ROOT"
    "$PNPM" --filter @raspi-system/shared-types build
    "$PNPM" --filter @raspi-system/part-search-core build
    "$PNPM" --filter @raspi-system/shelf-layout-core build
    "$PNPM" --filter @raspi-system/web build
  )
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

# Caddy owns {$ADMIN_ALLOW_NETS} expansion. A generic envsubst pass would leave
# braces around the CIDR list and make the production candidate fail validation.
docker run --rm --label "$RUN_LABEL" \
  -e ADMIN_ALLOW_NETS="127.0.0.1/32 192.168.10.0/24" \
  --volume "$ROOT/infrastructure/docker/Caddyfile.local.template:/etc/caddy/Caddyfile:ro" \
  "$CADDY_IMAGE" caddy adapt --config /etc/caddy/Caddyfile >/dev/null
sed 's|${SLOT_API_UPSTREAM}|api-slot:8080|g' \
  "$ROOT/infrastructure/docker/Caddyfile.slot.template" \
  | docker run --rm --interactive --label "$RUN_LABEL" \
      "$CADDY_IMAGE" caddy adapt --config - >/dev/null

# Blue/Green: only the gateway limits /admin. The slot stays open because the
# API opens its own slot directly on the private Docker network.
wait_for_status() {
  local url="$1" status=''
  for _attempt in $(seq 1 40); do
    status="$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 2 "$url" || true)"
    [[ "$status" != 000 ]] && break
    sleep 0.25
  done
  printf '%s' "$status"
}

published_port() {
  docker port "$CONTAINER_NAME" 80/tcp | sed -nE 's/.*:([0-9]+)$/\1/p' | head -n 1
}

sed -e 's|__BLUE_GREEN_API_UPSTREAM__|api-slot.invalid:8080|g' \
  -e 's|__BLUE_GREEN_WEB_UPSTREAM__|web-slot.invalid:80|g' \
  "$ROOT/infrastructure/docker/Caddyfile.gateway.http.template" >"$TEMP_DIR/Caddyfile.gateway"
if docker run --rm --label "$RUN_LABEL" \
  --volume "$TEMP_DIR/Caddyfile.gateway:/srv/bluegreen/Caddyfile:ro" \
  "$CADDY_IMAGE" caddy adapt --config /srv/bluegreen/Caddyfile >/dev/null 2>&1; then
  fail 'gateway accepted a route without its administrator allowlist file'
fi

# 192.0.2.0/24 is documentation-only, so this client is always outside it.
for policy in outside inside; do
  if [[ "$policy" == outside ]]; then
    printf 'not remote_ip 192.0.2.0/24\n' >"$TEMP_DIR/admin-allow-nets.caddy"
  else
    printf 'not remote_ip 0.0.0.0/0 ::/0\n' >"$TEMP_DIR/admin-allow-nets.caddy"
  fi
  docker run --detach --rm \
    --name "$CONTAINER_NAME" \
    --label "$RUN_LABEL" \
    --publish 127.0.0.1::80 \
    --volume "$TEMP_DIR/Caddyfile.gateway:/srv/bluegreen/Caddyfile:ro" \
    --volume "$TEMP_DIR/admin-allow-nets.caddy:/srv/bluegreen/admin-allow-nets.caddy:ro" \
    "$CADDY_IMAGE" caddy run --config /srv/bluegreen/Caddyfile >/dev/null
  gateway_url="http://127.0.0.1:$(published_port)"
  admin_status="$(wait_for_status "$gateway_url/admin/signage")"
  kiosk_status="$(wait_for_status "$gateway_url/kiosk")"
  [[ "$kiosk_status" != 403 && "$kiosk_status" != 000 ]] \
    || fail "gateway returned HTTP $kiosk_status for a non-admin route ($policy)"
  if [[ "$policy" == outside ]]; then
    [[ "$admin_status" == 403 ]] || fail "gateway returned HTTP $admin_status for /admin outside the allowlist"
  else
    [[ "$admin_status" != 403 && "$admin_status" != 000 ]] \
      || fail "gateway returned HTTP $admin_status for /admin inside the allowlist"
  fi
  docker rm -f "$CONTAINER_NAME" >/dev/null
done

sed 's|${SLOT_API_UPSTREAM}|api-slot.invalid:8080|g' \
  "$ROOT/infrastructure/docker/Caddyfile.slot.template" >"$TEMP_DIR/Caddyfile.slot"
docker run --detach --rm \
  --name "$CONTAINER_NAME" \
  --label "$RUN_LABEL" \
  --publish 127.0.0.1::80 \
  --volume "$DIST_DIR:/srv/site:ro" \
  --volume "$TEMP_DIR/Caddyfile.slot:/etc/caddy/Caddyfile:ro" \
  "$CADDY_IMAGE" >/dev/null
slot_admin_status="$(wait_for_status "http://127.0.0.1:$(published_port)/admin/signage")"
[[ "$slot_admin_status" == 200 ]] || fail "private Web slot returned HTTP $slot_admin_status for /admin"
docker rm -f "$CONTAINER_NAME" >/dev/null

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
