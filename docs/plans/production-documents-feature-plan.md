# 写真付きドキュメント表示機能の実装計画

## ゴール

生産スケジュールの各アイテム（FHINCD + FSIGENCD）に紐づく写真付きドキュメントをキオスクに表示する機能を追加する。

- データソース: GmailのCSV出力（PowerAutomate経由）
- 表示方法（Phase 1）: 生産スケジュール画面でアイコン表示 → クリックで全画面モーダル表示
- 表示方法（Phase 2・将来）: USB接続のハンディリーダーでバーコード（FHINCD）スキャン → ドキュメント表示
- ストレージ: Pi5のストレージに保存、各クライアントがリクエストして取得表示
- 画像最適化: Pi5サーバー保存時に実施（20インチFullHDの半分サイズ、約100KB目標）

## 現状の理解

### 既存実装の確認

- **生産スケジュール機能**: `CsvDashboard`/`CsvDashboardRow`で管理、`FHINCD`は`rowData`（JSON）に含まれる（実機検証は未完了）
- **計測機器持出返却機能**: 全アイテムをCSVで送る差分取得ロジックで実装済み（テキストのみ、データ量が軽い）
- **ストレージ機能**: `PhotoStorage`で写真保存、サムネイル生成、API配信の仕組みあり
- **Gmail CSV取得**: `gmailScheduleId`/`gmailSubjectPattern`でスケジュール取得の仕組みあり
- **CSVインポート**: `CsvImporterFactory`で複数タイプのCSVインポートに対応

### 要件の確定事項

1. **データモデル**: 新規テーブル`ProductionDocument`を作成（疎結合・モジュール化）
2. **紐づけキー**: `FHINCD` + `FSIGENCD`（工程ごとのドキュメント）
3. **画像数**: 1アイテムあたり約8枚の写真 + テキスト
4. **更新方式**: **変更されたアイテムのみを送る差分取得**（計測機器持出返却とは異なる方式）
5. **取得頻度**: SharePointリストの変更時にリアルタイムでGmail送信（PowerAutomateトリガー）
6. **データソース**: SharePointリスト（全アイテムを保存、変更検知で差分送信）
6. **表示UI（Phase 1）**: 生産スケジュール画面のアイコン → 全画面モーダル → バツボタンで戻る
7. **表示UI（Phase 2・将来）**: USB接続のハンディリーダーでバーコード（FHINCD）スキャン → ドキュメント表示
7. **画像サイズ**: 20インチFullHDの右/左半分に表示、縦スクロール
8. **CSV構造**: パターンA（1行に1枚の画像+テキスト）
9. **差分管理**: CSVに含まれない既存ドキュメントは削除する
10. **画像追い番号**: 1始まり（画像が減った場合の既存ファイルも削除）
11. **画像最適化**: 同期処理、失敗時は元画像を保存せず再度実施かアラートで止める
12. **自動削除**: ドキュメントは自動削除しない
13. **バックアップ**: 当初はDropboxバックアップ対象外だが、バックアップ可能な状態で保持

## データモデル設計案

```prisma
model ProductionDocument {
  id          String   @id @default(uuid())
  fhincd      String   // 品番
  fsigencd    String   // 工程コード
  imageIndex  Int      // 画像の順序（1始まり）
  title       String?  // タイトル（CSVから取得、オプション）
  textContent String?  // テキスト内容
  imagePath   String   // 画像ファイルパス（相対パス）
  imageUrl    String   // 画像URL（API経由アクセス用）
  dataHash    String?  // データのハッシュ（差分判定用）
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  
  @@unique([fhincd, fsigencd, imageIndex]) // 複合ユニーク制約
  @@index([fhincd, fsigencd]) // 検索用複合インデックス
  @@index([fhincd])
  @@index([fsigencd])
}
```

### 画像ファイル命名規則

```
documents/images/{YYYY}/{MM}/{FHINCD}_{FSIGENCD}_{imageIndex}.jpg
例: documents/images/2026/01/ABC123_001_1.jpg
   documents/images/2026/01/ABC123_001_2.jpg
   ...
   documents/images/2026/01/ABC123_001_8.jpg
```

**注意**: `imageIndex`は1始まりです。画像が減った場合（例: 8枚→5枚）、既存ファイル（index 6,7,8）は削除されます。

## 未確定事項・質問事項

### 🔴 重要（実装前に決定が必要）

#### 1. データ送信方式とCSV構造の設計 🔴 要検討

**重要な設計変更**: 計測機器持出返却とは異なり、**変更されたアイテムのみを送る方式**を採用

**背景**:
- 計測機器持出返却: テキストのみのため、全アイテムをCSVで送る方式（データ量が軽い）
- 写真付きドキュメント: 画像があるため、全アイテムを送るとデータ量が大きくなる
- SharePointリストに全アイテムを保存し、変更検知で差分送信する方式に変更

**PowerAutomateでの実装方法**:

**回答**: 「変更か追加されたアイテムのテキストと画像を列ごとに分けてCSVにする」という単一のアクションは**存在しません**。複数のアクションを組み合わせて実装する必要があります。

**⚠️ 重要な制約**: SharePointリストの構造が**第1正規化されていない（非正規化）**構造になっています。

**SharePointリストの列構造**（変更不可）:
```
FHINCD, FSIGENCD, 画像1, 画像1のテキスト, 画像2, 画像2のテキスト, ..., 画像8, 画像8のテキスト
```
- 1行に1アイテムの全データが横に広がる構造（非正規化）
- 画像とテキストが列として並んでいる（最大8組）

**システム側が期待するCSV構造**:
```
FHINCD,FSIGENCD,imageIndex,textContent,imageBase64
ABC123,001,1,手順1の説明,base64data...
ABC123,001,2,手順2の説明,base64data...
```
- 1行に1枚の画像+テキストの縦に長い構造（正規化）

**結論**: **可能です**。**PowerAutomate側で正規化処理を実装する必要があります**。

**正規化処理の概要**:
- SharePointリストの1行（横に広がる構造）を取得
- それを縦に展開して、1行に1枚の画像+テキストの構造に変換
- 変換後の正規化されたデータからCSVを作成
- Pi5側は正規化されたCSVを受け取るため、追加の変換処理は不要

**方法A: SharePointリストの変更トリガーを使用（推奨）**

**実装手順**（非正規化構造からの変換）:

