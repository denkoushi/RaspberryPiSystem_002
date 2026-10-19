#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
validation_id="kiosk-sop-production-$$"
image_tag="raspisys-kiosk-sop-web:$validation_id"
container_name="raspi-$validation_id"
network_name="raspi-$validation_id"
validation_label="raspi.validation.id=$validation_id"
playwright_image="raspisys-kiosk-sop-generator:playwright-1.56.1"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

cleanup() {
  docker rm --force "$container_name" >/dev/null 2>&1 || true
  docker network rm "$network_name" >/dev/null 2>&1 || true
  docker image rm --force "$image_tag" >/dev/null 2>&1 || true
}
trap cleanup EXIT HUP INT TERM

for command in curl docker sed; do
  command -v "$command" >/dev/null 2>&1 || fail "required command is missing: $command"
done
docker info >/dev/null 2>&1 || fail 'a running Docker daemon is required'

if ! docker image inspect "$playwright_image" >/dev/null 2>&1; then
  docker build \
    --file "$repo_root/infrastructure/docker/Dockerfile.kiosk-sop-generator" \
    --tag "$playwright_image" \
    "$repo_root"
fi

docker build \
  --file "$repo_root/infrastructure/docker/Dockerfile.web" \
  --build-arg VITE_KIOSK_SOP_POPUP_ENABLED=true \
  --tag "$image_tag" \
  "$repo_root"

docker network create --label "$validation_label" "$network_name" >/dev/null

docker run --detach --rm \
  --name "$container_name" \
  --label "$validation_label" \
  --network "$network_name" \
  --network-alias web \
  --publish 127.0.0.1::80 \
  "$image_tag" >/dev/null

port="$(docker port "$container_name" 80/tcp | sed -nE 's/.*:([0-9]+)$/\1/p' | head -n 1)"
[[ -n "$port" ]] || fail 'could not determine the temporary Caddy port'
base_url="http://127.0.0.1:$port"

status=''
for _attempt in $(seq 1 80); do
  status="$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 2 "$base_url/" || true)"
  [[ "$status" == 200 ]] && break
  sleep 0.25
done
[[ "$status" == 200 ]] || fail "temporary Caddy did not become ready: ${status:-none}"

docker run --rm --init --ipc=host \
  --label "$validation_label" \
  --network "$network_name" \
  --env KIOSK_SOP_BASE_URL=http://web \
  --volume "$repo_root/e2e:/workspace/e2e:ro" \
  --volume "$repo_root/playwright.kiosk-sop.config.ts:/workspace/playwright.kiosk-sop.config.ts:ro" \
  "$playwright_image" \
  pnpm exec playwright test --config=playwright.kiosk-sop.config.ts --grep @production-bundle

cleanup
trap - EXIT HUP INT TERM

if docker ps --all --quiet --filter "label=$validation_label" | grep -q .; then
  fail "temporary container remains for $validation_id"
fi
if docker image inspect "$image_tag" >/dev/null 2>&1; then
  fail "temporary image remains: $image_tag"
fi
if docker network inspect "$network_name" >/dev/null 2>&1; then
  fail "temporary network remains: $network_name"
fi

echo "Production kiosk SOP bundle validation passed and temporary Docker resources were removed."
