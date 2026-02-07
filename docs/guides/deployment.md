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

最終更新: 2026-02-07（Docker build最適化の実装、段階展開の推奨手順追加、profileオプションの説明追加）

## 概要

本ドキュメントでは、Raspberry Pi 5上で動作するシステムのデプロイメント手順を説明します。

## 📖 このドキュメントを読む前に

- **初めてデプロイする場合**: まず [クイックスタートガイド](./quick-start-deployment.md) を読んでください
- **ネットワーク環境が変わった場合**: [環境構築ガイド](./environment-setup.md) を参照してください
- **SSH接続の仕組みを理解したい場合**: [Ansible SSH接続アーキテクチャの説明](./ansible-ssh-architecture.md) を参照してください

## ⚠️ 重要な原則

### デプロイ方法の使い分け（運用標準を統一）

| 用途 | スクリプト | 実行場所 | ブランチ指定 |
|------|-----------|---------|------------|
| **開発/緊急（Pi5のみ）** | `scripts/server/deploy.sh` | Pi5上で直接実行 | ✅ 可能（引数で指定） |
| **運用標準（全デバイス）** | `scripts/update-all-clients.sh` | Macから実行 | ✅ 可能（ブランチ指定 + inventory指定が必要） |

**⚠️ 注意**:
- **運用の標準は`update-all-clients.sh`**。Pi5も含めて一括更新します（inventory必須）。
- `deploy.sh`は**開発・緊急（Pi5単体）**の例外経路に限定します。
- **ブランチ指定は必須です**。デフォルトブランチはありません（誤デプロイ防止のため）。

### デプロイ成功条件（共通）

**成功条件に満たない場合は「デプロイ失敗」として扱う**（fail-fast）。最低限の共通条件は以下:

- **DB整合性**:
  - `pnpm prisma migrate status` が最新
  - 必須テーブル（例: `MeasuringInstrumentLoanEvent`）が存在
  - **運用標準（Ansible経路）ではデプロイ中に `pnpm prisma migrate deploy` を実行**し、デプロイ後にhealth-checkでstatusを再確認
- **API稼働**: `GET /api/system/health` が 200 で `status=ok`
- **証跡**: デプロイログ/検証ログが残り、失敗理由が追跡できる

## 🌐 ネットワーク環境の確認（デプロイ前必須）

**重要**: デプロイ前に、Pi5上の`group_vars/all.yml`の`network_mode`が**Tailscale主運用**の前提に合っているか確認してください。これがデプロイ成功の最重要ポイントです。

### ネットワークモードの選択

| ネットワーク環境 | network_mode | 使用IP | 用途 |
|----------------|-------------|--------|------|
| **通常運用（標準）** | `tailscale` | Tailscale IP（100.x.x.x） | 安全な通常運用（常時接続） |
| **緊急時のみ** | `local` | ローカルIP（192.168.x.x） | Tailscale障害/認証不能時の緊急対応 |

### ネットワークモード設定の確認・変更

**1. 現在の設定を確認**:
```bash
# Pi5上のnetwork_modeを確認
ssh denkon5sd02@100.106.158.2 "grep '^network_mode:' /opt/RaspberryPiSystem_002/infrastructure/ansible/group_vars/all.yml"
```

**2. 設定を変更（必要に応じて）**:
```bash
# Tailscaleモードに変更（通常運用・標準）
ssh denkon5sd02@100.106.158.2 "sed -i 's/network_mode: \"local\"/network_mode: \"tailscale\"/' /opt/RaspberryPiSystem_002/infrastructure/ansible/group_vars/all.yml"

# Localモードに変更（緊急時のみ）
ssh denkon5sd02@100.106.158.2 "sed -i 's/network_mode: \"tailscale\"/network_mode: \"local\"/' /opt/RaspberryPiSystem_002/infrastructure/ansible/group_vars/all.yml"
```

**3. 接続テスト**:
```bash
# Pi5からPi4への接続テスト（実際に使われるIPで）
ssh denkon5sd02@100.106.158.2 "cd /opt/RaspberryPiSystem_002 && ansible raspberrypi4 -i infrastructure/ansible/inventory.yml -m ping"
```

**⚠️ 注意**: 
- `network_mode`が`tailscale`の場合、Tailscale IPが使われます（`tailscale status`で確認）
- `network_mode`が`local`の場合、ローカルIPが使われます（`hostname -I`で取得した値を使用）
- **Tailscale主運用のため、`local`は緊急時のみ許可**としてください
  - `scripts/update-all-clients.sh` で`local`を使う場合は `ALLOW_LOCAL_EMERGENCY=1` を明示
