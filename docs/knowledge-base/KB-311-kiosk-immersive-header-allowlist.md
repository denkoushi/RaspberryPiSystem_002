---
title: KB-311 キオスク沉浸式レイアウト（右下ヘッダーリビール）の URL allowlist
tags: [キオスク, フロントエンド, KioskLayout, Ansible]
audience: [開発者, 運用者]
last-verified: 2026-07-26
category: knowledge-base
---

# KB-311: キオスク沉浸式レイアウト（右下ヘッダーリビール）の URL allowlist

## Context

`KioskLayout` では、特定ルートのみキオスクナビ（`KioskHeader`）を既定で隠し、**画面右下の24×24px**へマウスを寄せるとヘッダーが**下から上へ**スライド表示する「沉浸式」レイアウトを使う。

- **判定の単一情報源**: [`kioskImmersiveLayoutPolicy.ts`](../../apps/web/src/features/kiosk/kioskImmersiveLayoutPolicy.ts) の `usesKioskImmersiveLayout(pathname)`
- **ホットゾーン幾何**: [`kioskHeaderRevealHotZone.ts`](../../apps/web/src/features/kiosk/kioskHeaderRevealHotZone.ts)（Vitest: [`kioskHeaderRevealHotZone.test.ts`](../../apps/web/src/features/kiosk/kioskHeaderRevealHotZone.test.ts)）
- **フック**: [`useKioskBottomRightHeaderReveal.ts`](../../apps/web/src/hooks/useKioskBottomRightHeaderReveal.ts) → 内部 [`useKioskEdgeHeaderReveal.ts`](../../apps/web/src/hooks/useKioskEdgeHeaderReveal.ts) + [`useTimedHoverReveal.ts`](../../apps/web/src/hooks/useTimedHoverReveal.ts)
- **Chrome（Tailwind プリセット）**: [`kioskImmersiveHeaderChrome.ts`](../../apps/web/src/features/kiosk/kioskImmersiveHeaderChrome.ts)

**履歴**:

| 時期 | 挙動 |
|------|------|
| 〜2026-03-21 | 上端全幅ホバー（`useKioskTopEdgeHeaderReveal`） |
| 2026-05-22〜2026-07-25 | **下端・中央 1/3**・14px 帯（`feat/kiosk-bottom-center-header-reveal`） |
| 2026-07-26 以降（コード正本） | **右下24×24px**（`feat/assembly-auto-id-nfc-invalidation`） |

**持出タブ**（`/kiosk/tag`・`/kiosk/photo`・計測/吊具持出）は下端リビールに統一（2026-05-22 以前は `/kiosk/photo` のみ上辺常時表示）。

**本変更のスコープ外**（OS / ブラウザ UI）:

- Raspberry Pi OS の `wf-panel-pi`（起動時 kill・**Super+Shift+P** で復帰）
- Firefox のタブ／URL バー（`userChrome.css` 上端 hover）— **アプリの `KioskHeader` とは別**

## ヘッダーリビール仕様（Web）

| 項目 | 値 |
|------|-----|
| ホットゾーン高さ | **24px**（右下隅） |
| ホットゾーン幅 | **24px**（`x ∈ [width-24, width]`、`y ∈ [height-24, height]`） |
| 非表示 | `translate-y-full` + **`pointer-events-none`** + **`invisible`**（下辺全域の誤 `mouseenter` 防止） |
| 表示 | `translate-y-0`（下から出る） |
| 開くトリガ | (1) 右下 DOM ホットゾーン `onMouseEnter` (2) `window` `mousemove` で純関数命中時のみ `open()` |
| 閉じる | ヘッダー `mouseleave` 後 **200ms**（`KIOSK_REVEAL_CLOSE_DELAY_MS`） |
| タッチ | 未対応（マウス前提） |
| 視覚ガイド | なし |

**実装メモ（保守）**:

- ヘッダー全幅の `mouseenter` では**開かない**（`useKioskEdgeHeaderReveal`）。開くのはホットゾーン命中時のみ。
- E2E は [`revealKioskHeader`](../../e2e/helpers.ts) が **`(width-2, height-2)`**へ `mouse.move` し、ヘッダーがビューポート内に入るまで `waitForFunction`。

## Symptoms / 運用上の問い

- 新しいキオスク画面を追加したとき、同じヘッダー挙動にしたいが、どこを直せばよいか分からない。
- なぜ `/kiosk/production-schedule` だけ完全一致で、子パスは別扱いなのか。
- 手動順番の下ペイン（右端スライダーホバー）とナビが競合しないか → **右下24×24pxだけ**がホットゾーン。
- Pi5 で新 UI・Pi4 だけ旧 UI（上端リビール・ナビ常時表示）に見える。

