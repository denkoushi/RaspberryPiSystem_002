# Inspection drawing callout dimensions

## Purpose / Big Picture

検査図面の丸数字に、矢視先端と任意の基準点との X/Y 寸法線を付ける。
右ペインは17remを維持し、丸数字・矢視・寸法・状態・削除を折り返す。
本計画は `.agent/PLANS.md` に従って管理する。

## Progress

- [x] 2026-11-17: 承認済みモックと調査報告、既存pointer操作、保存経路を確認。
- [x] 2026-11-17: nullable JSON列、Zod、保存・複製・内容比較、web往復変換とdirty判定を追加。
- [x] 2026-11-17: 専用SVGレイヤー、配置、局所ドラッグ、状態・バッジ、印刷を追加。
- [x] 2026-11-17: API/web型検査と対象webテストを確認（結果は下記）。最終差分を自己レビュー。

## Context and Orientation

`apps/api/prisma/schema.prisma` の `PartMeasurementTemplateItem` が測定点を保持する。
`apps/api/src/routes/part-measurement/shared.ts` が入力検証とレスポンス変換を担当し、
`apps/api/src/services/part-measurement/part-measurement-template.service.ts` の
`insertNextTemplateVersionInTransaction` と `copyTemplateItemsFromDb` が改版・複製に使われる。
抜取方針補正の内容一致検証は `self-inspection-sampling-policy-correction.service.ts` にある。

web側は `apps/web/src/features/part-measurement/inspection-drawing/` に集まる。
`markerNumbering.ts` がAPIデータと編集点を変換し、`inspectionDrawingCreateDraft.ts` が未保存変更を比較する。
`InspectionDrawingCanvas.tsx` は編集と閲覧で共用され、画像の表示矩形からratio座標を変換する。
`InspectionDrawingDimensionLayer.tsx` は検査図面だけの描画とハンドル操作を担当する。
共有の `ImageMarkerCalloutOverlay` とassemblyは変更しない。

## Plan of Work

最初に保存契約を通し、次に寸法モードを右ペインとCanvasへ通す。
各寸法は `dir`、`baseXRatio`、`baseYRatio`、`offsetRatio` だけを保持し、終点には常に現在の矢視先端を使う。
`dimX` / `dimY` は配置待ちのモードで、一度配置すると `place` へ戻す。
同じ向きは置換し、他の向きは保持する。矢視削除は寸法配列も空にする。

寸法の幾何計算は `inspectionDrawingDimensionGeometry.ts` に置き、表示と印刷で使う。
選択中の基準点と寸法線位置をpointerで動かす。4px未満では開始しない。
ドラッグ中はrefに候補を持ち、rAFでその寸法のSVG属性だけを変更し、pointerupで一度だけ親へ通知する。
pointercancelでは元の属性に戻す。閲覧時にはハンドルを表示しない。

## Validation and Acceptance

リポジトリのルートで次を使う。秘密ファイルを読まず、DBへのmigration適用は行わない。

    pnpm --filter @raspi-system/api exec prisma generate
    pnpm --filter @raspi-system/api exec tsc -p tsconfig.build.json --noEmit
    pnpm --filter @raspi-system/web exec tsc --noEmit -p tsconfig.json
    pnpm --filter @raspi-system/web exec vitest run <対象ファイル>

対象はmarkerNumbering、inspectionDrawingCreateDraft、モード行、Canvas、矢視削除、Sidebar、測定点一覧、印刷、AI案変換。
寸法→X→図面pointer tapで吸着せず保存され、同じ向きの置換で他の向きが残ることを確認する。
ハンドルの4px境界、SVGのみの更新とpointerup通知回数を確認する。
APIのスキーマテストを追加し、既存integrationで保存・複製とSQL NULLを検証する。
API integrationはPostgreSQLとmigration適用済みのテストDBを必要とするため、この作業では実行しない。

## Decision Log

2026-11-17: 初期offsetはモックのX=-45/640、Y=+45/1000を画像ratioへ変換し、画像内にclampする。
補助線の延長もモックの10/640、10/1000を使う。画面サイズ・ズーム・印刷で配置関係を維持するため。
吸着はモックの実装より今回の明示仕様を優先して行わない。

2026-11-17: DBの空配列と矢視なしは `Prisma.DbNull`、web編集では `[]` に統一する。
AI転記は新しい矢視から点を作る `proposalToDrawingPoint` で寸法を空にする。
モックの一覧バッジは矢視を優先する実装だが、今回の明示仕様に合わせ寸法を優先して「寸XY」を表示する。

## Surprises & Discoveries

