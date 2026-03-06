# ADR-20260306: 端末別メンテナンス状態（deploy-status v2）

Status: accepted

## Context

- 従来: 1つのグローバルフラグ `kioskMaintenance` で全キオスクがメンテナンス表示になる。
- 課題:
  - カナリアデプロイ時に対象外端末までメンテナンス画面になる。
  - 通信不安定端末が他端末運用を巻き込む。
  - プリフライト前にフラグを立てるため、到達不可端末にフラグを立ててしまうリスクがある。

## Decision

deploy-status を version 2 に一括切替し、端末別メンテナンス状態を導入する。

### 新フォーマット（deploy-status.json）

```json
{
  "version": 2,
  "kioskByClient": {
    "raspberrypi4-kiosk1": { "maintenance": true, "startedAt": "2026-03-06T12:00:00Z", "runId": "20260306-120000-12345" },
    "raspi4-robodrill01-kiosk1": { "maintenance": true, "startedAt": "2026-03-06T12:00:00Z", "runId": "20260306-120000-12345" }
  }
}
```

- `version`: 2（将来の拡張用）
- `kioskByClient`: キーは `status_agent_client_id`（inventory の `status_agent_client_id` と一致）
- 各値: `maintenance`, `startedAt`, `runId`（任意）

### API レスポンス（GET /system/deploy-status）

- リクエスト: `x-client-key` ヘッダー（必須。キオスクからの呼び出し時）
- レスポンス: `{ "isMaintenance": boolean }`
- 解決ロジック: `x-client-key` → ClientDevice（apiKey）→ `statusClientId` で `kioskByClient` を検索
- `x-client-key` 無効時: `isMaintenance: false`（安全側）
- ファイル欠損/壊れ: `isMaintenance: false`

### デプロイスクリプト

- プリフライト成功後にのみフラグを書込。
- 対象キオスク（`--limit` と `manage_kiosk_browser=true` の積集合）の `status_agent_client_id` のみを `kioskByClient` に含める。
- クリア時: ファイル削除（全対象の解除）。

## Implementation

- API: `apps/api/src/routes/system/deploy-status.ts`
- Web: `apps/web/src/api/client.ts`, `apps/web/src/layouts/KioskLayout.tsx`
- スクリプト: `scripts/update-all-clients.sh`

## References

- KB-183: Pi4デプロイ時のキオスクメンテナンス画面表示機能
- 計画: `.cursor/plans/per-client-maintenance-cutover_*.plan.md`
