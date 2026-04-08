---
title: Runbook: キオスクで上辺メニューバー表示（Wi-Fi GUI設定）
tags: [運用, キオスク, Wi-Fi, labwc, メニューバー, runbook]
related:
  - ../knowledge-base/infrastructure/miscellaneous.md
---

# Runbook: キオスクで上辺メニューバー表示（Wi-Fi GUI設定）

## 概要

キオスクモードでは上辺メニューバー（wf-panel-pi）が非表示のため、Wi-FiアイコンからGUIで設定変更できない。**Super+Shift+P** で一時的にメニューバーを表示し、Wi-Fiアイコンから設定変更可能にする。

Firefox キオスクでは、Ansible 配布の専用プロファイルで **タブバー・アドレスバーを折りたたみ表示**にしている。ブラウザ枠を一時的に出す操作は OS パネルとは別（下記「Firefox（ブラウザ枠）」）。

## ショートカット

| キー | 動作 |
|------|------|
| **Super+Shift+P** | 上辺メニューバー（wf-panel-pi）を表示 |

### Firefox（ブラウザ枠）

| 操作 | 動作 |
|------|------|
| 画面上端へマウスを移動 | 折りたたんでいたナビゲータ（タブ・URL バー）が下がって見える |
| **Ctrl+L** または **F6** | アドレスバーへフォーカス（ツールバーが表示されやすい） |
| **Alt** または **F10** | メニューバー操作（Firefox 標準） |

実装の詳細は [KB-336](../knowledge-base/infrastructure/miscellaneous.md)（同ファイル内「KB-336」見出し）を参照。本番デプロイ済み端末での Run ID・リモート検証項目・`kiosk-launch.sh` の **`1FF_PROFILE` / `基底の値が大きすぎます`** 対処も同 KB の「本番デプロイ」「トラブルシューティング」を参照。

- **Super**: キーボードの Windows キー（四角形のロゴキー）のこと
- 表示後、Wi-FiアイコンをクリックしてGUIで設定変更可能

## 前提条件

- Pi4 キオスク端末（raspberrypi4 / raspi4-robodrill01）
- labwc + wf-panel-pi 環境
- デプロイ済み（`show-kiosk-panel.sh` と labwc rc.xml の keybind が設定済み）

## 設定の確認

```bash
# Pi4 に SSH 接続して確認（ユーザーは tools03 または tools04、端末により異なる）
ssh <USER>@<PI4_IP> "cat /usr/local/bin/show-kiosk-panel.sh"
ssh <USER>@<PI4_IP> "grep -A5 'W-S-p' ~/.config/labwc/rc.xml"
```

## 設定が反映されない場合

1. labwc の設定は次回ログイン時に読み込まれる
2. 即時反映が必要な場合: キオスクブラウザを再起動、または端末を再起動
3. デプロイを再実行: `./scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --limit raspberrypi4`

## トラブルシューティング

- **ショートカットが効かない**: `~/.config/labwc/rc.xml` に keybind が存在するか確認。`grep -A5 'W-S-p' ~/.config/labwc/rc.xml`（ユーザーは tools03 または tools04）
- **デプロイ後にショートカットが効かない場合（labwc の再読み込み）**: labwc は rc.xml の変更をホットリロードしない。デプロイで rc.xml を更新したが labwc が先に起動していた場合、keybind が読み込まれていない。**即時対処**: Pi4 に SSH 接続し `sudo kill -s HUP $(pgrep -x labwc)` を実行して labwc に SIGHUP を送り、設定を再読み込みさせる。**代替**: 端末を再起動するか、再ログインする。詳細は [KB-289](../knowledge-base/infrastructure/miscellaneous.md#kb-289-pi4-kensakumain-の-firefox-移行と-supershiftp-キーボードショートカット上辺メニューバー表示) を参照
- **Super キーが分からない**: キーボード左下の四角形ロゴキー（Windows キー）を押す。Pi4 キーボードでは「Command」キー相当の位置にある場合もある
- **labwc の keybind 表記**: `W`=Super, `S`=Shift, `A`=Alt, `C`=Ctrl

## 関連

- `infrastructure/ansible/roles/kiosk/templates/show-kiosk-panel.sh.j2`
- `infrastructure/ansible/roles/kiosk/tasks/main.yml`（labwc keybind タスク）
- `infrastructure/ansible/roles/kiosk/tasks/firefox-chrome.yml`（Firefox userChrome 配布）
