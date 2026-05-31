#!/usr/bin/env bash
# CoreS3 Step C1/C2/C3 — Avatar bring-up sub-probes (build/upload/monitor).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
VARIANT="${STACKCHAN_PROBE_STEPC_VARIANT:-}"
USB_PORT="${STACKCHAN_USB_PORT:-}"

usage() {
  cat <<EOF
Usage: $(basename "$0") <c1|c2|c3> <command>

Commands: build | upload | monitor

Environment:
  STACKCHAN_USB_PORT
  STACKCHAN_PROBE_STEPC_VARIANT   (optional if variant passed as arg)
  STACKCHAN_AI_STACKCHAN_EX       required for c3 (default: \$HOME/AI_StackChan_Ex)
EOF
}

resolve_variant() {
  local v="${1:-${VARIANT}}"
  case "${v}" in
    c1|C1) echo "c1" ;;
    c2|C2) echo "c2" ;;
    c3|C3) echo "c3" ;;
    *)
      echo "Unknown variant: ${v} (use c1, c2, or c3)" >&2
      exit 1
      ;;
  esac
}

resolve_dirs() {
  local v="$1"
  case "${v}" in
    c1)
      PROBE_DIR="${ROOT}/cores3-probe-stepc1"
      PIO_ENV="m5stack-cores3-probe-stepc1"
      ;;
    c2)
      PROBE_DIR="${ROOT}/cores3-probe-stepc2"
      PIO_ENV="m5stack-cores3-probe-stepc2"
      ;;
    c3)
      PROBE_DIR="${ROOT}/cores3-probe-stepc3"
      PIO_ENV="m5stack-cores3-probe-stepc3"
      export STACKCHAN_AI_STACKCHAN_EX="${STACKCHAN_AI_STACKCHAN_EX:-${HOME}/AI_StackChan_Ex}"
      local lib="${STACKCHAN_AI_STACKCHAN_EX}/firmware/lib/m5stack-avatar"
      if [[ ! -f "${lib}/library.json" ]]; then
        echo "C3 requires local m5stack-avatar at: ${lib}" >&2
        echo "Clone AI_StackChan_Ex or set STACKCHAN_AI_STACKCHAN_EX." >&2
        exit 1
      fi
      ;;
  esac
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

variant_arg="${1:-}"
cmd="${2:-}"
if [[ "${variant_arg}" == "-h" || "${variant_arg}" == "--help" || -z "${variant_arg}" ]]; then
  usage
  exit 0
fi

VARIANT="$(resolve_variant "${variant_arg}")"
resolve_dirs "${VARIANT}"

case "${cmd}" in
  build) run_build ;;
  upload) run_upload ;;
  monitor) run_monitor ;;
  ""|-h|--help) usage ;;
  *) echo "Unknown command: ${cmd}" >&2; usage; exit 1 ;;
esac
