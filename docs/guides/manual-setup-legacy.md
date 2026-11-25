# 手作業セットアップ手順（参考）

通常は Ansible で構築します（`docs/guides/deployment.md`、`docs/guides/client-initial-setup.md`）。これは手作業の参考手順です。

## Raspberry Pi 5 サーバー

### 必要なソフトウェア

- Raspberry Pi OS (64bit) or Debian Bookworm 相当
- `git`, `curl`, `build-essential`
- Docker Engine + Docker Compose v2  
  ```bash
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker $USER
  ```
- Node.js 24 系（推奨: `nvm`）
  - NodeSource（`deb.nodesource.com`）はOS側のGPG/署名ポリシー変更で `apt update` が失敗し、デプロイが中断する場合があります（例: 2026-02-01以降のSHA1拒否。詳細はKB-220）。
  - `curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -` を使う場合は、`/etc/apt/sources.list.d/nodesource.list` が残り続ける点に注意してください。
- pnpm（リポジトリのルートで `npm install -g "$(node -p "require('./package.json').packageManager")"`）
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

## Raspberry Pi 4 クライアント

### 想定環境
- Debian GNU/Linux 13 (trixie) / Raspberry Pi OS 64bit
- ユーザー: 端末ごとの運用ユーザー
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
   API_BASE_URL=http://<サーバーのアドレス>:8080
   CLIENT_ID=<端末ID>
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
