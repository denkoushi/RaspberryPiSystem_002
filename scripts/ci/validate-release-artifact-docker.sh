#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONTRACT=""
SHA=""

usage() {
  cat <<'EOF'
Usage: validate-release-artifact-docker.sh --contract FILE --sha FULL_SHA

Builds the production API/Web Dockerfiles as native ARM64 images, moves their
immutable digests through an isolated loopback registry, validates one strict
release set, and removes only resources created by this run.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --contract) CONTRACT="${2:-}"; shift 2 ;;
    --sha) SHA="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done

[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || {
  echo "release SHA is malformed" >&2
  exit 78
}
[[ "$CONTRACT" == /* && -f "$CONTRACT" && ! -L "$CONTRACT" ]] || {
  echo "sealed build contract is unavailable" >&2
  exit 78
}

python3 "$ROOT/scripts/deploy/release_build_contract.py" validate \
  --release-sha "$SHA" <"$CONTRACT" >/dev/null
CONFIG_HASH="$(
  python3 "$ROOT/scripts/deploy/release_build_contract.py" hash \
    --release-sha "$SHA" <"$CONTRACT"
)"
[[ "$CONFIG_HASH" =~ ^[0-9a-f]{64}$ ]] || exit 78

RUN_SUFFIX="$(
  python3 -c 'import uuid; print(uuid.uuid4().hex[:12])'
)"
RUN_ID="raspi-phase2-${RUN_SUFFIX}"
LABEL="com.raspi-system.validation-run=${RUN_ID}"
REGISTRY_VOLUME="${RUN_ID}-registry"
REGISTRY_CONTAINER="${RUN_ID}-registry"
EXTRACT_CONTAINER="${RUN_ID}-extract"
TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/${RUN_ID}.XXXXXX")"
API_LOCAL="${RUN_ID}-api:${SHA}"
WEB_LOCAL="${RUN_ID}-web:${SHA}"
RELEASE_LOCAL="${RUN_ID}-release-set:${SHA}"
API_REGISTRY=""
WEB_REGISTRY=""
RELEASE_REGISTRY=""
API_CANDIDATE="${RUN_ID}-candidate-api:${SHA}"
WEB_CANDIDATE="${RUN_ID}-candidate-web:${SHA}"

cleanup() {
  local rc=$?
  set +e
  docker rm -f "$EXTRACT_CONTAINER" "$REGISTRY_CONTAINER" >/dev/null 2>&1
  for image in \
    "$API_CANDIDATE" "$WEB_CANDIDATE" \
    "$API_REGISTRY" "$WEB_REGISTRY" "$RELEASE_REGISTRY" \
    "$API_LOCAL" "$WEB_LOCAL" "$RELEASE_LOCAL"
  do
    [[ -z "$image" ]] || docker image rm -f "$image" >/dev/null 2>&1
  done
  docker volume rm "$REGISTRY_VOLUME" >/dev/null 2>&1
  rm -rf "$TEMP_DIR"
  if [[ -n "$(docker ps -aq --filter "label=${LABEL}" 2>/dev/null)" ]] \
    || [[ -n "$(docker network ls -q --filter "label=${LABEL}" 2>/dev/null)" ]] \
    || [[ -n "$(docker volume ls -q --filter "label=${LABEL}" 2>/dev/null)" ]]
  then
    echo "run-owned Docker resources remain after cleanup: ${RUN_ID}" >&2
    rc=1
  fi
  trap - EXIT INT TERM
  exit "$rc"
}
trap cleanup EXIT INT TERM

docker volume create --label "$LABEL" "$REGISTRY_VOLUME" >/dev/null
REGISTRY_PORT="$(
  python3 -c 'import secrets; print(50000 + secrets.randbelow(10000))'
)"
docker run -d \
  --name "$REGISTRY_CONTAINER" \
  --label "$LABEL" \
  --network host \
  -e "REGISTRY_HTTP_ADDR=127.0.0.1:${REGISTRY_PORT}" \
  -v "${REGISTRY_VOLUME}:/var/lib/registry" \
  registry:2 >/dev/null
[[ "$REGISTRY_PORT" =~ ^[0-9]+$ ]] || {
  echo "loopback registry port is unavailable" >&2
  exit 1
}
# The registry shares the Docker VM network namespace and binds only that
# namespace's loopback address. The daemon therefore reaches it directly,
# while no Mac host or LAN port is published.
REGISTRY="127.0.0.1:${REGISTRY_PORT}"
sleep 1
[[ "$(docker inspect "$REGISTRY_CONTAINER" --format '{{.State.Running}}')" \
    == "true" ]] || {
  docker logs "$REGISTRY_CONTAINER" >&2 || true
  echo "loopback registry did not become ready" >&2
  exit 1
}

api_build_args=()
while IFS= read -r -d '' value; do
  api_build_args+=("$value")
done < <(
  python3 "$ROOT/scripts/deploy/release_build_contract.py" emit-build-args \
    --release-sha "$SHA" --service api <"$CONTRACT"
)
web_build_args=()
while IFS= read -r -d '' value; do
  web_build_args+=("$value")
done < <(
  python3 "$ROOT/scripts/deploy/release_build_contract.py" emit-build-args \
    --release-sha "$SHA" --service web <"$CONTRACT"
)

docker buildx build \
  --platform linux/arm64 \
  --file "$ROOT/infrastructure/docker/Dockerfile.api" \
  --tag "$API_LOCAL" \
  --load \
  --provenance=false \
  --sbom=false \
  --build-arg "BUILD_COMMIT=${SHA}" \
  --build-arg "BUILD_CONFIG_HASH=${CONFIG_HASH}" \
  "${api_build_args[@]}" \
  "$ROOT"
docker buildx build \
  --platform linux/arm64 \
  --file "$ROOT/infrastructure/docker/Dockerfile.web" \
  --tag "$WEB_LOCAL" \
  --load \
  --provenance=false \
  --sbom=false \
  --build-arg "BUILD_COMMIT=${SHA}" \
  --build-arg "BUILD_CONFIG_HASH=${CONFIG_HASH}" \
  "${web_build_args[@]}" \
  "$ROOT"

if [[ "$(docker inspect "$REGISTRY_CONTAINER" --format '{{.State.Running}}')" \
    != "true" ]]
then
  docker logs "$REGISTRY_CONTAINER" >&2 || true
  echo "loopback registry stopped during image builds" >&2
  exit 1
fi

API_REGISTRY="${REGISTRY}/raspisys-api:${SHA}-${CONFIG_HASH:0:16}"
WEB_REGISTRY="${REGISTRY}/raspisys-web:${SHA}-${CONFIG_HASH:0:16}"
docker image tag "$API_LOCAL" "$API_REGISTRY"
docker image tag "$WEB_LOCAL" "$WEB_REGISTRY"
docker push "$API_REGISTRY" >/dev/null
docker push "$WEB_REGISTRY" >/dev/null
API_DIGEST="$(
  docker image inspect "$API_REGISTRY" \
    --format '{{index .RepoDigests 0}}' | sed -E 's/^.*@(sha256:[0-9a-f]{64})$/\1/'
)"
WEB_DIGEST="$(
  docker image inspect "$WEB_REGISTRY" \
    --format '{{index .RepoDigests 0}}' | sed -E 's/^.*@(sha256:[0-9a-f]{64})$/\1/'
)"
[[ "$API_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]] || exit 1
[[ "$WEB_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]] || exit 1

python3 "$ROOT/scripts/deploy/release_artifact_contract.py" create \
  --repository denkoushi/RaspberryPiSystem_002 \
  --sha "$SHA" \
  --config-hash "$CONFIG_HASH" \
  --api-repository ghcr.io/denkoushi/raspisys-api \
  --api-digest "$API_DIGEST" \
  --web-repository ghcr.io/denkoushi/raspisys-web \
  --web-digest "$WEB_DIGEST" \
  --workflow .github/workflows/ci.yml \
  --run-id 1 \
  --run-attempt 1 \
  >"$TEMP_DIR/release-set.json"
docker buildx build \
  --platform linux/arm64 \
  --file "$ROOT/infrastructure/docker/Dockerfile.release-set" \
  --tag "$RELEASE_LOCAL" \
  --load \
  --provenance=false \
  --sbom=false \
  --build-arg "BUILD_COMMIT=${SHA}" \
  --build-arg "BUILD_CONFIG_HASH=${CONFIG_HASH}" \
  "$TEMP_DIR"
RELEASE_REGISTRY="${REGISTRY}/raspisys-release-set:${SHA}-${CONFIG_HASH}"
docker image tag "$RELEASE_LOCAL" "$RELEASE_REGISTRY"
docker push "$RELEASE_REGISTRY" >/dev/null
RELEASE_DIGEST="$(
  docker image inspect "$RELEASE_REGISTRY" \
    --format '{{index .RepoDigests 0}}' | sed -E 's/^.*@(sha256:[0-9a-f]{64})$/\1/'
)"
[[ "$RELEASE_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]] || exit 1

docker image rm -f "$API_LOCAL" "$WEB_LOCAL" "$RELEASE_LOCAL" >/dev/null
docker pull "${API_REGISTRY%@*}@${API_DIGEST}" >/dev/null
docker pull "${WEB_REGISTRY%@*}@${WEB_DIGEST}" >/dev/null
docker pull "${RELEASE_REGISTRY%@*}@${RELEASE_DIGEST}" >/dev/null
docker image tag "${API_REGISTRY%@*}@${API_DIGEST}" "$API_CANDIDATE"
docker image tag "${WEB_REGISTRY%@*}@${WEB_DIGEST}" "$WEB_CANDIDATE"

for image in "$API_CANDIDATE" "$WEB_CANDIDATE"; do
  [[ "$(docker image inspect "$image" --format '{{.Os}}/{{.Architecture}}')" \
      == "linux/arm64" ]] || exit 1
  [[ "$(docker image inspect "$image" \
      --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" \
      == "$SHA" ]] || exit 1
  [[ "$(docker image inspect "$image" \
      --format '{{index .Config.Labels "org.opencontainers.image.config-hash"}}')" \
      == "$CONFIG_HASH" ]] || exit 1
done

docker run --rm "$API_CANDIDATE" \
  node -e \
  "const fs=require('fs'); process.exit(fs.existsSync('dist/main.js') && fs.existsSync('prisma/schema.prisma') ? 0 : 1)"
docker run --rm "$WEB_CANDIDATE" \
  caddy validate --config /srv/Caddyfile

docker create \
  --name "$EXTRACT_CONTAINER" \
  --label "$LABEL" \
  "${RELEASE_REGISTRY%@*}@${RELEASE_DIGEST}" \
  /release-set.json >/dev/null
docker cp "$EXTRACT_CONTAINER:/release-set.json" "$TEMP_DIR/extracted.json"
docker rm -f "$EXTRACT_CONTAINER" >/dev/null
python3 "$ROOT/scripts/deploy/release_artifact_contract.py" verify \
  --repository denkoushi/RaspberryPiSystem_002 \
  --sha "$SHA" \
  --config-hash "$CONFIG_HASH" \
  --workflow .github/workflows/ci.yml \
  <"$TEMP_DIR/extracted.json" >/dev/null

printf 'release artifact Docker validation passed: run=%s api=%s web=%s release-set=%s\n' \
  "$RUN_ID" "$API_DIGEST" "$WEB_DIGEST" "$RELEASE_DIGEST"
