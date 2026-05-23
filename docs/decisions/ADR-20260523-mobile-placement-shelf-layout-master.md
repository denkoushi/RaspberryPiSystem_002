# ADR-20260523: 配膳棚レイアウトマスタ（キオスク shelf-master）

**Status**: accepted

**Context**:

- 配膳棚は `MobilePlacementShelf.shelfCodeRaw`（例 `西-北-02`）のみを正本とし、キオスク `/shelf-register` で手動登録、Zero2W は `/zero2w-assignment` で別管理している。
- 現場は **9 マクロ区画**（サイネージ `nw..se`）で部品配膳を追跡するが、**区画内フロアプラン・表示名・加工機との位置関係**は DB/API/UI 未実装（設計プレビューのみ）。
- オペレータは **表示名**（例 `Robodrill01南`）で棚を識別したい。サイネージも正本 ID のみでは現場認知が弱い。
- 区画内レイアウトは管理者、日常の **再割当**（中身移動）はオペレータと **権限を分離**する必要がある。
- ユーザー確定: 棚マスタは `MobilePlacementShelf` 拡張（新テーブル分離なし）、加工機は `ProductionScheduleResourceMaster`、段フィールド先行追加、UI は `/kiosk/mobile-placement/shelf-master` に集約、MVP 後回しなし。

**Decision**:

1. **データモデル**
   - `MobilePlacementShelf` に `displayLabel`, `tier`（nullable）, `macroZoneId` を追加。
   - レイアウト用に `MobilePlacementZoneLayout`（9 区画・gridSize 3|4・連番カウンタ）と `MobilePlacementLayoutEntity`（MACHINE|SHELF|AISLE|UNUSED、cellIndices、resourceCd、shelfId）を追加。
   - 正本 ID `shelfCodeRaw` はセル作成時に採番し **immutable**。

2. **権限**
   - `ClientDevice.shelfLayoutEditEnabled`（管理画面 `/admin/clients` で ON）。ON の端末のみレイアウト編集 API/UI。
   - 再割当（relocate）は全認証キオスク端末が実行可能。

3. **UX**
   - factory-map v2: 全体 9 マス → 区画詳細（周辺 1/3 + 通路）→ マス割当。
   - 同一 URL `/kiosk/mobile-placement/shelf-master` で編集モードと再割当モードを切替。
   - `/shelf-register`, `/zero2w-assignment` は shelf-master へ統合・redirect。

4. **ドメインロジック**
   - `@raspi-system/shelf-layout-core` に zone catalog、表示名生成、矩形隣接検証、棚番採番を集約。
   - 表示名: `{加工機名}{東|西|南|北|中央}`。加工機 0 台時 `置場-{方位}`。同区画重複時 `-2` サフィックス。

5. **再割当（Relocate）**
   - **スロット固定**: layout entity の cellIndices / shelfId は変更しない。
   - 稼働データ（`OrderPlacementBranchState`, `HaizenCurrentPlacement`, `ClientDevice.haizenPresetShelfCodeRaw`）の `shelfCodeRaw` を source → target に一括更新。
   - `displayLabel` は source → target へ移譲し、source は auto 再生成。

6. **サイネージ**
   - 部品棚グリッド行に `displayLabel` を主表示、正本 ID を小さく併記。

**Alternatives**:

- 棚マスタ新テーブル分離: 却下（ユーザー 7A）。
- Admin JWT 専用 UI: 却下（ユーザー 11A キオスク集約）。
- PIN 認証: 却下（ユーザー選択 A、`shelfLayoutEditEnabled` と同型運用）。

**Consequences**:

- Prisma マイグレーションと既存棚の backfill が必要。
- サイネージ SVG 行高・テキスト変更。
- `GET registered-shelves` 応答フィールド追加（後方互換）。
- レイアウト PUT 403 時は UI が編集モードを非表示にする。

**References**:

- 設計プレビュー: `docs/design-previews/kiosk-shelf-factory-map-preview.html` 他 3 件
- API: [mobile-placement.md](../api/mobile-placement.md)
- ExecPlan: [mobile-placement-shelf-layout-master.md](../plans/mobile-placement-shelf-layout-master.md)
- KB: [KB-368](../knowledge-base/KB-368-zero2w-haizen-placement-tracking.md)
