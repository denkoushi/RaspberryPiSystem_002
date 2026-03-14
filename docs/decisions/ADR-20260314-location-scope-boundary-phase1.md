# ADR-20260314: Location Scope Boundary (Phase 1)

- Status: accepted
- Date: 2026-03-14

## Context

- `location` が業務上の拠点、端末別設定キー、shared 参照キーの3役で混在し、機能追加時に誤適用を起こしやすい。
- `x-client-key -> ClientDevice.location -> locationKey` の経路が多くの API で再利用され、意味の違いをコード上で区別しにくい。
- 既存運用と互換を維持しつつ、将来の site/device/shared 分離へ移行可能な境界が必要。

## Decision

Phase 1 では挙動を変えず、以下を実施する。

1. 既存 `location` 解決ロジックを保持したまま、用途別に解決関数を追加する。
   - `resolveDeviceScopeKey()`
   - `resolveSiteKey()`
   - `resolveDeviceName()`
   - `resolveInfraHost()`
   - `resolveCredentialIdentity()`
   - `resolveLocationScopeContext()`
2. 既存 API の `resolveLocationKey()` は互換ラッパーとして残す。
3. ルート層依存は `KioskRouteDeps` に用途別 resolver を追加し、呼び出し側が要求スコープを明示できる構造へ寄せる。
4. DB スキーマ変更、キー削除、機能仕様変更は Phase 1 では行わない。

## Alternatives

- 代替案A: `location` を全機能で一括 rename
  - 却下理由: 影響範囲が広すぎ、運用停止リスクが高い。
- 代替案B: DB スキーマを先に再編
  - 却下理由: 仕様合意前にデータ構造を変えると rollback が難しい。

## Consequences

### Positive

- 既存挙動を維持したまま、意味の境界をコードで表現できる。
- Phase 2 以降で site/device/shared を個別に移行しやすくなる。
- テストで「解決ロジック」と「機能ロジック」を分離して検証できる。

### Negative

- 当面は `resolveLocationKey()` と新 resolver が併存するため、一時的に API 面が増える。
- `location` の根本的な意味分離（DB 含む）は次フェーズまで持ち越し。

## References

- [apps/api/src/lib/location-scope-resolver.ts](../../apps/api/src/lib/location-scope-resolver.ts)
- [apps/api/src/routes/kiosk/shared.ts](../../apps/api/src/routes/kiosk/shared.ts)
- [apps/api/src/routes/kiosk/production-schedule/shared.ts](../../apps/api/src/routes/kiosk/production-schedule/shared.ts)
- [docs/plans/location-scope-phase1-audit.md](../plans/location-scope-phase1-audit.md)