## Decision / Fix（コミット系列）

| コミット | 内容 |
|---------|------|
| `175243ac` | 上端全幅 → 下端中央 1/3・`useKioskTopEdgeHeaderReveal` 削除 |
| `b6424984` | 非表示ヘッダーに `pointer-events-none`（下辺左右でもナビが出ない） |
| `8a5369e1` | Pi4: `kiosk-launch.sh` の `_appRef=<git HEAD>`・Firefox `user.js` キャッシュ無効・`cache2` 削除 |
| `74bc7f50` | KB: Pi4 SPA キャッシュ事象の追記 |
| `e9a860e1` | `/kiosk/photo` を沉浸式 allowlist に追加 |
| `cbeb6bbc` | E2E: `revealKioskHeader` **後**にナビ可視性 assert（CI 回帰修正） |
| 2026-07-26 実装 | DOM・純関数・E2Eを右下24×24pxへ統一し、中央1/3の反応を廃止 |

### 対象（true）

| 種別 | パス |
|------|------|
| 完全一致（末尾 `/` 正規化後） | `/kiosk/tag`, `/kiosk/photo`, `/kiosk/instruments/borrow`, `/kiosk/rigging/borrow`, `/kiosk/production-schedule`, `/kiosk/documents`（要領書 PDF・[KB-313](./KB-313-kiosk-documents.md)） |
| `startsWith` | `KIOSK_MANUAL_ORDER_PATH_PREFIX`（手動順番）, `/kiosk/production-schedule/progress-overview`, `/kiosk/production-schedule/load-balancing`, `/kiosk/part-measurement`（部品測定）, `/kiosk/mobile-placement`, `/kiosk/purchase-order-lookup`, `/kiosk/assembly`, `/kiosk/pallet-visualization`（[KB-355](./api.md)） |

定数 **`KIOSK_BORROW_IMMERSIVE_PATH_EXACT`** に持出系 4 パスを集約（`e9a860e1`）。

### 除外例（false）

- `/kiosk/call`, `/kiosk/production-schedule/due-management`, `/kiosk/production-schedule/other`

## Prevention

- ルートを増やすときは **ポリシー＋Vitest**（[`kioskImmersiveLayoutPolicy.test.ts`](../../apps/web/src/features/kiosk/kioskImmersiveLayoutPolicy.test.ts)）を同時更新。
- 手動順番のパス接頭辞は [`kioskManualOrderRoutes.ts`](../../apps/web/src/features/kiosk/manualOrder/kioskManualOrderRoutes.ts) の `KIOSK_MANUAL_ORDER_PATH_PREFIX` を import して DRY に保つ。
- ホットゾーン形状を変えるときは **純関数＋Vitest** を先に更新し、`KioskLayout` は [`kioskImmersiveHeaderChrome.ts`](../../apps/web/src/features/kiosk/kioskImmersiveHeaderChrome.ts) 経由のみ触る。
- Pi4 へ Web 差分を届けるときは **Pi5 デプロイ + Pi4 キオスクロール**（`_appRef` 付き URL 再起動）。Pi5 のみでは Pi4 Firefox の旧バンドルが残り得る。

## デプロイ・実機検証

### 本番反映（2026-05-22・Pi5 + キオスク Pi4 全4台）

