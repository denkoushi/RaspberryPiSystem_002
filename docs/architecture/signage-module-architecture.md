---
title: デジタルサイネージモジュール アーキテクチャ
tags: [アーキテクチャ, デジタルサイネージ, モジュール化]
audience: [開発者, アーキテクト]
last-verified: 2025-11-28
related: [../decisions/001-module-structure.md, ../modules/signage/README.md]
category: architecture
update-frequency: low
---

# デジタルサイネージモジュール アーキテクチャ

最終更新: 2025-11-28

## 概要

デジタルサイネージ機能は、既存システムと完全に独立したモジュールとして設計・実装されています。スケーラビリティと将来の分離を考慮した設計になっています。

## モジュール化の確認

### ✅ 独立したルートモジュール

```
routes/signage/
  ├── index.ts          # ルート登録（/api/signage/*）
  ├── schedules.ts      # スケジュール管理
  ├── content.ts        # コンテンツ取得
  ├── pdfs.ts           # PDF管理
  ├── emergency.ts      # 緊急表示設定
  └── schemas.ts        # バリデーションスキーマ
```

- **パス**: `/api/signage/*`で独立
- **既存ルートとの競合**: なし（`/api/tools/*`, `/api/clients/*`などと完全に分離）
- **パターン**: 既存の`tools`モジュールと同じ構造に従っている

### ✅ 独立したサービス層

```
services/signage/
  ├── index.ts          # SignageService エクスポート
  └── signage.service.ts # ビジネスロジック
```

- **依存関係**: 既存の`tools`モジュールのサービスへの依存なし
- **データアクセス**: Prismaを直接使用（他のサービス層を経由しない）
- **責務**: サイネージ機能専用のビジネスロジック

### ✅ 独立したデータベーススキーマ

```prisma
model SignageSchedule { ... }
model SignagePdf { ... }
model SignageEmergency { ... }
```

- **既存テーブルとの関係**: なし（外部キー参照なし）
- **分離可能性**: 将来的に別データベースに分離可能

### ✅ 独立したストレージ

- **PDFストレージ**: `/storage/pdfs`, `/storage/pdf-pages`
- **写真ストレージ**: `/storage/photos`, `/storage/thumbnails`（既存）
- **環境変数**: `PDF_STORAGE_DIR`で独立設定可能

## コンフリクト確認

### ✅ ポート

- **API**: 既存のポート8080を使用（新しいポートは使用していない）
- **Web**: 既存のポート80/443を使用
- **競合**: なし

### ✅ ルート

- **サイネージ**: `/api/signage/*`
- **既存**: `/api/tools/*`, `/api/clients/*`, `/api/kiosk/*`など
- **競合**: なし（完全に分離）

### ✅ データベース

- **サイネージテーブル**: `SignageSchedule`, `SignagePdf`, `SignageEmergency`
- **既存テーブル**: `Employee`, `Item`, `Loan`, `Transaction`など
- **競合**: なし（独立したテーブル）

### ⚠️ ストレージ（改善が必要）

**現状**:
- PDFストレージのボリューム定義が`docker-compose.server.yml`にない
- 環境変数`PDF_STORAGE_DIR`は設定されているが、ボリュームマウントがない

**影響**:
- コンテナ再起動時にPDFデータが失われる可能性がある

**推奨対応**:
- `docker-compose.server.yml`にPDFストレージのボリューム定義を追加

### ✅ サービス間の依存関係

**サイネージ → ツール**:
- `getToolsData()`で既存の`Item`/`Loan`テーブルを参照（読み取り専用）
- これはデータ参照のみで、書き込みはしない
- サービス層への依存はない（Prismaを直接使用）

**ツール → サイネージ**:
- 依存なし（importなし）

## スケーラビリティ

### 将来の分離可能性

1. **別サーバーへの分離**
   - ルートモジュールが独立しているため、別のFastifyインスタンスに分離可能
   - サービス層も独立しているため、分離が容易

2. **別データベースへの分離**
   - データベーステーブルが独立しているため、別DBに分離可能
   - 外部キー参照がないため、移行が容易

3. **別ストレージへの分離**
   - ストレージディレクトリが独立しているため、別ストレージに分離可能
   - 環境変数で設定可能なため、柔軟に対応可能

### 現在の設計の利点

- **モジュール独立性**: 各モジュールが独立しており、変更の影響範囲が限定的
- **並行開発**: 複数の開発者が異なるモジュールを並行して開発可能
- **テスト容易性**: モジュール単位でテスト可能

## 改善提案

### 1. PDFストレージのボリューム定義追加

`docker-compose.server.yml`に以下を追加：

```yaml
volumes:
  pdf-storage:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: /opt/RaspberryPiSystem_002/storage/pdfs
  pdf-pages-storage:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: /opt/RaspberryPiSystem_002/storage/pdf-pages
```

### 2. 環境変数の追加

`docker-compose.server.yml`の`api`サービスに以下を追加：

```yaml
environment:
  PDF_STORAGE_DIR: /app/storage
```

## 結論

✅ **モジュール化**: 完全に独立したモジュールとして実装されている
✅ **コンフリクト**: 既存システムとの競合なし
✅ **スケーラビリティ**: 将来的な分離が可能な設計
⚠️ **改善点**: PDFストレージのボリューム定義追加が必要

## 関連ドキュメント

- [モジュール構造の決定](../decisions/001-module-structure.md)
- [デジタルサイネージモジュール仕様書](../modules/signage/README.md)

