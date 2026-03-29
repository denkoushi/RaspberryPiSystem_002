---
title: ADR-20260331 写真持出 VLM の GOOD 類似補助（条件付き・シャドーモード）
status: accepted
date: 2026-03-31
---

# ADR-20260331: 写真持出 VLM の GOOD 類似補助（条件付き・シャドーモード）

## Context

- 既存の GOOD ギャラリー（pgvector）は管理画面の類似候補表示に使われており、VLM バッチ（`PhotoToolLabelingService`）とは分離されている（[ADR-20260330](./ADR-20260330-photo-tool-similarity-gallery-pgvector.md)）。
- 一般工具は現行 VLM で十分な一方、工場固有工具では人が GOOD とした過去例を**参照**すると補助になり得る。
- いきなり本番ラベルへ反映すると、類似誤誘導で一般工具の精度を落とし得る。

## Decision

1. **条件付き補助**: 近傍の cosine 距離が補助用しきい値以下かつ、先頭 K 件の `canonicalLabel` が一致するときだけ補助対象とする。`撮影mode` フォールバック相当のラベルは補助候補から除外する。
2. **シャドーモード先行**: `PHOTO_TOOL_LABEL_ASSIST_SHADOW_ENABLED=true` かつ `PHOTO_TOOL_EMBEDDING_ENABLED=true` のとき、既存どおり 1 回目 VLM の結果だけを `Loan.photoToolDisplayName` に保存し、**2 回目**は補助プロンプトで推論して **ログ比較のみ**とする。
3. **境界**: 補助判定は `PhotoToolLabelAssistPort` / `PhotoToolLabelAssistService` に集約し、`PhotoToolLabelingService` はギャラリー SQL を直接持たない。プロンプト拡張は `photo-tool-label-prompt-builder.ts` に分離する。
4. **既定**: `PHOTO_TOOL_LABEL_ASSIST_SHADOW_ENABLED` は **false**。本番で有効化する前にログ上で `currentLabel` / `assistedLabel` / `reason` を評価する。

## Alternatives

- **常時 few-shot**: 毎回類似候補をプロンプトへ載せる。実装は簡単だが一般工具へのノイズリスクが高いため見送り。
- **本番直結の active 補助**: シャドー評価なしで保存ラベルを切り替える。運用リスクが高いため、別 ADR で段階導入する。

## Consequences

- **良い**: 既存表示・キオスク契約を変えずに、現場データで補助効果を観測できる。一般工具では補助が発火しにくい設計にできる。
- **悪い / 注意**: シャドー ON 時は VLM 呼び出しが最大 2 倍になりうる（条件付き）。埋め込み HTTP への負荷も増える。ログに `assistedLabel` が出るためログ取り扱い方針を Runbook に合わせる。

## Verification（2026-03-29）

- **CONFIRMED**: 本番向け順次デプロイ（[deployment.md](../guides/deployment.md)）で **Pi5 → Pi4×4** のみ `--limit` 1 台ずつ・`--detach --follow` 実行し、各 PLAY `failed=0`（Pi3 は対象外）。
- **CONFIRMED**: Mac / Tailscale で `./scripts/deploy/verify-phase12-real.sh` → **PASS 34 / WARN 0 / FAIL 0**（約 55s、`network_mode=tailscale`、Pi5 `100.106.158.2`）。
- **CONFIRMED**: 未認証 `GET …/photo-similar-candidates` → **401**（類似 API 認可の回帰）。
- **注**: シャドー補助そのものは **既定 OFF**。有効化後は API ログ（`Photo tool label shadow assist completed` / `skipped`）で評価する。キオスク表示はシャドー ON/OFF に依存しない（`photoToolDisplayName` は 1 回目のまま）。

## References

- `apps/api/src/services/tools/photo-tool-label/photo-tool-label-assist.service.ts`
- `apps/api/src/services/tools/photo-tool-label/photo-tool-labeling.service.ts`
- `apps/api/src/services/tools/photo-tool-label/photo-tool-label.scheduler.ts`
- [KB-319](../knowledge-base/KB-319-photo-loan-vlm-tool-label.md)
- [ADR-20260330](./ADR-20260330-photo-tool-similarity-gallery-pgvector.md)
