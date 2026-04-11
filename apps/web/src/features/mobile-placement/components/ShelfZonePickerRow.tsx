import { Button } from '../../../components/ui/Button';
import { ViewfinderIcon } from '../icons/ViewfinderIcon';

import type { ShelfZoneDefinition, ShelfZoneId } from '../shelfZones/shelfZoneTypes';

export type ShelfZonePickerRowProps = {
  zones: readonly ShelfZoneDefinition[];
  onOpenZone: (id: ShelfZoneId) => void;
  onQrScan: () => void;
};

/**
 * 中央/東/西 + QR を 1 行相当の 4 列グリッドに配置（各セルは行幅の 1/4）
 */
export function ShelfZonePickerRow({ zones, onOpenZone, onQrScan }: ShelfZonePickerRowProps) {
  return (
    <div className="grid grid-cols-4 gap-2 [grid-template-columns:repeat(4,minmax(0,1fr))]">
      {zones.map((z) => (
        <Button
          key={z.id}
          type="button"
          variant="ghostOnDark"
          className="min-h-[52px] min-w-0 max-w-full flex-col gap-0.5 border border-amber-400/35 bg-slate-800 py-2 text-sm font-bold !text-amber-100 active:bg-amber-500/20"
          aria-label={`${z.label}の棚一覧を開く`}
          onClick={() => onOpenZone(z.id)}
        >
          {z.label}
        </Button>
      ))}
      <button
        type="button"
        className="flex min-h-[52px] min-w-0 max-w-full flex-col items-center justify-center gap-1 border-0 bg-transparent py-2 text-xs font-semibold text-slate-300 active:bg-white/[0.22] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/40"
        title="棚のQRコードをスキャン"
        aria-label="棚をQRスキャン"
        onClick={onQrScan}
      >
        <ViewfinderIcon className="h-[18px] w-[18px] text-sky-300" />
        <span>QR</span>
      </button>
    </div>
  );
}
