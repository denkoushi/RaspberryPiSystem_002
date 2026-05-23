# KB-382: 配膳棚レイアウトマスタ（キオスク shelf-master）

## Context

配膳棚は従来 **`MobilePlacementShelf.shelfCodeRaw`**（例 `西-北-02`）と **`/kiosk/mobile-placement/shelf-register`** の手動登録、Zero2W は **`/zero2w-assignment`** で別管理していた。現場は **9 マクロ区画**（サイネージ `nw`..`se`）で部品配膳を追跡するが、**区画内フロアプラン・表示名（例 `Robodrill01南`）・加工機との位置関係**が DB/API/UI に無かった（設計プレビューのみ）。

**2026-05-23** に **`feat/kiosk-shelf-layout-master`** で実装・部分本番反映。**同一 URL** `/kiosk/mobile-placement/shelf-master` に **レイアウト編集・再割当・Zero2W 割当**を集約し、サイネージ部品棚行に **`displayLabel`** を載せる。

**版数表記の注意**: [api/mobile-placement.md](../api/mobile-placement.md) では本機能を **「V22 棚レイアウトマスタ」** と呼ぶ。[KB-339](./KB-339-mobile-placement-barcode-survey.md) の **V22（2026-04-18）** は **キオスク高視認テーマ**（`feature/mobile-placement-contrast-refactor`）であり **別系統**。本 KB では **「棚レイアウトマスタ（2026-05-23）」** と表記する。

## 仕様（正本）

| 項目 | 内容 |
|------|------|
| **URL** | `/kiosk/mobile-placement/shelf-master`（クエリ `clientKey` は従来どおり） |
| **リダイレクト** | `/kiosk/mobile-placement/shelf-register` → shelf-master、`/zero2w-assignment` → shelf-master（[`App.tsx`](../../apps/web/src/App.tsx)） |
| **グローバルヘッダー** | [`KioskHeader.tsx`](../../apps/web/src/components/kiosk/KioskHeader.tsx) — 「パレット」と「要領書」の間に **「棚マスタ」** NavLink（コミット **`a7f23c8a`**・2026-05-23） |
| **配膳メインから** | [`MobilePlacementPage.tsx`](../../apps/web/src/pages/kiosk/MobilePlacementPage.tsx) の **「棚マスタ」** ボタン |
| **2 モード（工場全体）** | **レイアウト** — `shelfLayoutEditEnabled === true` の端末のみ UI 表示。**再割当** — 全認証キオスク。**Zero2W 担当棚割当** — レイアウト **「編集」Dialog** 左ドック内の **部品置き場時 Pi セレクト**（加工機セレクトと同型）。専用 Zero2W タブ・右「棚番パイ」列は廃止 |
| **権限 API** | `GET /api/mobile-placement/client-capabilities` → `{ shelfLayoutEditEnabled, haizenEdgeEnabled, … }`（**`x-client-key` 単位**） |
| **レイアウト編集 API** | `GET/PUT /api/mobile-placement/shelf-layout`、区画 `…/zones/:macroZoneId`（PUT は **`shelfLayoutEditEnabled` 必須**・403 時 UI は編集モード非表示） |
| **再割当 API** | `POST /api/mobile-placement/shelves/:shelfCodeRaw/relocate` — **スロット固定・中身移動**（`OrderPlacementBranchState` / `HaizenCurrentPlacement` / `haizenPresetShelfCodeRaw` を一括更新） |
| **管理画面** | `/admin/clients` → **クライアント端末** 表 — 列 **「棚レイアウト編集」**（`shelfLayoutEditEnabled`）。**Zero2W配膳列（`haizenEdgeEnabled`）と混同しない** |
| **表示名** | `{加工機名}{東\|西\|南\|北\|中央}`。加工機 0 台時 `置場-{方位}`。同区画重複時 `-2` サフィックス（[`shelf-layout-core`](../../packages/shelf-layout-core/)） |
| **サイネージ** | 部品棚グリッド行に **`displayLabel` 主表示**・正本 ID 小さく併記。**Pi5 API の JPEG 正本** — **Pi3 専用デプロイは不要**（`displayLabel` は API 側レンダリング） |
| **沉浸式ヘッダー** | 順位ボード・棚マスタ等は [`kioskImmersiveLayoutPolicy`](../../apps/web/src/features/kiosk/kioskImmersiveLayoutPolicy.ts) で **画面下配置・通常非表示**。**下辺中央 1/3 ホバー**でナビ表示（[KB-311](./KB-311-kiosk-immersive-header-allowlist.md)） |

