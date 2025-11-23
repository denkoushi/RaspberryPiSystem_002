# 物流管理モジュール

## 概要

物流管理モジュールは、物流・配送管理機能を提供します（将来実装予定）。

## 責務

- **配送管理**: 配送先・配送状況の管理
- **在庫管理**: 在庫状況の追跡
- **ジョブ管理**: ImportJobテーブルを活用した物流データのインポート

## APIエンドポイント（予定）

### 配送管理

- `GET /api/logistics/deliveries` - 配送一覧取得
- `GET /api/logistics/deliveries/:id` - 配送詳細取得
- `POST /api/logistics/deliveries` - 配送作成
- `PUT /api/logistics/deliveries/:id` - 配送更新

## ディレクトリ構造（テンプレート）

```
apps/api/src/
├── routes/logistics/
│   ├── deliveries/
│   │   ├── index.ts
│   │   ├── list.ts
│   │   ├── create.ts
│   │   └── schemas.ts
│   └── index.ts
└── services/logistics/
    ├── delivery.service.ts
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

