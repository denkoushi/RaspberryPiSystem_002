import clsx from 'clsx';

import {
  kioskInputClassName,
  kioskPanelClassName,
  kioskSelectClassName
} from '../../kiosk/kioskTheme';

/** キオスクトグル: 非選択（KioskPartMeasurementPage の工程ボタンと同じ） */
export function inspectionDrawingKioskToggleInactiveClass(isActive: boolean): string {
  return clsx(!isActive && 'opacity-40 grayscale');
}

/** 押せないボタンをより明確にグレーアウト */
export const inspectionDrawingKioskDisabledButtonClass =
  'disabled:opacity-40 disabled:cursor-not-allowed';

/** キオスクモーダル面（ダーク） */
export const inspectionDrawingKioskDialogClassName =
  '!rounded-lg !border !border-white/20 !bg-slate-900 !p-4 !text-white !shadow-none [&_p.text-sm]:!text-white/60';

/** キオスクモーダルタイトル */
export const inspectionDrawingKioskDialogTitleClassName = 'text-base font-semibold text-white';

/** 上部メタデータ欄 Input — 既定 ~1rem の 1.3 倍 */
export const inspectionDrawingMetadataInputClassName =
  'text-[1.18rem] leading-snug py-2 text-white';

/** 図面ファイル選択 — text-xs 相当を 1.3 倍 */
export const inspectionDrawingMetadataFileInputClassName = 'text-[1rem] text-white';

/** 従来グリッド1列分の約半分幅 */
export const inspectionDrawingMetadataControlWidthClass = 'w-[10.5rem] max-w-full';

export const inspectionDrawingMetadataInputClass = clsx(
  kioskInputClassName,
  inspectionDrawingMetadataInputClassName,
  inspectionDrawingMetadataControlWidthClass
);

export const inspectionDrawingMetadataFileInputClass = clsx(
  inspectionDrawingMetadataFileInputClassName,
  inspectionDrawingMetadataControlWidthClass
);

/** 上部1行バンド（メタデータ + ツールバー）— 本番記録など */
export const inspectionDrawingHeaderBandClassName =
  'flex shrink-0 flex-col gap-1.5 rounded-lg border border-white/15 bg-slate-900/60 p-1.5 lg:flex-row lg:items-end lg:justify-between lg:gap-2';

/** 作成/改版 — コンパクト1バンド（測定点一覧は右ペインへ）— 旧3スロット HeaderBand 用 */
export const inspectionDrawingCreateHeaderBandClassName =
  'flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-white/15 bg-slate-900/60 px-2 py-1';

/** 作成/改版 — フラット band（CompactHeader 専用・top-band 相当） */
export const inspectionDrawingCreateFlatBandClassName =
  'flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-white/15 bg-slate-900/60 px-2 py-1';

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
  'inline-block max-w-[11rem] overflow-hidden text-ellipsis whitespace-nowrap rounded-md border border-white/20 bg-slate-950/60 px-1.5 py-0.5 text-[0.95rem] text-white';

/** chip 内の Input / select */
export const inspectionDrawingCreateMetaChipControlClassName = clsx(
  kioskInputClassName,
  'box-border h-9 max-w-[11rem] min-w-0 px-2 text-[0.95rem]'
);

export const inspectionDrawingCreateMetaChipWideShellClassName =
  'min-w-0 w-[22rem] max-w-[22rem] overflow-hidden rounded-md';

export const inspectionDrawingCreateMetaChipWideControlClassName = clsx(
  kioskInputClassName,
  'box-border h-9 w-full min-w-0 max-w-[22rem] px-2 text-[0.95rem] disabled:opacity-40'
);

/** chip 内の Input（品番・テンプレ・指定数）— 白背景＋黒文字で可読性を確保 */
export const inspectionDrawingCreateMetaChipInputClassName = clsx(
  inspectionDrawingCreateMetaChipControlClassName,
  '!bg-white !text-black placeholder:!text-slate-500'
);

export const inspectionDrawingCreateMetaChipWideInputClassName = clsx(
  inspectionDrawingCreateMetaChipWideControlClassName,
  '!bg-white !text-black placeholder:!text-slate-500'
);

export const inspectionDrawingCreateMetaChipSelectClassName = clsx(
  inspectionDrawingCreateMetaChipControlClassName,
  'w-full max-w-[11rem]'
);

/** 版バッジ（v2 · 有効） */
export const inspectionDrawingCreateVersionBadgeClassName =
  'rounded border border-white/20 px-1.5 py-0.5 text-xs text-white/55';

/** 図面ファイル — バンド内インライン */
export const inspectionDrawingCreateFileLabelClassName =
  'inline-flex shrink-0 items-center gap-1 text-xs text-white/55';