### 操作フロー（オペレータ）

**UX（2026-05-23 · 9マス俯瞰 + Dialog）**:

1. **工場全体** — 画面いっぱいの **9 区画**。各区画に **ミニ 3×3** で加工機・置き場・通路を **常時表示**（閲覧専用・タップ不要）
2. **レイアウト**（`shelfLayoutEditEnabled` 端末）— 区画の **「編集」** → **Dialog** 内で **拡大 factory-map** + **単列ドック**（レイアウト操作 + 部品置き場時 **Pi セレクト**）。未保存で閉じるとき確認
3. **再割当** — 9 区画は常時表示のまま、**区画カードタップ** → Dialog 内 factory-map（隣接区画ボタンで区画切替）。移動元 SHELF → 移動先 SHELF
4. **Zero2W 担当棚** — **部品置き場**を選択したとき（新規割当待ち）または **既存 SHELF マス**を選択したとき、ドロップダウンで **担当なし / Pi** を選ぶ。**他棚に割当済み Pi は選択不可（グレーアウト）**。**既存棚**は **「担当を反映」** で即時 `PUT …/haizen-target-devices/:id/preset-shelf`（`shelfCodeRaw` または **`null` で解除**）。**新規部品置き場 + Pi** は **レイアウト保存成功後**に preset を自動反映（`MobilePlacementShelf` 登録後）

**API**: `GET /api/mobile-placement/shelf-layout` の各 `zones[]` に **`entities[]`** を含む（俯瞰ミニマップ用・後方互換追加）。

**レイアウト Dialog**: 操作誘導は **押せるコントロールのみ有効**。**「選択解除」** / **「選択マスを解除」** / **dirty 時のみレイアウト保存**（従来どおり）。

### 区画 Dialog コンパクト化（2026-05-23 · Web のみ）

**背景**: 9 マス俯瞰＋編集 Dialog 導入後、**フル幅モーダル**と **`factoryMap` の巨大 `min-height`** により、Pi4 キオスク実機で **factory-map がはみ出し**・**ドック（棚番パイ・保存）までスクロール不能**・**操作不能**が発生。

**ブランチ**: `fix/kiosk-shelf-master-zone-dialog-compact`（`feat/kiosk-shelf-layout-master` 系列の上に積む）  
**代表コミット**: **`2e73aeed`** — `fix(kiosk): compact shelf master zone dialogs`  
**CI**: GitHub Actions **`26329398253` success**（`2e73aeed` push 後）

**変更範囲（Web のみ・業務ロジック不変）**:

| 項目 | 内容 |
|------|------|
| **対象 Dialog** | [`ShelfZoneLayoutDialog.tsx`](../../apps/web/src/features/mobile-placement/shelfMaster/components/ShelfZoneLayoutDialog.tsx)（編集）·[`ShelfZoneRelocateDialog.tsx`](../../apps/web/src/features/mobile-placement/shelfMaster/components/ShelfZoneRelocateDialog.tsx)（再割当） |
| **共通シェル** | 新規 [`ShelfMasterZoneDialogFrame.tsx`](../../apps/web/src/features/mobile-placement/shelfMaster/components/ShelfMasterZoneDialogFrame.tsx) — **map / dock スロット**・寸法・スクロール境界のみ。`layoutEditorFlow`（Pi セレクトゲート含む）/ `relocateFlow` は各 Dialog に残す |
| **テーマ** | [`shelfMasterTheme.ts`](../../apps/web/src/features/mobile-placement/shelfMaster/theme/shelfMasterTheme.ts) — Dialog 内 `factoryMap` は **`max-w-[26rem]` + `aspect-square`**（俯瞰 9 マスの `macroOverviewGrid` / `miniMap` は別トークンで不変） |
| **Dialog 基盤** | [`Dialog.tsx`](../../apps/web/src/components/ui/Dialog.tsx) — 任意 **`titleClassName`**（後方互換） |
| **触らない** | API / Prisma / 手順ゲート / 9 マス [`ShelfMacroOverviewGrid`](../../apps/web/src/features/mobile-placement/shelfMaster/components/ShelfMacroOverviewGrid.tsx) |

