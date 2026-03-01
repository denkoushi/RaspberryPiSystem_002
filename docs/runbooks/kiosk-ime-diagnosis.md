---
title: Runbook: キオスク備考欄 日本語入力不具合の診断
tags: [運用, キオスク, IME, IBus, 備考欄, 診断, runbook]
audience: [運用者, 開発者]
last-verified: 2026-03-01
related:
  - ../knowledge-base/KB-investigation-kiosk-schedule-regression-20260301.md
  - ../knowledge-base/frontend.md#kb-276
  - ../plans/kiosk-ime-remark-field-execplan.md
category: runbooks
---

# Runbook: キオスク備考欄 日本語入力不具合の診断

## 目的

- 備考欄で「日本語入力モードになるが、キー入力のたびに ibus-ui ウィンドウが出現しスムーズに入力できない」不具合の原因を切り分ける。
- IBus のプロセス数、起動引数、gsettings、Chromium の ozone-platform 設定を確認する。

## 前提

- Pi4 キオスク端末への SSH 接続が可能であること。
- キオスクユーザー（例: tools04）として実行できること。

## 診断の実行方法

### 方法1: デプロイ時に自動実行（推奨）

kiosk ロールが適用されるデプロイ時に、診断タスクが自動的に実行される。Ansible の出力に診断結果が含まれる。

```bash
# 例: Pi5 から raspi4-robodrill01 にデプロイ
cd /opt/RaspberryPiSystem_002/infrastructure/ansible
ansible-playbook -i inventory.yml playbooks/deploy-staged.yml --limit "server:raspi4-robodrill01"
```

出力内の `Run IME diagnostic script on kiosk host` と `Display IME diagnostic output` タスクの結果を確認する。

### 方法2: 手動で SSH 経由で実行

Pi4 キオスク端末に SSH 接続し、診断スクリプトを実行する。

```bash
# 例: Pi5 経由で raspi4-robodrill01 に接続
ssh denkon5sd02@100.106.158.2 'ssh tools04@<PI4_IP> "bash -s"' < scripts/kiosk/diagnose-ime.sh
```

または、スクリプトを Pi4 にコピーしてから実行する。

```bash
# Pi4 にスクリプトをコピー
scp scripts/kiosk/diagnose-ime.sh tools04@<PI4_IP>:/tmp/
# 実行
ssh tools04@<PI4_IP> "bash /tmp/diagnose-ime.sh"
```

## 出力項目の見方

| 項目 | 正常値の例 | 異常時の判定 |
|------|------------|--------------|
| プロセス数 | 1 | 2以上→二重起動の可能性 |
| 起動引数 | `--replace --single --panel=disable` を含む | 含まれない→設定未反映 |
| gsettings panel show | `uint32 0` | `uint32 1`→パネル表示有効 |
| gsettings panel show-im-name | `false` | `true`→エンジン名表示有効 |
| XDG_SESSION_TYPE | `x11` | `wayland`→X11強制の要確認 |
| ozone-platform | `含まれる` | 含まれない→Chromium 135+ 対策未適用 |

## 診断結果の記録

診断結果を [KB-investigation-kiosk-schedule-regression-20260301.md](../knowledge-base/KB-investigation-kiosk-schedule-regression-20260301.md) の「診断結果の記録」セクションに記入する。

## 関連ドキュメント

- [KB-investigation-kiosk-schedule-regression-20260301.md](../knowledge-base/KB-investigation-kiosk-schedule-regression-20260301.md): 調査対象の不具合と診断結果記録
- [frontend.md#KB-276](../knowledge-base/frontend.md#kb-276-pi4キオスクの日本語入力モード切替問題とibus設定改善): IBus 設定の過去履歴
- [kiosk-ime-remark-field-execplan.md](../plans/kiosk-ime-remark-field-execplan.md): 実行計画
