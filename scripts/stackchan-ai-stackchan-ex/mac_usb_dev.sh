#!/usr/bin/env bash
# Mac USB 開発: AI_StackChan_Ex の clone / パッチ / ビルド / シリアル監視
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LOCK_JSON="${REPO_ROOT}/scripts/stackchan-ai-stackchan-ex/supply-chain-lock.json"
CHATGPT_PATCH="${REPO_ROOT}/scripts/stackchan-ai-stackchan-ex/apply_chatgpt_private_bridge.py"
VOICE_OVERLAY="${REPO_ROOT}/scripts/stackchan-ai-stackchan-ex/apply_voice_rework_overlay.py"
REVERT_OVERLAYS="${REPO_ROOT}/scripts/stackchan-ai-stackchan-ex/revert_firmware_overlays.py"
PIN_SCRIPT="${REPO_ROOT}/scripts/stackchan-ai-stackchan-ex/apply_platformio_github_pins.py"

CLONE_DIR="${STACKCHAN_FW_DIR:-${HOME}/AI_StackChan_Ex}"
PIO_ENV="${STACKCHAN_PIO_ENV:-m5stack-cores3}"
USB_PORT="${STACKCHAN_USB_PORT:-}"

# 例: http://192.168.128.112:18080
BRIDGE_BASE_URL="${STACKCHAN_BRIDGE_BASE_URL:-http://192.168.128.112:18080}"
STACKCHAN_TOKEN="${STACKCHAN_TOKEN:-}"
# 0=safe mode（chat/simple のみ）。1=録音 overlay + voice-turn URL（実験・明示 opt-in）
STACKCHAN_ENABLE_VOICE_OVERLAY="${STACKCHAN_ENABLE_VOICE_OVERLAY:-0}"
# 1=未コミット overlay 関連変更を破棄して revert（既定 0 で dirty 時は停止）
STACKCHAN_FORCE_CLEAN="${STACKCHAN_FORCE_CLEAN:-0}"

usage() {
  cat <<EOF
Usage: $(basename "$0") <command>

Commands:
  setup      clone + checkout + apply patches + platformio pins
  ports      list USB serial ports
  monitor    pio device monitor (needs STACKCHAN_USB_PORT or auto)
  build      pio run
  upload     pio run -t upload
  all        setup + build + upload

Environment:
  STACKCHAN_FW_DIR              clone directory (default: ~/AI_StackChan_Ex)
  STACKCHAN_BRIDGE_BASE_URL     Pi5 bridge base (default: http://192.168.128.112:18080)
  STACKCHAN_USB_PORT            e.g. /dev/cu.usbmodem1101
  STACKCHAN_PIO_ENV             default: m5stack-cores3
  STACKCHAN_TOKEN               optional X-Stackchan-Token value for firmware
  STACKCHAN_ENABLE_VOICE_OVERLAY  0=safe mode (default), 1=apply voice-turn recording overlay
  STACKCHAN_FORCE_CLEAN           1=discard local overlay-related changes on setup (default 0)

Safe mode (STACKCHAN_ENABLE_VOICE_OVERLAY=0, default):
  CHATGPT_API_URL -> /api/stackchan/chat/simple only
  No device-side WAV recording / voice-turn POST (utterance overlay also not applied)

Voice overlay opt-in (STACKCHAN_ENABLE_VOICE_OVERLAY=1):
  apply_voice_rework_overlay.py + STACKCHAN_VOICE_TURN_URL
EOF
}

detect_usb_port() {
  if [[ -n "${USB_PORT}" ]]; then
    echo "${USB_PORT}"
    return
  fi
  local p
  p="$(ls /dev/cu.usbmodem* 2>/dev/null | head -1 || true)"
  if [[ -z "${p}" ]]; then
    echo "No /dev/cu.usbmodem* found. Set STACKCHAN_USB_PORT." >&2
    exit 1
  fi
  echo "${p}"
}

pinned_commit() {
  python3 -c "import json; print(json.load(open('${LOCK_JSON}'))['upstream_ai_stackchan_ex']['pinned_commit'])"
}

voice_overlay_enabled() {
  case "${STACKCHAN_ENABLE_VOICE_OVERLAY}" in
    1|true|yes|on|TRUE|YES|ON) return 0 ;;
    *) return 1 ;;
  esac
}

