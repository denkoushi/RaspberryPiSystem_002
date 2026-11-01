# KB-432: FJV の Wi-Fi 切断が戻らない件と、カーネル・Wi-Fi ファームウェアの版合わせ

- Status: 実機対応済み（FJV のみ手動）。経過観察中
- Scope: `raspi4-fjv60-80`（FJV）。リポジトリの変更なし
- Date: 2026-10-30

## Symptoms

- デプロイの後などに FJV だけがネットワークから外れ、電源を入れ直すまで戻らないことが繰り返し起きていた。
- 2026-10-23 16:50 ごろから FJV がオフラインになった。休日をはさみ、10/27 に人が電源を入れ直すまで戻らなかった。
- この間、NetworkManager は再接続を試みていなかった。tailscaled は `network is unreachable` を出し続けた。

## Investigation

- 10/23 当日のログは確認できなかった。永続化した journal（上限 200M、[KB-425](./KB-425-pi4-robodrill01-network-stall-persistent-journal.md)）が、オフライン中の tailscaled の出力（約60万行）で押し流され、10/25 17:50 より前が消えていた。UFW のログが原因ではない。
- 10/23 15:09 の Archer のファームウェア更新は 15:15 に復帰しており、16:52 の切断とは別件。
- 他の Pi4 と版を比べると、FJV だけが約1年前のまま残っていた。

| パッケージ | FJV（対応前） | kensaku-02 / assembly-01 |
|---|---|---|
| カーネル | 6.12.47 | 6.18.34 |
| firmware-brcm80211（Wi-Fi） | 20241210 | 20250410+rpt1 |
| raspi-firmware（起動） | 1.20250915 | 1.20260521 |

- FJV には更新待ちが489件あった。週1回の OS 安全更新（[KB-425 OS 安全更新](./KB-425-os-security-weekly-update.md)）は、設計どおり `linux-image*`、`raspi-firmware`、`firmware-*` を除外する。このため、カーネルとファームウェアは手動で上げない限り古いまま残る。
- 原因は、古い Wi-Fi ドライバーとファームウェアが固まり、その後に再接続できなくなったことと見ている。10/23 のログが無いため確定はしていない。

## Fix

- 他の端末が使っている Wi-Fi・起動ファームウェアの版は、もう配布されていなかった。カーネルは同じ版に、ファームウェアは配布中の最新版にそろえた。
  - `linux-image-6.18.34+rpt-rpi-v8` と `-rpi-2712`
  - `firmware-brcm80211 1:20260519-1~bpo13+1+rpt1`
  - `raspi-firmware 1:1.20260915-1`
- 入れ方: `systemd-run` で `apt-get install`（`--no-install-recommends`、`--force-confold`、`NEEDRESTART_MODE=l`、`LC_ALL=C.UTF-8`）を実行し、対象の4パッケージだけを入れた。initramfs が作り直されたこと、`/boot/firmware/kernel8.img` が `/boot/vmlinuz-6.18.34+rpt-rpi-v8` と一致すること（`cmp`）を確かめた。
- 再起動は使っていない時間帯にした。`systemd-run --on-calendar="2026-10-27 22:00:00"` で予約した。
- 旧カーネル 6.12.47 のパッケージは残してある。戻すときは、`/boot/vmlinuz-6.12.47+rpt-rpi-v8` を `/boot/firmware/kernel8.img` に、対応する initramfs を `/boot/firmware/initramfs8` に置いて再起動する。

## Validation

- 2026-10-27 22:12: `uname -r` が `6.18.34+rpt-rpi-v8`。wlan0 は接続中、`kiosk-browser.service` は active で、ClientLog に新しい記録が届いた。起動直後の status-agent の1回の失敗は Wi-Fi 接続前のもので、その後は毎分成功した。
- 2026-10-30 02:19: ルーターの再起動（[KB-430](./KB-430-pi5-wifi-no-secrets-reconnect.md)）で Wi-Fi が切れたが、FJV は 02:21 に自分でつながり直した（DHCP で新しいリース）。電源の入れ直しは不要だった。
- 10/27 から10/30 まで3日間、FJV は止まっていない。02:20 から 07:40 まで記録が無いのは、どの Pi4 も夜間は記録を送らないためで、異常ではない。

## Open Items

- 他の Pi4 も、カーネルとファームウェアは週1回の更新では上がらない。版の差は定期的に確かめる必要がある。
- オフライン中の tailscaled の出力が journal を押し流す問題は残っている。全 Pi4 に流量の上限をかける案は未承認・未着手。
