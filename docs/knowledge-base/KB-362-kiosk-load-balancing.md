---
title: KB-362 キオスク負荷調整（山崩し支援）画面
tags: [kiosk, production-schedule, load-balancing, machine-monthly-load]
audience: [開発者, 運用者]
last-verified: 2026-05-26
---

# KB-362: キオスク負荷調整（山崩し支援）画面

## Context

キオスク **負荷調整**（`/kiosk/production-schedule/load-balancing`）は、生産日程の未完了工程を資源CD単位で可視化し、山崩し（負荷移管）候補を提示する機能である。

| マイルストーン | ブランチ | 内容 |
|----------------|----------|------|
| 2026-04-30 初版 | `feat/kiosk-load-balance-suggest` | 資源CD俯瞰・能力設定・サジェスト（`plannedEndDate` 月） |
| 2026-05-26 拡張 | `feat/kiosk-load-balancing-machine-monthly-view` | **機種別月次負荷**タブ（有効納期月・機種/部品/積み上げグラフ） |

**新規 Prisma マイグレーションなし**（2026-05-26 拡張は既存テーブルのみ参照）。

## 画面構成（2タブ）

| タブ | 月の定義 | 主な用途 |
|------|----------|----------|
| **資源CD俯瞰** | `ProductionScheduleOrderSupplement.plannedEndDate` の暦月 | 単月の資源CD別 必要/能力/超過・サジェスト |
| **機種別月次負荷** | **有効納期** = `COALESCE(ProductionScheduleRowNote.dueDate, supplement.plannedEndDate)` の暦月 | 機種（MH/SH の `FHINMEI`）→ 部品 → 月×資源CD の積み上げ |

**重要**: 両タブで「月」の意味が異なる。混同すると集計が合わない。

## 機種別月次負荷 — 仕様（実装正本）

### 集計対象

- **winner 行**（`buildMaxProductNoWinnerCondition`）
- **未完了**（`ProductionScheduleProgress.isCompleted = false` または未設定）
- **FKOJUNST 一覧可視性**（既存ポリシー SQL）
- **品番** `FHINCD` が `MH%` / `SH%` **以外**（部品工程のみ）
- **資源CD** 非空・切断工程除外（資源カテゴリ設定）
- **有効納期** が指定期間内（`fromMonth`〜`toMonth`  inclusive、最大 **12 か月**）

### 機種名

- 製番ごとに MH/SH 行の **`FHINMEI`** を `resolveSeibanMachineDisplayNamesBatched` で解決
- 未登録は **`機種名未登録`**

### API 応答と UI 挙動

- `GET /kiosk/production-schedule/load-balancing/machine-monthly-load`
  - Query: `fromMonth`, `toMonth`, 任意 `targetDeviceScopeKey`, `machineName`, `fhincd`
  - 常に **`machines[]`**（期間内の機種サマリ）を返す
  - `machineName` 指定時のみ **`parts[]`**, **`resourceMonths[]`**, **`partRows[]`**
- **部品絞り込み（`fhincd`）**: グラフ・月×資源明細・工程行のみ絞る。**部品一覧は機種全体を維持**（行クリック後も他品番を選び直せる）

### 実装レイヤ（境界）

| 層 | ファイル |
|----|----------|
| ルート | `apps/api/src/routes/kiosk/production-schedule/load-balancing.ts` |
| SQL 取得 | `machine-monthly-load-query.service.ts` |
| 機種名付与・月キー | `machine-monthly-load.service.ts` |
| DTO 組み立て | `machine-monthly-load-assembler.ts` |
| 月範囲 | `year-month-range.ts` |
| Web タブ | `LoadBalancingMachineMonthlyTab.tsx` |
| ページシェル | `ProductionScheduleLoadBalancingPage.tsx`（タブ + Mac 代理） |

## Symptoms / 使い方

1. キオスク **負荷調整** を開く
2. **機種別月次負荷** タブ → 開始月・終了月（初期 **当月〜+6か月**）
3. 機種（`FHINMEI`）を選択 → 積み上げ棒（上位24資源）・部品表
4. 部品行クリック → 当該品番に絞り込み（「部品絞り込み解除」で解除）
5. **資源CD俯瞰** タブは従来どおり月1つ・サジェスト計算

Mac device-scope v2: **`targetDeviceScopeKey` 必須**（未指定 400）。

## Production deploy（実績 2026-05-26 · 機種別月次）

- **ブランチ**: `feat/kiosk-load-balancing-machine-monthly-view`
- **代表コミット**: **`60b94b9d`** `feat(kiosk): add machine monthly load view`
- **CI（機能）**: GitHub Actions **`26434510513`**（push 時）
- **ホスト順（`--limit` 1台ずつ）**: Pi5 → Pi4×4。**Pi3 対象外**

