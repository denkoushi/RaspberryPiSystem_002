import { Button } from '../../../../components/ui/Button';

export type ShelfRegisterSlotGridProps = {
  slotMax: number;
  occupied: Set<number>;
  selectedSlot: number | null;
  onSelect: (slot: number) => void;
  disabled?: boolean;
};

/**
 * 空き番号 5 列グリッド。親セクションが flex-1 のときに縦いっぱい使う（max-height キャップなし）。
 */
export function ShelfRegisterSlotGrid({
  slotMax,
  occupied,
  selectedSlot,
  onSelect,
  disabled = false
}: ShelfRegisterSlotGridProps) {
  const count = Number.isFinite(slotMax) ? Math.min(999, Math.max(0, Math.floor(slotMax))) : 0;

  return (
    <div
      className={`grid min-h-0 flex-1 grid-cols-5 gap-2 overflow-y-auto [grid-template-columns:repeat(5,minmax(0,1fr))] ${
        disabled ? 'pointer-events-none opacity-35' : ''
      }`}
    >
      {Array.from({ length: count }, (_, i) => i + 1).map((n) => {
        const isOcc = occupied.has(n);
        return (
          <Button
            key={n}
            type="button"
            variant={selectedSlot === n ? 'primary' : 'ghostOnDark'}
            disabled={disabled || isOcc}
            className={
              isOcc
                ? 'flex min-h-12 min-w-0 items-center justify-center line-through opacity-25'
                : selectedSlot === n
                  ? 'flex min-h-12 min-w-0 items-center justify-center text-xl font-semibold tabular-nums !text-white'
                  : 'flex min-h-12 min-w-0 items-center justify-center border border-amber-400/20 bg-slate-800 text-xl font-semibold tabular-nums !text-white'
            }
            onClick={() => onSelect(n)}
          >
            {String(n).padStart(2, '0')}
          </Button>
        );
      })}
    </div>
  );
}
