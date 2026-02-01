---
title: MacからRaspberry Pi 5へのSSH接続ガイド
tags: [SSH, Mac, 開発環境, リモートアクセス]
audience: [開発者, 運用者]
last-verified: 2025-12-01
related: [ssh-setup.md, development.md, deployment.md]
category: guides
update-frequency: medium
---

# MacからRaspberry Pi 5へのSSH接続ガイド

最終更新: 2026-01-31（RealVNC経由のPi5アクセス手順を追加、fail2ban Ban対処手順を追加）

## 概要

本ドキュメントでは、MacからRaspberry Pi 5（サーバー）にSSH接続して、リモートで開発・運用作業を行う方法を説明します。

## 前提条件

- MacとRaspberry Pi 5が同じネットワークに接続されていること
- Raspberry Pi 5のIPアドレスが分かっていること
- Raspberry Pi 5でSSHサーバーが起動していること

---

## Step 1: SSH接続の基本設定

### 1.1 IPアドレスの確認

**Raspberry Pi 5で実行（または管理画面で確認）:**

```bash
# IPアドレスを確認
hostname -I

# 例: 192.168.128.131
```

### 1.2 MacからSSH接続のテスト

**Macのターミナルで実行:**

```bash
# SSH接続のテスト
ssh denkon5sd02@192.168.128.131

# 初回接続時は、ホスト鍵の確認を求められます
# Are you sure you want to continue connecting (yes/no)? yes
```

**期待される結果:**
- パスワード入力が求められる
- 接続後、Raspberry Pi 5のシェルが起動する

### 1.3 SSH鍵認証の設定（推奨）

**MacでSSH鍵を生成（初回のみ）:**

```bash
# SSH鍵が既に存在するか確認
ls -la ~/.ssh/id_ed25519.pub

# 存在しない場合、鍵を生成
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -N ""

# 公開鍵を表示
cat ~/.ssh/id_ed25519.pub
```

**Raspberry Pi 5に公開鍵を追加:**

**方法1: ssh-copy-idを使用（推奨）**

```bash
# Macのターミナルで実行
ssh-copy-id denkon5sd02@192.168.128.131
```

**方法2: 手動で追加**

```bash
# Macのターミナルで実行
# 公開鍵を表示
cat ~/.ssh/id_ed25519.pub

# Raspberry Pi 5に接続して公開鍵を追加
ssh denkon5sd02@192.168.128.131
mkdir -p ~/.ssh
chmod 700 ~/.ssh
echo "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA..." >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
exit
```

**接続テスト:**

```bash
# Macのターミナルで実行
# パスワードなしで接続できるか確認
ssh denkon5sd02@192.168.128.131
```

---

## Step 2: SSH設定ファイルの作成（オプション）

### 2.1 SSH設定ファイルの作成

**MacでSSH設定ファイルを編集:**

```bash
# SSH設定ファイルを編集
nano ~/.ssh/config
```

**設定内容:**

```
Host raspi5
    HostName 192.168.128.131
    User denkon5sd02
    IdentityFile ~/.ssh/id_ed25519
    ServerAliveInterval 60
    ServerAliveCountMax 3
```

**設定の説明:**
- `Host raspi5`: 接続時のエイリアス（`ssh raspi5`で接続可能）
- `HostName`: Raspberry Pi 5のIPアドレス
- `User`: ユーザー名
- `IdentityFile`: SSH鍵のパス
- `ServerAliveInterval`: 接続維持のためのパケット送信間隔（秒）
- `ServerAliveCountMax`: 接続維持に失敗した場合の最大試行回数

### 2.2 設定ファイルの権限設定

```bash
# SSH設定ファイルの権限を設定
chmod 600 ~/.ssh/config
```

### 2.3 接続テスト

```bash
# エイリアスで接続
ssh raspi5
```

---

## Step 3: よく使う操作

### 3.1 Git操作

**Macのターミナルで実行:**

```bash
# Raspberry Pi 5に接続してGit操作
ssh raspi5 "cd /opt/RaspberryPiSystem_002 && git pull origin main"

# または、接続してから実行
ssh raspi5
cd /opt/RaspberryPiSystem_002
git pull origin main
git status
exit
```

### 3.2 Docker Compose操作

**Macのターミナルで実行:**

```bash
# Dockerコンテナの状態確認
ssh raspi5 "cd /opt/RaspberryPiSystem_002 && docker compose -f infrastructure/docker/docker-compose.server.yml ps"

# Dockerコンテナの再起動
ssh raspi5 "cd /opt/RaspberryPiSystem_002 && docker compose -f infrastructure/docker/docker-compose.server.yml restart api"

# Dockerログの確認
ssh raspi5 "cd /opt/RaspberryPiSystem_002 && docker compose -f infrastructure/docker/docker-compose.server.yml logs api --tail=50"
```

### 3.3 ファイルのコピー（scp）

**Macのターミナルで実行:**

