# 工場現場でのHTTPS設定ガイド

最終更新: 2025-11-27

## 概要

工場現場での365日運用において、カメラAPIを使用するためにはHTTPS接続が必要です。本ドキュメントでは、工場現場での運用に最適なHTTPS設定方法を説明します。

## 選択肢の比較

### 方法1: 自己署名証明書を使用したHTTPS（推奨）

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

**適用シーン:**
- 工場内のローカルネットワークでのみアクセス
- インターネット接続が不安定または不要
- 固定のIPアドレスまたはホスト名でアクセス
- セキュリティ要件を満たしつつ、シンプルな運用を希望

---

### 方法2: Let's Encryptを使用したHTTPS

**メリット:**
- ✅ ブラウザが自動的に証明書を信頼（警告なし）
- ✅ 無料で証明書を取得可能
- ✅ 証明書の自動更新が可能（Caddyが自動で処理）

**デメリット:**
- ❌ インターネット接続が必須（証明書の取得と更新のため）
- ❌ ドメイン名が必要（例: `factory.example.com`）
- ❌ DNS設定が必要（ドメインをRaspberry PiのIPアドレスに解決）
- ❌ ポート80と443が外部からアクセス可能である必要がある（ファイアウォール設定）
- ❌ 証明書の更新が失敗する可能性（インターネット接続の不安定さ）

**適用シーン:**
- インターネット接続が安定している
- ドメイン名を取得・設定できる
- 外部からアクセスする必要がある

---

### 方法3: HTTP接続（非推奨）

**デメリット:**
- ❌ カメラAPIが動作しない（ブラウザのセキュリティ制限）
- ❌ セキュリティリスク（通信が暗号化されない）

**結論:**
カメラAPIを使用するためには、この方法は使用できません。

---

## 推奨: 自己署名証明書を使用したHTTPS設定

工場現場での365日運用には、**自己署名証明書を使用したHTTPS**を推奨します。

### 設定手順

#### 1. 自己署名証明書の生成

Raspberry Pi 5で以下のコマンドを実行して証明書を生成します：

```bash
# 証明書保存ディレクトリを作成
sudo mkdir -p /opt/RaspberryPiSystem_002/certs
cd /opt/RaspberryPiSystem_002/certs

# 自己署名証明書を生成（有効期限10年）
sudo openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 3650 -nodes \
  -subj "/C=JP/ST=Tokyo/L=Tokyo/O=Factory/CN=raspberrypi.local"

# 権限を設定
sudo chmod 644 cert.pem
sudo chmod 600 key.pem
sudo chown $USER:$USER cert.pem key.pem
```

**注意:**
- `CN`（Common Name）には、Raspberry Pi 5のIPアドレスまたはホスト名を指定します
- 例: `CN=192.168.10.230` または `CN=raspberrypi.local`

#### 2. Caddyfileの作成

自己署名証明書を使用するCaddyfileを作成します：

```bash
# infrastructure/docker/Caddyfile.local を作成
cat > infrastructure/docker/Caddyfile.local << 'EOF'
# ローカルネットワーク用Caddyfile（自己署名証明書使用）

{
  # 自己署名証明書を使用するため、自動HTTPSを無効化
  auto_https off
}

# HTTPS設定（ポート443）
:443 {
  # 自己署名証明書のパスを指定
  tls /srv/certs/cert.pem /srv/certs/key.pem

  root * /srv/site

  @api {
    path /api/*
    path /ws/*
  }
  reverse_proxy @api api:8080

  # サムネイルの静的ファイル配信（認証不要）
  handle_path /storage/thumbnails/* {
    root * /srv/storage/thumbnails
    file_server
    header Cache-Control "public, max-age=86400" # 1日キャッシュ
  }

  @spa {
    not path /api/*
    not path /ws/*
    not path /storage/*
    not file
  }
  rewrite @spa /index.html
  file_server

  # セキュリティヘッダー
  header {
    X-Content-Type-Options "nosniff"
    X-Frame-Options "DENY"
    X-XSS-Protection "1; mode=block"
    Referrer-Policy "strict-origin-when-cross-origin"
  }
}

# HTTPからHTTPSへのリダイレクト（ポート80）
:80 {
  redir https://{host}{uri} permanent
}
EOF
```

#### 3. Docker Compose設定の更新

`docker-compose.server.yml`を更新して、証明書をマウントし、Caddyfile.localを使用するように設定します：

