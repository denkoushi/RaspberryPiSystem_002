---
title: デプロイメントガイド
tags: [デプロイ, 運用, ラズパイ5, Docker]
audience: [運用者, 開発者]
last-verified: 2025-12-13
related: [production-setup.md, backup-and-restore.md, monitoring.md, quick-start-deployment.md, environment-setup.md, ansible-ssh-architecture.md]
category: guides
update-frequency: medium
---

# デプロイメントガイド

最終更新: 2025-12-28（デプロイ前UI検証手順追加）

## 概要

本ドキュメントでは、Raspberry Pi 5上で動作するシステムのデプロイメント手順を説明します。

## 📖 このドキュメントを読む前に

- **初めてデプロイする場合**: まず [クイックスタートガイド](./quick-start-deployment.md) を読んでください
- **ネットワーク環境が変わった場合**: [環境構築ガイド](./environment-setup.md) を参照してください
- **SSH接続の仕組みを理解したい場合**: [Ansible SSH接続アーキテクチャの説明](./ansible-ssh-architecture.md) を参照してください

## ⚠️ 重要な原則

### デプロイ方法の使い分け

| 用途 | スクリプト | 実行場所 | ブランチ指定 |
|------|-----------|---------|------------|
| **開発時（Pi5のみ）** | `scripts/server/deploy.sh` | Pi5上で直接実行 | ✅ 可能（引数で指定） |
| **運用時（全デバイス）** | `scripts/update-all-clients.sh` | Macから実行 | ✅ 可能（引数で指定、デフォルトは`main`） |

**⚠️ 注意**: 
- Pi5のデプロイには`scripts/server/deploy.sh`を使用してください
- `scripts/update-all-clients.sh`はクライアント（Pi3/Pi4）の一括更新用ですが、Pi5も含めて更新します
- どちらのスクリプトもブランチを指定できますが、デフォルトは`main`ブランチです

## 🌐 ネットワーク環境の確認（デプロイ前必須）

**重要**: デプロイ前に、現在のネットワーク環境（オフィス/自宅）を確認し、Pi5上の`group_vars/all.yml`の`network_mode`を適切に設定してください。これがデプロイ成功の最重要ポイントです。

### ネットワークモードの選択

| ネットワーク環境 | network_mode | 使用IP | 用途 |
|----------------|-------------|--------|------|
| オフィス（ローカルネットワーク） | `local` | ローカルIP（192.168.x.x） | 同一ネットワーク内からのアクセス |
| 自宅/リモートアクセス | `tailscale` | Tailscale IP（100.x.x.x） | リモートアクセス、異なるネットワーク環境 |

### ネットワークモード設定の確認・変更

**1. 現在の設定を確認**:
```bash
# Pi5上のnetwork_modeを確認
ssh denkon5sd02@100.106.158.2 "grep '^network_mode:' /opt/RaspberryPiSystem_002/infrastructure/ansible/group_vars/all.yml"
```

**2. 設定を変更（必要に応じて）**:
```bash
# Tailscaleモードに変更（自宅ネットワーク/リモートアクセスの場合）
ssh denkon5sd02@100.106.158.2 "sed -i 's/network_mode: \"local\"/network_mode: \"tailscale\"/' /opt/RaspberryPiSystem_002/infrastructure/ansible/group_vars/all.yml"

# Localモードに変更（オフィスネットワークの場合）
ssh denkon5sd02@100.106.158.2 "sed -i 's/network_mode: \"tailscale\"/network_mode: \"local\"/' /opt/RaspberryPiSystem_002/infrastructure/ansible/group_vars/all.yml"
```

**3. 接続テスト**:
```bash
# Pi5からPi4への接続テスト（実際に使われるIPで）
ssh denkon5sd02@100.106.158.2 "cd /opt/RaspberryPiSystem_002 && ansible raspberrypi4 -i infrastructure/ansible/inventory.yml -m ping"
```

