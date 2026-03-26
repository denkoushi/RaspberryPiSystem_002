---
title: ADR-20260326 キオスク要領書フリーワード検索を部分一致（ILIKE）へ統一
status: accepted
date: 2026-03-26
deciders: [開発チーム]
tags: [kiosk, kiosk-documents, search, postgresql, prisma]
related: [KB-313]
---

# ADR-20260326: キオスク要領書フリーワード検索を部分一致（ILIKE）へ統一

## Status

**accepted** (2026-03-26)

## Context

`KioskDocument` の一覧 API（`GET /api/kiosk-documents`）では、OCR 本文は `extractedText` に保存する方針を維持している。一方、検索は PostgreSQL の `to_tsvector('simple', …)` と `plainto_tsquery` に依存しており、日本語の文中の部分文字列や記号の入り方では、利用者の「含んでいる」という期待と一致しにくい。

## Decision

- **検索のみ**を **Prisma `contains`（PostgreSQL `ILIKE '%value%'`、case-insensitive）による複数カラムの `OR` 結合**に統一する。
- **保存形式・OCR パイプラインは変更しない**（`extractedText` の意味はそのまま）。
- 条件の組み立ては **`buildKioskDocumentSearchOrConditions`** に集約し、リポジトリは Prisma 実行に専念する（疎結合）。
- **並び順**は従来の `ts_rank` から **`createdAt` 降順**へ単純化する（関連度ランキングは行わない）。
- **`escapeLikePattern`**: ユーザー入力の **`%` を除去**し、ILIKE の意図しないワイルドカード拡大を防ぐ。`_` は品番等で用いられるため当面そのまま渡す（1文字ワイルドカードとして解釈されうる点は KB に明記）。

## Alternatives

- **全文検索と部分一致のハイブリッド**: 関連度や英語トークン強めの挙動を残せるが、SQL と順序ロジックが重く保守コストが高い。
- **`pg_trgm` + GIN**: 件数・本文長が増えたときの次の一手として別途検討可能。

## Consequences

- **良い**: 日本語の部分一致が分かりやすく、実装が単純。API の「ヒットしにくさ」という運用上の不満を抑えやすい。
- **悪い**: 長い `extractedText` への `ILIKE '%…%'` はスケールすると **シーケンシャルスキャン寄りの負荷**になりうる。必要になれば `pg_trgm` 等で索引化を検討する。
- **互換**: より多くの行がヒットしうる方向（利用者体験は改善寄り）。順序は `createdAt` ベースに変わる。

## References

- [KB-313](../knowledge-base/KB-313-kiosk-documents.md)
- 実装: `apps/api/src/services/kiosk-documents/search/build-kiosk-document-search-or.ts`, `apps/api/src/services/kiosk-documents/adapters/prisma-kiosk-document.repository.ts`
