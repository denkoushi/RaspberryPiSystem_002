#!/usr/bin/env bash
set -euo pipefail

CONTROL_TOKEN="${LLM_RUNTIME_CONTROL_TOKEN:-}"
if [[ -z "${CONTROL_TOKEN}" ]]; then
  echo "LLM_RUNTIME_CONTROL_TOKEN is required." >&2
  exit 1
fi

LOCAL_LLM_HOME="${LOCAL_LLM_SYSTEM_HOME:-/home/localllm/local-llm-system}"
COMPOSE_DIR="${LOCAL_LLM_HOME}/compose"
RUNTIME_ENV="${LOCAL_LLM_HOME}/config/runtime.env"
NGINX_TEMPLATE="${LOCAL_LLM_HOME}/config/nginx/default.conf.template"
COMPOSE_FILE="${COMPOSE_DIR}/compose.yaml"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"

for required in "${COMPOSE_FILE}" "${RUNTIME_ENV}" "${NGINX_TEMPLATE}"; do
  if [[ ! -f "${required}" ]]; then
    echo "Missing required file: ${required}" >&2
    exit 1
  fi
done

backup_file() {
  local path="$1"
  cp "${path}" "${path}.bak-${TIMESTAMP}"
}

backup_file "${RUNTIME_ENV}"
backup_file "${NGINX_TEMPLATE}"
backup_file "${COMPOSE_FILE}"

if grep -q '^LLM_RUNTIME_CONTROL_TOKEN=' "${RUNTIME_ENV}"; then
  python3 - <<'PY' "${RUNTIME_ENV}" "${CONTROL_TOKEN}"
from pathlib import Path
import sys
path = Path(sys.argv[1])
token = sys.argv[2]
lines = path.read_text(encoding='utf-8').splitlines()
for i, line in enumerate(lines):
    if line.startswith('LLM_RUNTIME_CONTROL_TOKEN='):
        lines[i] = f'LLM_RUNTIME_CONTROL_TOKEN={token}'
        break
path.write_text('\n'.join(lines) + '\n', encoding='utf-8')
PY
else
  printf '\nLLM_RUNTIME_CONTROL_TOKEN=%s\n' "${CONTROL_TOKEN}" >>"${RUNTIME_ENV}"
fi

python3 - <<'PY' "${COMPOSE_FILE}"
from pathlib import Path
import sys
path = Path(sys.argv[1])
text = path.read_text(encoding='utf-8')
old = "envsubst '\\$${LLM_SHARED_TOKEN} \\$${EMBEDDING_API_KEY}'"
new = "envsubst '\\$${LLM_SHARED_TOKEN} \\$${EMBEDDING_API_KEY} \\$${LLM_RUNTIME_CONTROL_TOKEN}'"
if new in text:
    pass
elif old in text:
    text = text.replace(old, new)
else:
    raise SystemExit("Could not find nginx envsubst command to patch.")
path.write_text(text, encoding='utf-8')
PY

DOCKER_BRIDGE_GATEWAY="${DOCKER_BRIDGE_GATEWAY:-}"
if [[ -z "${DOCKER_BRIDGE_GATEWAY}" ]]; then
  DOCKER_BRIDGE_GATEWAY="$(docker compose -f "${COMPOSE_FILE}" exec -T tailscale sh -lc "ip route | awk '/default/ {print \$3; exit}'" 2>/dev/null || true)"
fi
if [[ -z "${DOCKER_BRIDGE_GATEWAY}" ]]; then
  echo "Could not detect Docker bridge gateway. Set DOCKER_BRIDGE_GATEWAY=... and rerun." >&2
  exit 1
fi

python3 - <<'PY' "${NGINX_TEMPLATE}" "${DOCKER_BRIDGE_GATEWAY}"
from pathlib import Path
import sys

path = Path(sys.argv[1])
gateway = sys.argv[2]
text = path.read_text(encoding='utf-8')

start_block = f"""    location = /start {{
        if ($http_x_runtime_control_token != "${{LLM_RUNTIME_CONTROL_TOKEN}}") {{
            return 403;
        }}

        proxy_pass http://{gateway}:39090/start;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Runtime-Control-Token $http_x_runtime_control_token;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }}

"""

stop_block = f"""    location = /stop {{
        if ($http_x_runtime_control_token != "${{LLM_RUNTIME_CONTROL_TOKEN}}") {{
            return 403;
        }}

        proxy_pass http://{gateway}:39090/stop;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Runtime-Control-Token $http_x_runtime_control_token;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }}

"""

if 'location = /start {' in text and 'location = /stop {' in text:
    import re
    text = re.sub(
        r"location = /start \{\n(?:.*\n)*?\s+proxy_set_header X-Forwarded-Proto \$scheme;\n\s+\}\n\n",
        start_block,
        text,
        count=1,
    )
    text = re.sub(
        r"location = /stop \{\n(?:.*\n)*?\s+proxy_set_header X-Forwarded-Proto \$scheme;\n\s+\}\n\n",
        stop_block,
        text,
        count=1,
    )
else:
    marker = """    location = /embed {
        if ($http_authorization != "Bearer ${EMBEDDING_API_KEY}") {
            return 403;
        }

        proxy_pass http://127.0.0.1:38100/embed;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

"""
    if marker not in text:
        raise SystemExit("Could not find /embed block to insert runtime control locations.")
    text = text.replace(marker, marker + start_block + stop_block, 1)

path.write_text(text, encoding='utf-8')
PY

docker compose -f "${COMPOSE_FILE}" up -d --force-recreate nginx
docker compose -f "${COMPOSE_FILE}" ps
