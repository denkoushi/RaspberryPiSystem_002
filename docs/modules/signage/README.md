# デジタルサイネージモジュール

最終更新: 2025-11-28

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
  - PDFアップロード・管理
  - 表示パターン設定
  - 緊急表示設定
- **タイムゾーン**:
  - サーバー側で `SIGNAGE_TIMEZONE` 環境変数を設定（デフォルト: `Asia/Tokyo`）
  - 例: `SIGNAGE_TIMEZONE=Asia/Tokyo`（`docker-compose.server.yml` の `api` サービスに設定）

### モニター仕様

- **解像度**: 1920x1080（Full HD）を基準に設計
- **表示**: 全画面表示

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
│   └── /admin/signage - サイネージ設定画面
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

- [ ] スケジュール設定画面
- [ ] PDF管理画面
- [ ] 緊急表示設定画面

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

## 関連ドキュメント

- [システム要件定義](../requirements/system-requirements.md)
- [アーキテクチャ概要](../architecture/overview.md)
- [開発ガイド](../guides/development.md)

