# KB-425: robodrill01 の通信停止と Pi4 の journal 永続化

- Status: active
- Date: 2026-10-22
- Scope: Pi4 キオスク全台（inventory の `kiosk` グループ）。Pi5、Pi3 は対象外。ローカル実装、未反映

## 起きたこと（2026-10-22）

- 14:37 頃から 15:22 頃（強制電源オフ）まで、`raspi4-robodrill01` が Pi5 へ一切つながらず、キオスク画面が固まったように見えた。
- 端末そのものは動いていた。status-agent は毎分動作し、ブラウザは API を叩き続けてタイムアウトしていた。
- Wi-Fi は同じ中継機 `TP-Link_D2EC_EXT`（2.4GHz）につながったままで、電波も -48dBm と良好だった。
- 14:42 以降は Tailscale の中継サーバーからも見えなくなった。端末側の通信だけが止まったと判断した。
- 同じ中継機につながる `raspberrypi4` と `raspi4-assembly-01` は無事だった。

## 原因を確かめられなかった理由

前回起動中のカーネルログが残っていなかった。Raspberry Pi OS（Debian 13 trixie, systemd 257）は
`/usr/lib/systemd/journald.conf.d/40-rpi-volatile-storage.conf` で `Storage=volatile` を指定している。
`/var/log/journal` は存在する（`root:systemd-journal`、setgid と ACL 付き）が使われず、
journal は `/run` にだけ書かれて再起動で消える。rsyslog も入っていない。
このため Wi-Fi ドライバ（brcmfmac）が固まったのかどうかを確認できなかった。

## 対策

`roles/release_kiosk/tasks/host-journald.yml` で `/etc/systemd/journald.conf.d/50-raspi-persistent.conf` を配る。
Pi5 の `roles/release_pi5/tasks/host-journald.yml` と同じ方式。

- `Storage=persistent`。`/etc` の 50- は 40- のベンダー設定より後に読まれ、上書きする。
- SD カード保護: `SystemMaxUse=200M`、`SystemKeepFree=1G`。
- `SyncIntervalSec=5m`（既定値のまま明示）。長くすると強制電源オフ直前の数分が残らず、今回のような調査に使えない。
- 変更時だけ journald を再起動し、`systemd-tmpfiles --create --prefix /var/log/journal` と `journalctl --flush` で、反映した起動分から残す。
- リリース本体の後に動き、失敗しても報告だけでキオスクのロールバックはしない。

## 反映後の確認

```bash
journalctl --list-boots
systemd-analyze cat-config systemd/journald.conf | grep -v '^#' | grep .
journalctl --disk-usage
```

反映直後は今の起動分が1行だけ出る。次の再起動の後に前回の起動分（-1）が出れば効いている。
次に通信が止まったら、復旧後に `journalctl -b -1 -k` と `journalctl -b -1 -u NetworkManager -u wpa_supplicant` で止まった時刻の前後を見る。
