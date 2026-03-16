---
title: Location Scope Phase12 横展開監査
status: completed
last-updated: 2026-03-16
owners: [api]
---

# Location Scope Phase12 横展開監査

## 目的

`location` 意味混在の再発防止として、API境界で `siteKey` / `deviceScopeKey` の使い分けが崩れていないかを棚卸しし、最小差分で是正する。

## 監査範囲

- `apps/api/src/routes/kiosk/production-schedule/**`
- `apps/api/src/services/production-schedule/**`
- `apps/api/src/lib/location-scope-resolver.ts`

## 監査観点

1. ルート境界で `deviceScopeKey` を明示しているか
2. 互換情報（legacy）が公開契約へ漏れていないか
3. 既存 `locationKey` 契約へ橋渡しする場合、変数名で意味が保たれているか

## 結果

- `resolveLocationKey` / `legacyLocationKey` の公開漏れは検出されず（Phase11時点の方針を維持）
- `production-schedule` ルートに、`deviceScopeKey` を `locationKey` というローカル変数名で受ける箇所が残存
- 既存サービス契約の互換性は維持したまま、ルートローカル変数名を `deviceScopeKey` へ統一する最小是正を実施

## 是正内容（最小差分）

以下のルートで `const locationKey = locationScopeContext.deviceScopeKey;` を廃止し、`const deviceScopeKey = ...` に統一。
サービス呼び出し時のみ `locationKey: deviceScopeKey` を明示。

- `apps/api/src/routes/kiosk/production-schedule/due-date.ts`
- `apps/api/src/routes/kiosk/production-schedule/note.ts`
- `apps/api/src/routes/kiosk/production-schedule/order.ts`
- `apps/api/src/routes/kiosk/production-schedule/order-usage.ts`
- `apps/api/src/routes/kiosk/production-schedule/history-progress.ts`
- `apps/api/src/routes/kiosk/production-schedule/processing-type-options.ts`
- `apps/api/src/routes/kiosk/production-schedule/complete.ts`
- `apps/api/src/routes/kiosk/production-schedule/processing.ts`
- `apps/api/src/routes/kiosk/production-schedule/search-state.ts`
- `apps/api/src/routes/kiosk/production-schedule/search-history.ts`

## 影響評価

- API入出力契約: 変更なし
- DBスキーマ: 変更なし
- 実行時挙動: 変更なし（変数名と引数名マッピングのみ）

## フォローアップ

- 新規コードでは、境界変数に `locationKey` を使わない（`deviceScopeKey` または `siteKey` を使用）
- 命名規約は `docs/guides/location-scope-naming.md` を唯一の参照として運用する
- **Phase13 完了（2026-03-16）**: 互換橋渡しを `toLegacyLocationKeyFromDeviceScope()` に集約し、境界型（SiteKey/DeviceScopeKey/DeviceName/InfraHost）を明示化。`locationKey` 文字列再解釈の再発防止を実施済み。詳細は [KB-297](../knowledge-base/KB-297-kiosk-due-management-workflow.md#location-scope-phase13安全リファクタ2026-03-16)