- ローカルIPは環境で変動するため、実際に`hostname -I`等で取得した値で`group_vars/all.yml`を書き換えること
- **重要**: Ansibleがリポジトリを更新する際に`git reset --hard`を実行するため、`group_vars/all.yml`の`network_mode`設定がデフォルト値（`tailscale`）に戻る可能性があります。デプロイ前だけでなく、ヘルスチェック実行前にも必ず設定を再確認すること（[KB-094](../knowledge-base/infrastructure/backup-restore.md#kb-094-ansibleデプロイ時のgroup_varsallymlのnetwork_mode設定がリポジトリ更新で失われる問題)参照）

詳細は [環境構築ガイド](./environment-setup.md) を参照してください。

### 管理画面のIP制限（インターネット接続時）

- **Caddyでの制限**: `ADMIN_ALLOW_NETS` 環境変数（空白区切りCIDR、デフォルト: `192.168.10.0/24 192.168.128.0/24 100.64.0.0/10 127.0.0.1/32`）を設定すると、`/admin*` へのアクセスが許可ネットワークに限定されます。  
  - Docker Compose: `web.environment.ADMIN_ALLOW_NETS` を上書き。  
  - テスト: 許可IPから `curl -kI https://<pi5>/admin` が200/302、非許可IPは403/timeout。
- **Tailscale ACL推奨**: 併せて Tailscale ACL で管理画面のCIDRを信頼セグメントに限定してください（例: `100.64.0.0/10` のみ許可）。
- **HTTPS/ヘッダー確認**: `scripts/test/check-caddy-https-headers.sh` で HTTP→HTTPS リダイレクトと HSTS/Content-Type-Options/X-Frame-Options/Referrer-Policy をチェック可能。

## ラズパイ5（サーバー）の更新

### デプロイ前チェックリスト

**重要**: デプロイ実行前に、以下を必ず確認・実行してください：

- [ ] **リモートリポジトリとの比較**: Pi5上のコードとリモートリポジトリ（`origin/main`）を比較し、差分を確認
  ```bash
  # Pi5上で実行
  ssh denkon5sd02@raspberrypi.local
  cd /opt/RaspberryPiSystem_002
  git fetch origin
  git diff HEAD origin/main
  ```
- [ ] **コミット/プッシュ/CIの確認（重要）**:
  - `scripts/server/deploy.sh` は **`git pull origin <branch>` でリモートを取り込む**ため、ローカルで未pushの変更はデプロイされません。
  - `scripts/update-all-clients.sh` は **fail-fastチェック**により、未commit/未pushの状態でデプロイを実行しようとするとエラーで停止します。
  - デプロイ前に **変更がリモートへpush済み**であること、可能なら **GitHub Actions CIが成功していること**を確認してください（[KB-110](../knowledge-base/infrastructure/ansible-deployment.md#kb-110-デプロイ時の問題リモートにプッシュしていなかった標準手順を無視していた)、[KB-200](../knowledge-base/infrastructure/ansible-deployment.md#kb-200-デプロイ標準手順のfail-fastチェック追加とデタッチ実行ログ追尾機能) 参照）。
- [ ] **設定ファイルのバックアップ**: `backup.json`などの設定ファイルをバックアップ（[KB-163](../knowledge-base/infrastructure/backup-restore.md#kb-163-git-cleanによるbackupjson削除問題再発)参照）
  ```bash
  # Pi5上でbackup.jsonをバックアップ
  ssh denkon5sd02@raspberrypi.local "cp /opt/RaspberryPiSystem_002/config/backup.json /opt/RaspberryPiSystem_002/config/backup.json.backup.$(date +%Y%m%d-%H%M%S)"
  ```
- [ ] **フルバックアップの実行（推奨）**: DB/ENV/ストレージを含むバックアップを実行（[バックアップ手順](./backup-and-restore.md)参照）
  ```bash
  # Pi5上で実行
  ssh denkon5sd02@raspberrypi.local "cd /opt/RaspberryPiSystem_002 && ./scripts/server/backup.sh"
  ```
- [ ] **バックアップ設定の健全性確認（推奨）**: `backup.json`の衝突/ドリフト/欠落を検知（[KB-148](../knowledge-base/infrastructure/backup-restore.md#kb-148-バックアップ設定の衝突ドリフト検出の自動化p1実装)参照）
  ```bash
  # Pi5上で実行（自己署名TLSのため -k）
  ssh denkon5sd02@raspberrypi.local "curl -sk https://localhost/api/backup/config/health/internal"
  ```
- [ ] **ネットワーク環境の確認**: `group_vars/all.yml`の`network_mode`が現在のネットワーク環境と一致しているか確認
  ```bash
  # Pi5上のnetwork_modeを確認
  ssh denkon5sd02@raspberrypi.local "grep '^network_mode:' /opt/RaspberryPiSystem_002/infrastructure/ansible/group_vars/all.yml"
  ```
- [ ] **node_modules権限の確認**: root所有の`node_modules`が存在しないか（存在する場合は事前に修正）
  ```bash
  # Pi5上で実行（root所有を検出）
  ssh denkon5sd02@raspberrypi.local "cd /opt/RaspberryPiSystem_002 && find node_modules packages -type d -name '.bin' -user root -maxdepth 4 | head -n 5"
  # 修正が必要な場合
  ssh denkon5sd02@raspberrypi.local "sudo chown -R denkon5sd02:denkon5sd02 /opt/RaspberryPiSystem_002/node_modules /opt/RaspberryPiSystem_002/packages/*/node_modules"
  ```
- [ ] **Git権限の確認**: `.git`ディレクトリが`denkon5sd02`所有であることを確認（デタッチ実行に必要、[KB-219](../knowledge-base/infrastructure/ansible-deployment.md#kb-219-pi5のgit権限問題gitディレクトリがroot所有でデタッチ実行が失敗)参照）
  ```bash
  # Pi5上で実行（root所有を検出）
  ssh denkon5sd02@raspberrypi.local "ls -ld /opt/RaspberryPiSystem_002/.git"
  # 修正が必要な場合（root所有の場合）
  ssh denkon5sd02@raspberrypi.local "sudo chown -R denkon5sd02:denkon5sd02 /opt/RaspberryPiSystem_002/.git"
  ```
- [ ] **SSH接続の確認**: MacからPi5へのSSH接続が正常に動作することを確認（fail2ban Banの確認、[KB-218](../knowledge-base/infrastructure/ansible-deployment.md#kb-218-ssh接続失敗の原因fail2banによるip-ban存在しないユーザーでの認証試行)参照）
  ```bash
  # Macから実行（接続テスト）
  ssh denkon5sd02@100.106.158.2 "echo 'SSH接続成功'"
  # 接続できない場合、fail2ban Banの可能性があるため、RealVNC経由でPi5にアクセスしてBanを解除
  ```
- [ ] **aptリポジトリの確認**: NodeSourceリポジトリが存在する場合、GPG署名キー問題の可能性があるため確認（[KB-220](../knowledge-base/infrastructure/ansible-deployment.md#kb-220-nodesourceリポジトリのgpg署名キー問題sha1が2026-02-01以降拒否される)参照）
  ```bash
  # Pi5上で実行（NodeSourceリポジトリの存在確認）
  ls -la /etc/apt/sources.list.d/nodesource.list 2>/dev/null || echo "NodeSourceリポジトリは存在しません"
  # 存在する場合、apt-get updateでGPG署名エラーが発生する可能性があるため、削除を検討
  ```
- [ ] **標準手順の確認**: 本ドキュメントの標準デプロイ手順を必ず確認

### デプロイ後チェックリスト

**重要**: デプロイ実行後、以下を必ず確認してください：

- [ ] **設定ファイルの確認**: `backup.json`が正しく保持されているか確認
  ```bash
  # Pi5上でbackup.jsonの存在とサイズを確認
  ssh denkon5sd02@raspberrypi.local "ls -lh /opt/RaspberryPiSystem_002/config/backup.json"
  ```
- [ ] **APIヘルスチェック**: APIが正常に起動しているか確認
  ```bash
  # APIヘルスチェック
  curl -k https://raspberrypi.local/api/health
  ```
- [ ] **管理コンソールの確認**: 管理コンソールで設定（Gmail、Dropbox）が正しく表示されているか確認
  - バックアップタブでGmail設定とDropbox設定が表示されているか
  - バックアップ履歴が継続して記録されているか
  - 黄色の警告が表示されていないか（[KB-168](../knowledge-base/infrastructure/backup-restore.md#kb-168-旧キーと新構造の衝突問題と解決方法)参照）
- [ ] **DB整合性チェック（重要）**: マイグレーション適用と必須テーブルの存在を確認。**デプロイ完了後、必ずマイグレーション状態を確認すること**（[KB-224](../knowledge-base/infrastructure/ansible-deployment.md#kb-224-デプロイ時のマイグレーション未適用問題)参照）。未適用のマイグレーションがある場合は、手動で`pnpm prisma migrate deploy`を実行する。
  ```bash
  # Pi5上で実行（マイグレーション状態の確認）
  cd /opt/RaspberryPiSystem_002
  docker compose -f infrastructure/docker/docker-compose.server.yml exec -T api pnpm prisma migrate status
  
  # 未適用のマイグレーションがある場合、手動で適用
  docker compose -f infrastructure/docker/docker-compose.server.yml exec -T api pnpm prisma migrate deploy
  
  # マイグレーション履歴の確認
  docker compose -f infrastructure/docker/docker-compose.server.yml exec -T db \
    psql -U postgres -d borrow_return -v ON_ERROR_STOP=1 -tAc "SELECT COUNT(*) FROM \"_prisma_migrations\";"
  
  # 必須テーブルの存在確認（例: MeasuringInstrumentLoanEvent）
  docker compose -f infrastructure/docker/docker-compose.server.yml exec -T db \
    psql -U postgres -d borrow_return -v ON_ERROR_STOP=1 -tAc "SELECT to_regclass('public.\"MeasuringInstrumentLoanEvent\"') IS NOT NULL;"
  ```
- [ ] **ポート公開/不要サービス/監視の確認**: 不要なLISTEN/UNCONNが出ていないか、`ports-unexpected` がノイズ化していないか確認
  ```bash
  # LISTEN/UNCONN（プロセス込み）
  ssh denkon5sd02@raspberrypi.local "sudo ss -H -tulpen"

  # Dockerの公開状況（db/apiがホストへpublishされていないこと）
  ssh denkon5sd02@raspberrypi.local "docker compose -f /opt/RaspberryPiSystem_002/infrastructure/docker/docker-compose.server.yml ps"

  # security-monitor.timer が有効/稼働していること
  ssh denkon5sd02@raspberrypi.local "systemctl is-enabled security-monitor.timer && systemctl is-active security-monitor.timer"
  ```
  - 参考: [KB-177](../knowledge-base/infrastructure/security.md#kb-177-ports-unexpected-が15分おきに発生し続けるpi5の不要ポート露出監視ノイズ) / [port-security-audit.md](../security/port-security-audit.md)

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
- **Ansibleテンプレート**: Ansibleを使用する場合、`infrastructure/ansible/templates/docker.env.j2`から`.env`が再生成されます
  - ⚠️ **重要**: Ansibleで`.env`を再生成すると、テンプレートに含まれていない環境変数は削除されます
  - **永続化する方法**: 環境変数をAnsible管理化する（テンプレートに追加、inventoryに変数を追加、vaultに機密情報を追加）
  - **例**: 
    - `SLACK_KIOSK_SUPPORT_WEBHOOK_URL`はAnsible管理化済み（[KB-142](../knowledge-base/infrastructure/ansible-deployment.md#kb-142-ansibleでenv再生成時に環境変数が消失する問題slack-webhook-url)参照）
    - `DROPBOX_APP_KEY`、`DROPBOX_APP_SECRET`、`DROPBOX_REFRESH_TOKEN`、`DROPBOX_ACCESS_TOKEN`はAnsible管理化済み（[KB-143](../knowledge-base/infrastructure/ansible-deployment.md#kb-143-ansibleでenv再生成時にdropbox設定が消失する問題と恒久対策)参照）
    - `CSV_DASHBOARD_STORAGE_DIR`はCSVダッシュボード機能で使用（デフォルト: `/app/storage/csv-dashboards`、Ansible使用時はテンプレートに追加が必要、[KB-155](../knowledge-base/infrastructure/signage.md#kb-155-csvダッシュボード可視化機能実装完了)参照）
  - **推奨**: 新しい環境変数を追加する場合は、Ansible管理化を検討してください
- **設定ファイルの管理**: `backup.json`などの設定ファイルは、APIが書き換える可能性があるため、Ansibleで上書きせず、存在保証と健全性チェックに留める（[KB-143](../knowledge-base/infrastructure/ansible-deployment.md#kb-143-ansibleでenv再生成時にdropbox設定が消失する問題と恒久対策)参照）
- **backup.jsonの保護機能**: `backup.json`の破壊的上書きを防ぐため、フォールバック設定の保存拒否と破壊的上書き防止ガードが実装されている（[KB-151](../knowledge-base/infrastructure/backup-restore.md#kb-151-backupjsonの破壊的上書きを防ぐセーフガード実装)参照）。設定ファイルが急激に縮小する（targets数が50%以上減る）場合や、フォールバック設定が保存されようとする場合、保存が拒否される。
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

# mainブランチをデプロイ
./scripts/server/deploy.sh main

# 特定のブランチをデプロイ
./scripts/server/deploy.sh feature/new-feature
```

**デタッチ実行（長時間デプロイ向け）**:
```bash
# ラズパイ5で実行（デタッチ）
cd /opt/RaspberryPiSystem_002
bash ./scripts/server/deploy-detached.sh feature/new-feature

# 実行状態はログ/ステータス/exitで確認
ls -lt /opt/RaspberryPiSystem_002/logs/deploy/deploy-detached-*.status.json | head -3
```
**補足**:
- `deploy-detached.sh` は systemd-run が利用可能な場合は **ジョブ化して実行**します（不可の場合は `nohup` にフォールバック）

**Ansible経由デプロイのログ追尾**:
`scripts/update-all-clients.sh`で`--detach`モードを使用する場合、ログはリアルタイムで表示されません。以下の方法でログを追尾できます：

- **`--detach --follow`**: デプロイ開始後、`tail -f`でログをリアルタイム追尾
  ```bash
  ./scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --detach --follow
  ```

- **`--attach <run_id>`**: 既存のデタッチ実行のログをリアルタイム追尾
  ```bash
  ./scripts/update-all-clients.sh --attach 20260125-135737-15664
  ```

**ジョブ実行（systemd-run）**:
長時間デプロイを **端末切断に強く** 実行したい場合は `--job` を使用します。
- **`--job --follow`**: Pi5上でジョブ化して実行し、追尾する
  ```bash
  ./scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --job --follow
  ```
- **`--status <run_id>`**: ジョブの状態とunitステータスを確認
  ```bash
  ./scripts/update-all-clients.sh --status 20260125-135737-15664
  ```

詳細は [KB-200](../knowledge-base/infrastructure/ansible-deployment.md#kb-200-デプロイ標準手順のfail-fastチェック追加とデタッチ実行ログ追尾機能) を参照してください。

### 所要時間の目安と判定（運用目線）

**目安（通常時）**:
- **Pi5（サーバー）**: 10分前後（上限15分）
- **Pi4（キオスク）**: 5〜10分（上限10分）
- **Pi3（サイネージ）**: 10〜15分（上限30分）

**判定ルール（最低限）**:
- 上限内に完了しない場合は**「遅延」**として扱い、ログを確認する
- **`context canceled`** や `rpc error` が出た場合はビルド中断の可能性が高い

**ログからの所要時間確認**:
- `logs/ansible-history.jsonl` に **実行単位の所要時間** が記録されます（`durationSeconds`）。
```bash
# 直近の所要時間を確認（秒）
tail -n 5 /opt/RaspberryPiSystem_002/logs/ansible-history.jsonl
```

**補足**:
- 目安は「通常のコード変更＋Docker buildあり」を前提にした基準です
- 大きな差分や初回ビルド時は長くなる場合があります
  - 例: Docker build cacheの欠如、依存関係の追加など

**重要（反映漏れ防止）**:
- Ansible標準経路では、**コード更新があった場合に `api/web` を `--force-recreate --build` で再作成**します。
- これが「デプロイ成功＝変更が反映済み」の前提条件です。ビルドが重い場合は完了まで待機し、ログ/ステータスで確認してください。
- **Web bundleデプロイ修正（2026-02-03）**: `scripts/update-all-clients.sh`が`git pull`前後でHEADを比較し、変更があれば`force_docker_rebuild`フラグを設定します。これにより、Ansibleの`repo_changed`判定だけでは検出できないコード更新時でも、確実にDockerコンテナが再ビルドされます（[KB-227](../knowledge-base/infrastructure/ansible-deployment.md#kb-227-web-bundleデプロイ修正コード更新時のdocker再ビルド確実化)参照）。

**deploy.shの改善機能（2026-01-24実装）**:
- **サービスダウン状態の回避**: `docker compose down`を削除し、`build`→`up --force-recreate`に変更。ビルド完了後にコンテナを再作成することで、`down`成功後に`up`が失敗してもサービスダウン状態を回避します（[KB-193](../knowledge-base/infrastructure/ansible-deployment.md#kb-193-デプロイ標準手順のタイムアウトコンテナ未起動問題の徹底調査結果)参照）
- **中断時の自動復旧**: SSHセッション終了やプロセス中断時でも、`trap`でEXIT時に`docker compose up -d`を試行し、コンテナが起動していない状態を自動復旧します
- **ログ永続化**: デプロイ実行ログを`logs/deploy/deploy-sh-<timestamp>.log`に保存し、タイムアウト時でもログを確認可能です

**注意事項**:
- SSH経由で長時間実行する場合（Dockerビルドが数分かかる）、クライアント側のタイムアウト設定に注意してください。タイムアウトが発生した場合でも、`trap`による自動復旧が動作しますが、ログファイルで実行状況を確認してください
- デプロイログは`/opt/RaspberryPiSystem_002/logs/deploy/deploy-sh-<timestamp>.log`に保存されます

### ビルド時間短縮（任意・推奨）

**目的**: Docker buildのコンテキスト転送量を削減し、ビルド時間と`context canceled`のリスクを下げる。

**方針**:
- リポジトリルートの `.dockerignore` により、`node_modules/`, `logs/`, `storage/`, `alerts/`, `certs/`, `docs/` など **ビルド不要なディレクトリを除外**します。
- **重要**: `**/tsconfig.tsbuildinfo` と `**/*.tsbuildinfo` も除外します（[KB-218](../knowledge-base/infrastructure/ansible-deployment.md#kb-218-docker-build時のtsbuildinfo問題インクリメンタルビルドでdistが生成されない)参照）。
  - TypeScriptのインクリメンタルビルド情報（`tsbuildinfo`）がDockerにコピーされると、`tsc`が「変更なし」と判断してビルドをスキップし、`dist`が生成されない問題が発生します。
  - Docker内では常に新しいビルドを実行するため、`tsbuildinfo`を除外する必要があります。
- これにより **Pi5上のDocker buildが安定・短縮** します。

### 方法2: 手動で更新

**⚠️ 重要**: デプロイ前に必ず以下を確認してください：
1. **デプロイ前チェックリスト**: 上記の「デプロイ前チェックリスト」を必ず確認・実行してください
2. **リモートにプッシュ済みか確認**: `git log origin/<branch>`でリモートの最新コミットを確認
3. **ローカルとリモートの差分確認**: `git log HEAD..origin/<branch>`で差分を確認
4. **標準手順の遵守**: 以下の標準手順を必ず遵守してください（[KB-110](../knowledge-base/infrastructure/ansible-deployment.md#kb-110-デプロイ時の問題リモートにプッシュしていなかった標準手順を無視していた)参照）

**重要**: デプロイは常に現在のブランチを使用します。`main`ブランチにマージするのは別途指示がある場合のみです。

```bash
# 1. リポジトリを更新（現在のブランチを使用）
cd /opt/RaspberryPiSystem_002
CURRENT_BRANCH=$(git branch --show-current)
git pull origin "$CURRENT_BRANCH"

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

# 5. デプロイ後チェックリスト: 上記の「デプロイ後チェックリスト」を必ず確認してください
```

**重要**: 
- **標準手順の遵守**: `--force-recreate --build`を1コマンドで実行してください。分割して実行すると、変更が反映されない可能性があります（[KB-110](../knowledge-base/infrastructure/ansible-deployment.md#kb-110-デプロイ時の問題リモートにプッシュしていなかった標準手順を無視していた)参照）。
- `docker compose restart`では新しいイメージが使われません。コードを変更したら、必ず`--force-recreate`オプションを使用してコンテナを再作成してください。
- `VITE_API_BASE_URL`は相対パス（`/api`）に設定されているため、再起動後もIPアドレスが変わっても問題ありません。
- `VITE_AGENT_WS_URL`は環境変数ファイル（`.env`）で管理できるため、IPアドレスが変わった場合は`.env`ファイルを更新してからWebコンテナを再ビルドしてください。
- **Pi5のstatus-agent設定**: Pi5サーバー側のstatus-agent設定はAnsibleで管理されています（[KB-129](../knowledge-base/infrastructure/ansible-deployment.md#kb-129-pi5サーバー側のstatus-agent設定ファイルが古い設定のまま)参照）。`inventory.yml`の`status_agent_*`変数と`host_vars/raspberrypi5/vault.yml`の`vault_status_agent_client_key`が設定されていれば、Ansible実行時に自動的に設定ファイルが更新されます。
- **環境変数の空文字問題**: `docker-compose.server.yml`で`${VAR:-}`構文を使用する場合、環境変数が未設定でも空文字が注入されるため、Zodバリデーションで`z.preprocess`を使用して空文字を`undefined`に変換する必要があります（[KB-131](../knowledge-base/api.md#kb-131-apiコンテナがslack-webhook-url環境変数の空文字で再起動ループする問題)参照）。APIコンテナが再起動ループに陥る場合は、環境変数のバリデーションエラーを確認してください。
- **Prisma Client再生成の注意**: データベースマイグレーション適用後、APIコンテナ内でPrisma Clientを再生成する必要がある場合があります。マイグレーションが適用されても、コンテナ内のPrisma Clientが古いスキーマを参照している場合は、以下のコマンドで再生成してください（[KB-150](../knowledge-base/infrastructure/signage.md#kb-150-サイネージレイアウトとコンテンツの疎結合化実装完了)参照）:
  ```bash
  # APIコンテナ内でPrisma Clientを再生成
  docker compose -f infrastructure/docker/docker-compose.server.yml exec -T api pnpm prisma generate
  
  # APIコンテナを再起動
  docker compose -f infrastructure/docker/docker-compose.server.yml restart api
  ```

## ラズパイ4（クライアント/NFCエージェント）の更新

**重要**: Pi4デプロイ時にファイルが見つからないエラーや権限エラーが発生する場合は、[KB-095](../knowledge-base/infrastructure/backup-restore.md#kb-095-pi4デプロイ時のファイルが見つからないエラーと権限問題)を参照してください。

**重要（2026-01-03更新）**: 
- Pi4の`status-agent`は`https://<Pi5>/api`経由でAPIにアクセスします（Caddy経由）
- ポート8080は外部公開されていません（Docker内部ネットワークでのみアクセス可能）
- `status-agent.conf`の`API_BASE_URL`は自動的に`https://<Pi5>/api`に設定されます（Ansibleが`group_vars/all.yml`の`api_base_url`を使用）

**重要（2026-01-19更新）**: 
- **Pi4デプロイ時のメンテナンス画面表示**: Pi4デプロイ時（`--limit raspberrypi4`使用時）に、キオスク画面にメンテナンス画面が自動的に表示されます
  - デプロイスクリプト（`scripts/update-all-clients.sh`）が自動的にメンテナンスフラグを設定・クリアします
  - メンテナンス画面は「メンテナンス中」メッセージとスピナーを表示し、ユーザーの操作を防ぎます
  - デプロイ完了後、メンテナンス画面は自動的に消えます（最大5秒以内）
  - 詳細は [KB-183](../knowledge-base/infrastructure/ansible-deployment.md#kb-183-pi4デプロイ時のキオスクメンテナンス画面表示機能の実装) を参照

**重要（2026-02-07更新）**:
- **段階展開（カナリア→全台）**を推奨します（Pi4が増えた場合の安全策）
  - inventoryに `kiosk` / `signage` / `kiosk_canary` / `signage_canary` グループを用意しています
  - **カナリア成功後はPi4全台を並行デプロイ**、**Pi3は常時単独**の運用を想定しています
  - `scripts/update-all-clients.sh` のデプロイ後ヘルスチェックは `--limit` に追従します（カナリア時に全台チェックで時間が伸びるのを防止）

例（推奨）:

```bash
# Stage 0: カナリア（server + kiosk_canary）
./scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --limit "server:kiosk_canary"

# Stage 1: ロールアウト（server + kiosk 全台、カナリア除外）
./scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --limit "server:kiosk:!kiosk_canary"

# Pi3（signage）は常時単独で実行（server + signage）
./scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --limit "server:signage"
```

**重要（2026-02-07更新）**:
- **Docker build最適化**: 変更ファイルに基づいてDocker buildの必要性を判定し、不要なbuildをスキップします
  - **buildが必要な変更**: `apps/api/**`, `apps/web/**`, `packages/**`, `pnpm-lock.yaml`, `package.json`, `pnpm-workspace.yaml`, `infrastructure/docker/**`, `apps/api/prisma/**`
  - **build不要な変更**: `docs/**`, `infrastructure/ansible/**`（`infrastructure/docker/**` を除く）, `scripts/**`（Dockerに影響しない場合）
  - 判定ロジックは `scripts/update-all-clients.sh` と `infrastructure/ansible/roles/common/tasks/main.yml` の両方で実装（二重安全）
  - 判定できない場合は安全側でbuild実行（初回clone/HEAD不明など）
  - 効果: カナリアで **6分34秒 → 3分11秒（約3分23秒短縮）**を確認（[KB-235](../knowledge-base/infrastructure/ansible-deployment.md#kb-235-docker-build最適化変更ファイルに基づくbuild判定)参照）
- **apt cache最適化**: 同一デプロイ内で`apt update`が複数回実行される無駄を削減します
  - `group_vars/all.yml`の`apt_cache_valid_time_seconds: 3600`により、最後の`apt update`から1時間以内はキャッシュが有効
  - `ansible.builtin.apt`タスクに`cache_valid_time`を追加し、`update_cache: true`は維持（判定不能時は安全側で更新）
  - 対象: kiosk/serverのセキュリティ系パッケージ（ClamAV/rkhunter/ufw/fail2ban）
  - 効果: 同一デプロイ内で最初の`apt update`以降はキャッシュが有効になり、apt関連タスクが若干短縮（例: `server : Install security packages` 4.51s → 3.46s）
  - 詳細は [KB-234](../knowledge-base/infrastructure/ansible-deployment-performance.md#kb-234-ansibleデプロイが遅い段階展開重複タスク計測欠如の整理と暫定対策) を参照

**重要（2026-02-06更新）**:
- **Pi4キオスクの電源操作**: キオスク画面の「再起動」「シャットダウン」ボタンは、Pi4ローカルのNFCエージェントREST APIを呼び出します
  - `POST http://localhost:7071/api/agent/reboot`
  - `POST http://localhost:7071/api/agent/poweroff`
- **Mixed Content回避**: キオスクは `https://<Pi5>/kiosk` で開くため、Pi4のChromium起動フラグに `--allow-running-insecure-content` と `--unsafely-treat-insecure-origin-as-secure=http://localhost:7071` を設定します
- **OS権限**: Pi4のAnsible設定で `sudo_nopasswd_commands` に `/usr/bin/systemctl reboot` と `/usr/bin/systemctl poweroff` を含めてください

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

**重要**: Pi3はメモリが少ない（1GB、実質416MB）ため、デプロイ時にサイネージ関連サービスを停止してメモリを確保する必要があります。**この停止処理はプレフライトチェックで自動実行**されます。

**重要（2026-01-03更新）**: 
- Pi3のサイネージデザイン変更（左ペインタイトル、温度表示）は**Pi5側のデプロイのみで反映**されます
- Pi3へのデプロイは不要です（サーバー側レンダリングのため）
- Pi3の`status-agent`は`https://<Pi5>/api`経由でAPIにアクセスします（Caddy経由）
- ポート8080は外部公開されていません（Docker内部ネットワークでのみアクセス可能）

**重要（2026-01-16更新）**: 
- デバイスタイプ汎用化により、Pi3以外のサイネージ端末（Pi Zero 2Wなど）にも対応可能になりました
- デバイスタイプごとの設定は`group_vars/all.yml`の`device_type_defaults`で管理されています
- 新しいデバイスタイプを追加する場合は、`device_type_defaults`に設定を追加し、inventoryファイルに`device_type`を指定してください

### デプロイ前の準備（自動化済み）

**✅ 自動化**: サイネージ端末デプロイ時のプレフライトチェックと復旧（lightdm + signage-lite再開）は**自動的に実行**されます（2026-01-16更新）。以下の手順を手動で実行する必要はありません。

**自動実行されるプレフライトチェック**:
1. **コントロールノード側（Pi5上）**: Ansibleロールのテンプレートファイル存在確認（`roles/signage/templates/`）
2. **サイネージ端末側（デバイスタイプごとに設定）**: 
   - サービス停止・無効化（`signage-lite.service`, `signage-lite-update.timer`, `signage-lite-watchdog.timer`, `signage-daily-reboot.timer`, `status-agent.timer`）
   - サービスmask（`signage-lite.service`の自動再起動防止）
   - **lightdm停止**（デバイスタイプに応じて。Pi3/Pi Zero 2WではGUIを停止して約100MBのメモリを確保）（[KB-169](../knowledge-base/infrastructure/signage.md#kb-169-pi3デプロイ時のlightdm停止によるメモリ確保と自動再起動)参照）
   - 残存AnsiballZプロセスの掃除（120秒以上経過したもの）
   - メモリ閾値チェック（デバイスタイプごとの設定値、デフォルト: >= 120MB）

**デプロイ完了後の自動処理（post_tasks）**:
- **GUI/サイネージ自動復旧**: lightdmを停止した場合、デプロイ完了後に`lightdm`と`signage-lite.service`を再開して復旧します（reboot不要）
- **サイネージサービス確認**: 復旧後、`signage-lite.service`がactiveになるまで最大60秒待機し、結果をログ出力します

**⚠️ Pi3デプロイ時の`unreachable=1`について（2026-01-30追記）**:
- Pi3デプロイ実行後、`PLAY RECAP`で`raspberrypi3: unreachable=1`が表示される場合があります
- これは`post_tasks`フェーズの最後の2タスク（`signage-lite-watchdog.timer`、`signage-daily-reboot.timer`）で一時的なSSH接続問題が発生したことを示します
- **重要**: デプロイ全体が`failed=0`で`state: success`なら、主要目的（コード更新、サービス再起動、GUI/サイネージ復旧）は達成されています
- サービス状態は`systemctl is-active`で直接確認してください（ログの`unreachable`だけでは判断しない）
  ```bash
  # NOTE: Pi3のTailscale IPは変わることがあるため、到達先はPi5の`tailscale status`で確認してください
  ssh denkon5sd02@100.106.158.2 "ssh signageras3@100.105.224.86 'systemctl is-active signage-lite-watchdog.timer signage-daily-reboot.timer'"
  # 結果が "active active" なら正常動作中
  ```
- 詳細は [KB-216](../knowledge-base/infrastructure/ansible-deployment.md#kb-216-pi3デプロイ時のpost_tasksでunreachable1が発生するがサービスは正常動作している) を参照してください

**プレフライトチェックが失敗した場合**:
- メモリ不足（< 120MB）: デプロイは自動的に中断され、エラーメッセージに手動停止手順が表示されます
- テンプレートファイル不足: デプロイ開始前にfail-fastし、エラーメッセージにファイル配置場所が表示されます

**手動実行が必要な場合（プレフライトチェック失敗時）**:
```bash
# メモリ不足の場合のみ、手動でサービスを停止・無効化（自動再起動防止）
ssh denkon5sd02@100.106.158.2 "ssh signageras3@100.105.224.86 'sudo systemctl stop signage-lite.service signage-lite-update.timer signage-lite-watchdog.timer signage-daily-reboot.timer status-agent.timer && sudo systemctl disable signage-lite.service signage-lite-update.timer signage-lite-watchdog.timer signage-daily-reboot.timer status-agent.timer'"

# さらに自動再起動を完全に防ぐ（ランタイムマスク）
ssh denkon5sd02@100.106.158.2 "ssh signageras3@100.105.224.86 'sudo systemctl mask --runtime signage-lite.service'"

# デバイスタイプによりGUI(lightdm)を停止してメモリを確保（Pi3 / Pi Zero 2W等）
ssh denkon5sd02@100.106.158.2 "ssh signageras3@100.105.224.86 'sudo systemctl stop lightdm || true'"

# 数秒待ってからメモリを確認
ssh denkon5sd02@100.106.158.2 "ssh signageras3@100.105.224.86 'sleep 5 && free -m'"

# メモリが120MB以上になったら、再度デプロイを実行
```

**重要**: 
- プレフライトチェックにより、デプロイは**手順遵守に依存せず**、自動的に安全な状態で実行されます
- Pi3デプロイは10-15分以上かかる可能性があります。リポジトリが大幅に遅れている場合や、メモリ不足の場合はさらに時間がかかります（[KB-096](../knowledge-base/infrastructure/backup-restore.md#kb-096-pi3デプロイに時間がかかる問題リポジトリの遅れメモリ制約)参照）
- **Ansibleロールのテンプレート配置**: `signage`ロールのテンプレートファイルは`infrastructure/ansible/roles/signage/templates/`に配置する必要があります。`infrastructure/ansible/templates/`にのみ配置していると、デプロイ時にテンプレートファイルが見つからず失敗します（[KB-153](../knowledge-base/infrastructure/ansible-deployment.md#kb-153-pi3デプロイ失敗signageロールのテンプレートディレクトリ不足)参照）

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
# 環境変数の設定（Pi5のTailscale IPを指定）
# ⚠️ 重要: ユーザー名を含める形式（denkon5sd02@...）を推奨
# ユーザー名を省略した場合、スクリプトがinventory.ymlから自動取得しますが、
# inventory.ymlが読み込めない場合はデフォルトユーザー名（denkon5sd02）が使用されます
# ⚠️ 必須: Pi5へのデプロイ時は、必ずRASPI_SERVER_HOSTを設定してリモート実行してください
# ansible_connection: localでも、Mac側からansible-playbookを実行するとMac側のsudoパスワードが求められます
# RASPI_SERVER_HOSTを設定することで、Pi5上でリモート実行され、Pi5上のansible.cfgが正しく読み込まれます
# 詳細は [KB-233](../knowledge-base/infrastructure/ansible-deployment.md#kb-233-デプロイ時のsudoパスワード問題ansible_connection-localでもmac側から実行される場合) を参照
export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"

# または、ユーザー名を省略した形式（スクリプトが自動補完）
# export RASPI_SERVER_HOST="100.106.158.2"  # スクリプトが自動的に denkon5sd02@100.106.158.2 に変換

# mainブランチで全デバイス（Pi5 + Pi3/Pi4）を更新（第2工場）
./scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml

# mainブランチで全デバイスを更新（トークプラザ）
./scripts/update-all-clients.sh main infrastructure/ansible/inventory-talkplaza.yml

# 特定のブランチで全デバイスを更新（第2工場）
./scripts/update-all-clients.sh feature/rigging-management infrastructure/ansible/inventory.yml
```

#### デタッチ実行（長時間デプロイ向け・推奨）

**ポイント**:
- Mac/SSH経由の実行はクライアント側タイムアウトで「途中停止して見える」ことがあります。
- `scripts/update-all-clients.sh` の **リモート実行はデフォルトでデタッチ**されます（Pi5側で処理が継続）。
- 前景で実行したい場合は **`--foreground` を明示**してください（長時間は非推奨）。
- 進捗は `--attach` / `--status` で確認できます。

**デプロイモードの判断基準（2026-02-01更新）**:
- **Pi5のみ**: 前景実行も可能（短時間のみ。原則はデタッチ）
- **Pi5 + Pi4以上**: `--detach --follow`必須（15-20分以上かかるためタイムアウトする）
- **全デバイス**: `--detach --follow`必須（30分以上かかるためタイムアウトする）

**デプロイ対象の判断基準（2026-02-01更新）**:
- **Webアプリのみ**: Pi5 + Pi4（`--limit "raspberrypi5:raspberrypi4"`）
- **API/DBのみ**: Pi5のみ（`--limit raspberrypi5`）
- **サイネージ関連**: Pi5のみ（サーバー側レンダリングのため）
- **Pi3固有の設定**: Pi3のみ（`--limit raspberrypi3`）

詳細は [KB-226](../knowledge-base/infrastructure/ansible-deployment.md#kb-226-デプロイ方針の見直しpi5pi4以上はdetach-follow必須) を参照。

```bash
# 第2工場: デタッチ実行（デフォルトでデタッチ）
./scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml

# トークプラザ: デタッチ実行（デフォルトでデタッチ）
./scripts/update-all-clients.sh main infrastructure/ansible/inventory-talkplaza.yml

# 前景実行（短時間のみ。長時間は非推奨）
./scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --foreground

# ログ追尾（run_idを指定）
./scripts/update-all-clients.sh --attach 20260125-123456-4242

# 状態確認（run_idを指定）
./scripts/update-all-clients.sh --status 20260125-123456-4242
```

#### デプロイの所要時間を計測する（profile_tasks/timer）

「どのタスクが遅いか」を秒で確定したい場合は、`--profile` を付けて実行します。
通常のデプロイ挙動は変えず、**出力にタスクごとの所要時間（上位）が追加**されます。

```bash
# 例: カナリア（server + kiosk_canary）を計測付きで実行
./scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --limit "server:kiosk_canary" --profile
```

読み方（目安）:
- `profile_tasks` の出力で **上位（遅い順）に並ぶタスク**が“時間の主犯”
- 主犯が `apt update` / `docker build` / `git fetch` / `uri health check` / `tailscale` などのどれかを確定してから、最小変更で削減する

**重要**: 
- `scripts/update-all-clients.sh`はPi5も含めて更新します
- **ブランチ指定は必須です**（デフォルトブランチはありません。誤デプロイ防止のため）
- **デプロイはPi5が `origin/<branch>` をpullして実行**します（ローカル未commit/未pushの変更はデプロイされません）。その状態で実行すると、スクリプトが **fail-fastで停止**します。
  - 対処: 変更をcommit → push → GitHub Actions CIが成功 → そのブランチ名で再実行
- **スクリプト実行前に、Pi5上の`network_mode`設定が正しいことを確認してください**（スクリプトが自動チェックします）

#### デプロイ安定化機能（2026-01-17実装）

`scripts/update-all-clients.sh`には以下のデプロイ安定化機能が実装されています：

1. **プリフライトリーチビリティチェック**:
   - デプロイ開始前にPi5へのSSH接続を確認
   - Pi5からinventory内の全ホストへの接続を`ansible -m ping`で確認
   - 接続不可の場合はデプロイを中断（エラーコード3）

2. **リモートロック（並行実行防止）**:
   - Pi5上の`/opt/RaspberryPiSystem_002/logs/deploy.lock`で並行実行を防止
   - 古いロック（デフォルト30分以上経過）は自動的にクリーンアップ
   - ロック取得失敗時はデプロイを中断（エラーコード3）

3. **リソースガード**:
   - デプロイ前に各ホストのリソースをチェック
   - メモリ: 120MB未満の場合はデプロイを中断
   - ディスク: `/opt`の使用率が90%以上の場合はデプロイを中断
   - 詳細は`infrastructure/ansible/tasks/resource-guard.yml`を参照

4. **環境限定リトライ**:
   - unreachable hostsのみを対象にリトライ（最大3回、30秒間隔）
   - タスク失敗（failed hosts）はリトライしない（環境問題とコード問題を区別）
   - `--limit`オプションで特定ホストのみリトライ可能

5. **ホストごとのタイムアウト**:
   - Pi3: 30分（リポジトリ更新が遅い場合を考慮）
   - Pi4: 10分
   - Pi5: 15分
   - タイムアウト設定は`infrastructure/ansible/inventory.yml`の`ansible_command_timeout`で管理

6. **通知（alerts一次情報 + Slackは二次経路）**:
   - デプロイ開始/成功/失敗/ホスト単位失敗のタイミングで **`alerts/alert-*.json`（一次情報）** を生成します
   - **Slack通知（チャンネル分離）はAPIのAlerts Dispatcherが担当**します（B1方針）
     - scripts側は原則「ファイル生成」に専念し、Slackはログ/運用イベントの二次経路として配送します
     - Slack配送を有効化するには、API側で `ALERTS_DISPATCHER_ENABLED=true` と `ALERTS_SLACK_WEBHOOK_*` の設定が必要です

7. **`--limit`オプション対応**:
   - 特定ホストのみを更新する場合に使用
   - 例: `./scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --limit raspberrypi3`
   - プリフライトチェックとリトライにも適用される

**実機検証状況**:
- ✅ Pi5でのデプロイ成功を確認（2026-01-18）
- ✅ Pi4でのデプロイ成功を確認（2026-01-19、[KB-182](../knowledge-base/infrastructure/ansible-deployment.md#kb-182-pi4デプロイ検証結果デプロイ安定化機能の動作確認)参照）
- ✅ プリフライト・ロック・リソースガードの動作を確認（Pi5、Pi4）
- ⚠️ リトライ機能、並行実行時のロックは未検証（実運用では問題なく動作する見込み）
- ⚠️ Slack通知は「alerts生成」までは確認済みだが、Slack配送（API Dispatcher）設定の有無に依存するため、Slackアプリ着弾は要確認

詳細は [KB-172](../knowledge-base/infrastructure/ansible-deployment.md#kb-172-デプロイ安定化機能の実装プリフライトロックリソースガードリトライタイムアウト) を参照。

#### Slack通知のチャンネル分離（2026-01-18実装）

**概要**: Slack通知を4系統（deploy/ops/security/support）に分類し、それぞれ別チャンネルに着弾させることで、運用上の見落としとノイズを削減します。

**チャンネル構成**:
- `#rps-deploy`: デプロイ関連アラート（`ansible-update-*`, `ansible-health-check-*`）
- `#rps-ops`: 運用関連アラート（`storage-*`, `csv-import-*`、デフォルト）
- `#rps-security`: セキュリティ関連アラート（`role_change`等）
- `#rps-support`: サポート関連アラート（`kiosk-support*`、キオスクサポート直送）

**設定手順**:
1. **Slack側でチャンネル作成とIncoming Webhook取得**:
   - ✅ 各チャンネル（`#rps-deploy`, `#rps-ops`, `#rps-security`, `#rps-support`）を作成済み
   - 各チャンネルのIncoming Webhook URLを取得（詳細は [Slack Webhook URL設定手順](./slack-webhook-setup.md) を参照）

2. **Ansible VaultにWebhook URLを登録**:
   ```bash
   # Pi5のvault.ymlを編集（ansible-vaultで暗号化）
   ansible-vault edit infrastructure/ansible/host_vars/raspberrypi5/vault.yml
   ```
   
   以下の変数にWebhook URLを設定:
   ```yaml
   vault_alerts_slack_webhook_deploy: "https://hooks.slack.com/services/..."
   vault_alerts_slack_webhook_ops: "https://hooks.slack.com/services/..."
   vault_alerts_slack_webhook_security: "https://hooks.slack.com/services/..."
   vault_alerts_slack_webhook_support: "https://hooks.slack.com/services/..."
   ```
   
   **キオスクサポート直送もsupportチャンネルへ**:
   ```yaml
   vault_slack_kiosk_support_webhook_url: "https://hooks.slack.com/services/..."  # supportチャンネルのWebhook URL
   ```

3. **デプロイ実行**:
   ```bash
   ./scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml
   ```
   
   デプロイ後、`infrastructure/docker/.env`に以下の環境変数が設定されます:
   - `ALERTS_DISPATCHER_ENABLED=true`
   - `ALERTS_SLACK_WEBHOOK_DEPLOY=...`
   - `ALERTS_SLACK_WEBHOOK_OPS=...`
   - `ALERTS_SLACK_WEBHOOK_SECURITY=...`
   - `ALERTS_SLACK_WEBHOOK_SUPPORT=...`

4. **自動反映**（Ansibleが`.env`更新時にapiを再作成）:
   - `.env`が更新された場合、Ansibleが`api`コンテナを`--force-recreate`で再作成して環境変数を反映
   - 反映後に環境変数の検証を行い、不足があればfail-fastでデプロイを停止

**動作確認**:
- 各routeKeyのテストアラートを生成して、正しいチャンネルに着弾することを確認:
  ```bash
  # deployチャンネル確認
  ./scripts/generate-alert.sh ansible-update-failed "テスト: デプロイ失敗" "テスト用"
  
  # opsチャンネル確認
  ./scripts/generate-alert.sh storage-usage-high "テスト: ストレージ使用量警告" "テスト用"
  
  # securityチャンネル確認（API経由）
  # 管理画面でユーザーのロールを変更すると、role_changeアラートが生成されます
  
  # supportチャンネル確認
  ./scripts/generate-alert.sh kiosk-support-test "テスト: キオスクサポート" "テスト用"
  ```

**注意事項**:
- 未設定（空文字）のrouteKeyのアラートはSlackに送信されません（ファイル生成のみ）
- Generalチャンネルは「フォールバック/人間向け雑談」として残しておくことを推奨
- 新しいアラートtypeを追加する場合は、`apps/api/src/services/alerts/alerts-config.ts`の`routing.byTypePrefix`にprefixを追加して分類を固定してください

**実機検証完了（2026-01-18）**:
- ✅ `#rps-deploy`: `ansible-update-failed`アラート受信確認
- ✅ `#rps-ops`: `storage-usage-high`アラート受信確認
- ✅ `#rps-security`: `role_change`アラート受信確認
- ✅ `#rps-support`: `kiosk-support-test`アラート受信確認

**トラブルシューティング**:
- デプロイが環境変数検証で失敗する場合は、VaultのWebhook設定を確認（未設定/空文字が原因）
- 既存の手動回避策は [KB-176](../knowledge-base/infrastructure/ansible-deployment.md#kb-176-slack通知チャンネル分離のデプロイトラブルシューティング環境変数反映問題) に整理済み（標準手順では不要）

**関連ドキュメント**:
- [Slack Webhook URL設定手順](./slack-webhook-setup.md) - 詳細な設定手順とトラブルシューティング
- [Alerts Platform Phase2設計](../plans/alerts-platform-phase2.md)
- [KB-172](../knowledge-base/infrastructure/ansible-deployment.md#kb-172-デプロイ安定化機能の実装プリフライトロックリソースガードリトライタイムアウト)
- [KB-176](../knowledge-base/infrastructure/ansible-deployment.md#kb-176-slack通知チャンネル分離のデプロイトラブルシューティング環境変数反映問題)

#### Pi5から特定のクライアントのみ更新

```bash
# Pi5から実行
cd /opt/RaspberryPiSystem_002/infrastructure/ansible

# Pi3へのデプロイを実行（mainブランチを指定）
ANSIBLE_REPO_VERSION=main \
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
# 注意: 軽量サイネージは tmpfs の `/run/signage/current.jpg` を表示・更新します（SD書込み削減）。
ssh denkon5sd02@100.106.158.2 "ssh signageras3@100.105.224.86 'ls -lh /run/signage/current.jpg'"
```

**重要**: 
- デプロイ完了後は、Ansibleが自動的に`signage-lite.service`と`signage-lite-update.timer`を再有効化・再起動します。手動で`systemctl enable`や`systemctl start`を実行する必要はありません
- デプロイ前のプレフライトチェックで、Ansibleが自動的にサービスを停止・無効化・ランタイムマスクします（[KB-086](../knowledge-base/infrastructure/signage.md#kb-086-pi3サイネージデプロイ時のsystemdタスクハング問題)、[KB-089](../knowledge-base/infrastructure/signage.md#kb-089-pi3デプロイ時のサイネージサービス自動再起動によるメモリ不足ハング)参照）

**トラブルシューティング**:
- **デプロイがハングする**: サイネージサービスが停止・無効化されているか確認。メモリ使用状況を確認（120MB以上空きが必要）。Pi3デプロイは10-15分かかる可能性があるため、プロセスをkillせずに完了を待つ（[KB-096](../knowledge-base/infrastructure/backup-restore.md#kb-096-pi3デプロイに時間がかかる問題リポジトリの遅れメモリ制約)参照）
- **複数のAnsibleプロセスが実行されている**: 全てのプロセスをkillしてから再実行
- **デプロイが失敗する**: ログを確認（`logs/deploy/deploy-*.jsonl`）
- **Pi4でファイルが見つからないエラー**: リポジトリが古い、または権限問題の可能性があります（[KB-095](../knowledge-base/infrastructure/backup-restore.md#kb-095-pi4デプロイ時のファイルが見つからないエラーと権限問題)参照）

**関連ナレッジ**: 
- [KB-086](../knowledge-base/infrastructure/signage.md#kb-086-pi3サイネージデプロイ時のsystemdタスクハング問題): Pi3デプロイ時のsystemdタスクハング問題
- [KB-089](../knowledge-base/infrastructure/signage.md#kb-089-pi3デプロイ時のサイネージサービス自動再起動によるメモリ不足ハング): サイネージサービス自動再起動によるメモリ不足ハング
- [KB-096](../knowledge-base/infrastructure/backup-restore.md#kb-096-pi3デプロイに時間がかかる問題リポジトリの遅れメモリ制約): Pi3デプロイに時間がかかる問題

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
      VITE_API_BASE_URL: /api   # 相対パス（推奨、IPアドレス変更に対応）
      # または絶対URL（HTTPS経由、Caddy経由）
      # VITE_API_BASE_URL: https://100.106.158.2/api   # Pi5のTailscale IP（推奨）
```

**重要（2026-01-03更新）**: 
- `VITE_API_BASE_URL`は相対パス（`/api`）に設定することを推奨します（IPアドレス変更に対応）
- ポート8080は外部公開されていません（Docker内部ネットワークでのみアクセス可能）
- 外部アクセスはCaddy経由（HTTPS 443）で行います

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

**補足（運用経路別）**:
- **Ansible経路**: `scripts/update-all-clients.sh` 実行後に問題が出た場合、クライアント設定の復旧は `infrastructure/ansible/playbooks/rollback.yml` を使用する
- **統合デプロイ**: `scripts/deploy/deploy-all.sh` は `ROLLBACK_ON_FAIL=1` でロールバックを試行可能（事前に `ROLLBACK_CMD` を確認）
- **DBロールバックの原則**: 破壊的マイグレーションは避け、復旧はバックアップからのリストアを基本とする

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

6. **ローカルIPを使う場合の事前確認**
   ```bash
   # 各端末で実IPを取得してからgroup_vars/all.ymlを更新する
   ssh denkon5sd02@100.106.158.2 "hostname -I"
   ssh denkon5sd02@100.106.158.2 "ssh tools03@100.74.144.79 'hostname -I'"    # Pi4例（tailscale経由）
   ssh denkon5sd02@100.106.158.2 "ssh signageras3@100.105.224.86 'hostname -I'" # Pi3例（tailscale経由）
   ```
   - ローカルIPは変動するため、例のアドレス（192.168.x.x）はそのまま使わず、取得した値で`group_vars/all.yml`を更新する

### デプロイ後確認

**重要（2026-01-03更新）**: ポート8080は外部公開されていません。外部アクセスはCaddy経由（HTTPS 443）で行います。

1. **サーバーAPIヘルスチェック**
   ```bash
   # HTTPS経由（Caddy経由、推奨）
   curl -k https://100.106.158.2/api/system/health
   # → 200 OK を確認
   
   # またはDocker内部ネットワーク経由（Pi5上で実行）
   curl http://localhost:8080/api/system/health
   # → 200 OK を確認
   ```

2. **キオスク用API確認**
   ```bash
   # HTTPS経由（Caddy経由、推奨）
   curl -k -H 'x-client-key: client-key-raspberrypi4-kiosk1' https://100.106.158.2/api/tools/loans/active
   # → 200 OK を確認
   
   # またはDocker内部ネットワーク経由（Pi5上で実行）
   curl -H 'x-client-key: client-key-raspberrypi4-kiosk1' http://localhost:8080/api/tools/loans/active
   # → 200 OK を確認
   ```

3. **サイネージ用API確認**
   ```bash
   # HTTPS経由（Caddy経由、推奨）
   curl -k https://100.106.158.2/api/signage/content
   # → 200 OK を確認
   
   # またはDocker内部ネットワーク経由（Pi5上で実行）
   curl http://localhost:8080/api/signage/content
   # → 200 OK を確認
   ```

4. **Pi3サイネージデザイン変更の確認**（Pi5デプロイ後）
   ```bash
   # Pi5側のサイネージレンダラーが更新されていることを確認
   # Pi3のサイネージ画像を確認（左ペインタイトルが「持出中アイテム」、温度表示が追加されている）
   # 注意: 軽量サイネージは tmpfs の `/run/signage/current.jpg` を表示・更新します（SD書込み削減）。
   ssh denkon5sd02@100.106.158.2 'ssh signageras3@100.105.224.86 "ls -lh /run/signage/current.jpg"'
   # → 画像ファイルが更新されていることを確認（タイムスタンプが最新）
   ```
   
   **注意**: Pi3のサイネージデザイン変更（左ペインタイトル、温度表示）は**Pi5側のデプロイのみで反映**されます。Pi3へのデプロイは不要です（サーバー側レンダリングのため）。

5. **Pi4 systemdサービス確認**
   ```bash
   ssh denkon5sd02@100.106.158.2 'ssh tools03@100.74.144.79 "systemctl is-active kiosk-browser.service status-agent.timer"'
   # → active を確認
   ```

6. **Pi3サイネージサービスの確認**
   ```bash
   # 注意: Ansibleが自動的にサービスを再有効化・再起動するため、手動操作は不要
   # サービスが正常に動作していることを確認
   ssh denkon5sd02@100.106.158.2 'ssh signageras3@100.105.224.86 "systemctl is-active signage-lite.service"'
   # → active を確認（Ansibleが自動的に再有効化している）
   
   # 画像が更新されていることを確認
   ssh denkon5sd02@100.106.158.2 'ssh signageras3@100.105.224.86 "ls -lh /run/signage/current.jpg"'
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

## 新しいサイネージ端末（デバイスタイプ）の追加手順

**重要（2026-01-16更新）**: デバイスタイプ汎用化により、Pi3以外のサイネージ端末（Pi Zero 2Wなど）にも対応可能になりました。

### 手順概要

新しいサイネージ端末を追加する際は、以下の手順を実行してください：

1. **デバイスタイプ設定の追加**（`group_vars/all.yml`）
2. **inventoryファイルへの追加**（`inventory.yml`または`inventory-talkplaza.yml`）
3. **ネットワーク設定の追加**（`group_vars/all.yml`、必要に応じて）
4. **動作確認**

### 1. デバイスタイプ設定の追加

`infrastructure/ansible/group_vars/all.yml`の`device_type_defaults`に新しいデバイスタイプを追加します：

```yaml
device_type_defaults:
  # 新しいデバイスタイプの例（Pi Zero 2W）
  pi_zero_2w:
    memory_required_mb: 120  # デプロイに必要な最小メモリ（MB）
    stop_lightdm: true       # lightdm停止が必要か（GUIが必要な場合true）
    services_to_stop:        # デプロイ前に停止するサービスリスト
      - signage-lite.service
      - signage-lite-update.timer
      - signage-lite-watchdog.timer
      - signage-daily-reboot.timer
      - status-agent.timer
```

**設定項目の説明**:
- `memory_required_mb`: デプロイに必要な最小メモリ（MB）。デバイスのメモリ容量に応じて設定してください。
- `stop_lightdm`: `true`の場合、デプロイ前にlightdm（GUI）を停止してメモリを確保します。デプロイ完了後に自動的に再起動されます。
- `services_to_stop`: デプロイ前に停止するサービスリスト。デバイスごとに必要なサービスを指定してください。

### 2. inventoryファイルへの追加

`infrastructure/ansible/inventory.yml`（第2工場）または`infrastructure/ansible/inventory-talkplaza.yml`（トークプラザ工場）に新しいホストを追加します：

```yaml
raspberrypi-zero2w-signage01:
  ansible_host: "{{ signage_ip_02 }}"  # または直接IPアドレス
  ansible_user: signageras3
  device_type: "pi_zero_2w"  # デバイスタイプを指定
  manage_signage_lite: true
  status_agent_client_id: raspberrypi-zero2w-signage01
  status_agent_location: "ラズパイZero2W - サイネージ01"
  signage_server_url: "{{ server_base_url }}"
  signage_client_key: "{{ vault_signage_client_key | default('client-key-raspberrypi-zero2w-signage01') }}"
  services_to_restart:
    - signage-lite.service
    - signage-lite-update.timer
    - status-agent.service
    - status-agent.timer
  # ... その他の設定
```

**重要**: `device_type`変数を必ず指定してください。未指定の場合は`default`設定が使用されます。

### 3. ネットワーク設定の追加（必要に応じて）

新しいデバイスのIPアドレスを`group_vars/all.yml`に追加します：

```yaml
local_network:
  raspberrypi_zero2w_signage01_ip: "192.168.10.225"

tailscale_network:
  raspberrypi_zero2w_signage01_ip: "100.105.224.87"
```

### 4. 動作確認

```bash
# 構文チェック
cd /Users/tsudatakashi/RaspberryPiSystem_002/infrastructure/ansible
ansible-playbook --syntax-check playbooks/deploy.yml -i inventory.yml

# 接続テスト
ansible-playbook playbooks/ping.yml -i inventory.yml --limit raspberrypi-zero2w-signage01

# デプロイテスト（必要に応じて）
ansible-playbook playbooks/deploy.yml -i inventory.yml --limit raspberrypi-zero2w-signage01
```

### 既存デバイスタイプの確認

現在サポートされているデバイスタイプ：

- **pi3**: Raspberry Pi 3（メモリ416MB、lightdm停止が必要）
- **pi_zero_2w**: Raspberry Pi Zero 2W（メモリ512MB、lightdm停止が必要）
- **default**: デフォルト設定（device_type未指定時）

### トラブルシューティング

- **デバイスタイプが見つからない**: `device_type_defaults`に設定が追加されているか確認してください。
- **メモリ不足エラー**: `memory_required_mb`の値を調整するか、`stop_lightdm: true`を設定してください。
- **サービスが起動しない**: `services_to_stop`に必要なサービスが含まれているか確認してください。

詳細は [KB-169](../knowledge-base/infrastructure/signage.md#kb-169-pi3デプロイ時のlightdm停止によるメモリ確保と自動再起動) を参照してください。

## 関連ドキュメント

- [クイックスタートガイド](./quick-start-deployment.md): 一括更新とクライアント監視のクイックスタート
- [環境構築ガイド](./environment-setup.md): ローカルネットワーク変更時の対応
- [Ansible SSH接続アーキテクチャの説明](./ansible-ssh-architecture.md): SSH接続の構成と説明
- [本番環境セットアップガイド](./production-setup.md): 本番環境の初期セットアップ（環境変数の管理、新しいPi5での環境構築手順を含む）
- [バックアップ・リストアガイド](./backup-and-restore.md): バックアップとリストアの手順（デバイスごとのバックアップ対象を含む）
- [監視・アラートガイド](./monitoring.md): システム監視とアラート設定

