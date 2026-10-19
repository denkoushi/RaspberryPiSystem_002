#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUN_SUFFIX="$(python3 -c 'import uuid; print(uuid.uuid4().hex[:12])')"
RUN_ID="raspi-pull-progress-${RUN_SUFFIX}"
LABEL="com.raspi-system.validation-run=${RUN_ID}"
TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/${RUN_ID}.XXXXXX")"
REGISTRY_CONTAINER="${RUN_ID}-registry"
REGISTRY_VOLUME="${RUN_ID}-registry"
LAYER_ONE_CONTAINER="${RUN_ID}-layer-one"
LAYER_TWO_CONTAINER="${RUN_ID}-layer-two"
LAYER_ONE_IMAGE="${RUN_ID}-layer-one:local"
FINAL_IMAGE="${RUN_ID}-final:local"
REGISTRY_REFERENCE=""
DIGEST_REFERENCE=""
RESULT_PATH="${TEMP_DIR}/result.json"

BASELINE_CONTAINERS=()
while IFS= read -r value; do
  [[ -z "$value" ]] || BASELINE_CONTAINERS+=("$value")
done < <(docker ps -aq)
BASELINE_VOLUMES=()
while IFS= read -r value; do
  [[ -z "$value" ]] || BASELINE_VOLUMES+=("$value")
done < <(docker volume ls -q)
BASELINE_NETWORKS=()
while IFS= read -r value; do
  [[ -z "$value" ]] || BASELINE_NETWORKS+=("$value")
done < <(docker network ls -q)

cleanup() {
  local rc=$?
  set +e
  set +u
  docker rm -f \
    "$LAYER_ONE_CONTAINER" \
    "$LAYER_TWO_CONTAINER" \
    "$REGISTRY_CONTAINER" >/dev/null 2>&1
  for image in \
    "$DIGEST_REFERENCE" \
    "$REGISTRY_REFERENCE" \
    "$FINAL_IMAGE" \
    "$LAYER_ONE_IMAGE"
  do
    [[ -z "$image" ]] || docker image rm -f "$image" >/dev/null 2>&1
  done
  docker volume rm "$REGISTRY_VOLUME" >/dev/null 2>&1
  rm -rf "$TEMP_DIR"

  for container in "${BASELINE_CONTAINERS[@]}"; do
    docker inspect "$container" >/dev/null 2>&1 || {
      echo "pre-existing Docker container disappeared: ${container}" >&2
      rc=1
    }
  done
  for volume in "${BASELINE_VOLUMES[@]}"; do
    docker volume inspect "$volume" >/dev/null 2>&1 || {
      echo "pre-existing Docker volume disappeared: ${volume}" >&2
      rc=1
    }
  done
  for network in "${BASELINE_NETWORKS[@]}"; do
    docker network inspect "$network" >/dev/null 2>&1 || {
      echo "pre-existing Docker network disappeared: ${network}" >&2
      rc=1
    }
  done
  if [[ -n "$(docker ps -aq --filter "label=${LABEL}" 2>/dev/null)" ]] \
    || [[ -n "$(docker volume ls -q --filter "label=${LABEL}" 2>/dev/null)" ]] \
    || [[ -n "$(docker network ls -q --filter "label=${LABEL}" 2>/dev/null)" ]]
  then
    echo "run-owned Docker resources remain after cleanup: ${RUN_ID}" >&2
    rc=1
  fi
  trap - EXIT INT TERM
  exit "$rc"
}
trap cleanup EXIT INT TERM

printf 'Docker baseline: containers=%s volumes=%s networks=%s\n' \
  "${#BASELINE_CONTAINERS[@]}" \
  "${#BASELINE_VOLUMES[@]}" \
  "${#BASELINE_NETWORKS[@]}"

docker volume create --label "$LABEL" "$REGISTRY_VOLUME" >/dev/null
REGISTRY_PORT="$(python3 -c 'import secrets; print(50000 + secrets.randbelow(10000))')"
docker run -d \
  --name "$REGISTRY_CONTAINER" \
  --label "$LABEL" \
  --network host \
  -e "REGISTRY_HTTP_ADDR=127.0.0.1:${REGISTRY_PORT}" \
  -v "${REGISTRY_VOLUME}:/var/lib/registry" \
  registry:2 >/dev/null
