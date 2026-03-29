---
title: ADR-20260330 写真持出 GOOD ギャラリー類似候補（pgvector + 外部埋め込み HTTP）
status: accepted
date: 2026-03-30
---

# ADR-20260330: 写真持出 GOOD ギャラリー類似候補（pgvector + 外部埋め込み HTTP）

## Context

- 人レビューで **GOOD** とした写真持出を、類似画像検索の参照集合（ギャラリー）として使いたい。
- 埋め込みモデルを Node API コンテナに直載せするとイメージ肥大・ARM ビルド・GPU 有無で運用リスクが高い。
- **確定ラベル（キオスク・サイネージ・DB の表示正本）は自動では変えず**、管理画面に **候補表示のみ** とする。

## Decision

1. **PostgreSQL + pgvector** でギャラリーを保持する。テーブル `photo_tool_similarity_gallery` は Prisma スキーマ外とし、マイグレーションは **生 SQL**、アプリは **`$queryRawUnsafe` / `$executeRawUnsafe`** を `PgPhotoToolSimilarityGalleryRepository` に閉じる。
2. **埋め込み取得**は `PhotoToolImageEmbeddingPort` とし、既定実装は **HTTP**（JSON + base64 JPEG）。別プロセス（例: Ubuntu 側の小さな推論サービス）へ差し替え可能にする。
3. **インデックス入力画像**は VLM と同じ経路の JPEG（`PhotoStorageVisionImageSource` → `PhotoStorage.readVisionInferenceJpeg` 系）に揃える。
4. **レビュー確定後**（`PATCH .../photo-label-review` 成功後）、`GOOD` のみ非同期で upsert、**非 GOOD** はギャラリー行を削除する。
5. **候補 API** は `GET /api/tools/loans/:id/photo-similar-candidates`（ADMIN/MANAGER）。無効時や未設定時は **空配列** で既存フローを壊さない。

## Alternatives

- **pgvector を使わずアプリメモリ / 専用ベクトル DB**: 運用単位が増える・バックアップ境界が分断されるため、既存 Postgres に寄せた。
- **Node 内で ONNX/CLIP**: 依存とビルドが重く、将来のモデル差し替えも難しいため見送り。

## Consequences

- **良い**: 埋め込みエンジンを HTTP で差し替え可能。GOOD のみギャラリーに載るため参照品質の意図が明確。確定ラベルを変えないため現場リスクが低い。
- **悪い / 注意**: 埋め込み API へ **JPEG が送信される**（プライバシー・ネットワーク境界の運用設計が必要）。`PHOTO_TOOL_EMBEDDING_ENABLED=false` 時はギャラリー更新も候補も動かない。次元・モデル ID は **マイグレーションと env を一致**させる必要がある。

## References

- `apps/api/prisma/migrations/20260330120000_photo_tool_similarity_gallery_pgvector/migration.sql`
- `apps/api/src/services/tools/photo-tool-label/`
- [photo-loan.md](../modules/tools/photo-loan.md)
- [KB-319](../knowledge-base/KB-319-photo-loan-vlm-tool-label.md)
