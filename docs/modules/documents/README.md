# ドキュメントビューワーモジュール

## 概要

ドキュメントビューワーモジュールは、PDF/Excelファイルの閲覧・管理機能を提供します（将来実装予定）。

## 責務

- **ドキュメント管理**: PDF/Excelファイルのアップロード・削除・一覧表示
- **ドキュメント閲覧**: PDF/Excelファイルのブラウザ内閲覧
- **ジョブ管理**: ImportJobテーブルを活用したファイル処理ジョブの管理

## APIエンドポイント（予定）

### ドキュメント管理

- `GET /api/documents` - ドキュメント一覧取得
- `GET /api/documents/:id` - ドキュメント詳細取得
- `POST /api/documents` - ドキュメントアップロード
- `DELETE /api/documents/:id` - ドキュメント削除

### ドキュメント閲覧

- `GET /api/documents/:id/view` - ドキュメント閲覧データ取得
- `GET /api/documents/:id/download` - ドキュメントダウンロード

## ディレクトリ構造（テンプレート）

```
apps/api/src/
├── routes/documents/
│   ├── files/
│   │   ├── index.ts          # ファイル管理ルート登録
│   │   ├── list.ts           # GET /documents
│   │   ├── create.ts         # POST /documents
│   │   ├── get.ts            # GET /documents/:id
│   │   ├── delete.ts         # DELETE /documents/:id
│   │   └── schemas.ts        # バリデーションスキーマ
│   ├── viewer/
│   │   ├── index.ts          # ビューワールート登録
│   │   ├── view.ts           # GET /documents/:id/view
│   │   ├── download.ts       # GET /documents/:id/download
│   │   └── schemas.ts        # バリデーションスキーマ
│   └── index.ts              # モジュールルート登録
└── services/documents/
    ├── document.service.ts   # ドキュメント管理サービス
    ├── viewer.service.ts     # ビューワーサービス
    └── index.ts
```

## 実装ステータス

- [ ] APIルートの実装
- [ ] サービス層の実装
- [ ] フロントエンドページの実装
- [ ] テストの実装

## 関連ドキュメント

- [EXEC_PLAN.md](../../../EXEC_PLAN.md) - 全体の進捗とマイルストーン
- [アーキテクチャ概要](../../architecture/overview.md) - システム全体のアーキテクチャ
- [開発ガイド](../../guides/development.md) - モジュール追加手順