1. **トリガー**: 「アイテムが作成または変更されたとき」（SharePoint）
   - 変更されたアイテムのみがトリガーされる

2. **SharePointリストアイテムを取得**:
   - トリガーで取得されたアイテムの全列を取得
   - `FHINCD`, `FSIGENCD`, `画像1`, `画像1のテキスト`, `画像2`, `画像2のテキスト`, ..., `画像8`, `画像8のテキスト`

3. **画像列から画像ファイルを取得**:
   - 各画像列（`画像1`〜`画像8`）から画像ファイルのパスまたはIDを取得
   - 「Get file content using path」アクションを使用
   - または画像列が添付ファイル列の場合は「Get attachments」アクションを使用

4. **画像をBase64に変換**:
   - `base64()`関数を使用: `@{base64(body('Get_file_content')['$content'])}`
   - 各画像をBase64文字列に変換

5. **非正規化構造から正規化構造への変換**:
   - 「Initialize variable」アクションで配列変数を作成: `csvRows`
   - 「Apply to each」アクションで1〜8をループ処理
   - 各ループで以下を実行:
     - 画像列が空でない場合のみ処理
     - 配列に以下のオブジェクトを追加:
       ```
       {
         "FHINCD": "@{triggerBody()?['FHINCD']}",
         "FSIGENCD": "@{triggerBody()?['FSIGENCD']}",
         "imageIndex": "@{items('Apply_to_each')}",  // 1〜8
         "textContent": "@{triggerBody()?['画像@{items('Apply_to_each')}のテキスト']}",
         "imageBase64": "@{base64(...)}"  // 対応する画像のBase64
       }
       ```
   - 結果として、1〜8枚の画像が縦に展開された配列が作成される

6. **CSVテーブルを作成**:
   - 「Create CSV Table」アクションを使用
   - データソース: 上記で作成した`csvRows`配列
   - 列の指定: カスタム列を選択し、`FHINCD`, `FSIGENCD`, `imageIndex`, `textContent`, `imageBase64`を指定

7. **Gmailで送信**:
   - 「Send an email (V2)」アクション
   - 件名: `[生産ドキュメント] @{triggerBody()?['FHINCD']}_@{triggerBody()?['FSIGENCD']}`
   - 添付ファイル: CSVファイルを添付

**実装のポイント**:
- SharePointリストの列名が仮名称の場合、実際の列名に合わせて調整が必要
- 画像が存在しない場合（例: 画像3が空）は、その行をスキップする
- `imageIndex`は1始まりで設定（ループのインデックスを使用）
- 画像とテキストの対応関係を正確に保つ（`画像1`と`画像1のテキスト`が対応）

**実装例（PowerAutomateフロー）**:
```
1. トリガー: アイテムが作成または変更されたとき
2. Initialize variable: csvRows = []
3. Apply to each (1 to 8):
   - Condition: 画像{currentItem}が空でない
   - Append to array variable:
     - FHINCD: @{triggerBody()?['FHINCD']}
     - FSIGENCD: @{triggerBody()?['FSIGENCD']}
     - imageIndex: @{currentItem}
     - textContent: @{triggerBody()?['画像@{currentItem}のテキスト']}
     - imageBase64: @{base64(body('Get_file_content_@{currentItem}')['$content'])}
4. Create CSV Table: csvRows配列を使用
5. Send an email: CSVファイルを添付
```

**方法B: スケジュール実行で変更検知**
- 定期的に（例: 10分おき）SharePointリストをポーリング
- 「Get items」アクションでリストアイテムを取得
- `Modified`列で変更検知（前回実行時刻以降の変更を検知）
- 変更されたアイテムのみを処理（方法Aと同じ手順）

**推奨**: 方法A（変更トリガー）を推奨。リアルタイム性が高く、無駄な処理が少ない。

**データ送信形式の比較**:

**パターン1: CSVファイルとして送信（推奨）**
```
件名: [生産ドキュメント] ABC123_001
添付: production-document.csv

CSV内容:
FHINCD,FSIGENCD,imageIndex,textContent,imageBase64
ABC123,001,1,手順1の説明,base64data...
ABC123,001,2,手順2の説明,base64data...
```

**メリット**:
- 既存のCSVパース処理を流用できる
- 構造化されたデータで処理が容易
- エラーハンドリングが簡単（行単位で処理可能）
- 複数アイテムを1つのCSVにまとめられる（将来的な拡張性）

**デメリット**:
- Gmailの添付ファイルサイズ制限（25MB）を考慮する必要がある
- Base64データが大きい場合、CSVファイルサイズが大きくなる

**パターン2: メール本文にテキストとBase64データを埋め込み**
```
件名: [生産ドキュメント] ABC123_001
本文:
FHINCD: ABC123
FSIGENCD: 001
imageIndex: 1
textContent: 手順1の説明
imageBase64: base64data...

---
FHINCD: ABC123
FSIGENCD: 001
imageIndex: 2
textContent: 手順2の説明
imageBase64: base64data...
```

**メリット**:
- 添付ファイル不要
- Gmailの本文サイズ制限（通常は問題にならない）

**デメリット**:
- パース処理が複雑（正規表現や行単位の解析が必要）
- 構造化されていないため、エラーハンドリングが難しい
- 複数アイテムを1つのメールにまとめるのが困難
- 既存のCSVパース処理を流用できない

**システム側からの推奨**: **パターン1（CSVファイル）を推奨**

**理由**:
1. 既存のCSVパース処理（`csv-parse/sync`）を流用できる
2. 構造化されたデータで処理が容易
3. エラーハンドリングが簡単（行単位で処理可能）
4. 将来的に複数アイテムを1つのCSVにまとめる拡張が容易
5. PowerAutomateの「Create CSV Table」アクションで実装可能

**サイズ制限への対応**:
- 画像1枚あたり100KB目標 → Base64エンコード後は約133KB（4/3倍）
- 8枚で約1MB程度 → Gmailの25MB制限内に十分収まる
- 1アイテムあたりのデータサイズが小さいため、問題にならない

**PowerAutomate実装時の注意事項**:
- 「Create CSV Table」アクションの列指定で、`imageBase64`列が正しく含まれることを確認
- Base64データが長い場合、CSVの1行が非常に長くなる可能性がある（通常は問題なし）
- 画像が8枚ある場合、CSVは8行になる（1行に1枚の画像+テキスト）

