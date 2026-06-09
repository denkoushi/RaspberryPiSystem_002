# キオスク: 部品測定記録（part-measurement）

## 目的

移動票のバーコードと生産スケジュールを参照し、品番・工程（切削/研削）に紐づく測定テンプレートに沿って値を入力し、下書き保存ののち確定する。

## 前提

- API・DB に `part-measurement` マイグレーションが適用済みであること（デプロイ手順は [deployment.md](../guides/deployment.md)）。
- キオスク端末に有効な `x-client-key`（ClientDevice）が設定されていること。
- テンプレートは **品番 × 工程 × 資源CD** ごとに有効版が1つあること（未登録時はキオスクのテンプレ作成、または管理コンソール `/admin/tools/part-measurement-templates` から登録可能）。
- **図面付きテンプレート**（任意）: **visual template** に図面画像1枚を登録し、業務テンプレートから参照する。FIHNCD に紐づけず再利用できる。表面/裏面などは **資源CDが異なる業務テンプレ** に、別 visual を割り当てる。図面上の番号は項目の **図番号（表示用）** に入力する。

## 検査図面 MVP（図面中心UI）

詳細・デプロイ実績・トラブルシュート: [KB-320 §検査図面](../knowledge-base/KB-320-kiosk-part-measurement.md#検査図面-mvp2026-05-30) · [ExecPlan](../plans/kiosk-inspection-drawing-mvp-execplan.md) · [deployment.md §2026-05-30](../guides/deployment.md#kiosk-inspection-drawing-mvp-2026-05-30)。

### キオスクナビ（2026-05-30）

| ヘッダータブ | 遷移先（既定） | アクティブになるパス |
|--------------|----------------|----------------------|
| **部品測定** | `/kiosk/part-measurement` | `/kiosk/part-measurement/*` のうち **`/inspection/*` 以外** |
| **検査図面** | `/kiosk/part-measurement/inspection` | `/kiosk/part-measurement/inspection/*` 全体（一覧・作成・テンプレ編集・本番/評価 edit 含む） |

実装: `KioskHeader.tsx` + `kioskInspectionDrawingRoutes.ts`。

- **一覧/作成/編集（本番テンプレ中心）**: ヘッダー **「検査図面」** → `/kiosk/part-measurement/inspection`（一覧ハブ）。一覧から **新規**（`/inspection/create`）・**編集**（`/inspection/templates/:id/edit`）・**履歴**（ダイアログ）を開く。
  - **新規**: `POST /api/part-measurement/templates`（multipart・図面画像必須・`THREE_KEY`）。
  - **一覧・読込**: `GET /api/part-measurement/inspection-drawing/templates`（`fhincd` **部分一致**・要約 DTO）/ `GET …/templates/:id`（全項目・旧版閲覧可）。
  - **編集保存**: `POST /api/part-measurement/inspection-drawing/templates/:id/revise`（**有効版のみ**）。汎用 `POST /templates/:id/revise` はキオスク検査図面からは使わない。
  - **旧版**: `isActive: false` は **閲覧専用**。履歴から有効化後、専用 GET で再読込して編集。
  - 資源は **表示名付きドロップダウン**。品番・資源・工程は編集時 **変更不可**（表示のみ）。
- **本番導線（編集・閲覧）**: 図面付き本番テンプレかつ **記録表の `quantity` がちょうど 1** のとき、部品測定ハブ（下書き一覧）・生産スケジュール・テンプレ候補・確定一覧・`find-or-open` から **`/kiosk/part-measurement/inspection/edit/:sheetId`** へ自動遷移する。保存・確定は **通常の記録表 API**（`PATCH /api/part-measurement/sheets/:id`・`POST …/finalize`）。**数量が 2 以上**、または図面なし・座標未設定テンプレは **従来どおり表形式** `/edit/:sheetId`。表形式 URL を開いても、対象 sheet なら図面UIへ **リダイレクト**する。
- **評価用編集 API**: 既存互換のため `inspection-drawing/evaluation-sheets/*` は当面残すが、新しいキオスク UI 導線からは使用しない。本番 sheet は引き続き **409**、評価用 sheet も通常 PATCH/finalize から **409**。
- **制約（現時点）**: 複数個数の図面UI・TIFF・順位ボードは未対応。図面中心の本番編集は引き続き **quantity===1** のみ。詳細は [kiosk-inspection-drawing-mvp-execplan.md](../plans/kiosk-inspection-drawing-mvp-execplan.md)。

### 検査図面 · 流用導線（2026-06-05） {#検査図面-流用導線-2026-06-05}

正本: [KB-320 §流用導線強化](../knowledge-base/KB-320-kiosk-part-measurement.md#検査図面-流用導線-2026-06-05) · [deployment §2026-06-05](../guides/deployment.md#kiosk-inspection-drawing-reuse-flow-2026-06-05) · ブランチ **`feat/kiosk-inspection-drawing-reuse-flow`** · 代表 **`6c7da8c7`**

同一図面を **別工程・別資源** へ展開する手順（`品番 × 工程 × 資源CD = 1テンプレ` を維持）。

| 導線 | 操作 | 備考 |
|------|------|------|
| **既存図面の再利用** | 新規作成画面 → 図面ボタン → **既存から選択** または **新規アップロード** | `visualSource` が単一真実源。`pickExisting` 時は `visualTemplateId` のみで保存可。検索は **API `q` + `limit=80`**（400ms debounce） |
| **テンプレ雛形から新規** | 一覧の有効版カード → **雛形として新規** | `?sourceTemplateId=` で詳細再取得。履歴版は不可。無効 ID / 消失時は blank form 復帰 |
| **改版（既存キー）** | 一覧 → **編集** → 保存 | 新規作成ではなく `revise` |

**キー衝突ガード（新規作成全体）**

- UI: `same_as_source` / `active_exists`（`GET …/templates/active-exists`）→ **保存ボタン無効** + 案内。
- FIHNCD は **trim + 大文字化 + case-insensitive 照合**（`abc` と `ABC` は同一キー）。
- API: `failIfActiveExists: true` で **409**。本番 THREE_KEY は **lineage advisory lock** で同時作成を直列化。

**orphan visual 回収**

- アップロード後にテンプレ保存が失敗した場合、`POST visual-templates` 応答の **`cleanupToken`** で `DELETE`（`X-Visual-Cleanup-Token` ヘッダ必須）。

#### 手動確認（Pi5 キオスク）

1. **検査図面** タブ → 一覧 → 有効版 **雛形として新規** → 工程または資源CDを変更 → 保存成功。
2. 雛形元と **同一キー**（FIHNCD の大文字小文字のみ違い含む）では保存不可。
3. 新規作成 → 図面 → **既存から選択**（検索で絞り込み）→ upload なしで保存成功。
4. 図面切替時、測定点がある場合は確認ダイアログ。キャンセルで元状態維持。
5. （任意）管理画面で visual 作成 → テンプレ保存を意図的に失敗 → `cleanupToken` 回収。

#### 本番反映実績（2026-06-05 · Pi5 先行）

| 項目 | 内容 |
|------|------|
| Pi5 Detach Run ID | **`20260605-191525-16964`** |
| Git HEAD | **`6c7da8c7`** |
| PLAY RECAP | `failed=0` · Docker `api`/`web` 再起動 |
| Phase12 | **43/0/0** |
| Pi5 キオスク目視 | **未記録**（手動 1–5 を実施） |
| Pi4×4 | **未** |

**API スモーク（Tailscale）**

```bash
BASE="https://100.106.158.2/api"
KEY="client-key-raspberrypi4-kiosk1"

curl -sk -H "x-client-key: ${KEY}" \
  "${BASE}/part-measurement/visual-templates?q=test&limit=5"

curl -sk -H "x-client-key: ${KEY}" \
  "${BASE}/part-measurement/templates/active-exists?fhincd=NONEXIST&processGroup=cutting&resourceCd=RES-TEST"
```

#### トラブルシュート

| 事象 | 対処 |
|------|------|
| 雛形ボタンが出ない | 有効版カードのみ。履歴版は不可 |
| 図面一覧が空 | 検索 `q` を変える · Pi5 `api`/`web` ref が `6c7da8c7` 以降か |
| 保存 409 | 同一キー active あり → 改版導線か別キーへ |
| orphan 削除 403 | `cleanupToken` 不一致 · 既にテンプレ参照あり（409） |

### 検査図面 · PDF 取込（2026-06-02）

- **UI**: 図面ファイル選択は **「図面画像またはPDF（PDFは1ページ目のみ）」**。`accept` に `application/pdf` を含む（検査図面作成・管理/キオスクテンプレ作成）。
- **保存前プレビュー（2026-06-02 追記）**:
  - Canvas には **常に画像 Blob URL のみ**を渡す（PDF Blob を `<img>` に直接渡さない）。
  - PDF 選択時は `POST /api/part-measurement/drawings/preview` で **副作用なし**に JPEG 化し、表示と保存で **同一 JPEG** を再利用する。
  - 変換中（`previewResolving`）および preview JPEG 未確定の PDF は **保存不可**。
  - 編集画面で新 PDF の preview が失敗した場合は **既存図面表示を維持**し、利用者向けエラーを表示する。
  - 代表実装: `usePartMeasurementDrawingLocalPreview.ts` · `part-measurement-drawing-preview.ts`
- **API 入口（multipart）**: いずれも `importDrawingAndSave` 経由。
  - `POST /api/part-measurement/visual-templates`
  - `POST /api/part-measurement/inspection-drawing/evaluation-templates`（`file` フィールド）
- **preview 入口（保存なし）**: `POST /api/part-measurement/drawings/preview`（multipart `file` · `allowWriteKiosk` · **rate limit 有効** · DB/storage 書き込みなし）
  - レスポンス: 元画像 MIME または `image/jpeg` · `Cache-Control: no-store` · `X-Content-Type-Options: nosniff`
- **契約**:
  - 画像入力上限 **12MB**、PDF 入力上限 **30MB**、保存画像（変換後 JPEG 含む）上限 **12MB**
  - PDF は **1 ページ目のみ** `pdftoppm -f 1 -l 1 -singlefile -jpeg -r 144 -jpegopt quality=85` で JPEG 化し、以後は通常の画像図面として表示
  - 元 PDF は保存しない（`drawingImageRelativePath` は `.jpg` 等の画像 URL のみ）
- **代表実装**: `apps/api/src/lib/part-measurement-drawing-import.ts` · `part-measurement-drawing-preview.ts` · `convert-pdf-first-page-to-jpeg.ts`
- **エラー（400 例）**: 未対応形式 / PDF 形式不正 / PDF 大きすぎ / 変換失敗 / 暗号化 PDF / 変換後画像大きすぎ
- **運用**: API コンテナに `poppler-utils`（`pdftoppm`）必須。Arial 依存 PDF は文字欠けの可能性（`fonts-noto-cjk` のみ）。
- **実機確認（Pi）**: preview / save / storage GET が kiosk `client-key` で通ること · `pdftoppm` 有無 · フォント欠け · preview の semaphore / queue 上限（同時 PDF 連打で 503 にならない運用）

#### 本番反映実績（2026-06-02 · Pi5 先行）

| 項目 | 内容 |
|------|------|
| ブランチ | `feat/inspection-drawing-pdf-import` → **`main` マージ後** Pi4 順次 |
| Pi5 Detach Run ID | **`20260602-190538-1780`** |
| Git HEAD | **`8307c995`** |
| PLAY RECAP | `failed=0` · Docker `api`/`web` 再起動 |
| Phase12 | **41 PASS / WARN 1 / FAIL 1**（`raspberrypi4` SSH タイムアウトは既知） |
| Pi5 キオスク目視 | **OK**（PDF プレビュー表示 · 保存 · 再読込座標一致 · 変換中保存不可） |
| Pi4×4 | **未** — `main` 反映後 `--limit` 1 台ずつ（SPA は Pi5 配信のため多くは強制リロードで足りるが、検査図面系は Pi5 OK 後に順次が標準） |

**preview API 自動確認（Tailscale · 2026-06-02）**:

```bash
BASE="https://100.106.158.2/api"
KEY="client-key-raspberrypi4-kiosk1"

# 未認証 → 401
curl -sk -o /dev/null -w "%{http_code}\n" -X POST "${BASE}/part-measurement/drawings/preview"

# 最小 PDF → 200 image/jpeg（Mac 上で /tmp/test-drawing.pdf を用意してから）
curl -sk -D - -o /tmp/preview-out.jpg \
  -H "x-client-key: ${KEY}" \
  -F "file=@/tmp/test-drawing.pdf;type=application/pdf" \
  "${BASE}/part-measurement/drawings/preview"
# 期待: HTTP 200 · Content-Type: image/jpeg · Cache-Control: no-store
```

**レビュー・実装知見（後続向け）**:

| 事象 | 対処 |
|------|------|
| PDF 変換失敗後に保存ボタンがずっと無効 | `usePartMeasurementDrawingLocalPreview` で失敗時 `setHasPendingLocalSelection(false)` · CreatePage で `previewError` 時に pending ref リセット（`8307c995`） |
| ファイル差し替え連打で古い preview が勝つ | 成功パスでも `controller.signal.aborted` を確認してから state 更新 |
| unmount 後の setState 警告 | `previewUrlRef` + `replaceLocalPreviewUrl` で cleanup |
| 編集画面で新 PDF が失敗 | **既存図面 Blob を維持**しエラーメッセージのみ（`inspectionDrawingTemplateImageDisplay` の local-first 契約） |

## 検査図面 UI/UX（符号付き公差・2026-06-03） {#検査図面-uiux-符号付き公差-デプロイ-2026-06-03}

正本: [KB-320 §UI/UX](../knowledge-base/KB-320-kiosk-part-measurement.md#検査図面-uiux-符号付き公差-2026-06-03) · [deployment.md §UI/UX](../guides/deployment.md#kiosk-inspection-drawing-signed-tolerance-uiux-2026-06-03) · **`6e436cfc`** · **`main` マージ** · CI **`26867660917`**

### デプロイ（Web のみ · 先行実績）

1. **`main`**（またはマージ前は `feat/inspection-drawing-signed-tolerance-uiux`）を Pi5 に `./scripts/update-all-clients.sh main … --limit raspberrypi5 --detach --follow`。
2. 目視 OK 後、必要 Pi4 を `--limit` 1 台ずつ（実績: **`raspberrypi5`** `20260603-154307-28721` · **`raspi4-kensaku-stonebase01`** `20260603-154818-15503`）。
3. Pi4 はキオスク **強制リロード**（§6.6.4）後、[§実機確認ポイント（拡張）](#実機確認ポイント拡張) の 2–4 を実施。

## 検査図面 測定点位置微調整（十字ボタン · 2026-06-05） {#検査図面-測定点位置微調整-十字ボタン-2026-06-05}

正本: [KB-320 §十字ボタン](../knowledge-base/KB-320-kiosk-part-measurement.md#検査図面-測定点位置微調整-十字ボタン-2026-06-05) · [ExecPlan](../plans/inspection-drawing-point-nudge-execplan.md) · [deployment §2026-06-05](../guides/deployment.md#kiosk-inspection-drawing-point-nudge-2026-06-05) · ブランチ **`feat/inspection-drawing-point-nudge`** · **`da9d2675`** · CI **`26996602603`** · **Web のみ**

### デプロイ（Web のみ · Pi5 + stonebase 反映済 · 2026-06-05）

1. `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`
2. `./scripts/update-all-clients.sh feat/inspection-drawing-point-nudge infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`
3. Pi5 目視 OK 後、`--limit raspi4-kensaku-stonebase01`（先行実機）→ 残 Pi4×3 を 1 台ずつ（`raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80`）。
4. 各 Pi4 **強制リロード**（§6.6.4）。`kiosk-browser` 再起動のみで足りることもあるが、旧 bundle 残存時は必須。

| ホスト | Detach Run ID | 実機 |
|--------|---------------|------|
| `raspberrypi5` | **`20260605-141538-27072`** | web 再ビルド · **`da9d2675`** |
| `raspi4-kensaku-stonebase01` | **`20260605-142229-22757`** | **実機 OK** |
| Pi4×3 | — | **未** |

### 手動確認（作成/改版）

1. **検査図面** 新規/改版を開き、ツールバー **「点を配置」** を選択。
2. 図面上の丸数字または右ペイン一覧で測定点を選択。
3. 右ペイン **「測定点の位置調整」**（十字ボタン）がタイトル **上** に表示されること。
4. ↑↓←→ でマーカーが **約 1–2px 刻み** で動くこと。端（0/1）でそれ以上はみ出さないこと。
5. **テスト入力** / **ガイド試行** に切り替えると設定パネル（十字ボタン含む）が **非表示** になること。
6. 保存後、再読込でも位置が維持されること。

DEV: `/dev/kiosk-inspection-drawing-create`（本番と同一コンポーネント）。

## 検査図面 作成/改版ヘッダー フラット band（2026-06-04） {#検査図面-作成改版ヘッダー-フラット-band-2026-06-04}

正本: [KB-320 §フラット band](../knowledge-base/KB-320-kiosk-part-measurement.md#検査図面-作成改版ヘッダー-フラット-band-2026-06-04) · [ExecPlan](../plans/inspection-drawing-create-layout-and-return-nav.md) · [deployment §2026-06-04](../guides/deployment.md#kiosk-inspection-drawing-create-header-flat-layout-2026-06-04) · ブランチ **`fix/inspection-drawing-create-header-flat-layout`** · **`d96da485`** · CI **`26917349311`**

### デプロイ（Web のみ · 完了）

1. `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`
2. `./scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`
3. Pi5 OK 後、Pi4 を 1 台ずつ `--limit`（`raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`）。
4. 各 Pi4 **強制リロード**（§6.6.4）。

| ホスト | Detach Run ID | 実機 |
|--------|---------------|------|
| `raspberrypi5` | **`20260604-074525-7036`** | web 再ビルド · HEAD **`d96da485`** |
| `raspi4-kensaku-stonebase01` | **`20260604-075147-21404`** | **実機 OK** |
| `raspberrypi4` | **`20260604-080658-2223`** | `kiosk-browser` 再起動 |
| `raspi4-robodrill01` | **`20260604-081126-19736`** | 同上 |
| `raspi4-fjv60-80` | **`20260604-081502-25798`** | 同上 |

### 実機確認ポイント

1. 改版（長い資源名 · chip 5個）で上辺 **最大2物理行** · **検査数 chip 孤児なし**。
2. 版バッジ · 図面 · ズーム · ツールバーが **同一 band** 内。
3. 右ペイン縦一覧 · テスト入力 mode 維持 · 戻り先ナビ（初版レイアウトと整合）。

### トラブルシュート

| 症状 | 確認 |
|------|------|
| 検査数だけ3行目 | Pi5 HEAD ≥ **`d96da485`** · `InspectionDrawingCreateCompactHeader` |
| Pi4 だけ旧 UI | 強制リロード · Pi5 SPA · `_appRef` |
| Playwright 白画面 | API モックが `/src/api/` を intercept — [helpers](../../e2e/helpers/inspectionDrawingCreateHeaderLayout.ts) |

## 検査図面 作成/改版レイアウト + 戻り先ナビ（2026-06-03） {#検査図面-作成-layout-return-nav-2026-06-03}

正本: [KB-320 §作成レイアウト](../knowledge-base/KB-320-kiosk-part-measurement.md#検査図面-作成改版レイアウト-2026-06-03) · [KB-320 §戻り先](../knowledge-base/KB-320-kiosk-part-measurement.md#検査図面-戻り先ナビ-2026-06-03) · [ExecPlan](../plans/inspection-drawing-create-layout-and-return-nav.md) · [deployment §2026-06-03](../guides/deployment.md#kiosk-inspection-drawing-create-layout-return-nav-2026-06-03) · ブランチ **`fix/inspection-drawing-return-navigation-review`** · **`5274f1ee`** · CI **`26883229358`**

### デプロイ（Web のみ）

1. `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`
2. **`main` マージ後**（またはマージ前はブランチ名）: `./scripts/update-all-clients.sh <ref> infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`
3. Pi5 目視 OK 後、Pi4 を 1 台ずつ `--limit` 変更（`raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`）。
4. 各 Pi4 でキオスク **強制リロード**（§6.6.4）。

**Pi5 実績**: Detach **`20260603-211122-29648`** · HEAD **`5274f1ee`** · `failed=0`。

### 実機確認ポイント

1. **検査図面** 新規/改版 — 上辺 **フラット band**（最大2物理行 · 検査数孤児なし · [§2026-06-04](#検査図面-作成改版ヘッダー-フラット-band-2026-06-04)）· **右ペイン下部**に測定点縦一覧。
2. **図面エリア**が旧 UI より広い · ズーム `−` `＋` `□` はヘッダー中央。
3. **一覧へ戻る**（一覧からの導線）が機能すること。
4. **テスト入力**中に右一覧で別点を選んでも **テスト入力モード維持**（連続入力）。
5. 公差 **上限左/下限右**（[§UI/UX](../knowledge-base/KB-320-kiosk-part-measurement.md#検査図面-uiux-符号付き公差-2026-06-03) と整合）。

### トラブルシュート

| 症状 | 確認 |
|------|------|
| ヘッダーが旧 **2行 Input** | Pi5 HEAD ≥ **`5274f1ee`**（`dcc82226` のみだと右ペインだけ新 UI）· 強制リロード |
| 上辺に横一覧 | 旧 SPA · 同上 |
| テスト入力が一覧クリックで中断 | HEAD ≥ **`5274f1ee`** |
| 検査数だけ3行目 | [§フラット band](#検査図面-作成改版ヘッダー-フラット-band-2026-06-04) · HEAD ≥ **`d96da485`** |
| 戻る先がおかしい | [KB-320 §戻り先](../knowledge-base/KB-320-kiosk-part-measurement.md#検査図面-戻り先ナビ-2026-06-03) — allowlist 外は一覧 fallback |

## 自主検査・検査図面 仕様拡張（2026-06-03） {#自主検査-検査図面-仕様拡張-2026-06-03}

正本: [KB-320 §仕様拡張 本番](../knowledge-base/KB-320-kiosk-part-measurement.md#自主検査-検査図面-仕様拡張-本番-2026-06-03) · [deployment.md §2026-06-03](../guides/deployment.md#kiosk-self-inspection-four-modes-and-tolerance-2026-06-03) · ブランチ **`feat/inspection-drawing-count-and-tolerance`** · **`2f3979ce`**

### デプロイ

1. **push 済み**の `feat/inspection-drawing-count-and-tolerance`（または **`main` マージ後**は `main`）を用意する。
2. `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`（LAN のみのとき `denkon5sd02@192.168.10.230`）。
3. **Pi5 先行**: `./scripts/update-all-clients.sh <ref> infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`
4. Pi5 で **管理画面**・**キオスク検査図面/自主検査**を目視確認。
5. **Pi4×4** を `--limit` 1 台ずつ同コマンドで順次（`raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`）。
6. 各 Pi4 でキオスク **強制リロード**（§6.6.4）後、下記「実機確認ポイント（拡張）」を実施。

### 実機確認ポイント（拡張）

1. **管理** `/admin/tools/part-measurement-templates` — 自主検査 **全数/1件/最初最終/指定数** の保存・改版（`fixed_count` 件数上限 = 指示数）。
2. **検査図面** テンプレ新規/改版 — 測定点 **丸数字**（削除後の欠番再利用）· **基準値+符号付き下限/上限公差** 保存 · 上辺 **測定点一覧** から右ペイン編集 · 名称 **固定候補 select** · 既存「基準値未設定」行の上下限が意図せず変わらないこと（[KB-320 §UI/UX](../knowledge-base/KB-320-kiosk-part-measurement.md#検査図面-uiux-符号付き公差-2026-06-03)）。
3. **自主検査** — `first_last` で **最初/最終** ラベル · `fixed_count` で N 件ボタン · 旧 `full` セッション再開で **必要件数ぶん** ボタン · 測定値 **候補 dropdown + 手入力**（候補 >200 件は手入力のみ）。
4. **検査図面 本番記録** — 測定値入力が **自由入力のまま**（候補 dropdown なし）であること。
5. **順位ボード** の **検** から再入場できること。

### トラブルシュート（拡張）

| 症状 | 確認 |
|------|------|
| Mac で `https://100.106.158.2/admin` が開けない | Mac に **`tag:admin`** があるか · [KB-278](../knowledge-base/infrastructure/security.md#kb-278-tailscale経由で-https-admin-にアクセスできないtagadmin-欠落) |
| `migrate deploy` が `FIXED_COUNT` で失敗 | 2 段 migration が揃っているか（[KB-320](../knowledge-base/KB-320-kiosk-part-measurement.md#自主検査-検査図面-仕様拡張-本番-2026-06-03)） |
| キオスクだけ旧仕様 | Pi5 `web` ref · Pi4 強制リロード |
| 順位ボード **検** → 自主検査で図面だけ空白 | [KB-320 §図面空白](../knowledge-base/KB-320-kiosk-part-measurement.md#self-inspection-session-drawing-blank-2026-06-03) · [§図面空白 Runbook](#自主検査セッション図面空白-2026-06-03) — API/storage **200** なら **`web` レイアウト**（`9f3f0bac` 以降）· Pi4 は **強制リロード** |
| Pi4 画面真っ白 · TS `curl` 000 · LAN 200 | [KB-384](../knowledge-base/infrastructure/security.md#kb-384-pi4-キオスク非表示tailscale-再認証後の-netmap-未同期) — `tailscaled` 再起動 · `tag:kiosk --reset` · `kiosk-launch.sh` を `100.106.158.2` に戻す |
| Pi4 `_appRef` が古い | Pi4 で `git pull` しない · `update-all-clients.sh main --limit raspberrypi4`（実績 **`20260603-115435-29435`**） |
| Mac admin 不通 | [KB-278](../knowledge-base/infrastructure/security.md#kb-278-tailscale経由で-https-admin-にアクセスできないtagadmin-欠落) · Pi5 [KB-385](../knowledge-base/infrastructure/security.md#kb-385-pi5-tailscale-needslogin-と-node-key-失効) |
| 検査図面作成で **図面が小さい**（旧 UI） | `pointListSlot` + 2行ヘッダー — **作成/改版は 2026-06-03 改善済**（[§作成レイアウト](#検査図面-作成-layout-return-nav-2026-06-03)）· Pi5 ≥ **`5274f1ee`** + 強制リロード |

### Pi4 再デプロイ（研削メイン · TS 復旧後 · 2026-06-03）

```bash
export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"
./scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml \
  --limit raspberrypi4 --detach --follow
```

- **前提**: Pi4 で `tailscale ping 100.106.158.2` 成功 · `curl` キオスク URL が **200**
- **確認**: `git -C /opt/RaspberryPiSystem_002 rev-parse --short HEAD` が Pi5 と一致 · Firefox URL の `_appRef` が同 SHA

---

## 自主検査セッション図面空白（2026-06-03） {#自主検査セッション図面空白-2026-06-03}

正本: [KB-320 §図面空白](../knowledge-base/KB-320-kiosk-part-measurement.md#self-inspection-session-drawing-blank-2026-06-03) · [deployment.md §図面空白](../guides/deployment.md#kiosk-self-inspection-session-drawing-blank-2026-06-03) · **`9f3f0bac`** · **`main` マージ**

### 仕様（要点）

- 対象画面: `/kiosk/part-measurement/self-inspection/sessions/:sessionId`（順位ボード **検** からの再入場を含む）。
- 図面列は検査図面 Create/Edit と同じ **`inspectionDrawingCanvasColumnClassName`**。
- 表示フェーズ: `missing` / `loading` / `error` / `canvas`（`selfInspectionSessionDrawingPanelState.ts`）。
- API/DB 変更なし。図面バイナリは既存 `usePartMeasurementDrawingBlobUrl`。

### デプロイ（標準）

1. **push 済み**の `fix/self-inspection-session-drawing-display`（**`main` マージ後**は `main`）。
2. `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`
3. **Pi5**: `./scripts/update-all-clients.sh <ref> infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`
4. 必要な **Pi4** を 1 台ずつ `--limit`（実績: **`raspi4-kensaku-stonebase01`** · Detach **`20260603-132523-31144`**）。
5. 各 Pi4 でキオスク **強制リロード**後、下記「実機確認」を実施。

### 実機確認

1. 順位ボードで図面あり行の **検** を押す。
2. 自主検査入力で **測定値パネル + 図面キャンバス** が表示されること。
3. 図面パスあり: 一瞬 **読込中** ののちキャンバス（**「図面がありません」だけ**が続くのは NG）。
4. 取得失敗時: **図面パネル内** にエラー（ヘッダー重複なし）。

### トラブルシュート

| 症状 | 対処 |
|------|------|
| storage 200 なのに空白 | Pi5 `web` が **`9f3f0bac` 以降**か · [KB-320 トラブルシュート](../knowledge-base/KB-320-kiosk-part-measurement.md#トラブルシュート本件) |
| Pi4 のみ旧 UI | `git pull` しない · `update-all-clients.sh` · **強制リロード** · `_appRef` と Pi5 HEAD 一致 |

---

## 自主検査・セッション操作ボタン活性（2026-06-04） {#自主検査-セッション操作ボタン活性-2026-06-04}

正本: [KB-320 §ボタン活性](../knowledge-base/KB-320-kiosk-part-measurement.md#自主検査-セッション操作ボタン活性-2026-06-04) · [deployment §ボタン活性](../guides/deployment.md#kiosk-self-inspection-session-button-actions-2026-06-04) · ブランチ **`feat/kiosk-self-inspection-button-actions`** · **`4f44dbb9`** · **Web のみ**

### デプロイ（標準）

1. **`main` マージ後**は第2引数 **`main`**（マージ前は `feat/kiosk-self-inspection-button-actions`）。
2. `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`
3. **Pi5 先行**: `./scripts/update-all-clients.sh <ref> infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`
4. Pi5 で Phase12 `./scripts/deploy/verify-phase12-real.sh`（任意だが推奨）と、必要なら `docker exec docker-web-1` でバンドルに **`自主検査を完了`** を確認。
5. Pi4 を 1 台ずつ `--limit`（`raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`）。
6. 各 Pi4 **強制リロード**（§6.6.4）後、下記「手動確認」を実施。

| ホスト | Detach Run ID | Git HEAD | 備考 |
|--------|---------------|----------|------|
| `raspberrypi5` | **`20260604-205746-21197`** | **`4f44dbb9`** | `failed=0` · **web** 再ビルド |
| `raspberrypi4` | **`20260604-210423-13676`** | **`4f44dbb9`** | `kiosk-browser` 再起動 |
| `raspi4-robodrill01` | **`20260604-210915-5507`** | **`4f44dbb9`** | 同上 |
| `raspi4-fjv60-80` | **`20260604-211304-30742`** | **`4f44dbb9`** | 同上 |
| `raspi4-kensaku-stonebase01` | **`20260604-211651-9374`** | **`4f44dbb9`** | 同上 |

### 手動確認（Pi4/Pi5）

1. 未保存の測定値があるときだけ **入力を保存** が有効。変更なし・空欄・公差外ではグレーアウトし、**理由**が表示されること。
2. 必要入力件がすべて保存済み・画面上に未保存ドラフトがないときだけ **自主検査を完了** が有効。不足時は件数付き理由表示。
3. **手動**モードで未完了測定点があるときだけ **再開** が有効。**ガイド中**はグレーアウト。
4. **完了**押下中は保存ボタンと値入力がロックされること（二重送信防止）。
5. 1 件目 **入力を保存** 成功後、次の未保存 required slot へ **自動切替** し **guided** が再開すること（全件保存済みなら manual のまま **自主検査を完了** 導線）。
6. 手動で他入力件をタップした場合は **manual** のまま。**再開** で guided 復帰すること。
7. 全点 OK だが未保存のとき **再開** は保存促しメッセージ、保存済みで全点 OK のときは「未完了の測定点はありません」となること。
8. **最終**（`first_last`）入力件タップで図面が真っ黒にならず、1 回で表示・guided 再開できること。

### 単体テスト

```bash
cd apps/web && pnpm exec vitest run \
  src/features/part-measurement/__tests__/selfInspectionSessionActionState.test.ts \
  src/features/part-measurement/__tests__/selfInspectionEntrySlots.test.ts
```

---

## 自主検査・セッション ボタンUI統一 + 操作誘導（2026-06-05） {#自主検査-セッション-ボタンui統一-2026-06-05}

正本: [KB-320 §ボタンUI](../knowledge-base/KB-320-kiosk-part-measurement.md#自主検査-セッション-ボタンui統一-2026-06-05) · [deployment §ボタンUI](../guides/deployment.md#kiosk-self-inspection-session-button-ui-2026-06-05) · [要件](../design-previews/kiosk-self-inspection-session-buttons-requirements.md) · ブランチ **`feat/kiosk-self-inspection-button-ui`** → **`main` マージ** · **`f2b374f5`** / **`ffdaebda`** · **Web のみ**

### デプロイ（標準）

1. **`main` マージ後**は第2引数 **`main`**（マージ前は `feat/kiosk-self-inspection-button-ui`）。
2. `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`
3. **Pi5 先行**: `./scripts/update-all-clients.sh <ref> infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`
4. Pi5 で Phase12 `./scripts/deploy/verify-phase12-real.sh`（推奨）と、必要なら:

```bash
ssh denkon5sd02@100.106.158.2 'docker exec docker-web-1 sh -c "grep -l ring-sky-400 /srv/site/assets/*.js"'
```

5. Pi4 を 1 台ずつ `--limit`（`raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`）。
6. 各 Pi4 **強制リロード**（§6.6.4）後、下記「手動確認」を実施。

| ホスト | Detach Run ID | Git HEAD | 備考 |
|--------|---------------|----------|------|
| `raspberrypi5` | **`20260605-105452-27065`** | **`ffdaebda`** | `failed=0` · **web** 再ビルド · **Pi5 目視 OK** |
| Pi4×4 | — | — | **未** |

### 手動確認（Pi4/Pi5）

1. 全ボタンに **白枠なし**（`border-0` 相当の見た目）。
2. 押せるボタンは **同じスレート背景**（保存だけ緑・選択だけシアン等の色分けなし）。
3. 押せないボタンは保存・完了・再開で **同じ弱さ**（全体 `opacity` / `grayscale` なし）。
4. **入力を保存** は `saveActionState.enabled` のときだけ **青外枠**（`ring-sky-400`）。
5. **自主検査を完了** は `completeActionState.enabled` のときだけ **青外枠**。
6. **再開**・入力件チップ・ズームに **青外枠なし**。
7. 青外枠の有無でボタンサイズやヘッダー詰まりが変わらないこと。
8. §ボタン活性の運用フロー（保存 → manual → 件切替 → 再開 → guided → 完了）が維持されること。

### 単体テスト

```bash
cd apps/web && pnpm exec vitest run \
  src/features/part-measurement/__tests__/selfInspectionKioskTheme.test.ts \
  src/features/part-measurement/__tests__/SelfInspectionKioskButton.test.tsx
```

### トラブルシュート

| 症状 | 対処 |
|------|------|
| 旧 UI（緑保存・白枠・シアン選択） | Pi5 HEAD **`f2b374f5` 以降** · Pi4 **強制リロード** |
| 保存可能なのに青外枠なし | `enabled` 判定（§ボタン活性）· HEAD **`ffdaebda` 以降** |
| 再開に青外枠 | 誤ビルド — バンドル再確認 |

---

## 自主検査・セッション右ペイン入力改善（2026-06-09） {#自主検査-セッション右ペイン入力改善-2026-06-09}

正本: [KB-320 §右ペイン入力改善](../knowledge-base/KB-320-kiosk-part-measurement.md#自主検査-セッション右ペイン入力改善-2026-06-09) · ブランチ **`feat/kiosk-self-inspection-right-pane-inputs`** · 代表 **`58062ba7`** · CI **`27199280343`** · **Web のみ**

### デプロイ（標準）

1. 第2引数 **`feat/kiosk-self-inspection-right-pane-inputs`**（`main` マージ後は **`main`**）。
2. `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`
3. **Pi5 先行**: `./scripts/update-all-clients.sh <ref> infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`
4. Pi5 で `./scripts/deploy/verify-phase12-real.sh`（推奨）と、必要なら:

```bash
ssh denkon5sd02@100.106.158.2 'docker exec docker-web-1 sh -c "grep -l data-self-inspection-point-summary-list /srv/site/assets/*.js"'
```

5. Pi4 を 1 台ずつ `--limit`（`raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`）。
6. 各 Pi4 はデプロイ時 **`kiosk-browser` 再起動**で Pi5 SPA を再取得（旧 bundle 残存時は **強制リロード** §6.6.4）。

| ホスト | Detach Run ID | Git HEAD | 備考 |
|--------|---------------|----------|------|
| `raspberrypi5` | **`20260609-193442-8328`** | **`58062ba7`** | `failed=0` · **web** 再ビルド · バンドル **`index-cpu1LH6r.js`** |
| `raspberrypi4` | **`20260609-194132-22526`** | **`58062ba7`** | `failed=0` · `kiosk-browser` 再起動 |
| `raspi4-robodrill01` | **`20260609-194647-22669`** | **`58062ba7`** | `failed=0` · `kiosk-browser` 再起動 |
| `raspi4-fjv60-80` | **`20260609-195030-8659`** | **`58062ba7`** | `failed=0` · `kiosk-browser` 再起動 |
| `raspi4-kensaku-stonebase01` | **`20260609-195427-22010`** | **`58062ba7`** | `failed=0` · `kiosk-browser` 再起動 |

**本番反映（2026-06-09）**: 上記 5 台すべて **`failed=0`**。Phase12 全台完了後 **`PASS 43 / WARN 0 / FAIL 0`**（約 **55s**）。

### 検証結果（2026-06-09）

| 区分 | 結果 |
|------|------|
| **自動** | Pi5 バンドルに `data-self-inspection-point-summary-list` · `min-h-8`（`actionCompact`）を確認。Phase12 **43/0/0**（Pi5 単独・全台完了後の 2 回）。全 Pi4 `deploy-status` / `status-agent` **PASS**。 |
| **手動（キオスク）** | 下記 1–7 は **現場目視未記録**。旧 UI 疑い時は Pi5 HEAD **`58062ba7` 以降** と Pi4 **強制リロード**（§6.6.4）を先に確認。 |

### 仕様・知見（再開用）

- **対象画面**: 順位ボード **検** → `/kiosk/part-measurement/self-inspection/sessions/:sessionId` 右ペインのみ。**API/保存/完了/ガイド活性は不変**。
- **UI**: 候補+手入力 **横一列** · 公差 **`text-2xl`** · 保存/完了 **`size="actionCompact"`** · 測定点一覧 **常時表示**（タップ選択のみ）。
- **状態正本**: `measurementPointInputStatus.ts` — 一覧・値入力パネル・ガイドが **empty/ok/ng/invalid/公差不備** を共有。
- **blur 競合**: 一覧 `onPointerDownCapture` + `data-self-inspection-point-summary-list` を chrome focus 判定へ追加。
- **Pi4**: `git pull` 不要。Pi5 配信 SPA を `kiosk-browser` 再起動または強制リロードで取得。

### 未完了

- 現場での手動確認 1–7（Runbook 下記）の **目視 OK 記録**は未実施。自動検証のみ完了。

### 手動確認（Pi4/Pi5）

1. 順位ボード **検** → セッション入室。
2. 右ペインで候補 dropdown と手入力が **横一列**、公差表示が **大きい** こと。
3. **入力を保存** / **自主検査を完了** が従来より **薄型**（フォントは維持）で、青外枠契約が維持されること。
4. ボタン下に **測定点一覧** が常時表示され、入力値と OK/NG/未入力/不正/公差不備が **即時反映** されること。
5. 一覧タップで測定点が切り替わり、図面選択と整合すること。
6. **手入力欄フォーカス中に一覧をタップ**しても、意図しないガイド進行が起きないこと。
7. §ボタン活性・§ガイド polish の既存フロー（保存 → 件切替 → 再開 → 完了）が維持されること。

### 単体テスト

```bash
cd apps/web && pnpm exec vitest run \
  src/features/part-measurement/inspection-drawing/__tests__/measurementPointInputStatus.test.ts \
  src/features/part-measurement/inspection-drawing/__tests__/InspectionDrawingValuePanel.test.tsx \
  src/features/part-measurement/inspection-drawing/__tests__/InspectionDrawingPointSummaryList.test.tsx \
  src/features/part-measurement/inspection-drawing/inspectionDrawingKioskUi.test.ts \
  src/features/part-measurement/__tests__/selfInspectionKioskTheme.test.ts \
  src/features/part-measurement/__tests__/SelfInspectionKioskButton.test.tsx
```

---

## 自主検査・ガイド polish（倍率 2.0）（2026-06-04） {#自主検査-ガイド-polish-倍率2-0-2026-06-04}

正本: [KB-320 §ガイド polish](../knowledge-base/KB-320-kiosk-part-measurement.md#自主検査-ガイド-polish-倍率2-0-2026-06-04) · [deployment §polish](../guides/deployment.md#kiosk-self-inspection-guided-zoom-2-polish-2026-06-04) · ブランチ **`feat/kiosk-self-inspection-guided-polish`** → **`main` マージ** · **`fb10f0e0`** · **Web のみ**

### デプロイ（標準）

1. **`main` マージ後**は第2引数 **`main`**（マージ前は `feat/kiosk-self-inspection-guided-polish`）。
2. `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`
3. **Pi5 先行**: `./scripts/update-all-clients.sh <ref> infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`
4. Pi5 目視 OK 後、Pi4 を 1 台ずつ `--limit`（`raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`）。
5. 各 Pi4 **強制リロード**（§6.6.4）後、下記「手動確認」を実施。

| ホスト | Detach Run ID | Git HEAD | 備考 |
|--------|---------------|----------|------|
| `raspberrypi5` | **`20260604-191118-31485`** | **`fb10f0e0`** | `failed=0` · **web** 再ビルド · **Pi5 目視 OK** |
| `raspberrypi5`（polish 初回） | **`20260604-181929-755`** | **`c90647ac`** | `failed=0` · 保存後 manual 等（倍率は当時 1.5 のまま） |
| Pi4×4 | — | — | **未** — Pi5 OK 後に順次 |

### 手動確認（Pi4/Pi5）

1. 順位ボード **検** → セッション入室。図面で **No.1** が **fit+4 step（2.0 倍）**付近で中央付近に表示されること。
2. 候補選択または Enter/blur で **OK** 入力後、**No.2** へ自動移動すること。
3. **NG** 入力時は同一点に留まり、次へ進まないこと。
4. **全体表示（□）** 後は **手動** 表示。勝手に再センタリングしないこと。
5. **再開** で当該入力件の未入力最小番号からガイド再開すること（同じ **2.0** 倍率）。
6. 他入力件タップ後は **手動**。**再開** で guided 復帰すること。
7. **入力を保存** 成功後は **次の未保存入力件へ自動切替 + guided 再開**（全件保存済みなら manual のまま完了導線）。保存ボタン押下の blur だけで次測定点に進まないこと。
8. 値入力パネルが向いている測定点の丸数字外周が **青系 outline** で強調されること（目視）。
9. 当該件の全測定点 OK 後、ガイド停止と保存促しメッセージ。
10. 拡大 **2 回目付近（1.5）**で図面が震えないこと。**ガイド 2.0** でも震えないこと。
11. **入力を保存** は未保存変更かつ全点 OK のときだけ押せる（変更なし・空欄・公差外ではグレーアウト＋理由表示）。
12. **自主検査を完了** は必要入力件がすべて保存済み・未保存なしのときだけ押せる（不足時は件数付き理由表示）。
13. **再開** は手動モードかつ未完了測定点があるときだけ押せる（ガイド中はグレーアウト）。

**注**: 検査図面 **ガイド試行** の倍率（1.5 固定）は対象外。

### 単体テスト

```bash
cd apps/web && pnpm exec vitest run \
  src/features/part-measurement/__tests__/selfInspectionGuidedFocus.test.ts \
  src/features/part-measurement/__tests__/useSelfInspectionGuidedFocus.test.ts \
  src/features/part-measurement/__tests__/selfInspectionSessionActionState.test.ts \
  src/features/part-measurement/__tests__/selfInspectionEntrySlots.test.ts \
  src/features/part-measurement/inspection-drawing/inspectionDrawingZoom.test.ts \
  src/features/part-measurement/inspection-drawing/inspectionDrawingMarkerStyles.test.ts \
  src/features/part-measurement/inspection-drawing/inspectionDrawingCanvasLayout.test.ts \
  src/features/part-measurement/inspection-drawing/inspectionDrawingKioskUi.test.ts
```

---

## 自主検査・ガイド付きフォーカス（2026-06-04 · 初回） {#自主検査-ガイド付きフォーカス-2026-06-04}

正本: [KB-320 §ガイドフォーカス](../knowledge-base/KB-320-kiosk-part-measurement.md#自主検査-セッション-ガイド付きフォーカス-2026-06-04) · [deployment §2026-06-04](../guides/deployment.md#kiosk-self-inspection-guided-focus-reset-trial-2026-06-04) · ブランチ **`feat/kiosk-self-inspection-guided-focus`** · **`main` マージ** · **`32c4858f`** / 同梱デプロイ **`f16cb7ca`** · **Web のみ**

### デプロイ（標準）

1. **push 済み**の `feat/kiosk-self-inspection-guided-focus`（**`main` マージ後**は第2引数 **`main`**）。
2. `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`
3. **Pi5 先行**: `./scripts/update-all-clients.sh <ref> infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`
4. Pi5 目視 OK 後、Pi4 を 1 台ずつ `--limit`（`raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`）。
5. 各 Pi4 **強制リロード**（§6.6.4）後、手動確認を実施。

| ホスト | Detach Run ID | Git HEAD | 備考 |
|--------|---------------|----------|------|
| `raspberrypi5` | **`20260604-155553-5452`** | **`f16cb7ca`** | `failed=0` · **web** 再ビルド（reset 同梱） |
| Pi4×4 | — | — | **未** — Pi5 実機 OK 後に順次 |

### 手動確認（Pi4/Pi5 · 初回は 1.5 倍）

1. 順位ボード **検** → セッション入室。図面で **No.1** が **fit+2 step（1.5 倍）**付近で中央付近に表示されること。
2. 候補選択または Enter/blur で **OK** 入力後、**No.2** へ自動移動すること。
3. **NG** 入力時は同一点に留まり、次へ進まないこと。
4. **全体表示（□）** 後は **手動** 表示。勝手に再センタリングしないこと。
5. **再開** で当該入力件の未入力最小番号からガイド再開すること（同じ **1.5** 倍率）。
6. 他入力件タップ後は **手動**。blur だけで次点に進まないこと。**再開** で guided 復帰すること。
7. 件切替・保存後の guided 挙動は [§ガイド polish](#自主検査-ガイド-polish-倍率2-0-2026-06-04) を参照。

**注**: 検査図面 **ガイド試行** の倍率（1.5 固定）は対象外。現行の手動確認・単体テストは **§ガイド polish** を正とする。

---

## 自主検査フルリセット + 検査図面ガイド試行（2026-06-04） {#自主検査-フルリセット-ガイド試行-2026-06-04}

正本: [KB-320 §フルリセット・ガイド試行](../knowledge-base/KB-320-kiosk-part-measurement.md#自主検査-フルリセット-ガイド試行-2026-06-04) · [deployment §2026-06-04](../guides/deployment.md#kiosk-self-inspection-guided-focus-reset-trial-2026-06-04) · **`f16cb7ca`** · migration **`20260604120000_self_inspection_session_reset_audit`** · CI **`26935485926`**

### デプロイ（API + Web + migration）

1. ブランチを Pi5 に反映（**`main` マージ後**は `main`）。
2. `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`
3. `./scripts/update-all-clients.sh <ref> infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`
4. ログで **`Run prisma migrate deploy`** が success · **`SelfInspectionSessionResetAuditLog`** 作成を確認。
5. `./scripts/deploy/verify-phase12-real.sh` — 期待 **43/0/0**。
6. Pi5 実機 OK 後、Pi4 を 1 台ずつ `--limit` + **強制リロード**。

**Pi5 実績（2026-06-04）**: Detach **`20260604-155553-5452`** · HEAD **`f16cb7ca`** · `failed=0` · migrations **104 件 up to date** · web バンドルに `guidedTrial` / `confirmDestructiveReset` 確認済。

### フルリセット（セッション画面のみ）

- API: `POST /api/part-measurement/self-inspection/sessions/:id/reset`
- Body: `confirmDestructiveReset: true` 必須。完了済みは `confirmCompletedSessionReset: true` も必須。`requestId`（監査相関）必須。
- サーバー: **`lockSessionRow` 後**に preflight → 削除 → **ロック時点の最新 active THREE_KEY テンプレ**で新セッション → `newSession`（**1 トランザクション**）。
- UI: セッション画面上部 **初期化** → 2 段階確認 → 成功後 `replace` で新 `/sessions/:id` へ。保存中・完了中は無効。
- 順位ボード: React Query 無効化 + **`purgeLeaderboardBoardCacheForScheduleRow(scheduleRowId)`**（該当 row の board cache のみ）。

### ガイド試行（検査図面 作成/改版のみ）

- モード **ガイド試行**: 非永続。OK のみ次の `markerNo` へ（配列 index → id で tie-break）。**再開** は未完了の最小番号。
- 点削除・図面差し替えで試行 state リセット。履歴版 readOnly でも試行可（保存なしの文言あり）。
- DEV: `/dev/kiosk-inspection-drawing-create` も本番と同 hook 配線（プレビュー parity）。

### 実機確認（Pi5 先行）

**フルリセット**

1. 順位ボード **検** → 自主検査セッションで数点入力。
2. **初期化** → 1 段目（破壊的警告）→ 2 段目（未完了/完了で文言差）→ 実行。
3. URL が **新しい session UUID** に `replace` され、入力が空であること。
4. 完了済みセッションでは 2 段目に **完了実績削除** の明示があること。
5. 順位ボードの **検** 色がリセット後状態と矛盾しないこと（必要なら board 再読込）。

**ガイド試行**

1. **検査図面** → 作成または改版 → ツールバー **ガイド試行**。
2. テスト値を **公差内 OK** で Enter/blur → 次の `markerNo` へ自動フォーカス。
3. **再開** で未完了最小番号へ戻ること。
4. 点削除・図面差し替えでガイド state がリセットされること。

### トラブルシュート

| 症状 | 対処 |
|------|------|
| reset 後も旧 session URL | mutation 成功後の `replace` 導線 · Network で `newSession.id` |
| 完了済みなのに 1 段目だけで通る | API が 400 — `confirmCompletedSessionReset` · サーバーがロック後 `completedAt` を見ているか（HEAD **`f16cb7ca` 以降**） |
| migrate 失敗 | Pi5 ログの `prisma migrate deploy` · `20260604120000` の適用有無 |
| ガイド試行が進まない（DEV） | プレビューに `useInspectionDrawingGuidedTrial` 未配線 — [KB-320 §レビュー知見](../knowledge-base/KB-320-kiosk-part-measurement.md#自主検査-フルリセット-ガイド試行-2026-06-04) |
| Pi4 のみ旧 UI | `git pull` しない · Ansible + **強制リロード** |

### 単体テスト（ローカル）

```bash
cd apps/api && pnpm exec vitest run src/services/part-measurement/__tests__/self-inspection-reset-preflight.test.ts
cd apps/web && pnpm exec vitest run \
  src/features/part-measurement/inspection-drawing/__tests__/inspectionDrawingGuidedTrial.test.ts \
  src/features/part-measurement/__tests__/selfInspectionGuidedFocus.test.ts
```

**integration（API）**: 一時 DB は `pgvector/pgvector:pg16` · `part-measurement.integration.test.ts` の reset ケース。

---

## 自主検査 MVP（2026-06-01）

詳細・背景: [KB-320 §自主検査 MVP](../knowledge-base/KB-320-kiosk-part-measurement.md#自主検査-mvp-2026-06-01)。

### キオスクナビ

| ヘッダータブ | 遷移先（既定） | アクティブになるパス |
|--------------|----------------|----------------------|
| **自主検査** | `/kiosk/part-measurement/self-inspection` | `/kiosk/part-measurement/self-inspection/*` |

- **一覧**: `/kiosk/part-measurement/self-inspection`
  - 生産スケジュール行をもとに、**図面ありの `THREE_KEY` テンプレ**だけを対象表示。
  - 同じ行に対応する既存セッションがあれば **再開**、なければ **開始**。
- **入力画面**: `/kiosk/part-measurement/self-inspection/start` または `/kiosk/part-measurement/self-inspection/sessions/:sessionId`
  - 図面キャンバスと測定値パネルは既存検査図面 UI を再利用。
  - 画像は **`usePartMeasurementDrawingBlobUrl`** で Blob 化し、`x-client-key` 付きで取得する。
- **順位ボード導線**:
  - 各行で図面ありなら **「検」** ボタンを表示。
  - 状態色は **白=未開始 / 黄=入力中 / 青=完了**。
  - ボタンは `/self-inspection/start?...` の query を持ち、同じ業務キーで resolve-or-create する。

### テンプレ設定

- 管理画面 `/admin/tools/part-measurement-templates` に以下を追加:
  - `selfInspectionMode`: `全数` / `抜き取り1個` / `最初と最後` / `指定数`（API: `full` / `single` / `first_last` / `fixed_count`）
  - `selfInspectionFixedCount`: `指定数` 時のみ必須（`1 <= 件数 <= 指示数`）。`sample` は API 互換エイリアス
- 一覧/詳細 DTO にも同値を返す。
- 検査図面一覧 API `GET /api/part-measurement/inspection-drawing/templates` でも要約 DTO に返すため、キオスク一覧と将来の導線で再利用できる。

### データ構造

- `SelfInspectionSession`
  - 1 つの生産対象コンテキストに対する自主検査作業単位。
  - 一意キーは `productNo + processGroup + resourceCd + scheduleRowId` の `sessionBusinessKey`（日程行単位。改版でテンプレ ID が変わっても同一セッション）。`resolve-or-create` は `scheduleRowId` と `fseiban` 必須。
  - **マイグレーション `20260601120000_self_inspection_session_business_key_v2`**: 旧キー（templateId 含む）から新キーへ移行する。同一日程行の重複セッションは **エントリ数最多 → 未完了優先 → 更新日時が新しい** 順で 1 件を残し、空の重複は削除、非衝突の `entryIndex` のみ勝者へ移す。移行後も重複にエントリが残る場合は **マイグレーションが例外で停止**（手動統合が必要）。

#### 業務キー移行の事前確認（本番・ステージング）

`20260601090000_add_self_inspection_mvp` 適用済みで、改版前の二重セッションが疑われるとき、デプロイ前に PostgreSQL で重複候補を確認する:

```sql
SELECT
  CONCAT(
    BTRIM(split_part(s."sessionBusinessKey", '::', 1)), '::',
    BTRIM(split_part(s."sessionBusinessKey", '::', 2)), '::',
    BTRIM(split_part(s."sessionBusinessKey", '::', 3)), '::',
    COALESCE(NULLIF(BTRIM(s."scheduleRowId"), ''), BTRIM(split_part(s."sessionBusinessKey", '::', 5)))
  ) AS new_key,
  COUNT(*) AS session_count,
  COUNT(*) FILTER (WHERE EXISTS (
    SELECT 1 FROM "SelfInspectionLotEntry" e WHERE e."sessionId" = s.id
  )) AS sessions_with_entries
FROM "SelfInspectionSession" s
WHERE array_length(string_to_array(s."sessionBusinessKey", '::'), 1) = 5
GROUP BY 1
HAVING COUNT(*) > 1;
```

- `sessions_with_entries > 1` の行がある場合、移行は **entryIndex 衝突時に失敗**しうる。先に不要な空セッションを削除するか、運用でどちらを正とするか決めてから `prisma migrate deploy` する。
- 移行が失敗した環境で SQL を直したあと再実行する場合、失敗した migration を `prisma migrate resolve` で整理してから再デプロイする（既に成功済みの環境では当該 migration は再実行されない）。
- `SelfInspectionLotEntry`
  - 全数なら 1 個分、抜取なら 1 サンプル分の入力。
- `SelfInspectionMeasurementValue`
  - 各測定点の数値。

### 完了条件

- `全数`: `expectedEntryCount = plannedQuantity`
- `指定数`: `expectedEntryCount = selfInspectionFixedCount`（旧 `sample` は DB 上 `FIXED_COUNT`）
- `最初と最後`: 指示数 >= 2 のみ。入力 index は `0` と `指示数-1`（ラベル「最初」「最終」）
- `completedAt` は必要件数到達後に **明示的な完了 API** で確定する。

### 実機確認ポイント

1. **自主検査** タブが **持出** の隣に表示される。
2. 一覧で図面付き対象だけが表示される。
3. **開始** で全画面入力へ遷移し、図面が表示される。
4. **再開** で既存 entry が反映される。
5. 順位ボードの **検** ボタンから同じセッションへ入れる。
6. `抜取` テンプレでは entry ボタン数が `sampleSize` と一致する。
7. 保存後に状態が **未開始→入力中→完了** と進む。

### 検査図面 · DEV プレビュー（本番パリティ）

開発者が Mac 上でレイアウトを本番に近い状態で確認する手順。正本: [ADR-20260530](../decisions/ADR-20260530-kiosk-inspection-drawing-dev-preview-parity.md) · [KB-320 §プレビュー](../knowledge-base/KB-320-kiosk-part-measurement.md#検査図面-preview-parity-2026-05-30)。

1. リポジトリで `pnpm dev`（またはプロジェクト標準の Web 開発サーバー）を起動する。
2. ブラウザで次を開く（**認証不要** · fixture データ）:
   - 一覧: **`/dev/kiosk-inspection-drawing-library`**
   - 作成/編集: **`/dev/kiosk-inspection-drawing-create`**
3. 画面上部の DEV バー（fixed）以外は **本番と同じ `KioskLayout` + 共有コンポーネント** で描画される。`transform: scale` は使わない。
4. UI 変更時は **共有コンポーネント**（`InspectionDrawingLibraryFilterBar` / `InspectionDrawingPointSettingsPanel` / `InspectionDrawingCreateToolbar`）を編集し、DEV と本番の両方が同時に変わることを確認する。
5. Pi5 本番反映は [deployment.md §プレビュー parity](../guides/deployment.md#kiosk-inspection-drawing-preview-parity-2026-05-30) の `update-all-clients.sh`（**Pi5 先行** → 目視 OK 後 Pi4）。

**注意**: DEV ルートは本番 Docker イメージには含まれるが、現場オペレータの導線ではない。現場確認は **`/kiosk/part-measurement/inspection`** を使う。

### 検査図面 · テンプレ編集・認可付き図面読込（2026-05-31） {#検査図面-テンプレ編集-認可付き図面読込-2026-05-31}

一覧から **編集**で図面が表示されない事象の確認手順。正本: [KB-320 §認可付き図面読込](../knowledge-base/KB-320-kiosk-part-measurement.md#検査図面-テンプレ編集-認可付き図面読込-2026-05-31) · [deployment §2026-05-31](../guides/deployment.md#kiosk-inspection-drawing-edit-image-and-zoom-jitter-2026-05-31)。

1. キオスクで **強制リロード**（[verification-checklist.md §6.6.4](../guides/verification-checklist.md)）。
2. **検査図面** → 一覧 → 図面付きテンプレの **編集**（`/inspection/templates/:id/edit`）。
3. **図面が表示**され、測定点が図面上に重なること（測定点だけ・図面空白は NG）。
4. **新規作成 → 保存**後の自動遷移（編集 URL）でも図面が出ること。
5. 失敗時: 画面上に **「図面の読み込みに失敗しました」** 等が出ないか。DevTools で `/api/storage/part-measurement-drawings/` が **401** になっていないか（直 `<img src>` 残存の疑い）。

**ズーム震え**は下記 [§キャンバスズーム](#検査図面-キャンバスズーム-2026-05-30) 手順 4 を併用。

### 検査図面 · キャンバスズーム（2026-05-30） {#検査図面-キャンバスズーム-2026-05-30}

図面表示のズーム操作の確認手順。正本: [KB-320 §キャンバスズーム](../knowledge-base/KB-320-kiosk-part-measurement.md#検査図面-canvas-zoom-2026-05-30) · [deployment §キャンバスズーム](../guides/deployment.md#kiosk-inspection-drawing-canvas-zoom-2026-05-30)。

1. キオスクで **強制リロード**（[verification-checklist.md §6.6.4](../guides/verification-checklist.md)）。
2. **検査図面** → テンプレ **新規** または **編集**（図面画像あり）。記録 **図面 edit** でも同様。
3. ヘッダー帯の **図面ファイル選択と切削/研削のあいだ**に **`−` `＋` `□`** があること（倍率数字なし）。
4. **`＋`** で拡大 → 図面エリア内を **スクロール**して細部を見られること。**`＋` を連続（1.25 / 1.5 / 1.75 相当）しても図面が震えない**こと。
5. **`□`** で全面表示に戻ること。
6. **点を配置**モードで、拡大後に **ドラッグパン**しても **測定点が増えない**こと。短いタップで 1 点追加されること。
7. 図面表示枠の **縦の高さ**が、ズーム導入前と同程度であること（ヘッダー下に余計なツールバー行がないこと）。
8. 開発 Mac: `pnpm dev` → `/dev/kiosk-inspection-drawing-create`（fixture 図面あり）。

### 検査図面 · 一覧フィルタ overflow（2026-05-30） {#検査図面-一覧フィルタ-overflow-2026-05-30}

一覧フィルタの資源欄が工程ボタンに重なって見える事象の確認手順。正本: [KB-320 §フィルタ overflow](../knowledge-base/KB-320-kiosk-part-measurement.md#検査図面-library-filter-overflow-2026-05-30) · [deployment §overflow](../guides/deployment.md#kiosk-inspection-drawing-library-filter-overflow-2026-05-30)。

1. キオスクで **強制リロード**（[verification-checklist.md §6.6.4](../guides/verification-checklist.md)）。
2. **検査図面** → 一覧（`/kiosk/part-measurement/inspection`）。
3. フィルタ行で次を確認する:
   - 品番入力と資源 select の間に **視認できる隙間**
   - 資源 select が **工程の「すべて/切削/研削」ボタンにかぶらない**
   - **「履歴を含む」** が全文表示される
4. （任意）**新規** → 資源 select の幅が品番・テンプレ名と **同程度（約 10.5rem）** であること。
5. 開発 Mac では `pnpm dev` → `/dev/kiosk-inspection-drawing-library`（本番と同コンポーネント · fixture）。

## オペレータ手順（キオスク）

1. **推奨**: 生産スケジュール（または手動順番の下ペイン一覧）の行の **測定** 列から開く（`find-or-open` で下書き再開・確定閲覧・新規・テンプレ作成へ振り分け）。
2. またはヘッダの **部品測定** から `/kiosk/part-measurement` を開き、**工程** を切削 / 研削に合わせる（スケジュールから開いた場合は資源CDに応じて自動設定される）。画面上部の **「測定値入力中（新しい順）」** で、入力中の下書きを **品名・機種名付き**で選べる（**測定値入力中を更新** で再取得）。
3. **バーコードスキャン** で移動票を読み取り、**日程を照会** で `ProductNo` を解決する。
4. 複数候補がある場合は一覧から行を選ぶ。
5. 下書きが無ければテンプレが解決できた時点で **記録表（下書き）が作成**される（スケジュール起点・手動照会とも）。
6. **個数** を入力すると、テンプレ項目 × 個数の入力欄が現れる。
7. 必要に応じて **NFC で社員タグ** をかざす（作業者として記録）。
8. 入力は一定間隔で **自動保存** される。離脱しても同じ端末・シート ID が分かれば GET で復元可能（運用上は画面内で継続操作を推奨）。
9. 完了したら **確定** する。確定後は編集用 PATCH が想定どおり拒否される。

## 管理者手順（テンプレ）

1. 管理コンソールに ADMIN / MANAGER でログインする。
2. **部品測定テンプレ** を開く。
3. FIHNCD（品番）・**資源CD**・工程・測定項目（小数桁数を含む）を入力し **登録**する（新規は常に新バージョンとして作成され、同品番・同工程・**同資源CD**の有効版は自動で無効化される）。
4. **有効版の編集（2026-04-05）**: 一覧の **編集** で現在内容を読み込み、テンプレ名・測定項目・図面参照を変更して **保存**する。画面は「上書き」に見えるが API は **`POST /api/part-measurement/templates/:id/revise`** で **次バージョンを作成**し、同系譜の旧版を **無効**にする（**すでに作った測定シート**は、そのシート作成時のテンプレ版のまま）。**登録スコープ・品番・資源・工程**は編集時に変更できない。**候補（1要素・FHINMEI）のみ** **FHINMEI（候補キー）** を編集可能。保存前にブラウザの確認ダイアログが出る。
5. **有効版の削除（2026-04-05）**: 一覧の **削除** で **論理削除**（API **`POST /api/part-measurement/templates/:id/retire`**）。**最新の有効版のみ**対象。削除後に旧版は**自動では有効にならない**。必要なら **無効版も表示**から **有効化**する。
6. 図面付きにする場合は **図面テンプレート** で既存 visual を選ぶか、画像（PNG/JPEG/WebP）を新規アップロードする。項目ごとに **図番号（表示用）** を入れると、測定画面の列見出しに表示される。
7. 一覧は **有効版のみ**が既定。必要なら **無効版も表示**で旧版を確認できる。
8. 過去版を有効に戻す場合は一覧の **有効化** を使う。

## 確認・トラブル時

- テンプレが無い・工程が合わない: [KB-320](../knowledge-base/KB-320-kiosk-part-measurement.md) を参照。
- バーコード・カメラ: 要領書のバーコード機能と同様、ブラウザ権限とライト環境を確認（[KB-313](./kiosk-documents.md) のカメラ項も参考）。

## 実機検証（自動・手動）

- **自動（推奨）**: `./scripts/deploy/verify-phase12-real.sh` — 部品測定 `resolve-ticket` / `templates/candidates` スモーク含む。**検査図面専用 API はスクリプト未収録**（統合テスト + [KB-320](../knowledge-base/KB-320-kiosk-part-measurement.md) curl 例）。**2026-05-30 一覧ハブ（Pi5）**: **PASS 42 / WARN 1 / FAIL 0**（約 76s）。
- **手動（部品測定）**: `/kiosk/part-measurement` で **測定値入力中** 一覧・移動票照会 → 記録 → 確定（従来どおり）。
- **手動（検査図面・テンプレ）**: **検査図面** → 一覧 → 新規/編集/履歴。旧版 readOnly・有効化後編集可。
- **手動（検査図面・記録）**: 図面付きテンプレ + **数量=1** → **図面 edit**（`quantity≥2` は表形式）。**Pi4** は `main` デプロイ前はタブ未反映の可能性（KB-320）。
- **手動（自主検査）**: **自主検査** → 一覧 → **開始/再開**、または順位ボードの **検** ボタン → 入力保存 → 完了。
- **手動（管理・任意）**: **部品測定テンプレ** で編集/削除。
- **チェックリスト**: [verification-checklist.md](../guides/verification-checklist.md) **6.6.9**。

## 関連

- ADR: [ADR-20260329-part-measurement-kiosk-record.md](../decisions/ADR-20260329-part-measurement-kiosk-record.md)（Phase1） / [ADR-20260401-part-measurement-phase2-resource-cd.md](../decisions/ADR-20260401-part-measurement-phase2-resource-cd.md)（Phase2） / [ADR-20260330-part-measurement-visual-template.md](../decisions/ADR-20260330-part-measurement-visual-template.md)（visual template） / [ADR-20260404-part-measurement-template-pick-kiosk.md](../decisions/ADR-20260404-part-measurement-template-pick-kiosk.md)（候補選択・`FHINMEI_ONLY` 照合の経時追補含む） / [ADR-20260530-kiosk-inspection-drawing-dev-preview-parity.md](../decisions/ADR-20260530-kiosk-inspection-drawing-dev-preview-parity.md)（検査図面 DEV プレビュー本番契約）
- 沉浸式ヘッダー対象: `usesKioskImmersiveLayout` に `/kiosk/part-measurement` **およびその子パス**が含まれる（変更時は `kioskImmersiveLayoutPolicy.test.ts` を更新）
