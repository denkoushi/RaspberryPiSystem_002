---
title: システム自動起動の現状と設定手順
tags: [自動起動, systemd, Docker Compose, 起動設定]
audience: [運用者, 開発者]
last-verified: 2025-12-01
related: [raspberry-pi4-restart-commands.md, operation-manual.md]
category: guides
update-frequency: medium
---

# システム自動起動の現状と設定手順

最終更新: 2025-12-01

## 概要

本ドキュメントでは、各Raspberry Pi端末の自動起動設定の現状と、将来の自動起動設定手順を説明します。

## 現状（2025-12-01時点）

| 端末 | 自動起動設定 | 状態 | 備考 |
|------|------------|------|------|
| **Raspberry Pi 5（サーバー）** | Docker Compose: `restart: unless-stopped` | ✅ 自動起動 | 再起動後も自動的にコンテナが起動 |
| **Raspberry Pi 4（クライアント）** | 手動起動 | ⚠️ 手動 | 開発中のため自動起動を無効化 |
| **Raspberry Pi 3（クライアント）** | systemdサービス: `signage-lite.service` | ✅ 自動起動 | サイネージ表示が自動起動 |

---

## Raspberry Pi 5（サーバー）の自動起動設定

### 現状

**Docker Composeの設定:**

```yaml
# infrastructure/docker/docker-compose.server.yml
services:
  db:
    restart: unless-stopped  # ✅ 自動起動設定済み
  api:
    restart: unless-stopped  # ✅ 自動起動設定済み
  web:
    restart: unless-stopped  # ✅ 自動起動設定済み
```

**動作確認:**

```bash
# Raspberry Pi 5で実行
# 再起動後、自動的にコンテナが起動することを確認
sudo reboot

# 再起動後、コンテナの状態を確認
docker compose -f infrastructure/docker/docker-compose.server.yml ps
```

**期待される結果:**
- すべてのコンテナが`Up`状態
- 再起動後も自動的に起動

### 設定の確認

**Docker Composeの設定を確認:**

```bash
# docker-compose.server.ymlの内容を確認
cat infrastructure/docker/docker-compose.server.yml | grep restart
```

**期待される出力:**
```
restart: unless-stopped
restart: unless-stopped
restart: unless-stopped
```

---

## Raspberry Pi 4（クライアント）の自動起動設定

### 現状

**開発中のため、自動起動を無効化しています。**

**手動起動が必要なサービス:**
- NFCエージェント（Docker Compose）
- キオスクブラウザ（systemdサービス）

**再起動後の起動手順:**

```bash
# 1. pcscdサービスの起動
sudo systemctl start pcscd

# 2. NFCエージェントの起動（Docker Compose）
cd /opt/RaspberryPiSystem_002
docker compose -f infrastructure/docker/docker-compose.client.yml up -d

# 3. キオスクブラウザの起動（必要な場合）
sudo systemctl start kiosk-browser.service
```

詳細は [Raspberry Pi 4再起動時のサービス起動ガイド](./raspberry-pi4-restart-commands.md) を参照してください。

### 将来の自動起動設定手順

**本番環境で自動起動を有効化する場合:**

#### 1. Docker Composeの自動起動設定

**docker-compose.client.ymlを確認:**

```bash
# ファイルが存在するか確認
ls -la infrastructure/docker/docker-compose.client.yml

# 内容を確認
cat infrastructure/docker/docker-compose.client.yml
```

**設定内容（推奨）:**

```yaml
services:
  nfc-agent:
    restart: unless-stopped  # 自動起動を有効化
    # ... その他の設定
```

#### 2. systemdサービスの自動起動設定

**キオスクブラウザの自動起動を有効化:**

```bash
# 自動起動を有効化
sudo systemctl enable kiosk-browser.service

# 状態確認
systemctl is-enabled kiosk-browser.service
```

**期待される出力:**
```
enabled
```

#### 3. status-agentの自動起動設定

