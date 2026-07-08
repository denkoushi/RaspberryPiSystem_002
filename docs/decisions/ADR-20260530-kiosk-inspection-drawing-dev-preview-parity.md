# ADR-20260530: キオスク検査図面 DEV プレビューの本番レンダリング契約

- **Status**: accepted
- **Date**: 2026-05-30

## Context

キオスク「検査図面」一覧・作成画面のレイアウト調整において、Mac 上の DEV プレビューと Pi5 本番キオスクの見え方が大きく異なり、修正指示が出せなかった。

当初は `transform: scale` や別解像度のモックが疑われたが、調査の結果 **スケールではなくレンダリング契約の不一致**（シェル・コンポーネント・レイアウトトークン）が主因だった。

制約:

- API / Prisma は変更しない（**Web のみ**）。
- 本番キオスクは `KioskLayout` + 沉浸式ヘッダー（`usesKioskImmersiveLayout`）が前提。
- レイアウト作業は開発者 Mac から行うため、認証なしで開ける DEV ルートが必要。

## Decision

1. **本番と同じ React コンポーネントを DEV から描画する**（プレビュー専用 JSX の複製をやめる）。
2. DEV ルートは **`KioskLayout` 配下**に置き、本番と同じヘッダー・沉浸式契約を通す。
3. DEV 専用 chrome は **`KioskInspectionDrawingDevPreviewChrome`** に限定し、上部に fixed の DEV バー + **`min-w-[1280px]`**（キオスク最小幅契約）のみ追加する。**`transform: scale` は使わない**。
4. 一覧フィルタ・測定点設定パネルは **共有コンポーネント**（`InspectionDrawingLibraryFilterBar` / `InspectionDrawingPointSettingsPanel`）に抽出し、本番ページと DEV プレビューの両方から import する。
5. DEV URL（開発ビルド）:
   - `/dev/kiosk-inspection-drawing-library` — 一覧（fixture データ）
   - `/dev/kiosk-inspection-drawing-create` — 作成/編集（fixture データ）

## Alternatives

| 案 | 却下理由 |
|----|----------|
| 静的 HTML モックのみ | 本番コンポーネントと二重保守。Tailwind / 共有 state とずれる |
| `h-dvh` 全画面 + `KioskLayout` 外 | ヘッダー高・パディング・スクロール領域が本番と不一致 |
| `transform: scale` で縮小表示 | フォント・タップ領域・折り返しが本番と非線形にずれる |
| 本番 URL + モック API | キオスク認証・データ準備が重く、レイアウト反復に不向き |

## Consequences

**良い**

- レイアウト修正は DEV プレビューで反復し、Pi5 本番と同じコンポーネントツリーで確認できる。
- 共有コンポーネント化により、フィルタ折り返し・測定点縦並びなど UI 契約が一箇所に集約される。

**悪い**

- DEV ルートは fixture 依存のため、**API エラー・認可・実データ件数**は本番のみで検証が必要。
- `min-w-[1280px]` は横スクロールを生む場合がある（本番キオスク幅と同契約）。

## UI 契約（2026-05-30 追補）

本変更で固定した表示（コード正本: `ccacef85` 系）:

- **一覧フィルタ**: `flex-wrap`（旧 `lg:grid-cols-[13rem_15rem_auto…]` は長い資源名で工程列と重なった）
- **測定点設定**: 名称と基準値/上限値は **1行ずつ**。寸法公差は上限/下限2入力、幾何公差は上限値1入力 + 合格範囲表示（`InspectionDrawingPointSettingsPanel`）
- **作成ツールバー**: 保存ボタン右に **保存状態表示**、その右に保存済み帳票（該当時）と **「一覧へ戻る」**（`InspectionDrawingCreateToolbar`）
- **作成画面下部**: 「図面をタップして…」「一覧プレビューへ」リンクは **削除**（本番・DEV 共通）

## References

- ブランチ: `feat/kiosk-inspection-drawing-preview-parity` · 代表コミット **`ccacef85`**
- [ExecPlan](../plans/kiosk-inspection-drawing-mvp-execplan.md)
- [KB-320 §プレビュー本番パリティ](../knowledge-base/KB-320-kiosk-part-measurement.md#検査図面-preview-parity-2026-05-30)
- [deployment.md §2026-05-30 プレビュー](../guides/deployment.md#kiosk-inspection-drawing-preview-parity-2026-05-30)
- `apps/web/src/pages/dev/KioskInspectionDrawingDevPreviewChrome.tsx`
- `apps/web/src/features/kiosk/kioskImmersiveLayoutPolicy.ts`
