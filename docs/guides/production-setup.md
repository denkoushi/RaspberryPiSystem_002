# 本番環境セットアップガイド

最終更新: 2025-12-18

## HTTPSの強制

本番環境では、HTTPSを強制することを推奨します。カメラAPIなどのブラウザAPIを使用する場合は、HTTPS接続が必須です。

## HTTPS設定方法の選択

### 方法1: 自己署名証明書を使用したHTTPS（工場現場での運用に推奨）

**推奨理由:**
- ローカルネットワーク内でのみアクセスする工場現場に最適
- インターネット接続が不要
- ドメイン名が不要
- セットアップが簡単で、メンテナンスが容易

**メリット:**
- ✅ インターネット接続不要（オフライン環境でも動作）
- ✅ ドメイン名不要（IPアドレスまたはローカルホスト名でアクセス可能）
- ✅ セットアップが簡単（一度設定すれば永続的）
- ✅ 証明書の有効期限切れの心配がない（長期間有効な証明書を生成可能）
- ✅ セキュリティ要件を満たす（HTTPS接続によりカメラAPIが動作）

**デメリット:**
- ⚠️ 初回アクセス時にブラウザが警告を表示（証明書を信頼する必要がある）
- ⚠️ 証明書を各クライアント端末にインストールする必要がある（一度だけ）

**設定手順:**

1. **自己署名証明書の生成**

   Raspberry Pi 5で以下のコマンドを実行：

   ```bash
   sudo mkdir -p /opt/RaspberryPiSystem_002/certs
   cd /opt/RaspberryPiSystem_002/certs
   
   sudo openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 3650 -nodes \
     -subj "/C=JP/ST=Tokyo/L=Tokyo/O=Factory/CN=raspberrypi.local"
   
   sudo chmod 644 cert.pem
   sudo chmod 600 key.pem
   sudo chown $USER:$USER cert.pem key.pem
   ```

2. **Docker Compose設定の更新**

   `docker-compose.server.yml`を更新：

   ```yaml
   web:
     environment:
       USE_LOCAL_CERTS: "true"
     volumes:
       - thumbnail-storage:/srv/storage/thumbnails:ro
       - ./certs:/srv/certs:ro  # 証明書をマウント
     ports:
       - "80:80"
       - "443:443"
   ```

3. **証明書の信頼設定（各クライアント端末）**

   Raspberry Pi 4（クライアント）のブラウザで証明書を信頼する必要があります。詳細は[クライアントデバイス統合アーキテクチャ](../architecture/client-device-integration.md)を参照してください。

---

### 方法2: Let's Encryptを使用したHTTPS

**前提条件:**
- ドメイン名が設定されていること
- ポート80と443が外部からアクセス可能であること
- インターネット接続が安定していること

**メリット:**
- ✅ ブラウザが自動的に証明書を信頼（警告なし）
- ✅ 無料で証明書を取得可能
- ✅ 証明書の自動更新が可能（Caddyが自動で処理）

**デメリット:**
- ❌ インターネット接続が必須（証明書の取得と更新のため）
- ❌ ドメイン名が必要
- ❌ DNS設定が必要
- ❌ ポート80と443が外部からアクセス可能である必要がある

**設定手順:**

1. **環境変数の設定**

   `docker-compose.server.yml`または`.env`ファイルに以下を追加：

   ```yaml
   web:
     environment:
       DOMAIN: your-domain.com
       CADDY_ADMIN_EMAIL: admin@your-domain.com
     ports:
       - "80:80"
       - "443:443"
   ```

2. **Caddyfile.productionの使用**

   `DOMAIN`環境変数が設定されている場合、自動的に`Caddyfile.production`が使用されます。

3. **証明書の自動取得**

   CaddyはLet's Encryptを使用して自動的に証明書を取得します。

4. **HTTPからHTTPSへのリダイレクト**

   HTTPアクセスは自動的にHTTPSにリダイレクトされます。

---

### 開発環境での動作

`DOMAIN`環境変数も`USE_LOCAL_CERTS`環境変数も設定されていない場合、開発用の`Caddyfile`（HTTPのみ）が使用されます。

