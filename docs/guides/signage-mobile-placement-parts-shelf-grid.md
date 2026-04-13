# サイネージ: 配膳 Android 部品棚 9 枠（`mobile_placement_parts_shelf_grid`）

## 概要

- **スロット種別**: `mobile_placement_parts_shelf_grid`（`layoutConfig.layout === 'FULL'` の先頭スロット）
- **出力**: 既存どおり API が **JPEG** を生成し、`/api/signage/current-image` で配信（Pi3 等のクライアントは変更なし）
- **データ源**: `OrderPlacementBranchState`（現在棚）。`csvDashboardRowId` があれば `CsvDashboardRow.rowData`、なければ `scheduleSnapshot` の JSON から `FHINMEI` / `FHINCD` / `FSEIBAN` / `ProductNo` を参照
- **棚ゾーン**: `西-北-02` 形式（3 セグメント）のみ集約。それ以外の `shelfCodeRaw` は **スキップ**

## 設定（管理コンソール）

- **表示コンテンツ**: 「配膳 Android 部品棚 9 枠（JPEG）」
- **ゾーンあたりの最大表示行数**（任意）: 空欄で **既定 12**。上限 **200**。超過分は省略し、ヘッダに `+N省略` を表示

## 表示ルール（1 行）

左から **製番（先頭 5 文字）** / **品名** / **機種名（表示用キー・最大 10 文字）**

- **品名**: `FHINMEI` → `FHINCD` → `ProductNo` の順で最初に得られたもの
- **機種名（3 列目）**: **`ProductNo` は使わない**（本システムでは製造order番号）。生産スケジュールの **MH/SH 行 `FHINMEI` を製番（`FSEIBAN`）単位で集約**した値（`fetchSeibanProgressRows`・部品検索の機種名と同系）。表示は先頭の `-` より前を半角化・大文字化し、先頭 10 文字まで

## 関連コード（実装の入口）

- 契約: `apps/api/src/services/signage/signage-layout.types.ts`
- Zod: `apps/api/src/routes/signage/schemas.ts`（`kind` ごとに `config` を `discriminatedUnion` で検証）
- 集約・SVG: `apps/api/src/services/signage/mobile-placement-parts-shelf/`
- レンダラ: `apps/api/src/services/signage/signage.renderer.ts`

## 本番デプロイ・検証（2026-04-13）

- **手順の正本**: [deployment.md](./deployment.md)（`RASPI_SERVER_HOST`・**`--detach --follow`**・**`--limit` は 1 台ずつ**。Pi3 は **リソース僅少のため単独・Pi5 成功後**）。
- **対象ホスト（本ロールアウト）**: `raspberrypi5` → `raspberrypi3`（**順序固定**。他ホストは対象外）。
- **ブランチ**: `feat/pi3-android-parts-signage`（マージ後は `main` でも可）。
- **Detach Run ID**（ログ名接頭辞 `ansible-update-`）: `20260413-190750-1020`（Pi5）→ `20260413-192539-10430`（Pi3）。各 **`PLAY RECAP` `failed=0` / `unreachable=0`**。
- **自動実機検証**: リポジトリルートで `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（2026-04-13 実測）。
- **ナレッジ**: [KB-341](../knowledge-base/infrastructure/signage.md#kb-341-mobile-placement-parts-shelf-grid-deploy)

## 静的プレビュー（レイアウト検討用）

- [pi3-signage-android-parts-shelf-preview.html](../design-previews/pi3-signage-android-parts-shelf-preview.html)（HTML のみ・本番 JPEG と同一ロジックではない）
