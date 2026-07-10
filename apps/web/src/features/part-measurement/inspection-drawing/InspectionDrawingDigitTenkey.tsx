const DIGIT_KEYS = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '0'] as const;
const DIGIT_QUERY_MAX_LENGTH = 200;

type Props = {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
};

const keyClassName =
  'inline-flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded border border-white/15 bg-slate-950 text-[0.82rem] font-extrabold text-white hover:bg-slate-800 disabled:opacity-50';

const resetClassName =
  'inline-flex h-[34px] shrink-0 items-center justify-center rounded border border-amber-300/30 bg-slate-950 px-2 text-[0.68rem] font-extrabold text-amber-200 hover:bg-slate-800 disabled:opacity-50';

/** Menubar digit tenkey — digits + reset only (no input field / title / help text). */
export function InspectionDrawingDigitTenkey({ value, onChange, disabled = false }: Props) {
  return (
    <div
      role="group"
      aria-label="図面名数字テンキー"
      className="flex min-w-0 flex-1 items-center justify-center gap-0.5"
    >
      {DIGIT_KEYS.map((digit) => (
        <button
          key={digit}
          type="button"
          className={keyClassName}
          disabled={disabled || value.length >= DIGIT_QUERY_MAX_LENGTH}
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
