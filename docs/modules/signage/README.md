# デジタルサイネージモジュール

最終更新: 2025-12-13（デザイン・座標設計反映）

## 概要

デジタルサイネージモジュールは、ラズパイ5サーバーから取得したデータをHDMIモニターに表示する機能を提供します。工具管理データやPDFファイルを、スケジュールに基づいて自動的に切り替えて表示します。

## 機能要件

### 表示データ

- **工具管理データ**: サムネイル付きの工具情報を表示
- **PDFファイル**: PDFをスライドショー形式または1ページ表示形式で表示
- **拡張性**: 将来的に他のデータタイプ（従業員情報、統計情報、お知らせなど）を追加可能

### 表示モード

- **スケジュール自動切り替え**: 曜日・時間帯に基づいて自動的に表示内容を切り替え
- **手動切り替え**: 管理画面から手動で表示内容を切り替え
- **表示パターン**:
  - 工具管理データのみ
  - PDFのみ
  - 左右分割表示（工具管理データとPDFを同時表示）

### PDF表示

- **表示形式**: スライドショー形式（自動ページ切り替え）または1ページ表示形式を設定で選択可能
- **アップロード方法**: 管理画面からのアップロードとUSB経由のアップロードの両方に対応
- **軽量化**: ラズパイZERO2Wにも対応できるよう、サーバー側でPDFを画像に変換して配信（検討）

### スケジュール設定

- **設定項目**: 曜日、時間帯、優先順位を自由に設定可能
- **適用範囲**: PDFと工具管理データの両方にスケジュール設定が可能
- **優先順位**: 複数のスケジュールが重複した場合、手動で設定した優先順位に従う

### 緊急表示機能

- **最優先表示**: 緊急のお知らせなどを最優先で表示
- **設定方法**: 管理画面から緊急表示を設定可能

## 技術要件

### クライアント端末（サイネージ用ラズパイ）

- **OS**: Raspberry Pi OS
- **ブラウザ**: Chromium（キオスクモード）
- **自動起動**: システム起動時に自動的にブラウザを起動してサイネージ画面を表示
- **対応機種**: ラズパイ3、ラズパイZERO2W（処理能力を考慮した軽量化が必要）

### データ取得

- **方式**: ポーリング方式（定期的にAPIからデータを取得）
- **更新間隔**: 30秒〜1分間隔（設定可能）
- **オフライン時**: エラーメッセージのみ表示（キャッシュ表示なし）

### 設定画面

- **場所**: ラズパイ5の管理画面に統合
- **認証**: 既存の認証システムを使用
- **設定項目**:
  - スケジュール設定（曜日、時間帯、優先順位）
  - PDFアップロード・管理（サイネージタブ内で直接操作可能）
  - 表示パターン設定
  - 緊急表示設定
- **PDF管理機能**:
  - **サイネージタブ内でのPDFアップロード**: 管理コンソールの「サイネージ」タブ（`/admin/signage/schedules`）を開くと、ページ上部にPDFアップロード・管理セクションが表示されます
  - **機能**: PDFファイルのアップロード、一覧表示、有効/無効の切り替え、削除が可能
  - **表示モード設定**: スライドショー形式または単一表示形式を選択可能
  - **スライド間隔設定**: スライドショー形式の場合、ページ切り替え間隔（秒）を設定可能
  - **共通コンポーネント**: `SignagePdfManager`コンポーネントが共通化されており、サイネージタブとクライアント端末管理ページの両方で使用可能
- **タイムゾーン**:
  - サーバー側で `SIGNAGE_TIMEZONE` 環境変数を設定（デフォルト: `Asia/Tokyo`）
  - 例: `SIGNAGE_TIMEZONE=Asia/Tokyo`（`docker-compose.server.yml` の `api` サービスに設定）

### モニター仕様

- **解像度**: 1920x1080（Full HD）を基準に設計（50インチFHDモニター対応）
- **表示**: 全画面表示
- **レンダリング**: サーバー側でSVG→JPEG変換（`signage.renderer.ts`）
  - **余白**: 最小化（outerPadding=0、innerPadding約10px相当）
  - **タイトル**: 1行表示（2段タイトルを削除）
  - **ファイル名**: PDFファイル名は画像領域内に小さなフォント（約10px相当）でオーバーレイ表示
  - **表示領域最大化**: パネル角丸・ヘッダー高さを縮小し、データ表示領域を最大化

### レイアウト/座標設計メモ（SPLITビュー）
- SVGの`text`要素の`y`はベースライン位置。フォントサイズ分の下方向を加味して間隔を決める。
- 左右タイトルは共通オフセットで揃える（titleOffsetY目安: 約22px * scale）。
- 右ペインはタイトル直下からPDFを始めるため、`rightHeaderHeight`を最小化（約12px * scale）。黒地（PDFエリア）を最優先で拡大。
- 外枠は最小余白（outerPadding ≈ 0〜2px * scale）で上貼り付きを防ぎつつ領域を確保。