REGISTRY="127.0.0.1:${REGISTRY_PORT}"
for _attempt in $(seq 1 20); do
  if [[ "$(docker inspect "$REGISTRY_CONTAINER" --format '{{.State.Running}}')" \
      == "true" ]] \
    && docker logs "$REGISTRY_CONTAINER" 2>&1 | grep -q "listening on"
  then
    break
  fi
  sleep 0.25
done
[[ "$(docker inspect "$REGISTRY_CONTAINER" --format '{{.State.Running}}')" \
    == "true" ]] || {
  docker logs "$REGISTRY_CONTAINER" >&2 || true
  echo "loopback registry did not become ready" >&2
  exit 1
}

dd if=/dev/urandom of="$TEMP_DIR/layer-one.bin" bs=1048576 count=2 2>/dev/null
dd if=/dev/urandom of="$TEMP_DIR/layer-two.bin" bs=1048576 count=2 2>/dev/null

docker create \
  --name "$LAYER_ONE_CONTAINER" \
  --label "$LABEL" \
  alpine:3.21 >/dev/null
docker cp "$TEMP_DIR/layer-one.bin" "$LAYER_ONE_CONTAINER:/layer-one.bin"
docker commit "$LAYER_ONE_CONTAINER" "$LAYER_ONE_IMAGE" >/dev/null
docker rm -f "$LAYER_ONE_CONTAINER" >/dev/null

docker create \
  --name "$LAYER_TWO_CONTAINER" \
  --label "$LABEL" \
  "$LAYER_ONE_IMAGE" >/dev/null
docker cp "$TEMP_DIR/layer-two.bin" "$LAYER_TWO_CONTAINER:/layer-two.bin"
docker commit "$LAYER_TWO_CONTAINER" "$FINAL_IMAGE" >/dev/null
docker rm -f "$LAYER_TWO_CONTAINER" >/dev/null

REGISTRY_REFERENCE="${REGISTRY}/pull-progress:${RUN_SUFFIX}"
docker image tag "$FINAL_IMAGE" "$REGISTRY_REFERENCE"
docker push "$REGISTRY_REFERENCE" >/dev/null
DIGEST_REFERENCE="$(
  docker image inspect "$REGISTRY_REFERENCE" \
    --format '{{index .RepoDigests 0}}'
)"
[[ "$DIGEST_REFERENCE" =~ ^127\.0\.0\.1:[0-9]+/pull-progress@sha256:[0-9a-f]{64}$ ]] \
  || {
    echo "isolated registry digest is malformed" >&2
    exit 1
  }

docker image rm -f \
  "$REGISTRY_REFERENCE" \
  "$FINAL_IMAGE" \
  "$LAYER_ONE_IMAGE" >/dev/null

python3 - "$ROOT" "$DIGEST_REFERENCE" "$RESULT_PATH" <<'PY'
import json
from pathlib import Path
import sys

root = Path(sys.argv[1])
reference = sys.argv[2]
result_path = Path(sys.argv[3])
sys.path.insert(0, str(root))

from scripts.deploy.docker_pull_progress import (  # noqa: E402
    DockerEngineImagePuller,
    PullExecution,
)

heartbeats = []
result = DockerEngineImagePuller().pull(
    reference,
    username="fixture",
    token="",
    execution=PullExecution(
        stage="api-image-pull",
        timeout_seconds=60,
        heartbeat_seconds=1,
    ),
    event_sink=lambda snapshot: heartbeats.append(snapshot.as_document()),
)
document = result.as_document()
document["heartbeats"] = heartbeats
progress = document["progress"]
if (
    document["observabilityMode"] != "engine-api"
    or progress["phase"] != "complete"
    or progress["downloadedBytes"] <= 0
    or progress["downloadTotalBytes"] <= 0
    or progress["knownLayers"] < 2
    or progress["completedLayers"] < 2
):
    raise SystemExit("Docker Engine pull progress was incomplete")
result_path.write_text(
    json.dumps(document, sort_keys=True, separators=(",", ":")) + "\n",
    encoding="utf-8",
)
PY

docker image inspect "$DIGEST_REFERENCE" >/dev/null
python3 - "$RESULT_PATH" <<'PY'
import json
from pathlib import Path
import sys

document = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
progress = document["progress"]
print(
    "artifact pull progress Docker validation passed: "
    f"downloaded={progress['downloadedBytes']} "
    f"layers={progress['completedLayers']}/{progress['knownLayers']}"
)
PY
