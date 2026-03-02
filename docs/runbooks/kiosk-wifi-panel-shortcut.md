---
title: Runbook: キオスクで上辺メニューバー表示（Wi-Fi GUI設定）
tags: [運用, キオスク, Wi-Fi, labwc, メニューバー, runbook]
related:
  - ../knowledge-base/infrastructure/miscellaneous.md
---

# Runbook: キオスクで上辺メニューバー表示（Wi-Fi GUI設定）

## 概要

キオスクモードでは上辺メニューバー（wf-panel-pi）が非表示のため、Wi-FiアイコンからGUIで設定変更できない。**Super+Shift+P** で一時的にメニューバーを表示し、Wi-Fiアイコンから設定変更可能にする。

## ショートカット

| キー | 動作 |
|------|------|
| **Super+Shift+P** | 上辺メニューバー（wf-panel-pi）を表示 |

表示後、Wi-FiアイコンをクリックしてGUIで設定変更可能。

## 前提条件

- Pi4 キオスク端末（raspberrypi4 / raspi4-robodrill01）
- labwc + wf-panel-pi 環境
- デプロイ済み（`show-kiosk-panel.sh` と labwc rc.xml の keybind が設定済み）

## 設定の確認

```bash
# Pi4 に SSH 接続して確認
ssh tools03@<PI4_IP> "cat /usr/local/bin/show-kiosk-panel.sh"
ssh tools03@<PI4_IP> "grep -A5 'W-S-p' /home/tools03/.config/labwc/rc.xml"
```

## 設定が反映されない場合

1. labwc の設定は次回ログイン時に読み込まれる
2. 即時反映が必要な場合: キオスクブラウザを再起動、または端末を再起動
3. デプロイを再実行: `./scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --limit raspberrypi4`

## 関連

- `infrastructure/ansible/roles/kiosk/templates/show-kiosk-panel.sh.j2`
- `infrastructure/ansible/roles/kiosk/tasks/main.yml`（labwc keybind タスク）
