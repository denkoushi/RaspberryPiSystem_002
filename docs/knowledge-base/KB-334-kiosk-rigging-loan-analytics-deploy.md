---
title: KB-334 キオスク「集計」（吊具・持出返却アイテム）デプロイ・実機確認
tags: [キオスク, 吊具, 工具, デプロイ, API, DADS]
audience: [運用者, 開発者]
last-verified: 2026-04-17
category: knowledge-base
---

# KB-334: キオスク「集計」（吊具・持出返却アイテム）

## 仕様（要約）

- **ルート**: `/kiosk/rigging-analytics`（URL は据え置き）。ヘッダナビ表記は **「集計」**。
- **UI**: デジタル庁デザインシステム（DADS）トークン（`@digital-go-jp/design-tokens`）＋ Noto Sans JP / Mono。画面内で **吊具** と **持出返却アイテム** をタブ切替（同一 ViewModel で表・グラフを共通化）。
- **API（吊具）**: `GET /api/rigging-gears/loan-analytics`（`x-client-key` または JWT の `allowView`）。`cancelledAt` 非 null の Loan は集計から除外。
- **API（写真持出・表示名タブ）**: `GET /api/tools/items/loan-analytics`（認可は吊具 analytics と同系）。**対象 Loan**: **`photoUrl` あり**・`itemId` / `riggingGearId` / `measuringInstrumentId` がすべて NULL・`cancelledAt` NULL・**`photoToolGallerySeed = false`**（教師シード除外）。**表示名キー**: `NULLIF(TRIM(人レビュー名))` が無ければ `NULLIF(TRIM(VLM名))`、どちらも無ければ **「撮影mode」**（キオスク持出一覧の `resolvePhotoLoanToolDisplayLabel` と同順位）。**NFC Item マスタ連携の貸出は含めない**（別タブ用のため別契約が必要）。
- **UI（2026-04-14）**: **対象月**は `input type="month"` ではなく **`KioskMonthPickerModal`**（年ドロップダウン＋前年/翌年＋1〜12月・`variant="analytics"`）。**資産フィルタ**はタブごとに **単一選択**（未選択=全件）。クエリ: 吊具 `riggingGearId`（uuid）・写真持出 `itemId`（`pt-` + 24hex）・計測機器 `measuringInstrumentId`（uuid）。**API**: `GET /api/rigging-gears/loan-analytics`、`GET /api/tools/items/loan-analytics`、`GET /api/measuring-instruments/loan-analytics` の各クエリに optional 追加（Zod）。月変更時はフロントで資産選択をリセットし、404 時は選択解除にフォールバック。
- **月次集計**: 既定タイムゾーン `Asia/Tokyo` 暦月（クエリで上書き可）。**マイグレーション**: 本集計は **既存 `Loan` 列のみ**（追加マイグレなし）。
- **（2026-04-15）4パネル UI・当日イベント**: キオスク `/kiosk/rigging-analytics` は **4パネル**（社員別バー・資産別持出頻度・返却率・利用表）＋ **「当日の持出返却状況」** ペイン。集計期間は **`KioskMonthPickerModal` の `月` / `1日`**（`variant="analytics"`）。**当日ペイン**は選択期間とは別に **当日（Asia/Tokyo）の 0:00〜24:00** を別クエリで取得（右下のみ当日）。**API**: 3系統 `loan-analytics` 応答に **`periodEvents`**（`LoanAnalyticsPeriodEventRow`・持出/返却・`eventAt`・`assetId` / `assetLabel`・actor）を追加。**CI**: Web イメージの Alpine で `musl` / OpenSSL 等を `apk upgrade`（Trivy 対策・`infrastructure/docker/Dockerfile.web`）。
- **（2026-04-17）BI ダッシュボード再設計**: `UsageTablePanel` を廃止し、**KPI ストリップ + Top N 2枚 + 返却率 + 当日イベント** の **2x2 固定ビュー**へ再構成。表示用ロジックは `analyticsDisplayPolicy.ts` に分離し、**「画面からはみ出さない」「スクロール不要」「ひと目で把握」**を優先。1440x900 基準で縦横ともノンスクロールを確認。
- **（2026-04-17）UI バランス調整（`feat/kiosk-analytics-ui-balance-refine`）**: ページ側のレイアウト責務整理、パネル共通フレームでカード外寸・余白統一、ランキングの **Top N / 全件** トグルとカード内スクロール、KPI 帯のブレークポイント別列数・タイポ調整。表示モードは `analyticsDisplayPolicy` の **`uiDisplayMode`** で分離。

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

期待: **FAIL 0**（環境により WARN はあり得る）。`items/loan-analytics` は Phase12 未収録のため **追加スモーク推奨**（下記）。

## 追加スモーク（推奨）

```bash
curl -sk "https://<server>/api/rigging-gears/loan-analytics" -H "x-client-key: <client-key>" | head -c 400
curl -sk "https://<server>/api/tools/items/loan-analytics" -H "x-client-key: <client-key>" | head -c 400
```

