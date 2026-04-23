import { mpKioskTheme } from '../../mobile-placement/ui/mobilePlacementKioskTheme';

export type PalletVizMobilePageHeaderProps = {
  digits: readonly number[];
  title: string;
  backButtonLabel?: string;
  backButtonAriaLabel?: string;
  onNavigateBack: () => void;
};

/**
 * 配膳スマホパレット画面ヘッダ（戻る・入力表示・タイトル）
 */
export function PalletVizMobilePageHeader({
  digits,
  title,
  backButtonLabel = '戻る',
  backButtonAriaLabel = '配膳に戻る',
  onNavigateBack,
}: PalletVizMobilePageHeaderProps) {
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <button
          type="button"
          className={mpKioskTheme.partSearchButton}
          aria-label={backButtonAriaLabel}
          onClick={onNavigateBack}
        >
          {backButtonLabel}
        </button>
        <p className="min-w-0 text-sm font-bold text-amber-200">
          入力{' '}
          <span className="font-mono text-2xl tabular-nums text-white">
            {digits.length === 0 ? '—' : digits.join('')}
          </span>
        </p>
      </div>
      <h1 className="min-w-0 text-lg font-extrabold text-amber-200">{title}</h1>
    </div>
  );
}
