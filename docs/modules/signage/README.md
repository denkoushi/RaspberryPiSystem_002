# デジタルサイネージモジュール

最終更新: 2026-01-07（レイアウトとコンテンツの疎結合化実装完了、実機検証完了、UI改善）

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
  - **全体表示（FULL）**: 
    - 工具管理データのみ
    - PDFのみ
  - **左右分割表示（SPLIT）**: 
    - 左に工具管理データ、右にPDF
    - 左にPDF、右に工具管理データ
    - 各スロットのコンテンツは管理コンソールで自由に選択可能

### PDF表示

- **表示形式**: スライドショー形式（自動ページ切り替え）または1ページ表示形式を設定で選択可能
- **アップロード方法**: 管理画面からのアップロードとUSB経由のアップロードの両方に対応
- **軽量化**: ラズパイZERO2Wにも対応できるよう、サーバー側でPDFを画像に変換して配信（検討）

### スケジュール設定

- **設定項目**: 曜日、時間帯、優先順位を自由に設定可能
- **適用範囲**: PDFと工具管理データの両方にスケジュール設定が可能
- **優先順位**: 複数のスケジュールが重複した場合、優先順位が高い（数値が大きい）スケジュールが優先される
  - 優先順位は数値が大きいほど優先度が高い（例: 優先順位20 > 優先順位10）
  - 複数のスケジュールが同時にマッチする場合、優先順位が最も高いものが選択される
  - 優先順位が同じ場合は、データベースの順序に依存

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
- **更新間隔**: 30秒間隔（`signage-lite-update.timer`で制御）
- **オフライン時**: エラーメッセージのみ表示（キャッシュ表示なし）
- **画像更新**: `signage-lite-update.timer`が30秒ごとに`/api/signage/current-image`から画像を取得し、`/run/signage/current.jpg`（tmpfs）を更新
  - **注意**: タイマーが停止していると画像が更新されないため、デプロイ後やサービス再起動後はタイマーの状態を確認すること（`systemctl is-active signage-lite-update.timer`）
  - **tmpfs化**: 画像キャッシュは `/run/signage`（tmpfs）に配置され、SDカードへの書込みを削減（再起動後は消える）
  - **自動復旧**: `signage-lite-watchdog.timer`が1分間隔で画像更新を監視し、停止を検知した場合は自動復旧を試行

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

**統一された情報の並び順**: すべてのアイテム種別（工具/計測機器/吊具）で同じ順序に統一（2025-12-18実装完了）

#### 工具カード
- **表示項目**（統一順序）:
  1. アイテム名（primaryText、18px、太字、白）
  2. 従業員名（secondary、16px、白）
  3. 借出日 + 借出時刻（横並び、同じY座標、14px、白）
  4. 警告（期限超過の場合、「⚠ 期限超過」、14px、白）
  5. **管理番号/アイテムコード（右下隅、14px、等幅フォント、白）**
- **レイアウト**: 上段に管理番号は表示しない（右下のみ）

#### 計測機器カード
- **表示項目**（統一順序）:
  1. 名称（primaryText、18px、太字、白）
  2. 従業員名（secondary、16px、白）
  3. 借出日 + 借出時刻（横並び、同じY座標、14px、白）
  4. 警告（期限超過の場合、「⚠ 期限超過」、14px、白）
  5. **管理番号（右下隅、14px、等幅フォント、白）**
- **レイアウト**: 上段に管理番号は表示しない（右下のみ、2025-12-18修正）

#### 吊具カード
- **表示項目**（統一順序）:
  1. 名称（primaryText、18px、太字、白）
  2. 従業員名（secondary、16px、白）
  3. 借出日 + 借出時刻（横並び、同じY座標、14px、白）
  4. 警告（期限超過の場合、「⚠ 期限超過」、14px、白）
  5. **管理番号/アイテムコード（右下隅、14px、等幅フォント、白）**
- **レイアウト**: 上段に管理番号は表示しない（右下のみ）

#### 日付と時刻の配置
- **横並び配置**: 日付と時刻は同じY座標で横並びに配置（2025-12-18実装完了）
  - 日付: `textX`（テキストエリアの左端）
  - 時刻: `textX + 80px`（日付の右側、日付がない場合は左端から）
- **視認性**: 縦並びから横並びに変更し、情報密度を向上

#### 行間設定
- **フォントサイズに応じた行間**: フォントサイズの1.6-2倍を確保
  - primaryText (18px) → 行間28px
  - secondary (16px) → 行間26px
  - date/time (14px) → 行間24px
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
  contentType String   // "tools" | "pdf" | "split"（レガシー形式、後方互換性のため維持）
  pdfId       String?  @relation("SchedulePdf", fields: [pdfId], references: [id])
  layoutConfig Json?   // レイアウト設定（新形式、nullの場合はcontentType/pdfIdから変換）
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

**layoutConfigの構造**（新形式）:
```typescript
{
  layout: "FULL" | "SPLIT",
  slots: [
    {
      position: "FULL" | "LEFT" | "RIGHT",
      kind: "pdf" | "loans" | "csv_dashboard" | "message",
      config: {
        // kind="pdf"の場合
        pdfId: string,
        displayMode: "SLIDESHOW" | "SINGLE",
        slideInterval: number | null
        // kind="loans"の場合
        // config: {}（現時点では特別な設定なし）
      }
    }
  ]
}
```

