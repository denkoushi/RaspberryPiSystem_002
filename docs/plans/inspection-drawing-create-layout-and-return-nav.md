# キオスク検査図面 作成/改版レイアウト + 戻り先ナビ ExecPlan

This ExecPlan is a living document. Maintained in accordance with `.agent/PLANS.md`.

## Purpose / Big Picture

検査図面 **作成/改版**（`/kiosk/part-measurement/inspection/create` · `/inspection/templates/:id/edit`）で、承認済み HTML プレビューに沿い **図面表示面積を確保**し、**戻り先ナビ**を安全な内部 pathname のみに限定する。API/DB の保存契約（絶対上下限・`markerNo` 等）は変更しない。**本番記録**（`KioskInspectionDrawingEditPage`）の右ペイン **20rem** は維持。

2026-06-04 追補: 上辺ヘッダーの **3行化・検査数 chip 孤児化**を、`InspectionDrawingCreateCompactHeader` による **フラット band** で解消。

## Progress

- [x] (2026-06-03) ブランチ `fix/inspection-drawing-return-navigation-review` — 戻り先ナビ堅牢化（`01a059dd`）
- [x] 右ペイン縦一覧・ワークスペース `lg:flex-row`・`pointListSlot` 削除（`dcc82226`）
- [x] コンパクト meta-chip ヘッダー・a11y `htmlFor`・`metadataLayout` prop・テスト入力中の一覧選択（`5274f1ee`）
- [x] (2026-06-04) **フラット band** — `InspectionDrawingCreateCompactHeader` · DEV scenario · Playwright 行数検証（`d96da485`）
- [x] ローカル検証（web test · lint · tsc · build · Playwright 3 scenario）
- [x] push · CI **`26883229358`**（`5274f1ee`）· **`26917349311`**（`d96da485`）success
- [x] Pi5 + Pi4×4 デプロイ（フラット band **`d96da485`**）— stonebase **実機 OK**
- [x] KB / Runbook / deployment / INDEX / EXEC_PLAN 反映
- [x] **`main` マージ**（2026-06-04）

## Decision Log

- Decision: 測定点一覧は **HeaderBand の `pointListSlot` を廃止**し、`InspectionDrawingPointSidebar` + `InspectionDrawingPointSummaryList`（`variant="sidebar"`）へ移す。
  Rationale: 上辺横一覧が図面縦寸を奪う。正本 [kiosk-inspection-drawing-layout-preview.html](./kiosk-inspection-drawing-layout-preview.html)。2026-06-03 / agent
- Decision: 作成/改版専用トークン（`inspectionDrawingCreateSideAsideClassName` **17rem** 等）と本番記録用 **20rem** を分離。
  Rationale: 本番記録 UI の回帰を避ける。2026-06-03 / agent
- Decision: 戻り先は `location.state` の pathname を **allowlist + 正規化**のみ受理。表示ラベルは **preset 固定**（state の任意文字列は無視）。
  Rationale: オープンリダイレクト・表示偽装を防ぐ。2026-06-03 / agent
- Decision: **`InspectionDrawingCreateCompactHeader`** を作成/改版の正本コンポーザとし、旧 `HeaderBand` + `metadataLayout="createCompact"` は **記録 edit 専用**に残す。
  Rationale: 3スロット構造 + 二重 flex-wrap が正本 HTML と非等価で孤児 chip を生む。2026-06-04 / agent
- Decision: フラット band は **最大2物理行 wrap 可**（`flat_wrap`）。meta-row は **nowrap**。
  Rationale: 1280px 実幅でも toolbar/zoom を同一 band に収めつつ、3行目孤児を防ぐ。2026-06-04 / agent
- Decision: E2E 行数判定は **version-badge / drawing-file** を含む。Playwright API モックは **`/src/api/` を continue**。
  Rationale: レビュー P1/P2 · Vite ソース誤 intercept による白画面再発防止。2026-06-04 / agent
- Decision: テスト入力中、右ペイン一覧で点を選んでも **`mode` を `place` に戻さない**。
  Rationale: 常設一覧で複数点の連続テスト入力が可能になる。2026-06-03 / agent
- Decision: 版バッジ（`vN · 有効/履歴`）は **`dl` 外**の `span`（HTML 妥当性）+ **`shrink-0`**。
  Rationale: `dl` 直下に `span` を置かない · band item 契約統一。2026-06-03 / 2026-06-04 / agent

## Surprises & Discoveries

