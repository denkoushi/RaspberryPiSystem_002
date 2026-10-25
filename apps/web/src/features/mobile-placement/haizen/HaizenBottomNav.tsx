import type { ReactNode } from 'react';

export type HaizenTab = 'verify' | 'place' | 'purchase' | 'parts';

const tabs = [
  { tab: 'verify', label: '照合' }, { tab: 'place', label: '配膳' },
  { tab: 'purchase', label: '購買' }, { tab: 'parts', label: '部品' }
] as const;

export function HaizenBottomNav({ active, onSelect, onMenu, children }: {
  active: HaizenTab; onSelect: (tab: HaizenTab) => void; onMenu: () => void; children?: ReactNode;
}) {
  return <footer className="flex shrink-0 flex-col gap-2 pt-2 pb-[calc(22px+env(safe-area-inset-bottom,0px))]">
    {children && <div className="flex gap-2 px-3.5">{children}</div>}
    <div className="flex items-center gap-1.5 pl-3.5 pr-[var(--hp-hermes-gutter)]">
      <div role="tablist" aria-label="作業" className="flex h-[58px] min-w-0 flex-1 gap-0.5 rounded-2xl border border-[var(--hp-line)] bg-[var(--hp-panel)] p-[3px]">
        {tabs.map(({ tab, label }) => <button key={tab} type="button" role="tab" aria-selected={active === tab} onClick={() => onSelect(tab)}
          className="min-w-0 flex-1 whitespace-nowrap rounded-xl text-[17px] font-black text-[var(--hp-ink2)] aria-selected:bg-[var(--hp-ink)] aria-selected:text-[var(--hp-bg)]">{label}</button>)}
      </div>
      <button type="button" aria-label="ほかの画面" onClick={onMenu} className="grid h-[58px] w-11 shrink-0 place-items-center rounded-[14px] border border-[var(--hp-line)] bg-[var(--hp-panel)] text-[18px] font-black text-[var(--hp-ink2)]">⋮</button>
    </div>
  </footer>;
}
