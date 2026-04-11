import { BarcodeBarsIcon } from '../icons/BarcodeBarsIcon';

import type { ButtonHTMLAttributes } from 'react';


type ScanVisualVariant = 'slip' | 'order';

const slipClasses =
  'flex h-10 w-10 shrink-0 items-center justify-center rounded-md border-0 bg-transparent text-sky-100 active:bg-white/[0.22] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/40 disabled:opacity-50';

const orderClasses =
  'flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-teal-400/30 bg-teal-500/10 text-teal-200 active:bg-teal-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/40 disabled:opacity-50';

export type IconScanButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  /** slip: 照合欄（枠なし・タップ時のみ背景） / order: 下半スキャン（ティール枠） */
  variant: ScanVisualVariant;
  title?: string;
};

/**
 * バーコードスキャン起動用の視覚ボタン（テキスト「スキャン」ではなくアイコンのみ）
 */
export function IconScanButton({ variant, className, title, ...rest }: IconScanButtonProps) {
  const base = variant === 'order' ? orderClasses : slipClasses;
  return (
    <button type="button" title={title} className={[base, className].filter(Boolean).join(' ')} {...rest}>
      <BarcodeBarsIcon className="h-6 w-6" />
    </button>
  );
}
