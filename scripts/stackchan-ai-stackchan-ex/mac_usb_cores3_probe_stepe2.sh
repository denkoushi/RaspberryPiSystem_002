#!/usr/bin/env bash
# CoreS3 Step E2 — Face::draw once (upload after E1 visual check).
set -euo pipefail

PROBE_DIR="$(cd "$(dirname "$0")/cores3-probe-stepe2" && pwd)"
PIO_ENV="${STACKCHAN_PROBE_PIO_ENV:-m5stack-cores3-probe-stepe2}"
USB_PORT="${STACKCHAN_USB_PORT:-}"

export STACKCHAN_AI_STACKCHAN_EX="${STACKCHAN_AI_STACKCHAN_EX:-${HOME}/AI_StackChan_Ex}"
AVATAR_LIB="${STACKCHAN_AI_STACKCHAN_EX}/firmware/lib/m5stack-avatar"

usage() {
  cat <<EOF
Usage: $(basename "$0") <command>

Commands: build | upload | monitor

Environment:
  STACKCHAN_USB_PORT
  STACKCHAN_AI_STACKCHAN_EX
EOF
}

if [[ ! -f "${AVATAR_LIB}/library.json" ]]; then
  echo "Step E2 requires: ${AVATAR_LIB}" >&2
  exit 1
fi

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

run_build() {
  cd "${PROBE_DIR}"
  pio run -e "${PIO_ENV}"
}

run_upload() {
  local port
  port="$(detect_usb_port)"
  cd "${PROBE_DIR}"
  pio run -e "${PIO_ENV}" -t upload --upload-port "${port}"
}

run_monitor() {
  local port
  port="$(detect_usb_port)"
  cd "${PROBE_DIR}"
  pio device monitor --port "${port}" -b 115200
}

cmd="${1:-}"
case "${cmd}" in
  build) run_build ;;
  upload) run_upload ;;
  monitor) run_monitor ;;
  ""|-h|--help) usage ;;
  *) echo "Unknown: ${cmd}" >&2; usage; exit 1 ;;
esac
