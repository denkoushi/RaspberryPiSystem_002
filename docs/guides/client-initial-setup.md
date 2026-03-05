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

最終更新: 2026-03-05（NFCリーダー用のDocker前提条件・インストール手順を追加。標準デプロイでpcscd/nfc-agentが自動設定される旨を明記）

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

### 2.3 Tailscale接続の設定（Pi4追加時）

**重要**: Pi4へはPi5からTailscale経由で接続するのがルールです。

**Pi4で実行（Tailscale接続とタグ設定）**:

1. **Tailscaleのインストールと認証**:
   ```bash
   # Pi4で実行
   curl -fsSL https://tailscale.com/install.sh | sh
   sudo tailscale up
   # 認証URLが表示されるので、Macのブラウザで開いて承認
   ```

2. **Tailscale管理画面でタグを設定**:
   - Tailscale管理画面（https://login.tailscale.com/admin/machines）にアクセス
   - Pi4の端末を選択し、`tag:kiosk`を付与
   - 保存後、約30秒待つ

3. **Tailscale SSHの無効化**（重要）:
   ```bash
   # Pi4で実行
   sudo tailscale set --ssh=false
   # 確認
   tailscale status --json | grep -i ssh
   # "https://tailscale.com/cap/ssh": null が表示されればOK
   ```
   - **理由**: Tailscale SSHが有効だと、標準SSH（鍵認証）がブロックされる
   - Pi5からPi4へのAnsible接続には標準SSHが必要

**Pi5からPi4への接続確認**:

```bash
# Pi5で実行
tailscale status
# Pi4が表示されていることを確認（例: raspi4-robodrill01）

# Pi5からPi4へのping確認
ping -c 3 <Pi4のTailscale IP>
# 例: ping -c 3 100.123.1.113

# Pi5からPi4へのSSH接続確認
ssh <ユーザー名>@<Pi4のTailscale IP>
# 例: ssh tools04@100.123.1.113
```

**トラブルシューティング**:
- `tailnet policy does not permit you to SSH to this node`: Tailscale SSHが有効になっている。Pi4で`sudo tailscale set --ssh=false`を実行
- `Permission denied (publickey,password)`: Pi5の公開鍵がPi4の`authorized_keys`に追加されていない。手動で追加する（下記参照）

### 2.4 SSH接続のテスト

**Raspberry Pi 5（サーバー）で実行:**

```bash
# パスワードなしで接続できるか確認
ssh <ユーザー名>@<IPアドレス>

# 例（Tailscale経由）:
# ssh tools04@100.123.1.113  # Pi4のTailscale IP
# ssh tools03@100.74.144.79  # 既存Pi4のTailscale IP
# ssh signageras3@100.105.224.86  # Pi3のTailscale IP
```

**期待される結果:**
- パスワード入力なしで接続できる
- 接続後、`exit`で切断できる

**Pi4追加時の注意事項**:
- **Tailscale SSH無効化**: Pi4で`sudo tailscale set --ssh=false`を実行（標準SSHを使用するため）
- **SSH鍵の手動追加**: `ssh-copy-id`が使えない場合は、Pi5の公開鍵をPi4の`authorized_keys`に手動で追加
  ```bash
  # Pi5で公開鍵を表示
  cat ~/.ssh/id_ed25519.pub
  
  # Pi4で公開鍵を追加（RealVNC経由または直接ログイン）
  mkdir -p ~/.ssh
  chmod 700 ~/.ssh
  echo "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA..." >> ~/.ssh/authorized_keys
  chmod 600 ~/.ssh/authorized_keys
  ```
- **接続確認**: Pi5から`ansible <ホスト名> -i infrastructure/ansible/inventory.yml -m ping`で接続確認

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

### 4.1.1 `register-clients.sh` を使う場合の注意（重複登録防止）

`scripts/register-clients.sh` は `inventory.yml` から `status_agent_client_key` を読み取り登録します。  
未解決テンプレート（例: `{{ vault_status_agent_client_key ... }}`）が残っていると、誤ったAPIキーで重複登録されるため、実行前に必ずドライランで確認してください。