- レイアウト本体（`dcc82226`）とヘッダー chip（`5274f1ee`）は **別コミット**で段階反映したが、Pi5 初回デプロイ（`dcc82226`）時点では **ヘッダー2行グリッドが残存** — 実機で「レイアウト改善忘れ」と報告 → chip 行を追補。
- **`5274f1ee` 後も** 改版 + 長い資源名 + 5 chip で **検査数だけ3行目** — 原因は 3スロット HeaderBand の **折り返し順序**（2026-06-04 調査 CONFIRMED）。
- Playwright `**/api/**` ルートが **`/src/api/client.ts`** を JSON fulfill → **白画面**（MIME type error）。`/src/api/` は continue 必須。
- DEV プレビューは短い fixture + 幅シミュレーション不足で **1行に見えやすい** — `simulateKioskContentWidth` + 長い資源 fixture で parity 改善。

## Concrete Steps（代表ファイル）

| 領域 | 主なパス |
|------|----------|
| 戻り先ナビ | `inspectionDrawingReturnNavigation.ts` · `kioskInspectionDrawingReturnNavigation.ts` |
| フラットヘッダー | `InspectionDrawingCreateCompactHeader.tsx` · `InspectionDrawingCreateMetaChipList.tsx`（内部） |
| 旧 HeaderBand | `InspectionDrawingCreateHeaderBand.tsx`（記録 edit · `metadataLayout`） |
| chip / a11y | `InspectionDrawingCreateMetaChip.tsx` · `InspectionDrawingCreateMetadataRow.tsx`（ファサード） |
| 右ペイン | `InspectionDrawingPointSidebar.tsx` · `InspectionDrawingPointSummaryList.tsx` |
| レイアウトトークン | `inspectionDrawingKioskUi.ts` |
| 画面 | `KioskInspectionDrawingCreatePage.tsx` · `KioskInspectionDrawingCreatePreviewPage.tsx` |
| DEV scenario | `inspectionDrawingCreatePreviewScenarios.ts` |
| テスト | `inspectionDrawingCreateCompactHeader.test.tsx` · `e2e/inspection-drawing-create-header-layout.spec.ts` |
| 正本 HTML | [kiosk-inspection-drawing-layout-preview.html](./kiosk-inspection-drawing-layout-preview.html) |

## Validation and Acceptance

```bash
pnpm --filter @raspi-system/web exec vitest run src/features/part-measurement/inspection-drawing/__tests__/inspectionDrawingCreateCompactHeader.test.tsx
pnpm --filter @raspi-system/web lint
pnpm --filter @raspi-system/web exec tsc --noEmit
pnpm --filter @raspi-system/web build
pnpm exec playwright test e2e/inspection-drawing-create-header-layout.spec.ts
```

手動（キオスク · 強制リロード後）:

1. 検査図面一覧 → 新規/改版 — **上辺フラット band**（最大2物理行 · 検査数孤児なし）· **右ペイン下部に測定点一覧**
2. 図面エリアが旧 UI より広い
3. ツールバー **一覧へ戻る**（一覧導線）
4. **テスト入力** → 右一覧で別点選択 → **テスト入力のまま**値入力継続
5. 公差 **上限左/下限右**（符号付き UI/UX 系は維持）

## デプロイ（Web のみ）

| 段階 | ホスト | Detach Run ID | Git HEAD | 備考 |
|------|--------|---------------|----------|------|
| 2026-06-03 | `raspberrypi5` | **`20260603-211122-29648`** | **`5274f1ee`** | 初版レイアウト |
| **2026-06-04 フラット band** | `raspberrypi5` | **`20260604-074525-7036`** | **`d96da485`** | web 再ビルド |
| **2026-06-04** | Pi4×4 全台 | 下記 | **`d96da485`** | stonebase 実機 OK |

Pi4 Detach: stonebase **`20260604-075147-21404`** · raspberrypi4 **`20260604-080658-2223`** · robodrill **`20260604-081126-19736`** · fjv **`20260604-081502-25798`**

標準手順: [deployment.md §フラット band](../archive/deployments/2026-06.md#kiosk-inspection-drawing-create-header-flat-layout-2026-06-04)

## Outcomes & Retrospective

- **成果**: 作成/改版ヘッダーが正本 HTML と同型の **フラット band** になり、1280px 実幅でも **検査数 chip 孤児化**を解消。Vitest + Playwright で DOM 契約と行数を固定。
- **学び**: `metadataLayout="createCompact"` の 3スロットは **見た目はコンパクトでも wrap 順序が異なる**。layout 変更は **正本 HTML の DOM 兄弟関係**を単体テストで固定すべき。
- **学び**: Playwright の広い `**/api/**` パターンは **Vite ソース**と衝突する — 境界で continue するヘルパーに集約。
- **残**: 順位ボード等からの戻り先 preset 拡張（別タスク）。