**UI 寸法（正本）**:

- パネル: `max-w-[min(96vw,920px)]` · `max-h-[min(92dvh,800px)]`
- **map-pane**: スクロールなし・factory-map 全体表示
- **dock-pane**: `max-h-[min(38dvh,320px)]` · **縦スクロール**で「担当棚を保存」／再割当確定まで到達
- ヘッダー: コンパクト（`dialogTitle` 小さめ）

**設計プレビュー（承認済み）**: [`kiosk-shelf-master-edit-dialog-compact-preview.html`](../design-previews/kiosk-shelf-master-edit-dialog-compact-preview.html)（**実装反映済み**）

**ローカル検証**: `apps/web/src/features/mobile-placement/shelfMaster` Vitest **16 PASS** · `pnpm --filter web lint` · `pnpm --filter web build` PASS

## Symptoms（現場で報告されやすい症状）

| 症状 | 典型原因 |
|------|----------|
| **「棚マスタ」タブを押しても画面が変わらない** | 既に `/kiosk/mobile-placement/shelf-master` にいる（同 URL への NavLink — **正常**） |
| **ヘッダーの「棚マスタ」が押せない** | 沉浸式レイアウトで **`pointer-events-none` + 非表示**。**画面下辺中央 1/3 にホバー**してナビを出してからクリック |
| **区画詳細に「レイアウト」タブが出ない** | `client-capabilities` の **`shelfLayoutEditEnabled: false`**。管理画面で **別 ClientDevice**（例 Zero2W のみ ON）を編集した、またはキオスクの **`x-client-key` と不一致** |
| **管理で ON にしたのにレイアウトが出ない** | Mac/Cursor ブラウザの **`clientKey`** が編集した端末と違う（既定 Mac: **`client-key-mac-kiosk1`** — [`config.ts`](../../apps/web/src/lib/client-key/config.ts)。URL / localStorage に StoneBase 等が残る場合あり） |
| **再割当で「—」をタップしても無反応** | **再割当モードの仕様** — SHELF 未配置マス。先に **レイアウト編集**で部品置き場を割当 |
| **Zero2W 列を ON にしたがレイアウトが出ない** | **`haizenEdgeEnabled`** と **`shelfLayoutEditEnabled`** は別フラグ |
| **編集 Dialog で地図が切れる・保存ボタンが出ない** | 旧 SPA（コンパクト化前）·Pi5 **`web`** 未更新·**強制リロード**未実施（[§コンパクト化デプロイ](#production-deploy--zone-dialog-compact-2026-05-23)） |
| **再割当 Dialog だけレイアウトが崩れる** | 編集のみ更新された中間ビルド — **再割当も `ShelfMasterZoneDialogFrame` 共有**（`2e73aeed` 以降） |
| **複数マスを結合割当した後、結合ブロックをタップしても選択されず「選択マスを解除」が disabled** | 旧 `useZoneLayoutDraft.toggleCell` が **`cells.length === 1` のみ**処理。割当後は [`ShelfFactoryMapView.tsx`](../../apps/web/src/features/mobile-placement/shelfMaster/components/ShelfFactoryMapView.tsx) が結合 entity の **全 `cellIndices`（長さ>1）** を渡すため **no-op** → `selectedCells` が空のまま（[§複数マス選択解除](#production-deploy--multi-cell-selection-clear-2026-05-23)） |

## Investigation

1. キオスク URL の **`clientKey=`**（または DevTools Application → localStorage）を確認  
2. 管理 **`/admin/clients`** で **同名端末**の **「棚レイアウト編集」** 列が **許可** か  
3. API スポット（Pi5 Tailscale IP・`<key>` は当該端末の `apiKey`）:

```bash
curl -sk "https://<Pi5>/api/mobile-placement/client-capabilities" \
  -H "x-client-key: <key>"
# 期待: "shelfLayoutEditEnabled": true （レイアウト編集端末のみ）

curl -sk "https://<Pi5>/api/mobile-placement/shelf-layout" \
  -H "x-client-key: <key>"
```

4. 沉浸式ヘッダー疑い → 下辺ホバー後に再試行（[KB-311](./KB-311-kiosk-immersive-header-allowlist.md)）

## Root cause（本番検証で確定した例）

- **レイアウトタブ非表示**: DB 上 **`shelfLayoutEditEnabled`** が **`zero2w-tanaban01` 等 Zero2W 端末のみ true** で、実際に操作していた **Pi4 / StoneBase / Mac キー**は **false** のまま — **権限と clientKey の不一致**（設定ミスではなく **対象端末の取り違え**）  
- **解決（ユーザー確認 2026-05-23）**: **Pi4 と Zero2W** に **`shelfLayoutEditEnabled`** を設定 → **レイアウト操作可能に**

## Fix（最小）

1. **操作端末の `ClientDevice`** に **`shelfLayoutEditEnabled: true`**（管理画面 **棚レイアウト編集** 列 — **Zero2W配膳列ではない**）  
2. キオスク URL / localStorage の **`clientKey`** がその端末の **`apiKey`** と一致することを確認  
3. Pi5 に **`feat/kiosk-shelf-layout-master`** 系コミットが載っていること（下記 Detach）。Pi4 は **Web SPA + kiosk-browser 再起動**（標準 `update-all-clients.sh`）  
4. 沉浸式ページでは **下辺リビール**後にヘッダー操作  

## Prevention

- 権限変更時は **必ず `GET …/client-capabilities` を当該 `x-client-key` で確認**してから現場へ案内  
- 管理画面の列名 **「棚レイアウト編集」** と **「Zero2W配膳」** を Runbook / 教育資料で分離  
- CI: **`packages/shelf-layout-core`** を **Dockerfile.api / Dockerfile.web** でビルド（`security-docker` 回帰 — 下記 Surprises）  
- ExecPlan: [mobile-placement-shelf-layout-master.md](../plans/mobile-placement-shelf-layout-master.md)・[ADR-20260523](../decisions/ADR-20260523-mobile-placement-shelf-layout-master.md)

## Production deploy & verification（2026-05-23 · 棚レイアウトマスタ機能）

**ブランチ**: `feat/kiosk-shelf-layout-master`  
**代表コミット**: **`17c9ea6d`**（機能本体）→ **`34527423`** / **`a73d88ea`**（Docker/CI `shelf-layout-core`）→ **`a7f23c8a`**（グローバルヘッダー「棚マスタ」タブ）→ **`9a1af348`**（編集 Dialog 内棚番パイ統合・Zero2W タブ廃止）

**標準コマンド**:

```bash
export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"
./scripts/update-all-clients.sh feat/kiosk-shelf-layout-master infrastructure/ansible/inventory.yml \
  --limit <host> --detach --follow
```

| 順 | ホスト | Detach Run ID | PLAY RECAP | 備考 |
|----|--------|---------------|------------|------|
| 1 | `raspberrypi5` | **`20260523-110553-14539`** | `ok=134` `failed=0` | Docker 再ビルド・**Prisma migrate**・API+Web+サイネージ JPEG |
| 2 | `raspi4-kensaku-stonebase01` | **`20260523-112124-29513`** | `ok=129` `failed=0` | Pi4 キオスク Web |
| 3 | `raspberrypi5`（ヘッダータブ） | **`20260523-122744-32213`** | `ok=134` `failed=0` | ref **`a7f23c8a`** |
| 4 | `raspberrypi5`（棚番パイ Dialog 統合） | **`20260523-175452-20534`** | `ok=134` `changed=4` `failed=0` | ref **`9a1af348`**・Docker 再ビルド |

**実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（複数回・Tailscale。棚番パイ統合デプロイ後も同結果）

**現場検証（ユーザー 2026-05-23）**: Pi4 + Zero2W に **`shelfLayoutEditEnabled`** 設定後、**レイアウトタブ・操作可能**を確認

**Pi3**: 本機能の必須対象外（`/kiosk` は Pi5 SPA 配信。**`displayLabel` サイネージは Pi5 API のみ**）

### Production deploy — 区画 Dialog コンパクト化（2026-05-23） {#production-deploy--zone-dialog-compact-2026-05-23}

**ブランチ**: `fix/kiosk-shelf-master-zone-dialog-compact`（**`main` マージ後は第2引数 `main`**）  
**代表コミット**: **`2e73aeed`**  
**変更**: **Web SPA のみ**（API / Prisma / Pi3 サイネージ **対象外**）

**対象ホスト（1 台ずつ）**: **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`**

**標準コマンド**:

```bash
export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"
./scripts/update-all-clients.sh fix/kiosk-shelf-master-zone-dialog-compact \
  infrastructure/ansible/inventory.yml --limit <host> --detach --follow
```

| 順 | ホスト | Detach Run ID | PLAY RECAP | 備考 |
|----|--------|---------------|------------|------|
| 1 | `raspberrypi5` | **`20260523-183552-18047`** | `ok=134` `changed=4` `failed=0` | Docker 再ビルド・`Git: changed` |
| 2 | `raspberrypi4` | **`20260523-184740-26602`** | `ok=122` `changed=10` `failed=0` | `kiosk-browser` 再起動 |
| 3 | `raspi4-robodrill01` | **`20260523-185339-16025`** | `ok=122` `changed=9` `failed=0` | 同上 |
| 4 | `raspi4-fjv60-80` | **`20260523-185841-7412`** | `ok=122` `changed=9` `failed=0` | 同上 |
| 5 | `raspi4-kensaku-stonebase01` | **`20260523-190359-5547`** | `ok=129` `changed=10` `failed=0` | 同上 |

**実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（Pi5 単独後・Pi4 全台後の各実行で同結果）

**現場検証（ユーザー 2026-05-23）**: Pi5 実機 **OK** → 続けて **Pi4×4 デプロイ完了**

**デプロイ前のローカル前提**: `update-all-clients.sh` は **作業ツリー clean**・**origin へ push 済み**を要求（未コミットのプレビュー HTML は **stash** または別コミットで退避）

**知見**:

- **Pi5 `web` 再ビルド必須** — Pi4 単体では SPA 正本は更新されない（キオスク Web 変更の定石）
- **map / dock 分離** — 地図は固定表示・操作 UI は dock 縦スクロールに閉じると **小画面キオスクで到達性が安定**
- **手順ゲートは Frame 外** — コンパクト化で **フロー無効化の回帰を避ける**（SOLID・境界契約）

### 複数マス結合後の選択解除不可（2026-05-23 · Web のみ） {#multi-cell-selection-clear-2026-05-23}

**症状（現場）**: レイアウト編集 Dialog で **複数マスを選択して部品置き場（SHELF）を割当**したあと、地図上の **結合ブロックをタップしてもハイライトされない**。**「選択マスを解除」** が常に **disabled** のまま。単一マス割当では再現しにくい。

**調査（CONFIRMED）**:

1. 割当前: 複数マス選択モードで `selectedCells` に複数インデックスが入り、割当 API 呼び出しは成功する。
2. 割当後: 同一 entity は `cellIndices: [i, j, …]`（長さ > 1）で描画される。
3. [`ShelfFactoryMapView`](../../apps/web/src/features/mobile-placement/shelfMaster/components/ShelfFactoryMapView.tsx) の `onCellClick` は **結合ブロック全体の `cellIndices` 配列**を `toggleCell` に渡す。
4. 旧 [`useZoneLayoutDraft.ts`](../../apps/web/src/features/mobile-placement/shelfMaster/hooks/useZoneLayoutDraft.ts) の `toggleCell` は **`if (cells.length !== 1) return prevSelected`** 相当で **早期 return** → クリックが no-op。

**根本原因**: 選択トグル契約が **「単一マスクリック」前提**のまま残り、**結合 entity（複数 `cellIndices`）** の UI 契約と不一致。

**仕様 A（採用）**:

| 操作 | 挙動 |
|------|------|
| **単一マス** | 従来どおり `multiMode` に従いトグル（単一選択 / 複数選択） |
| **結合ブロック（`clickedCells.length > 1`）** | **entity 単位** — ブロックの全マスが未選択なら **一括選択**、全マスが既に選択済みなら **一括解除** |
| **「選択マスを解除」** | `selectedCells` が空でなければ従来どおり有効（結合ブロックタップで選択が入るようになったため復帰） |

**Fix（最小・Web のみ）**:

| ファイル | 内容 |
|----------|------|
| 新規 [`layoutCellSelection.ts`](../../apps/web/src/features/mobile-placement/shelfMaster/model/layoutCellSelection.ts) | 純粋関数 **`toggleLayoutCellSelection`**（境界に閉じた選択契約） |
| 新規 [`layoutCellSelection.test.ts`](../../apps/web/src/features/mobile-placement/shelfMaster/__tests__/layoutCellSelection.test.ts) | 単一 / 複数 / 結合ブロックの **7 ケース** |
| [`useZoneLayoutDraft.ts`](../../apps/web/src/features/mobile-placement/shelfMaster/hooks/useZoneLayoutDraft.ts) | `toggleCell` を上記に委譲・`useCallback([multiMode])` |
| [`layoutDraftActions.test.ts`](../../apps/web/src/features/mobile-placement/shelfMaster/__tests__/layoutDraftActions.test.ts) | 複数 `cellIndices` 全選択時の **一括解除** 回帰 |

**ブランチ**: `fix/kiosk-shelf-master-multi-cell-selection`  
**代表コミット**: **`6adc89f7`** — `fix(kiosk): allow clearing multi-cell shelf layout assignments`  
**CI**: GitHub Actions **`26332578527` success**（`6adc89f7` push 後）

**ローカル検証**: `apps/web/src/features/mobile-placement/shelfMaster` Vitest **24 PASS** · `pnpm --filter web test` **582 PASS** · lint · build PASS

**触らない**: API / Prisma / Ansible / Pi3 サイネージ

### Production deploy — 複数マス選択解除（2026-05-23） {#production-deploy--multi-cell-selection-clear-2026-05-23}

**変更**: **Web SPA のみ**（Pi5 `web` 再ビルド + Pi4 `kiosk-browser` 再起動）

**対象ホスト（1 台ずつ）**: **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`**

**標準コマンド**（**`main` マージ後は第2引数 `main`**）:

```bash
export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"
./scripts/update-all-clients.sh fix/kiosk-shelf-master-multi-cell-selection \
  infrastructure/ansible/inventory.yml --limit <host> --detach --follow
```

| 順 | ホスト | Detach Run ID | PLAY RECAP | 備考 |
|----|--------|---------------|------------|------|
| 1 | `raspberrypi5` | **`20260523-214122-22482`** | `ok=134` `changed=4` `failed=0` | Docker `web` 再ビルド |
| 2 | `raspberrypi4` | **`20260523-215426-5450`** | `ok=122` `changed=10` `failed=0` | `kiosk-browser` 再起動 |
| 3 | `raspi4-robodrill01` | **`20260523-220023-22658`** | `ok=122` `changed=9` `failed=0` | 同上 |
| 4 | `raspi4-fjv60-80` | **`20260523-220513-20691`** | `ok=122` `changed=9` `failed=0` | 同上 |
| 5 | `raspi4-kensaku-stonebase01` | **`20260523-221011-26349`** | `ok=129` `changed=10` `failed=0` | 同上 |

**Pi3**: **`skipping: no hosts matched`**（想定どおり）

**実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（初回記録 **約 113s**・Tailscale・Pi5 `100.106.158.2`）

**main 再検証（2026-05-23 · `main` `655bbe8c`）**:

- **トリガー**: ドキュメント同期コミット（`655bbe8c`）後の **本番健全性の再確認**（デプロイ再実行なし）
- **コマンド**: 作業ツリー `main` で `./scripts/deploy/verify-phase12-real.sh`
- **結果**: **PASS 43 / WARN 0 / FAIL 0**（**約 109s**）
- **内訳（抜粋）**: `deploy-status` **Pi4×4 PASS** · Pi4 **`kiosk/status-agent`×4 PASS** · Pi3 **`signage-lite/timer` PASS** · API ヘルス・納期管理・サイネージ・配膳系スモーク **すべて PASS**
- **HTTP スモーク（再実行）**: `/api/system/health` **`status: ok`**（memory warning 89.5% は既知の監視メッセージ）· `/kiosk/mobile-placement/shelf-master` **200** · `/kiosk/mobile-placement` **200**
- **未実施（本再検証の範囲外）**: 各 Pi4 キオスクでの **複数マス割当→結合ブロック解除** の現場手動（[§現場手動](#production-deploy--multi-cell-selection-clear-2026-05-23) はオペレータ確認が正）

**HTTP スモーク（Pi5）**:

- `GET /api/system/health` → **`status: ok`**
- `GET /kiosk/mobile-placement/shelf-master` → **HTTP 200**
- `GET /kiosk/mobile-placement` → **HTTP 200**

**現場手動（推奨・`shelfLayoutEditEnabled` 端末）**:

1. **レイアウト** → 区画 **編集** Dialog
2. 複数マス選択 → **部品置き場を割当**
3. 結合ブロックを **1 回タップ** → 全マスが選択ハイライト
4. **「選択マスを解除」** または **再タップ** → 選択解除・entity 削除可能

**トラブルシュート**:

| 症状 | 対処 |
|------|------|
| 旧挙動のまま | Pi5 **`web` ref** が `6adc89f7` 以降か確認·キオスク **強制リロード** |
| Pi4 のみ旧 UI | **Pi5 先行デプロイ**漏れ（SPA 正本は Pi5） |
| レイアウトタブ自体が出ない | [§Root cause（本番検証で確定した例）](#root-cause本番検証で確定した例) — **`shelfLayoutEditEnabled` / `clientKey` 不一致**（本件とは別） |

### CI

- 初回 **`security-docker` 失敗**: Docker イメージに **`@raspi-system/shelf-layout-core` ビルド漏れ** → **`Dockerfile.api` / `Dockerfile.web` 修正**（**`34527423`**）後 success（run **`26320245567`** 付近）

### デプロイ TS

| 症状 | 対処 |
|------|------|
| **`Another update-all-clients.sh process is already running`** | Mac 側 **local lock** — 残存 `update-all-clients.sh` を終了（本セッション例: pid **54011** 残留後 StoneBase 再実行） |
| **`Failed to acquire remote lock`** | Pi5 `/opt/.../logs/.update-all-clients.lock` の **`runPid` 死活確認**（[deploy-status-recovery.md](../runbooks/deploy-status-recovery.md)） |
| **Pi5 Docker 再ビルドが長い** | **`--follow` が長く見える**が **`failed=0` なら成功**（V18 棚マスタと同型） |

## References

- ADR: [ADR-20260523-mobile-placement-shelf-layout-master.md](../decisions/ADR-20260523-mobile-placement-shelf-layout-master.md)
- ExecPlan: [mobile-placement-shelf-layout-master.md](../plans/mobile-placement-shelf-layout-master.md)
- API: [mobile-placement.md](../api/mobile-placement.md)（V22 棚レイアウトマスタ節）
- Runbook: [mobile-placement-smartphone.md](../runbooks/mobile-placement-smartphone.md) §棚レイアウトマスタ
- Deploy（機能本体）: [deployment.md](../guides/deployment.md#mobile-placement-shelf-layout-master-2026-05-23)
- Deploy（Dialog コンパクト）: [deployment.md](../guides/deployment.md#kiosk-shelf-master-zone-dialog-compact-2026-05-23)
- Deploy（複数マス選択解除）: [deployment.md](../guides/deployment.md#kiosk-shelf-master-multi-cell-selection-clear-2026-05-23)
- 選択契約実装: [`layoutCellSelection.ts`](../../apps/web/src/features/mobile-placement/shelfMaster/model/layoutCellSelection.ts)
- Zero2W 関連: [KB-368](./KB-368-zero2w-haizen-placement-tracking.md)
- 沉浸式ヘッダー: [KB-311](./KB-311-kiosk-immersive-header-allowlist.md)
- 設計プレビュー: [design-previews/README.md](../design-previews/README.md)（`kiosk-shelf-master-*`）
