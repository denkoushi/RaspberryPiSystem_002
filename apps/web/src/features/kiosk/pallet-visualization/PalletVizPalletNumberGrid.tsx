import clsx from 'clsx';

import { DEFAULT_KIOSK_PALLET_COUNT } from './palletVizNumberGridConfig';

export type PalletVizPalletNumberGridProps = {
  /** 加工機のパレット欄 1..N */
  palletCount: number;
  selectedPalletNo: number;
  onSelectPalletNo: (n: number) => void;
  /** 左ペイン等の狭い幅向け（パディング・文字を縮小） */
  variant?: 'default' | 'compact';
};

/**
 * パレット番号 1..palletCount のグリッド（5列折返し）。アクセシビリティ属性は本画面と埋め込みで共通。
 */
export function PalletVizPalletNumberGrid({
  palletCount: palletCountProp,
  selectedPalletNo,
  onSelectPalletNo,
  variant = 'default',
}: PalletVizPalletNumberGridProps) {
  const compact = variant === 'compact';
  const palletCount = Math.max(1, palletCountProp || DEFAULT_KIOSK_PALLET_COUNT);

  return (
    <div
      className={clsx('grid w-full min-w-0 shrink-0 grid-cols-5', compact ? 'gap-1.5' : 'gap-2 sm:w-[17.5rem] sm:min-w-[17.5rem]')}
      role="group"
      aria-label={`パレット番号1から${palletCount}を選択`}
    >
      {Array.from({ length: palletCount }, (_, i) => i + 1).map((n) => {
        const selected = selectedPalletNo === n;
        return (
          <button
            key={n}
            type="button"
            aria-pressed={selected}
            aria-label={`パレット${n}`}
            onClick={() => onSelectPalletNo(n)}
            className={clsx(
              'rounded-lg text-center leading-none',
              compact
                ? 'py-2 text-lg font-bold tabular-nums sm:text-xl'
                : 'py-2 sm:py-3 text-2xl font-bold tabular-nums sm:text-[1.75rem]',
              selected ? 'bg-amber-500 text-slate-900' : 'bg-slate-800 text-white hover:bg-slate-700'
            )}
          >
            {n}
          </button>
        );
      })}
    </div>
  );
}
