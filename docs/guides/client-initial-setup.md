---
title: 新規クライアント端末の初期設定手順
tags: [初期設定, クライアント, status-agent, SSH]
audience: [運用者, 開発者]
last-verified: 2025-12-01
related: [status-agent.md, ssh-setup.md, operation-manual.md]
category: guides
update-frequency: medium
---

# 新規クライアント端末の初期設定手順

最終更新: 2025-12-01

## 概要

本ドキュメントでは、新規のRaspberry Piクライアント端末（Raspberry Pi 3/4/Zero2W）をシステムに追加する際の初期設定手順を説明します。

## 前提条件

- Raspberry Pi端末にRaspberry Pi OSがインストール済み
- サーバー（Raspberry Pi 5）にSSH接続できること
- クライアント端末がサーバーと同じネットワークに接続されていること

## 初期設定の全体フロー

```
1. クライアント端末の基本設定
   ↓
2. SSH鍵認証の設定（サーバーからクライアントへ）
   ↓
3. Gitリポジトリのクローン
   ↓
4. status-agentの設定と起動
   ↓
5. 管理コンソールでの確認
```

---

## Step 1: クライアント端末の基本設定

### 1.1 ユーザー名とホスト名の確認

**クライアント端末で実行:**

```bash
# 現在のユーザー名を確認
whoami

# ホスト名を確認
hostname

# IPアドレスを確認
hostname -I
```

**記録事項:**
- ユーザー名（例: `tools03`, `signageras3`）
- ホスト名（例: `raspberrypi`, `raspberrypi4`）
- IPアドレス（例: `192.168.128.102`）

### 1.2 SSHサーバーの起動確認

**クライアント端末で実行:**

```bash
# SSHサーバーの状態確認
sudo systemctl status ssh

# SSHサーバーが停止している場合、起動
sudo systemctl start ssh
sudo systemctl enable ssh
```

---

## Step 2: SSH鍵認証の設定

### 2.1 サーバー側でSSH鍵を生成（初回のみ）

**Raspberry Pi 5（サーバー）で実行:**

```bash
# SSH鍵が既に存在するか確認
ls -la ~/.ssh/id_ed25519.pub

# 存在しない場合、鍵を生成
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -N ""

# 公開鍵を確認
cat ~/.ssh/id_ed25519.pub
```

### 2.2 クライアント端末に公開鍵を配布

**方法1: ssh-copy-idを使用（推奨）**

**Raspberry Pi 5（サーバー）で実行:**

```bash
# クライアント端末に公開鍵をコピー
ssh-copy-id -i ~/.ssh/id_ed25519.pub <ユーザー名>@<IPアドレス>

# 例:
# ssh-copy-id -i ~/.ssh/id_ed25519.pub tools03@192.168.128.102
# ssh-copy-id -i ~/.ssh/id_ed25519.pub signageras3@192.168.128.152
```

**方法2: 手動で公開鍵を追加（ssh-copy-idが使えない場合）**

**Raspberry Pi 5（サーバー）で実行:**

```bash
# 公開鍵を表示
cat ~/.ssh/id_ed25519.pub
```

**クライアント端末で実行:**

```bash
# .sshディレクトリを作成（存在しない場合）
mkdir -p ~/.ssh
chmod 700 ~/.ssh

# 公開鍵を追加
echo "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA..." >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

### 2.3 SSH接続のテスト

**Raspberry Pi 5（サーバー）で実行:**

```bash
# パスワードなしで接続できるか確認
ssh <ユーザー名>@<IPアドレス>

# 例:
# ssh tools03@192.168.128.102
# ssh signageras3@192.168.128.152
```

**期待される結果:**
- パスワード入力なしで接続できる
- 接続後、`exit`で切断できる

---

## Step 3: Gitリポジトリのクローン

### 3.1 クライアント端末でリポジトリをクローン

**クライアント端末で実行:**

```bash
# リポジトリをクローン
cd /opt
sudo git clone https://github.com/denkoushi/RaspberryPiSystem_002.git

