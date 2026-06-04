import clsx from 'clsx';

/** 測定点の入力状態（empty / ok / ng）に応じたマーカー本体の見た目 */
export const INSPECTION_DRAWING_MARKER_STATUS_CLASS: Record<string, string> = {
  empty: 'bg-white text-slate-900 ring-2 ring-slate-400',
  ok: 'bg-emerald-500 text-white ring-2 ring-emerald-200',
  ng: 'bg-red-600 text-white ring-2 ring-red-200'
};

/**
 * 値入力パネルが向いている測定点の外周強調（状態 ring とは outline で分離）
 */
export function inspectionDrawingMarkerInputTargetOutlineClass(isInputTarget: boolean): string {
  return isInputTarget
    ? 'rounded-full outline outline-[3px] outline-offset-2 outline-sky-400'
    : '';
}

export function inspectionDrawingMarkerButtonClass(status: string): string {
  return clsx(
    'flex h-9 min-w-9 items-center justify-center rounded-full px-1 text-sm font-bold tabular-nums shadow-md',
    INSPECTION_DRAWING_MARKER_STATUS_CLASS[status] ?? INSPECTION_DRAWING_MARKER_STATUS_CLASS.empty
  );
}