```yaml
web:
  build:
    context: ../..
    dockerfile: infrastructure/docker/Dockerfile.web
    args:
      VITE_AGENT_WS_URL: ${VITE_AGENT_WS_URL:-ws://192.168.10.223:7071/stream}
      VITE_API_BASE_URL: ${VITE_API_BASE_URL:-/api}
  depends_on:
    - api
  volumes:
    - thumbnail-storage:/srv/storage/thumbnails:ro
    - ./certs:/srv/certs:ro  # 証明書をマウント
  ports:
    - "80:80"
    - "443:443"  # HTTPSポートを追加
  command: ["caddy", "run", "--config", "/srv/Caddyfile.local"]
```

#### 4. Dockerfile.webの更新

`Caddyfile.local`をコンテナにコピーするように`Dockerfile.web`を更新します：

```dockerfile
# Dockerfile.web の最後に追加
COPY infrastructure/docker/Caddyfile.local ./Caddyfile.local
```

#### 5. 証明書の信頼設定（各クライアント端末）

Raspberry Pi 4（クライアント）のブラウザで証明書を信頼する必要があります：

**Chrome/Edgeの場合:**
1. Raspberry Pi 5にHTTPSでアクセス: `https://192.168.10.230`
2. ブラウザが警告を表示するので、「詳細設定」→「続行」をクリック
3. アドレスバーの「保護されていない通信」アイコンをクリック
4. 「証明書」をクリック
5. 「詳細」タブ→「ファイルにコピー」をクリック
6. 証明書をデスクトップなどに保存
7. Raspberry Pi 4で証明書を開き、「信頼」タブで「この証明書を信頼する」にチェック

**Firefoxの場合:**
1. Raspberry Pi 5にHTTPSでアクセス: `https://192.168.10.230`
2. アドレスバーの「保護されていない接続」をクリック
3. 「詳細情報」→「証明書を表示」をクリック
4. 「証明書のダウンロード」をクリック
5. Firefoxの設定→「プライバシーとセキュリティ」→「証明書」→「証明書を表示」
6. 「認証局証明書」タブで「インポート」をクリック
7. ダウンロードした証明書を選択してインポート

**注意:**
- 証明書の信頼設定は、各クライアント端末で一度だけ行えばOKです
- 証明書を更新した場合は、再度信頼設定が必要です

---

## 運用時の注意事項

### 証明書の有効期限

- 自己署名証明書は10年間有効に設定していますが、必要に応じて更新できます
- 証明書の有効期限が切れる前に更新することを推奨します

### 証明書の更新手順

```bash
# 証明書を再生成
cd /opt/RaspberryPiSystem_002/certs
sudo openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 3650 -nodes \
  -subj "/C=JP/ST=Tokyo/L=Tokyo/O=Factory/CN=raspberrypi.local"

# Dockerコンテナを再起動
cd /opt/RaspberryPiSystem_002
docker compose -f infrastructure/docker/docker-compose.server.yml restart web
```

### バックアップ

証明書もバックアップに含めることを推奨します：

```bash
# バックアップスクリプトに証明書のバックアップを追加
tar -czf /opt/backups/certs_backup_$(date +%Y%m%d_%H%M%S).tar.gz /opt/RaspberryPiSystem_002/certs
```

---

## トラブルシューティング

### 証明書の警告が表示される

- 各クライアント端末で証明書を信頼する設定を行ってください（上記の手順を参照）

### HTTPS接続できない

- ポート443が開いていることを確認: `sudo netstat -tlnp | grep 443`
- ファイアウォールでポート443が許可されていることを確認
- Dockerコンテナが正常に起動していることを確認: `docker compose ps`

### カメラAPIが動作しない

- HTTPS接続が確立されていることを確認（アドレスバーに鍵アイコンが表示される）
- ブラウザのコンソールでエラーを確認
- `navigator.mediaDevices`が存在することを確認（開発者ツールのコンソールで `navigator.mediaDevices` を実行）

---

## まとめ

工場現場での365日運用には、**自己署名証明書を使用したHTTPS**が最適です。

**理由:**
1. インターネット接続が不要（オフライン環境でも動作）
2. ドメイン名が不要（IPアドレスでアクセス可能）
3. セットアップが簡単で、メンテナンスが容易
4. 証明書の有効期限が長い（10年間）

**デメリット（証明書の信頼設定）は、各クライアント端末で一度だけ行えばOK**なので、運用開始時に設定すれば、その後は問題なく動作します。