# 所有者を変更（必要に応じて）
sudo chown -R <ユーザー名>:<ユーザー名> /opt/RaspberryPiSystem_002

# 例:
# sudo chown -R tools03:tools03 /opt/RaspberryPiSystem_002
```

### 3.2 インベントリファイルへの追加

**Raspberry Pi 5（サーバー）で実行:**

```bash
cd /opt/RaspberryPiSystem_002

# インベントリファイルを編集
nano infrastructure/ansible/inventory.yml
```

**追加内容:**

```yaml
all:
  children:
    clients:
      hosts:
        # 既存のクライアント
        raspberrypi4:
          ansible_host: 192.168.128.102
          ansible_user: tools03
        raspberrypi3:
          ansible_host: 192.168.128.152
          ansible_user: signageras3
        # 新規クライアントを追加
        <ホスト名>:
          ansible_host: <IPアドレス>
          ansible_user: <ユーザー名>
      vars:
        ansible_ssh_common_args: '-o StrictHostKeyChecking=no'
        ansible_python_interpreter: /usr/bin/python3
```

### 3.3 Ansible接続テスト

**Raspberry Pi 5（サーバー）で実行:**

```bash
cd /opt/RaspberryPiSystem_002

# 新規クライアントへの接続テスト
ansible <ホスト名> -i infrastructure/ansible/inventory.yml -m ping

# 全クライアントへの接続テスト
ansible all -i infrastructure/ansible/inventory.yml -m ping
```

**期待される結果:**
- `SUCCESS => {"changed": false, "ping": "pong"}` が表示される

---

## Step 4: status-agentの設定と起動

### 4.1 サーバー側でクライアントデバイスを登録

**管理画面で実行:**

1. ブラウザで管理画面にアクセス: `https://192.168.128.131/admin`
2. 「クライアント端末管理」ページに移動
3. 「新規追加」ボタンをクリック
4. 以下の情報を入力:
   - **名前**: クライアントの識別名（例: `Raspberry Pi 4 - キオスク1`）
   - **クライアントID**: 一意のID（例: `raspberrypi4-kiosk1`）
   - **APIキー**: 自動生成または手動入力
   - **場所**: 設置場所（例: `1F 受付`）

5. 「保存」ボタンをクリック

**または、APIで直接登録:**

```bash
# ログインしてトークンを取得
TOKEN=$(curl -s -X POST http://192.168.128.131:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin1234"}' | jq -r '.accessToken')

# クライアントデバイスを登録
curl -X POST http://192.168.128.131:8080/api/clients/devices \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Raspberry Pi 4 - キオスク1",
    "clientId": "raspberrypi4-kiosk1",
    "apiKey": "client-key-raspberrypi4-kiosk1",
    "location": "1F 受付"
  }'
```

### 4.2 クライアント端末でstatus-agentを設定

**クライアント端末で実行:**

```bash
cd /opt/RaspberryPiSystem_002

# 設定ファイルのテンプレートをコピー
sudo cp clients/status-agent/status-agent.conf.example /etc/raspi-status-agent.conf

# 設定ファイルを編集
sudo nano /etc/raspi-status-agent.conf
```

**設定内容:**

```ini
# APIサーバーのURL
API_BASE_URL=http://192.168.128.131:8080/api

# クライアントID（サーバー側で登録したID）
CLIENT_ID=raspberrypi4-kiosk1

# APIキー（サーバー側で登録したキー）
CLIENT_KEY=client-key-raspberrypi4-kiosk1

# ログファイルのパス（オプション）
LOG_FILE=/var/log/raspi-status-agent.log

# リクエストタイムアウト（秒）
REQUEST_TIMEOUT=10

# TLS証明書の検証をスキップ（社内ネットワーク限定）
TLS_SKIP_VERIFY=1
```

### 4.3 status-agentの手動テスト

**クライアント端末で実行:**

```bash
cd /opt/RaspberryPiSystem_002/clients/status-agent

# ドライラン（実際には送信しない）
STATUS_AGENT_CONFIG=/etc/raspi-status-agent.conf ./status-agent.py --dry-run

# 実際に送信（ドライランを外す）
STATUS_AGENT_CONFIG=/etc/raspi-status-agent.conf ./status-agent.py
```

