#!/usr/bin/env bash
set -euo pipefail

# Launch only: model readiness is probed by the caller, outside the 120s command.
MODE="${BLUE_SERVER_MODE:-${TRTLLM_SERVER_MODE:-container}}"
HEAD_NAME="${BLUE_CONTAINER_NAME:-${TRTLLM_CONTAINER_NAME:-system-prod-trtllm}}"
WORKER_NAME="system-prod-trtllm-rank1"
PROFILE_ID="${BLUE_MODEL_PROFILE_ID:-business_glm53_flash_fp4_tp2}"
MODEL_DIR="${BLUE_MODEL_DIR:-}"
WORKER_MODEL_DIR="${BLUE_WORKER_MODEL_DIR:-}"
WORKER_SSH="${BLUE_WORKER_SSH_TARGET:-ubudgxkoushi@192.168.100.11}"
HEAD_IP="${BLUE_MASTER_ADDR:-192.168.100.10}"
MASTER_PORT="${BLUE_MASTER_PORT:-29501}"
ETH_IF="${BLUE_ETH_INTERFACE:-enp1s0f0np0}"
IB_IF="${BLUE_IB_INTERFACES:-rocep1s0f0,roceP2p1s0f0}"
IMAGE="${BLUE_SERVER_IMAGE:-eugr/spark-vllm-b12x:latest}"
CACHE_DIR="${BLUE_CACHE_DIR:-/srv/dgx/system-prod/data/glm53-cache}"
MARKER="${BLUE_REMOTE_WORKER_MARKER_PATH:-/srv/dgx/system-prod/state/blue-remote-worker.json}"
HOST_PORT="${BLUE_SERVER_PORT:-${TRTLLM_SERVER_PORT:-38083}}"
ALIAS="${VLLM_SERVED_MODEL_NAME:-system-prod-primary}"
MAX_MODEL_LEN="${VLLM_MAX_MODEL_LEN:-262144}"
LIMIT_MM="${VLLM_LIMIT_MM_PER_PROMPT:-}"
SPECULATIVE="${VLLM_SPECULATIVE_CONFIG:-}"
GPU_MEM_UTIL="${VLLM_GPU_MEMORY_UTILIZATION:-0.85}"
if [[ -z "${LIMIT_MM}" ]]; then LIMIT_MM='{"image":61}'; fi
if [[ -z "${SPECULATIVE}" ]]; then
  SPECULATIVE='{"method":"mtp","num_speculative_tokens":5,"moe_backend":"humming","attention_backend":"B12X"}'
fi

