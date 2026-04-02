---
title: ADR-20260404 写真持出 VLM 補助の本番保存（ギャラリー行数ゲート・段階的）
status: accepted
date: 2026-04-02
---

# ADR-20260404: 写真持出 VLM 補助の本番保存（ギャラリー行数ゲート）

## Context

- [ADR-20260331](./ADR-20260331-photo-tool-label-good-assist-shadow.md) は 2 回目補助推論を**シャドー（ログ比較のみ）**として先行導入した。
- 運用上、**教師（GOOD）が一定蓄積したラベルから**だけ本番保存を補助結果に寄せたい要件がある。全面切替は類似誤誘導リスクが高い。

## Decision

1. **環境フラグ**: `PHOTO_TOOL_LABEL_ASSIST_ACTIVE_ENABLED`（既定 `false`）かつ `PHOTO_TOOL_EMBEDDING_ENABLED=true` のとき、アクティブ保存ロジックを有効にする。
2. **ラベル別ゲート**: 補助の収束 `canonicalLabel` `L` について、`photo_tool_similarity_gallery` の **`BTRIM("canonicalLabel") = L`** 行数が `PHOTO_TOOL_LABEL_ASSIST_ACTIVE_MIN_GALLERY_ROWS`（既定 **5**、1–100）以上のときだけ、2 回目推論の正規化結果を `Loan.photoToolDisplayName` に保存しうる。
3. **2 回目 VLM の実行条件**: `PHOTO_TOOL_LABEL_ASSIST_SHADOW_ENABLED` によるシャドー従来動作を維持しつつ、**シャドー ON または（アクティブ ON かつゲート通過）**のとき 2 回目を実行する。アクティブのみ・ゲート不通過のときは **2 回目を呼ばず** 1 回目のみ保存（コスト抑制）。
4. **境界**: 件数取得は `PhotoToolSimilarityGalleryRepositoryPort`。ゲート判定は `PhotoToolLabelActiveAssistGatePort`（実装 `GalleryRowCountActiveAssistGate`）。オーケストレーションは `PhotoToolLabelingService`。

## Alternatives

- **全面 active（ゲートなし）**: 却下（運用リスク）。
- **ゲートをレビュー履歴テーブルに置く**: 将来拡張。まずはギャラリー行数で母集団と整合させる。

## Consequences

- **良い**: ラベルごとに教師が育つにつれ、アクティブ保存が自然に広がる。既定 OFF で既存挙動を壊さない。
- **悪い / 注意**: 教師汚染（誤 GOOD）は従来どおりリスク。ログに `galleryRowCount` / `activePersistEligible` / `activePersistApplied` を出し観測する。

## Verification

- **2026-04-02（Mac / Tailscale）**: ブランチ `feat/photo-tool-label-assist-active-gate` を Pi5 のみ（`update-all-clients.sh` + `--limit raspberrypi5` + `--detach --follow`）反映後、`./scripts/deploy/verify-phase12-real.sh` → **PASS 40 / WARN 0 / FAIL 0**（約 51s）。
- **既定**: `PHOTO_TOOL_LABEL_ASSIST_ACTIVE_ENABLED` は **false** のため、上記回帰は **アクティブ保存を有効化していない**状態での総合確認。アクティブ ON 後はログ（`activePersistApplied` 等）で採用有無を追う。

## References

- [ADR-20260331](./ADR-20260331-photo-tool-label-good-assist-shadow.md)
- [KB-319](../knowledge-base/KB-319-photo-loan-vlm-tool-label.md)
- `apps/api/src/services/tools/photo-tool-label/photo-tool-labeling.service.ts`
- `apps/api/src/services/tools/photo-tool-label/gallery-row-count-active-assist-gate.ts`