**推奨CSV構造（システム側から見た最適案）**:

```
FHINCD,FSIGENCD,imageIndex,textContent,imageBase64
ABC123,001,1,手順1の説明,base64data...
ABC123,001,2,手順2の説明,base64data...
ABC123,001,3,手順3の説明,base64data...
```

**注意**: SharePointリストの構造が非正規化されているため、PowerAutomate側で上記の正規化構造に変換する必要があります。

**列の説明**:
- `FHINCD` (必須): 品番
- `FSIGENCD` (必須): 工程コード
- `imageIndex` (必須): 画像の順序（1始まりの整数）
- `textContent` (必須): テキスト内容（空文字列も可）
- `imageBase64` (必須): Base64エンコードされたJPEG画像データ

**Gmailの件名パターン**: `段取写真_三島研削`

**システム側から見た推奨理由**:

1. **パースの簡潔性**
   - 既存の`csv-parse/sync`ライブラリでそのまま処理可能
   - 行単位で処理できるため、メモリ効率が良い
   - エラー時の影響範囲が小さい（1行のエラーが他の行に影響しない）

2. **エラーハンドリングの容易さ**
   - 行単位でエラーを検出・記録できる
   - 部分的な失敗を許容しやすい（該当行をスキップして続行可能）

3. **サイズ制限への対応**
   - 画像1枚あたり100KB目標 → Base64エンコード後は約133KB（4/3倍）
   - 8枚で約1MB程度 → Gmailの添付ファイルサイズ制限（25MB）内に収まる
   - 1行あたりのデータサイズが小さいため、パース時のメモリ負荷が低い

4. **差分反映の実装が容易**
   - `(FHINCD, FSIGENCD, imageIndex)`の組み合わせで一意に識別可能
   - 行単位で追加・更新・削除を判定できる

5. **将来の拡張性**
   - オプション列（例: `title`）を追加しても影響が小さい
   - 画像のメタデータ（例: `imageFormat`, `imageSize`）を追加しやすい

**PowerAutomate側での実装時の注意事項**:

- CSVのエンコーディング: UTF-8（BOMなし）を推奨
- 改行コード: LF（`\n`）を推奨（CRLFでも動作するが、LFの方が一貫性がある）
- Base64データ内の改行: 含めない（1行に収める）
- テキスト内の改行: CSVの仕様上、改行を含む場合はダブルクォートで囲む必要がある
- 空のテキスト: 空文字列（`""`）で送信可能

**代替案（検討不要だが参考）**:

- **パターンB（1行に複数画像）**: JSON配列で埋め込む方式
  - デメリット: パースが複雑、エラー時の影響範囲が大きい、CSVの可読性が低い
  - メリット: 行数が少なくなる
  - **結論**: システム側からは推奨しない

---

#### 2. 差分反映のロジック ✅ 確定（設計変更あり）

**決定事項**: 変更されたアイテムのみを送る方式のため、**CSVに含まれるアイテムのみを更新**する

**設計変更の背景**:
- 計測機器持出返却: 全アイテムをCSVで送るため、CSVに含まれない = 削除
- 写真付きドキュメント: 変更されたアイテムのみを送るため、CSVに含まれない = 削除しない（既存データを保持）

**実装方針**:
- `dedupKeyColumns`: `['FHINCD', 'FSIGENCD', 'imageIndex']`（画像の順序も含める）
- 差分判定: `(FHINCD, FSIGENCD, imageIndex)`の組み合わせで既存チェック
  - CSVに存在するが既存DBにない → **新規追加**
  - CSVに存在し既存DBにも存在するが内容が異なる → **更新**（画像・テキストを上書き）
  - CSVに存在しないが既存DBに存在する → **削除しない**（既存データを保持）

**重要な変更点**:
- 計測機器持出返却とは異なり、**CSVに含まれない既存ドキュメントは削除しない**
- 変更されたアイテムのみがCSVに含まれるため、削除処理は不要
- 削除が必要な場合は、PowerAutomate側で明示的に削除フラグを送るか、別の仕組みを検討

**具体例**:

**ケース1: 中間の画像が削除された場合（設計変更後の動作）**
- **更新前**: `(ABC123, 001, imageIndex=1)`, `(ABC123, 001, imageIndex=2)`, `(ABC123, 001, imageIndex=3)` の3枚
- **新しいCSV**: `(ABC123, 001, imageIndex=1)`, `(ABC123, 001, imageIndex=3)` の2枚（2枚目が削除）
- **結果**: 
  - `imageIndex=1` → 更新またはそのまま
  - `imageIndex=2` → **削除される**（CSVに存在しないため、このアイテムの更新として扱う）
  - `imageIndex=3` → 更新またはそのまま
- **結論**: **1と3は更新され、2は削除される**（このアイテム全体が更新対象として送信されるため）

**注意**: PowerAutomate側で、画像が削除された場合は、そのアイテム全体をCSVに含めて送信する必要がある（削除された画像はCSVに含めない）

**ケース2: 末尾の画像が削除された場合**
- **更新前**: `(ABC123, 001, imageIndex=1)`, `(ABC123, 001, imageIndex=2)`, `(ABC123, 001, imageIndex=3)` の3枚
- **新しいCSV**: `(ABC123, 001, imageIndex=1)`, `(ABC123, 001, imageIndex=2)` の2枚（3枚目が削除）
- **結果**: 
  - `imageIndex=1` → 残る
  - `imageIndex=2` → 残る
  - `imageIndex=3` → **削除される**

**ケース3: 先頭の画像が削除された場合**
- **更新前**: `(ABC123, 001, imageIndex=1)`, `(ABC123, 001, imageIndex=2)`, `(ABC123, 001, imageIndex=3)` の3枚
- **新しいCSV**: `(ABC123, 001, imageIndex=2)`, `(ABC123, 001, imageIndex=3)` の2枚（1枚目が削除）
- **結果**: 
  - `imageIndex=1` → **削除される**
  - `imageIndex=2` → 残る
  - `imageIndex=3` → 残る

**重要なポイント**:
- `imageIndex`は**リナンバリングしない**（CSVの`imageIndex`の値をそのまま使用）
- **変更されたアイテムのみがCSVに含まれる**ため、CSVに含まれる`(FHINCD, FSIGENCD)`の組み合わせのドキュメントのみを更新
- CSVに含まれない`imageIndex`のドキュメントは削除される（**そのアイテムの更新として扱う**）
- 画像の順序はCSVの`imageIndex`の値で決まる（連番である必要はない）
- **他のアイテム（CSVに含まれない）の既存データは保持される**

