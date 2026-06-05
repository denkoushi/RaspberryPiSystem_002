import clsx from 'clsx';

export type SelfInspectionKioskButtonSize = 'default' | 'compact' | 'icon';

export type SelfInspectionKioskButtonClassOptions = {
  disabled?: boolean;
  size?: SelfInspectionKioskButtonSize;
  wide?: boolean;
  pressed?: boolean;
};

const sizeClass: Record<SelfInspectionKioskButtonSize, string> = {
  default: 'min-h-11 px-4 text-[15px]',
  compact: 'min-h-11 px-2 text-sm',
  icon: 'min-h-11 min-w-11 px-2 text-[1.25rem] font-semibold leading-none'
};

const enabledVisual =
  'rounded-md border border-slate-500 bg-slate-700 font-semibold text-white transition-colors hover:border-slate-400 hover:bg-slate-600';

const disabledVisual =
  'cursor-not-allowed rounded-md border border-white/12 bg-slate-800/50 font-semibold text-white/40';

/**
 * 自主検査セッション専用ボタン見た目（押せる＝1形・押せない＝1形）。
 * opacity/grayscale による無効表現は使わない。
 */
export function selfInspectionKioskButtonClass(
  options: SelfInspectionKioskButtonClassOptions = {}
): string {
  const size = options.size ?? 'default';
  return clsx(
    'inline-flex items-center justify-center',
    sizeClass[size],
    options.disabled ? disabledVisual : enabledVisual,
    options.wide && 'min-w-[11rem] px-5'
  );
}
