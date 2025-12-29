# Dropbox連携の追加検証手順

最終更新: 2025-12-29

## 概要

本ドキュメントでは、Dropbox連携機能の追加検証手順を説明します。複数プロバイダーへの同時バックアップ（Phase 2）とトークンリフレッシュの自動実行を確認します。

## 検証環境

- **Raspberry Pi 5**: サーバー（API/DB/Web UI）
- **Dropbox**: バックアップストレージ

## 前提条件

- Dropbox OAuth認証が完了し、正しい`refreshToken`が設定されていること
- 管理コンソールにアクセスできること（`https://100.106.158.2/admin`）

## 検証項目

### 検証1: 複数プロバイダーへの同時バックアップ（Phase 2）

**目的**: 1つのバックアップ対象を複数のストレージプロバイダー（`local`と`dropbox`）に同時にバックアップできることを確認

**検証手順**:

1. **管理コンソールで多重バックアップを設定**
   - 管理コンソール → 「バックアップ」タブ → 「バックアップ対象」
   - 既存の対象を編集、または新しい対象を追加
   - 「ストレージプロバイダー」で`local`と`dropbox`の両方にチェックを入れる
   - 「保存」ボタンをクリック

2. **設定ファイルの確認**
   ```bash
   # 多重バックアップ設定を確認
   docker compose -f /opt/RaspberryPiSystem_002/infrastructure/docker/docker-compose.server.yml exec -T api cat /app/config/backup.json | jq '.targets[] | select(.kind == "csv" and .source == "employees") | .storage'
   ```
   - `providers: ["local", "dropbox"]`が設定されていることを確認

3. **手動バックアップを実行**
   - 管理コンソール → 「バックアップ」タブ → 「バックアップ対象」
   - 設定した対象の「手動バックアップ」ボタンをクリック

4. **バックアップ結果の確認**
   - バックアップ履歴ページで、同じ対象に対して複数の履歴レコードが作成されていることを確認
     - `storageProvider: local`の履歴
     - `storageProvider: dropbox`の履歴
   - 両方の履歴が`status: COMPLETED`になっていることを確認

5. **ファイルの存在確認**
   ```bash
   # ローカルストレージにバックアップファイルが存在することを確認
   ls -lh /opt/RaspberryPiSystem_002/storage/backups/csv/*/employees.csv
   
   # Dropbox上にもバックアップファイルが存在することを確認（バックアップ履歴から）
   # 管理コンソールのバックアップ履歴ページで、dropboxの履歴のpathを確認
   ```

**期待される結果**:
- ✅ 1つのバックアップ対象が`local`と`dropbox`の両方にバックアップされる
- ✅ バックアップ履歴に2つのレコードが作成される（`storageProvider`が異なる）
- ✅ 両方のバックアップが成功する
- ✅ APIレスポンスの`providers`フィールドに両方のプロバイダーが含まれる

**APIレスポンス例**:
```json
{
  "success": true,
  "path": "/backups/csv/2025-12-29T00-00-01-695Z/employees.csv",
  "sizeBytes": 12345,
  "timestamp": "2025-12-29T00:00:01.695Z",
  "providers": [
    { "provider": "local", "success": true },
    { "provider": "dropbox", "success": true }
  ]
}
```

---

### 検証2: トークンリフレッシュの自動実行確認

**目的**: `accessToken`が期限切れになった場合、`refreshToken`から自動的に新しい`accessToken`を取得することを確認

**検証手順**:

1. **現在のトークン状態を確認**
   ```bash
   # 設定ファイルから現在のトークンを確認
   docker compose -f /opt/RaspberryPiSystem_002/infrastructure/docker/docker-compose.server.yml exec -T api cat /app/config/backup.json | jq '.storage.options | {hasAccessToken: (.accessToken != null and .accessToken != ""), hasRefreshToken: (.refreshToken != null and .refreshToken != "")}'
   ```

