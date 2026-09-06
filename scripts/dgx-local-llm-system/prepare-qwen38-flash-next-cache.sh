#!/usr/bin/env bash
set -euo pipefail

# Explicit preparation helper for the Business Qwen3.8 Flash profile.  Model
# download and first-launch PLE generation are separate from the normal blue
# start path so a profile start can remain fail-fast and never fetch weights.

readonly DEFAULT_UPSTREAM_REVISION="09d4424be2b777818471b9bba8c7775ddd538833"
readonly DEFAULT_MODEL_REVISION="925d7be6c14c6c9442ef83e8f05b5a3c39304f69"
readonly MODEL_ID="Mia-AiLab/Qwen3.8-Flash-Next-NVFP4"
readonly MODEL_SIZE_GIB="99"
readonly PLE_SIZE_GIB="27"
readonly REQUIRED_FREE_GIB="130"
readonly DEFAULT_IMAGE="vllm/vllm-openai:qwen38-flash-next@sha256:3b0e188ffceb3d07e09c3cb5215433a0020eacf02d7f882ed3a8bfd15454477e"

RECIPE_DIR="${BLUE_QWEN38_RECIPE_DIR:-/srv/dgx/system-prod/third-party/qwen38-flash-next}"
EXPECTED_REVISION="${BLUE_QWEN38_RECIPE_REVISION:-${DEFAULT_UPSTREAM_REVISION}}"
EXPECTED_MODEL_REVISION="${BLUE_QWEN38_MODEL_REVISION:-${DEFAULT_MODEL_REVISION}}"
HF_CACHE_DIR="${BLUE_HF_CACHE_DIR:-${TRTLLM_HF_CACHE_DIR:-/srv/dgx/system-prod/data/hf-cache}}"
IMAGE="${BLUE_SERVER_IMAGE:-${TRTLLM_SERVER_IMAGE:-${DEFAULT_IMAGE}}}"
MODEL_DIR="${HF_CACHE_DIR}/hub/models--Mia-AiLab--Qwen3.8-Flash-Next-NVFP4"
PLE_CACHE_DIR="${HOME:?HOME must be the persistent execution user home}/.cache/vllm/ple_cache/Mia-AiLab--Qwen3.8-Flash-Next-NVFP4"
PLE_READY_MARKER="${PLE_CACHE_DIR}/.qwen38-flash-next-ple-ready"

usage() {
  cat <<'EOF'
Usage: prepare-qwen38-flash-next-cache.sh <plan|verify|fetch|prepare-ple>

  plan         print source/cache/disk paths; make no changes
  verify       verify the pinned local model snapshot and recorded PLE preparation
  fetch        download the pinned model revision (resumable, mutating)
  prepare-ple  run pinned start.sh --no-launch (builds patches/PLE cache)

The fetch and prepare-ple actions are intentionally explicit.  They must run
as the same persistent DGX user that will launch the Business container.
EOF
}

if [[ $# -ne 1 ]]; then
  usage >&2
  exit 2
fi
ACTION="$1"
case "${ACTION}" in
  plan|verify|fetch|prepare-ple) ;;
  *) usage >&2; exit 2 ;;
esac

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
if [[ ! -x "${RECIPE_DIR}/download.sh" || ! -x "${RECIPE_DIR}/start.sh" ]]; then
  echo "pinned Qwen3.8 Flash recipe is missing executable download.sh/start.sh" >&2
  exit 1
fi

echo "source=${RECIPE_DIR} revision=${EXPECTED_REVISION}"
echo "model=${MODEL_ID} revision=${EXPECTED_MODEL_REVISION} cache=${MODEL_DIR} expected_checkpoint_gib=${MODEL_SIZE_GIB}"
echo "image=${IMAGE}"
echo "ple_cache=${PLE_CACHE_DIR} expected_ple_gib=${PLE_SIZE_GIB} required_free_gib=${REQUIRED_FREE_GIB}"

if [[ "${ACTION}" == "plan" ]]; then
  exit 0
fi

