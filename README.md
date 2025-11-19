# Raspberry Pi NFC 工場持出返却システム

本リポジトリは Raspberry Pi 5 サーバー + Raspberry Pi 4 クライアントで構成される持出返却システムのモノレポです。全体の背景、マイルストーン、詳細手順は `EXEC_PLAN.md` を参照してください。.agent/PLANS.md の運用ルールに従って ExecPlan を更新しつつ実装を進めます。

## ディレクトリ概要

- `apps/api`: Fastify + Prisma を用いたサーバー API
- `apps/web`: React + Vite の Web UI（キオスク／管理画面）
- `clients/nfc-agent`: Sony RC-S300/S1 と連携する Python NFC ブリッジ
- `infrastructure/docker`: Dockerfile と Compose マニフェスト
- `scripts/`: サーバー・クライアントのセットアップスクリプト

## 開発準備

1. Node.js 18.18 以上（推奨: 20.x）と pnpm をインストールし、`corepack enable` を実行
2. Python 3.11 + Poetry をインストール
3. ルートで `pnpm install` を実行してワークスペース依存を取得
4. `poetry install -C clients/nfc-agent` で NFC エージェント依存をセットアップ
5. 必要な `.env` ファイルを `.env.example` からコピー

## API 開発メモ

- Prisma マイグレーション: `cd apps/api && DATABASE_URL="postgresql://postgres:postgres@localhost:5432/borrow_return" pnpm prisma migrate dev`
- シードデータ投入: `cd apps/api && DATABASE_URL="..." pnpm prisma db seed`
- サーバー起動: `cd apps/api && pnpm dev`
- テスト: `cd apps/api && pnpm test`

## Web アプリ開発メモ

