#!/usr/bin/env bash
# Pi3 サイネージ復旧（Pi5 上で実行）
# - Tailscale / SSH が復旧したら signage-lite を再起動する
# - Pi3 が tailnet から外れている間は 30 秒間隔で待機
set -euo pipefail

REPO="${REPO_ROOT:-/opt/RaspberryPiSystem_002}"
INVENTORY="${REPO}/infrastructure/ansible/inventory.yml"
HOST="raspberrypi3"
LOG="${LOG_FILE:-/var/log/recover-pi3-signage.log}"
INTERVAL_SEC="${INTERVAL_SEC:-30}"
MAX_WAIT_SEC="${MAX_WAIT_SEC:-0}" # 0 = 無制限

log() {
  echo "$(date -Iseconds) $*" | tee -a "${LOG}"
}

can_ping_host() {
  ansible "${HOST}" -i "${INVENTORY}" -m ping -o 2>/dev/null | grep -q 'SUCCESS'
}

recover_signage() {
  ansible "${HOST}" -i "${INVENTORY}" -b -m shell -a "$(cat <<'REMOTE'
set -euo pipefail
export DISPLAY=:0
export XAUTHORITY=/home/signageras3/.Xauthority

# Tailscale: tag:signage（raspberrypi-2）。未接続なら再 up（authkey は vault 経由デプロイ時のみ有効）
if command -v tailscale >/dev/null 2>&1; then
  backend="$(tailscale status --json 2>/dev/null | python3 -c 'import sys,json; print(json.load(sys.stdin).get("BackendState",""))' 2>/dev/null || true)"
  if [[ "${backend}" != "Running" ]]; then
    echo "tailscale: BackendState=${backend:-unknown}, attempting up..."
    tailscale up --advertise-tags=tag:signage --reset 2>/dev/null || tailscale up --advertise-tags=tag:signage 2>/dev/null || true
    sleep 3
  fi
fi

/usr/local/bin/signage-update.sh || true
systemctl unmask signage-lite.service 2>/dev/null || true
systemctl enable signage-lite.service signage-lite-update.timer 2>/dev/null || true
systemctl restart signage-lite.service || systemctl start signage-lite.service
systemctl start signage-lite-update.timer 2>/dev/null || true

echo "signage-lite: $(systemctl is-active signage-lite.service 2>/dev/null || echo unknown)"
echo "timer: $(systemctl is-active signage-lite-update.timer 2>/dev/null || echo unknown)"
ls -lh /run/signage/current.jpg 2>/dev/null || echo "no cache image"
pgrep -a feh || echo "no feh"
REMOTE
)"
}

main() {
  mkdir -p "$(dirname "${LOG}")"
  log "recover-pi3-signage-remote: start (host=${HOST}, interval=${INTERVAL_SEC}s)"
  start_ts=$(date +%s)

  while true; do
    if can_ping_host; then
      log "Pi3 reachable via Ansible SSH"
      if recover_signage; then
        log "recovery commands completed"
        exit 0
      fi
      log "recovery failed; will retry"
    else
      elapsed=$(( $(date +%s) - start_ts ))
      log "Pi3 unreachable (${elapsed}s elapsed)"
    fi

    if [[ "${MAX_WAIT_SEC}" -gt 0 ]]; then
      elapsed=$(( $(date +%s) - start_ts ))
      if [[ "${elapsed}" -ge "${MAX_WAIT_SEC}" ]]; then
        log "timeout after ${MAX_WAIT_SEC}s"
        exit 1
      fi
    fi

    sleep "${INTERVAL_SEC}"
  done
}

main "$@"
