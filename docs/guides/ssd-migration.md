---
title: SDカードからSSDへの移行手順
tags: [運用, 移行, SSD, Raspberry Pi 5]
audience: [運用者, 開発者]
last-verified: 2025-11-27
related: [backup-and-restore.md, deployment.md]
category: guides
update-frequency: medium
---

# SDカードからSSDへの移行手順

最終更新: 2025-11-27

## 概要

本ドキュメントでは、Raspberry Pi 5をSDカードからSSDに移行する手順を説明します。

## 前提条件

- Raspberry Pi 5がSDカードで正常に動作していること
- 1TB以上のSSDが用意されていること
- USB接続またはNVMe接続でSSDを接続できること
- 最新のバックアップが取得済みであること

## 移行前の確認事項

### 1. 現在の状態確認

```bash
# ディスク使用状況の確認
df -h

# 現在のマウントポイントの確認
mount | grep -E "mmcblk|nvme|sda"

# バックアップファイルの確認
ls -lh /opt/backups/ | tail -5
```

### 2. 最終バックアップの取得

```bash
cd /opt/RaspberryPiSystem_002
./scripts/server/backup.sh
```

最新のバックアップファイルを確認：
- `db_backup_YYYYMMDD_HHMMSS.sql.gz`
- `photos_backup_YYYYMMDD_HHMMSS.tar.gz`
- `api_env_YYYYMMDD_HHMMSS.env`（存在する場合）

## 移行手順

### ステップ1: SSDの接続と認識確認

1. **SSDをRaspberry Pi 5に接続**
   - USB接続の場合: USBポートに接続
   - NVMe接続の場合: M.2スロットに接続

2. **SSDが認識されているか確認**

```bash
# 接続されているストレージデバイスを確認
lsblk

# または
sudo fdisk -l
```

SSDが `/dev/sda` または `/dev/nvme0n1` として表示されることを確認してください。

### ステップ2: Raspberry Pi OSのインストール

1. **Raspberry Pi Imagerを使用してSSDにOSをインストール**
   - Raspberry Pi OS (64-bit) を選択
   - SSHを有効化
   - ユーザー名とパスワードを設定
   - ホスト名を設定（例: `raspberrypi`）

2. **SSDから起動するように設定**
   - Raspberry Pi 5のブートローダーを更新（必要に応じて）

### ステップ3: システムのセットアップ

1. **SSDから起動してSSH接続**

```bash
# MacからSSH接続
ssh denkon5sd02@<raspberry-pi-5-ip>
```

2. **システムの更新**

```bash
sudo apt update
sudo apt upgrade -y
```

3. **必要なパッケージのインストール**

```bash
# DockerとDocker Composeのインストール
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER

# Gitのインストール
sudo apt install -y git

# Node.jsとpnpmのセットアップ
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pnpm

# PythonとPoetryのインストール（NFCエージェント用）
sudo apt install -y python3 python3-pip
curl -sSL https://install.python-poetry.org | python3 -
```

4. **ログアウトして再ログイン**（Dockerグループの変更を反映）

```bash
exit
# 再度SSH接続
```

### ステップ4: リポジトリのクローン

```bash
# リポジトリをクローン
cd /opt
sudo git clone https://github.com/denkoushi/RaspberryPiSystem_002.git
sudo chown -R $USER:$USER RaspberryPiSystem_002
cd RaspberryPiSystem_002
```

### ステップ5: 環境変数ファイルの設定

```bash
# API環境変数ファイルの作成
cp apps/api/.env.example apps/api/.env
nano apps/api/.env
# 必要な値を設定（JWT_SECRET、DATABASE_URL等）

# Web環境変数ファイルの作成（必要に応じて）
cp apps/web/.env.example apps/web/.env
nano apps/web/.env
# 必要な値を設定

# NFCエージェント環境変数ファイルの作成（必要に応じて）
cp clients/nfc-agent/.env.example clients/nfc-agent/.env
nano clients/nfc-agent/.env
# 必要な値を設定
```

**または、バックアップから環境変数ファイルを復元：**

```bash
# バックアップディレクトリを作成
mkdir -p /opt/backups

# バックアップファイルをSDカードからコピー（または別の方法で転送）
# 例: SDカードがまだマウントされている場合
# sudo mount /dev/mmcblk0p2 /mnt
# cp /mnt/opt/backups/api_env_YYYYMMDD_HHMMSS.env /opt/backups/
# sudo umount /mnt

# 環境変数ファイルを復元
cp /opt/backups/api_env_YYYYMMDD_HHMMSS.env apps/api/.env
```

