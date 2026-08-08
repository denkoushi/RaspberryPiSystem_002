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

標準のPi4経路は `scripts/update-all-clients.sh` から
`standard-ansible-release.py`、`deploy-release-standard.yml`、`release_kiosk`へ進む。
`release_kiosk`は `infrastructure/ansible/roles/kiosk` をimportしないため、
このRunbookのIME診断タスクや `roles/kiosk/tasks/firefox-chrome.yml` のFirefox profile customizationを
デプロイ時に自動実行しない。標準routeの実行結果にIME診断出力が含まれるとは判断しない。

一方、inventoryの `kiosk_browser_engine` / `kiosk_browser_mode` は標準routeの入力である。
`release_kiosk` は `kiosk-launch.sh.j2` をrenderし、`switch.yml` でlauncherをbackup付きでinstallして
`kiosk-browser.service` をrestartするため、ブラウザengine選択自体は標準releaseで反映される。

### 現行の診断経路: 手動で SSH 経由で実行

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
| 競合シグネチャ | `--daemonize --xim` が0件 | 1件以上→競合起動の可能性 |
| 単一オーナー判定 | `PASS` | `FAIL`→競合起動の可能性 |
| gsettings panel show | `0` | `1`→パネル表示有効 |
| gsettings panel show-im-name | `false` | `true`→エンジン名表示有効 |
| XDG_SESSION_TYPE | `x11`（対話セッション） | `wayland`→X11強制の要確認 |
| ozone-platform | `含まれる` | 含まれない→Chromium 135+ 対策未適用 |

補足:
- Ansible の `script` 実行では `XDG_SESSION_TYPE=tty` と出ることがある。これは非対話実行のためで、単体では異常と断定しない。

## 再発時の対処（KB-287 解決済み）

`ibus_owner_mode` / `ibus_disable_competing_autostart` などのinventory値を変更しても、
standard routeが `roles/kiosk` のIME診断・Firefox profile customizationを実行するわけではない。
このRunbookでは、`update-all-clients.sh` の実行だけでその診断やFirefox設定が反映されるとは案内しない。
まず上記の手動SSH診断で現物状態を確認し、設定の所有callerが確認できない変更は行わない。

詳細は [KB-287](../knowledge-base/frontend.md#kb-287-キオスク備考欄の日本語入力不具合ibus-ui-ウィンドウ出現で入力不安定) を参照。

## 診断結果の記録

診断結果を [KB-investigation-kiosk-schedule-regression-20260301.md](../knowledge-base/KB-investigation-kiosk-schedule-regression-20260301.md) の「診断結果の記録」セクションに記入する。

## ブラウザengine選択の確認とrollback

承認済みのstandard release後、既存のengine選択を次のread-only確認で検証する。

```bash
ssh tools04@<PI4_IP> 'systemctl is-active kiosk-browser.service'
ssh tools04@<PI4_IP> 'ps -ef | awk "/firefox|chromium/ {print; c++; if (c>=10) exit}"'
```

実機では、備考欄の日本語入力、候補ウィンドウ、生産スケジュール表示、NFC、電源操作を確認する。

standard healthが失敗した場合、`release_kiosk` のrollbackはinstall結果のbackup fileを復元し、
新規ファイルを除去したうえでagent composeと `kiosk-browser.service` / `status-agent.timer` を再起動し、
health checksを再実行する。inventoryのengine選択を意図的に戻す場合も、host上で手編集せず、
次回の明示承認済みstandard releaseで同じ対象scopeに反映する。

なお、`roles/kiosk/tasks/firefox-chrome.yml` のFirefox profile customizationはstandard routeでは適用されない。

## 関連ドキュメント

- [KB-investigation-kiosk-schedule-regression-20260301.md](../knowledge-base/KB-investigation-kiosk-schedule-regression-20260301.md): 調査対象の不具合と診断結果記録
- [frontend.md#KB-276](../knowledge-base/frontend.md#kb-276-pi4キオスクの日本語入力モード切替問題とibus設定改善): IBus 設定の過去履歴
- [kiosk-ime-remark-field-execplan.md](../plans/kiosk-ime-remark-field-execplan.md): 実行計画
