# ADR-20260323: 手動順番・全体ランキングの `siteKey` 正本化

Status: accepted

Supersedes: [ADR-20260319-manual-order-device-scope-v2](./ADR-20260319-manual-order-device-scope-v2.md)

## Context

- 手動順番（`ProductionScheduleOrderAssignment`）は `deviceScopeKey` 単位保存だったため、同一工場内でも端末ごとに結果が分かれた。
- 全体ランキング（globalShared）は `shared-global-rank` 固定保存だったため、工場単位運用との対応関係が曖昧だった。
- 要件は「資源CDごとの手動順番」と「全体ランキング（行単位表示含む）」を工場内で同期すること。

## Decision

- 手動順番の canonical 保存キーを `siteKey` に変更する。
  - v2 有効時の assignment location 解決は `siteKey` を返す。
  - Mac の `targetDeviceScopeKey` は引き続き必須だが、保存先は対象端末の `siteKey` とする。
  - キオスクは `targetDeviceScopeKey` 禁止を維持し、自工場 `siteKey` を保存先にする。
- 全体ランキングの `globalShared` 保存キーを `siteKey` に変更する。
  - `shared-global-rank` は互換読み取りのフォールバックとしてのみ扱う。
- 互換移行は API 境界に閉じ込める。
  - 読み取り: `siteKey` 正本優先、旧 `deviceScopeKey` / `shared-global-rank` をフォールバック参照。
  - 書き込み: canonical（`siteKey`）へ保存し、旧形式の意味は新契約に持ち込まない。

## Alternatives

- `deviceScopeKey` 正本を維持し、UI 側で疑似同期する。
  - UI 実装が複雑化し、API 契約との乖離が継続するため不採用。
- `shared-global-rank` を維持して手動順番のみ `siteKey` 化する。
  - 順番とランキングの整合性が崩れるため不採用。

## Consequences

- 良い点:
  - 工場内の複数端末で手動順番・全体ランキングの結果が一致する。
  - UI は保存キー詳細を意識せず、境界で互換吸収できる。
- 注意点:
  - 移行期間は legacy データ（`deviceScopeKey` / `shared-global-rank`）のフォールバック読み取りが必要。
  - 旧データが混在する間は表示値の由来が複数経路になり得るため、運用確認を継続する。

## References

- API:
  - `apps/api/src/routes/kiosk/production-schedule/resolve-assignment-location-key.ts`
  - `apps/api/src/routes/kiosk/production-schedule/order.ts`
  - `apps/api/src/services/production-schedule/production-schedule-query.service.ts`
  - `apps/api/src/services/production-schedule/due-management-global-rank.service.ts`
- KB: [KB-297](../knowledge-base/KB-297-kiosk-due-management-workflow.md#manual-order-sitekey-canonical-sync-2026-03-23)
