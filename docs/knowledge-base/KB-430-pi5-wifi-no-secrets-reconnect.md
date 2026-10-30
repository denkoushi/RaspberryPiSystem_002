# KB-430: Pi5 Wi-Fi no-secrets による切断継続と自動再接続

- Status: ローカル実装済み・本番未反映
- Scope: Pi5 server ロール（`server_release_mode == 'full'`）
- Date: 2026-10-30

## Context / Root Cause

ユーザー報告によると、2026-10-30 02:19 の Wi-Fi ルーター再起動後、Pi5 の NetworkManager + wpa_supplicant が復帰前の再接続に数回失敗し、`no-secrets` で自動接続を停止した。
接続プロファイル `IODATA-7b204c-2G` の PSK は保存済み（`psk-flags=0`）だったが、secrets の再供給まで autoconnect がブロックされ、`autoconnect-retries` に関係なく再接続しなかった。
07:36 に人が電源を入れ直すまで約5時間オフラインとなり、Gmail CSV 取り込み3件（`生産日程_三島_研削工程`、`FKOJUNST_Status`、`FKOBAINO`）を取りこぼした。取り込みは手動実行で回復した。

## Fix / Prevention

`pi5-wifi-reconnect.timer` を起動3分後から2分ごとに実行し、NetworkManager 全体が connected 系でなく、かつ wlan0 が未接続のときだけ `nmcli --wait 45 device connect wlan0` を1回実行する。
試行時だけ英語で状態・結果を journal に記録し、失敗も終了コード0として次回の監視を継続する。起動後180秒未満、wlan0 不在、nmcli 不在では何もしない。
既存の Wi-Fi プロファイル（`Buffalo-G-2848` を含む）や有線 `有線接続 1` の設定は変更しない。有線を含む接続済み状態では介入しない。Pi4 / client ロールと `release_kiosk` は対象外。

## Validation / Open Items

- ローカル検証: `python3 -m pytest scripts/ci/tests/test_pi5_wifi_reconnect.py scripts/ci/tests/test_pi5_power_dispatcher.py -q` は19件成功（2.85秒）。`bash -n infrastructure/ansible/templates/pi5-wifi-reconnect.sh.j2` も成功。
- テストでは偽の nmcli / logger、`UPTIME_FILE` と `NET_CLASS_DIR` により接続状態・起動直後・インターフェース不在を再現する。既定値は `/proc/uptime` と `/sys/class/net`。
- 本番配備・ルーター再起動後の自動復帰は未検証。配備後は `journalctl -t pi5-wifi-reconnect` と timer の状態で確認する。

## References

- [再接続スクリプト](../../infrastructure/ansible/templates/pi5-wifi-reconnect.sh.j2)
- [Ansible タスク](../../infrastructure/ansible/roles/server/tasks/wifi-reconnect.yml)
- [契約・動作テスト](../../scripts/ci/tests/test_pi5_wifi_reconnect.py)
