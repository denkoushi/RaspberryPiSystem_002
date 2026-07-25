const DIGIT_KEYS = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '0'] as const;

type Props = {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  maxLength?: number;
  ariaLabel?: string;
  className?: string;
  keyClassName?: string;
  resetClassName?: string;
};

const defaultKeyClassName =
  'inline-flex h-11 min-w-11 flex-1 items-center justify-center rounded border border-white/15 bg-slate-950 text-lg font-extrabold text-white hover:bg-slate-800 disabled:opacity-40';
const defaultResetClassName =
  'inline-flex h-11 items-center justify-center rounded border border-amber-300/30 bg-slate-950 px-3 text-sm font-extrabold text-amber-200 hover:bg-slate-800 disabled:opacity-40';

export function KioskDigitTenkey({
  value,
  onChange,
  disabled = false,
  maxLength = 120,
  ariaLabel = '数字テンキー',
  className,
  keyClassName = defaultKeyClassName,
  resetClassName = defaultResetClassName
}: Props) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={className ?? 'grid grid-cols-3 gap-2'}
    >
      {DIGIT_KEYS.map((digit) => (
        <button
          key={digit}
          type="button"
          className={keyClassName}
          disabled={disabled || value.length >= maxLength}
          onClick={() => onChange(`${value}${digit}`)}
        >
          {digit}
        </button>
      ))}
      <button
        type="button"
        className={resetClassName}
        disabled={disabled || value.length === 0}
        onClick={() => onChange('')}
      >
        リセット
      </button>
    </div>
  );
}
