# 本番環境セットアップガイド

最終更新: 2025-11-27

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

## 関連ドキュメント

- [クライアントデバイス統合アーキテクチャ](../architecture/client-device-integration.md) - デバイス統合パターンと拡張性
- [アーキテクチャ概要](../architecture/overview.md) - システム全体のアーキテクチャ