- **ブランチ**: `feat/kiosk-bottom-center-header-reveal`（マージ代表 **`cbeb6bbc`**）
- **標準**: [deployment.md §下端リビール](../archive/deployments/2026-05.md#kiosk-bottom-center-header-reveal-2026-05-22)
- **`export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`** · `update-all-clients.sh feat/kiosk-bottom-center-header-reveal infrastructure/ansible/inventory.yml --limit <host> --detach --follow`（**1 台ずつ**）

| ホスト | Detach Run ID | PLAY RECAP |
|--------|---------------|------------|
| `raspberrypi5` | `20260522-101951-717` | ok=134 changed=4 failed=0 |
| `raspi4-kensaku-stonebase01` | `20260522-102453-31642` | ok=129 changed=10 failed=0 |
| `raspberrypi4` | `20260522-103026-4234` | ok=124 changed=13 failed=0 |
| `raspi4-robodrill01` | `20260522-103521-10989` | ok=124 changed=12 failed=0 |
| `raspi4-fjv60-80` | `20260522-103915-8240` | ok=124 changed=12 failed=0 |

- **Pi3**: 対象外（`no hosts matched`）
- **Phase12**: `verify-phase12-real.sh` **43/0/0**
- **CI**: `26262397906` success（E2E 修正後。初回 `26261933696` は `kiosk.spec.ts` が沉浸式前に assert で失敗）
- **実機 UI**: StoneBase01 **OK**（下端中央リビール・`/kiosk/photo` 沉浸式）。他 3 台は同チェックリストで spot 確認推奨。

### 2026-07-26以降の実機 UI チェックリスト

1. 画面中央・右辺上部・下辺の右下以外にマウス → ナビが**出ない**
2. 右下24×24px → ナビが**下から**スライド表示
3. `/kiosk/photo` 等の沉浸式ルートでも (1)(2) と同様
4. `/kiosk/production-schedule/due-management` → ヘッダー**常時表示**（沉浸式 OFF）

2026-05-22の本番反映記録にある「下端中央1/3」は当時の履歴であり、現行コードの受入基準ではない。

### 過去のデプロイ記録

- **2026-03-21**: `feat/kiosk-immersive-layout-manual-order-row`（当時は上端リビール）— [KB-297 沉浸式拡張節](./KB-297-kiosk-due-management-workflow.md#kiosk-immersive-allowlist-manual-order-row-2026-03-21)
- **2026-04-22**: `/kiosk/pallet-visualization` allowlist 追補（`feat/kiosk-pallet-visualization-ui`）

## Troubleshooting

### 沉浸式にならない / 想定外の画面で隠れる

- `normalizeKioskPathname` の末尾 `/` と、`IMMERSIVE_PATH_EXACT` vs `startsWith` を確認（`/kiosk/production-schedule` は **子パスを含まない** 完全一致）。

### 下辺全域でナビが出る（回帰）

- 非表示ヘッダーに `pointer-events-none` + `invisible` が付いているか（`b6424984`）。欠けると透明ヘッダーが下辺全域で `mouseenter` を拾う。

### ナビが出ない（仕様どおりの可能性）

- 下辺中央や右辺上部では開かない。**右下24×24px**を確認。

### Pi5/Mac は新 UI・Pi4 だけ旧挙動

- SPA は **Pi5 配信**。Pi4 Firefox が `?clientKey=` 固定 URL で旧バンドルを保持し得る。
- **対処**: `kiosk-launch.sh` の **`&_appRef=<git HEAD>`**（[`kiosk-launch.sh.j2`](../../infrastructure/ansible/templates/kiosk-launch.sh.j2)）·プロファイル **`cache2` 削除**·[`firefox-user.js.j2`](../../infrastructure/ansible/roles/kiosk/templates/firefox-user.js.j2) の HTTP キャッシュ無効化 → **`kiosk-browser` 再起動**。
- 確認: `pgrep -a firefox` に `_appRef=cbeb6bbc`（例）が付いていること。Pi5 上の repo `git rev-parse --short HEAD` と一致させる。

### Pi5 から Pi4 へ SSH 検証でタイムアウト

- Tailscale IP は [`group_vars/all.yml`](../../infrastructure/ansible/group_vars/all.yml) の **`tailscale_network`** を正本とする（誤 IP 例: `100.101.113.90` 台は **到達不可**）。
- 正例: `raspberrypi4` **`100.74.144.79`** · robodrill **`100.123.1.113`** · fjv **`100.100.229.95`** · stonebase **`100.101.113.95`**。Mac から Pi4 直 SSH は不可のことが多い → **Pi5 踏み台**（[ansible-ssh-architecture.md](../guides/ansible-ssh-architecture.md)）。

### E2E / CI でキオスクナビが不可視

- 沉浸式ではヘッダー既定非表示。**`revealKioskHeader()` の後**に `toBeVisible` する（`cbeb6bbc`）。順序逆だと `hidden` で失敗（CI `kiosk.spec.ts` サイネージモーダルテスト等）。
- ローカル smoke: `CI=true` + Postgres migrate/seed — [KB-025](./ci-cd.md#kb-025-e2eスモークkioskがナビゲーション不可視で失敗する)

### パレット可視化でページ全体が縦スクロール

- `/kiosk/pallet-visualization` が allowlist に無いと `h-dvh` 沉浸式が効かない（2026-04-22 修正・[KB-355](./api.md)）。

### ローカル Web テストで `act(...)` エラー

- シェルに `NODE_ENV=production` が残っていると再現しうる → **`NODE_ENV=test`** で Vitest を実行。

## References

- [`KioskLayout.tsx`](../../apps/web/src/layouts/KioskLayout.tsx)
- [deployment.md §下端リビール](../archive/deployments/2026-05.md#kiosk-bottom-center-header-reveal-2026-05-22)
- [deploy-status-recovery.md §下端リビール](../runbooks/deploy-status-recovery.md)（検証表）
- [KB-297 手動順番・沉浸式（2026-03-21）](./KB-297-kiosk-due-management-workflow.md#kiosk-immersive-allowlist-manual-order-row-2026-03-21)
- PR / ブランチ: `feat/kiosk-bottom-center-header-reveal` · CI **`26262397906`**
