# KB-333: サイネージ splitCompact24 フッタ欠落修正（Pi3）とキオスク取消ボタン視認性（2026-04-07）

## Context

- **いつ**: 2026-04-07
- **どこ**: Pi3 サイネージの貸出グリッド（`playwright_html` 経路）。キオスク持出一覧の `KioskActiveLoanCard`（取消ボタン）。

## 症状と原因（調査結果）

| 症状 | 原因（CONFIRMED） |
|------|-------------------|
| Pi3 で貸出カードの日時・管理番号が見えない／欠落 | Playwright HTML 生成カードは `overflow:hidden`。カード外寸が詰まりすぎてフッタがクリップされていた（データは API に存在）。 |
| キオスク取消ボタンが暗い背景に溶ける | `Button` の `ghost` 変種が `!text-slate-900` を持ち、`className` の `text-white/90` を打ち消していた。 |

## 仕様（反映内容）

- **サイネージ compact（案 C 相当）**: `loan-card-contracts.ts` で **`COMPACT24_CARD_HEIGHT_PX` = 164**（従来 154）、Playwright compact 用 **`COMPACT24_HTML_CARD_PAD_PX` = 10**、SVG レガシ用 **`COMPACT24_SVG_CARD_PAD_PX` = 12**、compact HTML の **`COMPACT24_HTML_NAME_MARGIN_BOTTOM_PX` = 3**。サムネ **96×96 は維持**。
- **キオスク**: 取消は **`variant="ghostOnDark"`**（暗背景向け白系テキスト）に変更。

## デプロイ（本番・順次）

- **手順**: [deployment.md](../guides/deployment.md) の `update-all-clients.sh`・`export RASPI_SERVER_HOST`・**`--detach --follow`**。対象は **`raspberrypi5` → Pi4 各台 → `raspberrypi3`** を **`--limit` 1 台ずつ**。
- **Pi3**: メモリ制約のため **単独実行・多重 `update-all-clients` 禁止**（ガイド「ラズパイ3（サイネージ）」に従う）。
- **Detach Run ID**（各 **`PLAY RECAP` `failed=0`**）:
  - `raspberrypi5`: `20260407-123124-27600`
  - `raspberrypi4`: `20260407-124039-8718`
  - `raspi4-robodrill01`: `20260407-124454-30820`
  - `raspi4-fjv60-80`: `20260407-124800-7012`
  - `raspi4-kensaku-stonebase01`: `20260407-125236-13960`
  - `raspberrypi3`: `20260407-125547-7409`

## 知見（運用）

- **未追跡ファイル**があると `update-all-clients.sh` が **「未commit変更」で停止**する。**`git stash push -u`** でワーキングツリーをクリーンにしてから再実行（[KB-327](./infrastructure/signage.md#kb-327-貸出グリッド-playwright--signage_loan_grid_engine-とデプロイ環境のずれ) と同型）。
- Pi3 デプロイログで **`signage-lite` が一時 `exit-code`** となり得るが、playbook 後段の **lightdm 復旧・サービス再開**で **`active` まで収束**することが多い（[deployment.md](../guides/deployment.md) Pi3 節・[KB-216](./infrastructure/ansible-deployment.md#kb-216-pi3デプロイ時のpost_tasksでunreachable1が発生するがサービスは正常動作している)）。

## 実機検証（反映直後）

- **自動**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（2026-04-07・Mac / Tailscale）。
- **JPEG**: `GET /api/signage/current-image`（Pi3 `x-client-key`）で **200**（スクリプトに含む）。目視でフッタ日時の可読性を確認。

## References

- ブランチ: `fix/signage-compact24-footer-kiosk-readability`
- 関連: [KB-325](./infrastructure/signage.md#kb-325-split-compact24-loan-cards-pi5-git) · [KB-327](./infrastructure/signage.md#kb-327-貸出グリッド-playwright--signage_loan_grid_engine-とデプロイ環境のずれ) · [KB-332](./KB-332-kiosk-active-loan-card-modern-surface.md)