fail() { echo "GLM TP2 adapter: $*" >&2; exit 1; }
[[ "${MODE}" == "container" ]] || fail "requires container mode"
[[ "${HEAD_NAME}" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] || fail "invalid head container name"
[[ "${PROFILE_ID}" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] || fail "invalid profile ID"
[[ "${WORKER_SSH}" =~ ^[a-zA-Z0-9_][a-zA-Z0-9_.-]*@[a-zA-Z0-9_][a-zA-Z0-9_.-]*$ ]] || fail "invalid worker ssh target (user@host required)"
[[ "${HEAD_IP}" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] || fail "invalid master addr"
[[ "${ETH_IF}" =~ ^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$ ]] || fail "invalid ethernet interface"
[[ "${IB_IF}" =~ ^[a-zA-Z0-9_][a-zA-Z0-9_,.-]*$ ]] || fail "invalid IB interfaces"
[[ -n "${IMAGE}" && "${IMAGE}" != -* && ! "${IMAGE}" =~ [[:space:]] ]] || fail "invalid image"
[[ "${GPU_MEM_UTIL}" =~ ^0\.[0-9]{1,3}$ ]] || fail "invalid gpu memory utilization"
[[ -n "${ALIAS}" && "${ALIAS}" != -* && ! "${ALIAS}" =~ [[:space:]] ]] || fail "invalid served alias"
for port in "${MASTER_PORT}" "${HOST_PORT}"; do
  if [[ ! "${port}" =~ ^[1-9][0-9]{0,4}$ ]] || (( port > 65535 )); then
    fail "invalid port: ${port}"
  fi
done
[[ "${MAX_MODEL_LEN}" =~ ^[1-9][0-9]*$ ]] || fail "invalid max model length"
[[ "${VLLM_TENSOR_PARALLEL_SIZE:-2}" == "2" ]] || fail "requires tensor parallel size 2"
[[ "${VLLM_SCHEDULING_POLICY:-priority}" == "priority" ]] || fail "requires priority scheduling"
for path in "${MODEL_DIR}" "${WORKER_MODEL_DIR}" "${CACHE_DIR}" "${MARKER}"; do
  [[ "${path}" == /* && "${path}" != *:* && "${path}" != *$'\n'* ]] || fail "invalid absolute path: ${path}"
done
[[ -d "${MODEL_DIR}" ]] || fail "head model directory unavailable: ${MODEL_DIR}"
python3 - "${LIMIT_MM}" "${SPECULATIVE}" <<'PY'
import json
import sys

limit, speculative = map(json.loads, sys.argv[1:])
if not isinstance(limit, dict) or any(type(v) is not int or v < 0 for v in limit.values()):
    raise SystemExit("limitMmPerPrompt must be an object of nonnegative integer limits")
if not isinstance(speculative, dict):
    raise SystemExit("speculativeConfig must be an object")
PY

# SSH joins arguments into a shell command. Quote each argument for a POSIX shell,
# including paths containing spaces or single quotes; never interpolate raw paths.
worker() {
  local command
  command="$(python3 - "$@" <<'PY'
import shlex
import sys
print(shlex.join(sys.argv[1:]))
PY
  )"
  ssh -o BatchMode=yes -o ConnectTimeout=10 -- "${WORKER_SSH}" "${command}"
}

docker rm -f "${HEAD_NAME}" >/dev/null 2>&1 || true
# Business has priority over a leftover private lease.
worker docker stop dgx-private-comfyui >/dev/null 2>&1 || true
# A missing container is harmless; SSH/daemon errors still stop the launch.
# shellcheck disable=SC2016 # $1 is expanded by the remote sh, not this shell.
worker sh -c 'docker rm -f "$1" || { docker info >/dev/null && ! docker inspect "$1" >/dev/null 2>&1; }' sh "${WORKER_NAME}"
worker test -d "${WORKER_MODEL_DIR}"
install -d "$(dirname "${MARKER}")"

# Shared flags are identical on both ranks; only mounts, names and rank tails vary.
DOCKER_ARGS=(run -d --privileged --gpus all --ipc host --network host --shm-size=16g
  --ulimit nofile=1048576:1048576 --ulimit memlock=-1 --ulimit stack=67108864
  --label "dgx.profile=${PROFILE_ID}")
for setting in \
  HF_HUB_OFFLINE=1 "MN_IF_NAME=${ETH_IF}" "UCX_NET_DEVICES=${ETH_IF}" "NCCL_SOCKET_IFNAME=${ETH_IF}" \
  "NCCL_IB_HCA=${IB_IF}" NCCL_IB_DISABLE=0 "OMPI_MCA_btl_tcp_if_include=${ETH_IF}" \
  "GLOO_SOCKET_IFNAME=${ETH_IF}" "TP_SOCKET_IFNAME=${ETH_IF}" NCCL_IGNORE_CPU_AFFINITY=1 \
  "HEAD_IP=${HEAD_IP}" "MASTER_PORT=${MASTER_PORT}" CUTE_DSL_ARCH=sm_121a SAFETENSORS_FAST_GPU=1 \
  VLLM_ENABLE_ROCE_ALLREDUCE=1 VLLM_ROCE_ALLREDUCE_MAX_SIZE=2MB NCCL_BUFFSIZE=1048576 NCCL_MAX_CTAS=8 \
  VLLM_WORKER_MULTIPROC_METHOD=spawn VLLM_SSM_CONV_STATE_LAYOUT=DS VLLM_USE_AOT_COMPILE=1 \
  VLLM_USE_MEGA_AOT_ARTIFACT=1 VLLM_USE_V2_MODEL_RUNNER=1 VLLM_ENABLE_PCIE_ALLREDUCE=0 \
  B12X_POLICY_MODE=auto VLLM_B12X_MOE_FP4_FORCE_A16=1 B12X_W4A16_A4_PREFILL=1; do
  DOCKER_ARGS+=(-e "${setting}")
done
DOCKER_ARGS+=(-v "${CACHE_DIR}/vllm:/root/.cache/vllm"
  -v "${CACHE_DIR}/flashinfer:/root/.cache/flashinfer"
  -v "${CACHE_DIR}/triton:/root/.triton" -v "${CACHE_DIR}/b12x:/root/.cache/b12x")
VLLM_ARGS=(serve /models/GLM-5.3-Flash-FP4-Local --served-model-name "${ALIAS}"
  --tensor-parallel-size 2 --mamba-cache-mode align --enable-prefix-caching --enable-chunked-prefill
  --dtype bfloat16 --kv-cache-dtype fp8 --quantization modelopt_mixed --attention-backend B12X
  --block-size 256 --moe-backend b12x --linear-backend b12x --no-enable-flashinfer-autotune
  --load-format b12x --max-model-len "${MAX_MODEL_LEN}" --max-num-seqs 4 --max-num-batched-tokens 4096
  --speculative-config "${SPECULATIVE}" --reasoning-parser glm45 --tool-call-parser glm47
  --enable-auto-tool-choice --gpu-memory-utilization "${GPU_MEM_UTIL}" --nnodes 2
  --master-addr "${HEAD_IP}" --master-port "${MASTER_PORT}")

# Write recovery information before launch: SSH can fail after starting the worker.
python3 - "${MARKER}" "${WORKER_SSH}" "${WORKER_NAME}" <<'PY'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
tmp = path.with_suffix(path.suffix + ".tmp")
tmp.write_text(json.dumps({"sshTarget": sys.argv[2], "containerName": sys.argv[3]}) + "\n", encoding="utf-8")
tmp.replace(path)
PY
# Pin each rank's vLLM address to the cluster link; the default-route IP (e.g. Wi-Fi)
# may be unreachable from the peer and hangs the startup handshake.
worker docker "${DOCKER_ARGS[@]}" --name "${WORKER_NAME}" -e "VLLM_HOST_IP=${WORKER_SSH#*@}" \
  -v "${WORKER_MODEL_DIR}:/models/GLM-5.3-Flash-FP4-Local:ro" \
  --entrypoint vllm "${IMAGE}" "${VLLM_ARGS[@]}" --node-rank 1 --headless
[[ "$(worker docker inspect --format '{{.State.Running}}' "${WORKER_NAME}")" == "true" ]] || fail "worker is not running"

if ! worker docker run --rm --privileged --entrypoint sh "${IMAGE}" -c 'sync; echo 3 > /proc/sys/vm/drop_caches'; then
  echo "GLM TP2 adapter: worker drop_caches failed; continuing launch" >&2
fi
if ! docker run --rm --privileged --entrypoint sh "${IMAGE}" -c 'sync; echo 3 > /proc/sys/vm/drop_caches'; then
  echo "GLM TP2 adapter: head drop_caches failed; continuing launch" >&2
fi
docker "${DOCKER_ARGS[@]}" --name "${HEAD_NAME}" -e "VLLM_HOST_IP=${HEAD_IP}" \
  -v "${MODEL_DIR}:/models/GLM-5.3-Flash-FP4-Local:ro" \
  --entrypoint vllm "${IMAGE}" "${VLLM_ARGS[@]}" --node-rank 0 \
  --host 127.0.0.1 --port "${HOST_PORT}" --scheduling-policy priority --limit-mm-per-prompt "${LIMIT_MM}"
echo "started GLM TP2 head=${HEAD_NAME} worker=${WORKER_SSH}:${WORKER_NAME}"
