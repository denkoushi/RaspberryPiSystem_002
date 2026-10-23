# KB-425: 業務ラズパイの OS 安全更新を週1回夜間に入れる

## 何をしたか（2026-10-22）

- 業務ラズパイ全台（Pi5 サーバー、Pi4 キオスク、Pi3 サイネージ）に、週1回の夜間に OS の安全更新だけを入れる仕組みを Ansible で入れた。
- 最初は全台「見るだけ（dry-run）」、`raspi4-assembly-02` の1台だけ「実際に入れる（apply）」で始める。
- 失敗したとき、または更新が溜まったときは、キオスクのフローティングChatに「OS更新」として届く。Slack は使わない。
- npm / PyPI など開発依存の更新は対象外（サプライチェーン攻撃のため別扱い）。

## なぜ unattended-upgrades をやめて自前の選別にしたか

- Raspberry Pi OS は Debian の安全更新を `+rptN` 付きで作り直し、`archive.raspberrypi.com`（a=stable）から配る。例: Debian-Security が `155.0.8059.79-1~deb13u1` を出すと、RPi 版は `1:155.0.8059.79-1~deb13u1+rpt1` になり、こちらが選ばれる。
- unattended-upgrades は配布元（origin）で絞るため、Debian-Security に絞ると `+rpt` 版の chromium や openssl が永遠に入らない。RPi の stable を許すと安全更新でない更新（デスクトップ部品など）まで入る。
- 実機で確かめたところ、Pi5 で動いていた旧 unattended-upgrades（KB-416 で有効化）は `+rpt` 版の安全更新を1つも入れていなかった。そのため旧設定は `APT::Periodic::Unattended-Upgrade "0"` で止め、この仕組みに置き換えた。

### Pi5 の旧設定は反映後どうなるか（二重に動かない理由）

- 2026-10-22 の Pi5 の状態: `/etc/apt/apt.conf.d/` で `APT::Periodic` を書いているのは `20auto-upgrades`（Debian パッケージ、"1"）と `52raspi-unattended-upgrades`（旧 Ansible、"1"）の2つだけ。`apt-daily.timer`、`apt-daily-upgrade.timer`、`unattended-upgrades.service` はどれも有効。
- 反映すると `infrastructure/ansible/tasks/os-security-update.yml` が `52raspi-unattended-upgrades` を `raspi-disable-periodic-upgrades.conf.j2` の中身で上書きする（`Update-Package-Lists`、`Unattended-Upgrade`、`AutocleanInterval` をすべて "0"）。この上書きは、ファイルがあるか、unattended-upgrades パッケージが入っている端末で必ず行い、`os_security_update_enabled: false` でも行う。
- APT は `apt.conf.d` を名前順に読み、後のファイルが勝つ。`52` は `20auto-upgrades` より後なので "0" が勝つ。Pi5 の実際のファイル一式に新しい `52` を差し替えた一時コピーで `apt-config dump` を実行し、3つとも "0" になることを確かめた（同じ手順で、今の `52` のままだと "1" になることも確かめた）。
- `apt-daily*.timer` は止めずに残す。毎日起動はするが、`apt.systemd.daily` が `APT::Periodic` の値を見て、"0" なら一覧の更新も自動更新も行わない。`unattended-upgrades.service` は停止時の後始末用で、設定上は更新を行わない（`InstallOnShutdown` は既定の false）。
- パッケージ `unattended-upgrades` と `20auto-upgrades`、`50unattended-upgrades` は消さない（Debian のファイルを書き換えないため）。
- 反映後に確かめるには: `apt-config dump | grep APT::Periodic` で3つが "0" になっていること。

## 対象と除外

選別は `/usr/local/sbin/raspi-os-security-update`（元: `scripts/os-security-update/raspi-os-security-update.py`）が行う。

- 入れるもの（いずれか）
  - 候補版が Debian-Security（`l=Debian-Security`、`n=trixie-security`）から来るもの。
  - 候補版が Raspberry Pi の配布元から来て、epoch と `+rptN` を除いた版が Debian-Security の版と一致するもの（RPi が作り直した安全更新）。
  - 許可リストに合うもの: `^chromium`、`^rpi-chromium-mods$`（ブラウザは安全修正が頻繁で、RPi 版しか入らないため）。
- 入れないもの（拒否リスト、手動のみ）
  - Docker: `docker-ce`、`docker-ce-cli`、`docker-ce-rootless-extras`、`containerd.io`、`docker-buildx-plugin`、`docker-compose-plugin`（Pi5 の Docker を止めないため）。
  - `tailscale`（遠隔接続が切れると戻せないため）。
  - カーネルとファームウェア: `linux-image*`、`linux-headers*`、`linux-kbuild*`、`raspi-firmware`、`raspberrypi-kernel*`、`raspberrypi-bootloader*`、`rpi-eeprom*`、`firmware-*`、`initramfs-tools*`（自動再起動しないため、入れても効かず、起動不能の危険だけ残る）。
  - Debian-Security に対応する版が無い RPi だけの更新（例: vlc、pipewire の RPi 版）。安全更新ではない通常の更新なので入れない。
- `^chromium` は以前の案では拒否リストにあったが、ブラウザがキオスクの外向き窓口で最も更新が必要なため許可リストへ移した。
- 入れる前に `apt-get -s`（模擬実行）を行い、拒否リストのものが一緒に入る、または何かが削除される場合は入れずに失敗にする。
- 自動再起動はしない。キオスクは chromium の版が変わったときだけ、夜間に `kiosk-browser.service` を再起動する。Pi3 サイネージはブラウザを使わず毎日再起動するので、再起動しない。
- 実行時は `NEEDRESTART_MODE=l`、`NEEDRESTART_SUSPEND=1`（サービスを勝手に再起動しない）、`DPkg::Lock::Timeout=600`、設定ファイルは既存を残す（confdef/confold）。

