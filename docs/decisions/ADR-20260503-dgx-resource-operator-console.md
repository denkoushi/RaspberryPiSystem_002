---
Title: ADR-20260503: DGX Resource 運用者コンソールとワークロード遷移の API 境界
Status: accepted
---

# ADR-20260503: DGX Resource 運用者コンソールとワークロード遷移の API 境界

## Context

DGX リソース機能は、低レベルの **Control Target**（`targets[]`）と、運用者が意図する **業務 / 私用 / 実験** の切替が同一画面に混在し、UI が技術 ID 寄りになりやすかった。また `dgx-resource.service.ts` にプローブ収集・起停実行・シナリオ実行・モニタリングが集約され、変更の影響範囲が広かった。

## Decision

1. **`overview` 応答に `operator` を追加**する。内容は `workloads`（3 系統）、`operatorSummary`、`operatorActions`（既存 4 シナリオの運用者向けラベルと無効理由）。**`targets[]` / `services[]` / 既存 action 型は維持**する。
2. **ワークロード調停とオーケストレーション確定実行**を **`dgx-resource.workload-transition.ts`** に切り出し、`createDgxResourceService` はプローブ収集と HTTP 起停の「詳細」と `RunTargetRuntimeAction` の組み立てに集中させる。
3. **運用者向けモデルの合成**は **`dgx-resource.operator-overview.ts`** に閉じ、raw snapshot を直接並べ替えない。
4. **シナリオ実行結果**に **`outcomeKind`**（`success` | `partial_failure` | `noop`）を付与し、noop 時の UI 表現を明確化する。

## Alternatives

- **targets のみで UI を完結**: 互換は良いが運用語彙の翻訳が Web に散らばり、SOLID の「表示」と「制御」の分離が崩れる。
- **新エンドポイント `/operator-overview`**: クライアントが増え、キャッシュ・ロードが二重化する。既存 overview 拡張で十分。

## Consequences

- **良い**: 責務がファイル単位で説明可能。Web は `operator` を優先表示でき、トラブル時は `targets` 詳細へ辿れる。
- **悪い**: `targets` と `operator` の二重化により、不整合が理論上は起こり得る。合成ロジックを **operator-overview のテスト**と **サービス統合テスト**で固定する。

## References

- [KB-365](../knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md)
- [ADR-20260502](./ADR-20260502-dgx-resource-control-targets.md)
- [dgx-system-prod-local-llm.md](../runbooks/dgx-system-prod-local-llm.md)