```bash
# MacからRaspberry Pi 5へファイルをコピー
scp /path/to/local/file.txt raspi5:/opt/RaspberryPiSystem_002/

# Raspberry Pi 5からMacへファイルをコピー
scp raspi5:/opt/RaspberryPiSystem_002/logs/ansible-update-*.log ~/Downloads/
```

### 3.4 リモートコマンドの実行

**Macのターミナルで実行:**

```bash
# 単一コマンドの実行
ssh raspi5 "systemctl status docker"

# 複数コマンドの実行
ssh raspi5 "cd /opt/RaspberryPiSystem_002 && git pull && docker compose -f infrastructure/docker/docker-compose.server.yml restart api"
```

---

## Step 4: 再起動後の接続確認

### 4.1 Raspberry Pi 5の再起動

**Raspberry Pi 5で実行:**

```bash
# 再起動
sudo reboot
```

### 4.2 Macから接続確認

**Macのターミナルで実行:**

```bash
# 再起動後、接続できるか確認
ssh raspi5

# 接続できない場合、IPアドレスが変わっている可能性がある
# Raspberry Pi 5のIPアドレスを確認（管理画面または直接確認）
ping -c 1 192.168.128.131
```

### 4.3 IPアドレスが変わった場合の対応

**SSH設定ファイルを更新:**

```bash
# SSH設定ファイルを編集
nano ~/.ssh/config

# HostNameを新しいIPアドレスに変更
```

**または、直接IPアドレスで接続:**

```bash
ssh denkon5sd02@<新しいIPアドレス>
```

---

## Step 5: 開発作業での活用

### 5.1 コードの更新とデプロイ

**Macのターミナルで実行:**

```bash
# 1. Macでコードを編集・コミット・プッシュ
cd /Users/tsudatakashi/RaspberryPiSystem_002
git add .
git commit -m "feat: 新機能の追加"
git push origin feature/new-feature

# 2. Raspberry Pi 5で最新コードを取得
ssh raspi5 "cd /opt/RaspberryPiSystem_002 && git pull origin feature/new-feature"

# 3. Dockerコンテナを再ビルド・再起動
ssh raspi5 "cd /opt/RaspberryPiSystem_002 && docker compose -f infrastructure/docker/docker-compose.server.yml up -d --build api"
```

### 5.2 ログの確認

**Macのターミナルで実行:**

```bash
# APIログを確認
ssh raspi5 "cd /opt/RaspberryPiSystem_002 && docker compose -f infrastructure/docker/docker-compose.server.yml logs api --tail=100"

# エラーログのみを確認
ssh raspi5 "cd /opt/RaspberryPiSystem_002 && docker compose -f infrastructure/docker/docker-compose.server.yml logs api | grep -i error"
```

### 5.3 データベース操作

**Macのターミナルで実行:**

```bash
# データベースに接続
ssh raspi5 "cd /opt/RaspberryPiSystem_002 && docker compose -f infrastructure/docker/docker-compose.server.yml exec db psql -U postgres -d borrow_return"

# データベースのバックアップ
ssh raspi5 "cd /opt/RaspberryPiSystem_002 && docker compose -f infrastructure/docker/docker-compose.server.yml exec db pg_dump -U postgres borrow_return > /tmp/backup.sql"
```

---

## トラブルシューティング

### SSH接続が失敗する場合

