# 計測機器管理モジュール API仕様書

## 認証

- 管理マスターの登録・更新・利用停止はADMIN／MANAGERのJWTが必要
- 管理マスターの参照はADMIN／MANAGER／VIEWERのJWT、または登録済み`x-client-key`を許可する
- 持出・返却、キオスク点検記録、組立の候補・現物確認・エージェント入力は登録済み`x-client-key`を使用する
- 組立の管理者例外入力はADMIN／MANAGERのJWTだけを許可し、共有パスワードは使用しない

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

## トルクレンチ拡張 API

### マスター

- `GET/POST /api/torque-wrench-models`
- `GET/PUT /api/torque-wrench-models/:id`
- `GET/POST /api/torque-wrench-capability-groups`
- `GET/PUT /api/torque-wrench-capability-groups/:id`
- `GET /api/torque-wrench-capability-groups/compatible`
- `GET/POST /api/torque-wrenches`
- `GET/PUT /api/torque-wrenches/:id`
- `POST /api/torque-wrenches/:id/settings`（追記専用）

型番の `settingVerificationMode` は `REGISTERED_SETTING`（従来の登録設定照合）または `BOLT_CONDITION_ONLY`（対象ボルト条件のみ）。未指定・旧nullは従来方式として扱う。本体との同期能力を表す項目ではない。照合不要でも設定登録APIと過去履歴は残る。

### REQUIRED組立作業

- `GET /api/assembly/work-sessions/:id/compatible-torque-wrenches`
- `POST /api/assembly/work-sessions/:id/torque-wrench-confirmations`
- `GET /api/assembly/work-sessions/:id/torque-wrench-confirmations/current`
- `POST /api/assembly/work-sessions/:id/record-torque`
- `POST /api/assembly/work-sessions/:id/record-torque-override`

エージェント入力は、端末IDをクライアントキーから確定し、`sourceEventKey`、現在のテンプレートBolt ID、確認ID、製造番号、値、単位、原文を必須とする。同じ端末・同じイベントIDは元の結果を返し、別の対象セッションへのイベント再送は409で拒否する。

確認／準備の `settingHistoryId` はnullable。`BOLT_CONDITION_ONLY` の確認・測定は設定履歴を作らずnullを保存する。使用可否は登録設定の欠落・不一致に依存せず、合否は対象ボルト条件で判定する。型番範囲、校正、状態、割当、個体・端末・NFC、接続排他は従来どおり検査する。

### 組立トルク訓練

- `GET /api/torque-training/programs` は現行版を全件返し、`setupState`（`READY` / `UNASSIGNED` / `UNAVAILABLE`）と理由を含む。現在のレンチ設定値は準備可否の判定に含めない
- `POST /api/torque-training/sessions/:id/wrench-preparations` は登録済み `x-client-key` を使用する
- ボディは `uid`, `torqueWrenchProfileId`, `requestId`, `physicalSettingConfirmed: true` のみ。トルク値はセッションの訓練版からサーバーが確定する
- 従来方式は設定履歴、現物確認、同一セッション・端末の使用リースを同一transactionで作成する。照合不要方式は現物確認と既存の再送管理だけを同一transactionで保存し、使用リースはagent経由で取得する。同じ `requestId` の再送は元の確認を返すが、古い確認での接続再取得を許可するものではない。表示用targetは両方式とも訓練版から返す
- `POST /api/torque-training/settings/snapshot` と同階層の設定変更APIは、登録済み`x-client-key`と共有4桁操作パスワードを毎回検証する。変更と`TorqueTrainingSettingsAuditLog`への端末監査は同一transactionで作成する
- 管理コンソール向け`/api/admin/torque-training/*`のADMIN JWT契約は後方互換のため維持する
- 詳細な認可境界と責務は [ADR-20260826](../../decisions/ADR-20260826-torque-training-one-touch-wrench-preparation.md) を参照

従来方式では、キオスク認証の`GET .../torque-wrench-confirmations/current`は対象セッションの確認に加え、現在端末の接続リースが採用した確認を返す。物理レンチ、最新設定、締付条件fingerprint、状態、校正が一致すれば別の作業ID・ロットでも使用できる。照合不要方式は新規接続ごとに確認し、過去の確認を自動選択しない。同一の有効接続中の同条件箇所への進行と、接続だけ失敗した再試行は同じ確認を使う。管理者JWTでの取得と`record-torque-override`は対象セッション内の確認だけを扱う。

方式変更、使用終了・失効、別作業の使用を挟んだ確認は接続取得時に再確認を要求する。詳細な方式・鮮度・段階移行の契約は [ADR-20260827](../../decisions/ADR-20260827-torque-wrench-optional-settings.md) を参照。

有効な接続リースID・世代を伴うagent入力は、owner端末、対象セッション、採用確認IDがすべて一致する場合に限り、別作業IDで作成された確認を使用できる。enforcementがOFFのtokenなし経路は、従来どおり同一セッション・作業開始元端末だけに限定する。業務拒否はHTTP 200の機械可読な`rejectionReason`として監査行を保存し、工程位置を進めない。

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