force_clean_enabled() {
  case "${STACKCHAN_FORCE_CLEAN}" in
    1|true|yes|on|TRUE|YES|ON) return 0 ;;
    *) return 1 ;;
  esac
}

run_revert_overlays() {
  local -a revert_args=()
  if force_clean_enabled; then
    revert_args+=(--force-clean)
  fi
  revert_args+=("${CLONE_DIR}")
  python3 "${REVERT_OVERLAYS}" "${revert_args[@]}"
}

run_setup() {
  local commit
  commit="$(pinned_commit)"
  if [[ ! -d "${CLONE_DIR}/.git" ]]; then
    git clone https://github.com/ronron-gh/AI_StackChan_Ex.git "${CLONE_DIR}"
  fi
  cd "${CLONE_DIR}"
  git fetch --depth 1 origin "${commit}" 2>/dev/null || git fetch origin
  git checkout "${commit}"
  run_revert_overlays
  python3 "${CHATGPT_PATCH}" "${CLONE_DIR}"
  if voice_overlay_enabled; then
    python3 "${VOICE_OVERLAY}" "${CLONE_DIR}"
    echo "Voice overlay applied (STACKCHAN_ENABLE_VOICE_OVERLAY=1)"
  else
    echo "Voice overlay skipped (safe mode: STACKCHAN_ENABLE_VOICE_OVERLAY=0)"
  fi
  python3 "${PIN_SCRIPT}" "${CLONE_DIR}/firmware/platformio.ini"
  echo "Setup OK at ${CLONE_DIR} @ ${commit}"
}

build_flags() {
  local chat_url="${BRIDGE_BASE_URL%/}/api/stackchan/chat/simple"
  local flags="-DCHATGPT_API_URL=\\\"${chat_url}\\\" -DCHATGPT_API_USE_AUTH_BEARER=0"
  if voice_overlay_enabled; then
    local voice_turn_url="${BRIDGE_BASE_URL%/}/api/stackchan/voice-turn"
    flags+=" -DSTACKCHAN_VOICE_TURN_URL=\\\"${voice_turn_url}\\\""
  fi
  if [[ -n "${STACKCHAN_TOKEN}" ]]; then
    flags+=" -DCHATGPT_STACKCHAN_TOKEN=\\\"${STACKCHAN_TOKEN}\\\""
  fi
  echo "${flags}"
}

run_build() {
  cd "${CLONE_DIR}/firmware"
  export PLATFORMIO_BUILD_FLAGS="$(build_flags)"
  echo "PLATFORMIO_BUILD_FLAGS=${PLATFORMIO_BUILD_FLAGS}"
  pio run -e "${PIO_ENV}"
}

run_upload() {
  local port
  port="$(detect_usb_port)"
  cd "${CLONE_DIR}/firmware"
  export PLATFORMIO_BUILD_FLAGS="$(build_flags)"
  pio run -e "${PIO_ENV}" -t upload --upload-port "${port}"
}

run_monitor() {
  local port
  port="$(detect_usb_port)"
  cd "${CLONE_DIR}/firmware"
  pio device monitor --port "${port}" -b 115200
}

cmd="${1:-}"
case "${cmd}" in
  setup) run_setup ;;
  ports) pio device list 2>/dev/null || ls /dev/cu.usb* 2>/dev/null || true ;;
  build) run_build ;;
  upload) run_upload ;;
  monitor) run_monitor ;;
  all) run_setup && run_build && run_upload ;;
  ""|-h|--help) usage ;;
  *) echo "Unknown command: ${cmd}" >&2; usage; exit 1 ;;
esac
