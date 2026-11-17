# KB-454: Pi4 Wi-Fi 接続中の個別宛て通信停止と自動復旧

- Status: ローカル実装済み・実機確認待ち
- Scope: Raspberry Pi 4 キオスク端末（Ansible `kiosk` グループ）
- Date: 2026-11-17

## Symptoms

`raspi4-assembly-01` が約2日間通信不能になった。NetworkManager は wlan0 を connected と表示し、IP も保持していたが、ゲートウェイ（192.168.10.1）と Pi5（192.168.10.230）への個別宛て通信が止まり、再起動で回復した。

## Investigation

2026-11-15 04:05 の中継器の週次再起動で 5GHz に戻れず 2.4GHz へ移った。同日 12:23 の週次 SD バックアップ開始直後から個別宛て通信が止まったが、ブロードキャストの DHCP は通っていた。11/17 の再現試験では再現せず、原因が Pi 側か中継器側かは未確定。

[KB-430](./KB-430-pi5-wifi-no-secrets-reconnect.md) の Pi5 監視は未接続時のみ再接続するため、この症状を拾えない。[KB-432](./KB-432-fjv-wifi-stall-kernel-firmware-align.md) も参照。

## Fix

`kiosk-wifi-self-heal.timer` が起動5分後から毎分 root で確認する。Pi5 LAN 宛て経路が wlan0 の端末だけで、connected 時にゲートウェイと Pi5 を ping する。両方の失敗が uptime 基準で300秒続けば、その時点の接続名を使い `nmcli --wait 45 connection up id`（名前がなければ `device connect`）で再接続する。失敗時は `autoconnect yes` に戻す。再接続後は未接続・接続処理中でも段階を保持し、さらに300秒失敗が続けば再起動する。片方の応答、wlan0 以外の業務経路、介入前の未接続で一時状態を消し、空・不正な状態は作り直す。

再起動履歴は壁時計で `/var/lib/kiosk-wifi-self-heal/reboots` に保存し、直近1時間1回・24時間3回までとする。未来と24時間超の履歴は捨て、保存失敗時は再起動しない。直前に `/run/raspi-release/active` と `/run/lock/raspi-os-security-update.lock` の非待機ロックを確認し、デプロイ・OS 更新中は次回へ見送る。上限・見送りログは同じ抑止状態につき1回とする。service の開始上限は150秒。

標準デプロイと通常の kiosk ロールで配置し、unit 変更時は有効な timer を restart する。既定は `kiosk_wifi_self_heal_enabled: true` で全 Pi4 キオスクに有効。2026-11-17 に `raspi4-kensaku-stonebase01` と `raspi4-assembly-01` で先行導入（timer active、毎分正常終了、正常時ログなし）を確かめてから全台へ広げた。端末単位で止めるときは inventory で false を設定する。Pi5 側の既存実装は変更しない。

## Validation

- 2026-11-17 先行導入(main 6088d681、Pi4 run 20261117-024603-17e478): kensaku-stonebase01 と assembly-01 で timer active、service Result=success、正常時の journal は空。他の Pi4 は timer inactive。
- 実際の通信停止からの復旧は未発生のため未確認。

## Open Items

実機配備後の自動復旧と再起動上限の確認、Pi 側・中継器側の原因切り分け。
