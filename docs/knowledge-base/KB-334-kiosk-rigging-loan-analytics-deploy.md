---
title: KB-334 キオスク「集計」（吊具・持出返却アイテム）デプロイ・実機確認
tags: [キオスク, 吊具, 工具, デプロイ, API, DADS]
audience: [運用者, 開発者]
last-verified: 2026-04-09
category: knowledge-base
---

# KB-334: キオスク「集計」（吊具・持出返却アイテム）

## 仕様（要約）

- **ルート**: `/kiosk/rigging-analytics`（URL は据え置き）。ヘッダナビ表記は **「集計」**。
- **UI**: デジタル庁デザインシステム（DADS）トークン（`@digital-go-jp/design-tokens`）＋ Noto Sans JP / Mono。画面内で **吊具** と **持出返却アイテム** をタブ切替（同一 ViewModel で表・グラフを共通化）。
- **API（吊具）**: `GET /api/rigging-gears/loan-analytics`（`x-client-key` または JWT の `allowView`）。`cancelledAt` 非 null の Loan は集計から除外。
- **API（アイテム）**: `GET /api/tools/items/loan-analytics`（認可は吊具 analytics と同系）。**対象 Loan**: `itemId IS NOT NULL` かつ `riggingGearId` / `measuringInstrumentId` が NULL、`cancelledAt` NULL。**計測器・吊具貸出はここに含めない**（アイテム専用集計のため）。
- **月次集計**: 既定タイムゾーン `Asia/Tokyo` 暦月（クエリで上書き可）。**2026-04-09 時点**: 当該機能追加に伴う **新規 Prisma マイグレーションなし**（既存 `Loan` / `Item` を参照）。

## デプロイ（標準手順）

[`docs/guides/deployment.md`](../guides/deployment.md) の `scripts/update-all-clients.sh` のみ使用する。

**前提**: Pi5 を含む実行では **`export RASPI_SERVER_HOST=<Pi5の到達可能ホスト>`**（例: Tailscale。未設定時はスクリプトが即終了）。

### Pi5 のみ（SPA・API がサーバ `web` / `api` のとき）

[deployment.md の判断](../guides/deployment.md)（**Web + API が Pi5 コンテナ**・キオスク Pi4 はサーバ URL を開くのみ）に従い、**コード反映は `raspberrypi5` のデプロイで足りる**運用が可能。

```bash
BRANCH=main
INV=infrastructure/ansible/inventory.yml
export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"
./scripts/update-all-clients.sh "$BRANCH" "$INV" --limit raspberrypi5 --detach --follow
```

**Pi4 へ Ansible を回さない場合**: 各キオスク Firefox で **スーパーリロード**（キャッシュされた旧バンドルの可能性に注意）。

### 初回吊具可視化時と同様に Pi4 へも git 同期が要る運用

組織方針で **Pi4×4 にも** リポジトリ同期が必要な場合（ツール検査ポリシー等）、以下を **1 台ずつ**・前が成功してから次へ。

```bash
BRANCH=main
INV=infrastructure/ansible/inventory.yml
export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"
./scripts/update-all-clients.sh "$BRANCH" "$INV" --limit raspberrypi5 --detach --follow
./scripts/update-all-clients.sh "$BRANCH" "$INV" --limit raspberrypi4 --detach --follow
./scripts/update-all-clients.sh "$BRANCH" "$INV" --limit raspi4-robodrill01 --detach --follow
./scripts/update-all-clients.sh "$BRANCH" "$INV" --limit raspi4-fjv60-80 --detach --follow
./scripts/update-all-clients.sh "$BRANCH" "$INV" --limit raspi4-kensaku-stonebase01 --detach --follow
```

**Pi3（サイネージ）**: 本機能の必須デプロイ対象ではない。**Pi3 専用手順**が必要な別変更のみ [deployment.md](../guides/deployment.md) の Pi3 節に従う。

## 実機検証（自動）

```bash
./scripts/deploy/verify-phase12-real.sh
```