if [[ "${ACTION}" == "fetch" ]]; then
  CACHE_PARENT="$(dirname "${HF_CACHE_DIR}")"
  AVAIL_GIB="$(df -Pk "${CACHE_PARENT}" | awk 'NR == 2 { print int($4 / 1024 / 1024) }')"
  if [[ -z "${AVAIL_GIB}" || "${AVAIL_GIB}" -lt "${REQUIRED_FREE_GIB}" ]]; then
    echo "insufficient free space under ${CACHE_PARENT}: ${AVAIL_GIB:-unknown} GiB (need ${REQUIRED_FREE_GIB} GiB)" >&2
    exit 1
  fi
  download_snapshot() {
    # The upstream download.sh follows the mutable Hub default branch.  Keep
    # its resumable snapshot_download behaviour, but pass the pinned model
    # commit explicitly so a later main update cannot change this cache.
    local download_code='import os, sys
from huggingface_hub import snapshot_download
path = snapshot_download(
    repo_id=sys.argv[1],
    revision=sys.argv[2],
    token=os.environ.get("HF_TOKEN") or None,
    max_workers=4,
)
print(path)'
    if python3 -c 'import huggingface_hub' >/dev/null 2>&1; then
      HF_HOME="${HF_CACHE_DIR}" python3 -c "${download_code}" "${MODEL_ID}" "${EXPECTED_MODEL_REVISION}" >/dev/null
    else
      command -v docker >/dev/null 2>&1 || {
        echo "python3 huggingface_hub or docker is required for pinned model fetch" >&2
        return 1
      }
      docker run --rm \
        --user "$(id -u):$(id -g)" \
        --env HF_HOME=/hf \
        --env HF_TOKEN="${HF_TOKEN:-}" \
        --volume "${HF_CACHE_DIR}:/hf" \
        --entrypoint python3 \
        "${IMAGE}" \
        -c "${download_code}" "${MODEL_ID}" "${EXPECTED_MODEL_REVISION}" >/dev/null
    fi
  }
  download_snapshot
  # snapshot_download(revision=<commit>) creates snapshots/<commit> but does
  # not create refs/main.  The runtime intentionally consumes refs/main, so
  # publish that ref only after the pinned download has succeeded.
  SNAPSHOT_DIR="${MODEL_DIR}/snapshots/${EXPECTED_MODEL_REVISION}"
  if [[ ! -d "${SNAPSHOT_DIR}" ]]; then
    echo "pinned model snapshot was not created: ${SNAPSHOT_DIR}" >&2
    exit 1
  fi
  install -d "${MODEL_DIR}/refs"
  printf '%s' "${EXPECTED_MODEL_REVISION}" >"${MODEL_DIR}/refs/main.tmp"
  mv -f "${MODEL_DIR}/refs/main.tmp" "${MODEL_DIR}/refs/main"
  echo "pinned_model_fetch_complete=true revision=${EXPECTED_MODEL_REVISION}"
  exit 0
fi