web型検査で開発用の `KioskInspectionDrawingCreatePreviewPage.tsx` もモード型の利用側と判明した。
最初の対象テストでは既存の矢視削除テストが新しい空寸法配列を期待していなかったため更新した。
Canvasテストでは装飾画像もpresentationロールを持つため、既存テスト同様に明示role属性のviewportを選ぶ。

## Idempotence and Recovery

migration `20261117120000_part_measurement_template_item_callout_dims` はnullable列を追加するだけで、既存値を変換しない。
この作業では適用しない。実運用への適用は別途承認と通常のバックアップ・deploy手順の対象。
ローカル変更は既存のcleanなtask worktree内に保持し、git履歴操作は行わない。

## Outcomes & Retrospective

Prisma Client生成、API build用tsconfigとweb tsconfigの型検査に成功。
対象webテストは重複を除き10ファイル99件で、最終結果は全件成功（新規15件）。
最初の実行で83件中2件失敗した後、その2ファイルと追加対象を検証し36件成功。
pointerupの最終座標、キャンセル、閲覧ハンドル非表示、一覧バッジ・削除を補強した2ファイル25件も成功。
成功済みの無変更ファイルは再実行していない。
検証コマンドの合計実行・待機は概算5分以内。重い処理は端末の既存スケジューラによる順番待ちがあった。
APIスキーマ2件、integration新規2件・既存複製テスト更新1件を追加した。
APIテスト実行は指定されたコマンド範囲外、integrationはさらにテストDBが必要なため未実行。
DB migration適用、実ブラウザ・実機での目視／性能測定は未実施。
main統合と本番反映は対象外でありintegrationPending。

## Artifacts and Notes

承認済みモックはユーザー指定の一時ファイル `mock.html` の「改善案」。
面・呼び径・直接入力の配置変更とスナップは対象外。

## Interfaces and Dependencies

新規の依存は追加しない。寸法データは最大2件、dirはx/y、dirの重複は禁止。
基準点は0..1で検証し、有限のoffsetは0..1へclampする。
`onCalloutDimsChange(pointId, dims)` でCanvasから親の保存対象stateを更新する。

## Changed Files

