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
  'flex shrink-0 flex-col gap-2 rounded border border-white/15 bg-slate-900/50 p-2 lg:flex-row lg:items-end lg:justify-between lg:gap-3';

export const inspectionDrawingMetadataGridClassName =
  'grid shrink-0 grid-cols-2 gap-x-2 gap-y-2 sm:grid-cols-4 lg:max-w-[58rem]';

export const inspectionDrawingMetadataLabelClassName =
  'grid w-fit justify-items-start gap-1 text-[1rem] font-semibold';

export const inspectionDrawingToolbarSlotClassName =
  'flex min-w-0 flex-1 flex-wrap items-center gap-2 lg:justify-end';

/** 右サイドバー — 従来 lg:w-80（20rem）の 2/3。空きを図面エリアへ */
export const inspectionDrawingSideAsideClassName =
  'flex w-full shrink-0 flex-col gap-2 lg:w-[15rem]';

/** 図面キャンバス列 — サイドバー縮小分を flex で確保 */
export const inspectionDrawingCanvasColumnClassName =
  'flex min-h-[min(72dvh,760px)] min-w-0 flex-1 flex-col';

/** 測定点設定パネル — サイドバー幅いっぱい */
export const inspectionDrawingPointSettingPanelClassName =
  'grid w-full max-w-full gap-2 rounded border border-white/15 bg-slate-900/80 p-2';

/** 測定点設定パネル内 Input — 既定 ~1rem の 1.3 倍 */
export const inspectionDrawingPointSettingInputClassName =
  'text-slate-900 text-[1.12rem] leading-snug py-2';
