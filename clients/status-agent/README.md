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

Pi4 SDカード予防保全用パラメータ:

| 変数 | 既定値 | 説明 |
| --- | --- | --- |
| `STORAGE_HEALTH_ENABLED` | `0` | `1` の時だけSDヘルス監視ログを `payload.logs` に追加 |
| `STORAGE_HEALTH_INTERVAL_SECONDS` | `3600` | SDヘルス監視の実行間隔。status heartbeatは毎分のまま、SDヘルスだけ既定1時間ごと |
| `STORAGE_HEALTH_DISK_WARN_PCT` | `80` | `/` のディスク使用率またはinode使用率がこの値以上なら `WARN` |
| `STORAGE_HEALTH_DISK_ERROR_PCT` | `90` | `/` のディスク使用率またはinode使用率がこの値以上なら `ERROR` |
| `STORAGE_HEALTH_STATE_FILE` | `/run/raspi-status-agent/storage-health-last-run` | 最終実行時刻の記録先。`/run` はtmpfsなのでSDカードへ書き込まない |
| `STATUS_AGENT_LOG_SUCCESS` | `0` | 成功時のローカルログ追記。SDカード書込削減のため既定は無効 |

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
| SDヘルスログ | 有効時のみ既定1時間ごとに `/proc/mounts`, `/`, kernel log, `vcgencmd get_throttled` を確認 |

### SDカード予防保全ログ

`STORAGE_HEALTH_ENABLED=1` の時、次の兆候を既存APIの `ClientLog` に送ります。DB schemaやAPI schemaは変更しません。通常実行では `STORAGE_HEALTH_INTERVAL_SECONDS` ごとに確認し、`--dry-run` では現場確認のため毎回確認します。

| 兆候 | レベル |
| --- | --- |
| root filesystem が read-only (`ro`) | `ERROR` |
| kernel log の `mmc` error / `I/O error` / `EXT4-fs error` / read-only remount | `ERROR` |
| `/` のディスク使用率またはinode使用率が閾値以上 | `WARN` / `ERROR` |
| `vcgencmd get_throttled` の現在低電圧 | `ERROR` |
| `vcgencmd get_throttled` の現在throttle/温度制限 | `WARN` |

kernel logは、既定では実行間隔+5分ぶんを見ます。1時間ごとの運用でも短時間のI/O errorを見逃しにくくするためです。送信ログの `context` は `{ category: "storage_health", signal, rootSource, raw, observedAt }` 形式です。1回のPOSTで追加するSDヘルスログは最大10件です。

`WARN` / `ERROR` のSDヘルスログは、API側でDB `Alert` と `AlertDelivery(SLACK)` に昇格されます。Slack配送先は既存Alerts Dispatcherの `storage-*` ルートに従い、通常は `ops` です。同じ端末・同じsignalの未確認Alertが残っている間は追加Alertを作らず、通知連打を抑えます。

運用確認:

```bash
STATUS_AGENT_CONFIG=/etc/raspi-status-agent.conf /opt/RaspberryPiSystem_002/clients/status-agent/status-agent.py --dry-run
journalctl -u status-agent.service -n 50
vcgencmd get_throttled
findmnt -no OPTIONS /
```

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
├── storage_health.py            # SDカード予防保全ログの判定
├── status-agent.py              # メトリクス収集 & 送信スクリプト
├── status-agent.conf.example    # 設定テンプレート
├── status-agent.service         # systemd service (oneshot)
├── status-agent.timer           # 1分毎に起動する systemd timer
└── tests/                       # macOSでも実行できるユニットテスト
```

このフォルダごと `rsync` / `ansible` で配布し、`/etc/raspi-status-agent.conf` を端末ごとに上書きして運用します。***
