import { useEffect, useId, useRef, useState } from 'react';

import { normalizeMachineName } from '../../features/kiosk/productionSchedule/machineName';

import { AnchoredDropdownPortal } from './AnchoredDropdownPortal';

type ProductionScheduleSeibanFilterItem = {
  fseiban: string;
  machineName?: string | null;
  selected: boolean;
};

type ProductionScheduleSeibanFilterDropdownProps = {
  items: ProductionScheduleSeibanFilterItem[];
  selectedCount: number;
  totalCount: number;
  onToggle: (fseiban: string) => void;
  onSetAll: (selected: boolean) => void;
};

export function ProductionScheduleSeibanFilterDropdown({
  items,
  selectedCount,
  totalCount,
  onToggle,
  onSetAll
}: ProductionScheduleSeibanFilterDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const panelId = useId();
  const isDisabled = totalCount === 0;

  useEffect(() => {
    if (!isOpen) return undefined;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      const isInsideRoot = rootRef.current?.contains(target) ?? false;
      const isInsidePanel = panelRef.current?.contains(target) ?? false;
      if (!isInsideRoot && !isInsidePanel) {
        setIsOpen(false);
      }
    };
    window.addEventListener('mousedown', handlePointerDown);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
    };
  }, [isOpen]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className="w-full rounded border border-white/30 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-60"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={panelId}
        disabled={isDisabled}
        onClick={() => setIsOpen((prev) => !prev)}
      >
        登録製番 ({selectedCount}/{totalCount})
      </button>

      <AnchoredDropdownPortal
        isOpen={isOpen}
        id={panelId}
        ariaLabel="登録製番フィルタ"
        anchorRef={rootRef}
        panelRef={panelRef}
        className="w-[31rem] rounded-lg border border-white/20 bg-slate-950/95 p-3 shadow-xl"
      >
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs text-white/80">表示対象を選択 ({selectedCount}/{totalCount})</p>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                className="rounded border border-emerald-300/60 bg-emerald-500/20 px-2 py-1 text-[11px] font-semibold text-emerald-100 hover:bg-emerald-500/30"
                onClick={() => onSetAll(true)}
              >
                全てON
              </button>
              <button
                type="button"
                className="rounded border border-slate-300/50 bg-slate-500/20 px-2 py-1 text-[11px] font-semibold text-slate-100 hover:bg-slate-500/30"
                onClick={() => onSetAll(false)}
              >
                全てOFF
              </button>
            </div>
          </div>

          <div className="grid max-h-[min(70vh,32rem)] grid-cols-2 gap-2 overflow-y-auto pr-1 lg:grid-cols-3">
            {items.map((item) => (
              <button
                key={item.fseiban}
                type="button"
                className={`rounded border px-2 py-1 text-left ${
                  item.selected
                    ? 'border-emerald-300 bg-emerald-400/20 text-emerald-50'
                    : 'border-white/20 bg-white/5 text-white/70'
                }`}
                onClick={() => onToggle(item.fseiban)}
              >
                <span className="block truncate font-mono text-[11px] leading-4">{item.fseiban}</span>
                <span className="block truncate text-[10px] leading-4">
                  {normalizeMachineName(item.machineName) || '-'}
                </span>
              </button>
            ))}
          </div>
      </AnchoredDropdownPortal>
    </div>
  );
}
