#!/usr/bin/env bash
# Prepare StackChan microSD for Spark-backed private Pi5 bridge (AI_StackChan_Ex llm.type 4).
# Secrets stay out of git: pass Wi-Fi and optional bearer token via environment variables only.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TEMPLATE_BASIC="${ROOT}/scripts/stackchan-ai-stackchan-ex/fixtures/sd/yaml/SC_BasicConfig.yaml"

VOL="${STACKCHAN_SD_VOLUME:-}"
BRIDGE_HOST="${PRIVATE_PI5_BRIDGE_HOST:-}"
AISERVICE="${STACKCHAN_TOKEN_OR_DUMMY:-not-used-local-bridge}"
OVERWRITE="${STACKCHAN_SD_OVERWRITE:-}"
APPLY="${STACKCHAN_SD_APPLY:-}"

usage() {
  cat <<'EOF'
Usage:
  STACKCHAN_SD_VOLUME=/Volumes/<SD_VOLUME_NAME> \
  PRIVATE_PI5_BRIDGE_HOST=<PRIVATE_PI5_LAN_IP_OR_COMPAT_ALIAS> \
  [HOME_WIFI_SSID=...] [HOME_WIFI_PASSWORD=...] [STACKCHAN_TOKEN_OR_DUMMY=...] \
  [STACKCHAN_SD_OVERWRITE=1] [STACKCHAN_SD_APPLY=1] \
  ./scripts/stackchan-ai-stackchan-ex/prepare-spark-sd.sh

Guards:
  - STACKCHAN_SD_VOLUME must be a mounted path under /Volumes/ (not /, $HOME, repo, or /tmp).
  - Dry-run by default; set STACKCHAN_SD_APPLY=1 to write files.
  - Existing SC_ExConfig.yaml / SC_SecConfig.yaml require STACKCHAN_SD_OVERWRITE=1 (creates .bak.<timestamp> first).

Writes (when STACKCHAN_SD_APPLY=1):
  /app/AiStackChanEx/SC_ExConfig.yaml
  /yaml/SC_SecConfig.yaml  (only if HOME_WIFI_* provided)
  /yaml/SC_BasicConfig.yaml (only if missing)

Does not write wifi.txt (SC_SecConfig.yaml is the supported path for AI_StackChan_Ex).
EOF
}

die() {
  echo "[ERROR] $*" >&2
  exit 2
}