期待: **FAIL 0**（環境により WARN はあり得る）。本スクリプトは **汎用キオスク API** を網羅するが、**アイテム loan-analytics は必須項目に未収録**のため、追加スモークを推奨。

## 追加スモーク（推奨）

```bash
curl -sk "https://<server>/api/rigging-gears/loan-analytics" -H "x-client-key: <client-key>" | head -c 400
curl -sk "https://<server>/api/tools/items/loan-analytics" -H "x-client-key: <client-key>" | head -c 400
```

- **期待（吊具）**: `summary` / `byGear`（または相当）/ `byEmployee`
- **期待（アイテム）**: `summary` / `byItem` / `byEmployee`、`meta.periodFrom` 等

## 本番実績

### 2026-04-09（DADS・持出返却アイテムタブ・ViewModel 反映・Pi5 のみ）

- **ブランチ**: `main`
- **対象ホスト**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。Pi4/Pi3 playbook は `no hosts matched`
- **Detach Run ID**: `20260409-213409-15007`
- **結果**: `PLAY RECAP` **`failed=0` / `unreachable=0`**、リモート **exit `0`**（所要約 **17 分**・`Rebuild/Restart docker compose` 等含む）
- **Phase12**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **108s**・Mac / Tailscale）
- **API スモーク**: `GET /api/tools/items/loan-analytics` + `x-client-key` → **HTTP 200**、JSON に `meta` / `summary` / `byItem` を確認

### 2026-04-07（初回吊具可視化・Pi5→Pi4×4 順次）

- **ブランチ**: `feat/kiosk-rigging-loan-analytics`
- **順次デプロイ Run ID**:
  - `raspberrypi5`: `20260407-202545-7931`
  - `raspberrypi4`: `20260407-203843-1129`
  - `raspi4-robodrill01`: `20260407-204403-16863`
  - `raspi4-fjv60-80`: `20260407-204812-6662`
  - `raspi4-kensaku-stonebase01`: `20260407-205532-26037`
- **各 run 共通結果**: `PLAY RECAP failed=0` / `unreachable=0` / remote exit `0`
- **Phase12 実機検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 101s）

## Troubleshooting

| 事象 | 切り分け |
|------|----------|
| `[ERROR] RASPI_SERVER_HOST is required` | Mac シェルで `RASPI_SERVER_HOST` を export してから再実行。[`ansible-deployment.md`](./infrastructure/ansible-deployment.md) の Pi5 デプロイ条項参照。 |
| Pi5 run が `Rebuild/Restart docker compose services` で長く見える | 初回相当では Playwright の **`chromium` ダウンロード**が走り、Pi5 デプロイが通常より長くなる。`playwright install chromium` / `docker-buildx` が動作していれば継続待ちでよい。 |
| キオスクでデータ取得失敗 | API 未更新・`x-client-key` 不一致・ネットワーク。Pi5 の `GET /api/system/health` を先に確認。 |
| 月次が期待とずれる | `timeZone` クエリ（`Asia/Tokyo` / `UTC`）と DB 保存時刻（UTC）の組み合わせを確認。 |
| アイテムタブが 0 件・想定と違う | **集計対象は「一般 Item の Loan」のみ**。`riggingGearId` / `measuringInstrumentId` 付き Loan は **アイテム analytics から除外**。 |
| UI が古い（ナビが「吊具 状況」のまま等） | Pi5 の `web` 未更新、またはブラウザキャッシュ。Pi5 デプロイ後に **強制再読み込み**。 |

## References

- [deployment.md](../guides/deployment.md)（`--limit`・`--detach --follow`・Pi5 のみ判断）
- 実装（参考）: `apps/web/src/pages/kiosk/KioskRiggingAnalyticsPage.tsx`、`apps/web/src/components/kiosk/KioskHeader.tsx`、`apps/api/src/routes/tools/items/loan-analytics.ts`、`packages/shared-types/src/tools/item-loan-analytics.ts`