**注意:** 開発環境でカメラAPIを使用する場合は、`USE_LOCAL_CERTS=true`を設定してHTTPSを有効化してください。

---

## セキュリティヘッダー

本番環境用Caddyfileには以下のセキュリティヘッダーが含まれています：

- `Strict-Transport-Security`: HSTS（HTTP Strict Transport Security）
- `X-Content-Type-Options`: MIMEタイプスニッフィング対策
- `X-Frame-Options`: クリックジャッキング対策
- `X-XSS-Protection`: XSS対策
- `Referrer-Policy`: リファラー情報の制御

---

## トラブルシューティング

### 証明書の警告が表示される（自己署名証明書の場合）

- 各クライアント端末で証明書を信頼する設定を行ってください
- 詳細は[クライアントデバイス統合アーキテクチャ](../architecture/client-device-integration.md)を参照

### 証明書が取得できない（Let's Encryptの場合）

- ポート80と443が外部からアクセス可能であることを確認
- ドメインのDNS設定が正しいことを確認
- ファイアウォールでポート80と443が開いていることを確認

### HTTPリダイレクトが動作しない

- `DOMAIN`環境変数または`USE_LOCAL_CERTS`環境変数が正しく設定されていることを確認
- Caddyのログを確認：`docker compose logs web`

### HTTPS接続できない

- ポート443が開いていることを確認：`sudo netstat -tlnp | grep 443`
- ファイアウォールでポート443が許可されていることを確認
- Dockerコンテナが正常に起動していることを確認：`docker compose ps`

### カメラAPIが動作しない

- HTTPS接続が確立されていることを確認（アドレスバーに鍵アイコンが表示される）
- ブラウザのコンソールでエラーを確認
- `navigator.mediaDevices`が存在することを確認（開発者ツールのコンソールで `navigator.mediaDevices` を実行）

---

## 環境変数の管理

### 重要な原則

**リモートリポジトリに置かない情報**:
- **機密情報**: パスワード、APIキー、トークンなど
- **デバイス固有の設定**: IPアドレス、証明書ファイルなど
- **本番環境の環境変数**: `.env`ファイル（`.env.example`はリポジトリに含まれる）

**リモートリポジトリに置く情報**:
- **テンプレートファイル**: `.env.example`、Ansibleテンプレート（`.j2`ファイル）
- **デフォルト値**: 開発環境用のデフォルト設定
- **設定の構造**: どの環境変数が必要か、どのような形式か

### 環境変数ファイルの種類

システムでは以下の環境変数ファイルが使用されます：

| ファイル | 場所 | 用途 | リポジトリに含まれるか |
|---------|------|------|---------------------|
| `apps/api/.env` | Pi5上 | APIサーバーの環境変数 | ❌ 含まれない（`.env.example`は含まれる） |
| `apps/web/.env` | Pi5上 | Webサーバーの環境変数 | ❌ 含まれない（`.env.example`は含まれる） |
| `infrastructure/docker/.env` | Pi5上 | Docker Composeの環境変数 | ❌ 含まれない |
| `clients/nfc-agent/.env` | Pi4上 | NFCエージェントの環境変数 | ❌ 含まれない（`.env.example`は含まれる） |

### 新しいPi5で環境構築する際の手順

#### ステップ1: リポジトリをクローン

```bash
# Pi5上で実行
cd /opt
git clone https://github.com/denkoushi/RaspberryPiSystem_002.git RaspberryPiSystem_002
cd RaspberryPiSystem_002
```

#### ステップ2: 環境変数ファイルを作成

`.env.example`ファイルをコピーして`.env`ファイルを作成し、本番環境用の値を設定します：

```bash
# APIの環境変数ファイルを作成
cd /opt/RaspberryPiSystem_002
cp apps/api/.env.example apps/api/.env

# 本番環境用の値を設定（エディタで編集）
nano apps/api/.env
```

**設定すべき主な環境変数**:

```bash
# PostgreSQLパスワード（強力なパスワードを設定）
POSTGRES_PASSWORD="your-strong-password-here"

# データベースURL（パスワードは環境変数から取得）
DATABASE_URL="postgresql://postgres:${POSTGRES_PASSWORD}@db:5432/borrow_return"

# JWTシークレット（強力なランダム文字列を設定）
JWT_ACCESS_SECRET="your-access-secret-here"
JWT_REFRESH_SECRET="your-refresh-secret-here"
```