## 時刻

systemd timer（`raspi-os-security-update.timer`、Persistent=true、FixedRandomDelay=true）。さらに本体が 0〜5時の外では何もしない（`skipped_window`）。

| 機種 | 時刻 | ずらし幅 | 既存の夜間作業との関係 |
|---|---|---|---|
| Pi5 サーバー | 日曜 02:00 | なし | DR 23:00、保存領域の整理 03:00、rkhunter 日曜 04:30 を避ける |
| Pi4 キオスク | 日曜 01:00 | 最大90分 | Pi4 の夜間保守 03:30 より前に終える |
| Pi3 サイネージ | 日曜 01:30 | 最大30分 | 毎日 03:00 の再起動より前に終える |

設定は `infrastructure/ansible/group_vars/all.yml`（既定と Pi5）、`group_vars/kiosk.yml`、`group_vars/signage.yml`。

## 本番反映（update-all-clients.sh）とぶつからない仕組み

- 反映は各端末で書き換えを始める前に `/run/raspi-release/active` を置き、`flock -w 1800 /run/lock/raspi-os-security-update.lock true` で更新中の処理が終わるのを最大30分待つ。待てなければその端末は何も変えずに失敗する。
- 反映の終わりでは、成功でも失敗でも `always` で目印を消す。
- 更新は同じロックを取ってから始め、目印があれば `skipped_release` で何もしない。目印が4時間より古ければ、消し忘れとみなして無視する。
- `/run` は再起動で消えるので、目印が残り続けることはない。

## 段階

1. 今回: 全台 `os_security_update_mode: dry-run`、`raspi4-assembly-02` だけ `apply`（inventory.yml のホスト変数）。dry-run は選別と模擬実行だけ行い、結果を残す。
2. 1〜2週見て問題なければ、`group_vars/all.yml` の `os_security_update_mode` を `apply` に変えて反映する。必要なら kiosk → signage → Pi5 の順にグループ単位で広げる。

一斉に時刻をずらすだけの案より、1台で実際に入れて確かめてから広げる方が、壊れたときの影響を1台に留められるのでこちらを選んだ。

## どこを見るか

- 状態: `/var/lib/raspi-os-security-update/state.json`（`result`、`reason`、`lastSuccessAt`、`selected`、`installed`、`heldBack`、`browserRestarted`）。
- 記録: `/var/log/raspi-os-security-update.log`（1回1行）、`journalctl -u raspi-os-security-update.service`、入れた版は `/var/log/dpkg.log`。
- 通知（フローティングChat、件名「OS更新」）
  - 「OSの安全更新を入れられませんでした。」: 最後の結果が失敗（`os_security_update_failed`）。
  - 「OSの安全更新が2週間以上入っていません。」: 最後の成功（一度も無ければ導入日）から15日を超えた（`os_security_updates_stale`）。夜間に電源が切れている端末や、毎回見送りになる端末もこれで分かる。
  - 次に成功すれば「復旧しました。」で閉じる。status-agent の `clients/status-agent/os_update_health.py` が送る。

## 2026-10-23: 言語設定が EUC-JP の Pi4 で方針が入らなかった

- 起きたこと: 初回反映（run `20261023-113255-5af475`）で、`raspi4-robodrill01` と `raspi4-kensaku-stonebase01` だけ「方針を適用できなかった」の報告タスクが rescued になった。反映は続いたが、2台には timer、本体、設定ファイルのどれも入らなかった（反映後に読み取りで確認）。
- 原因: 2台の `/etc/default/locale` が `ja_JP.EUC-JP`。unattended-upgrades が無いため `dpkg-query` が日本語のエラーを EUC-JP で返し、Ansible が「UTF-8 でない出力」（`surrogates not allowed`）として task を失敗にした。
- 直したこと: 外部コマンドを動かす task（`command`、`apt`、`systemd`）と `raspi-os-security-update.service` に `LC_ALL=C.UTF-8`、`LANG=C.UTF-8`、`LANGUAGE=` を付けた。本体は状態ファイルを明示的に UTF-8 で読み書きする。報告タスクは失敗の理由も出す。
- `clients/status-agent/os_update_health.py` を Pi4 に届けるファイルの一覧（`scripts/ci/classify_changes.py`）に足した。これが無いと、このファイルだけを変えた PR は Pi4 に届かない。
- 再発を確かめるには: 端末で `cat /etc/default/locale` を見る。EUC-JP の端末でも、反映後に `systemctl is-enabled raspi-os-security-update.timer` が `enabled` になっていればよい。

## 戻し方

- 止める: `os_security_update_enabled: false`（全体なら `group_vars/all.yml`、1台ならホスト変数）にして通常の反映を行う。timer が止まる。
- 見るだけに戻す: `os_security_update_mode: dry-run` にして反映する。
- 入った版を戻す: `/var/log/dpkg.log` で元の版を確かめ、`sudo apt-get install <パッケージ>=<元の版>` を実行する。chromium を戻したときは `sudo systemctl restart kiosk-browser.service`。
- 手で今すぐ動かす（確認用）: `sudo /usr/local/sbin/raspi-os-security-update --force`（夜間の時間帯の制限だけを外す。ロックと目印、拒否リスト、模擬実行は効いたまま）。
