---
title: KB-334 吊具 持出・返却 可視化（キオスク）デプロイ・実機確認
tags: [キオスク, 吊具, デプロイ, API]
audience: [運用者, 開発者]
last-verified: 2026-04-07
category: knowledge-base
---

# KB-334: 吊具 持出・返却 可視化（キオスク）

## 仕様（要約）

- **API**: `GET /api/rigging-gears/loan-analytics`（`x-client-key` または JWT の `allowView`）。`cancelledAt` 非 null の Loan は集計から除外。
- **キオスク**: `/kiosk/rigging-analytics`、ヘッダ「吊具 状況」。月次は既定 `Asia/Tokyo` 暦月。Prisma マイグレーション追加なし。
- **対象 inventory ホスト（Pi3 除外）**: `raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`。**1 台ずつ**前が成功してから次へ。

## デプロイ（標準手順）

[`docs/guides/deployment.md`](../guides/deployment.md) の `scripts/update-all-clients.sh` のみ使用する。

**前提**: `raspberrypi5` を含む実行では **`export RASPI_SERVER_HOST=<Pi5の到達可能ホスト>`**（例: Tailscale IP。未設定時はスクリプトが即終了する）。

```bash
BRANCH=feat/kiosk-rigging-loan-analytics
INV=infrastructure/ansible/inventory.yml
./scripts/update-all-clients.sh "$BRANCH" "$INV" --limit raspberrypi5 --detach --follow
./scripts/update-all-clients.sh "$BRANCH" "$INV" --limit raspberrypi4 --detach --follow
./scripts/update-all-clients.sh "$BRANCH" "$INV" --limit raspi4-robodrill01 --detach --follow
./scripts/update-all-clients.sh "$BRANCH" "$INV" --limit raspi4-fjv60-80 --detach --follow
./scripts/update-all-clients.sh "$BRANCH" "$INV" --limit raspi4-kensaku-stonebase01 --detach --follow
```

ブランチが `main` にマージ済みなら `BRANCH=main` に置き換える。

## 実機検証（自動）

```bash
./scripts/deploy/verify-phase12-real.sh
```

期待: **FAIL 0**（環境により WARN はあり得る）。

## 追加スモーク（任意）

各キオスクの `clientKey` で:

```bash
curl -sk "https://<server>/api/rigging-gears/loan-analytics" -H "x-client-key: <client-key>" | head -c 400
```

JSON に `summary` / `byGear` / `byEmployee` が含まれること。

## Troubleshooting

| 事象 | 切り分け |
|------|----------|
| `[ERROR] RASPI_SERVER_HOST is required` | Mac シェルで `RASPI_SERVER_HOST` を export してから再実行。[`ansible-deployment.md`](./infrastructure/ansible-deployment.md) の Pi5 デプロイ条項参照。 |
| キオスクでデータ取得失敗 | API 未更新・`x-client-key` 不一致・ネットワーク。Pi5 の `GET /api/system/health` を先に確認。 |
| 月次が期待とずれる | `timeZone` クエリ（`Asia/Tokyo` / `UTC`）と DB 保存時刻（UTC）の組み合わせを確認。 |

## References

- 実装ブランチ: `feat/kiosk-rigging-loan-analytics`
- [deployment.md](../guides/deployment.md)（1 台ずつ `--limit`・`--detach --follow`）
