# Phase 3 Dropboxトークンリフレッシュ修正

最終更新: 2025-12-17

## 問題の概要

`CsvImportScheduler.executeImport`メソッドで`DropboxStorageProvider`を作成する際に、`refreshToken`が渡されていなかったため、トークンリフレッシュロジックが動作していませんでした。

## 問題の詳細

### 発見された問題

ログを確認したところ、以下のメッセージが確認されました：

```
[DropboxStorageProvider] Access token invalid or expired, attempting refresh
```

しかし、その後もエラーが発生していました。コードを確認したところ、`CsvImportScheduler.executeImport`メソッドで`DropboxStorageProvider`を作成する際に、`refreshToken`が渡されていませんでした。

### 影響範囲

- CSVインポートスケジュール実行時に、アクセストークンが期限切れの場合、自動リフレッシュされない
- 手動でトークンを更新する必要がある

### 修正内容

**ファイル**: `apps/api/src/services/imports/csv-import-scheduler.ts`

**修正前**:
```typescript
const dropboxProvider = new DropboxStorageProvider({
  accessToken,
  basePath,
  oauthService,
  onTokenUpdate
});
```

**修正後**:
```typescript
const dropboxProvider = new DropboxStorageProvider({
  accessToken,
  basePath,
  refreshToken,  // ← 追加
  oauthService,
  onTokenUpdate
});
```

### トークンリフレッシュロジックの動作

`DropboxStorageProvider`には、以下のトークンリフレッシュロジックが実装されています：

1. **`handleAuthError`メソッド**: 401エラーまたは`expired_access_token`エラーが発生した場合、自動的にトークンリフレッシュを試みる
2. **`refreshAccessTokenIfNeeded`メソッド**: リフレッシュトークンとOAuthサービスを使用して、新しいアクセストークンを取得
3. **`onTokenUpdate`コールバック**: 新しいアクセストークンを`config/backup.json`に保存

### 修正の効果

修正により、以下の動作が期待できます：

1. CSVインポートスケジュール実行時に、アクセストークンが期限切れの場合、自動的にリフレッシュされる
2. リフレッシュされたトークンが`config/backup.json`に自動保存される
3. 次回の実行時から、新しいトークンが使用される

## 検証方法

### 1. 修正の確認

```bash
# 修正が適用されているか確認
grep -A 5 "new DropboxStorageProvider" apps/api/src/services/imports/csv-import-scheduler.ts
```

### 2. トークンリフレッシュの動作確認

1. アクセストークンを意図的に無効にする（または期限切れを待つ）
2. CSVインポートスケジュールを実行
3. ログでトークンリフレッシュが実行されることを確認：
   ```
   [DropboxStorageProvider] Access token invalid or expired, attempting refresh
   [DropboxStorageProvider] Access token refreshed successfully
   [CsvImportScheduler] Access token updated
   ```
4. `config/backup.json`の`storage.options.accessToken`が更新されていることを確認

## 関連コード

### DropboxStorageProvider

- **ファイル**: `apps/api/src/services/backup/storage/dropbox-storage.provider.ts`
- **メソッド**: 
  - `handleAuthError`: 認証エラー時の自動リフレッシュ
  - `refreshAccessTokenIfNeeded`: トークンリフレッシュの実装

### DropboxOAuthService

- **ファイル**: `apps/api/src/services/backup/dropbox-oauth.service.ts`
- **メソッド**: 
  - `refreshAccessToken`: Dropbox APIを使用したトークンリフレッシュ

## 注意事項

1. **リフレッシュトークンも期限切れの場合**: リフレッシュトークン自体が期限切れの場合は、手動でOAuthフローを再実行する必要があります
2. **設定ファイルの更新**: トークンリフレッシュ後、`config/backup.json`が自動更新されますが、ファイルの書き込み権限が必要です
3. **ログの確認**: トークンリフレッシュが失敗した場合、ログにエラーが記録されます

## 次のステップ

1. **修正のデプロイ**: 修正をPi5にデプロイ
2. **動作確認**: 実際のスケジュール実行でトークンリフレッシュが動作することを確認
3. **エラーハンドリング**: リフレッシュトークンが期限切れの場合のエラーハンドリングを確認
