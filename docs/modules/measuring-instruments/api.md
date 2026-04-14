# 計測機器管理モジュール API仕様書

## 認証

- すべてのエンドポイントはJWT認証が必要（toolsモジュールと同様）
- クライアントキー認証はキオスク/API連携用に将来追加を検討

## 計測機器管理 API

### GET /api/measuring-instruments
- 計測機器一覧を取得（検索・フィルタ対応）
- クエリ: `search`（name/managementNumber部分一致）, `status`

### GET /api/measuring-instruments/:id
- 計測機器詳細を取得

### POST /api/measuring-instruments
- 計測機器を作成
- ボディ: `name`, `managementNumber`, `genreId?`, `storageLocation?`, `measurementRange?`, `calibrationExpiryDate?`, `status?`

### PUT /api/measuring-instruments/:id
- 計測機器を更新

### DELETE /api/measuring-instruments/:id
- 計測機器を削除

## 点検項目マスター API

### GET /api/measuring-instruments/:id/inspection-items
- 計測機器の所属ジャンルに紐づく点検項目一覧を取得（order順）

### POST /api/measuring-instruments/:id/inspection-items
- 計測機器の所属ジャンルに点検項目を作成
- ボディ: `name`, `content`, `criteria`, `method`, `order`

### PUT /api/inspection-items/:itemId
- 点検項目を更新

### DELETE /api/inspection-items/:itemId
- 点検項目を削除

### GET /api/measuring-instruments/:id/inspection-profile
- キオスク表示用プロフィールを取得（ジャンル + 点検項目）
- レスポンス: `genre`（null可）, `inspectionItems`

## 計測機器ジャンル API

### GET /api/measuring-instrument-genres
- 計測機器ジャンル一覧を取得

### POST /api/measuring-instrument-genres
- 計測機器ジャンルを作成
- ボディ: `name`

### PUT /api/measuring-instrument-genres/:genreId
- 計測機器ジャンルを更新
- ボディ: `name?`, `imageUrlPrimary?`, `imageUrlSecondary?`

### DELETE /api/measuring-instrument-genres/:genreId
- 計測機器ジャンルを削除
- 注意: 計測機器に割り当て済みジャンルは削除不可（409）

### GET /api/measuring-instrument-genres/:genreId/inspection-items
- ジャンル単位の点検項目一覧を取得（order順）

### POST /api/measuring-instrument-genres/:genreId/inspection-items
- ジャンル単位の点検項目を作成
- ボディ: `name`, `content`, `criteria`, `method`, `order`

### POST /api/measuring-instrument-genres/:genreId/images/:slot
- ジャンル画像をアップロード（`slot` は `1` or `2`）
- `multipart/form-data` の `image` を受け付け

### DELETE /api/measuring-instrument-genres/:genreId/images/:slot
- ジャンル画像をクリア（参照のみ削除、旧ファイルは保持）

## RFIDタグ紐付け API

### GET /api/measuring-instruments/:id/tags
- 計測機器に紐づくRFIDタグを取得

### POST /api/measuring-instruments/:id/tags
- RFIDタグを紐付け
- ボディ: `rfidTagUid`

### DELETE /api/measuring-instruments/tags/:tagId
- RFIDタグの紐付けを削除

## 点検記録 API

### GET /api/measuring-instruments/:id/inspection-records
- 計測機器に紐づく点検記録を取得（ページネーション対応）
- クエリ: `startDate`, `endDate`, `employeeId`, `result`

### POST /api/measuring-instruments/:id/inspection-records
- 点検記録を作成（持ち出し時の点検結果登録）
- ボディ: `loanId?`, `employeeId`, `inspectionItemId`, `result`, `inspectedAt`

## 持ち出し・返却 API（計測機器対応）

### POST /api/measuring-instruments/borrow
- 計測機器タグUIDと氏名タグUIDで持ち出しを登録（Loan作成＋ステータスIN_USE）
- ボディ: `instrumentTagUid`, `employeeTagUid`, `clientId?`, `dueAt?`, `note?`

### POST /api/measuring-instruments/return
- 返却を登録（ステータスAVAILABLE、TransactionにRETURN記録）
- ボディ: `loanId`, `clientId?`, `performedByUserId?`, `note?`

## WebSocket（キオスク連携）

- `ws://localhost:7071/stream`（NFC/TS100エージェントから計測機器タグUIDを受信予定）
- 受信ペイロード: `{ uid, reader, timestamp, type: 'rfid-tag' }`（typeは将来TS100用に拡張）

## バリデーション・制約

- `managementNumber` / `rfidTagUid` はユニーク
- 点検項目の`order`で並び順を固定
- 点検結果は`PASS`/`FAIL`のみ

## レスポンス共通フィールド（例）

```json
{
  "id": "uuid",
  "createdAt": "ISO8601",
  "updatedAt": "ISO8601"
}
```

## エラー共通形式

```json
{
  "message": "エラーメッセージ",
  "error": "Error Name",
  "statusCode": 400
}
```