# KB-421: kensakuMain で動画を開くと画面が止まって震えた（古い labwc / OS を更新して解消）

- Status: `active`
- Scope: Pi4 キオスク `raspberrypi4`（kensakuMain、tools03、Tailscale 100.74.144.79）の OS パッケージ。アプリのコードは変えていない。

## Context

2026-10-16 15:00〜15:30。組立＞作る・直す＞素材の動画で「Sample動画」を開くと、映像が出ず、画面が小刻みに震え、ポップアップを閉じられなかった。作業者はブラウザを閉じて逃げた（15:00:22 と 15:18:03 に `kiosk-browser.service` が正常終了して自動で再起動。10/14 13:28・13:33、10/15 15:26 にも同じ終わり方がある）。

## Reproduction (18:26, on the device)

- 稼働中のブラウザに debugging port（127.0.0.1:9222、Pi5 経由の SSH トンネル）でつなぎ、作業場ページで 動画 → 再生 を押した。新しいブラウザは起動していない。
- 実際の画面を `grim` で 0.2 秒ごとに撮ると、2 枚の画像（開きかけで潰れたダイアログと、全体が出たダイアログ）が交互に出続けた。これが「震え」。
- ページ側は正常だった: `<video>` は `readyState 4`・360×640、`requestAnimationFrame` は毎秒 66 回、閉じる を押すと DOM 上はダイアログが閉じ、ページ移動も反映された。それでも画面は同じ 2 枚のまま。描いた結果が画面に届いていない状態で、「閉じられない」もこれで説明がつく。
- CDP の `Page.captureScreenshot` は真っ白を返した。ウインドウの大きさ変更でも直らず、ブラウザを閉じると直った。
- 再現中、ログに GPU のエラーは出なかった。15:17:53〜15:18:01 に出ていた `MakeFromBackendTexture() failed` / `glBeginRasterCHROMIUM` の GL エラーは、止まった状態が長く続いた後の二次的なものと見ている。

## Cause (narrowed, not proven)

7 台の Pi4 の版を読んで比べた（2026-10-16）:

| 端末 | Chromium | labwc | Mesa | カーネル |
|---|---|---|---|---|
| raspberrypi4 (kensakuMain) 更新前 | 142 | **0.8.4** | 25.0.7 rpt3 | 6.12.47 |
| raspi4-robodrill01 / raspi4-fjv60-80 | 142 | 0.9.2 | 25.0.7 rpt3 | 6.12.47 |
| raspi4-kensaku-stonebase01 | 154 | 0.9.2 | 25.0.7 rpt3 | 6.12.47 |
| raspi4-sessaku-01 | 147 | 0.9.2 | 25.0.7 rpt4 | 6.12.75 |
| raspi4-assembly-01 / raspi4-kensaku-02 | 149 | 0.9.7 | 25.0.7 rpt4 | 6.18.34 |

kensakuMain だけ labwc が 0.8.4 と古い。症状は Xwayland のウインドウの表示が古いバッファで止まるもので、labwc（Wayland 合成）側の不具合と合う。ただし、ほかの端末で動画を開いた記録はなく、labwc だけを替えた比較もしていないので、断定はしていない。

## Fix (2026-10-16 19:01〜19:15)

- 配布元には最新版しか無く、ほかの Pi4 と同じ版にはそろえられないため、利用者の承認を得て OS 全体を最新にした: `apt-get full-upgrade`（504 個更新、38 個追加、2 個削除: `pcmanfm`・`libcamera0.5`）を `systemd-run --unit=os-upgrade-20261016` で実行（ログ `/var/log/os-upgrade-20261016.log`、`EXIT=0`）し、再起動した。
- 更新後: Chromium 155.0.8059.39、labwc 0.20.2、Mesa 26.2.2、カーネル 6.18.50、raspi-firmware 1.20260915、wf-panel-pi 1.42、Docker 29.9.1。
- 更新前の控え: 端末の `~/pre-os-upgrade-20261016/`（`packages.txt` に全パッケージの版、`config.tgz` に labwc・autostart・chromium.d・/usr/local/bin・config.txt・cmdline.txt・systemd unit）。古い版は配布元に無いので、パッケージは元に戻せない。

## Checks after the upgrade

- 再起動後、`kiosk-browser`・`kiosk-hotcorner`・`docker` は active、`docker-nfc-agent-1` は Up、`ibus-daemon` は 1 つ、パスワード画面（`gcr-prompter`）なし。起動フラグに `--ozone-platform=x11 --gtk-version=3 --password-store=basic` がある。画面は自主検査を表示。
- 同じ手順で動画を開くと映像が出た。再生して 5 秒で 155 フレーム（落ち 5）、閉じる を押すと画面にも反映された。そのあと自主検査の画面へ戻した。
- 上辺パネル: 通常時に `wf-panel-pi` が動いていないのは robodrill01 と同じ（`kiosk-hotcorner` が必要なときだけ起動する設計）。
- 端末での確認が残っている項目: 左上に触れてパネルが出るか、物理キーボードの日本語入力、NFC の読み取り、動画の再生。

## Notes

- Pi4 の OS パッケージは Ansible では管理していない。端末ごとにイメージを書いた時期で版がばらばらになっている。
- 稼働中のキオスクを調べるときは、既存のブラウザに debugging port でつなぎ、実画面は `grim` で撮る（`XDG_RUNTIME_DIR=/run/user/$(id -u) WAYLAND_DISPLAY=wayland-0`）。CDP のスクリーンショットは、画面が止まっていると実際の表示と違うものを返す。新しいブラウザは起動しない（[KB-413](./KB-413-kiosk-chromium-canary-stonebase01.md)）。
