import { useEffect, useId, useRef, useState } from 'react';

type ProductionScheduleResourceFilterItem = {
  resourceCd: string;
  resourceNames: string[];
  selected: boolean;
  assignedOnlySelected: boolean;
};

type ProductionScheduleResourceFilterDropdownProps = {
  items: ProductionScheduleResourceFilterItem[];
  selectedCount: number;
  assignedOnlySelectedCount: number;
  onToggleResource: (resourceCd: string) => void;
  onToggleAssignedOnly: (resourceCd: string) => void;
  onSetAllResource: (selected: boolean) => void;
  onSetAllAssignedOnly: (selected: boolean) => void;
};

const getDisplayName = (resourceNames: string[]): string => {
  if (resourceNames.length === 0) return '-';
  return resourceNames.join(' / ');
};

export function ProductionScheduleResourceFilterDropdown({
  items,
  selectedCount,
  assignedOnlySelectedCount,
  onToggleResource,
  onToggleAssignedOnly,
  onSetAllResource,
  onSetAllAssignedOnly
}: ProductionScheduleResourceFilterDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const panelId = useId();
  const totalCount = items.length;
  const isDisabled = totalCount === 0;

  useEffect(() => {
    if (!isOpen) return undefined;
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
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
        資源CD ({selectedCount}/{totalCount}) 割当 ({assignedOnlySelectedCount}/{totalCount})
      </button>

      {isOpen ? (
        <div
          id={panelId}
          role="dialog"
          aria-label="資源CDフィルタ"
          className="absolute right-0 z-20 mt-2 w-[34rem] rounded-lg border border-white/20 bg-slate-950/95 p-3 shadow-xl"
        >
          <div className="mb-2 grid grid-cols-2 gap-2">
            <div className="rounded border border-white/15 bg-white/5 p-2">
              <p className="mb-1 text-[11px] text-white/80">通常 ({selectedCount}/{totalCount})</p>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  className="rounded border border-emerald-300/60 bg-emerald-500/20 px-2 py-1 text-[11px] font-semibold text-emerald-100 hover:bg-emerald-500/30"
                  onClick={() => onSetAllResource(true)}
                >
                  全ON
                </button>
                <button
                  type="button"
                  className="rounded border border-slate-300/50 bg-slate-500/20 px-2 py-1 text-[11px] font-semibold text-slate-100 hover:bg-slate-500/30"
                  onClick={() => onSetAllResource(false)}
                >
                  全OFF
                </button>
              </div>
            </div>
            <div className="rounded border border-white/15 bg-white/5 p-2">
              <p className="mb-1 text-[11px] text-white/80">割当 ({assignedOnlySelectedCount}/{totalCount})</p>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  className="rounded border border-emerald-300/60 bg-emerald-500/20 px-2 py-1 text-[11px] font-semibold text-emerald-100 hover:bg-emerald-500/30"
                  onClick={() => onSetAllAssignedOnly(true)}
                >
                  全ON
                </button>
                <button
                  type="button"
                  className="rounded border border-slate-300/50 bg-slate-500/20 px-2 py-1 text-[11px] font-semibold text-slate-100 hover:bg-slate-500/30"
                  onClick={() => onSetAllAssignedOnly(false)}
                >
                  全OFF
                </button>
              </div>
            </div>
          </div>

          <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
            {items.map((item) => {
              const displayName = getDisplayName(item.resourceNames);
              return (
                <div key={item.resourceCd} className="rounded border border-white/20 bg-white/5 p-2">
                  <p className="truncate text-[11px] font-semibold text-white">
                    <span className="font-mono">{item.resourceCd}</span>
                    <span className="ml-1 text-white/70">: {displayName}</span>
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      className={`rounded border px-2 py-1 text-[11px] font-semibold ${
                        item.selected
                          ? 'border-emerald-300 bg-emerald-500/30 text-emerald-100'
                          : 'border-white/25 bg-white/10 text-white/80'
                      }`}
                      onClick={() => onToggleResource(item.resourceCd)}
                    >
                      通常
                    </button>
                    <button
                      type="button"
                      className={`rounded border px-2 py-1 text-[11px] font-semibold ${
                        item.assignedOnlySelected
                          ? 'border-amber-300 bg-amber-500/30 text-amber-100'
                          : 'border-white/25 bg-white/10 text-white/80'
                      }`}
                      onClick={() => onToggleAssignedOnly(item.resourceCd)}
                    >
                      割当
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
