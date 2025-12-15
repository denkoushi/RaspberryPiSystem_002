# Dropbox OAuth 2.0セットアップガイド

最終更新: 2025-12-15

## 概要

このガイドでは、Dropbox OAuth 2.0フローを使用してリフレッシュトークンを取得し、自動アクセストークン更新機能を設定する手順を説明します。

## 前提条件

- Dropboxアカウントを持っていること
- Dropbox App Consoleでアプリが作成されていること
- Raspberry Pi 5にシステムがデプロイされていること

## 手順

### Step 1: Dropbox App Consoleでアプリを設定

1. **Dropbox App Consoleにアクセス**
   - https://www.dropbox.com/developers/apps を開く
   - アプリを選択（または新規作成）

2. **OAuth 2設定を確認**
   - 「Settings」タブを開く
   - 「OAuth 2」セクションを確認
   - 「Redirect URIs」に以下を追加：
     ```
     http://<RaspberryPi5のIP>:8080/api/backup/oauth/callback
     ```
     または、HTTPSを使用している場合：
     ```
     https://<RaspberryPi5のドメイン>/api/backup/oauth/callback
     ```

3. **App KeyとApp Secretをメモ**
   - 「App key」と「App secret」をコピーして保存

### Step 2: 設定ファイルの準備

1. **Raspberry Pi 5にSSH接続**
   ```bash
   ssh denkon5sd02@100.106.158.2
   ```

2. **設定ファイルのディレクトリを確認**
   ```bash
   ls -la /opt/RaspberryPiSystem_002/config/
   ```

3. **設定ファイルを作成または編集**
   ```bash
   nano /opt/RaspberryPiSystem_002/config/backup.json
   ```

4. **設定ファイルの内容を記述**
   ```json
   {
     "storage": {
       "provider": "dropbox",
       "options": {
         "basePath": "/backups",
         "appKey": "${DROPBOX_APP_KEY}",
         "appSecret": "${DROPBOX_APP_SECRET}",
         "refreshToken": "${DROPBOX_REFRESH_TOKEN}"
       }
     },
     "targets": [
       {
         "kind": "csv",
         "source": "employees",
         "schedule": "0 5 * * *",
         "enabled": true
       },
       {
         "kind": "csv",
         "source": "items",
         "schedule": "0 5 * * *",
         "enabled": true
       },
       {
         "kind": "image",
         "source": "photo-storage",
         "schedule": "0 6 * * *",
         "enabled": true
       }
     ],
     "retention": {
       "days": 30,
       "maxBackups": 100
     }
   }
   ```

### Step 3: 環境変数の設定

1. **`.env`ファイルを編集**
   ```bash
   cd /opt/RaspberryPiSystem_002/infrastructure/docker
   nano .env
   ```

2. **環境変数を追加**
   ```bash
   DROPBOX_APP_KEY=your-app-key-here
   DROPBOX_APP_SECRET=your-app-secret-here
   DROPBOX_REFRESH_TOKEN=
   ```

   **注意**: この時点では`DROPBOX_REFRESH_TOKEN`は空にしておきます。次のステップで取得します。

### Step 4: OAuth 2.0フローでリフレッシュトークンを取得

#### 方法1: APIエンドポイントを使用（推奨）

1. **認証URLを取得**
   ```bash
   # Macのターミナルから実行
   curl -X GET "http://100.106.158.2:8080/api/backup/oauth/authorize" \
     -H "Authorization: Bearer <ADMIN_ACCESS_TOKEN>"
   ```

   **レスポンス例**:
   ```json
   {
     "authorizationUrl": "https://www.dropbox.com/oauth2/authorize?client_id=...&response_type=code&token_access_type=offline&redirect_uri=...",
     "state": "abc123..."
   }
   ```

2. **認証URLにアクセス**
   - レスポンスの`authorizationUrl`をブラウザで開く
   - Dropboxアカウントでログイン
   - アプリへのアクセスを許可

3. **認証コードを取得**
   - リダイレクト後のURLから`code`パラメータを取得
   - 例: `http://100.106.158.2:8080/api/backup/oauth/callback?code=abc123...&state=...`

4. **コールバックエンドポイントにアクセス**
   - ブラウザでリダイレクトURLにアクセス（自動的にリダイレクトされる）
   - または、手動でコールバックURLにアクセス：
     ```bash
     curl -X GET "http://100.106.158.2:8080/api/backup/oauth/callback?code=<AUTHORIZATION_CODE>&state=<STATE>" \
       -H "Authorization: Bearer <ADMIN_ACCESS_TOKEN>"
     ```

5. **設定ファイルを確認**
   ```bash
   cat /opt/RaspberryPiSystem_002/config/backup.json
   ```
   - `refreshToken`が設定されていることを確認

#### 方法2: 手動でトークンを取得（代替方法）

1. **認証URLを生成**
   ```bash
   # Macのターミナルから実行
   APP_KEY="your-app-key"
   REDIRECT_URI="http://100.106.158.2:8080/api/backup/oauth/callback"
   
   echo "https://www.dropbox.com/oauth2/authorize?client_id=${APP_KEY}&response_type=code&token_access_type=offline&redirect_uri=${REDIRECT_URI}"
   ```

