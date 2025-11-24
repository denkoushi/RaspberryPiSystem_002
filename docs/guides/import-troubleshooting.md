# インポート機能のトラブルシューティング

## エラーの種類と対処法

### 1. P2003エラー（外部キー制約違反）

**症状**：
- `replaceExisting: false`（チェックボックスを外す）でもエラーが発生
- エラーメッセージ: "データベースエラー: P2003"

**原因**：
- APIサーバーが最新のコードに更新されていない
- Loanレコードが存在する従業員/アイテムを削除しようとしている

**対処法**：
1. ラズパイ5で最新のコードを取得：
   ```bash
   cd /opt/RaspberryPiSystem_002
   git pull origin main
   docker compose -f infrastructure/docker/docker-compose.server.yml restart api
   ```

2. ブラウザをハードリロード（`Ctrl+Shift+R` または `Cmd+Shift+R`）

3. `replaceExisting: false`（チェックボックスを外す）で再度試す

### 2. 「トークンが無効です」エラー（401）

**症状**：
- `replaceExisting: true`（チェックボックスを入れる）でエラーが発生
- エラーメッセージ: "トークンが無効です"

**原因**：
- 認証トークンの有効期限が切れている
- 処理が長引いてトークンが期限切れになった
- マルチパートリクエストの処理中に認証が失敗した

**対処法**：
1. ブラウザで再ログイン
2. ページをリロードしてから再度試す
3. `replaceExisting: false`（チェックボックスを外す）で試す

### 3. 400エラー（Bad Request）

**症状**：
- CSVファイルをアップロードしてもエラーが発生
- エラーメッセージが表示されない、または空

**原因**：
- CSVファイルの形式が正しくない
- ファイルが選択されていない
- マルチパートリクエストの処理エラー

**対処法**：
1. CSVファイルの形式を確認：
   - UTF-8エンコーディング
   - ヘッダー行が必須
   - 列名が正しい（`employeeCode`, `displayName`, `nfcTagUid`, `department`, `contact`, `status` / `itemCode`, `name`, `nfcTagUid`, `category`, `storageLocation`, `status`, `notes`）

2. ファイルが選択されているか確認

3. ブラウザのコンソール（F12）でエラーの詳細を確認

## 推奨される使用方法

### 通常のインポート（推奨）

1. **チェックボックスを外す**（`replaceExisting: false`）
2. CSVファイルを選択
3. 「取り込み開始」をクリック

この方法では：
- 既存データは削除されません
- 新しいデータが追加されます
- 既存データは更新されます（employeeCode/itemCodeが一致する場合）

### 全削除してからインポート（注意が必要）

1. **チェックボックスを入れる**（`replaceExisting: true`）
2. CSVファイルを選択
3. 「取り込み開始」をクリック

この方法では：
- Loanレコードが存在しない従業員/アイテムのみ削除されます
- Loanレコードが存在する従業員/アイテムは削除されません（外部キー制約のため）
- その後、新しいデータが追加/更新されます

**注意**：Loanレコードが存在する従業員/アイテムは削除されないため、完全なクリアはできません。

## 確認手順

1. **APIサーバーが最新のコードに更新されているか確認**：
   ```bash
   cd /opt/RaspberryPiSystem_002
   git log --oneline -5
   ```
   最新のコミットが含まれているか確認

2. **APIサーバーのログを確認**：
   ```bash
   docker compose -f infrastructure/docker/docker-compose.server.yml logs api | tail -50
   ```
   エラーの詳細を確認

3. **ブラウザのコンソールを確認**：
   - F12で開発者ツールを開く
   - コンソールタブでエラーの詳細を確認
   - ネットワークタブでリクエスト/レスポンスを確認