**⚠️ 注意**: 
- `network_mode`が`local`の場合、ローカルIPが使われます（`hostname -I`で取得した値を使用）
- `network_mode`が`tailscale`の場合、Tailscale IPが使われます（`tailscale status`で確認）
- 現在のネットワーク環境に応じた設定でないと、接続エラーが発生します
- ローカルIPは環境で変動するため、実際に`hostname -I`等で取得した値で`group_vars/all.yml`を書き換えること
- **重要**: Ansibleがリポジトリを更新する際に`git reset --hard`を実行するため、`group_vars/all.yml`の`network_mode`設定がデフォルト値（`local`）に戻る可能性があります。デプロイ前だけでなく、ヘルスチェック実行前にも必ず設定を再確認すること（[KB-094](../knowledge-base/infrastructure/backup-restore.md#kb-094-ansibleデプロイ時のgroup_varsallymlのnetwork_mode設定がリポジトリ更新で失われる問題)参照）

詳細は [環境構築ガイド](./environment-setup.md) を参照してください。

### 管理画面のIP制限（インターネット接続時）

- **Caddyでの制限**: `ADMIN_ALLOW_NETS` 環境変数（空白区切りCIDR、デフォルト: `192.168.10.0/24 192.168.128.0/24 100.64.0.0/10 127.0.0.1/32`）を設定すると、`/admin*` へのアクセスが許可ネットワークに限定されます。  
  - Docker Compose: `web.environment.ADMIN_ALLOW_NETS` を上書き。  
  - テスト: 許可IPから `curl -kI https://<pi5>/admin` が200/302、非許可IPは403/timeout。
- **Tailscale ACL推奨**: 併せて Tailscale ACL で管理画面のCIDRを信頼セグメントに限定してください（例: `100.64.0.0/10` のみ許可）。
- **HTTPS/ヘッダー確認**: `scripts/test/check-caddy-https-headers.sh` で HTTP→HTTPS リダイレクトと HSTS/Content-Type-Options/X-Frame-Options/Referrer-Policy をチェック可能。

## ラズパイ5（サーバー）の更新

### 初回セットアップ: 環境変数ファイルの作成

再起動後もIPアドレスが変わっても自動的に対応できるように、環境変数ファイルを作成します：

```bash
# ラズパイ5で実行
cd /opt/RaspberryPiSystem_002

# 環境変数ファイルのサンプルをコピー
cp infrastructure/docker/.env.example infrastructure/docker/.env
cp apps/api/.env.example apps/api/.env 2>/dev/null || true

# .envファイルを編集（必要に応じて）
nano infrastructure/docker/.env
nano apps/api/.env
```

**重要**: 
- `.env`ファイルはGitにコミットされません（`.gitignore`に含まれています）。各ラズパイで個別に設定してください。
- 本番環境では、強力なパスワードを設定してください（`POSTGRES_PASSWORD`など）。パスワード生成方法: `openssl rand -base64 32`
- ファイルのパーミッションを設定（所有者のみ読み書き可能）: `chmod 600 infrastructure/docker/.env apps/api/.env`

**環境変数の管理方法**:
- `.env.example`ファイル: リポジトリに含まれるテンプレートファイル
- 手動でコピー: `.env.example`をコピーして`.env`を作成し、本番環境用の値を設定
- Ansibleテンプレート: Ansibleを使用する場合、`.j2`テンプレートファイルから生成
- バックアップ: バックアップスクリプトで`.env`ファイルを自動バックアップ

詳細は [本番環境セットアップガイド](./production-setup.md#環境変数の管理) を参照してください。

### デプロイ前のUI検証（推奨）

**重要**: UI変更を行った場合は、デプロイ前にCursor内のブラウザで検証することで、デプロイ時間を短縮し、効率的にUI確認ができます。

詳細な手順は [開発ガイド](./development.md#ui検証デプロイ前推奨) を参照してください。

**簡易手順**:
1. ローカルでデータベースとAPIサーバー、Webアプリケーションを起動
2. Cursor内のブラウザで `http://localhost:5173` にアクセス
3. ログインしてUI変更を確認
4. 問題がなければデプロイを実行

### 方法1: デプロイスクリプトを使用（推奨）

```bash
# ラズパイ5で実行
cd /opt/RaspberryPiSystem_002

# mainブランチをデプロイ（デフォルト）
./scripts/server/deploy.sh

# 特定のブランチをデプロイ
./scripts/server/deploy.sh feature/new-feature
```

### 方法2: 手動で更新

```bash
# 1. リポジトリを更新
cd /opt/RaspberryPiSystem_002
git pull origin main

# 2. IPアドレスが変わった場合は.envファイルを更新
# （初回のみ）環境変数ファイルを作成
if [ ! -f infrastructure/docker/.env ]; then
  cp infrastructure/docker/.env.example infrastructure/docker/.env
  echo "⚠️  infrastructure/docker/.env ファイルを作成しました。IPアドレスを確認して編集してください。"
fi

# 3. Docker Composeで再ビルド・再起動（重要: --force-recreateでコンテナを再作成）
# Webコンテナを再ビルドする場合（IPアドレスが変わった場合など）
docker compose -f infrastructure/docker/docker-compose.server.yml up -d --force-recreate --build web

# APIコンテナのみを再ビルドする場合
docker compose -f infrastructure/docker/docker-compose.server.yml up -d --force-recreate --build api

# または、個別に実行する場合：
# docker compose -f infrastructure/docker/docker-compose.server.yml build --no-cache api
# docker compose -f infrastructure/docker/docker-compose.server.yml stop api
# docker compose -f infrastructure/docker/docker-compose.server.yml rm -f api
# docker compose -f infrastructure/docker/docker-compose.server.yml up -d api

# 4. 動作確認
curl http://localhost:8080/api/system/health
```

**重要**: 
- `docker compose restart`では新しいイメージが使われません。コードを変更したら、必ず`--force-recreate`オプションを使用してコンテナを再作成してください。
- `VITE_API_BASE_URL`は相対パス（`/api`）に設定されているため、再起動後もIPアドレスが変わっても問題ありません。
- `VITE_AGENT_WS_URL`は環境変数ファイル（`.env`）で管理できるため、IPアドレスが変わった場合は`.env`ファイルを更新してからWebコンテナを再ビルドしてください。

## ラズパイ4（クライアント/NFCエージェント）の更新

**重要**: Pi4デプロイ時にファイルが見つからないエラーや権限エラーが発生する場合は、[KB-095](../knowledge-base/infrastructure/backup-restore.md#kb-095-pi4デプロイ時のファイルが見つからないエラーと権限問題)を参照してください。

```bash
# 1. リポジトリを更新
cd /opt/RaspberryPiSystem_002
git pull origin main

# 2. NFCエージェントの依存関係を更新（必要に応じて）
cd clients/nfc-agent
poetry install

# 3. 既存のNFCエージェントプロセスを停止
# （実行中の場合は Ctrl+C で停止、または別のターミナルで）
pkill -f "python -m nfc_agent"

# 4. NFCエージェントを再起動
poetry run python -m nfc_agent

# 5. 動作確認
curl http://localhost:7071/api/agent/status
# "queueSize": 0 が表示されればOK
```

## ラズパイ3（サイネージ）の更新

**重要**: Pi3はメモリが少ない（1GB、実質416MB）ため、デプロイ前にサイネージサービスを停止する必要があります。

### デプロイ前の準備（必須）

**⚠️ 重要**: Pi3デプロイ時は、以下の手順を**必ず**実行してください。`systemctl disable`だけでは不十分で、`systemctl mask --runtime`も必要です（[KB-097](../knowledge-base/infrastructure/backup-restore.md#kb-097-pi3デプロイ時のsignage-liteサービス自動再起動の完全防止systemctl-maskの必要性)参照）。

```bash
# Pi5からPi3へSSH接続してサイネージサービスを停止・無効化・マスク（自動再起動を完全防止）
ssh denkon5sd02@100.106.158.2 "ssh signageras3@100.105.224.86 'sudo systemctl stop signage-lite.service signage-lite-update.timer status-agent.timer'"
ssh denkon5sd02@100.106.158.2 "ssh signageras3@100.105.224.86 'sudo systemctl disable signage-lite.service signage-lite-update.timer status-agent.timer'"
ssh denkon5sd02@100.106.158.2 "ssh signageras3@100.105.224.86 'sudo systemctl mask --runtime signage-lite.service'"

# sudo権限の前提
# signageras3は systemctl (signage-lite/status-agent) をパスワードなしで実行できること

# メモリ使用状況を確認（120MB以上空きがあることを確認）
ssh denkon5sd02@100.106.158.2 "ssh signageras3@100.105.224.86 'free -m'"

# プロセスが完全に停止していることを確認
ssh denkon5sd02@100.106.158.2 "ssh signageras3@100.105.224.86 'ps aux | grep signage-lite | grep -v grep'"
# → 何も表示されないことを確認

# Pi5上で既存のAnsibleプロセスをkill（重複実行防止）
ssh denkon5sd02@100.106.158.2 'pkill -9 -f ansible-playbook; pkill -9 -f AnsiballZ || true'
```

**重要**: 
- `systemctl disable`だけでは不十分です。`systemctl mask --runtime`も実行しないと、デプロイ中に`signage-lite.service`が自動再起動し、メモリ不足でデプロイがハングします（[KB-089](../knowledge-base/infrastructure/signage.md#kb-089-pi3デプロイ時のサイネージサービス自動再起動によるメモリ不足ハング)、[KB-097](../knowledge-base/infrastructure/backup-restore.md#kb-097-pi3デプロイ時のsignage-liteサービス自動再起動の完全防止systemctl-maskの必要性)参照）
- `status-agent.timer`も無効化対象に追加してください（[KB-097](../knowledge-base/infrastructure/backup-restore.md#kb-097-pi3デプロイ時のsignage-liteサービス自動再起動の完全防止systemctl-maskの必要性)参照）
- Pi3デプロイは10-15分以上かかる可能性があります。リポジトリが大幅に遅れている場合や、メモリ不足の場合はさらに時間がかかります（[KB-096](../knowledge-base/infrastructure/backup-restore.md#kb-096-pi3デプロイに時間がかかる問題リポジトリの遅れメモリ制約)参照）

### Ansibleを使用したデプロイ（推奨）

#### Macから全クライアントを一括更新

**⚠️ デプロイ前の必須チェック**:
1. [ネットワークモード設定の確認](#ネットワーク環境の確認デプロイ前必須)（最重要）
2. [デプロイ前チェックリスト](#デプロイ前チェック)の確認

```bash
# Macのターミナルで実行
cd /Users/tsudatakashi/RaspberryPiSystem_002

# 環境変数を設定（Pi5のTailscale IPを指定）
# 注意: ローカルIPはネットワーク環境によって変動するため、Tailscale IPを使用
export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"

# mainブランチで全デバイス（Pi5 + Pi3/Pi4）を更新（デフォルト）
./scripts/update-all-clients.sh main

# 特定のブランチで全デバイスを更新
./scripts/update-all-clients.sh feature/rigging-management
```

**重要**: 
- `scripts/update-all-clients.sh`はPi5も含めて更新します
- デフォルトは`main`ブランチです
- ブランチを指定する場合は引数として渡してください
- **スクリプト実行前に、Pi5上の`network_mode`設定が正しいことを確認してください**（スクリプトが自動チェックします）

**重要**: 
- `scripts/update-all-clients.sh`はPi5も含めて更新します
- デフォルトは`main`ブランチです
- ブランチを指定する場合は引数として渡してください

#### Pi5から特定のクライアントのみ更新

```bash
# Pi5から実行
cd /opt/RaspberryPiSystem_002/infrastructure/ansible

# Pi3へのデプロイを実行（mainブランチ、デフォルト）
ANSIBLE_ROLES_PATH=/opt/RaspberryPiSystem_002/infrastructure/ansible/roles \
  ansible-playbook -i inventory.yml playbooks/deploy.yml --limit raspberrypi3

# 特定のブランチでPi3を更新
ANSIBLE_REPO_VERSION=feature/rigging-management \
  ANSIBLE_ROLES_PATH=/opt/RaspberryPiSystem_002/infrastructure/ansible/roles \
  ansible-playbook -i inventory.yml playbooks/deploy.yml --limit raspberrypi3
```

### デプロイ後の確認

```bash
# デプロイが正常に完了したことを確認（PLAY RECAPでfailed=0）

# 注意: Ansibleが自動的にサービスを再有効化・再起動するため、手動操作は不要
# サービスが正常に動作していることを確認
ssh denkon5sd02@100.106.158.2 "ssh signageras3@100.105.224.86 'systemctl is-active signage-lite.service'"
# → active を確認（Ansibleが自動的に再有効化している）

# 画像が更新されていることを確認
ssh denkon5sd02@100.106.158.2 "ssh signageras3@100.105.224.86 'ls -lh /var/cache/signage/current.jpg'"
```

**重要**: 
- デプロイ完了後は、Ansibleが自動的に`signage-lite.service`と`signage-lite-update.timer`を再有効化・再起動します。手動で`systemctl enable`や`systemctl start`を実行する必要はありません（[KB-097](../knowledge-base/infrastructure/backup-restore.md#kb-097-pi3デプロイ時のsignage-liteサービス自動再起動の完全防止systemctl-maskの必要性)参照）

**トラブルシューティング**:
- **デプロイがハングする**: サイネージサービスが停止・無効化されているか確認。メモリ使用状況を確認（120MB以上空きが必要）。Pi3デプロイは10-15分かかる可能性があるため、プロセスをkillせずに完了を待つ（[KB-096](../knowledge-base/infrastructure/backup-restore.md#kb-096-pi3デプロイに時間がかかる問題リポジトリの遅れメモリ制約)参照）
- **複数のAnsibleプロセスが実行されている**: 全てのプロセスをkillしてから再実行
- **デプロイが失敗する**: ログを確認（`logs/deploy/deploy-*.jsonl`）
- **Pi4でファイルが見つからないエラー**: リポジトリが古い、または権限問題の可能性があります（[KB-095](../knowledge-base/infrastructure/backup-restore.md#kb-095-pi4デプロイ時のファイルが見つからないエラーと権限問題)参照）

**関連ナレッジ**: 
- [KB-086](../knowledge-base/infrastructure/signage.md#kb-086-pi3サイネージデプロイ時のsystemdタスクハング問題): Pi3デプロイ時のsystemdタスクハング問題
- [KB-089](../knowledge-base/infrastructure/signage.md#kb-089-pi3デプロイ時のサイネージサービス自動再起動によるメモリ不足ハング): サイネージサービス自動再起動によるメモリ不足ハング
- [KB-096](../knowledge-base/infrastructure/backup-restore.md#kb-096-pi3デプロイに時間がかかる問題リポジトリの遅れメモリ制約): Pi3デプロイに時間がかかる問題
- [KB-097](../knowledge-base/infrastructure/backup-restore.md#kb-097-pi3デプロイ時のsignage-liteサービス自動再起動の完全防止systemctl-maskの必要性): Pi3デプロイ時のsignage-liteサービス自動再起動の完全防止（systemctl maskの必要性）

## デプロイ方法（詳細）

### 2. デプロイスクリプトの動作

デプロイスクリプト（`scripts/server/deploy.sh`）は以下の処理を実行します：

1. **Gitリポジトリの更新**: 指定されたブランチをチェックアウトし、最新の変更を取得
2. **依存関係のインストール**: `pnpm install`を実行
3. **共有型パッケージのビルド**: `packages/shared-types`をビルド
4. **Prisma Client生成**: `pnpm prisma generate`を実行（スキーマ変更時に必要、共有型ビルド後）
5. **APIのビルド**: `apps/api`をビルド
6. **Dockerコンテナの再ビルド・再起動**: `docker compose up -d --build`を実行
7. **データベースマイグレーション**: Prismaマイグレーションを実行
8. **ヘルスチェック**: APIが正常に起動しているか確認

### 3. 自動デプロイ（cron）

cronを使用して定期的にデプロイを実行できます。

```bash
# crontabを編集
sudo crontab -e

# 毎日午前3時にmainブランチをデプロイ
0 3 * * * /opt/RaspberryPiSystem_002/scripts/server/deploy.sh >> /var/log/deploy.log 2>&1
```

### 4. Git Hookを使用した自動デプロイ

GitHubのWebhookを使用して自動デプロイを設定することもできます（要追加実装）。

## CI/CDパイプライン

### GitHub Actions

`.github/workflows/ci.yml`でCIパイプラインを定義しています。

#### 実行タイミング

- `main`または`develop`ブランチへのプッシュ
- `main`または`develop`ブランチへのプルリクエスト

#### 実行内容

1. **lint-and-testジョブ**:
   - コードのチェックアウト
   - Node.js 20のセットアップ
   - 依存関係のインストール
   - 共有型パッケージのビルド
   - APIのビルド
   - APIのテスト実行
   - Webのビルド

2. **docker-buildジョブ**:
   - API Dockerイメージのビルド
   - Web Dockerイメージのビルド

### ローカルでのCI実行

GitHub Actionsと同じ環境でローカルでテストを実行：

```bash
# 依存関係のインストール
pnpm install

# 共有型パッケージのビルド
cd packages/shared-types && pnpm build && cd ../..

# APIのビルド
cd apps/api && pnpm build && cd ../..

# APIのテスト実行
cd apps/api && pnpm test && cd ../..

# Webのビルド
cd apps/web && pnpm build && cd ../..
```

## ラズパイ5のIPアドレス確認と設定

**⚠️ 注意**: このセクションは、`group_vars/all.yml`の`network_mode`設定を使用しない場合の手動設定方法です。通常は、[ネットワークモード設定](#ネットワーク環境の確認デプロイ前必須)を使用することを推奨します。

再起動後はIPアドレスが変わる可能性があるため、以下の手順で確認・更新してください。

### 1. ラズパイ5のIPアドレスを確認

```bash
# ラズパイ5で実行
hostname -I
# ローカルIP: 192.168.x.x（ネットワーク環境によって変動）
# Tailscale IP: 100.106.158.2（固定、推奨）
```

### 2. docker-compose.server.ymlのIPアドレスを更新

**⚠️ 非推奨**: 通常は、`group_vars/all.yml`の`network_mode`設定を使用してください。

```bash
# ラズパイ5で実行
cd /opt/RaspberryPiSystem_002
nano infrastructure/docker/docker-compose.server.yml
```

`web`サービスの`args`セクションで、`VITE_API_BASE_URL`のIPアドレスを更新：

```yaml
web:
  build:
    args:
      VITE_AGENT_WS_URL: ws://100.74.144.79:7071/stream  # Pi4のTailscale IP（推奨）
      VITE_API_BASE_URL: http://100.106.158.2:8080/api   # Pi5のTailscale IP（推奨）
```

### 3. Webコンテナを再ビルド・再起動

```bash
# ラズパイ5で実行
docker compose -f infrastructure/docker/docker-compose.server.yml up -d --force-recreate --build web
```

**注意**: IPアドレスが変わった場合は、必ずWebコンテナを再ビルドする必要があります。ビルド時に`VITE_API_BASE_URL`が設定されるため、再起動だけでは不十分です。

## デプロイ前の確認事項

1. **バックアップの取得**: デプロイ前にデータベースのバックアップを取得
   ```bash
   ./scripts/server/backup.sh
   ```

2. **変更内容の確認**: デプロイするブランチの変更内容を確認
   ```bash
   git log origin/main..HEAD
   ```

3. **テストの実行**: ローカルでテストを実行して問題がないか確認
   ```bash
   cd apps/api && pnpm test
   ```

## ロールバック手順

デプロイ後に問題が発生した場合のロールバック手順：

```bash
# 1. 前のバージョンに戻す
cd /opt/RaspberryPiSystem_002
git checkout <前のコミットハッシュ>
./scripts/server/deploy.sh

# 2. データベースをリストア（必要に応じて）
./scripts/server/restore.sh /opt/backups/db_backup_YYYYMMDD_HHMMSS.sql.gz
```

## トラブルシューティング

### デプロイが失敗する

1. **ログを確認**:
   ```bash
   docker compose -f infrastructure/docker/docker-compose.server.yml logs api
   ```

2. **Dockerコンテナの状態を確認**:
   ```bash
   docker compose -f infrastructure/docker/docker-compose.server.yml ps
   ```

3. **手動でビルドを実行**:
   ```bash
   cd /opt/RaspberryPiSystem_002
   pnpm install
   cd packages/shared-types && pnpm build && cd ../..
   cd apps/api && pnpm build && cd ../..
   ```

### ヘルスチェックが失敗する

1. **APIコンテナが起動しているか確認**:
   ```bash
   docker compose -f infrastructure/docker/docker-compose.server.yml ps api
   ```

2. **APIログを確認**:
   ```bash
   docker compose -f infrastructure/docker/docker-compose.server.yml logs api | tail -50
   ```

3. **データベース接続を確認**:
   ```bash
   docker compose -f infrastructure/docker/docker-compose.server.yml exec db \
     psql -U postgres -d borrow_return -c "SELECT 1;"
   ```

### マイグレーションが失敗する

1. **マイグレーション状態を確認**:
   ```bash
   docker compose -f infrastructure/docker/docker-compose.server.yml exec api \
     pnpm prisma migrate status
   ```

2. **手動でマイグレーションを実行**:
   ```bash
   docker compose -f infrastructure/docker/docker-compose.server.yml exec api \
     pnpm prisma migrate deploy
   ```

## 統合デプロイモジュール（deploy-all.sh）

### 概要

`scripts/deploy/deploy-all.sh`は変更検知→影響分析→デプロイ実行→検証を自動化する統合スクリプトです。

### 使用方法

```bash
# Pi5で実行
cd /opt/RaspberryPiSystem_002

# ドライラン（変更検知のみ、実行なし）
NETWORK_MODE=tailscale bash scripts/deploy/deploy-all.sh --dry-run

# 本番実行（変更があれば自動デプロイ＋検証）
NETWORK_MODE=tailscale \
  DEPLOY_EXECUTOR_ENABLE=1 \
  DEPLOY_VERIFIER_ENABLE=1 \
  ROLLBACK_ON_FAIL=1 \
  bash scripts/deploy/deploy-all.sh
```

### 環境変数

| 変数 | 説明 | デフォルト |
|------|------|-----------|
| `NETWORK_MODE` | `local` または `tailscale` | `local` |
| `DEPLOY_EXECUTOR_ENABLE` | デプロイ実行を有効化 | `0` |
| `DEPLOY_VERIFIER_ENABLE` | 検証を有効化 | `0` |
| `ROLLBACK_ON_FAIL` | 失敗時ロールバック | `0` |

### 検証項目

`infrastructure/ansible/verification-map.yml`で定義。詳細は[deployment-modules.md](../architecture/deployment-modules.md)を参照。

## 運用チェックリスト

### デプロイ前チェック（必須）

**⚠️ これらのチェックを実行してからデプロイを開始してください**

1. **ネットワークモード設定の確認**（最重要）
   ```bash
   # Pi5上のnetwork_modeを確認
   ssh denkon5sd02@100.106.158.2 "grep '^network_mode:' /opt/RaspberryPiSystem_002/infrastructure/ansible/group_vars/all.yml"
   ```
   - `network_mode: "local"` → オフィスネットワーク用
   - `network_mode: "tailscale"` → 自宅ネットワーク/リモートアクセス用
   - **現在のネットワーク環境に応じて設定を変更**（[ネットワークモード設定](#ネットワーク環境の確認デプロイ前必須)を参照）
   - **重要**: Ansibleがリポジトリを更新する際に設定がデフォルト値に戻る可能性があります（[KB-094](../knowledge-base/infrastructure/backup-restore.md#kb-094-ansibleデプロイ時のgroup_varsallymlのnetwork_mode設定がリポジトリ更新で失われる問題)参照）。デプロイ後のヘルスチェック前にも再確認すること。

2. **Pi5への接続確認**
   ```bash
   # Tailscale IPで接続確認（推奨）
   ping -c 1 100.106.158.2
   ssh denkon5sd02@100.106.158.2 'echo "Connected"'
   ```

3. **接続テスト**
   ```bash
   # Pi5からPi4/Pi3への接続テスト（実際に使われるIPで）
   ssh denkon5sd02@100.106.158.2 "cd /opt/RaspberryPiSystem_002 && ansible all -i infrastructure/ansible/inventory.yml -m ping"
   ```
   - すべてのホストで`SUCCESS`が表示されることを確認
   - `UNREACHABLE`が表示される場合は、`network_mode`設定を確認

4. **既存Ansibleプロセスの確認**
   ```bash
   # Pi5上で既存のAnsibleプロセスをkill（重複実行防止）
   ssh denkon5sd02@100.106.158.2 'pkill -9 -f ansible-playbook; pkill -9 -f AnsiballZ || true'
   ```

5. **メモリ空き確認**
   ```bash
   # Pi5のメモリ確認（2GB以上推奨）
   ssh denkon5sd02@100.106.158.2 'free -m'
   
   # Pi3のメモリ確認（120MB以上必要）
   ssh denkon5sd02@100.106.158.2 'ssh signageras3@100.105.224.86 "free -m"'
   ```

6. **Pi3サイネージサービスの停止**（Pi3デプロイ時のみ必須）
   ```bash
   # Pi5からPi3へSSH接続してサイネージサービスを停止・無効化・マスク（自動再起動を完全防止）
   ssh denkon5sd02@100.106.158.2 'ssh signageras3@100.105.224.86 "sudo systemctl stop signage-lite.service signage-lite-update.timer status-agent.timer && sudo systemctl disable signage-lite.service signage-lite-update.timer status-agent.timer && sudo systemctl mask --runtime signage-lite.service"'
   
   # プロセスが完全に停止していることを確認
   ssh denkon5sd02@100.106.158.2 'ssh signageras3@100.105.224.86 "ps aux | grep signage-lite | grep -v grep"'
   # → 何も表示されないことを確認
   ```
   - **重要**: `systemctl disable`だけでは不十分です。`systemctl mask --runtime`も実行しないと、デプロイ中に自動再起動し、メモリ不足でデプロイがハングします（[KB-089](../knowledge-base/infrastructure/signage.md#kb-089-pi3デプロイ時のサイネージサービス自動再起動によるメモリ不足ハング)、[KB-097](../knowledge-base/infrastructure/backup-restore.md#kb-097-pi3デプロイ時のsignage-liteサービス自動再起動の完全防止systemctl-maskの必要性)参照）
   - **重要**: `status-agent.timer`も無効化対象に追加してください（[KB-097](../knowledge-base/infrastructure/backup-restore.md#kb-097-pi3デプロイ時のsignage-liteサービス自動再起動の完全防止systemctl-maskの必要性)参照）
   - **注意**: Pi3デプロイは10-15分以上かかる可能性があります。リポジトリが大幅に遅れている場合はさらに時間がかかります（[KB-096](../knowledge-base/infrastructure/backup-restore.md#kb-096-pi3デプロイに時間がかかる問題リポジトリの遅れメモリ制約)参照）
7. **ローカルIPを使う場合の事前確認**
   ```bash
   # 各端末で実IPを取得してからgroup_vars/all.ymlを更新する
   ssh denkon5sd02@100.106.158.2 "hostname -I"
   ssh denkon5sd02@100.106.158.2 "ssh tools03@100.74.144.79 'hostname -I'"    # Pi4例（tailscale経由）
   ssh denkon5sd02@100.106.158.2 "ssh signageras3@100.105.224.86 'hostname -I'" # Pi3例（tailscale経由）
   ```
   - ローカルIPは変動するため、例のアドレス（192.168.x.x）はそのまま使わず、取得した値で`group_vars/all.yml`を更新する

### デプロイ後確認

1. **サーバーAPIヘルスチェック**
   ```bash
   curl http://100.106.158.2:8080/api/system/health
   # → 200 OK を確認
   ```

2. **キオスク用API確認**
   ```bash
   curl -H 'x-client-key: client-key-raspberrypi4-kiosk1' http://100.106.158.2:8080/api/tools/loans/active
   # → 200 OK を確認
   ```

3. **サイネージ用API確認**
   ```bash
   curl http://100.106.158.2:8080/api/signage/content
   # → 200 OK を確認
   ```

4. **Pi4 systemdサービス確認**
   ```bash
   ssh denkon5sd02@100.106.158.2 'ssh tools03@100.74.144.79 "systemctl is-active kiosk-browser.service status-agent.timer"'
   # → active を確認
   ```

5. **Pi3サイネージサービスの確認**（デプロイ前に停止した場合）
   ```bash
   # 注意: Ansibleが自動的にサービスを再有効化・再起動するため、手動操作は不要
   # サービスが正常に動作していることを確認
   ssh denkon5sd02@100.106.158.2 'ssh signageras3@100.105.224.86 "systemctl is-active signage-lite.service"'
   # → active を確認（Ansibleが自動的に再有効化している）
   
   # 画像が更新されていることを確認
   ssh denkon5sd02@100.106.158.2 'ssh signageras3@100.105.224.86 "ls -lh /var/cache/signage/current.jpg"'
   ```
   - **重要**: デプロイ完了後は、Ansibleが自動的に`signage-lite.service`と`signage-lite-update.timer`を再有効化・再起動します。手動で`systemctl enable`や`systemctl start`を実行する必要はありません（[KB-097](../knowledge-base/infrastructure/backup-restore.md#kb-097-pi3デプロイ時のsignage-liteサービス自動再起動の完全防止systemctl-maskの必要性)参照）

### Tailscale IP一覧

| デバイス | Tailscale IP | ユーザー |
|----------|--------------|----------|
| Pi5 (サーバー) | 100.106.158.2 | denkon5sd02 |
| Pi4 (キオスク) | 100.74.144.79 | tools03 |
| Pi3 (サイネージ) | 100.105.224.86 | signageras3 |

## Phase 9 セキュリティ強化機能の実機テスト

### 1. HTTPS/ヘッダー確認テスト

```bash
# Pi5上で実行（またはMacから）
export TARGET_HOST="100.106.158.2"
bash /opt/RaspberryPiSystem_002/scripts/test/check-caddy-https-headers.sh
```

**期待される結果**:
- HTTPアクセスが301/302/308でHTTPSへリダイレクトされる
- HTTPSレスポンスに以下のヘッダーが含まれる:
  - `Strict-Transport-Security`
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options`
  - `Referrer-Policy`

### 2. 管理画面IP制限テスト

```bash
# 許可IPからのアクセス確認（Tailscale経由）
curl -kI https://100.106.158.2/admin
# → 200または302が返ることを確認

# 非許可IPからのアクセス確認（ADMIN_ALLOW_NETSを一時的に変更してテスト）
# docker-compose.server.ymlのADMIN_ALLOW_NETSを変更してwebコンテナを再起動
# → 403が返ることを確認
```

### 3. アラート外部通知テスト

```bash
# Pi5上で実行
# Webhook URLを設定（例: Slack Incoming Webhook）
export WEBHOOK_URL="https://hooks.slack.com/services/YOUR/WEBHOOK/URL"

# 擬似Banでアラート生成
sudo fail2ban-client set sshd banip 203.0.113.50
# → WebhookにPOSTされることを確認（Slackでメッセージが表示される）

# クリーンアップ
sudo fail2ban-client set sshd unbanip 203.0.113.50
```

### 4. オフラインバックアップ実機検証テスト

```bash
# Pi5上で実行
# USB/HDDをマウント（例: /mnt/backup-usb）
sudo mount /dev/sda1 /mnt/backup-usb

# バックアップ作成
export BACKUP_ENCRYPTION_KEY="your-gpg-key-id"
export BACKUP_OFFLINE_MOUNT="/mnt/backup-usb"
bash /opt/RaspberryPiSystem_002/scripts/server/backup-encrypted.sh

# 検証スクリプト実行
export BACKUP_OFFLINE_MOUNT="/mnt/backup-usb"
export BACKUP_DECRYPTION_KEY="your-gpg-key-id"
bash /opt/RaspberryPiSystem_002/scripts/test/backup-offline-verify.sh
# → 検証用DBにリストアされ、Loan件数が確認できることを確認

# クリーンアップ（検証用DB削除）
docker compose -f /opt/RaspberryPiSystem_002/infrastructure/docker/docker-compose.server.yml exec -T db psql -U postgres -c "DROP DATABASE IF EXISTS borrow_return_restore_test;"
```

### 5. セキュリティE2Eテスト

```bash
# Pi5上で実行（またはMacから）
export TARGET_HOST="100.106.158.2"
export ADMIN_URL="https://100.106.158.2/admin"
export ADMIN_EXPECT_STATUS="200"  # または403（IP制限が有効な場合）
bash /opt/RaspberryPiSystem_002/scripts/test/security-e2e.sh
```

**期待される結果**:
- HTTPS/ヘッダー確認が成功する
- 管理画面アクセス確認が期待ステータスと一致する

詳細なテスト手順は [セキュリティ強化 ExecPlan](../plans/security-hardening-execplan.md#phase-9-インターネット接続時の追加防御テスト) を参照してください。

## ベストプラクティス

1. **デプロイ前のバックアップ**: 必ずデプロイ前にバックアップを取得
2. **ネットワークモード設定の確認**: デプロイ前に必ず`network_mode`設定を確認・修正
3. **段階的なデプロイ**: まず開発環境でテストしてから本番環境にデプロイ
4. **ロールバック計画**: 問題発生時のロールバック手順を事前に準備
5. **監視**: デプロイ後は監視スクリプトでシステムの状態を確認
6. **ドキュメント更新**: デプロイ手順に変更があった場合はドキュメントを更新
7. **Tailscale使用**: リモートアクセス時は必ず`network_mode: "tailscale"`に設定

## よくある質問（FAQ）

### Q1: 環境変数ファイルはリモートリポジトリに含まれないのに、どうやって管理する？

**A**: 以下の方法で管理します：

1. **`.env.example`ファイル**: リポジトリに含まれるテンプレートファイル
2. **手動でコピー**: `.env.example`をコピーして`.env`を作成し、本番環境用の値を設定
3. **Ansibleテンプレート**: Ansibleを使用する場合、`.j2`テンプレートファイルから生成
4. **バックアップ**: バックアップスクリプトで`.env`ファイルを自動バックアップ

詳細は [本番環境セットアップガイド](./production-setup.md#環境変数の管理) を参照してください。

### Q2: 環境変数を変更した後、どうやって反映させる？

**A**: Docker Composeを再起動します：

```bash
cd /opt/RaspberryPiSystem_002
docker compose -f infrastructure/docker/docker-compose.server.yml down
docker compose -f infrastructure/docker/docker-compose.server.yml up -d
```

### Q3: パスワードを忘れた場合、どうすれば良い？

**A**: バックアップから復元します：

```bash
# バックアップディレクトリから環境変数ファイルを確認
ls -la /opt/backups/*.env

# 最新のバックアップから復元
cp /opt/backups/api_env_YYYYMMDD_HHMMSS.env /opt/RaspberryPiSystem_002/apps/api/.env
cp /opt/backups/docker_env_YYYYMMDD_HHMMSS.env /opt/RaspberryPiSystem_002/infrastructure/docker/.env

# Docker Composeを再起動
docker compose -f infrastructure/docker/docker-compose.server.yml down
docker compose -f infrastructure/docker/docker-compose.server.yml up -d
```

詳細は [バックアップ・リストアガイド](./backup-and-restore.md) を参照してください。

## 関連ドキュメント

- [クイックスタートガイド](./quick-start-deployment.md): 一括更新とクライアント監視のクイックスタート
- [環境構築ガイド](./environment-setup.md): ローカルネットワーク変更時の対応
- [Ansible SSH接続アーキテクチャの説明](./ansible-ssh-architecture.md): SSH接続の構成と説明
- [本番環境セットアップガイド](./production-setup.md): 本番環境の初期セットアップ（環境変数の管理、新しいPi5での環境構築手順を含む）
- [バックアップ・リストアガイド](./backup-and-restore.md): バックアップとリストアの手順（デバイスごとのバックアップ対象を含む）
- [監視・アラートガイド](./monitoring.md): システム監視とアラート設定

