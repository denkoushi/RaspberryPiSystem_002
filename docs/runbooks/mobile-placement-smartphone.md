# 配膳スマホ（Android）セットアップ・検証 Runbook

最終更新: 2026-04-10

## 0. 本番デプロイ後の確認（運用）

**対象ホスト（配膳 API/SPA を反映する最小セット）**: `raspberrypi5` → 各 Pi4 キオスク（`raspberrypi4`・`raspi4-robodrill01`・`raspi4-fjv60-80`・`raspi4-kensaku-stonebase01`）。**Pi3 サイネージは必須ではない**（本機能は `/kiosk/...`）。手順は [deployment.md](../guides/deployment.md) の **`update-all-clients.sh`**。複数台のときは **inventory のホストを `--limit` で 1 台ずつ**（例: `--foreground`）。**2026-04-10**: `main` **`8e1d0e3f`** を上記順で反映済み。自動回帰はリポジトリ直下で `./scripts/deploy/verify-phase12-real.sh`（**PASS 43 / WARN 0 / FAIL 0** 相当を確認）。API の spot check（`x-client-key` は端末の `apiKey`）:

```bash
curl -sk "https://<Pi5>/api/mobile-placement/resolve-item?barcode=<itemCode>" -H "x-client-key: <key>"
```

## 前提

- Pi5 が稼働し、通常どおり **HTTPS** で API/Web が応答すること
- Android を **Tailscale** で Pi5 と同じ tailnet に参加させ、ACL で **`tag:server` の tcp:443** が端末から許可されていること（[tailscale-policy.md](../security/tailscale-policy.md)）
- 端末に **Chrome** を使用する

## 1. 端末登録（ClientDevice）

`POST /api/clients/heartbeat` で `apiKey` / `name` / `location` を登録する（型落ち Android タブレットのサイネージ手順と同じ）。詳細は [signage-client-setup.md](../guides/signage-client-setup.md#android-signage-lite)。

## 2. 疎通

1. `https://<Pi5-Tailscale-IP>/api/system/health` が JSON `status: ok` を返すこと
2. ブラウザで `https://<Pi5-Tailscale-IP>/kiosk/mobile-placement?clientKey=<apiKey>` を開くこと

## 3. 業務フロー（V1）

1. 一覧で対象行を選ぶ（または「スケジュールなしで配置」）
2. **棚番**をスキャンまたは手入力
3. **アイテム**をスキャン（`Item.itemCode` と一致するラベルであること）
4. 「配置を登録」

バーコードの意味が不明な場合は [KB-339](../knowledge-base/KB-339-mobile-placement-barcode-survey.md) に従って現場サンプルを取る。

## 4. トラブルシュート

- **401 / 無効なクライアントキー**: `heartbeat` 未登録、または `x-client-key` と URL の `clientKey` がずれている
- **ネットワーク不可**: Tailscale 未接続、ACL で 443 が拒否、Pi5 停止
- **登録 404（工具マスタに無い）**: `itemCode` とラベルを揃える（KB-339）
- **400 `MOBILE_PLACEMENT_SCHEDULE_MISMATCH`**: 一覧で選んだ行と **別の工具**をスキャンした。スキャン値が当該行の **`ProductNo` / `FSEIBAN` / `FHINCD`** のいずれかと一致するか、`Item.itemCode` がそれらのいずれかと一致する必要がある（**行と無関係な `itemCode` だけ一致**では弾く）

## 5. API 契約

[api/mobile-placement.md](../api/mobile-placement.md)