| ホスト | Detach Run ID | PLAY RECAP |
|--------|---------------|------------|
| `raspberrypi5` | `20260526-151127-15681` | `ok=134` `changed=4` `failed=0` |
| `raspberrypi4` | `20260526-155923-28871` | `ok=122` `changed=11` `failed=0` |
| `raspi4-robodrill01` | `20260526-160414-3113` | `ok=122` `changed=10` `failed=0` |
| `raspi4-fjv60-80` | `20260526-160801-21722` | `ok=122` `changed=10` `failed=0` |
| `raspi4-kensaku-stonebase01` | `20260526-161142-6365` | `ok=129` `changed=11` `failed=0` |

**標準コマンド**:

```bash
export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"
./scripts/update-all-clients.sh feat/kiosk-load-balancing-machine-monthly-view infrastructure/ansible/inventory.yml --limit <host> --detach --follow
```

## 実機検証（2026-05-26）

### 自動

- `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（Pi5+Pi4 デプロイ後・約 **28s**）
- **注意**: 本スクリプトは **`machine-monthly-load` を直接叩かない**（負荷調整専用 curl は手動スモーク推奨）

### 手動スモーク（Pi5 · Tailscale `100.106.158.2`）

```bash
KEY="client-key-raspberrypi4-kiosk1"
BASE="https://100.106.158.2"

# 俯瞰（回帰）
curl -sk "${BASE}/api/kiosk/production-schedule/load-balancing/overview?month=2026-05" \
  -H "x-client-key: ${KEY}"

# 機種別月次
curl -sk "${BASE}/api/kiosk/production-schedule/load-balancing/machine-monthly-load?fromMonth=2026-05&toMonth=2026-10" \
  -H "x-client-key: ${KEY}"
```

**実績（2026-05-26）**: `overview` **200** / `machine-monthly-load` **200**（`machines` 約74件・`months` 6）/ `suggestions` POST **200**。

**Web**: `docker-web-1` バンドル `/srv/site/assets/index-*.js` に **`機種別月次負荷`** 文字列を確認。Pi5 HEAD **`60b94b9d`**。

### 現場目視（推奨チェックリスト）

- [ ] Pi4 キオスクで **機種別月次負荷** タブ表示
- [ ] 機種選択後グラフ・部品表・明細表
- [ ] 部品行クリック → 絞り込み → 解除
- [ ] **資源CD俯瞰** タブ・サジェストが従来どおり動作

## Troubleshooting

| 症状 | 確認・対処 |
|------|------------|
| `overview` / `machine-monthly-load` が **401/403** | `x-client-key` と端末登録 |
| Mac 代理で **400** | `targetDeviceScopeKey` 未指定（device-scope v2） |
| **月範囲エラー 400** | `fromMonth` > `toMonth`、または **12か月超** |
| **機種一覧は出るがグラフが空** | 機種未選択（仕様）。または期間内に有効納期付き未完了行なし |
| **部品絞り込み後、部品表が1行だけ** | **2026-05-26 以前の不具合**。修正後は部品表は機種全体のまま |
| **Pi4 だけ旧UI** | Pi4 未デプロイ or キャッシュ → 該当ホストに `--limit` 再デプロイ、[強制リロード](../guides/verification-checklist.md) §6.6.4 |
| **API 500 が 400 表示** | ルートは入力検証系のみ 400 化。DB/内部エラーは 500 のまま（ログ確認） |
| **ローカル API 全件テスト失敗** | Postgres 未起動 / **`pnpm exec prisma migrate deploy` は `apps/api` で実行**（`scripts/test/run-tests.sh` 参照） |

## Prevention

- 月定義を変える場合は **両タブのドキュメント**（本 KB・[ガイド](../guides/kiosk-production-schedule-load-balancing.md)）を同時更新
- サジェスト条件変更は管理画面の負荷調整設定 + 俯瞰タブで再確認
- デプロイは [deployment.md](../guides/deployment.md) の **`update-all-clients.sh` + `--limit` 1台ずつ** のみ（Pi3 は本機能では除外）

## References

- [運用ガイド: kiosk-production-schedule-load-balancing.md](../guides/kiosk-production-schedule-load-balancing.md)
- [deployment.md §機種別月次 2026-05-26](../guides/deployment.md#kiosk-load-balancing-machine-monthly-view-2026-05-26)
- 初版デプロイ（2026-04-30）: 本ファイル §Production deploy 履歴は [deployment.md §2026-04-30 負荷調整](../guides/deployment.md) 参照
