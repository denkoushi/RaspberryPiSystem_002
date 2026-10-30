# Pi Zero 棚スキャナー

Pi Zero W / Zero 2 W のUSB HIDスキャナーを排他取得し、伝票を端末に割り当てた棚へ記録します。
Python 3.9以上を使用し、USB HID入力にはDebianの`python3-evdev`が必要です。USB CDCシリアル入力は標準ライブラリのみで動作します。
`/opt/zero-edge/zero-edge-agent`から`python3 -m zero_edge_agent`で起動できます。

設定は`/etc/zero-edge-agent.conf`の`KEY="value"`形式です。
`ZERO_EDGE_AGENT_CONFIG`環境変数で設定ファイルのパスを変更できます。

| キー | 内容 |
| --- | --- |
| `API_BASE_URL` | 必須。`https://server.example`等のorigin（`/api`なし） |
| `X_CLIENT_KEY` | 必須。端末専用キー |
| `TLS_SKIP_VERIFY` | `0`（既定）は証明書検証、`1`は検証省略 |
| `HID_DEVICE` | `/dev/input/event*`またはby-idパス。空ならキーボード能力で自動選択・再接続 |
| `QUEUE_PATH` | 既定`/var/lib/zero-edge-agent/queue.db` |
| `INPUT_MODE` | `evdev`（既定）またはUSB CDC入力の`serial` |
| `SERIAL_DEVICE` | シリアル入力のttyパス。既定`/dev/ttyACM0` |
| `READER_INIT_COMMANDS` | 接続時に送るASCIIコマンドを`;`で区切る。前後の空白・空項目は除外。既定は空（送信なし） |

端末の配置ファイルは、上記設定、`/opt/zero-edge/zero-edge-agent/zero_edge_agent/*.py`、
`/etc/systemd/system/zero-edge-agent.service`、SQLite DBとその`-wal`/`-shm`ファイルです。
heartbeatは`/opt/zero-edge/status-agent/*.py`、`/etc/raspi-status-agent.conf`、
`status-agent.service`/`status-agent.timer`を使用します。
配備・運用規則は[Runbook](../../docs/runbooks/zero-edge-agent.md)を参照してください。

端末は専用の`infrastructure/ansible/inventory-zero-edge.yml`へ追加します。
共通変数を読み込むため、`infrastructure/ansible`から両inventoryを指定します
（`<n>`は端末番号に置き換えます）。

```sh
ansible-playbook -i inventory.yml -i inventory-zero-edge.yml playbooks/zero-edge.yml --limit "zero-edge-<n>"
```

テスト（evdev不要）:

```sh
PYTHONPATH=clients/zero-edge-agent python3 -m pytest clients/zero-edge-agent/tests -q
```