- 開発サーバー: `cd apps/web && pnpm dev` (デフォルト: http://localhost:4173)
- Lint/Test/Build: `cd apps/web && pnpm lint && pnpm test && pnpm build`
- キオスク端末は `.env` の `VITE_AGENT_WS_URL`（既定: `ws://localhost:7071/stream`）でローカル NFC エージェントに接続する
- USB メモリからのマスタ一括登録は管理画面「一括登録」ページから `employees.csv` / `items.csv` を選択して実行する（CSVはUTF-8、ヘッダー行必須）

## Raspberry Pi 5 サーバーセットアップ

### 必要なソフトウェア

- Raspberry Pi OS (64bit) or Debian Bookworm 相当
- `git`, `curl`, `build-essential`
- Docker Engine + Docker Compose v2  
  ```bash
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker $USER
  ```
- Node.js 20 系（`nvm` もしくは `curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -`）
- pnpm (`corepack enable`)
- Python 3.11 + Poetry（クライアント開発や手元検証用）

### インストール手順

1. 上記ソフトウェアをインストールし、Pi を再起動後に `docker run hello-world` で動作確認
2. リポジトリをクローン  
   ```bash
   git clone https://github.com/denkoushi/RaspberryPiSystem_002.git /opt/RaspberryPiSystem_002
   cd /opt/RaspberryPiSystem_002
   ```
3. 環境変数を設定  
   - `apps/api/.env.example` を `apps/api/.env` にコピーし、`DATABASE_URL`（例: `postgresql://postgres:postgres@db:5432/borrow_return`）と JWT シークレット、初期管理者情報を入力
   - 必要に応じて `apps/web/.env` や `clients/nfc-agent/.env` も `.env.example` から作成
4. デプロイ  
   ```bash
   scripts/server/deploy.sh
   ```
   - 内部で `docker compose -f infrastructure/docker/docker-compose.server.yml build --pull` → `up -d` を実行
5. 動作確認  
   ```bash
   docker compose -f infrastructure/docker/docker-compose.server.yml ps
   curl http://localhost:8080/health
   ```
   `{"status":"ok"}` が返れば API・DB・Web すべてが稼働中

## トラブルシューティング

### Prisma が `libssl.so.1.1` を要求して落ちる

- **症状**: `PrismaClientInitializationError: libssl.so.1.1: cannot open shared object file`
- **原因**: Alpine ベースの `node:20-alpine` でビルドした際に OpenSSL 1.1 ライブラリが存在しない
- **解決策**:
  1. `infrastructure/docker/Dockerfile.api` のベースを `node:20-bookworm-slim`（Debian/glibc）に固定
  2. build / runtime 両方のステージで `apt-get install -y openssl` を実行
  3. Prisma の `binaryTargets = ["native", "linux-arm64-openssl-3.0.x"]` を維持し、`pnpm prisma generate` を忘れない
  4. 変更後は `docker compose -f infrastructure/docker/docker-compose.server.yml build --no-cache api` を実行し、古いレイヤーを使い回さない

### Docker ビルドキャッシュ破損

- **症状**: `parent snapshot ... does not exist` など export 段階で失敗
- **対処**:
  ```bash
  docker builder prune --all --force
  docker compose -f infrastructure/docker/docker-compose.server.yml build --no-cache api
  ```
  必要であれば `docker system prune --volumes` も併用

### Web UI の直接URLアクセスで404エラー

- **症状**: `/admin/employees` などに直接アクセスすると HTTP 404
- **原因**: SPAのクライアントサイドルーティングがサーバー側で処理されていない
- **解決策**:
  1. `infrastructure/docker/Caddyfile` に SPA フォールバック設定を追加:
     ```caddyfile
     @spa {
       not file
     }
     rewrite @spa /index.html
     ```
  2. `infrastructure/docker/Dockerfile.web` の CMD を修正:
     ```dockerfile
     CMD ["caddy", "run", "--config", "/srv/Caddyfile"]
     ```
  3. `docker-compose.server.yml` のポート設定を確認（Caddy は内部で 80 番ポートを使用）:
     ```yaml
     ports:
       - "4173:80"
     ```
  4. 再ビルド:
     ```bash
     docker compose -f infrastructure/docker/docker-compose.server.yml up -d --build web
     ```

### 重要な注意点

- サーバー用 Dockerfile では Alpine を使用しない（OpenSSL の互換パッケージが公式から消えたため）
- ランタイムステージでも `pnpm install --prod` と `pnpm prisma generate` を実行し、ワークスペース依存を正しく解決する
- ベースイメージ変更後は常に `--no-cache` ビルド → `curl http://localhost:8080/health` で確認
- Pi5 を電源オフすると Docker コンテナが停止したままになるため、再起動後は `docker compose -f infrastructure/docker/docker-compose.server.yml up -d` を実行するか、`docker-compose.server.yml` に `restart: always` を設定して自動復帰させる

## クライアント (Raspberry Pi 4) セットアップ

### 想定環境
- Debian GNU/Linux 13 (trixie) / Raspberry Pi OS 64bit
- ユーザー例: `tools03`
- NFC リーダー: Sony RC-S380 / RC-S300（`lsusb` で `054c:0dc8`）

### 手順
1. システム更新  
   ```bash
   sudo apt update && sudo apt upgrade -y
   ```
2. 必要パッケージ  
   ```bash
   sudo apt install -y git curl pcscd libpcsclite-dev python3-pyscard pcsc-tools chromium
   sudo systemctl enable --now pcscd
   ```
3. リーダー確認  
   ```bash
   lsusb | grep -i sony
   pcsc_scan  # 認識したら Ctrl+C
   ```
4. Docker インストール  
   ```bash
   curl -fsSL https://get.docker.com | sudo sh
   sudo usermod -aG docker $USER
   newgrp docker
   docker --version && docker compose version
   ```
5. Poetry  
   ```bash
   curl -sSL https://install.python-poetry.org | python3 -
   echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
   source ~/.bashrc
   poetry --version
   ```
6. リポジトリ配置  
   ```bash
   sudo mkdir -p /opt/RaspberryPiSystem_002
   sudo chown $USER:$USER /opt/RaspberryPiSystem_002
   git clone https://github.com/denkoushi/RaspberryPiSystem_002.git /opt/RaspberryPiSystem_002
   ```
7. NFC エージェント依存  
   ```bash
   cd /opt/RaspberryPiSystem_002/clients/nfc-agent
   poetry install
   cp .env.example .env
   mkdir -p ~/.local/share/nfc-agent
   ```
   `.env` 例:  
   ```
   API_BASE_URL=http://192.168.10.230:8080
   CLIENT_ID=pi4-tools03
   AGENT_MODE=production
   QUEUE_DB_PATH=/home/<user>/.local/share/nfc-agent/queue.db
   ```
8. 起動 & 確認  
   ```bash
   poetry run python -m nfc_agent
   curl http://localhost:7071/api/agent/status
   ```
   `readerConnected: true` で `message: "監視中"` なら成功。カードをかざすと `lastEvent` に UID が追加される。

※ Chromium は Debian 13 以降 `chromium-browser` パッケージが無いため `chromium` を使用。

## 今後の拡張

- `ImportJob` テーブルと `/api/imports/*` エンドポイントを共通ジョブ管理基盤として用意しており、PDF/Excel ビューワーや将来の物流管理モジュールが同じ仕組みでジョブ履歴やファイル投入を扱える
- 新機能を追加する際は `apps/api/src/routes`・`apps/web/src/pages` で独立したモジュールを増やし、Docker Compose でサービスを疎結合に保つ

各マイルストーンの詳細な実行手順と検証方法は ExecPlan を確認してください。
