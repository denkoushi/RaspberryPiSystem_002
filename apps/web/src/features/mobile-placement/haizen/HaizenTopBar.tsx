export type HaizenTab = 'verify' | 'place' | 'purchase' | 'parts';

const tabs = [
  { tab: 'verify', label: '照合' }, { tab: 'place', label: '配膳' },
  { tab: 'purchase', label: '購買' }, { tab: 'parts', label: '部品' }
] as const;

export function HaizenTopBar({ active, onSelect, onMenu }: {
  active: HaizenTab; onSelect: (tab: HaizenTab) => void; onMenu: () => void;
}) {
  return <header className="flex shrink-0 items-center gap-1.5 px-3.5 pb-2 pt-3.5">
    <div role="tablist" aria-label="作業" className="grid min-w-0 flex-1 grid-cols-4 gap-1 rounded-[14px] border border-[var(--hp-line)] bg-[var(--hp-panel)] p-1">
      {tabs.map(({ tab, label }) => <button key={tab} type="button" role="tab" aria-selected={active === tab} onClick={() => onSelect(tab)}
        className="h-10 min-w-0 whitespace-nowrap rounded-[10px] text-[17px] font-black text-[var(--hp-ink2)] aria-selected:bg-[var(--hp-ink)] aria-selected:text-[var(--hp-bg)]">{label}</button>)}
    </div>
    <button type="button" aria-label="ほかの画面" onClick={onMenu} className="grid h-12 w-11 shrink-0 place-items-center rounded-[14px] border border-[var(--hp-line)] bg-[var(--hp-panel)]">•••</button>
  </header>;
}