export const inspectionDrawingCreateFileInputClassName =
  'max-w-[7rem] text-xs text-white/70 file:mr-1 file:rounded file:border-0 file:bg-white/10 file:px-1.5 file:py-0.5 file:text-xs file:text-white/80';

/** 作成/改版ページ root */
export const inspectionDrawingCreatePageRootClassName =
  'flex min-h-0 flex-1 flex-col gap-1 p-1 text-white';

/** 作成/改版ワークスペース（キャンバス + サイドバー）— 狭幅は縦積み */
export const inspectionDrawingCreateWorkspaceClassName =
  'flex min-h-0 flex-1 flex-col gap-1.5 lg:flex-row';

/** 測定点一覧（右ペイン縦リスト · 1列） */
export const inspectionDrawingPointSummaryListSidebarClassName =
  'flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto [scrollbar-gutter:stable]';

/** 測定点一覧（自主検査セッション右ペイン · 2列） */
export const inspectionDrawingPointSummaryListSidebarTwoColumnClassName =
  'grid min-h-0 flex-1 grid-cols-2 gap-1 overflow-y-auto [scrollbar-gutter:stable]';

export const inspectionDrawingPointSummaryListSidebarCardClassName =
  'flex w-full flex-col gap-0.5 rounded-lg border border-white/15 bg-slate-900/60 px-2 py-1 text-left text-xs leading-snug text-white transition hover:border-white/35 disabled:opacity-50';

/** 測定点一覧 — 自主検査セッション選択中カード（高彩度 cyan · ring 主強調） */
export const inspectionDrawingPointSummaryListSidebarCardSelectedClassName =
  'border-cyan-300 bg-cyan-900/55 ring-2 ring-cyan-300';

export const inspectionDrawingPointSummaryListSidebarSectionClassName =
  'mt-1.5 flex min-h-0 flex-1 flex-col gap-1 border-t border-white/10 pt-1.5';

export const inspectionDrawingPointSummaryListSidebarTitleClassName =
  'shrink-0 text-xs font-semibold text-white/50';

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
  'min-h-10 min-w-10 !px-2 text-[1rem] font-semibold leading-none';

/** 図面ズーム操作 — ボタン群のみ（中央スロットの flex は HeaderBand が担当） */
export const inspectionDrawingCanvasZoomControlsClassName = 'flex items-center gap-0.5';

/** 右サイドバー — 本番記録など（作成/改版は create 用を使う） */
export const inspectionDrawingSideAsideClassName =
  'flex w-full shrink-0 flex-col gap-2 lg:w-[20rem]';

/** 右サイドバー — 作成/改版（設定 + 縦一覧） */
export const inspectionDrawingCreateSideAsideClassName = clsx(
  kioskPanelClassName,
  // overflow-hidden: 親から有限高さを受けたとき一覧の overflow-y-auto が効くよう拘束する
  'flex min-h-0 w-full shrink-0 flex-col overflow-hidden p-1.5 lg:w-[17rem]'
);

/** 自主検査セッション — フラット top-band（作成/改版と同型の密度） */
export const selfInspectionSessionFlatBandClassName =
  'flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-white/15 bg-slate-900/60 px-2 py-1';

export const selfInspectionSessionMetaRowClassName =
  'flex min-w-0 flex-1 flex-nowrap items-center gap-x-2 overflow-x-auto text-xs';

export const selfInspectionSessionMetaChipClassName =
  'inline-flex shrink-0 items-baseline gap-1 whitespace-nowrap text-white/80';

/** 自主検査セッション上辺ツールバー（blur 時の relatedTarget 判定用） */
export const SELF_INSPECTION_SESSION_TOOLBAR_SELECTOR = '[data-self-inspection-session-toolbar]';

export const SELF_INSPECTION_ENTRY_SLOTS_SELECTOR = '[data-self-inspection-entry-slots]';

/** 自主検査セッション — 保存・完了など（blur 時の relatedTarget 判定用） */
export const SELF_INSPECTION_SESSION_ACTIONS_SELECTOR = '[data-self-inspection-session-actions]';

/** 自主検査セッション — 測定点一覧（blur 時の relatedTarget 判定用） */
export const SELF_INSPECTION_POINT_SUMMARY_LIST_SELECTOR = '[data-self-inspection-point-summary-list]';

/** 自主検査セッション上の操作 UI（blur 時にガイド自動進行しないフォーカス先） */
export function isSelfInspectionSessionChromeFocusTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.closest(SELF_INSPECTION_SESSION_TOOLBAR_SELECTOR) !== null ||
    target.closest(SELF_INSPECTION_ENTRY_SLOTS_SELECTOR) !== null ||
    target.closest(SELF_INSPECTION_SESSION_ACTIONS_SELECTOR) !== null ||
    target.closest(SELF_INSPECTION_POINT_SUMMARY_LIST_SELECTOR) !== null
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
  'relative min-h-0 flex-1 select-none overflow-auto rounded-lg border border-white/15 bg-black/40 [scrollbar-gutter:stable]';