if [[ "${ACTION}" == "prepare-ple" ]]; then
  if [[ ! -f "${RECIPE_DIR}/.env" ]]; then
    echo "pinned recipe .env is required before PLE preparation: ${RECIPE_DIR}/.env" >&2
    exit 1
  fi
  (
    cd "${RECIPE_DIR}"
    env \
    HF_HOME="${HF_CACHE_DIR}" \
    TP1_MODEL_ID="${MODEL_ID}" \
    IMAGE="${IMAGE}" \
    SERVED_MODEL_NAME="system-prod-primary" \
    PORT="${BLUE_SERVER_PORT:-38083}" \
    TP1_CONTAINER_NAME="${BLUE_CONTAINER_NAME:-system-prod-trtllm}" \
    MAX_MODEL_LEN="262144" \
    MAX_NUM_SEQS="4" \
    MAX_NUM_BATCHED_TOKENS="2048" \
    KV_CACHE_DTYPE="fp8" \
    YARN="0" \
    MTP_NUM_SPECULATIVE_TOKENS="3" \
    PLE_OFFLOAD="true" \
    HOST_RESERVE_GIB="26" \
    KV_TARGET_GIB="16" \
    HOST_SLACK_GIB="5" \
    COMPILATION_MODE="0" \
    CUDAGRAPH_CAPTURE_SIZES="auto" \
    CUDAGRAPH_MODE="FULL_DECODE_ONLY" \
    REQUIRE_IDLE_GPU="true" \
      ./start.sh --no-launch
  )
  PLE_COUNT="$(find "${PLE_CACHE_DIR}" -maxdepth 1 -type f -name '*.packed_u8' 2>/dev/null | wc -l | tr -d ' ')"
  if [[ "${PLE_COUNT}" -lt 1 ]]; then
    echo "upstream PLE preparation returned without a packed artifact: ${PLE_CACHE_DIR}" >&2
    exit 1
  fi
  install -d "${PLE_CACHE_DIR}"
  {
    printf 'recipe_revision=%s\n' "${EXPECTED_REVISION}"
    printf 'model_revision=%s\n' "${EXPECTED_MODEL_REVISION}"
    printf 'image=%s\n' "${IMAGE}"
  } >"${PLE_READY_MARKER}.tmp"
  mv -f "${PLE_READY_MARKER}.tmp" "${PLE_READY_MARKER}"
  echo "upstream_ple_prepare_complete=true files=${PLE_COUNT} path=${PLE_CACHE_DIR}"
  exit 0
fi

MODEL_REF_FILE="${MODEL_DIR}/refs/main"
if [[ ! -s "${MODEL_REF_FILE}" ]]; then
  echo "model cache refs/main is unavailable: ${MODEL_REF_FILE}" >&2
  exit 1
fi
if ! cmp -s <(printf '%s' "${EXPECTED_MODEL_REVISION}") "${MODEL_REF_FILE}"; then
  echo "model cache refs/main is not the exact pinned revision (expected ${EXPECTED_MODEL_REVISION})" >&2
  exit 1
fi
MODEL_SNAPSHOT="${EXPECTED_MODEL_REVISION}"
SNAPSHOT_DIR="${MODEL_DIR}/snapshots/${MODEL_SNAPSHOT}"
if [[ ! -d "${SNAPSHOT_DIR}" ]]; then
  echo "model cache snapshot is unavailable: ${SNAPSHOT_DIR}" >&2
  exit 1
fi
python3 - "${SNAPSHOT_DIR}" <<'PY'
import json
import pathlib
import sys

snapshot = pathlib.Path(sys.argv[1])
index = snapshot / "model.safetensors.index.json"
if not index.is_file():
    raise SystemExit(f"model index missing: {index}")
weight_map = json.loads(index.read_text(encoding="utf-8")).get("weight_map", {})
missing = sorted({name for name in weight_map.values() if not (snapshot / name).is_file()})
if not weight_map or missing:
    raise SystemExit(f"model snapshot incomplete: missing={len(missing)}")
print(f"model_snapshot_complete=true snapshot={snapshot}")
PY

PLE_COUNT="$(find "${PLE_CACHE_DIR}" -maxdepth 1 -type f -name '*.packed_u8' 2>/dev/null | wc -l | tr -d ' ')"
if [[ "${PLE_COUNT}" -lt 1 || ! -s "${PLE_READY_MARKER}" ]]; then
  echo "ple_cache_ready=false artifact_files=${PLE_COUNT} marker_present=$([[ -s "${PLE_READY_MARKER}" ]] && echo true || echo false) path=${PLE_CACHE_DIR}"
  exit 1
fi
if ! grep -Fxq "recipe_revision=${EXPECTED_REVISION}" "${PLE_READY_MARKER}" \
  || ! grep -Fxq "model_revision=${EXPECTED_MODEL_REVISION}" "${PLE_READY_MARKER}" \
  || ! grep -Fxq "image=${IMAGE}" "${PLE_READY_MARKER}"; then
  echo "ple_cache_ready=false marker_identity_mismatch path=${PLE_READY_MARKER}" >&2
  exit 1
fi
echo "ple_cache_ready=true upstream_prepare_recorded=true artifact_files=${PLE_COUNT} path=${PLE_CACHE_DIR}"
