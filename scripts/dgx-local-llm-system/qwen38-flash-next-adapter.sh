#!/usr/bin/env bash
set -euo pipefail

# Adapter for the pinned MiaAI-Lab single-Spark recipe.  The recipe itself is
# intentionally kept in its own checkout: its AGPL launcher and patch files
# remain governed by that upstream repository, while this adapter preserves
# the system-prod blue endpoint and cache paths.

readonly UPSTREAM_REPO_URL="https://github.com/MiaAI-Lab/Qwen3.8-Flash-Next-Single-DGX-Spark"
readonly DEFAULT_UPSTREAM_REVISION="d03809008834124e80223c3482f2ddb59577a48f"
readonly DEFAULT_MODEL_REVISION="925d7be6c14c6c9442ef83e8f05b5a3c39304f69"
readonly DEFAULT_IMAGE="vllm/vllm-openai:qwen38-flash-next@sha256:3b0e188ffceb3d07e09c3cb5215433a0020eacf02d7f882ed3a8bfd15454477e"
readonly MODEL_ID="Mia-AiLab/Qwen3.8-Flash-Next-NVFP4"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODE="${BLUE_SERVER_MODE:-${TRTLLM_SERVER_MODE:-container}}"
CONTAINER_NAME="${BLUE_CONTAINER_NAME:-${TRTLLM_CONTAINER_NAME:-system-prod-trtllm}}"
HOST_PORT="${BLUE_SERVER_PORT:-${TRTLLM_SERVER_PORT:-38083}}"
HF_CACHE_DIR="${BLUE_HF_CACHE_DIR:-${TRTLLM_HF_CACHE_DIR:-/srv/dgx/system-prod/data/hf-cache}}"
MODEL_DIR="${BLUE_MODEL_DIR:-${TRTLLM_MODEL_DIR:-}}"
IMAGE="${BLUE_SERVER_IMAGE:-${TRTLLM_SERVER_IMAGE:-${DEFAULT_IMAGE}}}"
RECIPE_DIR="${BLUE_QWEN38_RECIPE_DIR:-/srv/dgx/system-prod/third-party/qwen38-flash-next}"
EXPECTED_REVISION="${BLUE_QWEN38_RECIPE_REVISION:-${DEFAULT_UPSTREAM_REVISION}}"
EXPECTED_MODEL_REVISION="${BLUE_QWEN38_MODEL_REVISION:-${DEFAULT_MODEL_REVISION}}"

if [[ "${MODE}" != "container" ]]; then
  echo "Qwen3.8 Flash adapter requires BLUE_SERVER_MODE=container" >&2
  exit 1
fi
if [[ -z "${MODEL_DIR}" ]]; then
  echo "BLUE_MODEL_DIR is required for the Qwen3.8 Flash adapter" >&2
  exit 1
fi
if [[ "${MODEL_DIR}" != */models--Mia-AiLab--Qwen3.8-Flash-Next-NVFP4 ]]; then
  echo "BLUE_MODEL_DIR must point at the Qwen3.8 Flash Hugging Face cache" >&2
  exit 1
fi
if [[ -z "${IMAGE}" ]]; then
  echo "BLUE_SERVER_IMAGE is required for the Qwen3.8 Flash adapter" >&2
  exit 1
fi
if [[ ! -d "${MODEL_DIR}" ]]; then
  echo "Qwen3.8 Flash checkpoint cache is unavailable: ${MODEL_DIR}" >&2
  exit 1
fi
if [[ -z "${HOME:-}" || "${HOME}" == "/" ]]; then
  echo "Qwen3.8 Flash adapter requires the persistent execution user's HOME" >&2
  exit 1
fi
MODEL_REF_FILE="${MODEL_DIR}/refs/main"
if [[ ! -s "${MODEL_REF_FILE}" ]]; then
  echo "Qwen3.8 Flash cache refs/main is unavailable: ${MODEL_REF_FILE}" >&2
  exit 1
