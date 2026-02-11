#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <kiosk-url>" >&2
  exit 1
fi

TARGET_URL="$1"
TARGET_ORIGIN="${TARGET_URL%%/kiosk*}"
if [[ "$TARGET_ORIGIN" == "$TARGET_URL" ]]; then
  TARGET_ORIGIN="${TARGET_URL%/}"
fi

if [[ $EUID -ne 0 ]]; then
  echo "root 権限で実行してください (sudo ./scripts/client/setup-kiosk.sh <url>)" >&2
  exit 1
fi

if ! command -v chromium-browser >/dev/null 2>&1; then
  echo "chromium-browser が必要です。: sudo apt-get install -y chromium-browser" >&2
  exit 1
fi

KIOSK_USER="${SUDO_USER:-pi}"
LAUNCHER_PATH="/usr/local/bin/kiosk-launch.sh"
SERVICE_PATH="/etc/systemd/system/kiosk-browser.service"

cat >"$LAUNCHER_PATH" <<EOF
#!/usr/bin/env bash
export DISPLAY=:0
export XAUTHORITY=/home/$KIOSK_USER/.Xauthority
export GTK_USE_PORTAL=0
exec chromium-browser \\
  --kiosk \\
  --app="$TARGET_URL" \\
  --start-fullscreen \\
  --noerrdialogs \\
  --disable-session-crashed-bubble \\
  --autoplay-policy=no-user-gesture-required \\
  --disable-translate \\
  --overscroll-history-navigation=0 \\
  --use-fake-ui-for-media-stream \\
  --allow-insecure-localhost \\
  --allow-running-insecure-content \\
  --ignore-certificate-errors \\
  --unsafely-treat-insecure-origin-as-secure="$TARGET_ORIGIN,http://localhost:7071"
EOF
chmod +x "$LAUNCHER_PATH"

cat >"$SERVICE_PATH" <<EOF
[Unit]
Description=Factory Kiosk Browser
After=graphical.target network-online.target
Wants=graphical.target

[Service]
Type=simple
User=$KIOSK_USER
Environment=DISPLAY=:0
ExecStart=$LAUNCHER_PATH
Restart=always
RestartSec=5

[Install]
WantedBy=graphical.target
EOF

systemctl daemon-reload
systemctl enable kiosk-browser.service
systemctl restart kiosk-browser.service

cat <<'EOM'
キオスクブラウザの systemd サービスを作成しました。
- 停止: sudo systemctl stop kiosk-browser
- ログ: journalctl -u kiosk-browser -f
ディスプレイを接続済みの状態で Pi を再起動すると自動的にフルスクリーンでブラウザが立ち上がります。
EOM