### ステップ6: 依存関係のインストール

```bash
# pnpmの有効化
corepack enable

# 依存関係のインストール
pnpm install

# NFCエージェントの依存関係のインストール
cd clients/nfc-agent
poetry install
cd ../..
```

### ステップ7: データベースのセットアップ

```bash
# Docker Composeでデータベースを起動
docker compose -f infrastructure/docker/docker-compose.server.yml up -d db

# データベースが起動するまで待機
sleep 10

# Prismaマイグレーションの実行
cd apps/api
pnpm prisma migrate deploy
```

### ステップ8: データのリストア

```bash
# バックアップファイルをSSDにコピー（SDカードから、または別の方法で転送）
# 例: SDカードがまだマウントされている場合
# sudo mount /dev/mmcblk0p2 /mnt
# cp /mnt/opt/backups/db_backup_YYYYMMDD_HHMMSS.sql.gz /opt/backups/
# cp /mnt/opt/backups/photos_backup_YYYYMMDD_HHMMSS.tar.gz /opt/backups/
# sudo umount /mnt

# データベースのリストア
cd /opt/RaspberryPiSystem_002
./scripts/server/restore.sh /opt/backups/db_backup_YYYYMMDD_HHMMSS.sql.gz
# プロンプトで "yes" と入力

# 写真ディレクトリのリストア
mkdir -p storage/photos storage/thumbnails
tar -xzf /opt/backups/photos_backup_YYYYMMDD_HHMMSS.tar.gz -C storage/
```

### ステップ9: Dockerコンテナの起動

```bash
# すべてのコンテナを起動
docker compose -f infrastructure/docker/docker-compose.server.yml up -d

# コンテナの状態を確認
docker compose -f infrastructure/docker/docker-compose.server.yml ps
```

### ステップ10: 動作確認

```bash
# APIヘルスチェック
curl http://localhost:8080/api/system/health

# データベースのレコード数を確認
docker compose -f infrastructure/docker/docker-compose.server.yml exec db \
  psql -U postgres -d borrow_return \
  -c "SELECT COUNT(*) FROM \"Loan\";"

# 写真ファイルの確認
ls -lh storage/photos/*/ | tail -5
ls -lh storage/thumbnails/*/ | tail -5
```

### ステップ11: ブラウザでの動作確認

1. Raspberry Pi 4のブラウザで `http://<raspberry-pi-5-ip>:4173` にアクセス
2. ログイン画面が表示されることを確認
3. キオスク画面が正常に動作することを確認

## トラブルシューティング

### SSDが認識されない場合

```bash
# USB接続の場合
sudo dmesg | tail -20

# NVMe接続の場合
sudo lsblk | grep nvme
```

### データベースのリストアが失敗する場合

```bash
# データベースコンテナのログを確認
docker compose -f infrastructure/docker/docker-compose.server.yml logs db

# データベースを再作成
docker compose -f infrastructure/docker/docker-compose.server.yml exec db \
  psql -U postgres -c "DROP DATABASE IF EXISTS borrow_return;"
docker compose -f infrastructure/docker/docker-compose.server.yml exec db \
  psql -U postgres -c "CREATE DATABASE borrow_return;"
```

### Dockerコンテナが起動しない場合

```bash
# コンテナのログを確認
docker compose -f infrastructure/docker/docker-compose.server.yml logs

# コンテナを再ビルド
docker compose -f infrastructure/docker/docker-compose.server.yml up -d --build
```

## 再起動後の手順

開発中は手動でコンテナを起動することを推奨します（問題発生時の原因特定が容易なため）。

```bash
cd /opt/RaspberryPiSystem_002
docker compose -f infrastructure/docker/docker-compose.server.yml up -d
```

本番環境では、systemdサービスとして自動起動を設定することを推奨します。

## 移行後の確認事項

- [ ] データベースのレコード数が移行前と同じであること
- [ ] 写真ファイルが正しくリストアされていること
- [ ] APIが正常に動作していること
- [ ] Web UIが正常に動作していること
- [ ] キオスク画面が正常に動作していること
- [ ] バックアップスクリプトが正常に動作すること
- [ ] 再起動後も正常に動作すること

## 参考資料

- [バックアップ・リストア手順](./backup-and-restore.md)
- [デプロイメントガイド](./deployment.md)
- [監視・アラートガイド](./monitoring.md)

