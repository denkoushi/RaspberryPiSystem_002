import { hp } from '../ui/haizenPhoneTokens';

import type { CSSProperties, ReactNode } from 'react';

export function HaizenStub({ label, prompt, value, color, active, locked, onScan, onClear, children, aside }: {
  label: string; prompt: string; value: string; color: string; active: boolean; locked?: boolean;
  onScan: () => void; onClear: () => void; children?: ReactNode; aside?: ReactNode;
}) {
  return <section style={{ '--stub': color } as CSSProperties}
    className={`relative grid min-h-24 grid-cols-[minmax(0,1fr)_auto] gap-x-2.5 gap-y-1 rounded-2xl border py-3 pl-[18px] pr-3.5 text-left before:absolute before:bottom-3.5 before:left-0 before:top-3.5 before:w-1 before:rounded-r before:bg-[var(--stub)] ${active ? 'border-[var(--stub)] bg-[var(--hp-panel2)]' : 'border-[var(--hp-line)] bg-[var(--hp-panel)]'} ${locked ? 'opacity-40' : ''}`}>
    <button type="button" onClick={onScan} disabled={locked} aria-label={`${label}を読む`} className="min-w-0 text-left">
      <span className="block text-[13px] font-bold tracking-[.06em] text-[var(--stub)]">{label}</span>
      <span className={value ? `mt-1 block break-all font-mono font-bold leading-[1.15] tracking-[.02em] tabular-nums ${label === '棚' ? 'text-[40px] text-[var(--hp-shelf)]' : 'text-[26px]'}` : `mt-1 block text-[17px] font-bold ${hp.faint}`}>{value || prompt}</span>
    </button>
    <div className="flex flex-col items-end gap-1.5">
      {value && <button type="button" className={hp.mini} aria-label={`${label}をクリア`} onClick={onClear}>×</button>}
      {aside}
    </div>
    {children && <div className="col-span-2">{children}</div>}
  </section>;
}
