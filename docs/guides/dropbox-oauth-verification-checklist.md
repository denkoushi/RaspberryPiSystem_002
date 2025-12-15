# Dropbox OAuth 2.0実機検証チェックリスト

最終更新: 2025-12-15

## 検証環境

- **Raspberry Pi 5**: サーバー（API/DB/Web UI）
- **IPアドレス**: `100.106.158.2`（Tailscale経由）

## 検証項目

### Phase 1: OAuth 2.0フローでのリフレッシュトークン取得

#### 1.1 Dropbox App Consoleの設定確認

- [ ] Dropbox App Consoleにアクセス（https://www.dropbox.com/developers/apps）
- [ ] アプリを選択（または新規作成）
- [ ] 「Settings」→「OAuth 2」で以下を確認：
  - [ ] 「Redirect URIs」に `http://100.106.158.2:8080/api/backup/oauth/callback` が追加されている
  - [ ] 「App key」と「App secret」をメモ

#### 1.2 環境変数の設定

- [ ] Pi5にSSH接続
  ```bash
  ssh denkon5sd02@100.106.158.2
  ```
- [ ] `.env`ファイルを編集
  ```bash
  cd /opt/RaspberryPiSystem_002/infrastructure/docker
  nano .env
  ```
- [ ] 以下を設定：
  ```bash
  DROPBOX_APP_KEY=your-app-key-here
  DROPBOX_APP_SECRET=your-app-secret-here
  DROPBOX_REFRESH_TOKEN=
  ```
- [ ] 設定を確認
  ```bash
  grep DROPBOX .env
  ```

#### 1.3 設定ファイルの準備

- [ ] 設定ファイルディレクトリを確認
  ```bash
  ls -la /opt/RaspberryPiSystem_002/config/
  ```
- [ ] `backup.json`を作成または編集
  ```bash
  nano /opt/RaspberryPiSystem_002/config/backup.json
  ```
