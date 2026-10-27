# Pi Zero 棚スキャナー運用

## 端末を追加する

Pi Zero W / Zero 2 WにPython 3.9以上のRaspberry Pi OS、SSH、ネットワークを準備します。
サーバー側のedge-scans APIが利用できることを確認し、端末キーに棚を割り当て、edge利用を有効化します。
heartbeatのclientIdも同じ端末の`ClientStatus`として登録されるようサーバー側の端末設定を揃えます。

`infrastructure/ansible/inventory-zero-edge.yml`の`all.children.zero_edge.hosts: {}`を次の形に置き換え、端末を追加します。
標準fleet用inventoryとは分離し、`clients`配下には入れません。

```yaml
hosts:
  zero-edge-1:
    ansible_host: 192.0.2.10
    ansible_user: pi
    status_agent_client_id: zero-edge-1
    zero_edge_client_key: "{{ vault_zero_edge_client_key }}"
```

端末専用Vault（`host_vars/zero-edge-1/vault.yml`）に`vault_zero_edge_client_key`を暗号化保存します。
このキーはスキャンとstatus-agentの両方で使用します。平文キーをinventoryやgitへ置かないでください。
URLは共通の`api_base_url`から取得し、スキャン側だけ末尾`/api`を除去します。
inventoryのTLS省略は既存clientsに合わせて`1`です。CAを信頼させた環境では`zero_edge_tls_skip_verify: "0"`にします。

`<n>`は追加した端末番号に置き換えます。両inventoryを読み込み、共通の`group_vars/all.yml`にある
`server_ip` → `server_base_url` → `api_base_url`を解決します。

対象SHAのCI成功と本番実行の承認を確認してから、コントローラーの`infrastructure/ansible`で実行します。

```sh
ansible-playbook -i inventory.yml -i inventory-zero-edge.yml playbooks/zero-edge.yml --limit "zero-edge-<n>"
```

このplaybookはPythonファイル・設定・unitのみをコピーし、リポジトリをcloneしません。
evdevとNTPを準備し、スキャナーserviceと毎分のheartbeat timerを有効化します。
既存のchrony/ntp/ntpsecがあればそれを使用し、なければtimesyncdを導入します。
status-agentのkiosk周辺機器監視とストレージ監視は無効です。
起動時importに必要な`terminal_device_maintenance.py`もstatus-agentと同じ場所に配布します。

## 確認と復旧

```sh
systemctl status zero-edge-agent.service status-agent.timer
journalctl -u zero-edge-agent.service -n 100 --no-pager
journalctl -u status-agent.service -n 50 --no-pager
timedatectl show -p NTPSynchronized --value
```

時刻同期が`yes`（または`/run/systemd/timesync/synchronized`が存在）になってからスキャンします。
timedatectlの判定は同期済みなら60秒、未同期・失敗なら5秒キャッシュします。
USB抜き差し時は自動復帰します。複数キーボードがある場合は`zero_edge_hid_device`にby-idパスを指定します。
HIDはUS配列のShift付き文字を読み取るため、スキャナーもUS配列・Enter終端に設定します。
401/403はキーとサーバー設定を確認し、設定変更後はplaybookを再実行するかserviceを再起動します。
設定は起動時に読み込まれます。DBは再配備・再起動でも保持し、未送信記録を再送します。
アプリ更新を戻す場合も既知の正常なファイルを再配備し、DBは残します。

## 動作規則

- `DIST:1`〜`DIST:5`（大文字小文字不問、コロン後の空白可）は次の伝票1枚だけに適用し、単調時計で60秒後に失効します。連続DISTは後勝ち、未指定・失効後は`branchNo: 0`です。範囲外整数DISTはログを残して無視します。それ以外の空でない入力は前後をtrimして伝票番号にします。
- NTP未同期の入力は保存せず、保留DISTも消去します。同期後に再スキャンしてください。Enter読取時刻（ローカル時刻・offset付き）とUUID4をSQLite WALへ保存します。
- 古い記録から1件ずつ送信し、7日を超えた記録は送信せず削除します。起動直後の誤った時計による削除を避けるため、送信・期限削除も同期を待ちます。
- 200と400/422は記録を削除し、400/422はエラーログを残します。422の人への通知はサーバーが担当します。ネットワーク・timeout・5xx・401/403は保持し、1秒から最大300秒の指数バックオフで同じUUID・時刻を再送します。その他の未定義HTTP応答も保持します。成功または恒久エラー処理後は待機をリセットします。
- ログはjournaldへ出力し、クライアントキーやサーバー応答本文は出力しません。SIGTERMで受付・送信を停止しDBを閉じます。

`zero-edge-*`はサーバーのdead-device監視対象です。Zeroの更新は本playbookで行います。