### カード表示仕様（工具管理データ）

各カードに表示する情報とレイアウト：

#### 工具カード
- **表示項目**:
  1. アイテム名（primaryText、18px、太字、白）
  2. 従業員名（secondary、16px、白）
  3. 借出日（date、14px、白）
  4. 借出時刻（time、14px、白）
  5. 警告（期限超過の場合、「⚠ 期限超過」、14px、白）
  6. **管理番号/アイテムコード（右下隅、14px、等幅フォント、白）**
- **レイアウト**: 上段に管理番号は表示しない（右下のみ）

#### 計測機器カード
- **表示項目**:
  1. **管理番号（上段、14px、太字、白、📏アイコン付き）**
  2. 名称（primaryText、18px、太字、白）
  3. 従業員名（secondary、16px、白）
  4. 借出日（date、14px、白）
  5. 借出時刻（time、14px、白）
  6. 警告（期限超過の場合、「⚠ 期限超過」、14px、白）
  7. **管理番号（右下隅、14px、等幅フォント、白）** - 重複表示だが識別用として維持
- **レイアウト**: 管理番号を上段、名称を下段に表示（仕様: `signage-lite.md`参照）

#### 吊具カード
- **表示項目**:
  1. 名称（primaryText、18px、太字、白）
  2. 従業員名（secondary、16px、白）
  3. 借出日（date、14px、白）
  4. 借出時刻（time、14px、白）
  5. 警告（期限超過の場合、「⚠ 期限超過」、14px、白）
  6. **管理番号/アイテムコード（右下隅、14px、等幅フォント、白）**
- **レイアウト**: 上段に管理番号は表示しない（右下のみ）

#### 行間設定
- **フォントサイズに応じた行間**: フォントサイズの1.6-2倍を確保
  - primaryText (18px) → 行間28px
  - secondary (16px) → 行間26px
  - date/time (14px) → 行間24-26px
- **文字同士が重ならないように調整**

#### 超過アイテムの表示
- **赤い太枠**: 期限超過アイテム（`isOver12Hours`または`isOverdue`が`true`）は赤い太枠（4px以上）で囲む
- **枠の色**: `rgba(220,38,38,1.0)` (red-600)

## アーキテクチャ

### コンポーネント構成

```
ラズパイ5（サーバー）
├── API（既存）
│   ├── /api/signage/schedules - スケジュール取得
│   ├── /api/signage/content - 表示コンテンツ取得
│   ├── /api/signage/pdfs - PDF管理
│   └── /api/signage/emergency - 緊急表示設定
├── Web管理画面（既存）
│   ├── /admin/signage/schedules - サイネージ設定画面（PDFアップロード機能統合）
│   ├── /admin/signage/pdfs - PDF管理専用画面
│   └── /admin/signage/emergency - 緊急表示設定画面
└── ストレージ
    └── /storage/signage/pdfs - PDFファイル保存

サイネージ用ラズパイ（クライアント）
├── Chromium（キオスクモード）
└── サイネージ表示画面（React）
    ├── スケジュール管理
    ├── コンテンツ表示
    └── ポーリング処理
```

### データフロー

1. **設定**: 管理画面でスケジュール・PDF・表示パターンを設定
2. **データ取得**: サイネージ用ラズパイがAPIからスケジュールとコンテンツを取得
3. **表示**: 現在時刻に基づいて適切なコンテンツを表示
4. **更新**: 定期的にポーリングして最新データを取得

## データベーススキーマ

### SignageSchedule（スケジュール）