2. **accessTokenを一時的に削除（テスト用）**
   ```bash
   # 注意: これはテスト用の操作です。本番環境では実行しないでください
   # 設定ファイルからaccessTokenを削除（refreshTokenは残す）
   docker compose -f /opt/RaspberryPiSystem_002/infrastructure/docker/docker-compose.server.yml exec -T api sh -c 'cat /app/config/backup.json | jq ".storage.options.accessToken = \"\"" > /tmp/backup.json && cp /tmp/backup.json /app/config/backup.json'
   ```

3. **バックアップを実行**
   - 管理コンソール → 「バックアップ」タブ → 「バックアップ対象」
   - Dropboxが設定されている対象の「手動バックアップ」ボタンをクリック

4. **トークンリフレッシュの確認**
   ```bash
   # APIログでトークンリフレッシュのログを確認
   docker compose -f /opt/RaspberryPiSystem_002/infrastructure/docker/docker-compose.server.yml logs api --tail=50 | grep -E "refresh|AccessToken|Dropbox"
   ```
   - `[StorageProviderFactory] Attempting to refresh accessToken from refreshToken`のログが出力されることを確認
   - `[StorageProviderFactory] AccessToken refreshed successfully`のログが出力されることを確認

5. **設定ファイルの確認**
   ```bash
   # 設定ファイルに新しいaccessTokenが保存されていることを確認
   docker compose -f /opt/RaspberryPiSystem_002/infrastructure/docker/docker-compose.server.yml exec -T api cat /app/config/backup.json | jq '.storage.options | {hasAccessToken: (.accessToken != null and .accessToken != ""), accessTokenPrefix: (.accessToken // "" | .[0:15])}'
   ```
   - `hasAccessToken: true`になっていることを確認
   - `accessTokenPrefix`が`sl.u.`で始まることを確認（正しいアクセストークン形式）

6. **バックアップ結果の確認**
   - バックアップ履歴ページで、`storageProvider: dropbox`として記録されていることを確認
   - Dropboxへのアップロードが成功していることを確認

**期待される結果**:
- ✅ `accessToken`が空でも`refreshToken`がある場合、自動的に新しい`accessToken`が取得される
- ✅ 取得した`accessToken`が設定ファイルに保存される
- ✅ Dropboxへのバックアップが成功する
- ✅ バックアップ履歴に`storageProvider: dropbox`が記録される

---

### 検証3: トークンリフレッシュの手動実行確認

**目的**: `/api/backup/oauth/refresh`エンドポイントを使用して手動でトークンをリフレッシュできることを確認

**検証手順**:

1. **現在のトークン状態を確認**
   ```bash
   # 設定ファイルから現在のトークンを確認
   docker compose -f /opt/RaspberryPiSystem_002/infrastructure/docker/docker-compose.server.yml exec -T api cat /app/config/backup.json | jq '.storage.options | {hasAccessToken: (.accessToken != null and .accessToken != ""), hasRefreshToken: (.refreshToken != null and .refreshToken != "")}'
   ```

2. **手動でトークンをリフレッシュ（API経由）**
   ```bash
   # 1. ログインしてトークンを取得
   TOKEN=$(curl -s -k -X POST https://100.106.158.2/api/auth/login \
     -H 'Content-Type: application/json' \
     -d '{"username":"admin","password":"admin1234"}' | jq -r '.accessToken')

   # 2. トークンをリフレッシュ
   curl -X POST https://100.106.158.2/api/backup/oauth/refresh \
     -H "Authorization: Bearer $TOKEN"
   ```

3. **レスポンスの確認**
   ```json
   {
     "success": true,
     "message": "Access token refreshed successfully",
     "hasRefreshToken": true
   }
   ```

4. **設定ファイルの確認**
   ```bash
   # 設定ファイルに新しいaccessTokenが保存されていることを確認
   docker compose -f /opt/RaspberryPiSystem_002/infrastructure/docker/docker-compose.server.yml exec -T api cat /app/config/backup.json | jq '.storage.options | {hasAccessToken: (.accessToken != null and .accessToken != ""), accessTokenPrefix: (.accessToken // "" | .[0:15])}'
   ```

**期待される結果**:
- ✅ トークンリフレッシュが成功する
- ✅ 新しい`accessToken`が設定ファイルに保存される
- ✅ レスポンスに`hasRefreshToken: true`が含まれる