**status-agentは既に自動起動設定済み:**

```bash
# 状態確認
systemctl is-enabled status-agent.timer

# 期待される出力: enabled
```

---

## Raspberry Pi 3（クライアント）の自動起動設定

### 現状

**サイネージ表示が自動起動設定済み:**

```bash
# 自動起動の状態確認
systemctl is-enabled signage-lite.service

# 期待される出力: enabled
```

**再起動後の動作:**

- システム起動時に自動的にサイネージが表示される
- 手動操作は不要

### 設定の確認

**サイネージサービスの状態確認:**

```bash
# サービスの状態確認
systemctl status signage-lite.service

# 自動起動の確認
systemctl is-enabled signage-lite.service
```

---

## 自動起動設定のまとめ

### 現状（2025-12-01）

| 端末 | サービス | 自動起動 | 設定方法 |
|------|---------|---------|---------|
| **Raspberry Pi 5** | Docker Compose（db/api/web） | ✅ 有効 | `restart: unless-stopped` |
| **Raspberry Pi 4** | Docker Compose（nfc-agent） | ⚠️ 無効 | 開発中のため手動起動 |
| **Raspberry Pi 4** | systemd（kiosk-browser） | ⚠️ 無効 | 開発中のため手動起動 |
| **Raspberry Pi 4** | systemd（status-agent） | ✅ 有効 | `systemctl enable` |
| **Raspberry Pi 3** | systemd（signage-lite） | ✅ 有効 | `systemctl enable` |

### 将来の設定（本番環境）

**Raspberry Pi 4の自動起動を有効化する場合:**

1. **Docker Composeの設定:**
   ```yaml
   # infrastructure/docker/docker-compose.client.yml
   services:
     nfc-agent:
       restart: unless-stopped
   ```

2. **systemdサービスの有効化:**
   ```bash
   sudo systemctl enable kiosk-browser.service
   ```

3. **再起動後の動作確認:**
   ```bash
   sudo reboot
   # 再起動後、自動的にサービスが起動することを確認
   ```

---

## 自動起動設定のベストプラクティス

### 1. Docker Composeを使用する場合

**推奨設定:**

```yaml
services:
  service-name:
    restart: unless-stopped  # 自動起動を有効化
```

**設定の説明:**
- `unless-stopped`: コンテナが手動で停止されていない限り、自動的に再起動
- `always`: 常に自動的に再起動（手動停止後も再起動）

### 2. systemdサービスを使用する場合

**推奨設定:**

```ini
[Unit]
Description=Service Description
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/path/to/command
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

**有効化:**

```bash
sudo systemctl daemon-reload
sudo systemctl enable service-name.service
sudo systemctl start service-name.service
```

---

## トラブルシューティング

### 自動起動しない場合

**確認事項:**
1. サービスが有効化されているか
   ```bash
   systemctl is-enabled service-name.service
   ```

2. Docker Composeの設定を確認
   ```bash
   cat docker-compose.yml | grep restart
   ```

3. システムログを確認
   ```bash
   journalctl -u service-name.service -n 50
   ```

### 手動で起動する場合

**Raspberry Pi 4:**

```bash
# Docker Composeで起動
cd /opt/RaspberryPiSystem_002
docker compose -f infrastructure/docker/docker-compose.client.yml up -d

# systemdサービスで起動
sudo systemctl start kiosk-browser.service
```

**Raspberry Pi 5:**

```bash
# Docker Composeで起動
cd /opt/RaspberryPiSystem_002
docker compose -f infrastructure/docker/docker-compose.server.yml up -d
```

---

## 関連ドキュメント

- [Raspberry Pi 4再起動時のサービス起動ガイド](./raspberry-pi4-restart-commands.md): 手動起動手順の詳細
- [運用マニュアル](./operation-manual.md): 日常的な運用手順
- [新規クライアント端末の初期設定手順](./client-initial-setup.md): 新規クライアント追加時の設定

