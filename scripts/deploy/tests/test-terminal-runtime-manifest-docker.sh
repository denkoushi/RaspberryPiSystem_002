#!/usr/bin/env bash
# Prove that the terminal runtime seal survives a real Compose force-recreate
# while still detecting a functional healthcheck change. All resources are
# disposable, run-labelled, and owned by one isolated Compose project.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
RUN_TOKEN="$(uuidgen | tr '[:upper:]' '[:lower:]')"
AUDIT_RUN_ID="terminal-runtime-${RUN_TOKEN}"
PROJECT="runtime-audit-${RUN_TOKEN}"
TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/raspi-terminal-runtime.XXXXXX")"
COMPOSE_FILE="${TEMP_DIR}/compose.yml"
RUNTIME_ROOT="${TEMP_DIR}/runtime"
HELPER="${ROOT}/scripts/deploy/terminal-runtime-manifest.py"
IMAGE="${TERMINAL_RUNTIME_AUDIT_IMAGE:-alpine:3.20}"
HOST="audit-terminal"
MANIFEST_SHA=""
ROLLBACK_TAG=""

cleanup() {
  local status="$?"
  AUDIT_HEALTHCHECK_COMMAND='exit 0' docker compose \
    --project-name "$PROJECT" \
    --project-directory "$TEMP_DIR" \
    -f "$COMPOSE_FILE" down --remove-orphans >/dev/null 2>&1 || true
  if [[ -n "$MANIFEST_SHA" ]]; then
    python3 "$HELPER" cleanup \
      --root "$RUNTIME_ROOT" \
      --run-id "$AUDIT_RUN_ID" \
      --host "$HOST" \
      --expected-manifest-sha256 "$MANIFEST_SHA" \
      --outcome restored >/dev/null 2>&1 || true
  fi
  if [[ -n "$ROLLBACK_TAG" ]]; then
    docker image rm "$ROLLBACK_TAG" >/dev/null 2>&1 || true
  fi
  rm -rf "$TEMP_DIR"
  return "$status"
}
trap cleanup EXIT HUP INT TERM

for command in docker python3 uuidgen; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "[terminal-runtime-docker] missing command: $command" >&2
    exit 1
  }
done
docker info >/dev/null 2>&1
if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  docker pull "$IMAGE" >/dev/null
fi

render_compose() {
  python3 - "$COMPOSE_FILE" "$IMAGE" "$AUDIT_RUN_ID" "$1" <<'PY'
from pathlib import Path
import sys

Path(sys.argv[1]).write_text(
    f"""services:
  nfc-agent:
    image: {sys.argv[2]}
    command: [\"/bin/sh\", \"-c\", \"trap 'exit 0' TERM INT; while :; do sleep 60; done\"]
    working_dir: /work
    environment:
      AUDIT_VALUE: stable
    healthcheck:
      test: [\"CMD-SHELL\", \"{sys.argv[4]}\"]
      interval: 5s
      timeout: 2s
      retries: 3
    labels:
      raspi.test.run: {sys.argv[3]}
    restart: unless-stopped
    networks: [audit]
networks:
  audit:
    labels:
      raspi.test.run: {sys.argv[3]}
""",
    encoding="utf-8",
)
PY
}
render_compose 'exit 0'

compose() {
  docker compose \
    --project-name "$PROJECT" \
    --project-directory "$TEMP_DIR" \
    -f "$COMPOSE_FILE" "$@"
}

write_runtime_contract() {
  python3 - "$HELPER" "$PROJECT" "$1" <<'PY'
import importlib.util
import json
import subprocess
import sys

spec = importlib.util.spec_from_file_location("terminal_runtime_manifest", sys.argv[1])
assert spec is not None and spec.loader is not None
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)
identifier = subprocess.run(
    [
        "docker", "ps", "-a",
        "--filter", f"label=com.docker.compose.project={sys.argv[2]}",
        "--filter", "label=com.docker.compose.service=nfc-agent",
        "--format", "{{.ID}}",
    ],
    check=True,
    capture_output=True,
    text=True,
).stdout.strip()
value = json.loads(subprocess.run(
    ["docker", "inspect", identifier],
    check=True,
    capture_output=True,
    text=True,
).stdout)[0]
contract = module._reproducible_runtime_contract(value["Config"], value["HostConfig"])
inspected = module._inspect_container(
    identifier,
    expected_project=sys.argv[2],
    expected_service="nfc-agent",
)
with open(sys.argv[3], "w", encoding="utf-8") as stream:
    json.dump(
        {"contract": contract, "inspected": inspected},
        stream,
        sort_keys=True,
        separators=(",", ":"),
    )
PY
}

compose up -d --pull never --no-build nfc-agent >/dev/null
capture_json="$(python3 "$HELPER" capture \
  --root "$RUNTIME_ROOT" \
  --run-id "$AUDIT_RUN_ID" \
  --host "$HOST" \
  --docker-service nfc-agent \
  --compose-project "$PROJECT" \
  --compose-working-directory "$TEMP_DIR" \
  --compose-config-file "$COMPOSE_FILE")"