```prisma
model SignageSchedule {
  id          String   @id @default(uuid())
  name        String   // スケジュール名
  contentType String   // "tools" | "pdf" | "split"
  pdfId       String?  @relation("SchedulePdf", fields: [pdfId], references: [id])
  pdf         SignagePdf? @relation("SchedulePdf")
  dayOfWeek   Int[]    // 0=日曜日, 1=月曜日, ..., 6=土曜日
  startTime   String   // "HH:mm"形式
  endTime     String   // "HH:mm"形式
  priority    Int      // 優先順位（数値が大きいほど優先）
  enabled     Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

### SignagePdf（PDFファイル）

```prisma
model SignagePdf {
  id          String   @id @default(uuid())
  name        String   // PDF名
  filename    String   // ファイル名
  filePath    String   // ファイルパス
  displayMode String   // "slideshow" | "single"
  slideInterval Int?   // スライドショー時の切り替え間隔（秒）
  enabled     Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  schedules   SignageSchedule[] @relation("SchedulePdf")
}
```

### SignageEmergency（緊急表示）

```prisma
model SignageEmergency {
  id          String   @id @default(uuid())
  message     String   // 緊急メッセージ
  contentType String?  // "message" | "pdf" | "tools"
  pdfId       String?  @relation("EmergencyPdf", fields: [pdfId], references: [id])
  pdf         SignagePdf? @relation("EmergencyPdf")
  enabled     Boolean  @default(false)
  expiresAt   DateTime? // 有効期限
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

## API仕様

### GET /api/signage/schedules

スケジュール一覧を取得

**レスポンス**:
```json
{
  "schedules": [
    {
      "id": "uuid",
      "name": "平日の工具管理表示",
      "contentType": "tools",
      "dayOfWeek": [1, 2, 3, 4, 5],
      "startTime": "09:00",
      "endTime": "17:00",
      "priority": 10,
      "enabled": true
    }
  ]
}
```

### GET /api/signage/content

現在時刻に基づいて表示すべきコンテンツを取得

**レスポンス**:
```json
{
  "contentType": "tools",
  "displayMode": "single",
  "tools": [...],
  "pdf": null
}
```

または

```json
{
  "contentType": "split",
  "displayMode": "split",
  "tools": [...],
  "pdf": {
    "id": "uuid",
    "name": "PDF名",
    "pages": ["/api/signage/pdfs/uuid/page/1", ...]
  }
}
```

### GET /api/signage/emergency

緊急表示情報を取得

**レスポンス**:
```json
{
  "enabled": true,
  "message": "緊急メッセージ",
  "contentType": "message"
}
```

## 実装計画

### Phase 1: データベーススキーマとAPI実装

- [ ] Prismaスキーマの作成
- [ ] マイグレーションの実行
- [ ] APIエンドポイントの実装
- [ ] PDFアップロード機能の実装

### Phase 2: 管理画面の実装

- [x] スケジュール設定画面
- [x] PDF管理画面（サイネージタブ内に統合、2025-12-13実装完了）
- [x] 緊急表示設定画面
- [x] PDFアップロード機能の共通コンポーネント化（`SignagePdfManager`）

### Phase 3: サイネージ表示画面の実装

- [ ] サイネージ表示画面（React）
- [ ] スケジュール管理ロジック
- [ ] ポーリング処理
- [ ] 工具管理データ表示
- [ ] PDF表示

### Phase 4: クライアント端末セットアップ

- [ ] ラズパイ3/ZERO2Wのセットアップスクリプト
- [ ] キオスクモード設定
- [ ] 自動起動設定

## 視認性向上カラーテーマ要件

### 背景

工場現場での視認性を向上させるため、提案3（工場現場特化・高視認性テーマ）を採用。

### サイネージ表示のカラーパレット

- **工具カード**: 現状のダーク背景を維持（工具は従来の背景色）
- **計測機器カード**: 現状の藍系背景を維持（`rgba(49,46,129,0.6)` + `rgba(99,102,241,0.5)`）
- **吊具カード**: 将来的に追加予定（`bg-orange-500` + `text-white`）

### フォントサイズ

- **最小フォントサイズ**: 14px（現状の12pxから拡大）
- **主要テキスト**: 16px以上
- **見出し**: 18px以上（太字推奨）

### コントラスト比

- **目標**: WCAG AAA準拠（コントラスト比7:1以上、推奨21:1）
- **検証**: すべての組み合わせでWCAG AAA準拠を確認

### 注意事項

- サイネージ表示はサーバー側でSVG→JPEG変換されるため、カラーテーマの変更は`signage.renderer.ts`で実装
- 工具と計測機器の視覚的識別は現状の藍系背景を維持しつつ、コントラスト比を向上させる

**実装状況**: Phase 3完了（2025-12-17）。サイネージレンダラー（`signage.renderer.ts`）に提案3カラーパレットを適用完了。工具、計測機器、吊具のカードにアイコン（🔧、📏、⚙️）を追加し、フォントサイズとボーダーを改善。コントラスト比約21:1（WCAG AAA準拠）を達成。

詳細は [UI視認性向上カラーテーマ要件定義](../requirements/ui-visibility-color-theme.md) / [残タスク洗い出し](../guides/ui-visibility-color-theme-remaining-tasks.md) を参照してください。

## 関連ドキュメント

- [システム要件定義](../requirements/system-requirements.md)
- [UI視認性向上カラーテーマ要件定義](../requirements/ui-visibility-color-theme.md) - カラーテーマ要件の詳細
- [アーキテクチャ概要](../architecture/overview.md)
- [開発ガイド](../guides/development.md)