validate_volume() {
  local vol="$1"
  [[ -n "${vol}" ]] || die "STACKCHAN_SD_VOLUME is required"
  [[ "${vol}" == /Volumes/* ]] || die "STACKCHAN_SD_VOLUME must be under /Volumes/"
  [[ "${vol}" != /Volumes ]] || die "STACKCHAN_SD_VOLUME must name a mounted volume, not /Volumes itself"
  [[ "${vol}" != *".."* ]] || die "STACKCHAN_SD_VOLUME must not contain .."
  [[ -d "${vol}" ]] || die "SD volume is not mounted"

  local real_vol
  real_vol="$(cd "${vol}" && pwd -P)"
  [[ "${real_vol}" == /Volumes/* ]] || die "resolved volume path is outside /Volumes/"

  local real_root
  real_root="$(cd "${ROOT}" && pwd -P)"
  if [[ "${real_vol}" == "${real_root}" || "${real_vol}" == "${real_root}/"* ]]; then
    die "STACKCHAN_SD_VOLUME must not point inside the git repository"
  fi
  if [[ "${real_vol}" == "${HOME}" || "${real_vol}" == "${HOME}/"* ]]; then
    die "STACKCHAN_SD_VOLUME must not point inside $HOME"
  fi
  if [[ "${real_vol}" == /tmp/* || "${real_vol}" == /private/tmp/* || "${real_vol}" == /var/tmp/* ]]; then
    die "STACKCHAN_SD_VOLUME must not point inside a temp directory"
  fi
}

validate_bridge_host() {
  local host="$1"
  [[ -n "${host}" ]] || die "PRIVATE_PI5_BRIDGE_HOST is required"
  if [[ "${host}" == *"://"* || "${host}" == *"/"* || "${host}" == *" "* ]]; then
    die "PRIVATE_PI5_BRIDGE_HOST must be a host or IP only (no URL path)"
  fi
}

plan_action() {
  local action="$1"
  PLANNED_ACTIONS+=("${action}")
}

backup_or_confirm() {
  local target="$1"
  [[ -f "${target}" ]] || return 0
  if [[ "${OVERWRITE}" == "1" ]]; then
    plan_action "backup $(basename "${target}") -> $(basename "${target}").bak.<timestamp>"
    return 0
  fi
  plan_action "overwrite $(basename "${target}") (requires STACKCHAN_SD_OVERWRITE=1)"
}

run_backup_or_confirm() {
  local target="$1"
  [[ -f "${target}" ]] || return 0
  local backup="${target}.bak.$(date -u +%Y%m%dT%H%M%SZ)"
  if [[ "${OVERWRITE}" == "1" ]]; then
    cp -p "${target}" "${backup}"
    echo "[INFO] Backed up existing file to $(basename "${backup}")" >&2
    return 0
  fi
  die "refusing to overwrite $(basename "${target}") without STACKCHAN_SD_OVERWRITE=1"
}

print_dry_run() {
  echo "[DRY-RUN] No files written. Set STACKCHAN_SD_APPLY=1 to apply."
  echo "[DRY-RUN] Target volume: /Volumes/<SD_VOLUME>"
  echo "[DRY-RUN] Bridge endpoint: http://<PRIVATE_PI5_BRIDGE_HOST>:18080/v1/chat/completions"
  for action in "${PLANNED_ACTIONS[@]}"; do
    echo "[DRY-RUN] Would ${action}"
  done
}

write_yaml_files() {
  python3 - "${VOL}" "${BRIDGE_HOST}" "${AISERVICE}" "${HOME_WIFI_SSID:-}" "${HOME_WIFI_PASSWORD:-}" <<'PY'
import re
import sys
from pathlib import Path

vol, bridge_host, aiservice, wifi_ssid, wifi_password = sys.argv[1:6]

def yaml_double_quoted(value: str) -> str:
    escaped = (
        value.replace("\\", "\\\\")
        .replace('"', '\\"')
        .replace("\n", "\\n")
        .replace("\r", "\\r")
        .replace("\t", "\\t")
    )
    return f'"{escaped}"'

endpoint = f"http://{bridge_host}:18080/v1/chat/completions"
ex_path = Path(vol) / "app" / "AiStackChanEx" / "SC_ExConfig.yaml"
ex_path.parent.mkdir(parents=True, exist_ok=True)
ex_path.write_text(
    "\n".join(
        [
            "llm:",
            "  type: 4",
            '  model: "spark-qwen"',
            f"  customEndpoint: {yaml_double_quoted(endpoint)}",
            "",
            "tts:",
            "  type: 0",
            '  model: ""',
            '  voice: "3"',
            "",
            "stt:",
            "  type: 0",
            '  model: ""',
            "",
            "wakeword:",
            "  type: 0",
            '  keyword: ""',
            "",
            "moduleLLM:",
            "  rxPin: 18",
            "  txPin: 17",
            "",
        ]
    ),
    encoding="utf-8",
)

if wifi_ssid and wifi_password:
    sec_path = Path(vol) / "yaml" / "SC_SecConfig.yaml"
    sec_path.parent.mkdir(parents=True, exist_ok=True)
    sec_path.write_text(
        "\n".join(
            [
                "wifi:",
                f"  ssid: {yaml_double_quoted(wifi_ssid)}",
                f"  password: {yaml_double_quoted(wifi_password)}",
                "",
                "apikey:",
                f"  stt: {yaml_double_quoted('dummy-stt')}",
                f"  aiservice: {yaml_double_quoted(aiservice)}",
                f"  tts: {yaml_double_quoted('dummy-tts')}",
                "",
            ]
        ),
        encoding="utf-8",
    )
PY
}

if [[ -z "${VOL}" || -z "${BRIDGE_HOST}" ]]; then
  usage >&2
  exit 2
fi

PLANNED_ACTIONS=()

validate_volume "${VOL}"
validate_bridge_host "${BRIDGE_HOST}"

plan_action "write /app/AiStackChanEx/SC_ExConfig.yaml (llm.type 4)"
backup_or_confirm "${VOL}/app/AiStackChanEx/SC_ExConfig.yaml"
if [[ -n "${HOME_WIFI_SSID:-}" && -n "${HOME_WIFI_PASSWORD:-}" ]]; then
  plan_action "write /yaml/SC_SecConfig.yaml (wifi + apikey placeholders)"
  backup_or_confirm "${VOL}/yaml/SC_SecConfig.yaml"
elif [[ -n "${HOME_WIFI_SSID:-}" || -n "${HOME_WIFI_PASSWORD:-}" ]]; then
  die "HOME_WIFI_SSID and HOME_WIFI_PASSWORD must be set together"
fi
if [[ ! -f "${VOL}/yaml/SC_BasicConfig.yaml" ]]; then
  plan_action "copy /yaml/SC_BasicConfig.yaml (missing only)"
fi

if [[ "${APPLY}" != "1" ]]; then
  print_dry_run
  exit 0
fi

mkdir -p "${VOL}/app/AiStackChanEx" "${VOL}/yaml"

run_backup_or_confirm "${VOL}/app/AiStackChanEx/SC_ExConfig.yaml"
if [[ -n "${HOME_WIFI_SSID:-}" && -n "${HOME_WIFI_PASSWORD:-}" ]]; then
  run_backup_or_confirm "${VOL}/yaml/SC_SecConfig.yaml"
fi

write_yaml_files

if [[ ! -f "${VOL}/yaml/SC_BasicConfig.yaml" ]]; then
  cp "${TEMPLATE_BASIC}" "${VOL}/yaml/SC_BasicConfig.yaml"
fi

echo "[OK] Prepared Spark SD config (llm.type 4). Details omitted from logs."
