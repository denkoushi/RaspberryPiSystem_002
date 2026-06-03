import clsx from 'clsx';

/** キオスクトグル: 非選択（KioskPartMeasurementPage の工程ボタンと同じ） */
export function inspectionDrawingKioskToggleInactiveClass(isActive: boolean): string {
  return clsx(!isActive && 'opacity-40 grayscale');
}

/** 押せないボタンをより明確にグレーアウト */
export const inspectionDrawingKioskDisabledButtonClass =
  'disabled:opacity-35 disabled:grayscale disabled:saturate-50';

/** 上部メタデータ欄 Input — 既定 ~1rem の 1.3 倍 */
export const inspectionDrawingMetadataInputClassName =
  'text-slate-900 text-[1.18rem] leading-snug py-2';

/** 図面ファイル選択 — text-xs 相当を 1.3 倍 */
export const inspectionDrawingMetadataFileInputClassName = 'text-[1rem] text-white';

/** 従来グリッド1列分の約半分幅 */
export const inspectionDrawingMetadataControlWidthClass = 'w-[10.5rem] max-w-full';

export const inspectionDrawingMetadataInputClass = clsx(
  inspectionDrawingMetadataInputClassName,
  inspectionDrawingMetadataControlWidthClass
);

export const inspectionDrawingMetadataFileInputClass = clsx(
  inspectionDrawingMetadataFileInputClassName,
  inspectionDrawingMetadataControlWidthClass
);

/** 上部1行バンド（メタデータ + ツールバー） */
export const inspectionDrawingHeaderBandClassName =
  'flex shrink-0 flex-col gap-1.5 rounded border border-white/15 bg-slate-900/50 p-1.5 lg:flex-row lg:items-end lg:justify-between lg:gap-2';

/** 作成/改版 — 測定点一覧スロット（縦行は増やさずバンド直下） */
export const inspectionDrawingHeaderPointListSlotClassName = 'min-w-0 shrink-0 px-0.5';

/** 測定点一覧 — 横スクロール・最大高さ制限 */
export const inspectionDrawingPointSummaryStripClassName =
  'flex max-h-[7.5rem] gap-2 overflow-x-auto overflow-y-hidden pb-1 [scrollbar-gutter:stable]';

export const inspectionDrawingPointSummaryCardClassName =
  'flex min-w-[9.5rem] max-w-[11rem] shrink-0 flex-col gap-0.5 rounded border border-white/20 bg-slate-800/90 px-2 py-1.5 text-left text-[0.82rem] text-white transition hover:border-white/35 disabled:opacity-50';

export const inspectionDrawingMetadataGridClassName =
  'grid min-w-0 shrink grid-cols-2 gap-x-2 gap-y-2 sm:grid-cols-4 lg:max-w-[58rem] lg:min-w-0 lg:flex-1';

export const inspectionDrawingMetadataLabelClassName =
  'grid w-fit justify-items-start gap-1 text-[1rem] font-semibold';

/** 一覧フィルタ — フィールドラベル（メタデータの w-fit は使わない） */
export const inspectionDrawingLibraryFilterFieldLabelClassName =
  'grid gap-1 text-[1rem] font-semibold';

/** flex-1 + min-w-0 だと狭いキオスク幅でボタンが1列縦積みになるため shrink-0 */
export const inspectionDrawingToolbarSlotClassName =
  'flex shrink-0 flex-wrap items-center justify-end gap-2';

/** ヘッダーバンド中央 — メタデータとツールバー間の余白（図面ズーム等） */
export const inspectionDrawingHeaderBandCenterSlotClassName =
  'flex min-w-0 flex-1 items-end justify-center gap-1 px-1';

/** 図面ズームボタン（記号のみ・キオスクタップ領域） */
export const inspectionDrawingCanvasZoomButtonClassName =
  'min-h-11 min-w-11 px-2 text-[1.25rem] font-semibold leading-none';

/** 図面ズーム操作 — ボタン群のみ（中央スロットの flex は HeaderBand が担当） */
export const inspectionDrawingCanvasZoomControlsClassName = 'flex items-center gap-1';

/** 右サイドバー — 測定点設定の入力幅確保（作成/改版） */
export const inspectionDrawingSideAsideClassName =
  'flex w-full shrink-0 flex-col gap-2 lg:w-[20rem]';

/** 図面キャンバス列 — サイドバー縮小分を flex で確保 */
export const inspectionDrawingCanvasColumnClassName =
  'flex min-h-[min(72dvh,760px)] min-w-0 flex-1 flex-col';

/** 図面キャンバス scrollport — スクロールバー出現時の client 寸法揺れを抑える */
export const inspectionDrawingCanvasViewportBaseClassName =
  'relative min-h-0 flex-1 select-none overflow-auto rounded border border-white/20 bg-black/40 [scrollbar-gutter:stable]';

/** 測定点設定パネル — サイドバー幅いっぱい */
export const inspectionDrawingPointSettingPanelClassName =
  'grid w-full max-w-full gap-2 rounded border border-white/15 bg-slate-900/80 p-2';

/** 測定点設定パネル内 Input — 既定 ~1rem の 1.3 倍 */
export const inspectionDrawingPointSettingInputClassName =
  'text-slate-900 text-[1.12rem] leading-snug py-2';

/** 一覧フィルタ — 品番欄幅 */
export const inspectionDrawingLibraryFilterFhincdWidthClass =
  'w-full shrink-0 sm:w-[13rem]';

/** 一覧フィルタ — 資源欄幅 */
export const inspectionDrawingLibraryFilterResourceWidthClass =
  'w-full min-w-0 shrink-0 sm:w-[15rem] sm:max-w-[15rem]';

/** 資源 select のクリップ境界（ネイティブ select の描画はみ出し防止） */
export const inspectionDrawingBoundedSelectShellClassName =
  'min-w-0 w-full overflow-hidden rounded-md';

/** 資源 select 本体（シェル内で幅 100% に収める） */
export const inspectionDrawingBoundedSelectClassName =
  'box-border h-11 w-full min-w-0 max-w-full rounded-md border-2 border-slate-500 bg-white px-3 text-[1.02rem] text-slate-900';

/** 作成画面メタデータ — 資源 select フィールド幅（品番・テンプレ名等と同じ 10.5rem + はみ出しクリップ用 min-w-0） */
export const inspectionDrawingMetadataResourceFieldWidthClass = clsx(
  inspectionDrawingMetadataControlWidthClass,
  'min-w-0'
);
