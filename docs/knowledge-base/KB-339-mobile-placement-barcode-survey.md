# KB-339: 配膳スマホ版 V1 — 現場バーコードの意味確定（調査ゲート）

最終更新: 2026-04-24（**V26 購買照会バーコード即時確定**）・2026-04-24（**V25 パレット可視化・カード単体スクロール**）・2026-04-24（**V24 追記・Android 実機フィードバック**）・2026-04-23（**V24 バーコード readerOptions／一次元コア**）・2026-04-20（**V23**）・2026-04-18（**V22**）・2026-04-13（**V21**・V20・V18 追記）

## V26（2026-04-24）購買照会バーコード即時確定・`KIOSK_STANDARD_BARCODE_SCAN_SESSION` 共通化 {#v26-purchase-order-barcode-instant-2026-04-24}

- **背景**: `PurchaseOrderLookupPage` のみ `BarcodeScanModal` に **`stabilityConfig`**（2 連続一致・600ms 窓）を付与しており、`readerOptions` を速くしても **確定ゲートで体感が相殺**され得た。配膳トップ・パレット可視化は **未指定（即時確定）**。
- **仕様（Web のみ）**: 購買照会から **`stabilityConfig` を削除**。`readerOptions` と `idleTimeoutMs` は **`KIOSK_STANDARD_BARCODE_SCAN_SESSION`** に集約し、`MobilePlacementPage`・`KioskMobilePalletVisualizationPage`・`PalletVizEmbeddedPanel`・`KioskPalletVisualizationPage`・`PurchaseOrderLookupPage` で **`{...KIOSK_STANDARD_BARCODE_SCAN_SESSION}`** を共有。**形式プリセット**は画面ごと（購買は引き続き **`BARCODE_FORMAT_PRESET_PURCHASE_ORDER`**）。**API/DB**: 変更なし。`usePurchaseOrderLookup` は **10 桁へ正規化**したうえで API を呼ぶ（満たさない場合は照会しない）。
- **実装の先端**: ブランチ **`fix/kiosk-purchase-order-barcode-instant`**・代表 **`4bc2698f`**（新規 `kioskStandardBarcodeScanSession.ts`）。
- **デプロイ（本番・最小）**: [deployment.md](../guides/deployment.md)・`export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh fix/kiosk-purchase-order-barcode-instant infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`。**Detach Run ID**（`ansible-update-`）: **`20260424-102338-6782`**（**`failed=0` / `unreachable=0` / exit `0`**・所要約 **約 410s**）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **96s**）。
- **知見・トラブルシュート**:
  - **体感がまだ遅い**: **キャッシュ**や Pi5 `web` の **ビルド反映**を確認。Android では **スーパーリロード**。
  - **誤読が増えた**: ラベル・距離・照明。**必要なら**購買のみ `stabilityConfig` を戻す（`BarcodeScanModal` の任意 prop・`barcodeReadStability.ts` は維持）。
  - **Pi5 だけで足りるか**: `/kiosk/...` を Pi5 から配信する運用なら **他ホストの Ansible は不要**（過去の Web のみ変更と同趣旨）。

## V25（2026-04-24）配膳スマホ パレット可視化・テンキー固定とカード一覧スクロール {#v25-mobile-pallet-viz-card-only-scroll-2026-04-24}

- **目的**: `/kiosk/mobile-placement/pallet-viz` で **カードが多いときに一覧だけ**を縦スクロールし、**テンキー・操作行は常に表示**する（現場要望）。
- **実装（Web のみ）**: ページを **`flex flex-col`** に分割。**テンキー**・**`PalletVizActionRow`** は **`shrink-0`**。エラー文（`localError` / `mutationError` / `boardQuery.isError`）は **一覧の上**に `shrink-0` で配置。一覧は **`relative flex min-h-0 flex-1 flex-col overflow-hidden`** 内の **`PalletVizItemList`**（既存の `min-h-0 flex-1 overflow-y-auto`）が **スクロールコンテナ**になるよう **親を flex 化**（以前は一覧の親が `relative min-h-0` のみで **`flex-1` が効かず**一体スクロールに近い挙動）。
- **API/DB**: 変更なし。
- **デプロイ（本番・最小）**: [deployment.md](../guides/deployment.md)・`export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh feat/mobile-pallet-viz-scroll-layout infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`。**Pi3 は対象外**（本画面は Pi5 `web` 配信の `/kiosk/...`）。**Detach Run ID**（`ansible-update-`）: **`20260424-093828-22068`**（**`failed=0` / `unreachable=0`**・exit **`0`**）。
- **実装の先端**: レイアウト **`c6a7e655`** に加え、E2E 安定化 **`b292a5db`**（`e2e/mobile-pallet-viz-scroll-investigation.spec.ts` の CDP タッチは **カード上のみ**—Linux CI でテンキー上 CDP が不安定だったため）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **61s**）。
- **回帰テスト**: `e2e/mobile-pallet-viz-scroll-investigation.spec.ts`（一覧ルートの `scrollHeight > clientHeight`・`scrollBy`・必要に応じマウスホイール）。
- **知見・トラブルシュート**:
  - **「まだテンキーまで動く」**: ブラウザが **古いバンドル**をキャッシュ。**強制再読み込み**または Pi5 `web` 再デプロイの有無を確認。
  - **一覧だけ動かない**: `PalletVizItemList` の親が **flex 子で `flex-1 min-h-0`** になっているか、DevTools で **`scrollHeight` と `clientHeight`** を比較。
  - **ページ全体が少し動く／テンキーでバウンスする**: 親チェーンの **`wheel` / `touchmove` リスナ**（`passive: false`）と一覧の **`touch-action: pan-y`** を確認（`KioskMobilePalletVisualizationPage.tsx`・`PalletVizItemList.tsx`）。
  - **デプロイだけ Pi5 で足りるか**: スマホ・Pi4 キオスクが **`https://<Pi5>/kiosk/...`** を読む運用なら **Pi5 の `web` 更新で足りる**（過去の Web のみ変更と同趣旨）。

## V24（2026-04-23）バーコード `readerOptions` 集約・一次元コア形式 {#v24-barcode-reader-tuning-2026-04-23}

