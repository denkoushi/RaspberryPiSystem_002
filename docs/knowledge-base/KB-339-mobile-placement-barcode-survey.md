# KB-339: 配膳スマホ版 V1 — 現場バーコードの意味確定（調査ゲート）

最終更新: 2026-04-12（**V16 部品名検索**追記）

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

## References

- 実装（工具配置）: `apps/api/src/services/mobile-placement/mobile-placement.service.ts`
- 実装（現品票画像 OCR・V12）: `apps/api/src/services/mobile-placement/actual-slip-image-ocr.service.ts`・`apps/api/src/services/mobile-placement/genpyo-slip/`
- 実装（棚番登録 UI・V13）: `apps/web/src/features/mobile-placement/components/shelf-register/`
- 実装（部品配膳・照合）: `apps/api/src/services/mobile-placement/mobile-placement-slip-match.ts` ほか
- 実装（分配枝・V14）: `apps/api/src/services/mobile-placement/order-placement-branch.service.ts`・`apps/api/src/services/mobile-placement/mobile-placement-order-placement.service.ts`・マイグレーション `20260412120000_order_placement_branch_state`
- 実装（部品名検索・V16）: `apps/api/src/services/mobile-placement/part-search/`（`part-search.service.ts`）＋共有 **`packages/part-search-core`**
- 実装（部品検索最終・V17）: 同上 + `part-search-normalize.ts`（SQL 用 `escapeForIlike` のみ）・キオスク `part-search/*`（`partSearchPalettePruner.ts` 等）・**CI/Docker**（`part-search-core` ビルド）
- Runbook: [mobile-placement-smartphone.md](../runbooks/mobile-placement-smartphone.md)