**期待される結果:**
- エラーなく実行される
- サーバーのログに状態報告が記録される

### 4.4 systemdサービスとして登録

**クライアント端末で実行:**

```bash
cd /opt/RaspberryPiSystem_002

# systemdサービスファイルをコピー
sudo cp clients/status-agent/status-agent.service /etc/systemd/system/
sudo cp clients/status-agent/status-agent.timer /etc/systemd/system/

# systemdをリロード
sudo systemctl daemon-reload

# タイマーを有効化・起動
sudo systemctl enable --now status-agent.timer

# 状態確認
systemctl status status-agent.timer
systemctl status status-agent.service
```

**期待される結果:**
- `status-agent.timer`が`active (waiting)`状態
- `status-agent.service`が1分ごとに実行される

---

## Step 5: 管理コンソールでの確認

### 5.1 管理画面でクライアント状態を確認

**ブラウザでアクセス:**

```
https://192.168.128.131/admin/clients
```

**確認事項:**
- 新規クライアントが一覧に表示される
- CPU、メモリ、ディスク、温度が表示される
- 最終確認時刻が1分以内であること

### 5.2 APIで直接確認

**Macのターミナルで実行:**

```bash
# ログインしてトークンを取得
TOKEN=$(curl -s -X POST http://192.168.128.131:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin1234"}' | jq -r '.accessToken')

# クライアント状態を取得
curl -X GET http://192.168.128.131:8080/api/clients/status \
  -H "Authorization: Bearer $TOKEN" | jq '.[] | select(.clientId == "raspberrypi4-kiosk1")'
```

**期待される結果:**
- クライアントの状態が表示される
- `lastSeen`が1分以内であること

---

## トラブルシューティング

### SSH接続が失敗する場合

**確認事項:**
1. IPアドレスが正しいか
2. ユーザー名が正しいか
3. SSHサーバーが起動しているか
4. 公開鍵が正しく追加されているか

**解決方法:**
- [SSH鍵ベース運用ガイド](./ssh-setup.md)を参照

### status-agentが動作しない場合

**確認事項:**
1. 設定ファイルのパスが正しいか
2. APIキーがサーバー側で登録されているか
3. ネットワーク接続が正常か

**解決方法:**
- [status-agentガイド](./status-agent.md)のトラブルシューティングセクションを参照

### 管理コンソールに表示されない場合

**確認事項:**
1. status-agentが正常に動作しているか
2. サーバー側でクライアントデバイスが登録されているか
3. APIキーが一致しているか

**解決方法:**
```bash
# クライアント端末でstatus-agentのログを確認
journalctl -u status-agent.service -n 50

# サーバー側でAPIログを確認
docker compose -f infrastructure/docker/docker-compose.server.yml logs api | grep "clients/status"
```

---

## 次のステップ

1. **Ansibleでの一括更新**: 新規クライアントもAnsibleで更新できることを確認
   ```bash
   # Raspberry Pi 5で実行
   ansible-playbook -i infrastructure/ansible/inventory.yml \
     infrastructure/ansible/playbooks/update-clients.yml \
     --limit <ホスト名>
   ```

2. **自動起動の設定**: 本番環境では自動起動を有効化
   - [Raspberry Pi 4再起動時のサービス起動ガイド](./raspberry-pi4-restart-commands.md)を参照

3. **監視の設定**: クライアント状態を定期的に確認
   - [運用マニュアル](./operation-manual.md)の「クライアント状態監視」セクションを参照

---

## 関連ドキュメント

- [status-agentガイド](./status-agent.md): status-agentの詳細な設定方法
- [SSH鍵ベース運用ガイド](./ssh-setup.md): SSH鍵認証の詳細な設定方法
- [運用マニュアル](./operation-manual.md): 日常的な運用手順
- [クイックスタートガイド](./quick-start-deployment.md): 一括更新と監視のクイックスタート

