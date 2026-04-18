import { BarcodeBarsIcon } from '../icons/BarcodeBarsIcon';

import type { ButtonHTMLAttributes } from 'react';


type ScanVisualVariant = 'slip' | 'order';

const slipClasses =
  'flex h-10 w-10 shrink-0 items-center justify-center rounded-md border-0 bg-transparent text-sky-100 active:bg-white/[0.22] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/40 disabled:opacity-50';

const orderClasses =
  'flex h-12 w-12 shrink-0 items-center justify-center rounded-md border-2 border-teal-500 bg-[#134e4a] text-white active:bg-teal-600/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/40 disabled:opacity-50';

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
  const iconClass = variant === 'order' ? 'h-[1.85rem] w-[1.85rem]' : 'h-6 w-6';
  return (
    <button type="button" title={title} className={[base, className].filter(Boolean).join(' ')} {...rest}>
      <BarcodeBarsIcon className={iconClass} />
    </button>
  );
}