**既存実装参考**:
- `CsvDashboard`の`dedupKeyColumns`で重複除去
- `dataHash`で変更検知

---

#### 3. 画像ファイル名の追い番号 ✅ 確定

**決定事項**: 追い番号は1始まり、画像が減った場合の既存ファイルは削除する

**実装方針**:
- 追い番号は1始まり（`imageIndex: 1, 2, 3, ...`）
- 画像ファイル名: `{FHINCD}_{FSIGENCD}_{imageIndex}.jpg`
- 画像が減った場合（例: 8枚→5枚）の既存ファイル（index 6,7,8）は削除する

---

#### 4. 全画面モーダルの実装方法 ✅ 確定

**決定事項**: 方法A（URLパスで管理）を採用

**実装方針**:
- React Routerの`useNavigate`を使用
- パス: `/kiosk/production-schedule/:fhincd/:fsigencd/documents`
- メリット: ブラウザの戻るボタンで戻れる、URL共有可能、既存のキオスクページの実装パターンに一致

**実装詳細**:
- 生産スケジュール画面のアイコンクリック → `navigate(/kiosk/production-schedule/${fhincd}/${fsigencd}/documents)`
- ドキュメント表示ページでバツボタンクリック → `navigate(-1)` または `navigate(/kiosk/production-schedule)`
- ルーティング設定: `apps/web/src/App.tsx`に新規ルートを追加

---

#### 5. 画像最適化のタイミング ✅ 確定

**決定事項**: 同期処理で実施、失敗時は元画像を保存せず再度実施かアラートで止める

**実装方針**:
- CSVインポート時に同期的に最適化（シンプル）
- 最適化失敗時: 元画像を保存せず、エラーログを記録してアラート通知
- リトライ: 手動で再度インポートを実行するか、自動リトライ機能を検討（将来実装）

**注意事項**:
- インポート時間が増える可能性がある（画像数×最適化時間）
- 最適化処理のタイムアウト設定が必要

---

### 🟡 中程度（実装中に決定可能）

#### 6. エラーハンドリング ✅ 確定

**決定事項**: 全部成功しない限り失敗とみなす

**実装方針**:
- Base64デコード失敗、画像取得失敗、画像最適化失敗など、いずれかのエラーが発生した場合は全体を失敗とする
- 部分成功は許容しない
- エラー時はインポートジョブを失敗状態にし、エラーログを記録
- エラーメッセージに詳細な情報（どの行で失敗したか、エラーの種類など）を含める

---

#### 7. ストレージ容量管理 ✅ 確定

**決定事項**: ドキュメントは自動削除しない

**実装方針**:
- 自動削除機能は実装しない
- 手動削除のみ対応（管理画面から削除可能にする）
- 将来的に自動削除が必要になった場合は、別途実装を検討

---

#### 8. バックアップ ✅ 確定

**決定事項**: 当初はDropboxバックアップ対象外だが、バックアップ可能な状態で保持

**実装方針**:
- 初期実装ではDropboxバックアップ対象外
- ただし、バックアップスクリプト（`scripts/server/backup.sh`）に追加可能な設計で実装
- 将来的にDropboxバックアップが必要になった場合は、設定を追加するだけで対応可能にする
- ローカルバックアップ（`/opt/backups/`）への追加は将来検討

---

### 🟢 低優先度（後で決定可能）

#### 9. ドキュメント表示の細かいデザイン

**確定事項**: 全画面モーダル、バツボタンで戻る、縦スクロール

**未確定事項**:
- 画像とテキストのレイアウト（上下配置、左右配置など）
- フォントサイズ、余白などの詳細

**確認事項**:
- [ ] 細かいデザインは後で煮詰める方針で問題ないですか？（現時点では最小限の実装でOK）

---

## アーキテクチャ設計方針（疎結合・モジュール化・スケーラビリティ）

### 設計原則

ドキュメント機能は今後拡張が予想されるため、以下の原則に基づいて設計します：

1. **境界と依存方向**
   - 依存は「**安定→不安定**」へ向ける
   - UI/アプリ層が、DB/HTTP/FSなどの詳細へ直結しない（アダプタ/境界で隔離）
   - ドキュメントモジュールは独立した境界として設計

2. **契約（API/型/データ）と互換性**
   - 互換性を壊す変更は原則避け、必要なら段階的移行（deprecate→移行→削除）
   - 入出力の契約はテスト/型/スキーマで固定し、暗黙仕様を増やさない

3. **横断関心の扱い**
   - ログ/エラー/認可/リトライなど横断関心は共通化し、呼び出し側に散らさない
   - 画像最適化、ストレージ管理などは共通サービスとして提供

### モジュール構造

```
apps/api/src/
├── routes/documents/              # ドキュメントAPIルート（HTTP層）
│   ├── production-documents/
│   │   ├── index.ts              # ルート登録
│   │   ├── list.ts              # GET /documents/production
│   │   ├── get.ts               # GET /documents/production/:fhincd/:fsigencd
│   │   └── schemas.ts           # バリデーションスキーマ
│   └── index.ts                 # モジュールルート登録
├── services/documents/            # ドキュメントサービス層（ビジネスロジック層）
│   ├── production-documents/
│   │   ├── production-document.service.ts  # ドキュメントCRUD操作
│   │   ├── production-document-importer.ts # CSVインポート処理
│   │   └── index.ts
│   └── index.ts
├── lib/
│   ├── document-storage.ts       # ストレージ抽象化（インターフェース）
│   └── document-storage-*.ts     # 実装（ファイルシステム、S3など将来対応）
└── services/imports/
    ├── importers/
    │   └── production-documents.ts  # CSVインポーター実装（CsvImporterインターフェース）
    └── ...
```

### レイヤー構造と依存関係

