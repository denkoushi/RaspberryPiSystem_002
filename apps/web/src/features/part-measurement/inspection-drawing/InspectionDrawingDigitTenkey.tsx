import { ASCENDING_DIGIT_KEYS, KioskDigitTenkey } from '../../kiosk/KioskDigitTenkey';

const DIGIT_QUERY_MAX_LENGTH = 200;

type Props = {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  ariaLabel?: string;
};

const keyClassName =
  'inline-flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded border border-white/15 bg-slate-950 text-[0.82rem] font-extrabold text-white hover:bg-slate-800 disabled:opacity-50';

const resetClassName =
  'inline-flex h-[34px] shrink-0 items-center justify-center rounded border border-amber-300/30 bg-slate-950 px-2 text-[0.68rem] font-extrabold text-amber-200 hover:bg-slate-800 disabled:opacity-50';

/** Menubar digit tenkey — entered-digits display, digits 1-9 0, backspace, reset. */
export function InspectionDrawingDigitTenkey({ value, onChange, disabled = false, ariaLabel = '図面名数字テンキー' }: Props) {
  return (
    <div className="flex min-w-0 flex-1 items-center justify-center gap-1.5">
      <output
        aria-label="入力した数字"
        className="block h-[34px] w-48 min-w-0 shrink overflow-hidden whitespace-nowrap rounded border border-white/15 bg-slate-950 px-2.5 text-left text-lg font-extrabold leading-[32px] tracking-wider tabular-nums text-white [direction:rtl]"
      >
        {value}
      </output>
      <KioskDigitTenkey
        value={value}
        onChange={onChange}
        disabled={disabled}
        maxLength={DIGIT_QUERY_MAX_LENGTH}
        ariaLabel={ariaLabel}
        digits={ASCENDING_DIGIT_KEYS}
        showBackspace
        className="flex shrink-0 items-center gap-0.5"
        keyClassName={keyClassName}
        resetClassName={resetClassName}
      />
    </div>
  );
}