---

### 検証4: フォールバック動作の確認

**目的**: Dropboxへのバックアップが失敗した場合、`local`にフォールバックすることを確認

**検証手順**:

1. **Dropbox設定を一時的に無効化（テスト用）**
   ```bash
   # 注意: これはテスト用の操作です。本番環境では実行しないでください
   # refreshTokenを一時的に削除（accessTokenも空にする）
   docker compose -f /opt/RaspberryPiSystem_002/infrastructure/docker/docker-compose.server.yml exec -T api sh -c 'cat /app/config/backup.json | jq ".storage.options.refreshToken = \"\"" | jq ".storage.options.accessToken = \"\"" > /tmp/backup.json && cp /tmp/backup.json /app/config/backup.json'
   ```

2. **バックアップを実行**
   - 管理コンソール → 「バックアップ」タブ → 「バックアップ対象」
   - Dropboxが設定されている対象の「手動バックアップ」ボタンをクリック

3. **フォールバック動作の確認**
   - APIログで`[StorageProviderFactory] Dropbox access token is empty, falling back to local storage`のログが出力されることを確認
   - バックアップ履歴ページで、`storageProvider: local`として記録されていることを確認

4. **設定を復元**
   ```bash
   # 設定を復元（OAuth認証を再実行してrefreshTokenを取得）
   # または、バックアップから設定ファイルを復元
   ```

**期待される結果**:
- ✅ Dropboxへのバックアップが失敗した場合、`local`にフォールバックする
- ✅ バックアップ履歴に`storageProvider: local`が記録される
- ✅ ローカルストレージにバックアップファイルが保存される

---

## API経由での検証（オプション）

### 多重バックアップの確認（API経由）

```bash
# 1. ログインしてトークンを取得
TOKEN=$(curl -s -k -X POST https://100.106.158.2/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin1234"}' | jq -r '.accessToken')

# 2. バックアップを実行（多重バックアップ設定が有効な対象）
curl -X POST https://100.106.158.2/api/backup \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "kind": "csv",
    "source": "employees"
  }' | jq '.providers'
```

**期待されるレスポンス**:
```json
[
  { "provider": "local", "success": true },
  { "provider": "dropbox", "success": true }
]
```

---

## トラブルシューティング

### エラー: "Failed to refresh access token"

**原因**: `refreshToken`が無効、または`appKey`/`appSecret`が設定されていない

**解決策**:
1. OAuth認証フローを再実行して新しい`refreshToken`を取得
2. `appKey`と`appSecret`が正しく設定されていることを確認

### エラー: "Backup failed on all providers"

**原因**: すべてのストレージプロバイダーでバックアップが失敗した

**解決策**:
1. 各プロバイダーのエラーメッセージを確認
2. Dropbox設定が正しいことを確認
3. ローカルストレージのディスク容量を確認

### 多重バックアップで1つだけ失敗する

**原因**: 1つのプロバイダーでバックアップが失敗したが、他のプロバイダーでは成功した

**動作**:
- これは正常な動作です。1つでも成功すればバックアップは成功とみなされます
- 失敗したプロバイダーのエラーメッセージを確認してください

---

## 検証結果の記録

検証完了後、以下の情報を記録してください：

- **検証日時**: YYYY-MM-DD HH:MM:SS
- **検証者**: 名前
- **検証結果**: ✅ 成功 / ❌ 失敗
- **検証内容**: 
  - 複数プロバイダーへの同時バックアップ: ✅ / ❌
  - トークンリフレッシュの自動実行: ✅ / ❌
  - トークンリフレッシュの手動実行: ✅ / ❌
  - フォールバック動作: ✅ / ❌
- **発見された問題**: （あれば）
- **備考**: （あれば）

---

## 関連ドキュメント

- [バックアップAPI仕様](../api/backup.md)
- [バックアップ・リストア手順](./backup-and-restore.md)
- [バックアップ設定ガイド](./backup-configuration.md)
- [バックアップ対象管理UI実装計画](../requirements/backup-target-management-ui.md#phase-82-多重バックアップphase-2--完了)