#### ステップ3: Docker Composeの環境変数ファイルを作成

```bash
# Docker Composeの環境変数ファイルを作成
# 注意: docker-compose.server.ymlと同じディレクトリ（infrastructure/docker/）に作成
cd /opt/RaspberryPiSystem_002/infrastructure/docker
cat > .env <<EOF
# PostgreSQLパスワード（強力なパスワードを設定）
POSTGRES_PASSWORD=your-strong-password-here
EOF

# ファイルのパーミッションを設定（所有者のみ読み書き可能）
chmod 600 .env
chmod 600 ../../apps/api/.env
```

**重要**: `docker-compose.server.yml`は`infrastructure/docker/.env`ファイルを自動的に読み込みます（`env_file: - .env`で指定）。

#### ステップ4: パスワードを生成する方法

```bash
# 強力なランダムパスワードを生成
openssl rand -base64 32

# または、複数のパスワードが必要な場合
for i in {1..3}; do
  echo "Password $i: $(openssl rand -base64 32)"
done
```

#### ステップ5: 証明書ファイルの配置

```bash
# 証明書ディレクトリを作成
sudo mkdir -p /opt/RaspberryPiSystem_002/certs

# 既存のPi5から証明書ファイルをコピー（または新規生成）
# 既存のPi5から:
# scp denkon5sd02@100.106.158.2:/opt/RaspberryPiSystem_002/certs/* /opt/RaspberryPiSystem_002/certs/

# または新規生成（上記の「自己署名証明書の生成」セクションを参照）
```

#### ステップ6: IPアドレス設定の更新

```bash
# group_vars/all.ymlのIPアドレスを新しいPi5のIPアドレスに更新
nano infrastructure/ansible/group_vars/all.yml

# 現在のIPアドレスを確認
hostname -I

# local_network.raspberrypi5_ip を新しいIPアドレスに更新
# tailscale_network.raspberrypi5_ip をTailscale IPアドレスに更新（Tailscaleを使用する場合）
```

#### ステップ7: 依存関係のインストールとビルド

```bash
cd /opt/RaspberryPiSystem_002
pnpm install
cd packages/shared-types && pnpm build && cd ../..
cd apps/api && pnpm prisma generate && cd ../..
```

#### ステップ8: Docker Composeの起動

```bash
cd /opt/RaspberryPiSystem_002
docker compose -f infrastructure/docker/docker-compose.server.yml up -d
```

#### ステップ9: データベースのリストア（既存データがある場合）

```bash
# バックアップファイルからリストア
cd /opt/RaspberryPiSystem_002
./scripts/server/restore.sh /opt/backups/db_backup_YYYYMMDD_HHMMSS.sql.gz
```

#### ステップ10: 動作確認

```bash
# ヘルスチェック
curl -k https://localhost/api/system/health

# データベース接続確認
docker compose -f infrastructure/docker/docker-compose.server.yml exec db \
  psql -U postgres -d borrow_return -c "SELECT COUNT(*) FROM \"Loan\";"
```

### 環境変数の管理ベストプラクティス

#### 1. パスワードの生成と管理

```bash
# 強力なパスワードを生成
openssl rand -base64 32

# パスワードを安全に保存
# - パスワードマネージャーを使用
# - Ansible Vaultを使用（Ansibleで管理する場合）
# - 暗号化されたUSBメディアに保存
```

#### 2. 環境変数ファイルの保護

```bash
# ファイルのパーミッションを設定（所有者のみ読み書き可能）
chmod 600 apps/api/.env
chmod 600 infrastructure/docker/.env

# .gitignoreに.envファイルが含まれていることを確認
grep -q "\.env$" .gitignore && echo "OK" || echo "WARNING: .env not in .gitignore"
```

#### 3. 環境変数の変更時の対応

環境変数を変更した場合：

