---
title: ADR-20260527 キオスク負荷調整・外注シミュ上限の単一正本
status: accepted
date: 2026-05-27
---

# ADR-20260527: キオスク負荷調整・外注シミュ上限の単一正本

## Status

**accepted**（実装 **`cd42ebfe`** · Pi5 デプロイ **`20260527-191646-1476`**）

## Context

部品単位 **推奨セット**（`outsourcing-plan`）導入後、次の不整合が本番で観測された。

| 層 | 修正前の値 | 症状 |
|----|------------|------|
| エンジン内部プール | 最大 **500** 部品候補 | plan は 100 件超の選定を返し得る |
| ルート Zod `maxCandidates` | 最大 **200**（フロントは **500** 送信） | `outsourcing-candidates` が **400** |
| ルート Zod `selectedCandidateIds` | 最大 **100** | plan 成功後の `outsourcing-simulate` が **400** |
| Web 自動選定 | plan → candidates → simulate **直列** | 中間 400 で **エラー非表示**・ボタン無反応に見える |

加えて、初回タブ表示で `machine-monthly-load`（約 20s）・`start-date-leveling`（約 29s）が重く、自動選定だけが遅いと誤認されやすかった（別系統）。

## Decision

1. **上限の単一正本**を `apps/api/src/services/production-schedule/load-balancing/outsourcing-simulation.policy.ts` の `LOAD_BALANCING_OUTSOURCING_LIMITS` に集約する。ルート Zod・サービス・エンジン・Web（`loadBalancingOutsourcingLimits.ts`）は同定数を参照する。
2. **公開上限**（2026-05-27 時点）:

| 定数名 | 値 | 用途 |
|--------|-----|------|
| `MAX_PART_CANDIDATE_POOL` | **500** | plan / simulate 内部の部品プール |
| `MAX_CANDIDATES_LIST_REQUEST` | **200** | `POST outsourcing-candidates` の `maxCandidates` |
| `DEFAULT_CANDIDATES_LIST` | **100** | 同上の既定 |
| `MAX_SELECTED_CANDIDATE_IDS` | **500** | `POST outsourcing-simulate` / `replacements` |
| `MAX_ROW_CANDIDATES_LIST` | **200** | 工程行候補（legacy） |
| `MAX_OVER_RESOURCE_CDS` | **100** | `overResourceCds` 配列 |

3. **自動選定 UI**: `POST outsourcing-plan` 成功後は **`mapOutsourcingPlanToSimulateResult`** で `beforeResources` / `afterResources` をチャート用 simulate 結果に写し、**`outsourcing-simulate` は呼ばない**（手動の工程行シミュ・入れ替え後の再試算は従来どおり simulate 可）。
4. **部品表メタ**: plan 後に `outsourcing-candidates` を **`maxCandidates: 200`** で 1 回だけ呼び、`externalizationCandidates` を部品表に載せる（上限 200 は一覧用。plan の選定件数はプール 500 まで）。
5. **エラー表示**: `formatExternalizationPlanActionError` で plan / candidates / simulate / replacements を **`actionError` 1 本**に集約し Panel に表示する。

## Alternatives

| 案 | 却下理由 |
|----|----------|
| ルート上限だけ 500 に引き上げ | エンジン・一覧・simulate で値が再び乖離する |
| plan 件数を常に ≤100 に切る | 現場の超過資源が多い月に解が不足し、エンジン能力を活かせない |
| simulate を必須のまま残す | plan と simulate の計算は同等。二重 API で遅延と 400 リスクのみ増える |

## Consequences

**良い**

- 契約が 1 ファイルで追える。Vitest（`outsourcing-simulation.policy.test.ts`）で固定できる。
- 自動選定の体感が **plan + candidates** 中心になり、simulate 失敗による無反応が消える。
- `maxCandidates:500` は **400 + VALIDATION_ERROR** で明示的。

**悪い / 注意**

- 部品候補 **一覧 API** は依然 **200 件 cap**（plan が 200 超を返しても一覧に載らない部品があり得る）。部品表は選定 ID ベースで表示し、メタは 200 件プールから補完する設計。
- Pi4 キオスクは Pi5 の SPA を参照するため、**Pi5 のみデプロイ**でも Mac 代理は新 UI になるが、**Pi4 実機のキャッシュ**は別途強制リロードが必要な場合がある。

## References

- [KB-362 §外注](../knowledge-base/KB-362-kiosk-load-balancing.md#資源cd俯瞰外注候補シミュ--仕様実装正本)
- [KB-362 §実機検証 契約整合](../knowledge-base/KB-362-kiosk-load-balancing.md#実機検証2026-05-27--外注契約整合--自動選定フロー)
- [運用ガイド](../guides/kiosk-production-schedule-load-balancing.md)
- [deployment.md §2026-05-27](../guides/deployment.md#kiosk-load-balancing-ui-p0p1-contract-fix-2026-05-27)
- コミット **`cd42ebfe`** · CI **`26504703984`**
