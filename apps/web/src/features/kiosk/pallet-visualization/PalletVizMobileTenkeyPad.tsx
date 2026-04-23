import clsx from 'clsx';

import { mpKioskTheme } from '../../mobile-placement/ui/mobilePlacementKioskTheme';

const KEYS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
const TKEY = 'min-h-12 min-w-[3.5rem] rounded-lg border-2 border-sky-500 bg-[#042f2e] text-xl font-extrabold text-white active:bg-sky-700/30';

export type PalletVizMobileTenkeyPadProps = {
  digitBuffer: number[];
  onDigit: (d: number) => void;
  onBackspace: () => void;
  onClear: () => void;
  disabled?: boolean;
};

/**
 * 0〜9 + 戻る + クリア。第3キーは内部でバッファを上書きする想定（親の onDigit 側で実装）。
 */
export function PalletVizMobileTenkeyPad({ digitBuffer, onDigit, onBackspace, onClear, disabled }: PalletVizMobileTenkeyPadProps) {
  return (
    <div className="space-y-2" aria-label="パレット番号テンキー">
      <p className="text-sm font-bold text-amber-200">
        入力:{' '}
        <span className="font-mono text-2xl tabular-nums text-white">
          {digitBuffer.length === 0 ? '—' : digitBuffer.join('')}
        </span>
      </p>
      <div className="grid max-w-sm grid-cols-3 gap-1.5">
        {KEYS.map((d) => (
          <button
            key={d}
            type="button"
            disabled={disabled}
            className={clsx(TKEY, 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/40', disabled && 'opacity-40')}
            onClick={() => onDigit(d)}
          >
            {d}
          </button>
        ))}
      </div>
      <div className="flex max-w-sm flex-nowrap gap-1.5">
        <button
          type="button"
          disabled={disabled}
          className={clsx('flex-1', TKEY, 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/40', disabled && 'opacity-40')}
          onClick={() => onDigit(0)}
        >
          0
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={onBackspace}
          className={clsx(mpKioskTheme.orderIntentButton, 'min-h-12 flex-1 text-sm', disabled && 'opacity-40')}
        >
          1つ戻る
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={onClear}
          className={clsx(mpKioskTheme.orderIntentButton, 'min-h-12 flex-1 text-sm', disabled && 'opacity-40')}
        >
          クリア
        </button>
      </div>
    </div>
  );
}