MANIFEST_SHA="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["manifestSha256"])' <<<"$capture_json")"
ROLLBACK_TAG="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["rollbackTags"][0])' <<<"$capture_json")"
write_runtime_contract "${TEMP_DIR}/baseline-contract.json"

# Compose changes generated labels and the container ID during recreation. The
# reproducible runtime contract must still match without a rollback mutation.
compose up -d --pull never --no-build --force-recreate nfc-agent >/dev/null
write_runtime_contract "${TEMP_DIR}/recreated-contract.json"
python3 - "${TEMP_DIR}/baseline-contract.json" "${TEMP_DIR}/recreated-contract.json" <<'PY'
import json
import sys

before = json.load(open(sys.argv[1], encoding="utf-8"))["contract"]
after = json.load(open(sys.argv[2], encoding="utf-8"))["contract"]
if before != after:
    for section in sorted(set(before) | set(after)):
        left = before.get(section, {})
        right = after.get(section, {})
        for key in sorted(set(left) | set(right)):
            if left.get(key) != right.get(key):
                print(f"runtime contract drift: {section}.{key}: {left.get(key)!r} != {right.get(key)!r}", file=sys.stderr)
    raise SystemExit(1)
PY
python3 - "$RUNTIME_ROOT/$AUDIT_RUN_ID/$HOST/manifest.json" "${TEMP_DIR}/recreated-contract.json" <<'PY'
import json
import sys

expected = json.load(open(sys.argv[1], encoding="utf-8"))["docker"][0]
actual = json.load(open(sys.argv[2], encoding="utf-8"))["inspected"]
keys = (
    "imageId", "imageReference", "running", "restartPolicy", "mounts",
    "runtimeSecuritySha256", "runtimeEnvironmentSha256", "runtimeConfigSha256",
    "compose",
)
different = [key for key in keys if expected[key] != actual[key]]
if different:
    for key in different:
        print(f"sealed runtime drift: {key}: {expected[key]!r} != {actual[key]!r}", file=sys.stderr)
    raise SystemExit(1)
PY
equivalent_id="$(compose ps -q nfc-agent)"
python3 "$HELPER" restore \
  --root "$RUNTIME_ROOT" \
  --run-id "$AUDIT_RUN_ID" \
  --host "$HOST" \
  --expected-manifest-sha256 "$MANIFEST_SHA" >/dev/null
verified_id="$(compose ps -q nfc-agent)"
[[ "$verified_id" == "$equivalent_id" ]] || {
  echo '[terminal-runtime-docker] equivalent force-recreate triggered another recreation' >&2
  exit 1
}
preflight_json="$(python3 "$HELPER" preflight-restore \
  --root "$RUNTIME_ROOT" \
  --run-id "$AUDIT_RUN_ID" \
  --host "$HOST" \
  --expected-manifest-sha256 "$MANIFEST_SHA")"
python3 -c '
import json, sys
value = json.load(sys.stdin)
assert value["ready"] is True, value
assert value["requiresRuntimeReconciliation"] is False, value
' <<<"$preflight_json"

# A functional change behind the same Compose path must be detected.
render_compose 'exit 1'
compose up -d --pull never --no-build --force-recreate nfc-agent >/dev/null
drift_json="$(python3 "$HELPER" preflight-restore \
  --root "$RUNTIME_ROOT" \
  --run-id "$AUDIT_RUN_ID" \
  --host "$HOST" \
  --expected-manifest-sha256 "$MANIFEST_SHA")"
python3 -c '
import json, sys
value = json.load(sys.stdin)
assert value["ready"] is True, value
assert value["requiresRuntimeReconciliation"] is True, value
' <<<"$drift_json"

render_compose 'exit 0'
python3 "$HELPER" restore \
  --root "$RUNTIME_ROOT" \
  --run-id "$AUDIT_RUN_ID" \
  --host "$HOST" \
  --expected-manifest-sha256 "$MANIFEST_SHA" >/dev/null
python3 "$HELPER" cleanup \
  --root "$RUNTIME_ROOT" \
  --run-id "$AUDIT_RUN_ID" \
  --host "$HOST" \
  --expected-manifest-sha256 "$MANIFEST_SHA" \
  --outcome restored >/dev/null

compose down --remove-orphans >/dev/null
MANIFEST_SHA=""
ROLLBACK_TAG=""
if docker ps -a -q --filter "label=raspi.test.run=${AUDIT_RUN_ID}" | grep -q . \
  || docker network ls -q --filter "label=raspi.test.run=${AUDIT_RUN_ID}" | grep -q . \
  || docker volume ls -q --filter "label=raspi.test.run=${AUDIT_RUN_ID}" | grep -q .; then
  echo '[terminal-runtime-docker] disposable Docker resource residue detected' >&2
  exit 1
fi

echo '[terminal-runtime-docker] PASS: real Compose recreation is reproducible and drift-sensitive; run resources=0'
