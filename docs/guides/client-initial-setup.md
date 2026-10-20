---
title: 新規クライアント端末の初期設定手順
tags: [初期設定, クライアント, status-agent, SSH]
audience: [運用者, 開発者]
last-verified: 2026-05-04
related: [status-agent.md, ssh-setup.md, operation-manual.md]
category: guides
update-frequency: medium
---

# 新規クライアント端末の初期設定手順

最終更新: 2026-05-04（Zero 2 W 棚番エッジの導線・トラブルシュートは [zero2w-tanaban-edge-setup.md](../runbooks/zero2w-tanaban-edge-setup.md)・[KB-367](../knowledge-base/KB-367-zero2w-tanaban-edge-tailscale-ansible.md)。従来の Pi5→Pi4 LAN 知見: 2026-03-28 追記・[KB-315](../knowledge-base/infrastructure/ansible-deployment.md#kb-315-pi4-fjv-third-kiosk)）

## 概要

本ドキュメントでは、新規のRaspberry Piクライアント端末（Raspberry Pi 3/4/Zero2W）をシステムに追加する際の初期設定手順を説明します。

**Zero 2 W をヘッドレスの棚番エッジ（キオスク UI なし・status-agent 中心）として載せる場合**は、[Zero 2 W 棚番エッジ Runbook](../runbooks/zero2w-tanaban-edge-setup.md) を先に参照してください（`inventory.yml` に自宅端末を載せず、インベントリ断片 + 専用 playbook で Pi 5 から適用する流れ）。

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
3. 標準リリースの準備
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
- `No route to host`（Pi5 から新 Pi4 の **LAN IP** へ `ssh` / `ssh-copy-id` 時）: **Tailscale 未参加ではなく、Pi5 と新 Pi4 の間に L3 経路が無い**典型例。同一セグメントにいないと LAN 直は失敗する。**対処**: 届く経路（現場の別端末の VNC/コンソール等）で Pi5 の `~/.ssh/id_ed25519.pub` を Pi4 の `~/.ssh/authorized_keys` に追記し、新 Pi4 を Tailscale 参加・`tag:kiosk`・`sudo tailscale set --ssh=false` まで進めたうえで、**Pi5 からは Tailscale IP（`100.x`）**で接続する。**詳細**: [KB-315](../knowledge-base/infrastructure/ansible-deployment.md#kb-315-pi4-fjv-third-kiosk)

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

## Step 3: 標準リリースの準備

### 3.1 Pi4にリポジトリをクローンしない

標準releaseはSHA固定imageと配布ファイルだけを使用する。新規Pi4の `/opt/RaspberryPiSystem_002` は作成せず、空のまま初回導入へ進む。以降のinventory操作は管理側のリポジトリで行い、通常の変更・検証手順で反映する。

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
      children:
        kiosk:
          hosts:
            <ホスト名>:
              ansible_host: <IPアドレス>
              ansible_user: <ユーザー名>
              manage_kiosk_browser: true
              kiosk_initial_route: assembly
              nfc_agent_client_id: <登録済みNFCクライアントID>
```

status-agentとNFCの認証情報も既存のinventory/Vault契約に従って設定する。秘密値をコマンド例やログへ出さない。


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

初回導入より前に、inventoryの `status_agent_client_key` と同じキーをPi5の `ClientDevice.apiKey` へ登録する。status-agent/heartbeatは未登録端末を自動登録しない。

**Pi5上で実行**（対象host名は実際の端末に置き換える）:

```bash
cd /opt/RaspberryPiSystem_002/infrastructure/ansible
# 安全な方法で事前に設定済みの管理者資格情報をexportする（値を履歴へ書かない）
export ADMIN_ACCESS_TOKEN
# トークンの代わりにユーザー名・パスワードを使う場合:
# export ADMIN_USERNAME ADMIN_PASSWORD

REGISTER_CLIENT_HOST=raspi4-assembly-02 DRY_RUN=1 ../../scripts/register-clients.sh
# 対象host・clientId・key: resolved (redacted) を確認し、警告がなければ登録する
REGISTER_CLIENT_HOST=raspi4-assembly-02 ../../scripts/register-clients.sh
```

APIの既定値はPi5ローカルの `http://127.0.0.1:8080/api`。必要な場合だけ `API_BASE_URL` を指定する。Ansibleはこのcwdの `ansible.cfg` のVault設定を使い、key/locationのテンプレートをcontroller上で解決する。DRY_RUNも変数を解決するが、APIへの接続・登録はしない。キーは一部も表示しない。解決失敗はhost名だけの警告でスキップするため、警告を解消し `[SUCCESS]` を確認してから初回導入へ進む。

`kiosk_initial_route` が設定されていれば登録時に反映する（組立端末は `assembly`、自主検査端末は `self_inspection`）。詳細な初回導入手順は [deployment.md](./deployment.md#空のpi4キオスクへの初回導入) を参照する。

### 4.2 Pi4のagentとキオスクを標準経路で導入

Pi4では、上記の端末登録とinventory設定後に [空のPi4キオスクへの初回導入](./deployment.md#空のpi4キオスクへの初回導入) を実施する。OS Desktop・Docker Compose・Desktop Autologinと稼働中のlabwcセッションが前提となる。廃止済みの `playbooks/deploy.yml`、手動のstatus設定コピー、`setup-nfc-agent.sh` は初回導入に使わない。先にstatus設定を置くと空端末の安全検証が拒否する。

```bash
scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --print-plan --limit raspi4-assembly-02 --first-install
scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --limit raspi4-assembly-02 --first-install
```

`release_kiosk` がstatus-agentとtimer、NFC等の有効なagent設定・container、IBus/Mozc・PC/SC、kiosk-browserとhotcornerを配置し、healthを確認する。Pi4上のGit cloneやChromium互換symlinkは不要で、インストール済みbrowserを解決する。次回からは `--first-install` を外す。Pi4以外はそれぞれの端末Runbookを使用する。

## Step 5: キオスク・NFCの確認

標準runのstatus/recapが成功したことを確認し、実画面で日本語入力と初期routeを確認する。NFCを使う端末はUSBリーダーを接続し、`http://localhost:7071/api/agent/status` の `readerConnected: true` と実際のカード読み取りを確認する。端末側の設定ファイルやunitを手動で置き換えない。

問題がある場合は [デプロイ停止・復旧Runbook](../runbooks/deploy-status-recovery.md) と [NFCリーダーのトラブルシューティング](../troubleshooting/nfc-reader-issues.md) を参照する。

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
   # Raspberry Pi 5で実行。対象を必ず明示する。
   scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml \
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
