# 本番環境セットアップガイド

最終更新: 2025-01-XX

## HTTPSの強制

本番環境では、HTTPSを強制することを推奨します。

### 前提条件

- ドメイン名が設定されていること
- ポート80と443が外部からアクセス可能であること

### 設定手順

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

### 開発環境での動作

`DOMAIN`環境変数が設定されていない場合、開発用の`Caddyfile`（HTTPのみ）が使用されます。

### セキュリティヘッダー

本番環境用Caddyfileには以下のセキュリティヘッダーが含まれています：

- `Strict-Transport-Security`: HSTS（HTTP Strict Transport Security）
- `X-Content-Type-Options`: MIMEタイプスニッフィング対策
- `X-Frame-Options`: クリックジャッキング対策
- `X-XSS-Protection`: XSS対策
- `Referrer-Policy`: リファラー情報の制御

### トラブルシューティング

#### 証明書が取得できない

- ポート80と443が外部からアクセス可能であることを確認
- ドメインのDNS設定が正しいことを確認
- ファイアウォールでポート80と443が開いていることを確認

#### HTTPリダイレクトが動作しない

- `DOMAIN`環境変数が正しく設定されていることを確認
- Caddyのログを確認：`docker compose logs web`

