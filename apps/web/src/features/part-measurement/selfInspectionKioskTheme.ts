import clsx from 'clsx';

export type SelfInspectionKioskButtonSize = 'default' | 'compact' | 'icon' | 'actionCompact';

export type SelfInspectionKioskButtonClassOptions = {
  disabled?: boolean;
  size?: SelfInspectionKioskButtonSize;
  wide?: boolean;
  pressed?: boolean;
  /** 押せる状態の強調（青外枠）。業務フローとは無関係な見た目フラグ */
  highlighted?: boolean;
};

const sizeClass: Record<SelfInspectionKioskButtonSize, string> = {
  default: 'min-h-11 px-4 text-[15px]',
  compact: 'min-h-11 px-2 text-sm',
  icon: 'min-h-11 min-w-11 px-2 text-[1.25rem] font-semibold leading-none',
  actionCompact: 'min-h-8 px-4 text-[15px]'
};

const enabledVisual =
  'rounded-md border-0 bg-slate-700 font-semibold text-white transition-colors hover:bg-slate-600';

/** ring / shadow のみ。border 幅は変えずレイアウトを維持する */
const highlightedAccent =
  'ring-2 ring-sky-400 shadow-[0_0_10px_rgba(56,189,248,0.55)]';

const disabledVisual =
  'cursor-not-allowed rounded-md border-0 bg-slate-800/50 font-semibold text-white/40';

/**
 * 自主検査セッション専用ボタン見た目（押せる＝1形・押せない＝1形・強調＝青外枠のみ）。
 * opacity/grayscale による無効表現は使わない。
 */
export function selfInspectionKioskButtonClass(
  options: SelfInspectionKioskButtonClassOptions = {}
): string {
  const size = options.size ?? 'default';
  const showHighlight = Boolean(options.highlighted && !options.disabled);
  return clsx(
    'inline-flex items-center justify-center',
    sizeClass[size],
    options.disabled ? disabledVisual : enabledVisual,
    showHighlight && highlightedAccent,
    options.wide && 'min-w-[11rem] px-5'
  );
}
