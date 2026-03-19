---
title: ADR-20260319: 生産順序モードとtargetLocation境界
status: accepted
---

# ADR-20260319: 生産順序モードとtargetLocation境界

## Context

- 生産スケジュールの `globalRank` は運用改善中で、現場では `processingOrder` を使った手動順番が必要。
- ただし複数資源CDを同時表示した状態で手動順番を有効化すると、順番の意味が曖昧になる。
- 現場リーダーの代理設定ニーズに対応するため、`targetLocation` を指定した order 更新が必要。
- 既存クライアント互換（`targetLocation` 未指定時）を維持する必要がある。

## Decision

- 生産スケジュール画面に `自動順番 / 手動順番` モードを導入し、既定を `手動順番` とする。
- 手動順番は「単一資源CD表示時のみ」有効化し、条件外は `processingOrder` 編集を無効化する。
- 並び順戦略は以下を採用する。
  - `auto`: 既存 `globalRank` ロジックを継続利用
  - `manual`: `processingOrder` 昇順（未設定末尾）+ 安定タイブレーク
- `PUT /api/kiosk/production-schedule/:rowId/order` に `targetLocation` を任意追加する。
  - 未指定は actor location を更新（後方互換）
  - 指定時は route 境界で代理更新ポリシーを適用し、許可外は `403 TARGET_LOCATION_FORBIDDEN`
- 監査・学習目的で、order 更新時に `manual_order_update` イベントを記録する。

## Alternatives

- **代替1: 手動順番を常時有効化（複数資源CDでも編集可能）**
  - 却下。順番の意味が資源横断で混在し、運用誤解を招く。
- **代替2: service 層で targetLocation 解決を実施**
  - 却下。境界契約が不明確になり、既存契約への影響範囲が広がる。
- **代替3: 学習イベントは既存 `manual_complete_toggle` のみ利用**
  - 却下。順番変更の意図データが欠落し、式改善の入力として不十分。

## Consequences

- UIは手動/自動を明示的に切替可能になり、運用上の意図が分離される。
- 代理設定は `targetLocation` 境界ガード付きで可能になる。
- 学習データに手動順番更新が蓄積され、全体ランキング改善の材料が増える。
- 一方で、手動順番は単一資源CD条件を満たさないと編集不可になるため、運用手順の周知が必要。

## References

- `apps/web/src/features/kiosk/productionSchedule/displayRowDerivation.ts`
- `apps/web/src/pages/kiosk/ProductionSchedulePage.tsx`
- `apps/api/src/routes/kiosk/production-schedule/order.ts`
- `apps/api/src/services/production-schedule/production-schedule-command.service.ts`
- `apps/api/src/routes/kiosk/production-schedule/due-management-manual-order-overview.ts`
