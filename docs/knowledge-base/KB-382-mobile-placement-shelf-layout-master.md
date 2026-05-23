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
| **3 モード（区画詳細内）** | **レイアウト** — `shelfLayoutEditEnabled === true` の端末のみ UI 表示。**再割当** — 全認証キオスク。**Zero2W** — 担当棚割当（`haizenEdgeEnabled` 端末） |
| **権限 API** | `GET /api/mobile-placement/client-capabilities` → `{ shelfLayoutEditEnabled, haizenEdgeEnabled, … }`（**`x-client-key` 単位**） |
| **レイアウト編集 API** | `GET/PUT /api/mobile-placement/shelf-layout`、区画 `…/zones/:macroZoneId`（PUT は **`shelfLayoutEditEnabled` 必須**・403 時 UI は編集モード非表示） |
| **再割当 API** | `POST /api/mobile-placement/shelves/:shelfCodeRaw/relocate` — **スロット固定・中身移動**（`OrderPlacementBranchState` / `HaizenCurrentPlacement` / `haizenPresetShelfCodeRaw` を一括更新） |
| **管理画面** | `/admin/clients` → **クライアント端末** 表 — 列 **「棚レイアウト編集」**（`shelfLayoutEditEnabled`）。**Zero2W配膳列（`haizenEdgeEnabled`）と混同しない** |
| **表示名** | `{加工機名}{東\|西\|南\|北\|中央}`。加工機 0 台時 `置場-{方位}`。同区画重複時 `-2` サフィックス（[`shelf-layout-core`](../../packages/shelf-layout-core/)） |
| **サイネージ** | 部品棚グリッド行に **`displayLabel` 主表示**・正本 ID 小さく併記。**Pi5 API の JPEG 正本** — **Pi3 専用デプロイは不要**（`displayLabel` は API 側レンダリング） |
| **沉浸式ヘッダー** | 順位ボード・棚マスタ等は [`kioskImmersiveLayoutPolicy`](../../apps/web/src/features/kiosk/kioskImmersiveLayoutPolicy.ts) で **画面下配置・通常非表示**。**下辺中央 1/3 ホバー**でナビ表示（[KB-311](./KB-311-kiosk-immersive-header-allowlist.md)） |

### 操作フロー（オペレータ）

1. **9 区画マップ**（factory-map）で区画を選ぶ  
2. **区画詳細** — 中央に当該区画グリッド、周辺 1/3 に隣接区画、破線は区画間通路  
3. **再割当** — 移動元 SHELF マス → 移動先 SHELF マス（**2 回タップ**）→ 確認。**空マス「—」は無反応**（SHELF 未配置は仕様）  
4. **レイアウト**（管理者端末のみ）— マス種別（加工機 / 部品置き場 / 通路 / 未使用）割当・表示名・正本 ID 採番  

**レイアウト UI（2026-05-23 改善）**: 操作誘導は **押せるコントロールのみ有効**（他はグレーアウト）。**「選択解除」**は枠のみ外す。**「選択マスを解除」**は割当削除。**「レイアウト保存」**はドラフト変更時のみ有効。割当直後はドラフト上で表示名・棚番をプレビュー表示（保存で API 確定）。

## Symptoms（現場で報告されやすい症状）

| 症状 | 典型原因 |
|------|----------|
| **「棚マスタ」タブを押しても画面が変わらない** | 既に `/kiosk/mobile-placement/shelf-master` にいる（同 URL への NavLink — **正常**） |
| **ヘッダーの「棚マスタ」が押せない** | 沉浸式レイアウトで **`pointer-events-none` + 非表示**。**画面下辺中央 1/3 にホバー**してナビを出してからクリック |
| **区画詳細に「レイアウト」タブが出ない** | `client-capabilities` の **`shelfLayoutEditEnabled: false`**。管理画面で **別 ClientDevice**（例 Zero2W のみ ON）を編集した、またはキオスクの **`x-client-key` と不一致** |
| **管理で ON にしたのにレイアウトが出ない** | Mac/Cursor ブラウザの **`clientKey`** が編集した端末と違う（既定 Mac: **`client-key-mac-kiosk1`** — [`config.ts`](../../apps/web/src/lib/client-key/config.ts)。URL / localStorage に StoneBase 等が残る場合あり） |
| **再割当で「—」をタップしても無反応** | **再割当モードの仕様** — SHELF 未配置マス。先に **レイアウト編集**で部品置き場を割当 |
| **Zero2W 列を ON にしたがレイアウトが出ない** | **`haizenEdgeEnabled`** と **`shelfLayoutEditEnabled`** は別フラグ |

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

## Production deploy & verification（2026-05-23 · 部分本番）

**ブランチ**: `feat/kiosk-shelf-layout-master`  
**代表コミット**: **`17c9ea6d`**（機能本体）→ **`34527423`** / **`a73d88ea`**（Docker/CI `shelf-layout-core`）→ **`a7f23c8a`**（グローバルヘッダー「棚マスタ」タブ）

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

**実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（複数回・Tailscale）

**現場検証（ユーザー 2026-05-23）**: Pi4 + Zero2W に **`shelfLayoutEditEnabled`** 設定後、**レイアウトタブ・操作可能**を確認

**未デプロイ（記録時点）**: `raspberrypi4` / `raspi4-robodrill01` / `raspi4-fjv60-80` — 同一ブランチ・標準手順で順次可能

**Pi3**: 本機能の必須対象外（`/kiosk` は Pi5 SPA 配信。**`displayLabel` サイネージは Pi5 API のみ**）

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
- Deploy: [deployment.md](../guides/deployment.md#mobile-placement-shelf-layout-master-2026-05-23)
- Zero2W 関連: [KB-368](./KB-368-zero2w-haizen-placement-tracking.md)
- 沉浸式ヘッダー: [KB-311](./KB-311-kiosk-immersive-header-allowlist.md)
- 設計プレビュー: `docs/design-previews/kiosk-shelf-factory-map-preview.html` 他