- [ ] 以下の内容を設定：
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
      }
    ],
    "retention": {
      "days": 30,
      "maxBackups": 100
    }
  }
  ```

#### 1.4 APIコンテナの再起動

- [ ] APIコンテナを再起動
  ```bash
  cd /opt/RaspberryPiSystem_002
  docker compose -f infrastructure/docker/docker-compose.server.yml restart api
  ```
- [ ] コンテナが正常に起動したことを確認
  ```bash
  docker compose -f infrastructure/docker/docker-compose.server.yml ps api
  ```

#### 1.5 OAuth 2.0認証フローの実行

- [ ] ログインしてアクセストークンを取得
  ```bash
  TOKEN=$(curl -s -X POST http://localhost:8080/api/auth/login \
    -H 'Content-Type: application/json' \
    -d '{"username":"admin","password":"admin1234"}' | \
    python3 -c 'import sys, json; d=json.load(sys.stdin); print(d.get("accessToken", ""))')
  ```
- [ ] 認証URLを取得
  ```bash
  curl -X GET "http://localhost:8080/api/backup/oauth/authorize" \
    -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
  ```
- [ ] レスポンスから`authorizationUrl`を取得
- [ ] ブラウザで`authorizationUrl`にアクセス
- [ ] Dropboxアカウントでログイン
- [ ] アプリへのアクセスを許可
- [ ] リダイレクト後のURLから認証コードを確認（自動的にコールバックエンドポイントにリダイレクトされる）
- [ ] コールバックエンドポイントのレスポンスを確認
  ```bash
  # ブラウザのコンソールまたはレスポンスを確認
  # 成功時: {"success": true, "message": "Tokens saved successfully", "hasRefreshToken": true}
  ```

#### 1.6 設定ファイルの確認

- [ ] 設定ファイルにリフレッシュトークンが保存されたことを確認
  ```bash
  cat /opt/RaspberryPiSystem_002/config/backup.json | python3 -m json.tool | grep refreshToken
  ```
- [ ] 環境変数が正しく解決されていることを確認
  ```bash
  docker compose -f infrastructure/docker/docker-compose.server.yml exec -T api \
    cat /app/config/backup.json | python3 -m json.tool
  ```

### Phase 2: リフレッシュトークンによる自動アクセストークン更新の動作確認

#### 2.1 手動バックアップの実行

- [ ] 手動バックアップを実行
  ```bash
  curl -X POST "http://localhost:8080/api/backup" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"kind":"csv","source":"employees"}' | python3 -m json.tool
  ```
- [ ] バックアップが成功することを確認
- [ ] ログを確認
  ```bash
  docker compose -f infrastructure/docker/docker-compose.server.yml logs api | grep Dropbox | tail -20
  ```

#### 2.2 アクセストークンの期限切れシミュレーション（オプション）

**注意**: 実際のアクセストークンが期限切れになるまで待つか、手動でリフレッシュを実行します。

- [ ] 手動リフレッシュを実行
  ```bash
  curl -X POST "http://localhost:8080/api/backup/oauth/refresh" \
    -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
  ```
- [ ] レスポンスで成功を確認
  ```json
  {"success": true, "message": "Access token refreshed successfully"}
  ```
- [ ] 設定ファイルが更新されたことを確認
  ```bash
  cat /opt/RaspberryPiSystem_002/config/backup.json | python3 -m json.tool | grep accessToken
  ```

#### 2.3 自動リフレッシュの動作確認

- [ ] 期限切れのアクセストークンでバックアップを実行（実際の期限切れを待つか、手動で期限切れトークンに設定）
- [ ] ログで自動リフレッシュが実行されたことを確認
  ```bash
  docker compose -f infrastructure/docker/docker-compose.server.yml logs api | grep "Access token expired\|Access token refreshed"
  ```
- [ ] バックアップが成功することを確認

### Phase 3: スケジュールバックアップの動作確認

#### 3.1 スケジュールバックアップの設定確認

- [ ] 設定ファイルのスケジュール設定を確認
  ```bash
  cat /opt/RaspberryPiSystem_002/config/backup.json | python3 -m json.tool | grep schedule
  ```
- [ ] スケジューラーが起動していることを確認
  ```bash
  docker compose -f infrastructure/docker/docker-compose.server.yml logs api | grep "BackupScheduler\|Scheduled backup"
  ```

#### 3.2 スケジュール時刻での実行確認

- [ ] スケジュール時刻（例: 5時、6時）にバックアップが実行されることを確認
- [ ] ログで実行を確認
  ```bash
  docker compose -f infrastructure/docker/docker-compose.server.yml logs api | grep "Scheduled backup\|Backup completed"
  ```
- [ ] Dropboxにファイルがアップロードされていることを確認（DropboxアプリまたはWeb UIで確認）

### Phase 4: エラーハンドリングの確認

#### 4.1 リフレッシュトークンなしの場合

- [ ] 設定ファイルから`refreshToken`を一時的に削除
- [ ] バックアップを実行
- [ ] エラーが適切に処理されることを確認

#### 4.2 無効なリフレッシュトークンの場合

- [ ] 設定ファイルの`refreshToken`を無効な値に設定
- [ ] バックアップを実行
- [ ] エラーメッセージが適切に表示されることを確認

## 検証結果の記録

検証完了後、以下の情報を記録してください：

- **検証日時**: 
- **検証者**: 
- **検証環境**: 
- **検証結果**: 
  - [ ] Phase 1: OAuth 2.0フローでのリフレッシュトークン取得
  - [ ] Phase 2: リフレッシュトークンによる自動アクセストークン更新
  - [ ] Phase 3: スケジュールバックアップの動作確認
  - [ ] Phase 4: エラーハンドリングの確認
- **発見された問題**: 
- **解決策**: 

## トラブルシューティング

### 認証URLが生成できない

- `.env`ファイルに`DROPBOX_APP_KEY`と`DROPBOX_APP_SECRET`が設定されているか確認
- `backup.json`に`appKey`と`appSecret`が設定されているか確認
- APIコンテナが再起動されているか確認

### 認証コードの交換に失敗する

- Redirect URIがDropbox App Consoleの設定と一致しているか確認
- 認証コードが期限切れでないか確認（認証コードは短時間で期限切れになります）

### リフレッシュトークンが取得できない

- 認証URLに`token_access_type=offline`パラメータが含まれているか確認
- Dropbox App Consoleでアプリの権限設定を確認

### 自動リフレッシュが動作しない

- `backup.json`に`refreshToken`, `appKey`, `appSecret`が設定されているか確認
- 環境変数が正しく解決されているか確認
- ログでエラーメッセージを確認

## 参考資料

- [Dropbox OAuth 2.0セットアップガイド](./dropbox-oauth-setup-guide.md)
- [Dropbox OAuth 2.0ポリシー適合性ガイド](./dropbox-oauth-policy-compliance.md)
- [バックアップ設定ガイド](./backup-configuration.md)
