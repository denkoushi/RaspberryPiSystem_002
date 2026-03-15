# ADR-20260315: Location Scope Phase3 Flagged Scope Contract

- Status: accepted
- Date: 2026-03-15

## Context

- Phase2で `ProductionScheduleResourceCategoryConfig` の site正規化は完了したが、`production-schedule` 系の一部ルートはまだ `resolveLocationKey` を直接利用しており、`deviceScopeKey/siteKey` の責務が呼び出し側で曖昧になる余地が残っていた。
- `due-management-query.service.ts` は既存契約との互換を維持する必要があり、一括で呼び出し契約を破壊的に変更するとロールバックコストが高い。
- 本件は段階移行が前提のため、「新契約を導入しつつ、即時切り戻し可能」にする必要がある。

## Decision

Phase3では `production-schedule` 系の scope 入力契約を段階統一し、Feature Flagで切り替える。

1. ルート層は `resolveLocationScopeContext()` 経由を必須化し、サービス呼び出しには `deviceScopeKey` を明示的に渡す。
2. `due-management-location-scope-adapter.service.ts` を導入し、`string` と `scopeContext` の両入力を受ける互換アダプタを提供する。
3. `LOCATION_SCOPE_PHASE3_ENABLED` で storage参照キーを切替可能にする（`false`: legacy優先、`true`: deviceScopeKey優先）。
4. `due-management-query.service.ts` の既存API契約は維持し、呼び出し側をアダプタ経由へ順次移行する。

## Alternatives

- 代替案A: ルート層のみ修正し、サービス契約は現状維持
  - 却下理由: 再発防止（入力契約の明示化）が弱く、将来差分で曖昧な呼び出しが戻る可能性が高い。
- 代替案B: `due-management-query.service.ts` を一括破壊的変更
  - 却下理由: 既存呼び出し範囲が広く、段階移行方針と矛盾する。

## Consequences

### Positive

- ルート層からサービス層へのスコープ受け渡しが明示化され、責務境界が明確になる。
- Feature Flagで即時切り戻しが可能になり、実機展開時の安全性が高まる。
- 互換アダプタにより、既存契約を壊さず段階移行を継続できる。

### Negative

- 一時的に「本体サービス + アダプタ」の2層構成となり、構造が増える。
- Flag運用が増えるため、設定管理（inventory/.env）の整合維持が必要。

## References

- [docs/decisions/ADR-20260315-location-scope-phase2-resource-category-site-scope.md](./ADR-20260315-location-scope-phase2-resource-category-site-scope.md)
- [apps/api/src/services/production-schedule/due-management-location-scope-adapter.service.ts](../../apps/api/src/services/production-schedule/due-management-location-scope-adapter.service.ts)
- [apps/api/src/routes/kiosk/production-schedule](../../apps/api/src/routes/kiosk/production-schedule)
- [apps/api/src/config/env.ts](../../apps/api/src/config/env.ts)
