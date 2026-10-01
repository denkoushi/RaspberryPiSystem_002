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
  'h-11 rounded-md bg-[#1f2730] font-mono text-lg font-semibold text-[#eef3f6] hover:bg-[#2a343f] active:bg-[#35d6ae] active:text-[#04221b] disabled:opacity-50';
const actionKeyClassName =
  'col-span-2 h-11 rounded-md bg-[#1f2730] text-sm font-bold text-[#97a5b2] hover:bg-[#2a343f] disabled:opacity-50';

export function AssemblyKeypad({ ariaLabel, disabled = false, onKey, onBackspace, onClear }: Props) {
  return (
    <div role="group" aria-label={ariaLabel} className="grid grid-cols-10 gap-1.5">
      {ASSEMBLY_IDENTIFIER_KEYS.map((key) => (
        <button key={key} type="button" className={keyClassName} disabled={disabled} onClick={() => onKey(key)}>
          {key}
        </button>
      ))}
      <button type="button" className={actionKeyClassName} disabled={disabled} aria-label="BS" onClick={onBackspace}>
        1字消す
      </button>
      <button type="button" className={actionKeyClassName} disabled={disabled} aria-label="CLR" onClick={onClear}>
        全消し
      </button>
    </div>
  );
}
