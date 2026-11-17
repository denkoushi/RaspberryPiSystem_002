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

`kiosk-wifi-self-heal.timer` が起動5分後から毎分 root で確認する。wlan0 が connected のときだけ、wlan0 の既定ゲートウェイと `local_network.raspberrypi5_ip` を ping し、両方の失敗が300秒続けば切断・再接続する。再接続後さらに300秒失敗が続けば再起動する。片方でも応答するか未接続になれば `/run/kiosk-wifi-self-heal/` の一時状態を消す。wlan0 不在・nmcli 不在・起動300秒未満は何もしない。

再起動直前に `/var/lib/kiosk-wifi-self-heal/reboots` へ時刻を保存し、直近1時間1回・24時間3回までに制限する。保存時に24時間より古い履歴を捨て、履歴を保存できなければ再起動しない。正常時は無ログとし、介入と理由だけ `logger -t kiosk-wifi-self-heal` で記録する。

標準デプロイの `deploy-release-standard.yml` → `release_kiosk` → `kiosk` の `wifi-self-heal` タスクで配置する。通常の kiosk ロールにも同じタスクを import する。`kiosk_wifi_self_heal_enabled: false` で timer を停止・無効化できる。Pi5 側の既存実装は変更しない。

## Validation

未実施(実機確認待ち)

## Open Items

実機配備後の自動復旧と再起動上限の確認、Pi 側・中継器側の原因切り分け。
