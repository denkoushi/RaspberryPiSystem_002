# Location Scope Phase 1 Audit

## Goal

- `location` の用途混在を可視化し、挙動不変で境界導入する。
- Phase 1 は機能仕様を変更しない。

## Usage Classification

| 区分 | 説明 | 主な実装 |
| --- | --- | --- |
| 業務ロケーション | 現場運用上の拠点名（例: 第2工場） | `status_agent_location` ([infrastructure/ansible/inventory.yml](../../infrastructure/ansible/inventory.yml)) |
| 端末別設定キー | 端末ごとの差分設定を引くキー | `resolveLocationKey()` ([apps/api/src/routes/kiosk/shared.ts](../../apps/api/src/routes/kiosk/shared.ts)) |
| shared/global | 端末を跨いで共有するキー | `SHARED_SEARCH_STATE_LOCATION='shared'` ([apps/api/src/services/production-schedule/production-schedule-search-state.service.ts](../../apps/api/src/services/production-schedule/production-schedule-search-state.service.ts)) |
| 認証/接続ID | 認可と接続に使う識別子 | `apiKey` / `statusClientId` ([apps/api/prisma/schema.prisma](../../apps/api/prisma/schema.prisma)) |

## Phase 1 Terminology Freeze

- `siteKey`: 業務上の拠点（例: 第2工場）
- `deviceName`: 業務上の端末名（例: kensakuMain, RoboDrill01）
- `infraHost`: インフラ上のホスト識別子（例: raspberrypi4）
- `deviceScopeKey`: 端末別設定キー
- `credentialIdentity`: `apiKey` / `statusClientId` / `clientDeviceId`

## Boundary Introduction (No Behavior Change)

- 新規 resolver 実装: [apps/api/src/lib/location-scope-resolver.ts](../../apps/api/src/lib/location-scope-resolver.ts)
- 互換ラッパー導入: [apps/api/src/routes/kiosk/shared.ts](../../apps/api/src/routes/kiosk/shared.ts)
- ルート依存注入の拡張: [apps/api/src/routes/kiosk/production-schedule/shared.ts](../../apps/api/src/routes/kiosk/production-schedule/shared.ts)

### Resolver Responsibilities

| 関数 | 役割 | 互換性 |
| --- | --- | --- |
| `resolveLegacyLocationKey()` | 既存 `locationKey` 解決 | 既存挙動維持 |
| `resolveDeviceScopeKey()` | 端末別設定キー解決 | 既存 `locationKey` と同値 |
| `resolveSiteKey()` | 拠点キー抽出 | `A - B` 形式を `A` に分離 |
| `resolveDeviceName()` | 端末名抽出 | `A - B` 形式を `B` に分離 |
| `resolveInfraHost()` | インフラホスト識別 | `clientDevice.name` を利用 |
| `resolveCredentialIdentity()` | 認証識別子集約 | DB値をそのまま利用 |
| `resolveLocationScopeContext()` | 上記を1オブジェクトで返却 | 参照側の責務明示 |

## Verification Checklist (Phase 1)

1. `x-client-key` で保護された既存 API が従来どおり 200/401 を返す。
2. `deploy-status` の `statusClientId` 解決挙動が変わらない。
3. 生産スケジュール系 API の参照先（検索状態・進捗一覧・actual-hours）が変わらない。
4. 新 resolver のユニットテストが通る。

## Phase 1 Deliverables

- 実装境界追加（挙動不変）
- resolver テスト
- ADR 記録
- この監査ドキュメント

## デプロイ・実機検証（2026-03-15）

- **ブランチ**: `refactor/location-scope-boundary-phase1`（Phase1 + 進捗一覧復活を含む）
- **デプロイ**: Pi5 → raspberrypi4 → raspi4-robodrill01 の順に1台ずつ実行（Run ID `20260315-101803-4865` / `20260315-102542-16017` / `20260315-103331-6156`）、約20分
- **実機検証**: APIヘルス、deploy-status（両Pi4で `isMaintenance: false`）、キオスクヘッダーから進捗一覧画面への遷移・表示を確認
- **参照**: [KB-297](../knowledge-base/KB-297-kiosk-due-management-workflow.md#進捗一覧復活2026-03-15)

## Carry-over to Phase 2

- `ProductionScheduleResourceCategoryConfig` の scope は **site** を正規とする（ADR-20260315）
- 管理画面文言の改善（端末別設定であることの明示）
- DB スキーマ再編の要否判断

## Phase 2 デプロイ・実機検証（2026-03-15）

- **ブランチ**: `feat/location-scope-phase2-migration`
- **デプロイ**: Pi5 → raspberrypi4 → raspi4-robodrill01 の順に1台ずつ実行、約20分、Pi3除外
- **実機検証**: リモート自動チェック全項目合格（APIヘルス、deploy-status両Pi4、キオスクAPI、納期管理API、resource-categories、サイネージAPI、backup.json、マイグレーション52件、Pi4/Pi3サービス稼働）
- **参照**: [KB-297](../knowledge-base/KB-297-kiosk-due-management-workflow.md#location-scope-phase2siteスコープ正規化の段階移行2026-03-15) / [deploy-status-recovery.md](../runbooks/deploy-status-recovery.md)

## Phase 3 デプロイ・実機検証（2026-03-15）

- **ブランチ**: `feat/location-scope-phase3-completion`
- **デプロイ**: Pi5 → raspberrypi4 → raspi4-robodrill01 の順に1台ずつ実行（Run ID `20260315-123857-22423` / `20260315-124840-2507` / `20260315-125820-7779`）、約45分、Pi3除外
- **実機検証**: リモート自動チェック全項目合格（APIヘルス、deploy-status両Pi4、キオスクAPI、納期管理API（triage/daily-plan/global-rank/proposal/learning-report/actual-hours/stats/summary）、サイネージAPI、backup.json、マイグレーション52件、Pi4×2サービス稼働）
- **Feature Flag**: `location_scope_phase3_enabled` は初期 `false`。Phase3新経路有効化時は inventory で `true` に変更して再デプロイ
- **参照**: [KB-297](../knowledge-base/KB-297-kiosk-due-management-workflow.md#location-scope-phase3scope契約統一--flag段階切替2026-03-15) / [deploy-status-recovery.md](../runbooks/deploy-status-recovery.md)
