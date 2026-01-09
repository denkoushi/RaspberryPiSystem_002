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
| `API_BASE_URL` | 例: `https://100.106.158.2/api`（Caddy経由のHTTPS。ポート8080は外部公開されていない） |
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
| `INVALIDARGUMENT` エラー | `API_BASE_URL` が正しく設定されているか確認（`http://localhost:8080/api`は使用不可。`https://<Pi5のIP>/api`を使用） |
| サーバー側（Pi5）でstatus-agentが動作しない | Pi5のホストからはDocker内部ネットワークの`localhost:8080`にアクセスできないため、Caddy経由（HTTPS 443）でAPIにアクセスする必要がある（[KB-129](../knowledge-base/infrastructure/ansible-deployment.md#kb-129-pi5サーバー側のstatus-agent設定ファイルが古い設定のまま)参照） |

---

## 7. macOS 向けセットアップ

macOS では Linux 専用の `/proc` ファイルシステムが存在しないため、専用の `status-agent-macos.py` を使用します。

### 7.1 設定ファイルの作成

```bash
cat > ~/.status-agent.conf << 'EOF'
# macOS status-agent configuration
API_BASE_URL=https://100.106.158.2/api
CLIENT_ID=mac-kiosk-1
CLIENT_KEY=<サーバーに登録済みのクライアントキー>
TLS_SKIP_VERIFY=1
LOCATION=開発環境
REQUEST_TIMEOUT=10
EOF
```

**注意**: `CLIENT_ID` と `CLIENT_KEY` はデータベースの `ClientDevice` テーブルに登録されている値と一致させてください。

### 7.2 手動テスト

```bash
cd /path/to/RaspberryPiSystem_002/clients/status-agent
STATUS_AGENT_CONFIG=~/.status-agent.conf python3 status-agent-macos.py --dry-run
```

`--dry-run` を外すと実際に API へ送信します。

### 7.3 launchd への登録（1分間隔で自動実行）

```bash
cat > ~/Library/LaunchAgents/com.raspberrypisystem.status-agent.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.raspberrypisystem.status-agent</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/python3</string>
        <string>/path/to/RaspberryPiSystem_002/clients/status-agent/status-agent-macos.py</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>STATUS_AGENT_CONFIG</key>
        <string>/Users/<username>/.status-agent.conf</string>
    </dict>
    <key>StartInterval</key>
    <integer>60</integer>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/status-agent.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/status-agent.err</string>
</dict>
</plist>
EOF
```

**注意**: パスを実際の環境に合わせて変更してください。

### 7.4 launchd エージェントの起動

```bash
launchctl load ~/Library/LaunchAgents/com.raspberrypisystem.status-agent.plist
launchctl list | grep status-agent
```

### 7.5 launchd エージェントの停止・削除

```bash
launchctl unload ~/Library/LaunchAgents/com.raspberrypisystem.status-agent.plist
rm ~/Library/LaunchAgents/com.raspberrypisystem.status-agent.plist
```

---

## 8. 参考

- 詳細なファイル構成・コメント付き手順: `clients/status-agent/README.md`
- API 側の受け皿: `apps/api/src/routes/clients.ts`
- 管理画面の実装タスク: `docs/plans/production-deployment-phase2-execplan.md`