- [apps/api/prisma/migrations/20261117120000_part_measurement_template_item_callout_dims/migration.sql](../../apps/api/prisma/migrations/20261117120000_part_measurement_template_item_callout_dims/migration.sql)
- [apps/api/prisma/schema.prisma](../../apps/api/prisma/schema.prisma)
- [apps/api/src/routes/__tests__/part-measurement.integration.test.ts](../../apps/api/src/routes/__tests__/part-measurement.integration.test.ts)
- [apps/api/src/routes/part-measurement/__tests__/template-item-dimensions.shared.test.ts](../../apps/api/src/routes/part-measurement/__tests__/template-item-dimensions.shared.test.ts)
- [apps/api/src/routes/part-measurement/shared.ts](../../apps/api/src/routes/part-measurement/shared.ts)
- [apps/api/src/services/part-measurement/part-measurement-template.service.ts](../../apps/api/src/services/part-measurement/part-measurement-template.service.ts)
- [apps/api/src/services/part-measurement/self-inspection-sampling-policy-correction.service.ts](../../apps/api/src/services/part-measurement/self-inspection-sampling-policy-correction.service.ts)
- [apps/web/src/api/domains/part-measurement.ts](../../apps/web/src/api/domains/part-measurement.ts)
- [apps/web/src/features/part-measurement/inspection-drawing/InspectionDrawingCanvas.test.tsx](../../apps/web/src/features/part-measurement/inspection-drawing/InspectionDrawingCanvas.test.tsx)
- [apps/web/src/features/part-measurement/inspection-drawing/InspectionDrawingCanvas.tsx](../../apps/web/src/features/part-measurement/inspection-drawing/InspectionDrawingCanvas.tsx)
- [apps/web/src/features/part-measurement/inspection-drawing/InspectionDrawingCreateToolbar.tsx](../../apps/web/src/features/part-measurement/inspection-drawing/InspectionDrawingCreateToolbar.tsx)
- [apps/web/src/features/part-measurement/inspection-drawing/InspectionDrawingDimensionLayer.tsx](../../apps/web/src/features/part-measurement/inspection-drawing/InspectionDrawingDimensionLayer.tsx)
- [apps/web/src/features/part-measurement/inspection-drawing/InspectionDrawingPlaceCalloutModeRow.tsx](../../apps/web/src/features/part-measurement/inspection-drawing/InspectionDrawingPlaceCalloutModeRow.tsx)
- [apps/web/src/features/part-measurement/inspection-drawing/InspectionDrawingPointSidebar.tsx](../../apps/web/src/features/part-measurement/inspection-drawing/InspectionDrawingPointSidebar.tsx)
- [apps/web/src/features/part-measurement/inspection-drawing/InspectionDrawingPointSummaryList.tsx](../../apps/web/src/features/part-measurement/inspection-drawing/InspectionDrawingPointSummaryList.tsx)
- [apps/web/src/features/part-measurement/inspection-drawing/InspectionDrawingPrintPreview.tsx](../../apps/web/src/features/part-measurement/inspection-drawing/InspectionDrawingPrintPreview.tsx)
- [apps/web/src/features/part-measurement/inspection-drawing/__tests__/InspectionDrawingPlaceCalloutModeRow.test.tsx](../../apps/web/src/features/part-measurement/inspection-drawing/__tests__/InspectionDrawingPlaceCalloutModeRow.test.tsx)
- [apps/web/src/features/part-measurement/inspection-drawing/__tests__/InspectionDrawingPointSidebar.test.tsx](../../apps/web/src/features/part-measurement/inspection-drawing/__tests__/InspectionDrawingPointSidebar.test.tsx)
- [apps/web/src/features/part-measurement/inspection-drawing/__tests__/inspectionDrawingCalloutTip.test.ts](../../apps/web/src/features/part-measurement/inspection-drawing/__tests__/inspectionDrawingCalloutTip.test.ts)
- [apps/web/src/features/part-measurement/inspection-drawing/__tests__/inspectionDrawingCreateDraft.test.ts](../../apps/web/src/features/part-measurement/inspection-drawing/__tests__/inspectionDrawingCreateDraft.test.ts)
- [apps/web/src/features/part-measurement/inspection-drawing/__tests__/markerNumbering.test.ts](../../apps/web/src/features/part-measurement/inspection-drawing/__tests__/markerNumbering.test.ts)
- [apps/web/src/features/part-measurement/inspection-drawing/__tests__/printMarkerLayout.test.ts](../../apps/web/src/features/part-measurement/inspection-drawing/__tests__/printMarkerLayout.test.ts)
- [apps/web/src/features/part-measurement/inspection-drawing/inspectionDrawingCalloutTip.ts](../../apps/web/src/features/part-measurement/inspection-drawing/inspectionDrawingCalloutTip.ts)
- [apps/web/src/features/part-measurement/inspection-drawing/inspectionDrawingCreateDraft.ts](../../apps/web/src/features/part-measurement/inspection-drawing/inspectionDrawingCreateDraft.ts)
- [apps/web/src/features/part-measurement/inspection-drawing/inspectionDrawingDimensionGeometry.ts](../../apps/web/src/features/part-measurement/inspection-drawing/inspectionDrawingDimensionGeometry.ts)
- [apps/web/src/features/part-measurement/inspection-drawing/inspectionDrawingKioskUi.ts](../../apps/web/src/features/part-measurement/inspection-drawing/inspectionDrawingKioskUi.ts)
- [apps/web/src/features/part-measurement/inspection-drawing/markerNumbering.ts](../../apps/web/src/features/part-measurement/inspection-drawing/markerNumbering.ts)
- [apps/web/src/features/part-measurement/inspection-drawing/printMarkerLayout.ts](../../apps/web/src/features/part-measurement/inspection-drawing/printMarkerLayout.ts)
- [apps/web/src/features/part-measurement/inspection-drawing/proposalToDrawingPoint.ts](../../apps/web/src/features/part-measurement/inspection-drawing/proposalToDrawingPoint.ts)
- [apps/web/src/features/part-measurement/inspection-drawing/types.ts](../../apps/web/src/features/part-measurement/inspection-drawing/types.ts)
- [apps/web/src/features/part-measurement/types.ts](../../apps/web/src/features/part-measurement/types.ts)
- [apps/web/src/pages/dev/KioskInspectionDrawingCreatePreviewPage.tsx](../../apps/web/src/pages/dev/KioskInspectionDrawingCreatePreviewPage.tsx)
- [apps/web/src/pages/kiosk/KioskInspectionDrawingCreatePage.tsx](../../apps/web/src/pages/kiosk/KioskInspectionDrawingCreatePage.tsx)
- [docs/INDEX.md](../../docs/INDEX.md)
- [docs/plans/2026-11-17-inspection-drawing-callout-dims.md](../../docs/plans/2026-11-17-inspection-drawing-callout-dims.md)

2026-11-17: 実装と検証結果、変更ファイル一覧を更新。未実施のDB・実機検証を明記した。