/** 測定点設定パネル — サイドバー幅いっぱい */
export const inspectionDrawingPointSettingPanelClassName = clsx(
  kioskPanelClassName,
  'grid w-full max-w-full gap-2 p-2'
);

/** 測定点設定パネル内 Input — 既定 ~1rem の 1.3 倍 */
export const inspectionDrawingPointSettingInputClassName = clsx(
  kioskInputClassName,
  '!bg-white !text-black !placeholder:text-slate-500 text-[1.12rem] leading-snug py-2'
);

/** 測定点設定 — 名称・基準値 2 列行（17rem 右ペイン向け） */
export const inspectionDrawingPointSettingDualRowClassName =
  'grid min-w-0 grid-cols-2 gap-1.5';

/** 測定点設定 — 右ペイン幅を使う 1 列行 */
export const inspectionDrawingPointSettingSingleRowClassName =
  'grid min-w-0 grid-cols-1 gap-1.5';

/** 測定点設定 — 基準値ラベル + 狭幅入力の 1 行 */
export const inspectionDrawingPointSettingNominalInlineClassName =
  'flex min-w-0 items-center gap-2';

/** 測定点設定 — 基準値/上限値の狭幅入力 */
export const inspectionDrawingPointSettingNominalInputClassName = clsx(
  inspectionDrawingPointSettingInputClassName,
  'w-[7.5rem] shrink-0 !min-h-9 !py-1.5'
);

/** 測定点設定 — 一点削除 / 全削除（高さ ≈ 半分） */
export const inspectionDrawingPointSettingDeleteButtonClassName =
  '!min-h-[22px] !px-2 !py-0 text-[0.78rem] leading-none';

/** 測定点位置微調整 — 右ペイン内 1 行配置 */
export const inspectionDrawingPointNudgeGridClassName =
  'flex w-full justify-center gap-1';

/** 測定点位置微調整 — icon-only 方向ボタン（既存 Button の px-4 を使わない） */
export const inspectionDrawingPointNudgeButtonClassName =
  'inline-flex min-h-[1.375rem] min-w-11 items-center justify-center rounded-md border border-white/20 bg-white/5 text-[0.82rem] font-bold leading-none text-white/90 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40';

/** 名称ラベル + select を1行（17rem aside 内に収める） */
export const inspectionDrawingPointNameInlineClassName =
  'flex min-w-0 w-full items-center gap-2';

export const inspectionDrawingPointNameInlineLabelClassName =
  'shrink-0 whitespace-nowrap text-[0.95rem] font-semibold';

export const inspectionDrawingPointCalloutStatusRowClassName =
  'grid min-h-8 grid-cols-[1fr_auto] items-center gap-1.5 rounded-md border border-amber-300/45 bg-amber-400/10 px-2 text-[0.72rem] font-extrabold text-amber-100';

/** 右ペイン — 丸数字/矢視モード行（状態・削除を同列に載せる） */
export const inspectionDrawingPlaceCalloutModeRowClassName =
  'flex min-h-8 min-w-0 flex-nowrap items-center gap-1 rounded-md border border-amber-300/45 bg-amber-400/10 px-1.5';

/** 検査図面ライブラリ行アクション（高さ ×0.7 ≈ 30.8px） */
export const inspectionDrawingLibraryRowActionClassName =
  'inline-flex min-h-[30.8px] min-w-[1.5rem] shrink-0 items-center justify-center rounded !px-1 !py-0 text-[0.68rem] leading-none whitespace-nowrap';

/** 検査図面ライブラリ行アクション列幅（無効ボタン含む） */
export const inspectionDrawingLibraryRowActionsWidthClassName =
  'ml-auto flex w-auto max-w-[11.5rem] shrink-0 justify-end gap-0.5';
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
export const inspectionDrawingBoundedSelectClassName = clsx(
  kioskSelectClassName,
  'box-border w-full min-w-0 max-w-full text-[1.02rem]'
);

/** 測定値選択 select — 資源 select には影響させない */
export const inspectionDrawingMeasurementValueSelectClassName = clsx(
  inspectionDrawingBoundedSelectClassName,
  'font-bold'
);

/** 作成画面メタデータ — 資源 select フィールド幅（品番・テンプレ名等と同じ 10.5rem + はみ出しクリップ用 min-w-0） */
export const inspectionDrawingMetadataResourceFieldWidthClass = clsx(
  inspectionDrawingMetadataControlWidthClass,
  'min-w-0'
);