fi
MODEL_SNAPSHOT="$(tr -d '[:space:]' < "${MODEL_REF_FILE}")"
if [[ "${MODEL_SNAPSHOT}" != "${EXPECTED_MODEL_REVISION}" ]]; then
  echo "Qwen3.8 Flash model revision mismatch (expected ${EXPECTED_MODEL_REVISION})" >&2
  exit 1
fi
if [[ ! -d "${MODEL_DIR}/snapshots/${MODEL_SNAPSHOT}" ]]; then
  echo "Qwen3.8 Flash cache snapshot is unavailable: ${MODEL_SNAPSHOT}" >&2
  exit 1
fi
python3 - "${MODEL_DIR}/snapshots/${MODEL_SNAPSHOT}" <<'PY'
import json
import pathlib
import sys

snapshot = pathlib.Path(sys.argv[1])
index = snapshot / "model.safetensors.index.json"
if not index.is_file():
    raise SystemExit(f"Qwen3.8 Flash pinned snapshot index is unavailable: {index}")
try:
    weight_map = json.loads(index.read_text(encoding="utf-8")).get("weight_map", {})
except (OSError, json.JSONDecodeError) as exc:
    raise SystemExit(f"Qwen3.8 Flash pinned snapshot index is invalid: {index}: {exc}")
missing = sorted({name for name in weight_map.values() if not (snapshot / name).is_file()})
if not weight_map or missing:
    raise SystemExit(
        f"Qwen3.8 Flash pinned snapshot is incomplete: {snapshot} missing={len(missing)}"
    )
PY
if [[ ! -d "${RECIPE_DIR}/.git" ]]; then
  echo "pinned Qwen3.8 Flash recipe checkout is unavailable: ${RECIPE_DIR}" >&2
  exit 1
fi
if [[ "$(git -C "${RECIPE_DIR}" rev-parse HEAD 2>/dev/null || true)" != "${EXPECTED_REVISION}" ]]; then
  echo "Qwen3.8 Flash recipe revision mismatch (expected ${EXPECTED_REVISION})" >&2
  exit 1
fi
if [[ -n "$(git -C "${RECIPE_DIR}" status --porcelain 2>/dev/null)" ]]; then
  echo "Qwen3.8 Flash recipe checkout has uncommitted changes: ${RECIPE_DIR}" >&2
  exit 1
fi
UPSTREAM_START="${RECIPE_DIR}/start.sh"
if [[ ! -x "${UPSTREAM_START}" ]]; then
  echo "pinned Qwen3.8 Flash launcher is not executable: ${UPSTREAM_START}" >&2
  exit 1
fi
MAX_NUM_SEQS="${VLLM_MAX_NUM_SEQS:-1}"
if [[ "${MAX_NUM_SEQS}" != "1" ]]; then
  echo "Qwen3.8 Flash adapter requires max_num_seqs=1" >&2
  exit 1
fi
SCHEDULING_POLICY="${VLLM_SCHEDULING_POLICY:-priority}"
if [[ "${SCHEDULING_POLICY}" != "priority" ]]; then
  echo "Qwen3.8 Flash adapter requires priority scheduling" >&2
  exit 1
fi
PLE_CACHE_DIR="${HOME}/.cache/vllm/ple_cache/Mia-AiLab--Qwen3.8-Flash-Next-NVFP4"
echo "Qwen3.8 Flash adapter: local model cache=${MODEL_DIR} persistent PLE cache=${PLE_CACHE_DIR}" >&2

# The pinned upstream launcher uses host networking and binds 0.0.0.0. Keep
# its model/PLE/container/watchdog behavior while adapting only that fixed bind
# line to the existing localhost-only blue endpoint; readiness returns through
# the existing control path. The source is copied into the recipe directory so
# its SCRIPT_DIR-relative paths still resolve correctly.
BOUNDARY_START=""
cleanup_boundary_start() {
  if [[ -n "${BOUNDARY_START}" ]]; then
    rm -f -- "${BOUNDARY_START}"
  fi
}
trap cleanup_boundary_start EXIT

