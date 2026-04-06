# KB-332: キオスク持出一覧カードのモダン面（サイネージ loan chrome 系）と本番順次デプロイ（2026-04-06）

## Context

- **いつ**: 2026-04-06
- **どこ**: キオスク持出一覧（`KioskActiveLoanCard`・`/kiosk/tag` 右ペイン等）。**Pi5 API + 各 Pi4 キオスク**へ順次反映。**Pi3 は今回スコープ外**（キオスク持出 UI のロールアウト範囲に含めない判断）。

## 仕様（概要）

- **見た目**: サイネージ貸出カードの chrome（グラデ・影・シーン層）に寄せた **面トークン**をキオスクでも利用。
- **契約**: 表示用トークンは `packages/shared-types` の `loan-card-visual-palette.ts`（`resolveLoanCardHtmlAppearance`・`resolveKioskLoanCardSurfaceTokens` 等）。API 側は必要に応じて既存 import 互換の再エクスポート（`apps/api/.../loan-card-palette.ts`）。
- **Web**: `apps/web/src/components/kiosk/KioskActiveLoanCard.tsx`（sheen レイヤー）、`apps/web/src/features/kiosk/activeLoanListLines.ts`（`KioskActiveLoanCardKind` と shared-types の整合）。

## デプロイ（本番）

- **手順**: [deployment.md](../guides/deployment.md) の `update-all-clients.sh`、`export RASPI_SERVER_HOST`（**`--status` でも必須**）、**`raspberrypi5` → 各 Pi4** を **`--limit` 1 台ずつ**（**Pi3 除外**）。
- **Detach Run ID**（各完走想定・`failed=0`）:
  - `raspberrypi5`: `20260406-202755-5373`
  - `raspberrypi4`: `20260406-204456-23147`
  - `raspi4-robodrill01`: `20260406-205042-16240`
  - `raspi4-fjv60-80`: `20260406-205516-24112`
  - `raspi4-kensaku-stonebase01`: `20260406-210059-14394`

## 実機検証（反映直後）

- **API**: `GET https://<Pi5>/api/system/health` → **200**・`status: ok`（メモリ WARN 文言は既存パターンあり得る）。
- **Pi4（Pi5 hop SSH）**: 次の片側コマンドを **そのまま**実行する（`BASE='ssh …'` のように分割すると **`command not found: ssh`** になり得る）。

```bash
ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new denkon5sd02@100.106.158.2 \
  'ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new tools03@100.74.144.79 \
  "systemctl is-active kiosk-browser.service status-agent.timer"'
```

- 対象 Pi4 例: `tools03@100.74.144.79`、`tools04@100.123.1.113`、`raspi4-fjv60-80@100.100.229.95`、`raspi4-kensaku-stonebase01@100.101.113.95`。期待値: いずれも **`active` / `active`**。

## トラブルシューティング

| 症状 | 想定原因 | 対処 |
|------|----------|------|
| `command not found: ssh`（多段 SSH 確認時） | 外側シェルが `ssh` をコマンドとして解釈できていない（途中展開・変数代入ミス） | **Pi5 宛て 1 行の `ssh '…内側 ssh…'`** に戻す（本 KB の例どおり） |
| `Another update-all-clients.sh process is already running` | Mac 側ローカルロック | `logs/.update-all-clients.local.lock` の所有プロセスを確認し、**1 本のデプロイが完了してから**再実行 |
| `RASPI_SERVER_HOST is required` | デタッチ／`--status` 時の必須変数未設定 | [KB-238](./infrastructure/ansible-deployment.md#kb-238-update-all-clientsshでraspberrypi5対象時にraspi_server_host必須チェックを追加) |

## References

- ブランチ: `feat/kiosk-loan-card-modern-surface`
- 関連: [KB-323](./KB-323-kiosk-return-card-button-layout.md)（`KioskActiveLoanCard` 分離） / [KB-314](./KB-314-kiosk-loan-card-display-labels.md)（表記） / [KB-331](./infrastructure/signage.md#kb-331-signage-loan-grid-html-modern-chrome-stonebase-only)（サイネージ側モダン外皮・デプロイ正本の切り分け）
- [deployment.md](../guides/deployment.md) / [verification-checklist.md](../guides/verification-checklist.md) §6.6.4
