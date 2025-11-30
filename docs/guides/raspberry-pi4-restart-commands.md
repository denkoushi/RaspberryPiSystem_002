# Raspberry Pi 4 再起動時のサービス起動コマンド

開発中に自動起動を無効化している場合、再起動後に以下のコマンドでサービスを手動起動してください。

## 前提条件

- Raspberry Pi 4にSSH接続または直接ログインしていること
- プロジェクトディレクトリ: `/opt/RaspberryPiSystem_002`

## 起動手順

### 1. pcscd サービスの起動（NFCリーダー用）

```bash
sudo systemctl start pcscd
sudo systemctl status pcscd  # 状態確認
```

**注意**: `pcscd`は通常自動起動が有効になっていますが、念のため確認してください。

### 2. NFCエージェントの起動

#### 方法A: Docker Composeで起動（推奨）

```bash
cd /opt/RaspberryPiSystem_002
docker compose -f infrastructure/docker/docker-compose.client.yml up -d
```

**確認コマンド**:
```bash
docker compose -f infrastructure/docker/docker-compose.client.yml ps
docker compose -f infrastructure/docker/docker-compose.client.yml logs -f
```

#### 方法B: Poetryで直接起動（開発用・非推奨）

```bash
cd /opt/RaspberryPiSystem_002/clients/nfc-agent
poetry run python -m nfc_agent
```

**⚠️ この方法の問題点**:
- **フォアグラウンド実行**: SSHセッションが切れるとプロセスが停止します
- **再起動時に自動起動しない**: 毎回手動で起動する必要があります
- **ログ管理が難しい**: 標準出力に直接出力され、ログファイルに保存されません
- **プロセス管理が難しい**: 停止するには `Ctrl+C` が必要で、バックグラウンドに移行するには工夫が必要です

**改善案**:

1. **Docker Composeを使う（推奨）**: `restart: unless-stopped` で自動起動し、ログ管理も簡単です
2. **systemdサービスとして登録する**: 本番環境向けの安定した方法です（下記参照）
3. **screen/tmuxでバックグラウンド実行する**: 開発中の一時的な回避策として使用可能です

**screenを使ったバックグラウンド実行例**:
```bash
# screenセッションを作成して起動
screen -S nfc-agent
cd /opt/RaspberryPiSystem_002/clients/nfc-agent
poetry run python -m nfc_agent
# Ctrl+A, D でデタッチ（バックグラウンドに移行）

# セッションに再接続
screen -r nfc-agent

# セッションを終了
screen -S nfc-agent -X quit
```

### 3. キオスクブラウザの起動（必要な場合）

開発中に無効化している場合は、以下のコマンドで起動できます：

```bash
sudo systemctl start kiosk-browser.service
sudo systemctl status kiosk-browser.service  # 状態確認
```

**自動起動を有効化する場合**（本番環境）:
```bash
sudo systemctl enable kiosk-browser.service
```

## 一括起動スクリプト（オプション）

以下のスクリプトを `/usr/local/bin/start-services.sh` として保存し、実行権限を付与することで、再起動後に一括で起動できます：

```bash
#!/usr/bin/env bash
set -euo pipefail

echo "Starting pcscd..."
sudo systemctl start pcscd

echo "Starting NFC Agent (Docker)..."
cd /opt/RaspberryPiSystem_002
docker compose -f infrastructure/docker/docker-compose.client.yml up -d

echo "Services started. Checking status..."
docker compose -f infrastructure/docker/docker-compose.client.yml ps
sudo systemctl status pcscd --no-pager
```

**実行権限の付与**:
```bash
sudo chmod +x /usr/local/bin/start-services.sh
```

**実行**:
```bash
/usr/local/bin/start-services.sh
```

## サービス状態の確認

### 全サービスの状態確認

```bash
# pcscd
sudo systemctl status pcscd

# NFC Agent (Docker)
docker compose -f infrastructure/docker/docker-compose.client.yml ps

# キオスクブラウザ（有効化している場合）
sudo systemctl status kiosk-browser.service
```

### ログの確認

```bash
# NFC Agent ログ
docker compose -f infrastructure/docker/docker-compose.client.yml logs -f

# キオスクブラウザ ログ
journalctl -u kiosk-browser -f
```

## トラブルシューティング

### NFCエージェントが起動しない場合

1. **USBリーダーが接続されているか確認**:
   ```bash
   lsusb | grep -i nfc
   ```

2. **pcscdが正常に動作しているか確認**:
   ```bash
   sudo systemctl status pcscd
   pcsc_scan  # リーダーが認識されるか確認
   ```

3. **Dockerコンテナのログを確認**:
   ```bash
   docker compose -f infrastructure/docker/docker-compose.client.yml logs
   ```

### キオスクブラウザが起動しない場合

1. **ディスプレイが接続されているか確認**:
   ```bash
   echo $DISPLAY  # :0 が表示されることを確認
   ```

2. **Xサーバーが起動しているか確認**:
   ```bash
   ps aux | grep Xorg
   ```

3. **サービスログを確認**:
   ```bash
   journalctl -u kiosk-browser -n 50
   ```

## Poetry起動をsystemdサービス化する（推奨）

Poetryで直接起動する方法を継続したい場合、systemdサービスとして登録することで、自動起動とログ管理の問題を解決できます：

```bash
# サービスファイルを作成
sudo nano /etc/systemd/system/nfc-agent.service
```

以下の内容を記述：

```ini
[Unit]
Description=NFC Agent (Poetry)
After=network-online.target pcscd.service
Wants=network-online.target

[Service]
Type=simple
User=pi
WorkingDirectory=/opt/RaspberryPiSystem_002/clients/nfc-agent
Environment="PATH=/home/pi/.local/share/pypoetry/venv/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
ExecStart=/usr/local/bin/poetry run python -m nfc_agent
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

**サービスを有効化**:
```bash
sudo systemctl daemon-reload
sudo systemctl enable nfc-agent.service
sudo systemctl start nfc-agent.service
sudo systemctl status nfc-agent.service
```

**ログ確認**:
```bash
journalctl -u nfc-agent -f
```

**注意**: `poetry` のパスは環境によって異なる場合があります。`which poetry` で確認してください。

## 注意事項

- **開発中は自動起動を無効化**しているため、再起動のたびに手動で起動する必要があります
- **本番環境では自動起動を有効化**してください（`systemctl enable`）
- NFCエージェントは**Docker Compose**または**Poetry**のどちらか一方で起動してください。両方同時に起動するとポート競合が発生します
- **Poetryでの直接起動は開発中の一時的な方法**としてのみ使用し、本番環境ではDocker Composeまたはsystemdサービス化を推奨します

