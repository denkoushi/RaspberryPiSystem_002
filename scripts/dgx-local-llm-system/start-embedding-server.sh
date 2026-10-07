#!/usr/bin/env bash
set -euo pipefail

# 再起動後も同じモデルで起動するよう、設定はファイルに置ける（無ければ下の既定値 = CLIP）
ENV_FILE="${EMBEDDING_SERVER_ENV_FILE:-/srv/dgx/system-prod/etc/embedding-server.env}"
if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "${ENV_FILE}"
  set +a
fi

CONTAINER_NAME="${EMBEDDING_CONTAINER_NAME:-system-prod-embedding}"
IMAGE="${EMBEDDING_SERVER_IMAGE:-lmsysorg/sglang:latest}"
SCRIPT_PATH="${EMBEDDING_SERVER_SCRIPT_PATH:-/srv/dgx/system-prod/bin/embedding-server.py}"
CACHE_DIR="${EMBEDDING_SERVER_CACHE_DIR:-/srv/dgx/system-prod/data/hf-cache}"
LOG_PATH="${EMBEDDING_SERVER_LOG_PATH:-/srv/dgx/system-prod/logs/embedding-server.log}"
HOST_PORT="${EMBEDDING_SERVER_PORT:-38100}"
MODEL_ID="${EMBEDDING_MODEL_ID:-clip-ViT-B-32}"
HF_MODEL="${EMBEDDING_HF_MODEL:-openai/clip-vit-base-patch32}"
DEVICE="${EMBEDDING_DEVICE:-cpu}"
NORMALIZE="${EMBEDDING_NORMALIZE:-true}"
BACKEND="${EMBEDDING_BACKEND:-clip}"
TRUNCATE_DIM="${EMBEDDING_TRUNCATE_DIM:-}"

install -d "$(dirname "${LOG_PATH}")" "${CACHE_DIR}"

if docker ps --format '{{.Names}}' | grep -Fxq "${CONTAINER_NAME}"; then
  echo "embedding-server already running container=${CONTAINER_NAME}"
  exit 0
fi

if docker ps -a --format '{{.Names}}' | grep -Fxq "${CONTAINER_NAME}"; then
  docker rm -f "${CONTAINER_NAME}" >/dev/null
fi

docker run -d \
  --name "${CONTAINER_NAME}" \
  --restart unless-stopped \
  --gpus=all \
  -p "127.0.0.1:${HOST_PORT}:38100" \
  -v "${SCRIPT_PATH}:/opt/embedding-server.py:ro" \
  -v "${CACHE_DIR}:/root/.cache/huggingface" \
  -e EMBEDDING_LISTEN_HOST=0.0.0.0 \
  -e EMBEDDING_LISTEN_PORT=38100 \
  -e EMBEDDING_MODEL_ID="${MODEL_ID}" \
  -e EMBEDDING_HF_MODEL="${HF_MODEL}" \
  -e EMBEDDING_DEVICE="${DEVICE}" \
  -e EMBEDDING_NORMALIZE="${NORMALIZE}" \
  -e EMBEDDING_BACKEND="${BACKEND}" \
  -e EMBEDDING_TRUNCATE_DIM="${TRUNCATE_DIM}" \
  "${IMAGE}" \
  bash -lc 'python /opt/embedding-server.py' >>"${LOG_PATH}" 2>&1

echo "started container=${CONTAINER_NAME} image=${IMAGE}"
