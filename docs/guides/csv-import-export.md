# CSVインポート・エクスポート仕様

## 概要

本システムでは、以下の方法でマスターデータ（従業員・工具・計測機器・吊具）を一括インポートできます：

1. **USBメモリ経由**: 管理画面からCSVファイルをアップロード（従業員・工具・計測機器・吊具の4種類に対応）✅ **実機検証完了**
2. **Dropbox経由**: DropboxからCSVファイルをダウンロードしてインポート（手動実行）✅ **実装・検証完了**
3. **Dropbox経由（スケジュール実行）**: 設定したスケジュールに従って自動的にDropboxからCSVを取得してインポート ✅ **実装・検証完了**
4. **Gmail経由（スケジュール実行）**: 設定したスケジュールに従って自動的にGmailからCSVを取得してインポート ✅ **実装完了（2025-12-29）** ⚠️ **スケジュール実行のE2E検証は未完了（手動実行は検証済み）**

**検証状況**:
- ✅ USBメモリ経由: 実機検証完了（従業員・計測機器・吊具のCSVインポートを確認済み）
- ✅ Dropbox経由（手動実行・スケジュール実行）: 実装・検証完了
- ✅ Gmail経由（手動実行）: 実装・検証完了（2026-01-03）
- ⚠️ Gmail経由（スケジュール実行）: 実装完了済みだが、PowerAutomate→Gmail→Pi5→CSVインポートのE2Eフロー全体の実機検証は未完了
  - 実装詳細: [docs/plans/gmail-data-acquisition-execplan.md](../plans/gmail-data-acquisition-execplan.md)
  - 検証手順: [docs/guides/verification-checklist.md#682-gmail経由csv取り込みスケジュール実行の実機検証](./verification-checklist.md#682-gmail経由csv取り込みスケジュール実行の実機検証)

**実装アーキテクチャ**:
- ✅ **CSV Import Scalingプラン完了（2025-12-29）**: CSVインポート機能をレジストリ・ファクトリパターンでモジュール化し、計測機器・吊具のCSVインポートに対応。新しいデータタイプの追加が容易になり、コードの重複を削減。スケジュール設定を`targets`配列形式に拡張し、複数のデータタイプを1つのスケジュールで処理可能に。後方互換性を確保（旧`employeesPath`/`itemsPath`形式もサポート）。Gmail件名パターンを管理コンソールから編集できる機能を実装し、設定ファイル（`backup.json`）に保存されるように変更。
  - プランファイル: `.cursor/plans/csv_import_scaling_ccfbf0e7.plan.md`（全To-do完了済み）
  - 詳細: [docs/knowledge-base/frontend.md#kb-112](./knowledge-base/frontend.md#kb-112-csvインポート構造改善と計測機器吊具対応) / [docs/knowledge-base/frontend.md#kb-113](./knowledge-base/frontend.md#kb-113-gmail件名パターンの管理コンソール編集機能) / [docs/knowledge-base/api.md#kb-114](./knowledge-base/api.md#kb-114-csvインポート構造改善レジストリファクトリパターン) / [docs/knowledge-base/api.md#kb-115](./knowledge-base/api.md#kb-115-gmail件名パターンの設定ファイル管理)

また、トランザクション履歴をCSV形式でエクスポートできます。

## USBメモリ経由のCSVインポート

管理画面からCSVファイルをアップロードしてインポートできます。従業員・工具・計測機器・吊具の4種類に対応しています。

### インポート手順

1. **管理画面にアクセス**: `https://<Pi5のIP>/admin`
2. **「一括登録」タブにアクセス**: `https://<Pi5のIP>/admin/import`
3. **CSVファイルを選択**: 各データタイプのフォームからCSVファイルを選択
   - 従業員CSV (`employees.csv`)
   - 工具CSV (`items.csv`)
   - 計測機器CSV (`measuring-instruments.csv`)
   - 吊具CSV (`rigging-gears.csv`)
4. **オプション設定**: 「既存データをクリアしてから取り込み」にチェックを入れるか選択
5. **取り込み開始**: 「取り込み開始」ボタンをクリック

### 各フォームの特徴

- **個別アップロード**: 各データタイプを個別にアップロード可能
- **独立した設定**: 各フォームで`replaceExisting`を個別に設定可能
- **ファイル名表示**: 選択したファイル名が表示され、確認可能

### APIエンドポイント

**エンドポイント**: `POST /api/imports/master/:type`

**パラメータ**:
- `:type`: データタイプ（`employees`, `items`, `measuring-instruments`, `rigging-gears`）

**リクエスト形式**: multipart form data
- `file`: CSVファイル（必須）
- `replaceExisting`: 既存データをクリアするか（`true` / `false`、デフォルト: `false`）

**認証**: 管理者権限（`ADMIN`）が必要

## CSVインポート仕様

### 基本要件

- **文字コード**: UTF-8
- **形式**: CSV（カンマ区切り）
- **ヘッダー行**: 必須（1行目）
- **データ行**: 1行1レコード

### 従業員CSV（employees.csv）

#### 必須項目

| 列名 | 形式 | 説明 | 例 |
|------|------|------|-----|
| `employeeCode` | 数字4桁 | 社員コード（一意、写真番号に対応） | `0001`, `0123` |
| `lastName` | 文字列 | 苗字 | `山田` |
| `firstName` | 文字列 | 名前 | `太郎` |

#### 任意項目

| 列名 | 形式 | 説明 | 例 |
|------|------|------|-----|
| `department` | 文字列 | 所属部署 | `製造部` |
| `nfcTagUid` | 文字列 | NFCタグUID（14文字の16進数） | `04C362E1330289` |
| `status` | 文字列 | ステータス（`ACTIVE` / `INACTIVE` / `SUSPENDED`、未指定時は`ACTIVE`） | `ACTIVE` |

**注意**: `displayName`（氏名）は`lastName + firstName`で自動生成されます。CSVには含めません。

#### CSV例

```csv
employeeCode,lastName,firstName,department,nfcTagUid,status
0001,山田,太郎,製造部,04C362E1330289,ACTIVE
0002,佐藤,花子,品質管理部,,ACTIVE
0003,鈴木,一郎,製造部,04DE8366BC2A81,INACTIVE
```

#### バリデーションルール

- `employeeCode`: 数字4桁のみ（`/^\d{4}$/`）
- `lastName`: 1文字以上（必須）
- `firstName`: 1文字以上（必須）
- `nfcTagUid`: 既存の従業員・工具・計測機器・吊具で使用されていないこと
- CSV内で`nfcTagUid`が重複していないこと
- 他のマスターデータCSV間で`nfcTagUid`が重複していないこと

### 工具CSV（items.csv）

#### 必須項目

| 列名 | 形式 | 説明 | 例 |
|------|------|------|-----|
| `itemCode` | TO + 数字4桁 | 管理番号（一意） | `TO0001`, `TO0123` |
| `name` | 文字列 | 工具名 | `ドライバー No.1` |

#### 任意項目

| 列名 | 形式 | 説明 | 例 |
|------|------|------|-----|
| `nfcTagUid` | 文字列 | NFCタグUID（14文字の16進数） | `04DE8366BC2A81` |
| `category` | 文字列 | カテゴリ | `工具` |
| `storageLocation` | 文字列 | 保管場所 | `工具庫A` |
| `status` | 文字列 | ステータス（`AVAILABLE` / `IN_USE` / `MAINTENANCE` / `RETIRED`） | `AVAILABLE` |
| `notes` | 文字列 | 備考 | `定期点検必要` |

#### CSV例

```csv
itemCode,name,nfcTagUid,category,storageLocation,status,notes
TO0001,ドライバー No.1,04DE8366BC2A81,工具,工具庫A,AVAILABLE,
TO0002,レンチセット,,工具,工具庫B,AVAILABLE,定期点検必要
TO0003,ハンマー,04C362E1330289,工具,工具庫A,IN_USE,
```

#### バリデーションルール

- `itemCode`: TO + 数字4桁のみ（`/^TO\d{4}$/`）
- `name`: 1文字以上
- `nfcTagUid`: 既存の従業員・工具で使用されていないこと
- CSV内で`nfcTagUid`が重複していないこと
- 従業員CSVと工具CSV間で`nfcTagUid`が重複していないこと

### 計測機器CSV（measuring-instruments.csv）

#### 必須項目

| 列名 | 形式 | 説明 | 例 |
|------|------|------|-----|
| `managementNumber` | 文字列 | 管理番号（一意） | `MI-001`, `MI-123` |
| `name` | 文字列 | 名称 | `てこ式ダイヤルゲージ` |

#### 任意項目

| 列名 | 形式 | 説明 | 例 |
|------|------|------|-----|
| `storageLocation` | 文字列 | 保管場所 | `工具庫A` |
| `department` | 文字列 | 管理部署 | `品質管理部` |
| `measurementRange` | 文字列 | 測定範囲 | `0-100mm` |
| `calibrationExpiryDate` | 日付（YYYY-MM-DD） | 校正期限 | `2025-12-31` |
| `status` | 文字列 | ステータス（`AVAILABLE` / `IN_USE` / `MAINTENANCE` / `RETIRED`、未指定時は`AVAILABLE`） | `AVAILABLE` |
| `rfidTagUid` | 文字列 | NFCタグUID（14文字の16進数） | `04C362E1330289` |

#### CSV例

```csv
managementNumber,name,storageLocation,department,measurementRange,calibrationExpiryDate,status,rfidTagUid
MI-001,てこ式ダイヤルゲージ,工具庫A,品質管理部,0-100mm,2025-12-31,AVAILABLE,04C362E1330289
MI-002,ノギス,工具庫B,品質管理部,0-150mm,2025-06-30,AVAILABLE,
MI-003,マイクロメータ,工具庫A,品質管理部,0-25mm,2025-09-30,IN_USE,04DE8366BC2A81
```

#### バリデーションルール

- `managementNumber`: 1文字以上（一意）
- `name`: 1文字以上
- `rfidTagUid`: 既存の従業員・工具・計測機器・吊具で使用されていないこと
- CSV内で`rfidTagUid`が重複していないこと
- 他のマスターデータCSV間で`rfidTagUid`が重複していないこと

### 吊具CSV（rigging-gears.csv）

#### 必須項目

| 列名 | 形式 | 説明 | 例 |
|------|------|------|-----|
| `managementNumber` | 文字列 | 管理番号（一意） | `RG-001`, `RG-123` |
| `name` | 文字列 | 名称 | `ワイヤーロープ 10t` |

#### 任意項目

| 列名 | 形式 | 説明 | 例 |
|------|------|------|-----|
| `storageLocation` | 文字列 | 保管場所 | `工具庫A` |
| `department` | 文字列 | 管理部署 | `製造部` |
| `startedAt` | 日付（YYYY-MM-DD） | 使用開始日 | `2020-01-01` |
| `usableYears` | 数値 | 使用可能年数 | `10` |
| `maxLoadTon` | 数値 | 定格荷重（t） | `10` |
| `lengthMm` | 数値 | 長さ（mm） | `5000` |
| `widthMm` | 数値 | 幅（mm） | `100` |
| `thicknessMm` | 数値 | 厚さ（mm） | `20` |
| `status` | 文字列 | ステータス（`AVAILABLE` / `IN_USE` / `MAINTENANCE` / `RETIRED`、未指定時は`AVAILABLE`） | `AVAILABLE` |
| `notes` | 文字列 | 備考 | `定期点検必要` |
| `rfidTagUid` | 文字列 | NFCタグUID（14文字の16進数） | `04C362E1330289` |

#### CSV例

```csv
managementNumber,name,storageLocation,department,startedAt,usableYears,maxLoadTon,lengthMm,widthMm,thicknessMm,status,notes,rfidTagUid
RG-001,ワイヤーロープ 10t,工具庫A,製造部,2020-01-01,10,10,5000,100,20,AVAILABLE,,04C362E1330289
RG-002,チェーンブロック 5t,工具庫B,製造部,2019-06-01,15,5,3000,80,15,AVAILABLE,定期点検必要,
RG-003,スリングベルト 3t,工具庫A,製造部,2021-03-15,8,3,2000,50,10,IN_USE,,04DE8366BC2A81
```

#### バリデーションルール

- `managementNumber`: 1文字以上（一意）
- `name`: 1文字以上
- `rfidTagUid`: 既存の従業員・工具・計測機器・吊具で使用されていないこと
- CSV内で`rfidTagUid`が重複していないこと
- 他のマスターデータCSV間で`rfidTagUid`が重複していないこと

## インポート処理の動作

### 通常インポート（`replaceExisting: false`）

- 既存データは削除されません
- `employeeCode` / `itemCode` / `managementNumber`が一致する場合: 既存レコードを更新
- 一致しない場合: 新規レコードを作成

### 全削除してからインポート（`replaceExisting: true`）

- 選択したCSVの種類（従業員・工具・計測機器・吊具）の既存データを削除してからインポート
- **安全性**: 参照がある個体（貸出記録、点検記録など）は削除されません
  - 従業員: 貸出記録（Loan）が存在する場合は削除されない
  - 工具: 貸出記録（Loan）が存在する場合は削除されない
  - 計測機器: 貸出記録（Loan）または点検記録（InspectionRecord）が存在する場合は削除されない
  - 吊具: 貸出記録（Loan）が存在する場合は削除されない

## エラーメッセージ

### バリデーションエラー

- `社員コードは数字4桁である必要があります（例: 0001）`: `employeeCode`の形式が不正
- `苗字は必須です`: `lastName`が空
- `名前は必須です`: `firstName`が空
- `管理番号はTO + 数字4桁である必要があります（例: TO0001）`: `itemCode`の形式が不正
- `名称は必須です`: `name`が空（計測機器・吊具）
- `管理番号は必須です`: `managementNumber`が空（計測機器・吊具）

### 重複エラー

- `nfcTagUid="..."は既にemployeeCode="..."で使用されています。employeeCode="..."では使用できません。`: 既存の従業員が同じ`nfcTagUid`を使用している
- `nfcTagUid="..."は既にitemCode="..."で使用されています。itemCode="..."では使用できません。`: 既存の工具が同じ`nfcTagUid`を使用している
- `CSV内でnfcTagUidが重複しています: ...`: CSV内で同じ`nfcTagUid`が複数回使用されている
- `従業員とアイテムで同じnfcTagUidが使用されています: ...`: 従業員CSVと工具CSV間で`nfcTagUid`が重複している

## CSVエクスポート仕様

### トランザクション履歴エクスポート

履歴画面からCSV形式でトランザクション履歴をエクスポートできます。

#### エクスポート項目

| 列名 | 説明 |
|------|------|
| `日時` | トランザクションの日時 |
| `アクション` | アクション種別（`BORROW` / `RETURN`） |
| `アイテム` | アイテム名（スナップショット優先） |
| `従業員` | 従業員名（スナップショット優先） |
| `端末` | クライアント端末名 |

#### エクスポート方法

1. 管理画面の「履歴」タブにアクセス
2. 必要に応じて日時フィルタを設定
3. 「CSVエクスポート」ボタンをクリック
4. `transactions.csv`がダウンロードされます

## DropboxからのCSVインポート

### 手動実行

管理画面からDropbox経由でCSVをインポートできます。

**APIエンドポイント**: `POST /api/imports/master/from-dropbox`

**リクエスト例**:
```json
{
  "employeesPath": "/backups/csv/employees-20251216.csv",
  "itemsPath": "/backups/csv/items-20251216.csv",
  "replaceExisting": false
}
```

**認証**: 管理者権限（`ADMIN`）が必要

### スケジュール実行

設定ファイル（`backup.json`）でスケジュールを設定すると、自動的にDropboxまたはGmailからCSVを取得してインポートします。

#### Dropbox経由のスケジュール実行

**設定例（新形式）**:
```json
{
  "csvImports": [
    {
      "id": "daily-import",
      "name": "毎日のCSVインポート",
      "provider": "dropbox",
      "schedule": "0 2 * * *",
      "timezone": "Asia/Tokyo",
      "targets": [
        { "type": "employees", "source": "/backups/csv/employees-YYYYMMDD.csv" },
        { "type": "items", "source": "/backups/csv/items-YYYYMMDD.csv" },
        { "type": "measuringInstruments", "source": "/backups/csv/measuring-instruments-YYYYMMDD.csv" },
        { "type": "riggingGears", "source": "/backups/csv/rigging-gears-YYYYMMDD.csv" }
      ],
      "replaceExisting": false,
      "enabled": true
    }
  ]
}
```

**設定例（旧形式・後方互換）**:
```json
{
  "csvImports": [
    {
      "id": "daily-employees-import",
      "name": "毎日の従業員CSVインポート",
      "schedule": "0 2 * * *",
      "timezone": "Asia/Tokyo",
      "employeesPath": "/backups/csv/employees-YYYYMMDD.csv",
      "itemsPath": "/backups/csv/items-YYYYMMDD.csv",
      "replaceExisting": false,
      "enabled": true
    }
  ]
}
```

**注意**: 旧形式（`employeesPath`/`itemsPath`）もサポートされていますが、新形式（`targets`）の使用を推奨します。

#### Gmail経由のスケジュール実行

GmailからCSVファイルを自動取得してインポートできます。PowerAutomateなどからGmailにCSVファイルを送信し、設定した件名パターンに一致するメールの添付ファイルを自動的にインポートします。

**設定例**:
```json
{
  "csvImports": [
    {
      "id": "gmail-daily-import",
      "name": "Gmail経由の毎日CSVインポート",
      "provider": "gmail",
      "schedule": "0 4 * * 1,2,3",
      "timezone": "Asia/Tokyo",
      "targets": [
        { "type": "employees", "source": "[Pi5 CSV Import] employees" },
        { "type": "items", "source": "[Pi5 CSV Import] items" },
        { "type": "measuringInstruments", "source": "[Pi5 CSV Import] measuring-instruments" },
        { "type": "riggingGears", "source": "[Pi5 CSV Import] rigging-gears" }
      ],
      "replaceExisting": false,
      "enabled": true
    }
  ],
  "csvImportSubjectPatterns": {
    "employees": [
      "[Pi5 CSV Import] employees",
      "[CSV Import] employees",
      "CSV Import - employees",
      "従業員CSVインポート"
    ],
    "items": [
      "[Pi5 CSV Import] items",
      "[CSV Import] items",
      "CSV Import - items",
      "アイテムCSVインポート"
    ],
    "measuringInstruments": [
      "[Pi5 CSV Import] measuring-instruments",
      "[CSV Import] measuring-instruments",
      "CSV Import - measuring-instruments",
      "計測機器CSVインポート"
    ],
    "riggingGears": [
      "[Pi5 CSV Import] rigging-gears",
      "[CSV Import] rigging-gears",
      "CSV Import - rigging-gears",
      "吊具CSVインポート"
    ]
  }
}
```

**Gmail件名パターンの管理**:
- 管理コンソールの「CSVインポートスケジュール」ページから、Gmail件名パターンを編集できます
- 件名パターンは`backup.json`の`csvImportSubjectPatterns`に保存されます
- Gmailプロバイダーを使用する場合、`targets`の`source`フィールドは件名パターンから選択します

**詳細**: 
- [PowerAutomate → Dropbox → Pi5 CSV統合ガイド](./powerautomate-dropbox-integration.md)
- [Gmail設定ガイド](./gmail-setup-guide.md)

#### スケジュールの手動実行

スケジュールに設定されたインポートを手動で実行できます。管理コンソールの「CSVインポートスケジュール」ページから、各スケジュールの「実行」ボタンをクリックして実行できます。

**APIエンドポイント**: `POST /api/imports/schedule/:id/run`

**動作**:
- 手動実行時は**リトライをスキップ**し、即座に結果を返します
- Gmailプロバイダーの場合、該当メールがない場合は即座にエラーを返します（リトライなし）
- 自動実行（スケジュール実行）の場合は、リトライ機能が有効です（最大3回、指数バックオフ）

**注意**: 
- 手動実行は即座に結果を確認したい用途のため、リトライは実行されません
- 自動実行はメールがまだ届いていない可能性があるため、リトライ機能が有効です

### インポート履歴

スケジュール実行や手動実行の履歴を確認できます。

**APIエンドポイント**:
- `GET /api/imports/history`: 全履歴取得（フィルタ・ページング対応）
- `GET /api/imports/schedule/:id/history`: 特定スケジュールの履歴取得
- `GET /api/imports/history/failed`: 失敗した履歴のみ取得
- `GET /api/imports/history/:historyId`: 詳細履歴取得

**詳細**: [CSVインポート履歴機能の有効化手順](./csv-import-history-migration.md)

### CSVインポート後の自動バックアップ（Phase 3）

CSVインポート成功時に自動的にバックアップを実行できます。

**設定例**:
```json
{
  "csvImports": [
    {
      "id": "daily-import",
      "name": "毎日のCSVインポート",
      "provider": "dropbox",
      "schedule": "0 2 * * *",
      "targets": [
        { "type": "employees", "source": "/backups/csv/employees-YYYYMMDD.csv" },
        { "type": "items", "source": "/backups/csv/items-YYYYMMDD.csv" }
      ],
      "enabled": true,
      "autoBackupAfterImport": {
        "enabled": true,
        "targets": ["csv"]
      }
    }
  ]
}
```

**バックアップ対象**:
- `csv`: CSVデータのみ（employees, items, measuringInstruments, riggingGears）
- `database`: データベース全体
- `all`: CSV + データベース

**動作**:
- CSVインポート成功時に自動的にバックアップを実行
- バックアップ失敗時もインポート成功は維持（エラーログのみ記録）
- バックアップ履歴が自動的に記録される

### Dropboxからのバックアップリストア（Phase 3）

Dropboxからバックアップをダウンロードしてリストアできます。

**APIエンドポイント**: `POST /api/backup/restore/from-dropbox`

**リクエスト例**:
```json
{
  "backupPath": "/backups/database/2025-12-16T04-00-00-000Z/database",
  "targetKind": "database",
  "verifyIntegrity": true,
  "expectedSize": 1024000,
  "expectedHash": "sha256-hash-value"
}
```

**パラメータ**:
- `backupPath`: Dropbox上のバックアップファイルパス（必須）
- `targetKind`: リストア対象の種類（`database`, `csv`、オプション）
- `verifyIntegrity`: 整合性検証を実行するか（デフォルト: `true`）
- `expectedSize`: 期待されるファイルサイズ（バイト、オプション）
- `expectedHash`: 期待されるハッシュ値（SHA256、オプション）

**認証**: 管理者権限（`ADMIN`）が必要

**動作**:
- Dropboxからバックアップファイルをダウンロード
- 整合性検証（ファイルサイズ、ハッシュ値、形式）
- データベースまたはCSVのリストアを実行
- リストア履歴が自動的に記録される

### バックアップ・リストア履歴（Phase 3）

バックアップ・リストア実行履歴を確認できます。

**APIエンドポイント**:
- `GET /api/backup/history`: バックアップ履歴一覧取得（フィルタ・ページング対応）
- `GET /api/backup/history/:id`: バックアップ履歴詳細取得

**クエリパラメータ**（`GET /api/backup/history`）:
- `operationType`: `BACKUP` または `RESTORE`
- `targetKind`: バックアップ対象の種類（`database`, `csv`, `file`, `directory`, `image`）
- `status`: `PENDING`, `PROCESSING`, `COMPLETED`, `FAILED`
- `startDate`: 開始日時（ISO 8601形式）
- `endDate`: 終了日時（ISO 8601形式）
- `offset`: オフセット（ページング）
- `limit`: 取得件数（デフォルト: 100）

**レスポンス例**:
```json
{
  "history": [
    {
      "id": "uuid",
      "operationType": "BACKUP",
      "targetKind": "csv",
      "targetSource": "employees",
      "backupPath": "/backups/csv/2025-12-16T04-00-00-000Z/employees.csv",
      "storageProvider": "dropbox",
      "status": "COMPLETED",
      "sizeBytes": 1024,
      "hash": "sha256-hash-value",
      "startedAt": "2025-12-16T04:00:00.000Z",
      "completedAt": "2025-12-16T04:00:05.000Z"
    }
  ],
  "total": 1,
  "offset": 0,
  "limit": 100
}
```

## CSVインポート構造の改善

### レジストリ・ファクトリパターンの導入

CSVインポート機能は、拡張性と保守性を向上させるため、レジストリ・ファクトリパターンを採用しています。

**アーキテクチャ**:
- `CsvImporter`インターフェース: 各データタイプ（従業員・工具・計測機器・吊具）のインポータが実装する共通インターフェース
- `CsvImporterRegistry`: すべてのインポータを管理するレジストリ
- `CsvImporterFactory`: データタイプに応じて適切なインポータを取得するファクトリ

**メリット**:
- 新しいデータタイプの追加が容易（新しいインポータを実装してレジストリに登録するだけ）
- コードの重複を削減（共通ロジックをインターフェースに集約）
- テストが容易（各インポータを独立してテスト可能）

**実装ファイル**:
- `apps/api/src/services/imports/csv-importer.types.ts`: 型定義
- `apps/api/src/services/imports/csv-importer-registry.ts`: レジストリ実装
- `apps/api/src/services/imports/csv-importer-factory.ts`: ファクトリ実装
- `apps/api/src/services/imports/importers/`: 各データタイプのインポータ実装

### 後方互換性

旧形式（`employeesPath`/`itemsPath`）のスケジュール設定も引き続きサポートされています。設定ファイルを読み込む際に、自動的に新形式（`targets`）に変換されます。

## 将来の拡張予定

### マスターデータエクスポート

- 従業員マスタのCSVエクスポート機能
- 工具マスタのCSVエクスポート機能
- 計測機器マスタのCSVエクスポート機能
- 吊具マスタのCSVエクスポート機能

### その他のマスターデータインポート

- 将来のモジュール（ドキュメント管理、物流管理など）用のマスターデータインポート機能
- 新しいデータタイプの追加は、`CsvImporter`インターフェースを実装してレジストリに登録するだけで対応可能

## 実機検証

CSVフォーマット仕様実装の実機検証手順は、[検証チェックリスト](./verification-checklist.md#6-csvフォーマット仕様実装の検証2025-12-31)を参照してください。

## 関連ドキュメント

- [デプロイメントガイド](./deployment.md)
- [PowerAutomate → Dropbox → Pi5 CSV統合ガイド](./powerautomate-dropbox-integration.md)
- [CSVインポート履歴機能の有効化手順](./csv-import-history-migration.md)
- [Dropbox CSV統合機能の現状分析](../analysis/dropbox-csv-integration-status.md)
- [トラブルシューティングナレッジベース](../knowledge-base/troubleshooting-knowledge.md#kb-003-p2002エラーnfctaguidの重複が発生する)
- [検証チェックリスト](./verification-checklist.md#6-csvフォーマット仕様実装の検証2025-12-31)