- **期待（吊具）**: `summary` / `byGear`（または相当）/ `byEmployee`
- **期待（写真持出タブ）**: `summary` / `byItem`（`itemCode` は空文字・`name` が表示名・`itemId` は `pt-` 接頭辞の安定ハッシュ）/ `byEmployee`

## 本番実績

### 2026-04-17（UI バランス調整・`feat/kiosk-analytics-ui-balance-refine`・`f5e58e2e`・Pi5→Pi4×4 順次・Pi3 除外）

- **差分**: `KioskRiggingAnalyticsPage` のシェル整理、`KioskAnalyticsPanels` / `KioskAnalyticsKpiStrip` のレスポンシブ行・枠線統一、ランキング密度トグル、`analyticsDisplayPolicy` の `uiDisplayMode` 拡張とテスト。
- **デプロイ**: [deployment.md](../guides/deployment.md)・`export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh feat/kiosk-analytics-ui-balance-refine infrastructure/ansible/inventory.yml --limit <host> --detach --follow` を **1 台ずつ**（**`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`**）。**Pi3**: 対象外。
- **Detach Run ID**（ログ接頭辞 `ansible-update-`）: `20260417-220620-25346` → `20260417-221119-9068` → `20260417-221607-22959` → `20260417-221948-32509` → `20260417-222428-19933`、各 **`failed=0` / `unreachable=0` / exit `0`**。
- **Phase12**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **53s**）。
- **CI**: GitHub Actions Run **`24564671757`** success（デプロイ前確認）。
- **トラブルシュート**: 複数 `--detach` を **別ターミナルで重ねない**（Mac 側 `logs/.update-all-clients.local.lock`）。直列は **`&&`** で連結。
- **`main` マージ**: [PR #161](https://github.com/denkoushi/RaspberryPiSystem_002/pull/161)。

### 2026-04-17（BI ダッシュボード再設計・`feat/kiosk-analytics-bi-dashboard`・`9eda66b4`・Pi5 のみ）

- **差分**: `KioskAnalyticsKpiStrip` 新設、`KioskAnalyticsPanels` を BI 向けに再編、`KioskRiggingAnalyticsPage` を **2x2 グリッド + overflow-hidden** 化、`analyticsDisplayPolicy.ts` / `analyticsDisplayPolicy.test.ts` で表示専用ポリシーを分離。静的プレビューは `docs/design-previews/kiosk-analytics-bi-dashboard-preview.html`。
- **デプロイ**: [deployment.md](../guides/deployment.md)・`export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh feat/kiosk-analytics-bi-dashboard infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`。**Pi3**: 対象外（本変更は Pi5 Web / API のみ）。
- **Detach Run ID**（ログ接頭辞 `ansible-update-`）: `20260417-203348-20065`、**`failed=0` / `unreachable=0` / exit `0`**。
- **Phase12**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **101s**）。
- **API スモーク**: `GET /api/rigging-gears/loan-analytics`、`GET /api/tools/items/loan-analytics`、`GET /api/measuring-instruments/loan-analytics` はいずれも **200**。
- **Health**: `GET /api/system/health` はデプロイ直後に memory **96.4%** で一時 **`degraded`** を返したが、短時間の warm-up 後に **`ok`** へ復帰。
- **画面確認**: IDE 内蔵ブラウザは Pi5 Tailscale URL に到達できなかったため、Mac 側 Playwright で `https://100.106.158.2/kiosk/rigging-analytics` を 1440x900 で表示。**`scrollHeight == clientHeight == 900`**、**`scrollWidth == clientWidth == 1440`**、KPI / Top 8 / 当日イベント文言を確認し、スクリーンショットを取得してレイアウト崩れがないことを確認。

### 2026-04-15（4パネル・当日イベント・`periodEvents`・`feat/kiosk-analytics-four-panel-today-events`・`323dd9f0`・Pi5→Pi4×4 順次・Pi3 除外）

- **差分**: Web `KioskAnalyticsPanels` / `kiosk-loan-analytics/{period,view-model}`・`KioskRiggingAnalyticsPage` 再構成；API 3系統に `periodEvents`；`Dockerfile.web` で `musl` / `openssl` / `libcrypto3` / `libssl3` / `zlib` 等を更新（Trivy）。
- **デプロイ**: [deployment.md](../guides/deployment.md)・`export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh feat/kiosk-analytics-four-panel-today-events infrastructure/ansible/inventory.yml --limit <host> --detach --follow` を **1 台ずつ**（**`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`**）。**事前**: 未追跡プレビュー HTML 等で fail-fast → **`git stash push -u`**。
- **Detach Run ID**（ログ接頭辞 `ansible-update-`）: `20260415-162422-11542` → `20260415-163600-7918` → `20260415-164041-17295` → `20260415-164408-5423` → `20260415-164824-29880`、各 **`failed=0` / `unreachable=0` / exit `0`**。
- **Phase12**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **27s**・Mac / Tailscale）。
- **Pi3**: 対象外（キオスク/API 変更のため Pi3 専用手順は未実施）。
- **残作業（手動）**: 各 Pi4 で **`/kiosk/rigging-analytics`** を開き、**4パネル**・**対象期間（月/1日）**・**当日ペイン**・タブ別資産フィルタを目視。

### 2026-04-14（月選択モーダル・タブ別資産フィルタ・`feat/kiosk-analytics-month-and-asset-filters`・`8ce1a9da`・Pi5→Pi4×4 順次・Pi3 除外）

- **差分**: Web `KioskMonthPickerModal`・`KioskRiggingAnalyticsPage` の月/資産 UI・hooks；API は 3 系統 loan-analytics に対象 ID クエリと repository/service 絞り込み；CI: `KioskMonthPickerModal` の `aria-pressed` / 月ラベルを **string 子**にして Docker ビルド時 **tsc** 通過（`fix(web): satisfy KioskMonthPickerModal button types for CI`）。
- **デプロイ**: [deployment.md](../guides/deployment.md)・`export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh feat/kiosk-analytics-month-and-asset-filters infrastructure/ansible/inventory.yml --limit <host> --detach --follow` を **1 台ずつ**（**`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`**）。**Pi3**: 本変更はキオスク/API のため **対象外**（Pi3 専用の単独・軽量手順は不要）。
- **Detach Run ID**（ログ接頭辞 `ansible-update-`）: `20260414-211347-29532` → `20260414-212701-15420` → `20260414-213153-7546` → `20260414-213547-9533` → `20260414-214120-20816`、各 **`failed=0` / `unreachable=0` / exit `0`**。
- **Phase12**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **57s**・Mac / Tailscale）。
- **残作業（手動）**: 各 Pi4 で **`/kiosk/rigging-analytics`** を開き、**対象月**ボタン・**吊具/表示名/計測機器**ドロップダウン・タブ切替で状態が期待どおりか目視。

### 2026-04-09（写真持出 VLM/人レビュー表示名集計・`main` `3a722c8d`・Pi5 のみ）

- **差分**: `fix(analytics): aggregate kiosk item tab from photo VLM/human labels`（API リポジトリ集計ロジック差し替え・共有型コメント・キオスク表タブ文言）。
- **対象ホスト**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）
- **Detach Run ID**: `20260409-222053-14442`
- **結果**: `PLAY RECAP` **`failed=0` / `unreachable=0`**、リモート **exit `0`**（所要約 **16 分**）
- **Phase12**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **110s**・Mac / Tailscale）
- **API スモーク**: `GET /api/tools/items/loan-analytics` + kiosk `x-client-key` → **HTTP 200**

### 2026-04-09（DADS・持出返却アイテムタブ・ViewModel 反映・Pi5 のみ・NFC Item 集計時代）

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
| アイテム（写真）タブが 0 件・想定と違う | **対象は写真持出 Loan のみ**。NFC `itemId` 付き貸出・`photoToolGallerySeed`・取消済みは **含まない**。VLM 未推論・人レビュー無しは **表示名「撮影mode」** にまとまる。 |
| 表示名の粒度が細かすぎる | VLM が類似工具で別文字列を返すと **別行になる**。運用では人レビュー確定や [KB-319](./KB-319-photo-loan-vlm-tool-label.md) の正規化方針を参照。 |
| UI が古い（ナビが「吊具 状況」のまま等） | Pi5 の `web` 未更新、またはブラウザキャッシュ。Pi5 デプロイ後に **強制再読み込み**。 |
| CI で `Build web image for Trivy image scan` が落ちる（`KioskMonthPickerModal` の `children` / `aria-pressed`） | 月グリッドの表示を **`{`${m}月`}`** のように **単一文字列**にし、`aria-pressed` は **`Boolean(...)`** で `null` を排除（2026-04-14 修正）。 |
| IDE 内蔵ブラウザで Pi5 キオスク URL を開けない | IDE と Mac でネットワーク到達性が異なることがある。**Mac 側から Tailscale URL に到達できるなら Playwright で本番 URL を開き、スクリーンショットと `scrollHeight/clientHeight` を採る**と画面崩れ・スクロール有無の確認を代替できる（2026-04-17）。 |

## References

- [deployment.md](../guides/deployment.md)（`--limit`・`--detach --follow`・Pi5 のみ判断）
- 実装（参考）: `apps/web/src/pages/kiosk/KioskRiggingAnalyticsPage.tsx`、`apps/web/src/components/kiosk/KioskHeader.tsx`、`apps/api/src/routes/tools/items/loan-analytics.ts`、`apps/api/src/services/tools/item-loan-analytics.repository.ts`、`packages/shared-types/src/tools/item-loan-analytics.ts`