1. **変更を記録**: 変更内容をメモ（パスワードマネージャーなど）
2. **バックアップを実行**: `./scripts/server/backup.sh`でバックアップ
3. **Docker Composeを再起動**: 環境変数の変更を反映
   ```bash
   docker compose -f infrastructure/docker/docker-compose.server.yml down
   docker compose -f infrastructure/docker/docker-compose.server.yml up -d
   ```

### デバイス固有設定の管理

#### Pi5（サーバー）にのみ存在する情報

| 情報の種類 | 場所 | バックアップが必要か | 管理方法 |
|-----------|------|-------------------|---------|
| **環境変数ファイル** | `apps/api/.env`, `apps/web/.env`, `infrastructure/docker/.env` | ✅ **必須** | `.env.example`をコピーして作成、バックアップスクリプトで自動バックアップ |
| **証明書ファイル** | `/opt/RaspberryPiSystem_002/certs/` | ✅ **必須** | 自己署名証明書を生成、手動でバックアップ |
| **IPアドレス設定** | `infrastructure/ansible/group_vars/all.yml` | ⚠️ **推奨** | Ansible変数で管理、リポジトリに含まれる（デバイスごとに異なる値） |
| **データベース** | Dockerボリューム `db-data` | ✅ **必須** | バックアップスクリプトで自動バックアップ |
| **写真・PDFファイル** | `/opt/RaspberryPiSystem_002/storage/` | ✅ **必須** | バックアップスクリプトで自動バックアップ |

#### Pi4（キオスク）にのみ存在する情報

| 情報の種類 | 場所 | バックアップが必要か | 管理方法 |
|-----------|------|-------------------|---------|
| **環境変数ファイル** | `clients/nfc-agent/.env` | ⚠️ **推奨** | `.env.example`をコピーして作成、Ansibleでデプロイ可能 |
| **NFCリーダー設定** | システム設定 | ❌ 不要 | ハードウェア設定、再設定可能 |

#### Pi3（サイネージ）にのみ存在する情報

| 情報の種類 | 場所 | バックアップが必要か | 管理方法 |
|-----------|------|-------------------|---------|
| **ブラウザ設定** | Chromium設定 | ❌ 不要 | 再設定可能 |

### 既存のPi5から新しいPi5へ移行する場合

#### コピーすべきファイル

1. **環境変数ファイル**（`.env`）
   ```bash
   # 既存のPi5からコピー
   # 注意: パスワードなどの機密情報が含まれるため、安全な方法でコピーすること
   scp denkon5sd02@100.106.158.2:/opt/RaspberryPiSystem_002/apps/api/.env /opt/RaspberryPiSystem_002/apps/api/.env
   scp denkon5sd02@100.106.158.2:/opt/RaspberryPiSystem_002/infrastructure/docker/.env /opt/RaspberryPiSystem_002/infrastructure/docker/.env
   
   # ファイルのパーミッションを設定
   chmod 600 /opt/RaspberryPiSystem_002/apps/api/.env
   chmod 600 /opt/RaspberryPiSystem_002/infrastructure/docker/.env
   ```

2. **証明書ファイル**（`certs/`）
   ```bash
   # 既存のPi5からコピー
   scp -r denkon5sd02@100.106.158.2:/opt/RaspberryPiSystem_002/certs /opt/RaspberryPiSystem_002/
   
   # ファイルのパーミッションを設定
   sudo chmod 644 /opt/RaspberryPiSystem_002/certs/cert.pem
   sudo chmod 600 /opt/RaspberryPiSystem_002/certs/key.pem
   ```

3. **データベースバックアップ**（既存データを復元する場合）
   ```bash
   # バックアップディレクトリを作成
   mkdir -p /opt/backups
   
   # 既存のPi5から最新のバックアップをコピー
   scp denkon5sd02@100.106.158.2:/opt/backups/db_backup_*.sql.gz /opt/backups/
   ```

## 関連ドキュメント

- [クライアントデバイス統合アーキテクチャ](../architecture/client-device-integration.md) - デバイス統合パターンと拡張性
- [アーキテクチャ概要](../architecture/overview.md) - システム全体のアーキテクチャ
- [デプロイメントガイド](./deployment.md) - デプロイ手順の詳細
- [バックアップ・リストア手順](./backup-and-restore.md) - バックアップとリストアの詳細

