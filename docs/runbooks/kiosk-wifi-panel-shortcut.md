---
title: Runbook: Pi4 キオスクの左上コーナーと Wi-Fi パネル
tags: [運用, キオスク, Wi-Fi, labwc, メニューバー, runbook]
related:
  - ../guides/deployment.md
---

# Pi4 キオスクの左上コーナーと Wi-Fi パネル

通常は OS の上辺パネルと Chromium のタイトルバーを表示しない。
画面の**最も左上**（縦横 3 px 以内）にマウスを約 0.3 秒置くとパネルが現れる。
**Super+Shift+P**（Super は Windows キー）でも同じパネルを表示できる。
Wi-Fi アイコンから接続先やパスワードを設定する。

ページ内（画面上端から 80 px 以上）をクリックするとパネルが消える。
パネル付近のクリックや無操作では閉じないため、Wi-Fi のポップアップや
パスワード入力中も使用できる。ただし表示から **15 分**で安全のため閉じる。
パネル表示中は exclusive zone により、ページ領域がパネルの高さだけ縮む。

## 配布と確認

標準ローリング更新の `release_kiosk` が `manage_kiosk_browser` 有効端末へ配布する。
labwc は `-m`（設定の合成）で起動するため、ユーザーの `~/.config/labwc/autostart` を
置いてもシステムの `/etc/xdg/labwc/autostart` は止められず、両方が実行される。
そのためユーザー側の autostart は置かない（初回版が置いた上書きは、内容が一致する場合だけ
release が削除する。残すと kanshi、pcmanfm-pi、ibus などが二重に起動する）。
ログインのたびに起動する `lwrespawn /usr/bin/wf-panel-pi` と旧パネルは、
センサーが起動直後と 5 秒ごとに停止する。
センサーの unit は `After=graphical.target` を明示している。これがないと kiosk-browser との
起動順序が循環し、起動時にセンサーの開始が取り消されてパネルが出たままになる。
ショートカットはセンサーへ SIGUSR1 を送る。rc.xml はバックアップ後に文字列編集し、
ルート外にある旧ショートカットを修復する。labwc の再読み込みとブラウザの再起動で
タイトルバー設定を反映する。Chromium の起動フラグは変更しない。
labwc 0.9 までは窓を WM_CLASS の instance（`<host>__kiosk`）、0.20 以降は class（`Chromium`）で
見分けるため、両方の規則を入れている。Pi4 ごとに labwc の版が異なり（0.8.4〜0.9.7）、
OS の更新で 0.20 系になっても題名の帯が戻らない。

端末で確認する（配布手順は [deployment](../guides/deployment.md) を参照）:

```bash
systemctl status kiosk-hotcorner
journalctl -u kiosk-hotcorner -n 50 --no-pager
```

表示・非表示イベントが記録される。Xwayland の終了・接続失敗時はセンサーも終了し、
systemd が 3 秒後に再起動する。Wayland ソケットはユーザーの runtime directory
内で探索する。コーナー、ショートカット、ページクリック、Wi-Fi 入力中の維持を実機で確認する。

## ロールバック

更新途中の失敗は標準 release の rollback が配布ファイル、所有者・権限、rc.xml を復元する。
今回初めて導入した `kiosk-hotcorner.service` は停止・無効化して削除し、
既存サービスなら更新前の有効化・稼働状態へ戻す。復元後は labwc を再読み込みし、
通常更新ではブラウザを再起動する。旧パネルの常時表示を現在のセッションにも戻すには、
再ログインまたは端末再起動が必要。残った障害は
[deploy-status-recovery](deploy-status-recovery.md) に従う。

成功後に手動で戻す可能性がある場合は、更新前に rc.xml、
`show-kiosk-panel.sh` と hotcorner unit の有無・状態を別途保存する。
成功した release の一時バックアップは cleanup される。
手動復旧ではセンサーを停止・無効化し、保存したファイルと所有者・権限を復元する。
新規導入だったセンサーと unit を削除して `systemctl daemon-reload` を実行し、端末を再ログインまたは再起動する。
更新前からセンサーがあった場合は、その unit と有効化状態も復元する。
旧 SHA の再配布だけでは、新設したファイルの削除は行われない。