```bash
cd /opt/RaspberryPiSystem_002

# 先にドライランで判定結果を確認（API登録は行わない）
DRY_RUN=1 SERVER_IP=100.106.158.2 ./scripts/register-clients.sh

# 問題なければ本実行
SERVER_IP=100.106.158.2 ./scripts/register-clients.sh
```

**確認ポイント**:
- `Skip client ... unresolved/invalid status_agent_client_key detected` が出る端末は、inventoryのキー定義を見直す
- 実機に対応する端末のみが `[SUCCESS]` で登録される
- 再実行してもクライアント件数が増えない（冪等）

**現時点での運用方針（2026-02-28）**:
- **新規端末追加時は固定キーを使用することを推奨**
  - 例: `raspi4-robodrill01`の`client-key-raspi4-robodrill01-kiosk1`（`inventory.yml`に直接文字列で定義）
  - vault管理のテンプレート（`{{ vault_status_agent_client_key ... }}`）は`register-clients.sh`でスキップされる
- **既存端末（`raspberrypi3`, `raspberrypi4`, `raspberrypi5`）について**:
  - vaultで管理されているが、`register-clients.sh`はスキップされる
  - `status-agent`のheartbeat（`POST /api/clients/heartbeat`）で自動登録されるため、手動登録は不要
- **場所（location）設定について**:
  - `status_agent_location`は`register-clients.sh`で使用されるが、vaultテンプレートのためスキップされる
  - `status-agent`はlocationを送信しないため、DBの`location`は`status-agent`のheartbeatでは更新されない
  - 場所を設定する場合は、管理コンソールから直接編集するか、DB直接更新が必要（`UPDATE "ClientDevice" SET "location" = '...' WHERE "apiKey" = '...'`）
  - `inventory.yml`の`status_agent_location`を更新した場合は、Pi5へのデプロイで反映される（将来の`register-clients.sh`実行時に使用される）
