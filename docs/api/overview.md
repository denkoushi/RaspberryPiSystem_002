# API概要

最終更新: 2025-01-XX

## 概要

Raspberry Pi System 002のAPIは、Fastifyフレームワークを使用して構築されています。

## ベースURL

- **開発環境**: `http://localhost:8080`
- **本番環境**: `https://your-domain.com`（HTTPS強制）

## 認証

APIの大部分のエンドポイントは認証が必要です。JWT（JSON Web Token）を使用して認証を行います。

### 認証フロー

1. **ログイン**: `POST /api/auth/login`で認証情報を送信し、アクセストークンとリフレッシュトークンを取得
2. **APIリクエスト**: 取得したアクセストークンを`Authorization: Bearer <token>`ヘッダーに含めてリクエスト
3. **トークンリフレッシュ**: アクセストークンの有効期限が切れた場合、`POST /api/auth/refresh`でリフレッシュトークンを使用して新しいアクセストークンを取得

### レート制限

- **認証エンドポイント**: 5リクエスト/分
- **一般APIエンドポイント**: 100リクエスト/分

## エンドポイント一覧

### 認証

- `POST /api/auth/login` - ログイン
- `POST /api/auth/refresh` - トークンリフレッシュ

### システム

- `GET /api/system/health` - ヘルスチェック
- `GET /api/system/metrics` - Prometheus形式のメトリクス

### ツール管理

#### 従業員

- `GET /api/tools/employees` - 従業員一覧取得
- `GET /api/tools/employees/:id` - 従業員詳細取得
- `POST /api/tools/employees` - 従業員作成
- `PUT /api/tools/employees/:id` - 従業員更新
- `DELETE /api/tools/employees/:id` - 従業員削除

#### アイテム

- `GET /api/tools/items` - アイテム一覧取得
- `GET /api/tools/items/:id` - アイテム詳細取得
- `POST /api/tools/items` - アイテム作成
- `PUT /api/tools/items/:id` - アイテム更新
- `DELETE /api/tools/items/:id` - アイテム削除

#### 貸出

- `POST /api/tools/loans/borrow` - 貸出
- `POST /api/tools/loans/return` - 返却
- `GET /api/tools/loans/active` - アクティブな貸出一覧取得

#### トランザクション

- `GET /api/tools/transactions` - トランザクション一覧取得

### キオスク

- `GET /api/kiosk/employees/:nfcTagUid` - NFCタグUIDから従業員情報を取得
- `GET /api/kiosk/items/:nfcTagUid` - NFCタグUIDからアイテム情報を取得

### インポート

- `POST /api/imports/employees` - 従業員CSVインポート
- `POST /api/imports/items` - アイテムCSVインポート

### バックアップ

- `POST /api/backup` - 手動バックアップ実行
- `GET /api/backup` - バックアップ一覧取得
- `POST /api/backup/restore` - バックアップリストア
- `POST /api/backup/restore/from-dropbox` - Dropboxからのリストア
- `DELETE /api/backup/*` - バックアップ削除
- `GET /api/backup/history` - バックアップ履歴一覧取得
- `GET /api/backup/history/:id` - バックアップ履歴詳細取得
- `GET /api/backup/config` - バックアップ設定取得
- `PUT /api/backup/config` - バックアップ設定更新
- `POST /api/backup/config/targets` - バックアップ対象追加
- `PUT /api/backup/config/targets/:index` - バックアップ対象更新
- `DELETE /api/backup/config/targets/:index` - バックアップ対象削除
- `GET /api/backup/oauth/authorize` - Dropbox OAuth認証URL取得
- `GET /api/backup/oauth/callback` - Dropbox OAuthコールバック
- `POST /api/backup/oauth/refresh` - Dropbox OAuthトークンリフレッシュ

### クライアント

- `POST /api/clients/heartbeat` - クライアントデバイスのハートビート（既存端末では `name` は上書きせず、`location`/`lastSeenAt` を更新）
- `POST /api/clients/status` - status-agent メトリクス登録（`ClientStatus`更新 + `ClientDevice.statusClientId` 紐付け）
- `GET /api/clients` - クライアントデバイス一覧取得（管理者のみ）
- `PUT /api/clients/:id` - クライアント端末の表示名/初期表示モードを更新（管理者のみ）

## エラーレスポンス

APIは以下の形式でエラーを返します：

```json
{
  "message": "エラーメッセージ",
  "details": {}
}
```

### HTTPステータスコード

- `200` - 成功
- `400` - バリデーションエラー
- `401` - 認証エラー
- `403` - 権限エラー
- `404` - リソースが見つからない
- `429` - レート制限超過
- `500` - サーバーエラー
- `503` - サービス利用不可（ヘルスチェック失敗時）

## 後方互換性

既存のAPIパス（`/api/employees`など）は後方互換性のため維持されていますが、新しいパス（`/api/tools/employees`など）の使用を推奨します。

## 詳細ドキュメント

各エンドポイントの詳細については、以下のドキュメントを参照してください：

- [認証API](./auth.md)
- [ツール管理API](./tools.md)
- [キオスクAPI](./kiosk.md)
- [バックアップAPI](./backup.md)

