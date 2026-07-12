#!/usr/bin/env bash
# Exercise the maintenance listener with real containers.  This deliberately
# injects a missing maintenance asset after the gateway releases its port, then
# proves that the gateway can reclaim the same port and that legacy can do so
# after the gateway stops.  It never uses the production compose project.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
CADDY_IMAGE="${PI5_BLUE_GREEN_TEST_CADDY_IMAGE:-caddy:2}"
GATEWAY_CONFIG="$ROOT/infrastructure/docker/Caddyfile.gateway.maintenance.http.template"
LEGACY_CONFIG="$ROOT/infrastructure/docker/Caddyfile.maintenance.http"
MAINTENANCE_HTML="$ROOT/infrastructure/docker/maintenance.html"
NAME_PREFIX="pi5-bg-maintenance-test-$$"
CONTAINERS=()

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

cleanup() {
  local name
  set +u
  for name in "${CONTAINERS[@]}"; do
    docker rm -f "$name" >/dev/null 2>&1 || true
  done
}
trap cleanup EXIT

require_file() {
  [[ -f "$1" ]] || fail "required file is missing: $1"
}

wait_for_status() {
  local url="$1"
  local expected="$2"
  local status=''
  local attempt
  for attempt in $(seq 1 40); do
    status="$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 2 "$url" || true)"
    [[ "$status" == "$expected" ]] && return 0
    sleep 0.25
  done
  fail "expected HTTP $expected from $url, got ${status:-no response}"
}

container_port() {
  docker port "$1" 80/tcp | sed -nE 's/.*:([0-9]+)$/\1/p' | head -n 1
}

start_maintenance() {
  local name="$1"
  local config="$2"
  local host_port="${3:-}"
  local with_asset="${4:-true}"
  local publish="127.0.0.1::80"
  local -a args=(
    docker run --detach --rm --name "$name"
    --publish "$publish"
    --volume "$config:/etc/caddy/Caddyfile:ro"
  )

  if [[ -n "$host_port" ]]; then
    publish="127.0.0.1:${host_port}:80"
    args=(
      docker run --detach --rm --name "$name"
      --publish "$publish"
      --volume "$config:/etc/caddy/Caddyfile:ro"
    )
  fi
  if [[ "$with_asset" == true ]]; then
    args+=(--volume "$MAINTENANCE_HTML:/srv/phase2-maintenance/index.html:ro")
  fi
  args+=("$CADDY_IMAGE" caddy run --config /etc/caddy/Caddyfile --adapter caddyfile)

  "${args[@]}" >/dev/null
  CONTAINERS+=("$name")
}

stop_container() {
  docker rm -f "$1" >/dev/null
}

command -v docker >/dev/null 2>&1 || fail 'docker is required for the maintenance container test'
command -v curl >/dev/null 2>&1 || fail 'curl is required for the maintenance container test'
docker info >/dev/null 2>&1 || fail 'a running Docker daemon is required for the maintenance container test'
require_file "$GATEWAY_CONFIG"
require_file "$LEGACY_CONFIG"
require_file "$MAINTENANCE_HTML"

if ! docker image inspect "$CADDY_IMAGE" >/dev/null 2>&1; then
  docker pull "$CADDY_IMAGE" >/dev/null
fi

# The fixed gateway must serve the packaged maintenance page on its published
# listener before it can be used as a fail-closed recovery endpoint.
gateway="$NAME_PREFIX-gateway"
start_maintenance "$gateway" "$GATEWAY_CONFIG"
port="$(container_port "$gateway")"
[[ -n "$port" ]] || fail 'could not determine the gateway host port'
url="http://127.0.0.1:${port}/"
wait_for_status "$url" 200
curl --fail --silent --show-error "$url" | grep -Fq 'ただいま更新中です' \
  || fail 'gateway did not serve the packaged maintenance page'

# Failure injection: after the gateway frees the port, an incomplete recovery
# listener without the maintenance asset returns 404.  Once removed, gateway
# maintenance must reclaim exactly that port and become available again.
stop_container "$gateway"
broken="$NAME_PREFIX-broken"
start_maintenance "$broken" "$GATEWAY_CONFIG" "$port" false
wait_for_status "$url" 404
stop_container "$broken"

recovery="$NAME_PREFIX-recovery"
start_maintenance "$recovery" "$GATEWAY_CONFIG" "$port"
wait_for_status "$url" 200

# A restored legacy listener can bind only after the maintenance gateway has
# released the port; this catches the historical gateway/legacy port collision.
stop_container "$recovery"
legacy="$NAME_PREFIX-legacy"
start_maintenance "$legacy" "$LEGACY_CONFIG" "$port"
wait_for_status "$url" 200

echo 'PASS: Pi5 Blue/Green maintenance container recovery'
