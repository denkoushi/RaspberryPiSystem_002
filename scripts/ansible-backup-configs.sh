#!/usr/bin/env bash
set -euo pipefail

# 設定ファイルのバックアップスクリプト
# 使用方法: ./scripts/ansible-backup-configs.sh [host]

BACKUP_DIR="/opt/backups/configs"
DATE=$(date +%Y%m%d_%H%M%S)
HOST="${1:-}"

if [ -n "$HOST" ]; then
  # リモートホストで実行
  ssh "$HOST" "mkdir -p $BACKUP_DIR && \
    if [ -f /etc/polkit-1/rules.d/50-pcscd-allow-all.rules ]; then
      cp /etc/polkit-1/rules.d/50-pcscd-allow-all.rules $BACKUP_DIR/polkit-50-pcscd-allow-all.rules.$DATE
    fi && \
    for service in status-agent.service status-agent.timer kiosk-browser.service signage-lite.service; do
      if [ -f /etc/systemd/system/\$service ]; then
        cp /etc/systemd/system/\$service $BACKUP_DIR/\$service.$DATE
      fi
    done && \
    echo 'Backup completed: $BACKUP_DIR'"
else
  # ローカルで実行
  mkdir -p "$BACKUP_DIR"

  # polkit設定ファイルのバックアップ
  if [ -f /etc/polkit-1/rules.d/50-pcscd-allow-all.rules ]; then
    cp /etc/polkit-1/rules.d/50-pcscd-allow-all.rules \
       "$BACKUP_DIR/polkit-50-pcscd-allow-all.rules.$DATE"
    echo "Backed up: polkit-50-pcscd-allow-all.rules.$DATE"
  fi

  # systemdサービスのバックアップ
  for service in status-agent.service status-agent.timer kiosk-browser.service signage-lite.service; do
    if [ -f "/etc/systemd/system/$service" ]; then
      cp "/etc/systemd/system/$service" \
         "$BACKUP_DIR/$service.$DATE"
      echo "Backed up: $service.$DATE"
    fi
  done

  echo "Backup completed: $BACKUP_DIR"
fi

