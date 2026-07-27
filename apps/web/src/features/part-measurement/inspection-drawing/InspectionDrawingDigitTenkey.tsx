import { KioskDigitTenkey } from '../../kiosk/KioskDigitTenkey';

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
    <KioskDigitTenkey
      value={value}
      onChange={onChange}
      disabled={disabled}
      maxLength={DIGIT_QUERY_MAX_LENGTH}
      ariaLabel="図面名数字テンキー"
      className="flex min-w-0 flex-1 items-center justify-center gap-0.5"
      keyClassName={keyClassName}
      resetClassName={resetClassName}
    />
  );
}