2. **認証URLにアクセスして認証コードを取得**
   - ブラウザで認証URLを開く
   - 認証後、リダイレクトURLから`code`パラメータを取得

3. **トークンを交換**
   ```bash
   # Macのターミナルから実行
   CODE="<AUTHORIZATION_CODE>"
   APP_KEY="your-app-key"
   APP_SECRET="your-app-secret"
   REDIRECT_URI="http://100.106.158.2:8080/api/backup/oauth/callback"
   
   curl -X POST "https://api.dropbox.com/oauth2/token" \
     -d "code=${CODE}" \
     -d "grant_type=authorization_code" \
     -d "client_id=${APP_KEY}" \
     -d "client_secret=${APP_SECRET}" \
     -d "redirect_uri=${REDIRECT_URI}"
   ```

4. **レスポンスからリフレッシュトークンを取得**
   ```json
   {
     "access_token": "...",
     "refresh_token": "...",
     "expires_in": 14400,
     "token_type": "bearer"
   }
   ```

5. **環境変数に設定**
   ```bash
   # Raspberry Pi 5で実行
   cd /opt/RaspberryPiSystem_002/infrastructure/docker
   nano .env
   
   # DROPBOX_REFRESH_TOKENを設定
   DROPBOX_REFRESH_TOKEN=your-refresh-token-here
   ```

### Step 5: APIコンテナの再起動

```bash
cd /opt/RaspberryPiSystem_002
docker compose -f infrastructure/docker/docker-compose.server.yml restart api
```

### Step 6: 動作確認

1. **設定ファイルの読み込み確認**
   ```bash
   curl -X GET "http://100.106.158.2:8080/api/backup/config" \
     -H "Authorization: Bearer <ADMIN_ACCESS_TOKEN>"
   ```

2. **手動バックアップの実行**
   ```bash
   curl -X POST "http://100.106.158.2:8080/api/backup" \
     -H "Authorization: Bearer <ADMIN_ACCESS_TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{
       "kind": "csv",
       "source": "employees"
     }'
   ```

3. **ログを確認**
   ```bash
   docker compose -f infrastructure/docker/docker-compose.server.yml logs api | grep Dropbox
   ```

## トラブルシューティング

### 認証URLが生成できない

- **原因**: App KeyまたはApp Secretが設定されていない
- **解決策**: `.env`ファイルと`backup.json`を確認

### 認証コードの交換に失敗する

- **原因**: Redirect URIが一致しない、または認証コードが期限切れ
- **解決策**: 
  - Dropbox App ConsoleのRedirect URI設定を確認
  - 新しい認証コードを取得

### リフレッシュトークンが取得できない

- **原因**: `token_access_type=offline`パラメータが含まれていない
- **解決策**: 認証URLに`token_access_type=offline`が含まれていることを確認

### アクセストークンが自動更新されない

- **原因**: リフレッシュトークンまたはOAuthサービスが設定されていない
- **解決策**: 
  - `backup.json`に`refreshToken`, `appKey`, `appSecret`が設定されていることを確認
  - 環境変数が正しく設定されていることを確認

### 設定ファイルへの書き込みエラー（EROFS: read-only file system）

- **エラーメッセージ**: `EROFS: read-only file system, open '/app/config/backup.json'`
- **原因**: Docker Composeのconfigボリュームが読み取り専用（`:ro`）でマウントされている
- **解決策**: 
  1. `infrastructure/docker/docker-compose.server.yml`を確認
  2. configボリュームのマウント設定から`:ro`フラグを削除：
     ```yaml
     # 修正前
     - /opt/RaspberryPiSystem_002/config:/app/config:ro
     
     # 修正後
     - /opt/RaspberryPiSystem_002/config:/app/config
     ```
  3. APIコンテナを再起動：
     ```bash
     docker compose -f infrastructure/docker/docker-compose.server.yml restart api
     ```
- **参考**: [KB-099](../knowledge-base/infrastructure.md#kb-099-dropbox-oauth-20実装時のdocker-compose設定ファイルボリュームの読み書き権限問題)

## セキュリティに関する注意事項

1. **App SecretとRefresh Tokenは機密情報**
   - `.env`ファイルはGitにコミットしない
   - 適切な権限で保護する（`chmod 600 .env`）

2. **HTTPSの使用を推奨**
   - 本番環境ではHTTPSを使用することを推奨
   - Redirect URIもHTTPSを使用

3. **定期的なトークンの確認**
   - リフレッシュトークンが有効であることを定期的に確認
   - エラーログを監視

## 参考資料

- [Dropbox OAuth Guide](https://developers.dropbox.com/oauth-guide)
- [Using OAuth 2.0 with offline access](https://dropbox.tech/developers/using-oauth-2.0-with-offline-access)
- [Dropbox OAuth 2.0ポリシー適合性ガイド](./dropbox-oauth-policy-compliance.md)
