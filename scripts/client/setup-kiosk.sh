#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <kiosk-url>" >&2
  exit 1
fi

TARGET_URL="$1"

if ! command -v chromium-browser >/dev/null 2>&1; then
  echo "chromium-browser が必要です。\n  sudo apt-get install -y chromium-browser" >&2
  exit 1
fi

echo "[client] systemd サービスと Chromium キオスク起動スクリプトを作成する準備です。" \
  "Milestone 2 で詳細実装します。" >&2

echo "とりあえず以下のコマンドでキオスクを手動起動できます:" >&2
cat <<MSG
chromium-browser --kiosk --app=$TARGET_URL --start-fullscreen --noerrdialogs --disable-session-crashed-bubble
MSG
