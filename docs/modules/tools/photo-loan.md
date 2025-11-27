---
title: 写真撮影持出機能 - モジュール仕様
tags: [工具管理, 写真撮影, カメラ, 持出機能]
audience: [開発者, アーキテクト]
last-verified: 2025-11-27
related: [../requirements/system-requirements.md, ../../decisions/003-camera-module.md, ./README.md]
category: modules
update-frequency: medium
---

# 写真撮影持出機能 - モジュール仕様

## 概要

写真撮影持出機能は、従業員タグのみスキャンで撮影＋持出を記録する機能です。既存の2タグスキャン機能（FR-004）は維持され、新しい持出方法として追加されます。

## 責務

- **写真撮影**: 従業員タグスキャン時にカメラでItemを撮影
- **持出記録**: 従業員IDと写真を保存（Item情報は保存しない）
- **写真管理**: 写真の保存・配信・自動削除
- **UI表示**: 持出一覧・返却画面で写真サムネイルを表示

## 機能要件（FR-009）

詳細は [システム要件定義](../../requirements/system-requirements.md#fr-009-写真撮影持出機能新規追加) を参照してください。

### 主要機能

1. **従業員タグスキャンで撮影＋持出**
   - 従業員タグスキャンがシャッターを押す役割も兼ねる
   - スキャン前にItemをカメラの前に置く
   - 撮影失敗時は3回までリトライ、それでも失敗したらエラー（写真は必須）

2. **写真の保存・配信**
   - 写真サイズ: 元画像800x600px（JPEG品質80%）、サムネイル150x150px（JPEG品質70%）
   - 保存先: ラズパイ5の1TB SSD（`/opt/RaspberryPiSystem_002/storage/photos/`）
   - サムネイル: Caddyで静的ファイル配信
   - 元画像: API経由で認証制御

3. **写真の自動削除**
   - 保存期間: 撮影年の2年後の1月中に削除
   - 実行タイミング: 1月中に毎日チェック（cronジョブ）

4. **クライアント端末ごとの初期表示設定**
   - データベース + 管理画面で設定変更可能
   - `ClientDevice`テーブルに`defaultMode`カラムを追加（PHOTO/TAG）

## データ構造

### Loanテーブルの拡張

```prisma
model Loan {
  // ... 既存のカラム
  photoUrl     String?   // 写真のURL（例: /api/storage/photos/2025/11/20251127_123456_employee-uuid.jpg）
  photoTakenAt DateTime? // 撮影日時
}
```

### ClientDeviceテーブルの拡張

```prisma
model ClientDevice {
  // ... 既存のカラム
  defaultMode  String?   // 'PHOTO' | 'TAG'（デフォルト: 'TAG'）
}
```

## APIエンドポイント

### 写真撮影持出

- `POST /api/tools/loans/photo-borrow` - 従業員タグのみスキャンで撮影＋持出登録
  - **リクエスト**: `{ employeeTagUid: string }`
  - **レスポンス**: `{ loanId: string, employeeId: string, photoUrl: string, photoTakenAt: string }`
  - **エラー**: 撮影失敗時は3回までリトライ、それでも失敗したらエラー

### 写真配信

- `GET /api/storage/photos/:path` - 元画像の配信（認証必要）
  - **パス**: `/api/storage/photos/YYYY/MM/YYYYMMDD_HHMMSS_{employeeId}.jpg`
  - **認証**: JWTトークンまたはAPIキーが必要

- `GET /storage/thumbnails/:path` - サムネイルの配信（認証不要、Caddy経由）
  - **パス**: `/storage/thumbnails/YYYY/MM/YYYYMMDD_HHMMSS_{employeeId}_thumb.jpg`
  - **配信**: Caddyで静的ファイル配信

### クライアント端末設定

- `GET /api/tools/clients/:id` - クライアント端末情報取得（`defaultMode`を含む）
- `PUT /api/tools/clients/:id` - クライアント端末設定更新（`defaultMode`を変更可能）

## ディレクトリ構造

```
apps/api/src/
├── routes/tools/
│   ├── loans/
│   │   ├── photo-borrow.ts      # POST /api/tools/loans/photo-borrow
│   │   └── ...
│   ├── storage/
│   │   └── photos.ts            # GET /api/storage/photos/:path
│   └── clients/
│       └── update.ts            # PUT /api/tools/clients/:id（defaultMode更新）
├── services/tools/
│   ├── loans/
│   │   └── photo-loan.service.ts  # 写真撮影持出のビジネスロジック
│   └── clients/
│       └── client.service.ts    # クライアント端末設定のビジネスロジック
├── services/camera/
│   ├── camera.service.ts        # 共通カメラサービス
│   └── drivers/                 # カメラドライバー（ADR 003参照）
└── lib/
    └── photo-storage.ts         # 写真保存・削除のユーティリティ

apps/web/src/
├── pages/
│   ├── photo-borrow/            # 写真撮影持出画面（新規）
│   │   ├── PhotoBorrowPage.tsx
│   │   └── ...
│   └── tools/
│       └── return/
│           └── ReturnPage.tsx   # 返却画面（写真サムネイル表示を追加）
└── api/
    └── photo-loan.ts            # 写真撮影持出APIクライアント
```

## 実装の詳細

### 写真撮影持出フロー

1. **従業員タグスキャン**
   - NFCエージェントから従業員タグUIDを受信
   - WebSocket経由でフロントエンドに送信

2. **写真撮影**
   - フロントエンドが`POST /api/tools/loans/photo-borrow`を呼び出し
   - APIサーバーがカメラサービスを呼び出して撮影（3回までリトライ）
   - 撮影した画像をリサイズ・サムネイル生成

3. **写真保存**
   - 元画像: `/opt/RaspberryPiSystem_002/storage/photos/YYYY/MM/YYYYMMDD_HHMMSS_{employeeId}.jpg`
   - サムネイル: `/opt/RaspberryPiSystem_002/storage/thumbnails/YYYY/MM/YYYYMMDD_HHMMSS_{employeeId}_thumb.jpg`

4. **持出記録作成**
   - `Loan`テーブルにレコードを作成（`itemId=NULL`, `employeeId=特定した従業員ID`, `photoUrl=写真URL`）

### 写真自動削除フロー

1. **cronジョブ設定**
   - 毎日深夜に実行（例: `0 2 * * *`）
   - 1月中のみ実行（例: `0 2 * 1 *`）

2. **削除対象の判定**
   - 撮影年の2年後のデータを削除
   - 例: 2025年のデータは2027年1月中に削除

3. **削除処理**
   - ファイルシステムから写真ファイルを削除
   - データベースの`Loan`テーブルの`photoUrl`をNULLに更新（またはレコードを削除）

### クライアント端末の初期表示設定

1. **データベース設定**
   - `ClientDevice`テーブルの`defaultMode`カラムで設定
   - `PHOTO`: 写真撮影持出画面を初期表示
   - `TAG`: 既存の2タグスキャン画面を初期表示（デフォルト）

2. **管理画面での設定変更**
   - 管理コンソールから各クライアント端末の`defaultMode`を変更可能
   - `PUT /api/tools/clients/:id`エンドポイントを使用

3. **フロントエンドでの初期表示**
   - クライアント端末の`defaultMode`に応じて初期画面を決定
   - `/api/kiosk/config`エンドポイントから`defaultMode`を取得

## カメラ機能のモジュール化

カメラ機能のモジュール化については [ADR 003](../../decisions/003-camera-module.md) を参照してください。

## テスト計画

詳細なテスト計画は [写真撮影持出機能 テスト計画](../../guides/photo-loan-test-plan.md) を参照してください。

## 関連ドキュメント

- [システム要件定義](../../requirements/system-requirements.md): FR-009（写真撮影持出機能）
- [ADR 003: カメラ機能のモジュール化](../../decisions/003-camera-module.md)
- [工具管理モジュール](./README.md): モジュール全体の概要
- [写真撮影持出機能 テスト計画](../../guides/photo-loan-test-plan.md): 詳細なテスト計画
- [検証チェックリスト](../../guides/verification-checklist.md): Validation 9（写真撮影持出）

## 実装ステータス

- ⏳ **未実装**: すべての機能が未実装
- 📋 **ブランチ**: `feature/photo-loan-camera`
- 📅 **予定**: 要件定義完了後、実装開始予定

