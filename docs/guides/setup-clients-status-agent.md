---
title: クライアント端末のstatus-agent設定手順（実機テスト用）
tags: [status-agent, 実機テスト, 設定手順]
audience: [運用者, 開発者]
last-verified: 2025-12-01
related: [client-initial-setup.md, status-agent.md]
category: guides
update-frequency: medium
---

# クライアント端末のstatus-agent設定手順（実機テスト用）

最終更新: 2025-12-01

## 概要

このドキュメントでは、既存のRaspberry Pi 3/4にstatus-agentを設定して、管理コンソールに表示されるようにする手順を説明します。

## 前提条件

- Raspberry Pi 5（サーバー）が起動していること
- Raspberry Pi 3/4が起動していること
- MacからRaspberry Pi 5にSSH接続できること
- AnsibleがRaspberry Pi 5にインストールされていること

---

## Step 1: クライアントデバイスをサーバーに登録

**Macのターミナルで実行:**

```bash
# プロジェクトディレクトリに移動
cd /Users/tsudatakashi/RaspberryPiSystem_002

# クライアントデバイスを登録
./scripts/register-clients.sh
```

**期待される出力:**
```
[INFO] Logging in to API...
[INFO] Access token obtained
[INFO] Registering client: raspberrypi4 (raspberrypi4-kiosk1)
[SUCCESS] Client raspberrypi4 registered successfully
[INFO] Registering client: raspberrypi3 (raspberrypi3-signage1)
[SUCCESS] Client raspberrypi3 registered successfully
[INFO] Client registration completed
```

**エラーが出た場合:**
- APIサーバーが起動しているか確認: `curl http://192.168.128.131:8080/api/system/health`
- ログイン情報が正しいか確認（デフォルト: `admin` / `admin1234`）

---

## Step 2: Ansibleプレイブックを実行してstatus-agentを設定

**Macのターミナルで実行:**

```bash
# プロジェクトディレクトリに移動
cd /Users/tsudatakashi/RaspberryPiSystem_002

# 環境変数を設定（Raspberry Pi 5へのSSH接続情報）
export RASPI_SERVER_HOST="denkon5sd02@192.168.128.131"

# 一括更新スクリプトを実行（status-agentの設定も含まれる）
./scripts/update-all-clients.sh
```

**期待される出力:**
- Gitリポジトリの更新
- status-agentの設定ファイル作成
- systemdサービス・タイマーのコピーと有効化
- 各クライアントへの接続成功

**エラーが出た場合:**
- SSH接続ができるか確認: `ssh denkon5sd02@192.168.128.131`
- Ansibleがインストールされているか確認: `ssh denkon5sd02@192.168.128.131 "ansible --version"`
- インベントリファイルの設定を確認: `cat infrastructure/ansible/inventory.yml`

---

## Step 3: status-agentの動作確認

**各クライアント端末で確認:**

### Raspberry Pi 4で確認

```bash
# SSH接続（Macから）
ssh tools03@192.168.128.102

# status-agentの設定ファイルを確認
cat /etc/raspi-status-agent.conf

# status-agentのタイマー状態を確認
systemctl status status-agent.timer

# status-agentのサービス状態を確認
systemctl status status-agent.service

# ログを確認
journalctl -u status-agent.service -n 20
```

### Raspberry Pi 3で確認

```bash
# SSH接続（Macから）
ssh signageras3@192.168.128.152

# status-agentの設定ファイルを確認
cat /etc/raspi-status-agent.conf

# status-agentのタイマー状態を確認
systemctl status status-agent.timer

# status-agentのサービス状態を確認
systemctl status status-agent.service

# ログを確認
journalctl -u status-agent.service -n 20
```

**期待される結果:**
- `status-agent.timer`が`active (waiting)`状態
- `status-agent.service`が1分ごとに実行される
- ログにエラーがない

---

## Step 4: 管理コンソールで確認

**ブラウザでアクセス:**

```
https://192.168.128.131/admin/clients
```

**確認事項:**
- ラズパイ3、4が一覧に表示される
- CPU、メモリ、ディスク、温度が表示される
- 最終確認時刻が1分以内であること

**表示されない場合:**
- status-agentが正常に動作しているか確認（Step 3を参照）
- APIログを確認: `ssh denkon5sd02@192.168.128.131 "docker compose -f /opt/RaspberryPiSystem_002/infrastructure/docker/docker-compose.server.yml logs api | grep 'clients/status'"`

---

## トラブルシューティング

### クライアントデバイスの登録に失敗する場合

**確認事項:**
1. APIサーバーが起動しているか
   ```bash
   curl http://192.168.128.131:8080/api/system/health
   ```

2. ログイン情報が正しいか
   ```bash
   curl -X POST http://192.168.128.131:8080/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{"username":"admin","password":"admin1234"}'
   ```

### Ansibleプレイブックの実行に失敗する場合

**確認事項:**
1. SSH接続ができるか
   ```bash
   ssh denkon5sd02@192.168.128.131
   ```

2. Ansibleがインストールされているか
   ```bash
   ssh denkon5sd02@192.168.128.131 "ansible --version"
   ```

3. インベントリファイルの設定を確認
   ```bash
   cat infrastructure/ansible/inventory.yml
   ```

### status-agentが動作しない場合

**確認事項:**
1. 設定ファイルが正しいか
   ```bash
   cat /etc/raspi-status-agent.conf
   ```

2. systemdサービスが有効化されているか
   ```bash
   systemctl is-enabled status-agent.timer
   ```

3. ログを確認
   ```bash
   journalctl -u status-agent.service -n 50
   ```

### 管理コンソールに表示されない場合

**確認事項:**
1. status-agentが正常に動作しているか（Step 3を参照）
2. APIログを確認
   ```bash
   ssh denkon5sd02@192.168.128.131 "docker compose -f /opt/RaspberryPiSystem_002/infrastructure/docker/docker-compose.server.yml logs api | grep 'clients/status'"
   ```

3. クライアントデバイスが登録されているか
   ```bash
   # Macから実行
   TOKEN=$(curl -s -X POST http://192.168.128.131:8080/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{"username":"admin","password":"admin1234"}' | jq -r '.accessToken')
   
   curl -X GET http://192.168.128.131:8080/api/clients/status \
     -H "Authorization: Bearer $TOKEN" | jq '.'
   ```

---

## 関連ドキュメント

- [新規クライアント端末の初期設定手順](./client-initial-setup.md): 新規クライアント追加時の詳細手順
- [status-agentガイド](./status-agent.md): status-agentの詳細な設定方法
- [MacからRaspberry Pi 5へのSSH接続ガイド](./mac-ssh-access.md): SSH接続の詳細手順