```
┌─────────────────────────────────────┐
│  Routes (HTTP層)                    │  ← ユーザーリクエスト
│  - バリデーション                   │
│  - 認証・認可                       │
└──────────────┬──────────────────────┘
               │ 依存
               ↓
┌─────────────────────────────────────┐
│  Services (ビジネスロジック層)      │  ← ビジネスルール
│  - ProductionDocumentService        │
│  - ProductionDocumentImporter       │
└──────────────┬──────────────────────┘
               │ 依存
               ↓
┌─────────────────────────────────────┐
│  Storage (ストレージ抽象化層)       │  ← インターフェース
│  - DocumentStorage (interface)      │
└──────────────┬──────────────────────┘
               │ 実装
               ↓
┌─────────────────────────────────────┐
│  Infrastructure (詳細実装層)        │  ← 実装詳細
│  - FileSystemDocumentStorage        │
│  - (将来: S3DocumentStorage等)      │
└─────────────────────────────────────┘
```

### インターフェース設計

#### DocumentStorageインターフェース（ストレージ抽象化）

```typescript
/**
 * ドキュメントストレージインターフェース
 * 実装詳細（ファイルシステム、S3等）から独立
 */
export interface DocumentStorage {
  /**
   * 画像を保存する
   */
  saveImage(
    fhincd: string,
    fsigencd: string,
    imageIndex: number,
    imageBuffer: Buffer,
    textContent: string
  ): Promise<DocumentPathInfo>;

  /**
   * 画像を取得する
   */
  getImage(path: string): Promise<Buffer>;

  /**
   * 画像を削除する
   */
  deleteImage(path: string): Promise<void>;

  /**
   * アイテムの全画像を削除する
   */
  deleteImagesByItem(fhincd: string, fsigencd: string): Promise<void>;
}
```

#### ProductionDocumentService（ビジネスロジック層）

```typescript
/**
 * 生産ドキュメントサービス
 * ビジネスロジックを提供（ストレージ実装に依存しない）
 */
export class ProductionDocumentService {
  constructor(
    private prisma: PrismaClient,
    private storage: DocumentStorage  // インターフェースに依存
  ) {}

  async findByItem(fhincd: string, fsigencd: string): Promise<ProductionDocument[]>
  async create(data: ProductionDocumentCreateInput): Promise<ProductionDocument>
  async update(id: string, data: ProductionDocumentUpdateInput): Promise<ProductionDocument>
  async delete(id: string): Promise<void>
  async deleteByItem(fhincd: string, fsigencd: string): Promise<void>
}
```

### 拡張ポイントの明確化

#### 1. ストレージ実装の拡張

**現在**: ファイルシステム（`FileSystemDocumentStorage`）
**将来の拡張**:
- S3ストレージ（`S3DocumentStorage`）
- Azure Blob Storage（`AzureBlobDocumentStorage`）
- その他のクラウドストレージ

**実装方法**:
- `DocumentStorage`インターフェースを実装
- 設定で切り替え可能にする（環境変数や設定ファイル）

#### 2. CSVインポーターの拡張

**現在**: `production-documents`タイプ
**将来の拡張**:
- 他のドキュメントタイプ（例: `quality-documents`, `safety-documents`）
- 異なるCSV構造への対応

**実装方法**:
- `CsvImporter`インターフェースを実装
- `CsvImporterRegistry`に登録

#### 3. 画像最適化処理の拡張

**現在**: JPEG形式、960px幅、100KB目標
**将来の拡張**:
- WebP形式対応
- 複数の最適化プロファイル（サムネイル、中サイズ、大サイズ）
- 動画対応

**実装方法**:
- `ImageOptimizer`インターフェースを作成
- 実装を切り替え可能にする

#### 4. ドキュメントタイプの拡張

**現在**: 生産スケジュール関連ドキュメントのみ
**将来の拡張**:
- 品質管理ドキュメント
- 安全管理ドキュメント
- その他のドキュメントタイプ

**実装方法**:
- `ProductionDocument`テーブルに`documentType`列を追加（将来）
- または、各タイプごとに独立したテーブルを作成（より疎結合）

#### 5. ドキュメント閲覧ルートの拡張 ✅ 将来実装予定（要件確定）

**現在（Phase 1）**: 生産スケジュール画面のアイコンから表示
**将来の拡張（Phase 2）**: USB接続のハンディリーダーでバーコード（FHINCD）スキャン → ドキュメント表示

