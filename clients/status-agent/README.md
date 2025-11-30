## Raspberry Pi Status Agent

サーバー側の `/api/clients/status` に 1 分毎でメトリクスを送信する軽量エージェントです。  
CPU 使用率・メモリ使用率・ディスク使用率・CPU 温度・稼働時間・IP アドレスを収集し、`x-client-key` 認証で API へ送信します。

### 構成ファイル

1. 設定ファイルを複製して編集します。

```bash
sudo cp /opt/RaspberryPiSystem_002/clients/status-agent/status-agent.conf.example /etc/raspi-status-agent.conf
sudo nano /etc/raspi-status-agent.conf
```

必須パラメータ:

| 変数 | 説明 |
| --- | --- |
| `API_BASE_URL` | APIのベースURL (`https://raspi5.local:8080/api` など) |
| `CLIENT_ID` | 端末を一意に識別するID（表示名にも使用） |
| `CLIENT_KEY` | `clientDevice.apiKey` と同じ値 (`x-client-key` ヘッダーに使用) |

任意パラメータ: `LOCATION`（ローカルログに表示）、`LOG_FILE`, `REQUEST_TIMEOUT`, `TLS_SKIP_VERIFY` など。  
詳しくは `status-agent.conf.example` を参照してください。

### 手動実行テスト

```bash
cd /opt/RaspberryPiSystem_002/clients/status-agent
STATUS_AGENT_CONFIG=/etc/raspi-status-agent.conf ./status-agent.py --dry-run
```

`--dry-run` でペイロードを標準出力に表示し、HTTP送信せずに終了します。本番送信を確認したい場合はオプションを外して実行してください。成功するとサーバー側の `clients.status` / `clients.logs` テーブルに記録されます。失敗時は標準出力、または `LOG_FILE` にエラー理由が出力されます。

### systemd Timer の設定

1. ユニットファイルを配置:

```bash
sudo cp /opt/RaspberryPiSystem_002/clients/status-agent/status-agent.service /etc/systemd/system/
sudo cp /opt/RaspberryPiSystem_002/clients/status-agent/status-agent.timer /etc/systemd/system/
```

2. 有効化 & 起動:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now status-agent.timer
```

3. 動作確認:

```bash
systemctl status status-agent.timer
journalctl -u status-agent.service -n 30 -f
```

### メトリクス計測の仕様

| 項目 | 取得方法 |
| --- | --- |
| CPU 使用率 | `/proc/stat` を 0.5 秒間隔で 2 回読み取り、差分から算出 |
| メモリ使用率 | `/proc/meminfo` の `MemTotal` / `MemAvailable` から算出 |
| ディスク使用率 | `/` の `shutil.disk_usage` |
| CPU 温度 | `/sys/class/thermal/thermal_zone0/temp` が存在すれば読み取り |
| アップタイム | `/proc/uptime` |
| Last Boot | `uptimeSeconds` を現在時刻から減算して ISO8601 形式で送信 |

### トラブルシューティング

| 事象 | 対応 |
| --- | --- |
| TLS 証明書エラー | `TLS_SKIP_VERIFY=1` を一時的に設定（社内ネットワークのみ推奨） |
| 接続タイムアウト | `REQUEST_TIMEOUT` を 20 秒程度に延長、または API の疎通を確認 |
| CPU 温度が取得できない | `vcgencmd` コマンドを有効にするか、thermal ゾーンのパスを `TEMPERATURE_FILE` で指定 |
| ログを残したい | `LOG_FILE=/var/log/raspi-status-agent.log` を指定し、`journalctl` と併用 |

### フォルダ構成

```
clients/status-agent/
├── README.md
├── status-agent.py              # メトリクス収集 & 送信スクリプト
├── status-agent.conf.example    # 設定テンプレート
├── status-agent.service         # systemd service (oneshot)
└── status-agent.timer           # 1分毎に起動する systemd timer
```

このフォルダごと `rsync` / `ansible` で配布し、`/etc/raspi-status-agent.conf` を端末ごとに上書きして運用します。***

