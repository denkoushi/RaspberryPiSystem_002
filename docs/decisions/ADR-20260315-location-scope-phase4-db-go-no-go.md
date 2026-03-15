# ADR-20260315: Location Scope Phase4 DB Physical Split Go/No-Go

- Status: accepted
- Date: 2026-03-15

## Context

- Location Scope Phase10 までで、公開契約は `StandardLocationScopeContext` に収束し、`legacyLocationKey` は公開面から除去済み。
- 一方で DB には `ClientDevice.location` が残っており、`siteKey/deviceName/infraHost` の物理分離を即時実施する案が候補に上がった。
- 本番は Pi5 + Pi4x2 の段階デプロイ運用で、認証情報（`apiKey` / `statusClientId`）と端末別挙動の破壊リスクを最小化する必要がある。

## Decision

Phase4 判定は **No-Go（即時物理分離は見送り）** とする。

1. 当面は `ClientDevice.location` を残置し、resolver 境界で `siteKey/deviceName/infraHost/deviceScopeKey` を解決する。
2. 機能側の参照は scope 契約へ段階移行し、生値 `location` 直参照を増やさない。
3. `resource-category-policy` で site 解決経路（`siteKey/deviceScopeKey/legacyString/default`）を監視し、移行の健全性をログで観測する。
4. Go 再判定は「fallback 経路の収束」「運用コスト」「障害リスク」の3条件で行う。

## Alternatives

- 代替案A: `ClientDevice` に `siteKey/deviceName/infraHost` を追加し、即時 dual-write 開始
  - 却下理由: 既存運用（認証・deploy-status・クライアント識別）への影響が広く、切り戻しコストが高い。
- 代替案B: `location` 一括 rename（repo 全体置換）
  - 却下理由: 意味の異なる `location` を同時置換すると挙動破壊のリスクが高い。

## Consequences

### Positive

- 既存 API/DB 契約を維持しながら、段階移行を継続できる。
- 監視ログで移行進捗を定量把握でき、Go 判定の根拠が明確になる。
- 1PR=1意図の運用と相性が良く、リバート範囲を最小化できる。

### Negative

- 一時的に「旧データ構造 + 新境界」の併存期間が続く。
- 物理分離を急ぐ場合に比べ、最終到達までの期間は長くなる。

## References

- [docs/plans/location-scope-phase1-audit.md](../plans/location-scope-phase1-audit.md)
- [docs/knowledge-base/KB-297-kiosk-due-management-workflow.md](../knowledge-base/KB-297-kiosk-due-management-workflow.md)
- [apps/api/src/lib/location-scope-resolver.ts](../../apps/api/src/lib/location-scope-resolver.ts)
- [apps/api/src/services/production-schedule/policies/resource-category-policy.service.ts](../../apps/api/src/services/production-schedule/policies/resource-category-policy.service.ts)