BOUNDARY_START="$(mktemp "${RECIPE_DIR}/.business-qwen38-boundary-start.XXXXXX")"
python3 - "${UPSTREAM_START}" "${BOUNDARY_START}" <<'PY'
from pathlib import Path
import sys

source_path = Path(sys.argv[1])
generated_path = Path(sys.argv[2])
source = source_path.read_text(encoding='utf-8')
backslash = chr(92)
old_host = f'    --host 0.0.0.0 {backslash}{backslash}\n'
new_host = f'    --host 127.0.0.1 {backslash}{backslash}\n'
readiness_marker = 'info "Loading weights (~3-4 min). Following logs until ready..."\n'
if source.count(old_host) != 1:
    raise SystemExit(f'expected exactly one pinned host bind line, found {source.count(old_host)}')
if source.count(readiness_marker) != 1:
    raise SystemExit(f'expected exactly one pinned readiness marker, found {source.count(readiness_marker)}')
source = source.replace(old_host, new_host, 1)
source = source.replace(readiness_marker, f'exit 0\n{readiness_marker}', 1)
generated_path.write_text(source, encoding='utf-8')
PY
chmod 0750 "${BOUNDARY_START}"

# These overrides retain the upstream model/PLE cache behavior, Business alias,
# port, and the shipped safe profile.
EXTRA_DOCKER_ARGS="${BLUE_EXTRA_DOCKER_ARGS:-${TRTLLM_EXTRA_DOCKER_ARGS:-}}"
if [[ -n "${EXTRA_DOCKER_ARGS}" ]]; then
  EXTRA_DOCKER_ARGS+=" "
fi
EXTRA_DOCKER_ARGS+="-e VLLM_USE_V2_MODEL_RUNNER=1"
cd "${RECIPE_DIR}"
if env \
  ABLIT="0" \
  TP1_MODEL_ID="${MODEL_ID}" \
  TP1_CONTAINER_NAME="${CONTAINER_NAME}" \
  IMAGE="${IMAGE}" \
  SERVED_MODEL_NAME="${VLLM_SERVED_MODEL_NAME:-system-prod-primary}" \
  HF_HOME="${HF_CACHE_DIR}" \
  PORT="${HOST_PORT}" \
  MAX_MODEL_LEN="${VLLM_MAX_MODEL_LEN:-262144}" \
  MAX_NUM_SEQS="${MAX_NUM_SEQS}" \
  MAX_NUM_BATCHED_TOKENS="${VLLM_MAX_NUM_BATCHED_TOKENS:-2048}" \
  KV_CACHE_DTYPE="${VLLM_KV_CACHE_DTYPE:-fp8}" \
  YARN="0" \
  MTP_NUM_SPECULATIVE_TOKENS="3" \
  MAMBA_SSM_CACHE_DTYPE="bfloat16" \
  MTP_DRAFT_VOCAB="files/draft_vocab_en_code_47k.txt" \
  PLE_OFFLOAD="true" \
  HOST_RESERVE_GIB="26" \
  KV_TARGET_GIB="16" \
  HOST_SLACK_GIB="5" \
  COMPILATION_MODE="0" \
  GPU_MEMORY_UTILIZATION="${VLLM_GPU_MEMORY_UTILIZATION:-0.71}" \
  EXTRA_VLLM_ARGS="--scheduling-policy ${SCHEDULING_POLICY}" \
  CUDAGRAPH_CAPTURE_SIZES="auto" \
  CUDAGRAPH_MODE="FULL_DECODE_ONLY" \
  REQUIRE_IDLE_GPU="true" \
  EXTRA_DOCKER_ARGS="${EXTRA_DOCKER_ARGS}" \
  "${BOUNDARY_START}"; then
  exit_code=0
else
  exit_code=$?
fi
exit "${exit_code}"
