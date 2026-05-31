#!/usr/bin/env bash
# CoreS3 bring-up probe — build/upload only (not AI_StackChan_Ex).
set -euo pipefail

PROBE_DIR="$(cd "$(dirname "$0")/cores3-probe" && pwd)"
PIO_ENV="${STACKCHAN_PROBE_PIO_ENV:-m5stack-cores3-probe}"
USB_PORT="${STACKCHAN_USB_PORT:-}"

usage() {
  cat <<EOF
Usage: $(basename "$0") <command>

Commands:
  build      pio run (no upload)
  upload     pio run -t upload (requires STACKCHAN_USB_PORT or /dev/cu.usbmodem*)
  monitor    pio device monitor

Environment:
  STACKCHAN_PROBE_PIO_ENV   m5stack-cores3-probe (default) or m5stack-cores3-probe-usbcdc
  STACKCHAN_USB_PORT        e.g. /dev/cu.usbmodem1101

Do NOT use this script while recovering with official firmware unless you intend to flash the probe.
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
  *) echo "Unknown command: ${cmd}" >&2; usage; exit 1 ;;
esac
