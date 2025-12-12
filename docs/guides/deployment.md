---
title: デプロイメントガイド
tags: [デプロイ, 運用, ラズパイ5, Docker]
audience: [運用者, 開発者]
last-verified: 2025-11-27
related: [production-setup.md, backup-and-restore.md, monitoring.md]
category: guides
update-frequency: medium
---

# デプロイメントガイド

最終更新: 2025-12-12

## 概要

本ドキュメントでは、Raspberry Pi 5上で動作するシステムのデプロイメント手順を説明します。

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

## ラズパイ5（サーバー）の更新

### 初回セットアップ: 環境変数ファイルの作成

再起動後もIPアドレスが変わっても自動的に対応できるように、環境変数ファイルを作成します：

```bash
# ラズパイ5で実行
cd /opt/RaspberryPiSystem_002

# 環境変数ファイルのサンプルをコピー
cp infrastructure/docker/.env.example infrastructure/docker/.env

# IPアドレスを確認して設定
# ラズパイ4のIPアドレスを確認
ping -c 1 192.168.10.223  # または実際のIPアドレス

# .envファイルを編集（必要に応じて）
nano infrastructure/docker/.env
```

**重要**: `.env`ファイルはGitにコミットされません（`.gitignore`に含まれています）。各ラズパイで個別に設定してください。

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

```bash
# Pi5からPi3へSSH接続してサイネージサービスを停止・無効化（自動再起動を防止）
ssh signageras3@<pi3_ip> 'sudo systemctl stop signage-lite.service signage-lite-update.timer'
ssh signageras3@<pi3_ip> 'sudo systemctl disable signage-lite.service signage-lite-update.timer'

# sudo権限の前提
# signageras3は systemctl (signage-lite/status-agent) をパスワードなしで実行できること

# メモリ使用状況を確認（120MB以上空きがあることを確認）
ssh signageras3@<pi3_ip> 'free -m'

# Pi5上で既存のAnsibleプロセスをkill（重複実行防止）
ssh denkon5sd02@<pi5_ip> 'pkill -9 -f ansible-playbook; pkill -9 -f AnsiballZ'
```

**重要**: `systemctl disable`を実行しないと、デプロイ中に`signage-lite-update.timer`がサイネージサービスを自動再起動し、メモリ不足でデプロイがハングします（[KB-089](../knowledge-base/infrastructure.md#kb-089-pi3デプロイ時のサイネージサービス自動再起動によるメモリ不足ハング)参照）。

### Ansibleを使用したデプロイ（推奨）

#### Macから全クライアントを一括更新

```bash
# Macのターミナルで実行
cd /Users/tsudatakashi/RaspberryPiSystem_002

# 環境変数を設定（Pi5のIPアドレスを指定）
export RASPI_SERVER_HOST="denkon5sd02@192.168.10.230"

# mainブランチで全デバイス（Pi5 + Pi3/Pi4）を更新（デフォルト）
./scripts/update-all-clients.sh

# 特定のブランチで全デバイスを更新
./scripts/update-all-clients.sh feature/rigging-management
```

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

# サイネージサービスを再有効化・再起動
ssh signageras3@<pi3_ip> 'sudo systemctl enable signage-lite.service signage-lite-update.timer'
ssh signageras3@<pi3_ip> 'sudo systemctl start signage-lite.service signage-lite-update.timer'

# サービスが正常に動作していることを確認
ssh signageras3@<pi3_ip> 'systemctl is-active signage-lite.service'

# 画像が更新されていることを確認
ssh signageras3@<pi3_ip> 'ls -lh /var/cache/signage/current.jpg'
```

**トラブルシューティング**:
- **デプロイがハングする**: サイネージサービスが停止・無効化されているか確認。メモリ使用状況を確認（120MB以上空きが必要）。Pi3デプロイは10-15分かかる可能性があるため、プロセスをkillせずに完了を待つ
- **複数のAnsibleプロセスが実行されている**: 全てのプロセスをkillしてから再実行
- **デプロイが失敗する**: ログを確認（`logs/deploy/deploy-*.jsonl`）

**関連ナレッジ**: 
- [KB-086](../knowledge-base/infrastructure.md#kb-086-pi3サイネージデプロイ時のsystemdタスクハング問題): Pi3デプロイ時のsystemdタスクハング問題
- [KB-089](../knowledge-base/infrastructure.md#kb-089-pi3デプロイ時のサイネージサービス自動再起動によるメモリ不足ハング): サイネージサービス自動再起動によるメモリ不足ハング

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

再起動後はIPアドレスが変わる可能性があるため、以下の手順で確認・更新してください。

### 1. ラズパイ5のIPアドレスを確認

```bash
# ラズパイ5で実行
hostname -I
# 例: 192.168.10.230
```

### 2. docker-compose.server.ymlのIPアドレスを更新

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
      VITE_AGENT_WS_URL: ws://192.168.10.223:7071/stream  # ラズパイ4のIP
      VITE_API_BASE_URL: http://192.168.10.230:8080/api   # ラズパイ5のIP（更新）
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

### デプロイ前チェック

- [ ] Pi5への接続確認（`ping 100.106.158.2` または `ssh denkon5sd02@<ip>`）
- [ ] 既存Ansibleプロセスなし（`pgrep -a ansible`）
- [ ] メモリ空き確認（Pi5: 2GB以上、Pi3: 120MB以上）
- [ ] Pi3サイネージサービス停止（メモリ確保のため）

### デプロイ後確認

- [ ] サーバーAPIヘルス: `curl http://<server_ip>:8080/api/system/health` → 200
- [ ] キオスク用API: `curl -H 'x-client-key: client-key-raspberrypi4-kiosk1' http://<server_ip>:8080/api/tools/loans/active` → 200
- [ ] サイネージ用API: `curl http://<server_ip>:8080/api/signage/content` → 200
- [ ] Pi4 systemd: `kiosk-browser.service`, `status-agent.timer` → active
- [ ] Pi3 systemd: `signage-lite.service`, `status-agent.timer` → active

### Tailscale IP一覧

| デバイス | Tailscale IP | ユーザー |
|----------|--------------|----------|
| Pi5 (サーバー) | 100.106.158.2 | denkon5sd02 |
| Pi4 (キオスク) | 100.74.144.79 | tools03 |
| Pi3 (サイネージ) | 100.105.224.86 | signageras3 |

## ベストプラクティス

1. **デプロイ前のバックアップ**: 必ずデプロイ前にバックアップを取得
2. **段階的なデプロイ**: まず開発環境でテストしてから本番環境にデプロイ
3. **ロールバック計画**: 問題発生時のロールバック手順を事前に準備
4. **監視**: デプロイ後は監視スクリプトでシステムの状態を確認
5. **ドキュメント更新**: デプロイ手順に変更があった場合はドキュメントを更新
6. **Tailscale使用**: リモートアクセス時は必ず`NETWORK_MODE=tailscale`を指定