- **vault管理のキーを直接登録する必要が出た場合**:
  - 将来的にAnsible経由での変数解決方式へ移行することを検討（詳細は [KB-278](../knowledge-base/infrastructure/security.md#kb-278-クライアント端末管理の重複登録inventory未解決テンプレキー混入) の「次のフェーズの検討タイミング」を参照）

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

## Step 5: kiosk-browser.serviceの設定と起動（キオスク端末の場合）

**重要**: キオスク端末（研削メイン端末など）として使用する場合は、この手順を実行してください。

### 5.1 chromium-browserシンボリックリンクの作成（Debian Trixie対応）

**Debian Trixie（Debian 13）では`chromium-browser`パッケージが存在せず、`chromium`パッケージのみが利用可能です。**

**⚠️ 注意（2026-02-28更新）**: 現在はAnsibleロール（`roles/kiosk/tasks/main.yml`）で自動化されており、デプロイ時に自動的にシンボリックリンクが作成されます。以下の手動手順は、Ansibleデプロイ前の初期セットアップ時のみ必要です。

**クライアント端末で実行:**

```bash
# chromiumがインストールされているか確認
which chromium || echo "chromium not found"

# chromium-browserシンボリックリンクを作成
sudo ln -sf /usr/bin/chromium /usr/bin/chromium-browser

# 確認
which chromium-browser && chromium-browser --version | head -1
```

**期待される結果:**
- `/usr/bin/chromium-browser`が`/usr/bin/chromium`へのシンボリックリンクとして作成される
- `chromium-browser --version`が正常に動作する

### 5.2 kiosk-browser.serviceの有効化・起動

**クライアント端末で実行:**

```bash
# systemdをリロード
sudo systemctl daemon-reload

# 自動起動を有効化
sudo systemctl enable kiosk-browser.service

# サービスを起動
sudo systemctl start kiosk-browser.service

# 状態確認
systemctl status kiosk-browser.service --no-pager | head -15
```

**期待される結果:**
- `kiosk-browser.service`が`active (running)`状態
- `enabled`で自動起動が有効化されている
- chromiumプロセスが実行中で、キオスクURLを開いている

### 5.3 トラブルシューティング

**エラー: `chromium-browser: not found`**
- 原因: Debian Trixieでは`chromium-browser`パッケージが存在しない
- 解決策: 上記5.1の手順でシンボリックリンクを作成

**エラー: `kiosk-browser.service: Failed with result 'exit-code'`**
- 原因: `chromium-browser`コマンドが見つからない
- 解決策: シンボリックリンクの存在を確認（`ls -la /usr/bin/chromium-browser`）

**ログ確認:**
```bash
# サービスログを確認
journalctl -u kiosk-browser.service -n 20 --no-pager
```

**関連KB**: 
- [KB-280: Pi4追加時のkiosk-browser.service起動エラー（chromium-browserコマンド未検出）](../knowledge-base/infrastructure/security.md#kb-280-pi4追加時のkiosk-browserservice起動エラーchromium-browserコマンド未検出)
- [KB-281: Pi4 kiosk-browser対策のAnsible恒久化と実機デプロイ検証（到達不可端末の切り分け含む）](../knowledge-base/infrastructure/security.md#kb-281-pi4-kiosk-browser対策のansible恒久化と実機デプロイ検証到達不可端末の切り分け含む)

---

## Step 5.5: NFCエージェントの設定と起動（キオスクでNFCを使う場合）

**重要**: キオスク端末でNFCリーダー（工具持出・計測機器持出等）を使う場合は、この手順を実行してください。

**注意（2026-03-05更新）**: 標準デプロイ（`update-all-clients.sh`）実行時、client role が自動で以下を実施します。

- **pcscd**（PC/SC デーモン）と **pcsc-tools** の導入・起動
- nfc-agent 用 `.env` の配布
- Docker Compose による **nfc-agent** コンテナの起動・維持

したがって、**inventory.yml に `nfc_agent_client_id` が定義された Pi4 に対して標準デプロイを実行すれば、NFCリーダーは正常動作します。** 以下の手順は **Ansibleデプロイ前の初期セットアップ時** または **手動復旧時** のみ必要です。

### 5.5.1 前提条件

- `inventory.yml` に `nfc_agent_client_id` と `nfc_agent_client_secret` が定義されていること
- **Pi4 に Docker がインストールされていること**（未導入の場合、デプロイ時に fail します）
- NFCリーダー（Sony RC-S300/S1 等）が USB 接続されていること

**Docker が未導入の新規 Pi4 の場合**（2026-03-05 追記: raspi4-robodrill01 で発生した事象）:

```bash
# Pi4 で実行
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# ログアウト・再ログイン後、docker コマンドが使えることを確認
```

### 5.5.2 手動セットアップ（デプロイ前のみ）

**クライアント端末で実行:**

```bash
cd /opt/RaspberryPiSystem_002
sudo scripts/client/setup-nfc-agent.sh
```

**期待される結果:**
- `clients/nfc-agent/.env` が作成される（未存在時は `.env.example` からコピー）
- Docker Compose で nfc-agent コンテナが起動する

### 5.5.3 動作確認

```bash
curl http://localhost:7071/api/agent/status
```

期待: `readerConnected: true` が含まれる JSON が返ること。

**関連**: [NFCリーダーのトラブルシューティング](../troubleshooting/nfc-reader-issues.md)、[KB-291](../knowledge-base/infrastructure/KB-291-robodrill01-nfc-scan-not-responding-investigation.md)

---

## Step 6: 管理コンソールでの確認

### 6.1 管理画面でクライアント状態を確認

**ブラウザでアクセス:**

```
https://192.168.128.131/admin/clients
```

**確認事項:**
- 新規クライアントが一覧に表示される
- CPU、メモリ、ディスク、温度が表示される
- 最終確認時刻が1分以内であること

### 6.2 APIで直接確認

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