- **目的**: `@zxing/library` 連続デコードの **再試行間隔**（`timeBetweenScansMillis` / `timeBetweenDecodingAttempts`）を `apps/web/src/features/barcode-scan/readerOptionPresets.ts` に集約し、**画面別に一貫して調整**できるようにする。配膳・パレット可視化・部品測定等は **`BARCODE_READER_OPTIONS_KIOSK_DEFAULT`（220/120ms）** と **`BARCODE_FORMAT_PRESET_ONE_DIMENSIONAL_CORE`** で **探索空間を削減**。要領書 `/kiosk/documents` は **広域一次元（`ONE_DIMENSIONAL`）**のまま、**`BARCODE_READER_OPTIONS_KIOSK_CONSERVATIVE`（400/200ms）**で Pi4 同時負荷を抑える。**当時の購買照会**は **`PURCHASE_ORDER` + `stabilityConfig`**（**2026-04-24 の V26 で撤去**—[§V26](#v26-purchase-order-barcode-instant-2026-04-24)）。
- **デプロイ（本番）**: ブランチ **`feat/kiosk-barcode-reader-tuning`**・代表 **`70cb9e09`**。[deployment.md](../guides/deployment.md)・`export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh feat/kiosk-barcode-reader-tuning infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**Web のみ・Pi5 のみ**。Pi3 専用手順不要）。**Detach Run ID**: `20260423-211624-9136`（**`failed=0` / `unreachable=0`**）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **52s**）。
- **知見・トラブルシュート**: 形式を広げるとデコード負荷が上がる。未認識は **照明・距離**を先に確認。遅延と CPU は **要領書＝保守的間引き**、業務スキャン＝**コア形式 + やや積極的間引き**で切り分け（[KB-313](./KB-313-kiosk-documents.md) バーコード節）。
- **実機（Android Chrome・2026-04-24 追記）**: `/kiosk/mobile-placement` の **製造order**（移動票一次元）と、購買照会 `/kiosk/purchase-order-lookup` の **注番**（**10 桁 `FKOBAINO`** 一次元）の **両方**で、反映後（`feat/kiosk-barcode-reader-tuning`・`main`）に **一次元の読取体感が速くなった**との場内確認。配膳は上記 **コア一次元＋`KIOSK_DEFAULT`**。注番は **`BARCODE_FORMAT_PRESET_PURCHASE_ORDER` + 同 `readerOptions` + ―当時― `stabilityConfig`（2 連続一致）**（[KB-297 §FKOBAINO](./KB-297-kiosk-due-management-workflow.md#fkobaino-purchase-order-lookup-from-gmail-csv-2026-04-20)）。**2026-04-24 以降**は注番も **即時確定**（[§V26](#v26-purchase-order-barcode-instant-2026-04-24)）。体感は端末・ラベル品質で変動する。

## V23（2026-04-20）モバイル注文入力スキャン専用・棚チップグリッド {#v23-scan-only-shelf-chip-2026-04-20}

- **目的**: スマホキオスクで **ソフトキーボードからの誤入力**を抑え、**バーコードスキャンを正**とする（[ADR-20260418](../decisions/ADR-20260418-mobile-placement-android-browser-shell.md) の Chrome 継続方針と整合）。
- **実装（Web のみ）**: 購買照会 **`/kiosk/purchase-order-lookup`** の注文番号・配膳 **`/kiosk/mobile-placement`** メイン下半の **製造order** を **`readOnly` + `inputMode="none"`**。`usePurchaseOrderLookup` の手入力 debounce を除去。**棚番候補チップ**は `mobilePlacementKioskTheme` で **`grid-cols-3 sm:grid-cols-4`**・縦積み可変高。**API/DB 契約不変**。
- **デプロイ**: [deployment.md](../guides/deployment.md)・`export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh feat/scan-only-order-inputs-and-shelf-chip-mobile infrastructure/ansible/inventory.yml --limit <host> --detach --follow` を **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-kensaku-stonebase01`** の順に **1 台ずつ**（**`raspi4-fjv60-80`** は到達不能時 **未デプロイ**可・**Pi3 は対象外**）。
- **Detach Run ID**（ログ接頭辞 `ansible-update-`）: `20260420-211100-899` → `20260420-211743-28526` → `20260420-212322-14477` → `20260420-213004-29970`、各 **`failed=0` / `unreachable=0`**。代表コミット **`423e32bb`**。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 42 / WARN 1 / FAIL 0**（**WARN**: `raspi4-fjv60-80` の Pi5 経由 SSH・ベースライン同型）。
- **知見**: **`raspi4-fjv60-80` プレフライト失敗**のあと Pi5 に **`runPid: null` の stale `.update-all-clients.lock`** が残り、**次の `--limit` でリモートロック取得不能**になり得る → [deploy-status-recovery.md](../runbooks/deploy-status-recovery.md) §5.2（本記録では runId **`20260420-212814-6231`** を削除後に `raspi4-kensaku-stonebase01` を再実行）。
- **残作業（手動）**: 実機で **注文番号・製造orderがスキャンのみ**になっていること、**棚チップの折り返し**を目視。

## V22（2026-04-18）キオスク高視認テーマ・静的プレビュー整合

- **目的**: `/kiosk/mobile-placement` 系の **コントラスト・文言・レイアウト**を [mobile-placement-main-page-detail-preview.html](../design-previews/mobile-placement-main-page-detail-preview.html) に寄せ、現場の視認性を上げる（[整合メモ](../plans/mobile-placement-main-page-preview-parity.md)）。
- **実装（Web のみ）**: `mobilePlacementKioskTheme.ts` 集約、`MobilePlacementRegisterShelfPanel` / `RegisterOrderPanel` / `MobilePlacementVerifySection` 等の分割。**API/DB 契約不変**。
- **デプロイ**: [deployment.md](../guides/deployment.md)・`export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh feature/mobile-placement-contrast-refactor infrastructure/ansible/inventory.yml --limit <host> --detach --follow` を **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`** の順に **1 台ずつ**（**Pi3 は対象外**）。
- **Detach Run ID**（ログ接頭辞 `ansible-update-`）: `20260418-111058-3228` → `20260418-111559-19394` → `20260418-112049-24881` → `20260418-112437-2591` → `20260418-113342-26169`、各 **`failed=0` / `unreachable=0`**・**`Summary success check: true`**。実装コミット **`2d2528ec`**（ブランチ **`feature/mobile-placement-contrast-refactor`**）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **47s**・Mac / Tailscale）。
- **知見**: 本変更は **Pi5 の `web` 配信 + Pi4 キオスク**が取り込めば足りる。**Pi3 サイネージは不要**（`/kiosk` は Pi5 由来）。
- **残作業（手動）**: Android で **メイン画面の視認性**・**照合/登録ブロック**を目視。

## V18（2026-04-13）棚マスタ

- **目的**: トップの「登録済み棚番」候補を **`OrderPlacementEvent` 履歴依存**から **`MobilePlacementShelf` 正本**へ切り替える。`+` の棚番登録画面は **`POST /api/mobile-placement/shelves`** で永続化する。
- **DB**: `MobilePlacementShelf`（`shelfCodeRaw` unique・`createdByClientDeviceId` 任意）。マイグレーションで既存 **`OrderPlacementEvent` の distinct `shelfCodeRaw`** を棚マスタへ **1 回だけ**取り込み（衝突は無視）。
- **API**: `GET /api/mobile-placement/registered-shelves` は棚マスタ一覧。`POST /api/mobile-placement/shelves` は **`西-北-01` 形式のみ**・重複は **409**（`MOBILE_PLACEMENT_SHELF_DUPLICATE`）。
- **Web**: `GET registered-shelves` で空き／使用済みスロットを導出し、登録済み番号は選択不可。

### 本番反映・検証（2026-04-13・V18 棚マスタ）

- **デプロイ**: [deployment.md](../guides/deployment.md)・`export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh feature/mobile-placement-shelf-master infrastructure/ansible/inventory.yml --limit <host> --detach --follow` を **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`** の順に **1 台ずつ**（**Pi3 は対象外**）。
- **Detach Run ID**（ログ接頭辞 `ansible-update-`）: `20260413-124042-32510`（`raspberrypi5`）→ `20260413-125217-7318`（`raspberrypi4`）→ `20260413-125648-60`（`raspi4-robodrill01`）→ `20260413-130037-12380`（`raspi4-fjv60-80`）→ `20260413-130456-12201`（`raspi4-kensaku-stonebase01`）、各 **`failed=0` / `unreachable=0`**・**`Summary success check: true`**。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **25s**・Mac / Tailscale）。
- **知見**: Pi5 初回は **Docker 再ビルド**（API のマイグレーション・`MobilePlacementShelf`）で **所要が長め**（`--follow` が長く見えることがある）。**トラブルシュート**: `registered-shelves` が **`{ "shelves": [] }`** → マスタ 0 件は仕様上あり得る（マイグレーションで履歴からの取り込み後も、新規は **`+` → `POST …/shelves`**）。重複登録は **409**（`MOBILE_PLACEMENT_SHELF_DUPLICATE`）。

## Context

配膳スマホで **アイテム／現物のバーコード**を読み取り、既存の `Item` または生産スケジュール行と突き合わせる前に、**ラベル上のコードが何を表すか**を固定する必要がある。

## Symptoms

- スキャン値は取れるが、マスタやスケジュールと一致しない
- 同一現物で複数ラベル（製番・品番・社内コード）があり、どれを正とするか不明

## Investigation

現場で **3〜5 件**について次を記録する。

1. **スキャン文字列**（そのまま。前後空白は除去してもよい）
2. **同じ現物に貼られた別ラベル**があればその値も
3. 管理画面または CSV 上の **`Item.itemCode`**（工具マスタ）
4. 生産スケジュール行の **`ProductNo` / `FSEIBAN` / `FHINCD`**（当該行が分かる場合）

### 判定（CONFIRMED の例）

- スキャン値が **`Item.itemCode` と一致**（大文字小文字のみ差）  
  → **V1 の主キーは itemCode として実装する**

- スキャン値が **`FHINCD` や `ProductNo` と一致**し、`Item` に無い  
  → **Item 側に itemCode を揃えるか、別テーブルでコード変換が必要**（V1 では手運用またはマスタ整備を優先）

## Root cause

バーコードが **どのマスタキーをエンコードしているか**が運用定義されていないと、自動突合が成立しない。

## Fix（最小）

1. 上記サンプルでパターンを CONFIRMED にする。
2. CONFIRMED になったキーを、API `resolve-item` と `register` の突合ロジックに反映する（コード側コメントに根拠を残す）。

## Prevention

- 新ラベル導入時は **サンプル1件＋ KB 追記**
- ラベル印刷システムと **`Item.itemCode` の単一ソース**を揃える

## 本番反映・検証（2026-04-10）

- **デプロイ**: [deployment.md](../guides/deployment.md) に従い **`raspberrypi5` → Pi4 キオスク 4 台**を **`--limit` 1 台ずつ**・`--foreground`（**Pi3 は対象外**）。実装ベースコミット **`8e1d0e3f`**（`main`）。
- **自動回帰**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**。
- **突合の正本（コード）**: `csvDashboardRowId` 付き `register` は、スキャン値が行の **`ProductNo` / `FSEIBAN` / `FHINCD`** のいずれかと一致するか、**解決された `Item.itemCode` がそのいずれかと一致**すること。**欠陥対策**: 以前は「スキャンで解決した `itemCode` が行のどのフィールドとも違っても、別工具の `itemCode` とスキャンが一致すれば通過」し得たため、`Item.itemCode` 側の一致は **行キーとの一致**に限定した（`MOBILE_PLACEMENT_SCHEDULE_MISMATCH`）。

## V2（部品配膳・移動票/現品票照合）

- **UI**: `/kiosk/mobile-placement` 単一画面。上半分は移動票の **製造order + FHINBAN/FHINCD（1次元）**、現品票は **製造order（印字／画像OCR／手入力）+ 任意の製番 FSEIBAN + 部品（FHINBAN 等・1次元）** と **OK/NG**。下半分は仮棚（TEMP-A〜D または QR）+ 製造orderスキャン + **登録**（`OrderPlacementEvent`。**`Item` は更新しない**）。
- **API**: `POST /api/mobile-placement/verify-slip-match`・`POST /api/mobile-placement/register-order-placement`・`POST /api/mobile-placement/parse-actual-slip-image`（[api/mobile-placement.md](../api/mobile-placement.md)）。
- **照合**: 移動票は **ProductNo** で行解決。現品票は **ProductNo が空でなければ ProductNo**、**空なら FSEIBAN** で行解決。スキャンした **FHINBAN/FHINCD** が行の **`FHINCD`** と一致したうえで、両票の **`FSEIBAN` + `FHINCD`** ペアが一致するか判定。
- **現品票画像 OCR**: `tesseract.js`（`services/ocr` の `ImageOcrPort`）。**V12（2026-04-12・実装 `genpyo-slip/`）**: 前処理後画像を **ROI（正規化座標）で切り出し**、領域ごとに OCR → **`genpyo-slip-resolver`** で製造order（ヘッダ優先・欠落時は下段）と製番を集約。**V7〜V11 時代**は **3 パス直列・labels 早期終了**だったが、V12 で **Schema/ROI パイプラインに全面置換**（履歴は下記各節）。API 応答の **`ocrPreviewSafe`** は確定フィールド由来。テストは `IMAGE_OCR_STUB_TEXT` でスタブ可能（各 ROI に同一テキストが返る）。印字から **製造order（10桁）** / **FSEIBAN** を抽出する際、**V10/V11** の桁補正・注文行除外・global-filter は **ROI 内テキスト**に対して従来どおり適用。

### 本番反映・検証（2026-04-11）

- **デプロイ**: [deployment.md](../guides/deployment.md) に従い **`raspberrypi5` → Pi4 キオスク 4 台**を **`--limit` 1 台ずつ**・ブランチ **`feat/mobile-placement-order-based-flow`**・`--foreground`（**Pi3 は対象外**）。実装ベースコミット **`da613487`**（**`main` へ PR マージ**）。
- **自動回帰**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**。
- **DB**: `OrderPlacementEvent`（マイグレーション `20260411120000_add_order_placement_event`）。

### 本番反映・検証（2026-04-11・V5 現品票画像 OCR）

- **デプロイ**: [deployment.md](../guides/deployment.md) に従い **`raspberrypi5` → Pi4 キオスク 4 台**を **`--limit` 1 台ずつ**・ブランチ **`feat/mobile-placement-actual-slip-image-ocr`**・**`--detach --follow`**（**Pi3 は対象外**）。実装ベースコミット **`f7342dd3`**（**`main` へマージして本番ドキュメントと同期**）。
- **Detach Run ID（ログ接頭辞 `ansible-update-`）**: `20260411-183841-16996`（`raspberrypi5`）→ `…184924-28557`（`raspberrypi4`）→ `…185416-11344`（`raspi4-robodrill01`）→ `…185819-3299`（`raspi4-fjv60-80`）→ `…190608-28569`（`raspi4-kensaku-stonebase01`）、各 **`failed=0` / `unreachable=0`**。
- **自動回帰**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **55s**）。
- **知見**: **同一 Pi5 へ `update-all-clients.sh` を並列起動しない**（[deployment.md](../guides/deployment.md)）。OCR は **初回ワーカ起動**で遅延し得る。

### 本番反映・検証（2026-04-11・V6 現品票 OCR 可観測性・UI）

- **デプロイ**: [deployment.md](../guides/deployment.md) に従い **`raspberrypi5` → Pi4 キオスク 4 台**を **`--limit` 1 台ずつ**・ブランチ **`feat/mobile-placement-ocr-debug-fix`**・**`--detach --follow`**（**Pi3 は対象外**）。実装ベースコミット **`e6806d28`**。
- **Detach Run ID（ログ接頭辞 `ansible-update-`）**: `20260411-200637-30031`（`raspberrypi5`）→ `20260411-201900-24559`（`raspberrypi4`）→ `20260411-202426-10094`（`raspi4-robodrill01`）→ `20260411-202844-23208`（`raspi4-fjv60-80`）→ `20260411-203518-31439`（`raspi4-kensaku-stonebase01`）、各 **`failed=0` / `unreachable=0`**。
- **自動回帰**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **85s**）。
- **仕様**: 撮影 OCR 後に **成功／候補なし／エラー**を UI 表示。API は **`parse-actual-slip-image` 完了ログ**で後追い（OCR 全文は出さない）。パーサは **桁間空白・O/0 等の限定補正**と **注文番号ブロックのみの 10 桁は採用しない**ガード。

### 本番反映・検証（2026-04-11・V7 現品票 OCR 用途別パイプライン）

- **デプロイ**: [deployment.md](../guides/deployment.md) に従い **`raspberrypi5` → Pi4 キオスク 4 台**を **`--limit` 1 台ずつ**・ブランチ **`feat/mobile-placement-ocr-pipeline-hardening`**・**`--detach --follow`**（**Pi3 は対象外**）。実装ベースコミット **`8c1cc13d`**（**`main` へ PR マージ**）。
- **Detach Run ID（ログ接頭辞 `ansible-update-`）**: `20260411-211922-10561`（`raspberrypi5`）→ `20260411-212830-9591`（`raspberrypi4`）→ `20260411-213306-11155`（`raspi4-robodrill01`）→ `20260411-213638-10529`（`raspi4-fjv60-80`）→ `20260411-214942-8793`（`raspi4-kensaku-stonebase01`）、各 **`failed=0` / `unreachable=0`**。
- **自動回帰**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **50s**）。
- **知見**: **3 パス直列**のため **単一 OCR 時より遅くなり得る**（初回ワーカ起動も重畳）。UI は **`ocrPreviewSafe`** でプレビューのノイズを抑制。構造化ログに **`preprocessBytesBinary`**（二値化後バイト長）あり。

### 本番反映・検証（2026-04-11・V8 製造order抽出パーサ・診断ログ）

- **デプロイ**: [deployment.md](../guides/deployment.md) に従い **`raspberrypi5` → Pi4 キオスク 4 台**を **`--limit` 1 台ずつ**・ブランチ **`fix/mobile-placement-ocr-manufacturing-order-parser`**・**`--detach --follow`**（**Pi3 は対象外**）。実装ベースコミット **`a9e75cd8`**（**`main` へ PR マージ**）。
- **Detach Run ID（ログ接頭辞 `ansible-update-`）**: `20260411-223115-29480`（`raspberrypi5`）→ `20260411-224346-24116`（`raspberrypi4`）→ `20260411-224823-19592`（`raspi4-robodrill01`）→ `20260411-225152-29858`（`raspi4-fjv60-80`）→ `20260411-225741-29730`（`raspi4-kensaku-stonebase01`）、各 **`failed=0` / `unreachable=0`**。
- **自動回帰**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **98s**）。
- **仕様**: `actual-slip-identifier-parser` が **製造オーダラベルの空白分断**（例: `製造 オー ダ`）を許容し、**注文番号ブロック近傍の誤除外**で製造orderが null になるケースを減らす。`parse-actual-slip-image` 完了ログに **`mo10Candidate10Count` / `mo10AfterOrderBlockFilterCount` / `mo10ParseSource`** を追加（OCR 全文はログに出さない）。
- **知見・トラブルシュート**: 旧パーサでは **「製造オーダ」連続表記と一致しないラベル行**が注文番号行と同時に読めたとき、**製造ラベル未検出**となり **global-filter 経路で注文番号の10桁を除外**して **製造orderが null** になることがあった。**切り分け**: Pi5 API の `parse-actual-slip-image ocr completed` で **`mo10ParseSource`** を確認（`none` かつ候補ありは要再撮影・パーサ追従検討）。

### 本番反映・検証（2026-04-12・V9 labels 早期終了・成功時プレビュー抑制）

- **デプロイ**: [deployment.md](../guides/deployment.md) に従い **`raspberrypi5` → Pi4 キオスク 4 台**を **`--limit` 1 台ずつ**・ブランチ **`feat/mobile-placement-ocr-preview-and-early-exit`**・**`--detach --follow`**（**Pi3 は対象外**）。実装ベースコミット **`c6aa2ee5`**。
- **Detach Run ID（ログ接頭辞 `ansible-update-`）**: `20260412-085956-22755`（`raspberrypi5`）→ `20260412-091508-16092`（`raspberrypi4`）→ `20260412-092057-26505`（`raspi4-robodrill01`）→ `20260412-092542-10876`（`raspi4-fjv60-80`）→ `20260412-093134-32374`（`raspi4-kensaku-stonebase01`）、各 **`failed=0` / `unreachable=0`**。
- **自動回帰**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **98s**）。
- **仕様**: **`jpn+eng`（labels）パス**のテキストだけで **製造order10 + FSEIBAN** が揃えば **早期 return**（追加パス・二値化前処理をスキップ）。ログは従来どおり（早期終了時は **`preprocessBytesBinary` なし**）。キオスク UI は **成功時**に **`OCR:`** の raw プレビュー行を出さない。
- **知見**: 読みやすいラベルでは **後段 OCR を省略**でき、Pi5 CPU 負荷と待ち時間を抑えられる。切り分けで **`preprocessBytesBinary` が無い完了ログ**が出たら早期終了経路を疑う。

### 本番反映・検証（2026-04-12・V10 製造order 先頭 `O`/`0` 誤認のラベル近傍補正）

- **実装**: `apps/api/src/services/mobile-placement/actual-slip-identifier-parser.ts` — 製造ラベル直後・行スキャンで **10文字トークン**を `[0-9OoIl|]` まで許容し、`normalizeLooseDigitToken`（`O→0` / `I|l|→1`）後に **10桁数字**か判定。正規化で確定できない場合は **line-scan / global-filter** にフォールバック。コミット **`c09ebc8a`**（`main`）。
- **仕様（要点）**: OCR が **`0002178005` を `OOO2178OO5` のように読んだ**場合でも、**製造orderラベル付近**なら **製造order（10桁）**として復元しやすくする（**注文番号行の誤採用抑制**は V8 以降のまま）。
- **初回デプロイ試行（2026-04-12）**: [deployment.md](../guides/deployment.md) の **`update-all-clients.sh`**・`export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`。**結果**: **失敗** — Pi5 上の `git` が **`Please move or remove them before you merge. Aborting`** で **`Updating 8e1d0e3f..c09ebc8a`** を中止。ログに **`apps/web/src/features/mobile-placement/...`** 等のパスが列挙された（**未整理の作業ツリー／未追跡**がマージと衝突）。**Detach Run ID（試行）**: **`20260412-102516-4172`**。
- **トラブルシュート（実施）**: Pi5 で **`cd /opt/RaspberryPiSystem_002 && git status`** を確認したところ、mobile-placement 関連ファイルと migration が残存し、対象ディレクトリの所有者が **`root:root`** だった。**対処**: `apps/api/src/routes/mobile-placement`・`apps/api/src/services/mobile-placement`・`apps/web/src/features/mobile-placement`・`apps/api/prisma/migrations/20260411120000_add_order_placement_event` を **`chown -R denkon5sd02:denkon5sd02`** → **`git stash push -u`**。さらに **Mac 側の古い `--follow` プロセス**による **local lock** と、Pi5 の **stale remote lock**（`runPid` 不在・`tail -f` だけ残存）を死活確認後に解放した。
- **本番デプロイ（成功・2026-04-12）**: [deployment.md](../guides/deployment.md) に従い **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`** を **`--limit` 1 台ずつ**・**`--detach --follow`**。**Detach Run ID**: `20260412-104606-29623` → `20260412-105905-22423` → `20260412-110542-32610` → `20260412-111033-18779` → `20260412-111904-8812`、各 **`Summary success check: true`**・`PLAY RECAP` **`failed=0` / `unreachable=0`**。**Pi3 は本機能の必須対象外**。
- **自動回帰（本番反映後）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **98s**）。
- **実機検証**: 自動回帰は完了。**Android 手動確認**は [mobile-placement-smartphone.md](../runbooks/mobile-placement-smartphone.md) の手順で継続（V10 の **`O`→`0` 補正** と、V9 の **成功時 `OCR:` 非表示** を目視）。

### 本番反映・検証（2026-04-12・V11 注文番号+枝番行除外・global-filter 選別）

- **実装**: `apps/api/src/services/mobile-placement/actual-slip-identifier-parser.ts` — 同一行に **注文番号**（`注\s*文\s*番\s*号`）と **枝番**（`枝\s*番`）がある行に含まれる 10 桁は製造order候補から除外。**注文番号のみ**の行の誤採用抑制は **同一行判定**（前行の注文番号で次行の製造orderを除外しない）。**global-filter** は先頭 `\d{10}` ではなく、注文行直後・製造ラベル近傍スコアで候補を選ぶ。
- **仕様（要点）**: 現品票の **注文番号行末尾に枝番**がある運用に合わせ、注文番号の 10 桁（誤認含む）を製造orderにしない。診断キー `mo10ParseSource` / `mo10Candidate10Count` / `mo10AfterOrderBlockFilterCount` は従来どおり。
- **本番**: V12 の **ROI 内テキスト**に対しても同じルールが適用される（`genpyo-slip` 集約後の文字列へ）。

### 本番反映・検証（2026-04-12・V12 現品票 ROI・Schema 集約 `genpyo-slip`）

- **実装**: `apps/api/src/services/mobile-placement/actual-slip-image-ocr.service.ts` — 共通前処理後、`genpyo-slip/genpyo-slip-template.ts` の **既定 ROI** で `sharp` 切り出し → 各領域 `ImageOcrPort`（`actualSlipLabels`）。集約は `genpyo-slip/genpyo-slip-resolver.ts`。製造order・製番の文字列ルールは `genpyo-slip/genpyo-mo-extract.ts` / `genpyo-fseiban-extract.ts`（公開 API 互換のため `actual-slip-identifier-parser.ts` は再エクスポート）。
- **仕様（要点）**: **紙帳票の一般的レイアウト**を前提に、**撮影全体を1本の全文パースに載せない**。ログに **`mo10ResolvedFromRoi`**（`moHeader` / `moFooter`）を追加。**二値化パス**と **`preprocessBytesBinary`** は本パイプラインでは廃止。
- **運用**: レイアウトが異なる帳票では ROI ズレで欠損し得る → 将来 **テンプレート差し替え**または幾何補正の拡張が必要になり得る。
- **本番デプロイ（2026-04-12）**: ブランチ **`feat/genpyo-slip-schema-roi`**・コミット **`1e034057`**。[deployment.md](../guides/deployment.md) に従い **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`** を **`--limit` 1 台ずつ**・**`--detach --follow`**。**Detach Run ID**（ログ接頭辞 `ansible-update-`）: `20260412-142159-22500` → `20260412-143647-5719` → `20260412-144237-23679` → `20260412-144730-23697` → `20260412-145643-23971`、各 **`Summary success check: true`**・`PLAY RECAP` **`failed=0`**。**Pi3 は本機能の必須対象外**。
- **自動回帰（本番反映後）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **103s**）。
- **実機検証**: 自動回帰は完了。**Android 手動確認**は [mobile-placement-smartphone.md](../runbooks/mobile-placement-smartphone.md) で **ROI ズレ時の撮影角度**（正面・全体が枠内）を継続確認。

### 本番反映・検証（2026-04-12・V13 棚番登録 UI レイアウト）

- **実装**: `apps/web/src/pages/kiosk/KioskMobileShelfRegisterPage.tsx`・`apps/web/src/features/mobile-placement/components/shelf-register/*`（ヘッダ・エリア/列 3 択・番号グリッド）。**API 変更なし**。
- **仕様（要点）**: ルート **`/kiosk/mobile-placement/shelf-register`** は従来どおり。**プレビュー文字列**は `formatShelfCodeRaw`（例 **`西-北-02`**）。**静的プレビュー**: [mobile-placement-shelf-register-layout-preview.html](../design-previews/mobile-placement-shelf-register-layout-preview.html)。
- **本番デプロイ（2026-04-12）**: ブランチ **`feat/kiosk-shelf-register-layout`**・コミット **`fbcca8ada3d93fb489dcdcd7b3ac6f497166ee51`**（短縮 **`fbcca8ad`**）。[deployment.md](../guides/deployment.md) に従い **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`** を **`--limit` 1 台ずつ**・**`--detach --follow`**。**Detach Run ID**（ログ接頭辞 `ansible-update-`）: `20260412-162015-11134` → `20260412-162729-5630` → `20260412-163310-3759` → `20260412-163742-9462` → `20260412-164944-23223`、各 **`failed=0`**。**Pi3 は対象外**（本機能は `/kiosk` SPA・Pi5 配信が正）。
- **自動回帰**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **109s**）。
- **トラブルシュート**: デプロイは **未コミット/未プッシュ**を `update-all-clients.sh` が拒否する（[deployment.md](../guides/deployment.md)）。**並列起動禁止**（同一 `RASPI_SERVER_HOST`）。

### V14（2026-04-12・製造order配下の分配枝・現在棚）

- **目的**: 同一製造orderに **複数の分配**（画面上は **分配1・分配2…**／DB は `branchNo` 1 始まり）があり、**棚の移動**と **新たな分配の追加**を UI で明示分岐する。
- **データ**: **履歴**は従来どおり `OrderPlacementEvent` に追記。列 **`branchNo`**・**`actionType`**（`CREATE_BRANCH` / `MOVE_BRANCH` / 導入前は `LEGACY`）を追加。**現在棚**は `OrderPlacementBranchState`（キー: `manufacturingOrderBarcodeRaw` + `branchNo`）。マイグレーション `20260412120000_order_placement_branch_state` で、既存履歴は **LEGACY・branch 1** とし、各製造orderの **最新イベント**から `OrderPlacementBranchState` を 1 件投影。
- **API**: `GET /api/mobile-placement/order-placement-branches?manufacturingOrder=…`・`POST /api/mobile-placement/register-order-placement`（**新規分配枝のみ**）・`PATCH /api/mobile-placement/order-placement-branches/:id/move`（**既存枝の棚更新**）。契約は [api/mobile-placement.md](../api/mobile-placement.md)。
- **Web**: `/kiosk/mobile-placement` 下半で **「新規分配を追加」／「既存分配を移動」** を選択。製造order入力後に **分配一覧**または **次に作成される分配番号**を表示。
- **本番デプロイ（2026-04-12）**: ブランチ **`feat/mobile-placement-order-branches`**・コミット **`72255bc7`**。[deployment.md](../guides/deployment.md) に従い **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`** を **`--limit` 1 台ずつ**・**`--detach --follow`**（**Pi3 は対象外**）。**Detach Run ID**（ログ接頭辞 `ansible-update-`）: `20260412-181344-4740` → `20260412-182622-13897` → `20260412-183213-6611` → `20260412-183659-23626` → `20260412-184407-12516`、各 **`Summary success check: true`**・`PLAY RECAP` **`failed=0`**。Pi5 デプロイで **Prisma `migrate deploy`** が実行され `OrderPlacementBranchState` が適用される。
- **自動回帰**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **104s**・Mac / Tailscale）。
- **トラブルシュート**: Pi5 で **`git merge` 中止**（未コミット/権限）→ [deployment.md](../guides/deployment.md)・V10 節の **ワークツリー復旧**と同型。**並列起動禁止**（同一 `RASPI_SERVER_HOST`）。

### V15（2026-04-12・照合折りたたみ・登録レイアウト・API 変更なし）

- **目的**: 上半の照合 UI を **既定で閉じ**て下半（棚・製造order・分配）を広く使いやすくする。登録エリアは **製造order＋スキャン**の下に **新規／既存／登録**を **1 行**にまとめ、**重なり・余白**を [静的プレビュー](../design-previews/mobile-placement-verify-collapsible-preview.html) に沿って整理する。
- **実装**: `MobilePlacementVerifySection`・`MobilePlacementVerifyExpandedPanel`・`mobile-placement-verify-section.types.ts`・`MobilePlacementRegisterSection`（[Runbook](../runbooks/mobile-placement-smartphone.md) §0 の V15 節に詳細）。
- **本番デプロイ（2026-04-12）**: ブランチ **`feat/mobile-placement-verify-collapsible-register-layout`**・コミット **`ba49160d`**。[deployment.md](../guides/deployment.md) に従い **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`** を **`--limit` 1 台ずつ**・**`--detach --follow`**（**Pi3 は対象外**）。**Detach Run ID**（ログ接頭辞 `ansible-update-`）: `20260412-193820-22310` → `20260412-194534-25173` → `20260412-195118-15218` → `20260412-195555-16494` → `20260412-200127-28015`、各 **`failed=0` / `unreachable=0`**。
- **自動回帰**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **102s**・Mac / Tailscale）。
- **知見**: **Web のみ**のため Pi3 デプロイは不要（`/kiosk` のバンドルは Pi5 `web`）。**a11y**: 折りたたみ中も **`id="mp-verify-expanded-panel"`** を **`hidden`** で保持し **`aria-controls`** と参照整合。
- **トラブルシュート**: デプロイ拒否は **未 push / 未コミット**（[deployment.md](../guides/deployment.md)）。**並列 `update-all-clients.sh` 禁止**（同一 Pi5 ロック）。

### V16（2026-04-12・部品名検索・現在棚優先 + スケジュール補助 + 同義語）

- **目的**: 口頭照会で **部品名（FHINMEI 等）から**、**いまどの棚にいるか**／**スケジュール上の候補**を素早く辿る。
- **API**: `GET /api/mobile-placement/part-search/suggest`（`q`・`x-client-key` 必須）。**現在棚**は `OrderPlacementBranchState` + `scheduleSnapshot` を優先。**補助**に `CsvDashboardRow`（当該ダッシュボード winner）。**既に現在棚に紐づく行 ID** はスケジュール候補から除外。表記ゆれは **`@raspi-system/part-search-core`**（`packages/part-search-core`）でトークン内 OR 展開。**空白区切りは AND**（キオスクの探す画面は `scheduleCandidates` を一覧に使わない想定）。
- **Web**: `/kiosk/mobile-placement/part-search`（五十音・A–Z・プリセット。親画面からの導線あり）。
- **本番デプロイ（2026-04-12）**: ブランチ **`feat/mobile-placement-part-name-search`**・コミット **`62721227`**。[deployment.md](../guides/deployment.md) に従い **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`** を **`--limit` 1 台ずつ**・**`--detach --follow`**（**Pi3 は対象外**）。**Detach Run ID**: Mac 側 `logs/` 未コミット。**各ホスト** `Summary success check: true`・`failed=0` で完了。必要なら Pi5 `/opt/RaspberryPiSystem_002/logs/ansible-update-*` から接頭辞を抽出。
- **自動回帰**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **110s**）。**スポット**: `curl` で `part-search/suggest` が JSON（`aliasMatchedBy` 等）を返すこと。
- **知見**: Pi5 初回デプロイは **イメージ再ビルドで長時間**になり、`--follow` が待ちに見えることがある。**`failed=0` が最終判定**。
- **トラブルシュート**: **401** → `heartbeat` と `x-client-key`。**候補が常に空** → データが無い・クエリが短すぎる。**同義語追加** → `packages/part-search-core` の `aliases.ts` と `packages/part-search-core/src/__tests__/aliases.test.ts`。

### V17（2026-04-13・部品検索最終: AND トークングループ・登録済みのみ・剪定 UI・`part-search-core` 集約 + CI/Docker）

- **目的**: キーワードを **空白区切りで AND**（グループ内は OR・同義語は **`@raspi-system/part-search-core`**）。キオスクは **登録済みヒットのみ**表示・**文字パレットはヒットが無くなったら非表示**・剪定ロジックを **`partSearchPalettePruner`** に分離。API の別名ファイルは廃止し **共有パッケージ**へ。**CI / `Dockerfile.api` / `Dockerfile.web`** で **`part-search-core` を先に `pnpm build`**（`Cannot find module '@raspi-system/part-search-core'` 回避）。
- **本番デプロイ（2026-04-13）**: ブランチ **`feature/mobile-placement-part-search-final`**・先端コミット **`4d34f5fa`**。[deployment.md](../guides/deployment.md) に従い **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`** を **`--limit` 1 台ずつ**・**`--detach --follow`**（**Pi3 は対象外**）。**Detach Run ID**（ログ接頭辞 `ansible-update-`）: `20260413-100158-12333` → `20260413-101643-3896` → `20260413-102109-32432` → `20260413-102432-4099` → `20260413-102904-13288`、各 **`Summary success check: true`**・`PLAY RECAP` **`failed=0` / `unreachable=0`**。
- **自動回帰**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **25s**・Mac / Tailscale）。
- **知見**: Pi5 初回は **Docker 再ビルド**（`part-search-core` 取り込み）で **約 14 分**程度かかる場合がある。**`failed=0` が最終判定**。
- **トラブルシュート**: **CI で API が `@raspi-system/part-search-core` を解決できない** → `.github/workflows/ci.yml` で **`packages/part-search-core` を `pnpm build`**、Docker は **`COPY packages/part-search-core`** と **ビルドステージでのビルド順**を確認（本変更で対応済み）。

### V19（2026-04-13・部品検索: 機種名 AND・かな正規化拡張・数字パレット・プリセット追加）

- **目的**: 部品名に加え **登録製番ボタン下段の機種名**で AND 絞り込みし、**ひらがな/カタカナ・拗音・促音**の表記ゆれを吸収する。キオスクは **部品名・機種名の2入力**、**0–9 数字行**、プリセット語（ナット／サドル／ベース／カラー／ベアリング／モータ 等）を追加。
- **API**: `GET /api/mobile-placement/part-search/suggest` に任意クエリ **`machineName`**（後方互換）。機種名は `seiban-progress` と同系の **MH/SH 行 `FHINMEI` 集約**から `FSEIBAN` 集合を作り、**`q` と AND**。`matchedQuery` は部品名正規化後の `q` と機種名入力を連結した表示用文字列。
- **共有**: `packages/part-search-core` — `normalizePartSearchQuery` 拡張、`partSearchTermVariantsForIlike`（DB のひら/カタ混在向け ILIKE）、`normalizeMachineNameForPartSearch`（機種表示との比較）。実装: `part-search-machine-name-fseibans.service.ts`。
- **Web**: 機種名欄フォーカス時は **パレット剪定を行わない**（ヒット DTO に機種表示名が無いため誤剪定を避ける）。
- **本番デプロイ（2026-04-13）**: ブランチ **`feat/mobile-placement-part-search-machine-filter`**・コミット **`5bfab6c8`**。[deployment.md](../guides/deployment.md) に従い **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`** を **`--limit` 1 台ずつ**・**`--detach --follow`**（**Pi3 は対象外**）。**Detach Run ID**（Pi5 リモート `logs/deploy/` の `ansible-update-*` 接尾辞）: `20260413-143256-27604` → `20260413-144431-6108` → `20260413-144847-8016` → `20260413-145200-25161` → `20260413-145658-5761`、各 **`Summary success check: true`**・`PLAY RECAP` **`failed=0`**。
- **自動回帰**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **24s**・Mac / Tailscale・2026-04-13 実測）。
- **知見**: Pi5 は **`part-search-core` 変更により Docker 再ビルド**（`api` / `web`）が走る。**`failed=0` が最終判定**。
- **トラブルシュート**: **401** → `heartbeat` と `x-client-key`。**`machineName` を付けても常に空** → 日程に **MH/SH 行の `FHINMEI`** が無い・クエリが集約後の機種表示と合わない可能性。**長音**（例: モーター）は正規化で **`モータ` と同一視しない**（仕様どおり）。

### V20（2026-04-13・部品検索: 促音の比較用写像・機種名のみで suggest）

- **目的**: 促音 **`っ` / `ッ`** を **単に除去すると** `ナット` と `ナットホルダー` が **同一トークン化**されてしまうため、**比較用**には **`ツ` へ写像**しつつ、表示・入力の意図を保つ。あわせて **`q` が空でも `machineName` があれば** API/キオスクが **`suggest` を継続**する（V19 では `q` 空で即空配列だった経路を拡張）。
- **共有**: `packages/part-search-core` — **`PART_SEARCH_SOKUON_COMPARABLE_REPLACEMENTS`**（export）。`normalizePartSearchQuery` は従来どおり促音を吸収しつつ、SQL 側は **`part-search-field-comparable-sql.ts`** で **`REPLACE(...)` 連鎖**し **ILIKE** 比較。
- **API**: `part-search.service.ts` — 部品名・型番・機種表示に **comparable 式**。`suggestPartPlacementSearch` — **`q` 空かつ `machineName` あり**の分岐・`matchedQuery` 表示。
- **本番デプロイ（2026-04-13）**: ブランチ **`feat/part-search-sokuon-comparable-and-optional-sides`**・コミット **`8a4c8ffe`**。[deployment.md](../guides/deployment.md) に従い **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`** を **`--limit` 1 台ずつ**・**`--detach --follow`**（**Pi3 は対象外**）。**Detach Run ID**（ログ接頭辞 `ansible-update-`）: `20260413-154338-19890` → `20260413-155401-995` → `20260413-155851-30629` → `20260413-160214-659` → `20260413-160637-3548`、各 **`Summary success check: true`**・`PLAY RECAP` **`failed=0` / `unreachable=0`**。
- **自動回帰**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **23s**・Mac / Tailscale・2026-04-13 実測）。
- **知見**: 促音は **正規化（検索意図）** と **comparable（DB 比較）** を **別レイヤー**で持つ（削除一択をやめる）。統合テストに **`ナット` → `ナットホルダー`** 相当を追加済み。
- **トラブルシュート**: 促音まわりで **ヒットが増えすぎる** → comparable が **`ッ`→`ツ`** のため **同一カナ列上の別単語**とぶつかる可能性を疑い、`q` を足して AND を絞る。**`q` 空・機種名のみで候補が薄い** → `machineName` の **MH/SH 集約**と現場データを確認（V19 と同じ）。

### V21（2026-04-13・部品検索 UI: SOLID 寄りモジュール化・スモークテスト修正）

- **目的**: `/kiosk/mobile-placement/part-search` を **ヘッダツールバー・クエリ入力・結果・UI トークン**に分割し、`useMobilePlacementPartSearch` に **パレット操作（空白・削除・戻る）**を集約。**API/DB 契約は不変**（V20 までの検索・促音・機種名 AND はそのまま）。
- **Web**: `PartSearchHeaderToolbar`・`PartSearchQueryInputs`・`PartSearchResultsSection`・`partSearchUiTokens.ts`・`PartSearchCharPalette`（レイアウト整理）。Vitest: `KioskMobileShelfRegisterPage.smoke.test.tsx` を **`QueryClientProvider`** でラップ（`useQueryClient()` 必須化への追随）。
- **本番デプロイ（2026-04-13）**: ブランチ **`refactor/part-search-solid-modular`**・コミット **`d4467b1a`**。[deployment.md](../guides/deployment.md) に従い **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`** を **`--limit` 1 台ずつ**・**`--detach --follow`**（**Pi3 は対象外**・本変更は `/kiosk` SPA のため Pi3 専用手順は不要）。**Detach Run ID**（ログ接頭辞 `ansible-update-`）: `20260413-175621-27099` → `20260413-180137-22828` → `20260413-180628-4330` → `20260413-181025-11891` → `20260413-181724-25138`、各 **`Summary success check: true`**・`PLAY RECAP` **`failed=0` / `unreachable=0`**。
- **自動回帰**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **50s**・Mac / Tailscale・2026-04-13 実測）。
- **知見**: **同一 Pi5 へ `update-all-clients.sh` を並列起動しない**（[deployment.md](../guides/deployment.md)）。複数台は **1 本のシェルで前段成功後に次段**。
- **トラブルシュート**: Vitest で **`No QueryClient set`** → キオスクページのスモークは **`QueryClientProvider` + `QueryClient({ defaultOptions: { queries: { retry: false } } })`** で包む。**UI が古い** → Pi5 の `web` イメージ更新確認のうえ **キオスクでハードリロード**（Tailscale URLの SPA は Pi5 配信）。

## References

- 実装（工具配置）: `apps/api/src/services/mobile-placement/mobile-placement.service.ts`
- 実装（現品票画像 OCR・V12）: `apps/api/src/services/mobile-placement/actual-slip-image-ocr.service.ts`・`apps/api/src/services/mobile-placement/genpyo-slip/`
- 実装（棚番登録 UI・V13）: `apps/web/src/features/mobile-placement/components/shelf-register/`
- 実装（部品配膳・照合）: `apps/api/src/services/mobile-placement/mobile-placement-slip-match.ts` ほか
- 実装（分配枝・V14）: `apps/api/src/services/mobile-placement/order-placement-branch.service.ts`・`apps/api/src/services/mobile-placement/mobile-placement-order-placement.service.ts`・マイグレーション `20260412120000_order_placement_branch_state`
- 実装（部品名検索・V16）: `apps/api/src/services/mobile-placement/part-search/`（`part-search.service.ts`）＋共有 **`packages/part-search-core`**
- 実装（部品検索最終・V17）: 同上 + `part-search-normalize.ts`（SQL 用 `escapeForIlike` のみ）・キオスク `part-search/*`（`partSearchPalettePruner.ts` 等）・**CI/Docker**（`part-search-core` ビルド）
- 実装（部品検索 V19・機種名 AND）: `part-search-machine-name-fseibans.service.ts`・`part-search.service.ts`（`machineName`）・`part-search-core`（正規化・ILIKE バリアント）
- 実装（部品検索 V20・促音 comparable・機種名のみ suggest）: `part-search-field-comparable-sql.ts`・`part-search.service.ts`・`part-search-core`（`PART_SEARCH_SOKUON_COMPARABLE_REPLACEMENTS`）・`useMobilePlacementPartSearch.ts` / `apps/web/src/api/client.ts`
- 実装（部品検索 V21・UI モジュール化）: `apps/web/src/features/mobile-placement/part-search/PartSearchHeaderToolbar.tsx`・`PartSearchQueryInputs.tsx`・`PartSearchResultsSection.tsx`・`partSearchUiTokens.ts`・`useMobilePlacementPartSearch.ts`・`KioskMobileShelfRegisterPage.smoke.test.tsx`
- Runbook: [mobile-placement-smartphone.md](../runbooks/mobile-placement-smartphone.md)
