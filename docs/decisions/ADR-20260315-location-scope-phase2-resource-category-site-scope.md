# ADR-20260315: Location Scope Phase2 ResourceCategory Site Scope

- Status: accepted
- Date: 2026-03-15

## Context

- `ProductionScheduleResourceCategoryConfig.location` は実運用で「端末別キー」と「拠点キー」が混在し、同一拠点内の端末ごとに切削除外設定が分岐するリスクがある。
- Phase1で `deviceScopeKey` / `siteKey` / `deviceName` の境界導入は完了したが、ResourceCategoryの設定参照先はまだ `locationKey` 直結で意味が曖昧。
- 切削除外は「拠点運用ルール」に近く、端末ごとの差分ではなく拠点共通として扱うほうが運用ミスを減らせる。

## Decision

Phase2では `ProductionScheduleResourceCategoryConfig` を **siteスコープ正規** とする。

1. ResourceCategoryポリシーは `siteKey` を優先して解決する。
2. 旧経路との互換のため、`legacyLocationKey` / `deviceScopeKey` しか渡されない場合も内部で `siteKey` に正規化して参照する。
3. API契約（path/status/response）は維持し、段階移行期間は互換ラッパーを残す。
4. `ProcessingTypeOption` と `ResourceCodeMapping` は本ADRの対象外とし、既存どおり location 単位の挙動を維持する。

## Alternatives

- 代替案A: deviceスコープ正規にする
  - 却下理由: 同一拠点で設定が分岐しやすく、現場運用の説明コストが増える。
- 代替案B: schema変更を先行して新カラムへ完全移行
  - 却下理由: 本番互換リスクが高く、Phase2の「挙動不変・段階移行」方針と合わない。

## Consequences

### Positive

- 切削除外設定の意味が「拠点共通」に統一される。
- ルート/サービスが `siteKey` を明示でき、用途混在の再発を抑止できる。
- 互換ラッパー経由の段階移行により、ロールバック単位を小さく保てる。

### Negative

- 既存データに device 形式で保存されたキーがある場合、同一site扱いで実質統合される。
- 移行期間は `legacyLocationKey` と `siteKey` の併存でコード面の複雑性が一時的に増える。

## References

- [docs/plans/location-scope-phase1-audit.md](../plans/location-scope-phase1-audit.md)
- [docs/decisions/ADR-20260314-location-scope-boundary-phase1.md](./ADR-20260314-location-scope-boundary-phase1.md)
- [apps/api/src/lib/location-scope-resolver.ts](../../apps/api/src/lib/location-scope-resolver.ts)
- [apps/api/src/services/production-schedule/policies/resource-category-policy.service.ts](../../apps/api/src/services/production-schedule/policies/resource-category-policy.service.ts)
