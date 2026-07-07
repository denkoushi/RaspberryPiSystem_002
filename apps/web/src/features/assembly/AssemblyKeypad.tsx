export const ASSEMBLY_IDENTIFIER_KEYS = [
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '0',
  'A',
  'B',
  'C',
  'D',
  'E',
  'F',
  'G',
  'H',
  'I',
  'J',
  'K',
  'L',
  'M',
  'N',
  'O',
  'P',
  'Q',
  'R',
  'S',
  'T',
  'U',
  'V',
  'W',
  'X',
  'Y',
  'Z'
] as const;

type Props = {
  ariaLabel: string;
  disabled?: boolean;
  onKey: (key: string) => void;
  onBackspace: () => void;
  onClear: () => void;
};

const keyClassName =
  'min-h-7 rounded border border-white/15 bg-slate-950 text-[0.76rem] font-bold text-white hover:bg-slate-800 disabled:opacity-50';
const actionKeyClassName =
  'min-h-7 rounded border border-amber-300/25 bg-slate-950 text-[0.68rem] font-bold text-amber-200 hover:bg-slate-800 disabled:opacity-50';

export function AssemblyKeypad({ ariaLabel, disabled = false, onKey, onBackspace, onClear }: Props) {
  return (
    <div role="group" aria-label={ariaLabel} className="grid grid-cols-8 gap-1">
      {ASSEMBLY_IDENTIFIER_KEYS.map((key) => (
        <button key={key} type="button" className={keyClassName} disabled={disabled} onClick={() => onKey(key)}>
          {key}
        </button>
      ))}
      <button type="button" className={actionKeyClassName} disabled={disabled} onClick={onBackspace}>
        BS
      </button>
      <button type="button" className={actionKeyClassName} disabled={disabled} onClick={onClear}>
        CLR
      </button>
    </div>
  );
}
