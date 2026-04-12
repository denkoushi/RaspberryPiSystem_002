import { Button } from '../../../../components/ui/Button';

/**
 * 3 択グリッド（エリア／列）。見出しは親では付けず、グリッドのみを描画（再利用・テスト容易）。
 */
export type ShelfRegisterChoiceItem<T extends string> = {
  id: T;
  label: string;
};

export type ShelfRegisterChoiceGridProps<T extends string> = {
  options: readonly ShelfRegisterChoiceItem<T>[];
  selectedId: T | null;
  onSelect: (id: T) => void;
  disabled?: boolean;
};

const choiceBtnBase =
  'flex min-h-[52px] min-w-0 items-center justify-center text-[1.6rem] font-bold leading-none';

export function ShelfRegisterChoiceGrid<T extends string>({
  options,
  selectedId,
  onSelect,
  disabled = false
}: ShelfRegisterChoiceGridProps<T>) {
  return (
    <div
      className={`grid grid-cols-3 gap-2 [grid-template-columns:repeat(3,minmax(0,1fr))] ${
        disabled ? 'pointer-events-none opacity-35' : ''
      }`}
    >
      {options.map((opt) => (
        <Button
          key={opt.id}
          type="button"
          variant={selectedId === opt.id ? 'primary' : 'ghostOnDark'}
          disabled={disabled}
          className={
            selectedId === opt.id
              ? `${choiceBtnBase} !text-white`
              : `${choiceBtnBase} border border-amber-400/35 bg-slate-800 !text-amber-100 active:bg-amber-500/20`
          }
          onClick={() => onSelect(opt.id)}
        >
          {opt.label}
        </Button>
      ))}
    </div>
  );
}
