# ADR-20260319: 手動順番の deviceScopeKey 正規化（siteKey 導出 + Mac 代理 targetDeviceScopeKey）

Status: accepted

## Context

- 手動順番（`ProductionScheduleOrderAssignment`）が `location` のみで、サイト単位と端末単位の意味が混在しうる。
- Mac からの代理更新と、工場単位の俯瞰（納期管理）を両立するには、**保存キーを端末（deviceScopeKey）に固定**し、**工場キー（siteKey）は導出・集計**に使うのが明確。

## Decision

- `ProductionScheduleOrderAssignment` に `siteKey` 列を追加し、`location` は **deviceScopeKey 専用**として運用する（旧 `location=siteKey` 行は読み取り互換として残す）。
- 書き込み API（`PUT .../order`）はフラグ `KIOSK_MANUAL_ORDER_DEVICE_SCOPE_V2_ENABLED` が有効なとき:
  - **Mac**: `targetDeviceScopeKey` 必須（未指定は 400）。`ClientDevice.location` に一致する登録端末のみ許可（不一致は 403）。
  - **キオスク**: `targetDeviceScopeKey` / `targetLocation` の送信は禁止（400）。
- `manual-order-overview` は **siteKey 必須**、任意で `deviceScopeKey` 絞り込み。レスポンスは `devices[]` で端末別にネスト。旧サイト単位行は擬似キー `__legacy_site__` で返す。
- Web は `VITE_KIOSK_MANUAL_ORDER_DEVICE_SCOPE_V2_ENABLED` で API と整合させる。`GET .../search-state` に `locationScope`（`siteKey` / `deviceScopeKey`）を追加し、キオスクが overview の `siteKey` を確実に送れるようにする。

## Alternatives

- DB マイグレーションなしで API のみで吸収: 集計・権限が複雑になり、再発防止が弱い。
- `targetLocation` を拡張し続ける: Mac が工場名と端末名を同一文字列空間で扱い続け、検証と UI が壊れやすい。

## Consequences

- **良**: 端末別順番と工場俯瞰の契約が分離され、代理更新の検証が明確になる。
- **良**: 機能フラグでロールバック可能（API/Web とも `false` で従来動作）。
- **注意**: 移行後も旧行が残るため、overview でレガシーバケット表示を明示する必要がある。
- **注意**: `ClientDevice.location` の未登録・表記ゆれがあると端末リストが空になり、Mac 操作が不能になりうる（事前棚卸し推奨）。

## References

- Prisma migration: `20260319120000_add_production_schedule_order_assignment_site_key`
- API: `apps/api/src/routes/kiosk/production-schedule/order.ts`, `due-management-manual-order-overview.ts`, `manual-order-site-devices.ts`, `resolve-assignment-location-key.ts`
- Web: `ProductionScheduleDueManagementPage.tsx`, `ProductionSchedulePage.tsx`, `DueManagementLeftRail.tsx`
