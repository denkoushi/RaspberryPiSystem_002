#!/usr/bin/env bash
set -euo pipefail

BIN="${LLAMA_SERVER_BIN:-/srv/dgx/lab-experiments/data/llama-cpp/llama.cpp/build-sm121/bin/llama-server}"
MODEL="${LLAMA_SERVER_MODEL:-/srv/dgx/shared-models/llm/gguf/Qwen3.5-35B-A3B-UD-Q4_K_XL.gguf}"
HF_MODEL="${LLAMA_SERVER_HF_MODEL:-}"
ALIAS="${LLAMA_SERVER_ALIAS:-system-prod-primary}"
HOST="${LLAMA_SERVER_HOST:-127.0.0.1}"
PORT="${LLAMA_SERVER_PORT:-38082}"
CTX_SIZE="${LLAMA_SERVER_CTX_SIZE:-2048}"
MMPROJ="${LLAMA_SERVER_MMPROJ:-}"
LOG_PATH="${LLAMA_SERVER_LOG_PATH:-/srv/dgx/system-prod/logs/llama-server.log}"
PID_PATH="${LLAMA_SERVER_PID_PATH:-/srv/dgx/system-prod/logs/llama-server.pid}"
EXTRA_ARGS="${LLAMA_SERVER_EXTRA_ARGS:-}"

install -d "$(dirname "${LOG_PATH}")"

if [[ -f "${PID_PATH}" ]]; then
  OLD_PID="$(tr -d '\n' < "${PID_PATH}")"
  if [[ -n "${OLD_PID}" ]] && kill -0 "${OLD_PID}" 2>/dev/null; then
    echo "llama-server already running pid=${OLD_PID}"
    exit 0
  fi
fi

rm -f "${PID_PATH}"

detect_mmproj() {
  local model_dir
  model_dir="$(dirname "${MODEL}")"
  local candidate
  for candidate in \
    "${model_dir}/mmproj-F16.gguf" \
    "${model_dir}/mmproj-BF16.gguf" \
    "${model_dir}/mmproj-F32.gguf" \
    "${model_dir}/mmproj-Qwen3.5-35B-A3B-F16.gguf" \
    "${model_dir}/mmproj-Qwen3.5-35B-A3B-BF16.gguf" \
    "${model_dir}/mmproj-Qwen3.5-35B-A3B-F32.gguf"; do
    if [[ -f "${candidate}" ]]; then
      printf '%s\n' "${candidate}"
      return 0
    fi
  done
  return 1
}

LLAMA_ARGS=(
  --alias "${ALIAS}"
  --host "${HOST}"
  --port "${PORT}"
  --ctx-size "${CTX_SIZE}"
  -ngl 99
  -fa on
  --no-mmap
  --parallel 1
)

if [[ -n "${HF_MODEL}" ]]; then
  LLAMA_ARGS+=( -hf "${HF_MODEL}" )
else
  LLAMA_ARGS+=( --model "${MODEL}" )
fi

if [[ -z "${MMPROJ}" ]]; then
  MMPROJ="$(detect_mmproj || true)"
fi

if [[ -n "${MMPROJ}" ]]; then
  LLAMA_ARGS+=( --mmproj "${MMPROJ}" )
fi

if [[ -n "${EXTRA_ARGS}" ]]; then
  # shellcheck disable=SC2206
  EXTRA_ARGS_ARRAY=( ${EXTRA_ARGS} )
  LLAMA_ARGS+=( "${EXTRA_ARGS_ARRAY[@]}" )
fi

nohup "${BIN}" "${LLAMA_ARGS[@]}" >>"${LOG_PATH}" 2>&1 &

echo $! >"${PID_PATH}"
echo "started pid=$(cat "${PID_PATH}")"
if [[ -n "${MMPROJ}" ]]; then
  echo "mmproj=${MMPROJ}"
fi
