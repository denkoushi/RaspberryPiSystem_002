import clsx from 'clsx';

import {
  kioskButtonBaseClassName,
  kioskButtonPrimaryClassName,
  kioskButtonSecondaryClassName
} from '../kiosk/kioskTheme';

export type SelfInspectionKioskButtonSize = 'default' | 'compact' | 'icon' | 'actionCompact';

export type SelfInspectionKioskButtonTone = 'default' | 'inactive';

export type SelfInspectionKioskButtonClassOptions = {
  disabled?: boolean;
  size?: SelfInspectionKioskButtonSize;
  wide?: boolean;
  pressed?: boolean;
  /** 押せる状態の強調（emerald 塗り）。業務フローとは無関係な見た目フラグ */
  highlighted?: boolean;
  /** 操作可能だが OFF / 非選択の見た目（disabled とは別） */
  tone?: SelfInspectionKioskButtonTone;
};

const sizeClass: Record<SelfInspectionKioskButtonSize, string> = {
  default: 'min-h-11 px-4 text-[15px]',
  compact: 'min-h-11 px-2 text-sm',
  icon: 'min-h-11 min-w-11 px-2 text-[1.25rem] font-semibold leading-none',
  actionCompact: 'min-h-6 px-4 py-0 text-[15px] leading-none'
};

const actionCompactPrimaryVisual = clsx(
  'rounded-md font-semibold bg-emerald-500 text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-40'
);

const actionCompactSecondaryVisual = clsx(
  'rounded-md font-semibold border border-white/20 bg-white/5 text-white hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40'
);

const actionCompactDisabledVisual = clsx(
  'cursor-not-allowed rounded-md border border-white/20 bg-white/5 font-semibold text-white/40 opacity-40'
);

/** 操作可能だが inactive（例: 手元カメラ OFF）。disabled 属性は付けない */
const inactiveVisual = clsx(
  kioskButtonBaseClassName,
  'border border-white/10 bg-white/5 text-white/40 hover:bg-white/10 hover:text-white/55'
);

const disabledVisual = clsx(
  kioskButtonBaseClassName,
  'border border-white/20 bg-white/5 text-white/40 opacity-40'
);

function resolveBaseVisual(
  options: SelfInspectionKioskButtonClassOptions,
  size: SelfInspectionKioskButtonSize
): string {
  const compact = size === 'actionCompact';
  if (options.disabled) {
    return compact ? actionCompactDisabledVisual : disabledVisual;
  }
  if (options.highlighted) {
    return compact ? actionCompactPrimaryVisual : kioskButtonPrimaryClassName;
  }
  if (options.tone === 'inactive') {
    return inactiveVisual;
  }
  return compact ? actionCompactSecondaryVisual : kioskButtonSecondaryClassName;
}

/**
 * 自主検査セッション専用ボタン見た目（キオスク共通文法: secondary / primary-emerald / disabled-opacity）。
 */
export function selfInspectionKioskButtonClass(
  options: SelfInspectionKioskButtonClassOptions = {}
): string {
  const size = options.size ?? 'default';
  return clsx(
    'inline-flex items-center justify-center',
    sizeClass[size],
    resolveBaseVisual(options, size),
    options.wide && 'min-w-[11rem] px-5'
  );
}
