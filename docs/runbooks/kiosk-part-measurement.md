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

### 検査図面 · キャンバスズーム（2026-05-30） {#検査図面-キャンバスズーム-2026-05-30}

図面表示のズーム操作の確認手順。正本: [KB-320 §キャンバスズーム](../knowledge-base/KB-320-kiosk-part-measurement.md#検査図面-canvas-zoom-2026-05-30) · [deployment §キャンバスズーム](../guides/deployment.md#kiosk-inspection-drawing-canvas-zoom-2026-05-30)。

1. キオスクで **強制リロード**（[verification-checklist.md §6.6.4](../guides/verification-checklist.md)）。
2. **検査図面** → テンプレ **新規** または **編集**（図面画像あり）。記録 **図面 edit** でも同様。
3. ヘッダー帯の **図面ファイル選択と切削/研削のあいだ**に **`−` `＋` `□`** があること（倍率数字なし）。
4. **`＋`** で拡大 → 図面エリア内を **スクロール**して細部を見られること。
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
- **手動（管理・任意）**: **部品測定テンプレ** で編集/削除。
- **チェックリスト**: [verification-checklist.md](../guides/verification-checklist.md) **6.6.9**。

## 関連

- ADR: [ADR-20260329-part-measurement-kiosk-record.md](../decisions/ADR-20260329-part-measurement-kiosk-record.md)（Phase1） / [ADR-20260401-part-measurement-phase2-resource-cd.md](../decisions/ADR-20260401-part-measurement-phase2-resource-cd.md)（Phase2） / [ADR-20260330-part-measurement-visual-template.md](../decisions/ADR-20260330-part-measurement-visual-template.md)（visual template） / [ADR-20260404-part-measurement-template-pick-kiosk.md](../decisions/ADR-20260404-part-measurement-template-pick-kiosk.md)（候補選択・`FHINMEI_ONLY` 照合の経時追補含む） / [ADR-20260530-kiosk-inspection-drawing-dev-preview-parity.md](../decisions/ADR-20260530-kiosk-inspection-drawing-dev-preview-parity.md)（検査図面 DEV プレビュー本番契約）
- 沉浸式ヘッダー対象: `usesKioskImmersiveLayout` に `/kiosk/part-measurement` **およびその子パス**が含まれる（変更時は `kioskImmersiveLayoutPolicy.test.ts` を更新）