**後方互換性**: `layoutConfig`が`null`の場合は、既存の`contentType`/`pdfId`から自動的に新形式へ変換されます。

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
  contentType String?  // "message" | "pdf" | "tools"（レガシー形式、後方互換性のため維持）
  pdfId       String?  @relation("EmergencyPdf", fields: [pdfId], references: [id])
  layoutConfig Json?   // レイアウト設定（新形式、nullの場合はcontentType/pdfIdから変換）
  pdf         SignagePdf? @relation("EmergencyPdf")
  enabled     Boolean  @default(false)
  expiresAt   DateTime? // 有効期限
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

**layoutConfigの構造**: `SignageSchedule`と同じ構造です。

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

現在時刻に基づいて表示すべきコンテンツを取得します。
`layoutConfig`が設定されている場合は、その内容が優先されます。
複数のスケジュールがマッチする場合、優先順位が高い（数値が大きい）スケジュールが選択されます。

**レスポンス**（レガシー形式）:
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

**レスポンス**（新形式、layoutConfig使用時）:
```json
{
  "contentType": "SPLIT",
  "displayMode": "SLIDESHOW",
  "layoutConfig": {
    "layout": "SPLIT",
    "slots": [
      {
        "position": "LEFT",
        "kind": "loans",
        "config": {}
      },
      {
        "position": "RIGHT",
        "kind": "pdf",
        "config": {
          "pdfId": "uuid",
          "displayMode": "SLIDESHOW",
          "slideInterval": 30
        }
      }
    ]
  },
  "tools": [...],
  "pdf": {
    "id": "uuid",
    "name": "PDF名",
    "pages": ["/api/signage/pdfs/uuid/page/1", ...]
  }
}
```

**後方互換性**: `layoutConfig`が`null`の場合は、既存の`contentType`/`pdfId`から自動的に新形式へ変換されます。

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

**実装状況**: 
- **Phase 3完了**（2025-12-17）: サイネージレンダラー（`signage.renderer.ts`）に提案3カラーパレットを適用完了。工具、計測機器、吊具のカードにアイコン（🔧、📏、⚙️）を追加し、フォントサイズとボーダーを改善。コントラスト比約21:1（WCAG AAA準拠）を達成。
- **Phase 9完了**（2025-12-18）: 管理画面のPDF管理エリア（`SignagePdfManager.tsx`）を白背景対応に修正完了。サイネージタブ（`/admin/signage/schedules`）とクライアント端末タブ（`/admin/clients`）のPDF管理エリアで、form要素、input要素、select要素、テーブルヘッダー・行の境界線と文字色を改善し、白背景のCard内で視認性を向上。

詳細は [UI視認性向上カラーテーマ要件定義](../requirements/ui-visibility-color-theme.md) / [残タスク洗い出し](../guides/ui-visibility-color-theme-remaining-tasks.md) を参照してください。

## Pi3クライアントの安定化施策（2026-01-08実装完了）

### SDカードへの書込み削減（最優先）

- **tmpfs化**: 画像キャッシュを `/run/signage`（tmpfs）に配置し、30秒ごとのJPEG更新によるSDカードへの書込みをほぼゼロ化
- **効果**: SDカードの寿命延長、破損リスクの低減、システム安定性の向上
- **実装**: systemd-tmpfiles（`/etc/tmpfiles.d/signage-lite.conf`）で再起動後も確実に作成

### 自動復旧機能

- **watchdog**: `signage-lite-watchdog.timer`が1分間隔で画像更新を監視
  - 2分以上更新されていない場合、`signage-lite-update.service`を実行
  - 復旧しない場合は`signage-lite.service`を再起動
- **日次再起動**: `signage-daily-reboot.timer`が毎日深夜3時に自動再起動
  - メモリリークや累積エラーのリセット
  - 再起動後は`signage-lite.service`が自動起動（`enabled=true`保証）

### サービス堅牢化

- **DISPLAY準備待ち**: `ExecStartPre`でX11が利用可能になるまで待機（最大30秒）
- **暴走防止**: `StartLimitIntervalSec/StartLimitBurst`で連続失敗時の制御
- **enabled状態の収束**: Ansibleデプロイ時に必ず`enabled=true`を保証（サービス無効化ドリフトの防止）

### 運用上の注意

- **再起動後の画像**: tmpfsのため再起動後は画像が消える。初回起動時にサーバーから取得する（ネットワーク未接続時は表示できない）
- **watchdogの確認**: `systemctl status signage-lite-watchdog.timer`で動作確認
- **日次再起動の確認**: `systemctl status signage-daily-reboot.timer`で動作確認

詳細は [signage-lite.md](./signage-lite.md) を参照してください。

## 関連ドキュメント

- [システム要件定義](../requirements/system-requirements.md)
- [UI視認性向上カラーテーマ要件定義](../requirements/ui-visibility-color-theme.md) - カラーテーマ要件の詳細
- [アーキテクチャ概要](../architecture/overview.md)
- [開発ガイド](../guides/development.md)
- [signage-lite.md](./signage-lite.md) - Pi3軽量サイネージの詳細仕様と安定化施策