**バーコードリーダーの仕様**:
- **製品**: [Amazon B0CSDKSBC2](https://www.amazon.co.jp/dp/B0CSDKSBC2?ref=ppx_yo2ov_dt_b_fed_asin_title&th=1)
- **通信方式**: シリアル通信モードで使用
- **接続先**: クライアントのPi4に接続
- **スキャン方式**: 1回に1つしかバーコードはスキャンしない
- **動作確認**: これから実施予定
- **シリアル通信ロジック**: これから開発予定

**要件**:
- USB接続のシリアル通信できるハンディリーダー
- 紙（移動票）に印刷されたバーコード（FHINCD）をスキャン
- スキャンしたFHINCDに紐づくドキュメントを表示

**実装方針**:
- 既存のNFC Agentパターンを参考に、バーコードリーダー用のエージェントを作成
- WebSocketでバーコードデータを配信（既存のNFC Agentと同様の仕組み）
- フロントエンドでバーコードイベントを受信し、ドキュメントを表示
- バーコードリーダーエージェントはPi4クライアント側に配置（NFC Agentと同様）

**設計のポイント**:
- 既存の`useNfcStream`フックを参考に、新規の`useBarcodeStream`フックを作成
- バーコードリーダーエージェントは独立したモジュールとして実装（NFC Agentと同様）
- ドキュメント表示ロジックは既存の`ProductionDocumentPage`を再利用可能な設計にする

**UI/UXの設計**:

1. **スキャン後の動作**:
   - バーコードをスキャン → FHINCDで検索
   - **複数のFHINCDがある場合**: 表形式で一覧を表示
   - 各アイテムに生産スケジュールと同じアイコンを表示
   - アイコンをクリック → ドキュメント表示（生産スケジュールのロジックと同じ）

2. **エラーハンドリング**:
   - **バーコードが存在しない場合**: ウィンドウ（モーダル）を表示して「バーコードが見つかりません」と表示
   - **ドキュメントが存在しない場合**: ウィンドウ（モーダル）を表示して「ドキュメントが見つかりません」と表示
   - **スキャンエラー時**: ウィンドウ（モーダル）を表示してエラー内容を表示

3. **その他の仕様**:
   - スキャン履歴の記録: **不要**
   - スキャン音の設定: **リーダー側で設定**（システム側では制御しない）

**実装タイミング**:
- Phase 1（現在の機能）が完成してから実装
- バーコードリーダーの動作確認とシリアル通信ロジックの開発後に実装開始

**未確定事項（後日確認）**:

1. **バーコードの形式**
   - バーコードの種類（Code128、QRコード、その他）
   - FHINCDのみが含まれるか、他の情報も含まれるか
   - データの形式（プレーンテキスト、JSON等）

2. **FHINCDの検索方法**
   - バーコードにFHINCDのみが含まれる場合の検索方法
   - 複数のFHINCDがある場合の一覧表示方法（全工程を表示する想定）

### モジュール境界の明確化

#### ドキュメントモジュールの境界

```
documents/
├── production-documents/     # 生産ドキュメント（現在の実装）
│   ├── routes/
│   ├── services/
│   └── types/
└── (将来の拡張)
    ├── quality-documents/    # 品質ドキュメント
    └── safety-documents/     # 安全ドキュメント
```

**境界の原則**:
- 各サブモジュールは独立して動作可能
- 共通機能（ストレージ、画像最適化）は共有モジュールとして提供
- モジュール間の直接依存を避ける（イベントやメッセージングで連携）

### 依存関係の管理

#### 許可される依存方向

```
documents/production-documents/
  ↓ 依存可能
lib/document-storage (interface)
  ↓ 実装
lib/document-storage-filesystem (実装)

documents/production-documents/
  ↓ 依存可能
services/imports/csv-importer (interface)
  ↓ 実装
services/imports/importers/production-documents (実装)
```

#### 禁止される依存方向

```
lib/document-storage-filesystem
  ✗ 依存禁止
documents/production-documents (ビジネスロジック層)

routes/documents/
  ✗ 依存禁止
lib/document-storage-filesystem (実装詳細)
  ✓ 依存可能
lib/document-storage (interface)
```

### テスト容易性の確保

#### モック化可能な設計

```typescript
// サービス層のテスト
describe('ProductionDocumentService', () => {
  it('should create document', async () => {
    const mockStorage: DocumentStorage = {
      saveImage: jest.fn().mockResolvedValue({ ... }),
      // ...
    };
    const service = new ProductionDocumentService(prisma, mockStorage);
    // テスト実行
  });
});
```

#### 統合テストの分離

- ユニットテスト: サービス層のみ（ストレージはモック）
- 統合テスト: ストレージ実装を含む（ファイルシステムまたはテスト用ストレージ）

### パフォーマンス考慮

#### 遅延読み込みとキャッシュ

- 画像の遅延読み込み（必要になったら取得）
- メタデータのキャッシュ（DBに保存、画像はストレージから取得）
- バッチ処理の最適化（複数画像の一括処理）

#### スケーラビリティ

- ストレージ実装の切り替え（ファイルシステム → S3等）でスケール可能
- 画像最適化処理の非同期化（将来の拡張）
- CDN連携（将来の拡張）

---

## 実装計画

### Phase 1: データモデル設計

**作業内容**:
- `ProductionDocument`テーブル作成（`fhincd`+`fsigencd`+`imageIndex`複合キー）
- Prismaマイグレーション
- シードデータ（テスト用）

**成果物**:
- `apps/api/prisma/schema.prisma`の更新
- マイグレーションファイル

---

### Phase 2: ストレージ実装（疎結合設計）

**作業内容**:
- `DocumentStorage`インターフェース定義（ストレージ抽象化）
- `FileSystemDocumentStorage`クラス実装（`PhotoStorage`を参考）
- Base64デコード処理（JPEG形式）
- 画像最適化ロジック（JPEG入力、960px幅、100KB目標、同期処理、JPEG品質75-80%）
- 画像最適化失敗時のエラーハンドリング（元画像を保存せず、エラーログとアラート、全体を失敗とする）
- 画像ファイル保存（`documents/images/{YYYY}/{MM}/{FHINCD}_{FSIGENCD}_{imageIndex}.jpg`、imageIndexは1始まり、JPEG形式）

**成果物**:
- `apps/api/src/lib/document-storage.ts`（インターフェース）
- `apps/api/src/lib/document-storage-filesystem.ts`（実装）
- 画像最適化ユーティリティ（将来の拡張を考慮した設計）

**設計ポイント**:
- インターフェースと実装を分離（将来のS3等への拡張を容易に）
- 依存性の注入（サービス層からインターフェースに依存）

---

### Phase 3: CSVインポート実装（拡張可能な設計）

**作業内容**:
- `CsvImporter`インターフェースを実装した新規インポーター（`production-documents`タイプ）
- `CsvImporterRegistry`に新規インポーターを登録
- `ProductionDocumentService`の作成（ビジネスロジック層）
- 差分反映ロジック（dedupKeyColumns: `['FHINCD', 'FSIGENCD', 'imageIndex']`）
- **変更されたアイテムのみを更新するロジック**（CSVに含まれる`(FHINCD, FSIGENCD)`の組み合わせのみ）
- CSVに含まれない既存ドキュメントの削除処理（**そのアイテムの更新として扱う**、DBレコードとファイルの両方を削除）
- エラーハンドリング（全部成功しない限り失敗、部分成功は許容しない）
- Gmail取得処理（件名パターン: `段取写真_三島研削`）
- `CsvImportSubjectPattern`に新規タイプ追加（件名パターン: `段取写真_三島研削`）

**成果物**:
- `apps/api/src/services/documents/production-documents/production-document.service.ts`
- `apps/api/src/services/imports/importers/production-documents.ts`（`CsvImporter`インターフェース実装）
- CSVインポート設定UIの更新

**設計ポイント**:
- `CsvImporter`インターフェースを実装（既存パターンに従う）
- サービス層とインポーター層を分離（責務の明確化）
- レジストリパターンで拡張可能に（将来の新しいドキュメントタイプ追加が容易）

---

### Phase 4: API実装（レイヤー分離）

**作業内容**:
- `GET /api/kiosk/production-schedule/:fhincd/:fsigencd/documents`（キオスク用）
- 画像配信API（既存`/api/storage/photos`を参考）
- エラーハンドリング
- ルートハンドラーからサービス層への依存（実装詳細に依存しない）

**成果物**:
- `apps/api/src/routes/documents/production-documents/index.ts`（ルート登録）
- `apps/api/src/routes/documents/production-documents/get.ts`（GET処理）
- `apps/api/src/routes/documents/production-documents/schemas.ts`（バリデーション）
- `apps/api/src/routes/kiosk.ts`の更新（キオスク用エンドポイント）
- `apps/api/src/routes/storage.ts`の更新（画像配信）

**設計ポイント**:
- ルートハンドラーはHTTP層のみに責任を持つ（バリデーション、認証・認可）
- ビジネスロジックはサービス層に委譲
- サービス層はストレージインターフェースに依存（実装詳細に依存しない）

---

### Phase 5: フロントエンド実装（コンポーネント分離）

**作業内容**:
- 生産スケジュールページにドキュメントアイコン追加
- 新規ページ実装（`/kiosk/production-schedule/:fhincd/:fsigencd/documents`）
- バツボタンで戻る機能（`navigate(-1)`）
- 画像とテキストの表示（縦スクロール）
- ルーティング設定（`App.tsx`に新規ルート追加）
- コンポーネントの分離（再利用可能な設計）

**成果物**:
- `apps/web/src/pages/kiosk/ProductionSchedulePage.tsx`の更新（アイコン追加）
- `apps/web/src/pages/kiosk/ProductionDocumentPage.tsx`（新規、全画面表示）
- `apps/web/src/components/documents/ProductionDocumentViewer.tsx`（再利用可能なコンポーネント）
- `apps/web/src/App.tsx`の更新（ルーティング追加）
- `apps/web/src/api/client.ts`の更新（API呼び出し）

**設計ポイント**:
- ページコンポーネントと表示コンポーネントを分離（再利用性）
- API呼び出しはカスタムフックに分離（`useProductionDocuments`など）
- 将来の他のドキュメントタイプでも再利用可能な設計
- **Phase 2でバーコードスキャン機能を追加する際も、同じコンポーネントを再利用可能な設計**

---

### Phase 6: バーコードスキャン機能（将来実装）

**前提条件**: Phase 1〜5が完成してから実装

**作業内容**:
- バーコードリーダーエージェントの実装（既存のNFC Agentパターンを参考）
  - シリアル通信ロジックの実装（Pi4クライアント側）
  - WebSocketでバーコードデータを配信（`{barcode: string, timestamp: string, type: 'barcode'}`など）
- フロントエンドでバーコードイベントを受信するフック（`useBarcodeStream`）
- バーコードスキャン時の一覧表示ページ（`/kiosk/documents/barcode/:fhincd`）
  - FHINCDで検索して複数のドキュメントを表形式で一覧表示
  - 各アイテムに生産スケジュールと同じアイコンを表示
  - アイコンクリックでドキュメント表示（`ProductionDocumentPage`を再利用）
- エラーハンドリング（モーダルウィンドウでエラー表示）
- ルーティング設定（`App.tsx`に新規ルート追加）

**成果物**:
- `clients/barcode-agent/`（新規、バーコードリーダーエージェント）
  - `barcode_agent/main.py`（メイン処理）
  - `barcode_agent/reader.py`（シリアル通信処理）
  - `barcode_agent/config.py`（設定管理）
- `apps/web/src/hooks/useBarcodeStream.ts`（新規、バーコードイベント受信フック）
- `apps/web/src/pages/kiosk/BarcodeDocumentListPage.tsx`（新規、一覧表示ページ）
- `apps/web/src/components/documents/BarcodeErrorModal.tsx`（新規、エラー表示モーダル）
- `apps/web/src/App.tsx`の更新（ルーティング追加）

**設計ポイント**:
- 既存のNFC Agentパターンを参考に実装（一貫性の維持）
- シリアル通信モードで動作（バーコードリーダーの仕様に合わせる）
- ドキュメント表示ロジックは`ProductionDocumentViewer`コンポーネントを再利用
- FHINCDで検索して複数のドキュメントを一覧表示（FSIGENCDが複数ある場合も対応）
- エラー時はモーダルウィンドウで表示（バーコードが存在しない、ドキュメントが存在しない、スキャンエラー）

---

## 技術的な考慮事項

### 画像最適化の実装（拡張可能な設計）

**要件**:
- 20インチFullHDの半分（960px幅程度）
- 約100KB目標

**実装方針**:
- 入力形式: JPEG（PowerAutomateから送られてくる形式）
- リサイズ: 最大幅960px、縦横比維持
- 圧縮: JPEG品質75-80%
- 出力形式: JPEG（WebPは将来検討）

**使用ライブラリ候補**:
- `sharp`（Node.jsの画像処理ライブラリ）

**拡張性の考慮**:
- `ImageOptimizer`インターフェースを作成（将来の拡張を容易に）
- 複数の最適化プロファイルに対応可能な設計（サムネイル、中サイズ、大サイズ）
- 最適化処理の非同期化（将来の拡張）

---

### パフォーマンス考慮（スケーラビリティ）

**懸念事項**:
- 大量ドキュメントの一括インポート
- 画像の一括ダウンロード・最適化
- キオスク画面での表示パフォーマンス

**対策**:
- インデックス: `(fhincd, fsigencd)`に複合インデックス
- キャッシュ: ドキュメント有無フラグを`CsvDashboardRow`に追加（JOIN回避）※要検討
- ページネーション: ドキュメント一覧はページング不要（1アイテムあたり8枚程度）
- 遅延読み込み: 画像は必要になったら取得（メタデータのみDBに保存）
- ストレージ実装の切り替え: ファイルシステム → S3等でスケール可能（インターフェース設計により容易）

**将来の拡張**:
- CDN連携（画像配信の高速化）
- 画像最適化処理の非同期化（バックグラウンドジョブ）
- 複数の最適化プロファイル（サムネイル、中サイズ、大サイズ）

---

### セキュリティ考慮

**実装方針**:
- キオスクAPIは既存の`x-client-key`認証を使用
- 画像配信APIも同様の認証を適用
- バーコードスキャン機能（Phase 2）も同様の認証を適用

### 将来の拡張機能

#### Phase 2: バーコードスキャン機能 ✅ 要件確定

**要件**:
- USB接続のシリアル通信できるハンディリーダー（Amazon B0CSDKSBC2）
- 紙（移動票）に印刷されたバーコード（FHINCD）をスキャン
- スキャンしたFHINCDに紐づくドキュメントを表示

**バーコードリーダーの仕様**:
- **製品**: [Amazon B0CSDKSBC2](https://www.amazon.co.jp/dp/B0CSDKSBC2?ref=ppx_yo2ov_dt_b_fed_asin_title&th=1)
- **通信方式**: シリアル通信モードで使用
- **接続先**: クライアントのPi4に接続
- **スキャン方式**: 1回に1つしかバーコードはスキャンしない
- **動作確認**: これから実施予定
- **シリアル通信ロジック**: これから開発予定

**実装方針**:
- 既存のNFC Agentパターンを参考に、バーコードリーダー用のエージェントを作成
- WebSocketでバーコードデータを配信（既存のNFC Agentと同様の仕組み）
- フロントエンドでバーコードイベントを受信し、ドキュメントを表示
- バーコードリーダーエージェントはPi4クライアント側に配置（NFC Agentと同様）

**UI/UXの設計**:

1. **スキャン後の動作**:
   - バーコードをスキャン → FHINCDで検索
   - **複数のFHINCDがある場合**: 表形式で一覧を表示
   - 各アイテムに生産スケジュールと同じアイコンを表示
   - アイコンをクリック → ドキュメント表示（生産スケジュールのロジックと同じ）

2. **エラーハンドリング**:
   - **バーコードが存在しない場合**: ウィンドウ（モーダル）を表示して「バーコードが見つかりません」と表示
   - **ドキュメントが存在しない場合**: ウィンドウ（モーダル）を表示して「ドキュメントが見つかりません」と表示
   - **スキャンエラー時**: ウィンドウ（モーダル）を表示してエラー内容を表示

3. **その他の仕様**:
   - スキャン履歴の記録: **不要**
   - スキャン音の設定: **リーダー側で設定**（システム側では制御しない）

**設計のポイント**:
- 既存の`useNfcStream`フックを参考に、新規の`useBarcodeStream`フックを作成
- バーコードリーダーエージェントは独立したモジュールとして実装（NFC Agentと同様）
- ドキュメント表示ロジックは既存の`ProductionDocumentViewer`コンポーネントを再利用
- FHINCDで検索して複数のドキュメントを一覧表示（FSIGENCDが複数ある場合も対応）

**実装タイミング**:
- Phase 1（現在の機能）が完成してから実装
- バーコードリーダーの動作確認とシリアル通信ロジックの開発後に実装開始

**未確定事項（後日確認）**:
- バーコードの形式（FHINCDのみが含まれるか、他の情報も含まれるか）

---

## 関連ドキュメント

- [生産スケジュールキオスク実装計画](./production-schedule-kiosk-execplan.md)
- [Gmailデータ取得実装計画](./gmail-data-acquisition-execplan.md)
- [CSVインポート・エクスポートガイド](../guides/csv-import-export.md)
- [アーキテクチャ概要](../architecture/overview.md)
- [モジュール構造の決定](../decisions/001-module-structure.md)
- [サービス層の導入](../decisions/002-service-layer.md)
- [工具管理モジュール サービス層設計](../modules/tools/services.md)

---

## PowerAutomate設計時に必要な情報

### ✅ 確定事項

1. **Gmailの件名パターン** ✅ 確定
   - **件名**: `段取写真_三島研削`
   - Pi5側の`CsvImportSubjectPattern`に登録する必要がある
   - Gmail検索クエリとして使用される

2. **画像の形式** ✅ 確定
   - **形式**: JPEG
   - Pi5側で最適化処理を行う際、JPEG形式として処理する

3. **エラーハンドリングの方針** ✅ 確定
   - **方針**: 全部成功しない限り失敗とみなす
   - Base64デコード失敗、画像取得失敗、画像最適化失敗など、いずれかのエラーが発生した場合は全体を失敗とする
   - 部分成功は許容しない
   - エラー時はインポートジョブを失敗状態にし、エラーログを記録

### 🔴 未確定（明後日決定）

4. **SharePointリストの列名の正確な名称**
   - 現在は仮名称（`画像1`, `画像1のテキスト`など）
   - 実際の列名を確認して、PowerAutomateフローで使用する列名を確定
   - 列名が変更される可能性がある場合は、変数化して管理しやすい設計にする

### 🟡 推奨（実装前に決定すると良い）

5. **テストデータの準備**
   - 実装後の動作確認用のテストデータ
   - 様々なケース（画像1枚、8枚、途中が空など）を準備

### 🟢 後で決定可能

6. **ドキュメント表示の細かいデザイン**
   - 画像とテキストのレイアウト、フォントサイズなど
   - 最小限の実装で開始し、後で改善

---

## 更新履歴

- 2026-01-25: 初版作成（ブレスト内容を整理）
- 2026-01-25: 確定事項の反映（CSV構造、差分管理、追い番号、画像最適化、自動削除、バックアップ）
- 2026-01-25: CSV構造の推奨案追加（システム側から見た最適案）、全画面モーダル実装方法確定（URLパスで管理）
- 2026-01-25: 差分反映ロジックの具体例追加（中間・末尾・先頭の画像削除ケース、リナンバリングしないことを明記）
- 2026-01-25: **設計変更**: 変更されたアイテムのみを送る方式に変更、PowerAutomate実装方法の検討、CSV vs メール本文の比較追加
- 2026-01-25: **PowerAutomate実装手順の詳細化**: 「Create CSV Table」アクションを使用した実装手順を追加、画像取得とBase64変換の方法を明記
- 2026-01-25: **SharePointリストの非正規化構造への対応**: 横に広がる構造（画像1〜8、テキスト1〜8）から縦に長い構造への変換処理を追加、実装例を明記
- 2026-01-25: **PowerAutomate設計時に必要な情報を追加**: Gmail件名パターン、列名の正確な名称、画像形式などの確認事項を整理
- 2026-01-25: **確定事項の反映**: Gmail件名パターン（`段取写真_三島研削`）、エラーハンドリング方針（全部成功しない限り失敗）、画像形式（JPEG）を確定
- 2026-01-25: **アーキテクチャ設計方針の追加**: 疎結合・モジュール化・スケーラビリティを考慮した設計方針を追加、レイヤー構造、インターフェース設計、拡張ポイントの明確化
- 2026-01-25: **将来の拡張機能の追加**: バーコードスキャン機能（Phase 2）を追加、既存のNFC Agentパターンを参考にした設計方針を明記
- 2026-01-25: **バーコードスキャン機能の要件確定**: バーコードリーダー仕様（Amazon B0CSDKSBC2、シリアル通信モード）、UI/UX設計（一覧表示、エラーハンドリング）、実装方針を確定
