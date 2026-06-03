# キオスク検査図面 作成/改版レイアウト + 戻り先ナビ ExecPlan

This ExecPlan is a living document. Maintained in accordance with `.agent/PLANS.md`.

## Purpose / Big Picture

検査図面 **作成/改版**（`/kiosk/part-measurement/inspection/create` · `/inspection/templates/:id/edit`）で、承認済み HTML プレビューに沿い **図面表示面積を確保**し、**戻り先ナビ**を安全な内部 pathname のみに限定する。API/DB の保存契約（絶対上下限・`markerNo` 等）は変更しない。**本番記録**（`KioskInspectionDrawingEditPage`）の右ペイン **20rem** は維持。

## Progress

- [x] (2026-06-03) ブランチ `fix/inspection-drawing-return-navigation-review` — 戻り先ナビ堅牢化（`01a059dd`）
- [x] 右ペイン縦一覧・ワークスペース `lg:flex-row`・`pointListSlot` 削除（`dcc82226`）
- [x] コンパクト meta-chip ヘッダー・a11y `htmlFor`・`metadataLayout` prop・テスト入力中の一覧選択（`5274f1ee`）
- [x] ローカル検証（web test **770** · lint · tsc · build）
- [x] push · CI **`26883229358`** success
- [x] Pi5 先行デプロイ Detach **`20260603-211122-29648`** · HEAD **`5274f1ee`**
- [x] KB / Runbook / deployment / INDEX / EXEC_PLAN 反映（本ドキュメント含む）
- [ ] **`main` マージ**（ドキュメント反映コミット後）
- [ ] Pi4×4 ロールアウト（`raspberrypi4` · `raspi4-robodrill01` · `raspi4-fjv60-80` · `raspi4-kensaku-stonebase01`）
- [ ] Pi5 実機目視 OK（レイアウト + 戻り先 + テスト入力連続）

## Decision Log

- Decision: 測定点一覧は **HeaderBand の `pointListSlot` を廃止**し、`InspectionDrawingPointSidebar` + `InspectionDrawingPointSummaryList`（`variant="sidebar"`）へ移す。
  Rationale: 上辺横一覧が図面縦寸を奪う。正本 [kiosk-inspection-drawing-layout-preview.html](./kiosk-inspection-drawing-layout-preview.html)。2026-06-03 / agent
- Decision: 作成/改版専用トークン（`inspectionDrawingCreateSideAsideClassName` **17rem** 等）と本番記録用 **20rem** を分離。
  Rationale: 本番記録 UI の回帰を避ける。2026-06-03 / agent
- Decision: 戻り先は `location.state` の pathname を **allowlist + 正規化**のみ受理。表示ラベルは **preset 固定**（state の任意文字列は無視）。
  Rationale: オープンリダイレクト・表示偽装を防ぐ。2026-06-03 / agent
- Decision: `navigate` に **生の `location.state` を渡さない**（`returnTo`/`returnLabel` のみ）。
  Rationale: 余計なキー混入と契約逸脱を防ぐ。2026-06-03 / agent
- Decision: ヘッダー compact レイアウトは `InspectionDrawingCreateHeaderBand` の **`metadataLayout="createCompact"`**（`bandClassName` 文字列比較に依存しない）。
  Rationale: `clsx` 拡張時の誤回帰を防ぐ。2026-06-03 / agent
- Decision: テスト入力中、右ペイン一覧で点を選んでも **`mode` を `place` に戻さない**。
  Rationale: 常設一覧で複数点の連続テスト入力が可能になる。2026-06-03 / agent
- Decision: 版バッジ（`vN · 有効/履歴`）は **`dl` 外**の `span`（HTML 妥当性）。
  Rationale: `dl` 直下に `span` を置かない。2026-06-03 / agent

## Surprises & Discoveries

- レイアウト本体（`dcc82226`）とヘッダー chip（`5274f1ee`）は **別コミット**で段階反映したが、Pi5 初回デプロイ（`dcc82226`）時点では **ヘッダー2行グリッドが残存** — 実機で「レイアウト改善忘れ」と報告 → chip 行を追補。
- 一覧選択で `setMode('place')` が残ると、新レイアウトで **テスト入力が毎回中断**（コードレビュー P2）。
- `InspectionDrawingPointSummaryStrip` は **削除**（sidebar 一覧に置換）。参照ドキュメントの更新が必要だった。

## Concrete Steps（代表ファイル）

| 領域 | 主なパス |
|------|----------|
| 戻り先ナビ | `inspectionDrawingReturnNavigation.ts` · `kioskInspectionDrawingReturnNavigation.ts` |
| コンパクトヘッダー | `InspectionDrawingCreateMetadataRow.tsx` · `InspectionDrawingCreateMetaChip.tsx` |
| ヘッダーバンド | `InspectionDrawingCreateHeaderBand.tsx`（`metadataLayout`） |
| 右ペイン | `InspectionDrawingPointSidebar.tsx` · `InspectionDrawingPointSummaryList.tsx` |
| レイアウトトークン | `inspectionDrawingKioskUi.ts` |
| 画面 | `KioskInspectionDrawingCreatePage.tsx` · `KioskInspectionDrawingCreatePreviewPage.tsx` |
| テスト | `inspectionDrawingReturnNavigation.test.ts` · `inspectionDrawingCreateHeaderBand.test.tsx` · `inspectionDrawingPointSummaryList.test.tsx` |
| 正本 HTML | [kiosk-inspection-drawing-layout-preview.html](./kiosk-inspection-drawing-layout-preview.html) |

## Validation and Acceptance

```bash
pnpm --filter @raspi-system/web test
pnpm --filter @raspi-system/web lint
pnpm --filter @raspi-system/web exec tsc --noEmit
pnpm --filter @raspi-system/web build
```

手動（Pi5 キオスク · 強制リロード後）:

1. 検査図面一覧 → 新規/改版 — **上辺1バンド**（meta-chip + ツールバー + ズーム）· **右ペイン下部に測定点一覧**
2. 図面エリアが旧 UI より広い
3. ツールバー **一覧へ戻る**（一覧導線）
4. **テスト入力** → 右一覧で別点選択 → **テスト入力のまま**値入力継続
5. 公差 **上限左/下限右**（符号付き UI/UX 系は維持）

## デプロイ（Web のみ）

| ホスト | Detach Run ID | Git HEAD | 備考 |
|--------|---------------|----------|------|
| `raspberrypi5` | **`20260603-211122-29648`** | **`5274f1ee`** | `failed=0` · **web** 再ビルド · 実機確認待ち/継続 |
| Pi4×4 | — | — | **未** — `main` マージ後に 1 台ずつ |

標準手順: [deployment.md §レイアウト+戻り先](../guides/deployment.md#kiosk-inspection-drawing-create-layout-return-nav-2026-06-03)

## Outcomes & Retrospective

（`main` マージ・Pi4 完了後に追記）
