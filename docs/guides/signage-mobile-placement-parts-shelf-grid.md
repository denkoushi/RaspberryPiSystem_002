# サイネージ: 配膳 Android 部品棚 9 枠（`mobile_placement_parts_shelf_grid`）

## 概要

- **スロット種別**: `mobile_placement_parts_shelf_grid`（`layoutConfig.layout === 'FULL'` の先頭スロット）
- **出力**: 既存どおり API が **JPEG** を生成し、`/api/signage/current-image` で配信（Pi3 等のクライアントは変更なし）
- **データ源**: `OrderPlacementBranchState`（現在棚）。`csvDashboardRowId` があれば `CsvDashboardRow.rowData`、なければ `scheduleSnapshot` の JSON から `FHINMEI` / `FHINCD` / `FSEIBAN` / `ProductNo` を参照
- **棚ゾーン**: `西-北-02` 形式（3 セグメント）のみ集約。それ以外の `shelfCodeRaw` は **スキップ**
- **ゾーン色（9 枠）**: 黄 `#F59E0B` / 紫 `#7C3AED` / 赤 `#DC2626` / 緑 `#16A34A` / グレー `#6B7280` / 茶 `#78350F` / オレンジ `#EA580C` / 青 `#2563EB` / ピンク `#EC4899`（`parts-shelf-svg.ts` の `ZONE_FILL` と [静的プレビュー](../design-previews/pi3-signage-android-parts-shelf-preview.html) の `:root` で一致）

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

### 初回（スロット導入）

- **手順の正本**: [deployment.md](./deployment.md)（`RASPI_SERVER_HOST`・**`--detach --follow`**・**`--limit` は 1 台ずつ**。Pi3 は **リソース僅少のため単独・Pi5 成功後**）。
- **対象ホスト**: `raspberrypi5` → `raspberrypi3`（**順序固定**）。
- **ブランチ**: `feat/pi3-android-parts-signage`（マージ後は `main` でも可）。
- **Detach Run ID**（ログ名接頭辞 `ansible-update-`）: `20260413-190750-1020`（Pi5）→ `20260413-192539-10430`（Pi3）。各 **`PLAY RECAP` `failed=0` / `unreachable=0`**。
- **自動実機検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**。

### 第2回（表示修正：機種名・フォント・背景）

- **ブランチ**: `fix/mobile-placement-parts-shelf-display-and-machine`。
- **Detach Run ID**: `20260413-203007-401`（Pi5・**`failed=0`**）→ `20260413-204818-30318`（Pi3・**`PLAY RECAP failed=1`**：`signage-daily-reboot.timer` 未導入端末で **timer 起動タスク**が失敗。スクリプトは **`Summary success check: true`**・リモート **exit `0`**）。
- **自動実機検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（Pi3 `signage-lite`/timer を含む）。
- **ナレッジ**: [KB-341](../knowledge-base/infrastructure/signage.md#kb-341-mobile-placement-parts-shelf-grid-deploy) 追記

### 第3回（Ansible 安定化・`main`・本番検証）

- **コード**: `main` に [PR #131](https://github.com/denkoushi/RaspberryPiSystem_002/pull/131)〜[#134](https://github.com/denkoushi/RaspberryPiSystem_002/pull/134) をマージ済み（Pi3 デプロイ全般の安定化。スロット実装そのものの変更は含まない）。
- **Detach Run ID**（`ansible-update-`）: `20260413-222626-2374`（Pi3・**`failed=0` / `unreachable=0`**）。
- **自動実機検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**。
- **ナレッジ**: [KB-341](../knowledge-base/infrastructure/signage.md#kb-341-mobile-placement-parts-shelf-grid-deploy) 第3回・[deployment.md](./deployment.md)（知見 2026-04-13）。

## 静的プレビュー（レイアウト検討用）

- [pi3-signage-android-parts-shelf-preview.html](../design-previews/pi3-signage-android-parts-shelf-preview.html)（HTML のみ・本番 JPEG と同一ロジックではない）
