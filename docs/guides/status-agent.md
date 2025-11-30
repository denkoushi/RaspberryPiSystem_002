# 🛰️ status-agent セットアップガイド

Raspberry Pi クライアントが 1 分間隔で `/api/clients/status` にメトリクスを送信するための常駐エージェントです。  
CPU / メモリ / ディスク / 温度 / 稼働時間を計測し、`x-client-key` で Fastify API に報告します。

---

## 1. 前提条件

| 項目 | 内容 |
| --- | --- |
| OS | Raspberry Pi OS (Debian 系。Python3 がプリインストール) |
| 依存ツール | 追加パッケージ不要（標準ライブラリのみ） |
| 配置先 | `/opt/RaspberryPiSystem_002/clients/status-agent` |
| 設定ファイル | `/etc/raspi-status-agent.conf` |
| 認証 | `clientDevice.apiKey` と同じ `x-client-key` |

---

## 2. 設定ファイルの作成

```bash
sudo cp /opt/RaspberryPiSystem_002/clients/status-agent/status-agent.conf.example /etc/raspi-status-agent.conf
sudo nano /etc/raspi-status-agent.conf
```

必須項目:

| 変数 | 意味 |
| --- | --- |
| `API_BASE_URL` | 例: `https://raspi5.local:8080/api` |
| `CLIENT_ID` | クライアントを一意に特定するID |
| `CLIENT_KEY` | サーバーに登録済みのクライアントキー |

任意設定: `LOG_FILE`, `REQUEST_TIMEOUT`, `TLS_SKIP_VERIFY`, `TEMPERATURE_FILE`, `LOCATION` など。

---

## 3. 手動テスト

```bash
cd /opt/RaspberryPiSystem_002/clients/status-agent
STATUS_AGENT_CONFIG=/etc/raspi-status-agent.conf ./status-agent.py --dry-run
```

`--dry-run` を外すと実際に API へ送信します。`LOG_FILE` を指定すると `/var/log/raspi-status-agent.log` に実行ログが追記されます。

---

## 4. systemd への登録

```bash
sudo cp clients/status-agent/status-agent.service /etc/systemd/system/
sudo cp clients/status-agent/status-agent.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now status-agent.timer
```

動作確認:

```bash
systemctl status status-agent.timer
journalctl -u status-agent.service -n 20
```

`status-agent.timer` は起動 90 秒後から 60 秒間隔で `status-agent.service` を実行します。

---

## 5. 送信されるメトリクス

| フィールド | 説明 |
| --- | --- |
| `clientId` | 設定ファイルの `CLIENT_ID` |
| `hostname` / `ipAddress` | `hostname` コマンド / ソケットで取得 |
| `cpuUsage` | `/proc/stat` を 0.5 秒間隔でサンプリング |
| `memoryUsage` | `/proc/meminfo` (`MemAvailable`) |
| `diskUsage` | `shutil.disk_usage('/')` |
| `temperature` | thermal ゾーン (`/sys/class/thermal/thermal_zone0/temp`) が存在すれば添付 |
| `uptimeSeconds` / `lastBoot` | `/proc/uptime` から算出 |
| `logs` | デフォルトは空配列（今後、閾値超過時にメッセージを挿入予定） |

---

## 6. トラブルシューティング

| 症状 | 対策 |
| --- | --- |
| `CLIENT_KEY_REQUIRED` | 設定ファイルの `CLIENT_KEY` がサーバーに登録されているか確認 |
| TLS 証明書エラー | 一時的に `TLS_SKIP_VERIFY=1` を設定（社内ネットワーク限定） |
| CPU 温度が `null` | `TEMPERATURE_FILE` で thermal パスを明示 |
| systemd が失敗する | `journalctl -u status-agent.service -xe` で詳細を確認 |

---

## 7. 参考

- 詳細なファイル構成・コメント付き手順: `clients/status-agent/README.md`
- API 側の受け皿: `apps/api/src/routes/clients.ts`
- 管理画面の実装タスク: `docs/plans/production-deployment-phase2-execplan.md`

