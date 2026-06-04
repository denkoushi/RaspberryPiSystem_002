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

/** 上部1行バンド（メタデータ + ツールバー）— 本番記録など */
export const inspectionDrawingHeaderBandClassName =
  'flex shrink-0 flex-col gap-1.5 rounded border border-white/15 bg-slate-900/50 p-1.5 lg:flex-row lg:items-end lg:justify-between lg:gap-2';

/** 作成/改版 — コンパクト1バンド（測定点一覧は右ペインへ）— 旧3スロット HeaderBand 用 */
export const inspectionDrawingCreateHeaderBandClassName =
  'flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 rounded border border-white/15 bg-slate-900/50 px-2 py-1';

/** 作成/改版 — フラット band（CompactHeader 専用・top-band 相当） */
export const inspectionDrawingCreateFlatBandClassName =
  'flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 rounded border border-white/15 bg-slate-900/50 px-2 py-1';

/** フラット band — meta-row（dl）。band 直下・内部 nowrap */
export const inspectionDrawingCreateFlatMetaRowClassName =
  'flex shrink min-w-0 flex-nowrap list-none items-center gap-x-2';

/** フラット band — zoom / toolbar 等の shrink-0 スロット */
export const inspectionDrawingCreateFlatBandItemClassName = 'shrink-0';

/** 作成/改版ヘッダー — メタデータスロット（chip 行 + 図面ファイル）— 旧 createCompact 用 */
export const inspectionDrawingCreateMetadataSlotClassName =
  'flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1';

/** 作成/改版 — meta-chip 行（dl）— 旧 createCompact / MetadataRow fragment 用 */
export const inspectionDrawingCreateMetaRowClassName =
  'flex min-w-0 flex-1 flex-wrap list-none items-center gap-x-2 gap-y-1';

export const inspectionDrawingCreateMetaChipClassName =
  'inline-flex items-baseline gap-1.5 whitespace-nowrap text-[0.9rem]';

export const inspectionDrawingCreateMetaChipTermClassName =
  'font-semibold text-slate-400';

export const inspectionDrawingCreateMetaChipValueClassName = 'm-0 min-w-0';

/** chip 内の読取専用値 */
export const inspectionDrawingCreateMetaChipReadonlyValueClassName =
  'inline-block max-w-[11rem] overflow-hidden text-ellipsis whitespace-nowrap rounded border border-slate-600 bg-slate-800/90 px-1.5 py-0.5 text-[0.95rem] text-white';

/** chip 内の Input / select */
export const inspectionDrawingCreateMetaChipControlClassName =
  'box-border h-9 max-w-[11rem] min-w-0 rounded-md border-2 border-slate-500 bg-white px-2 text-[0.95rem] text-slate-900';

export const inspectionDrawingCreateMetaChipSelectClassName = clsx(
  inspectionDrawingCreateMetaChipControlClassName,
  'w-full max-w-[11rem]'
);

/** 版バッジ（v2 · 有効） */
export const inspectionDrawingCreateVersionBadgeClassName =
  'rounded border border-white/20 px-1.5 py-0.5 text-[0.75rem] text-white/55';

/** 図面ファイル — バンド内インライン */
export const inspectionDrawingCreateFileLabelClassName =
  'inline-flex shrink-0 items-center gap-1 text-[0.75rem] text-white/55';

export const inspectionDrawingCreateFileInputClassName =
  'max-w-[7rem] text-[0.7rem] text-white/70 file:mr-1 file:rounded file:border-0 file:bg-white/10 file:px-1.5 file:py-0.5 file:text-[0.7rem] file:text-white/80';

/** 作成/改版ページ root */
export const inspectionDrawingCreatePageRootClassName =
  'flex min-h-0 flex-1 flex-col gap-1 p-1 text-white';

/** 作成/改版ワークスペース（キャンバス + サイドバー）— 狭幅は縦積み */
export const inspectionDrawingCreateWorkspaceClassName =
  'flex min-h-0 flex-1 flex-col gap-1.5 lg:flex-row';

/** 測定点一覧（右ペイン縦リスト） */
export const inspectionDrawingPointSummaryListSidebarClassName =
  'flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto [scrollbar-gutter:stable]';

export const inspectionDrawingPointSummaryListSidebarCardClassName =
  'flex w-full flex-col gap-0.5 rounded border border-white/20 bg-slate-800/90 px-2 py-1 text-left text-[0.82rem] leading-snug text-white transition hover:border-white/35 disabled:opacity-50';

export const inspectionDrawingPointSummaryListSidebarSectionClassName =
  'mt-1.5 flex min-h-0 flex-1 flex-col gap-1 border-t border-white/10 pt-1.5';

export const inspectionDrawingPointSummaryListSidebarTitleClassName =
  'shrink-0 text-[0.8rem] font-semibold text-white/50';

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

/** 右サイドバー — 本番記録など（作成/改版は create 用を使う） */
export const inspectionDrawingSideAsideClassName =
  'flex w-full shrink-0 flex-col gap-2 lg:w-[20rem]';

/** 右サイドバー — 作成/改版（設定 + 縦一覧） */
export const inspectionDrawingCreateSideAsideClassName =
  'flex min-h-0 w-full shrink-0 flex-col rounded border border-white/15 bg-slate-900/80 p-1.5 lg:w-[17rem]';

/** 自主検査セッション — フラット top-band（作成/改版と同型の密度） */
export const selfInspectionSessionFlatBandClassName =
  'flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 rounded border border-white/15 bg-slate-800/80 px-2 py-1';

export const selfInspectionSessionMetaRowClassName =
  'flex min-w-0 flex-1 flex-nowrap items-center gap-x-2 overflow-x-auto text-[0.82rem]';

export const selfInspectionSessionMetaChipClassName =
  'inline-flex shrink-0 items-baseline gap-1 whitespace-nowrap text-white/80';

/** 自主検査セッション上辺ツールバー（blur 時の relatedTarget 判定用） */
export const SELF_INSPECTION_SESSION_TOOLBAR_SELECTOR = '[data-self-inspection-session-toolbar]';

export const SELF_INSPECTION_ENTRY_SLOTS_SELECTOR = '[data-self-inspection-entry-slots]';

/** 自主検査セッション上の操作 UI（blur 時にガイド自動進行しないフォーカス先） */
export function isSelfInspectionSessionChromeFocusTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.closest(SELF_INSPECTION_SESSION_TOOLBAR_SELECTOR) !== null ||
    target.closest(SELF_INSPECTION_ENTRY_SLOTS_SELECTOR) !== null
  );
}

export const selfInspectionSessionToolbarSlotClassName =
  'flex shrink-0 flex-nowrap items-center gap-1';

/** 図面キャンバス列 — サイドバー縮小分を flex で確保 */
export const inspectionDrawingCanvasColumnClassName =
  'flex min-h-[min(76dvh,820px)] min-w-0 flex-1 flex-col';

/** 図面キャンバス列 — 作成/改版（親 workspace の残高を使う） */
export const inspectionDrawingCreateCanvasColumnClassName =
  'flex min-h-0 min-w-0 flex-1 flex-col';

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