**確認事項:**
1. IPアドレスが正しいか
2. Raspberry Pi 5が起動しているか
3. SSHサーバーが起動しているか
4. ファイアウォール設定が正しいか
5. **fail2banによるBanが発生していないか**（[KB-218](../knowledge-base/infrastructure/ansible-deployment.md#kb-218-ssh接続失敗の原因fail2banによるip-ban存在しないユーザーでの認証試行)参照）

**解決方法:**
```bash
# Raspberry Pi 5のIPアドレスを確認
ping -c 1 192.168.128.131

# SSH接続をテスト
ssh -v denkon5sd02@192.168.128.131
```

### fail2banによるBanが発生した場合

**症状**:
- `ssh: connect to host 100.106.158.2 port 22: Connection refused`エラーが発生
- 管理コンソール（HTTPS）は正常にアクセス可能
- 正しいユーザー名（`denkon5sd02`）を使用しているにもかかわらず接続できない

**原因**:
- fail2banがSSH認証失敗を検知し、IPアドレスをBanしている
- 誤ったユーザー名（例: `tsudatakashi`）での認証試行が閾値（10分/5回）を超えた

**解決方法（RealVNC経由）**:

1. **RealVNCでPi5のデスクトップにアクセス**:
   ```bash
   # MacからRealVNC接続（Tailscale経由）
   # RealVNC Viewerで 100.106.158.2:5900 に接続
   ```

2. **Pi5のターミナルでfail2banのBanを確認**:
   ```bash
   sudo fail2ban-client status sshd
   # Banned IP list: 100.64.230.31 などが表示される
   ```

3. **Banを解除**:
   ```bash
   # MacのTailscale IPをBan解除（例: 100.64.230.31）
   sudo fail2ban-client set sshd unbanip 100.64.230.31
   
   # Ban解除の確認
   sudo fail2ban-client status sshd
   # Banned IP list: （空）であることを確認
   ```

4. **SSH接続を再試行**:
   ```bash
   # Macから実行
   ssh denkon5sd02@100.106.158.2
   ```

**再発防止**:
- SSH接続時は、正しいユーザー名（`denkon5sd02`）を使用する
- inventoryファイル（`infrastructure/ansible/inventory.yml`）で正しいユーザー名を確認する
- デプロイ標準手順（`docs/guides/deployment.md`）を参照する

### 接続が途中で切れる場合

**解決方法:**
- SSH設定ファイルに`ServerAliveInterval`と`ServerAliveCountMax`を追加（上記参照）

### パスワード認証が必要な場合

**解決方法:**
- SSH鍵認証を設定（Step 1.3を参照）

---

## RealVNC経由でのPi5アクセス（Tailscale経由）

### 概要

SSH接続が失敗した場合（fail2ban Banなど）、RealVNC経由でPi5のデスクトップにアクセスして復旧作業を行うことができます。

### 前提条件

- TailscaleがMacとPi5の両方で有効になっていること
- Pi5でRealVNC Serverが起動していること（ポート5900）
- RealVNC ViewerがMacにインストールされていること

### セットアップ手順

1. **RealVNC Viewerのインストール**:
   ```bash
   # Macで実行
   brew install --cask realvnc-viewer
   ```

2. **Pi5のTailscale IPアドレスを確認**:
   ```bash
   # Pi5で実行（または管理コンソールで確認）
   tailscale status
   # 例: 100.106.158.2
   ```

3. **RealVNC Viewerで接続**:
   - RealVNC Viewerを起動
   - 接続先: `100.106.158.2:5900`（Tailscale IP:ポート5900）
   - 認証情報を入力して接続

### セキュリティに関する注意事項

**⚠️ ポート5900のリスク評価**:

- **リスクレベル**: 中〜高
- **理由**:
  - Tailscaleネットワーク内からのみアクセス可能なため、インターネット直接公開よりは安全
  - ただし、Tailscaleアカウントが侵害された場合、5900経由でデスクトップアクセスが可能
  - RealVNCの認証が弱い場合、リスクが高まる

**推奨対策**:

1. **RealVNCの認証強化**:
   - 強力なパスワードを設定（MFAがあれば有効化）
   - VNC認証方式を確認（システム認証を使用）

2. **Tailscale ACLの設定**（推奨）:
   - Tailscale ACLで5900へのアクセスを特定IP/デバイスに制限
   - 例: MacのTailscale IPのみ許可

3. **SSH経由のポートフォワーディング**（代替案）:
   ```bash
   # Macから実行（SSH経由でポートフォワーディング）
   ssh -L 5900:localhost:5900 denkon5sd02@100.106.158.2
   # その後、RealVNC Viewerで localhost:5900 に接続
   ```

### よくある用途

- **fail2ban Ban解除**: SSH接続が失敗した場合、RealVNC経由でPi5にアクセスしてBanを解除
- **Git権限修正**: `.git`ディレクトリの所有権を修正
- **緊急時の復旧作業**: SSH接続ができない場合の代替アクセス手段

### トラブルシューティング

**RealVNC接続が失敗する場合**:

1. **Tailscale接続の確認**:
   ```bash
   # Macで実行
   tailscale status
   # Pi5が表示されていることを確認
   ```

2. **ポート5900の確認**:
   ```bash
   # Macで実行
   nc -vz -w 3 100.106.158.2 5900
   # Connection succeeded が表示されることを確認
   ```

3. **Pi5でRealVNC Serverの状態確認**:
   ```bash
   # Pi5で実行（RealVNC経由でアクセス後）
   sudo systemctl status vncserver-x11-serviced
   ```

---

## セキュリティに関する注意事項

### ⚠️ 重要な注意点

1. **SSH鍵の管理**: 秘密鍵（`~/.ssh/id_ed25519`）は絶対に他人に共有しない
2. **パスワード認証の無効化**: SSH鍵認証を設定した後、パスワード認証を無効化することを推奨
3. **ファイアウォール設定**: 必要に応じて、特定のIPアドレスからのみSSH接続を許可する

### パスワード認証の無効化（オプション）

**Raspberry Pi 5で実行:**

```bash
# SSH設定ファイルを編集
sudo nano /etc/ssh/sshd_config

# 以下の設定を変更
PasswordAuthentication no
PubkeyAuthentication yes

# SSHサーバーを再起動
sudo systemctl restart ssh
```

**注意**: SSH鍵認証が正しく動作することを確認してから実行してください。

---

## 関連ドキュメント

- [SSH鍵ベース運用ガイド](./ssh-setup.md): サーバーからクライアントへのSSH鍵設定
- [開発ガイド](./development.md): 開発環境のセットアップ
- [デプロイメントガイド](./deployment.md): デプロイメント手順
- [運用マニュアル](./operation-manual.md): 日常的な運用手順

