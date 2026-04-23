import clsx from 'clsx';

import { mpKioskTheme } from '../../mobile-placement/ui/mobilePlacementKioskTheme';

import { PalletVizBarcodeGlyph } from './PalletVizBarcodeGlyph';
import { palletVizMobileTenkeyTokens } from './palletVizMobileTenkeyTokens';

const DIGIT_KEYS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0] as const;
const TKEY =
  'min-h-12 min-w-0 w-full rounded-lg border-2 border-sky-500 bg-[#042f2e] text-xl font-extrabold text-white active:bg-sky-700/30';

export type PalletVizMobileTenkeyPadProps = {
  onDigit: (d: number) => void;
  onBackspace: () => void;
  onClear: () => void;
  /** 製造orderスキャン（確定）モーダルを開く */
  onOpenOrderScan: () => void;
  disabled?: boolean;
};

/**
 * 0〜9（5列×2行）+ クリア + 1つ戻る（←）+ スキャン（バーコードアイコン）。入力表示は親に任せる。
 */
export function PalletVizMobileTenkeyPad({
  onDigit,
  onBackspace,
  onClear,
  onOpenOrderScan,
  disabled,
}: PalletVizMobileTenkeyPadProps) {
  return (
    <div className="space-y-2" aria-label="パレット番号テンキー">
      <div className="grid max-w-sm grid-cols-5 gap-1.5">
        {DIGIT_KEYS.map((d) => (
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
      <div className="flex w-full max-w-sm flex-nowrap items-stretch gap-1.5">
        <button
          type="button"
          disabled={disabled}
          onClick={onClear}
          className={clsx(
            mpKioskTheme.orderIntentButton,
            palletVizMobileTenkeyTokens.clearButton,
            disabled && 'opacity-40'
          )}
          aria-label="クリア"
        >
          クリア
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={onBackspace}
          className={clsx(
            mpKioskTheme.orderIntentButton,
            palletVizMobileTenkeyTokens.arrowButton,
            disabled && 'opacity-40'
          )}
          aria-label="1つ戻る"
        >
          <span aria-hidden>←</span>
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={onOpenOrderScan}
          className={clsx(mpKioskTheme.orderSubmitButton, palletVizMobileTenkeyTokens.scanButton)}
          aria-label="製造orderをスキャン（確定）"
        >
          <PalletVizBarcodeGlyph className={palletVizMobileTenkeyTokens.scanGlyph} />
        </button>
      </div>
    </div>
  );
}
