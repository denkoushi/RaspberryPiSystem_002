import { hp } from '../ui/haizenPhoneTokens';

import { HaizenIcon } from './HaizenIcon';

import type { CSSProperties, ReactNode } from 'react';

export function HaizenStub({ label, prompt, value, color, active, locked, onScan, onClear, children, aside, subtitle, thumbnail }: {
  subtitle?: string; thumbnail?: ReactNode;
  label: string; prompt: string; value: string; color: string; active: boolean; locked?: boolean;
  onScan: () => void; onClear: () => void; children?: ReactNode; aside?: ReactNode;
}) {
  return <section style={{ '--stub': color } as CSSProperties}
    className={`relative grid min-h-24 grid-cols-[minmax(0,1fr)_auto] gap-x-2.5 gap-y-1 rounded-2xl border-2 py-3 pl-[18px] pr-3.5 text-left before:absolute before:bottom-3.5 before:left-0 before:top-3.5 before:w-1 before:rounded-r before:bg-[var(--stub)] ${active ? 'border-[var(--stub)] bg-[var(--hp-panel2)]' : 'border-[var(--hp-line)] bg-[var(--hp-panel)]'} ${locked ? 'opacity-40' : ''}`}>
    <button type="button" onClick={onScan} disabled={locked} aria-label={`${label}を読む`} className="flex min-w-0 items-center gap-3 text-left">
      {thumbnail || <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-[color-mix(in_srgb,var(--stub)_18%,transparent)] text-[var(--stub)]"><HaizenIcon name={label === '棚' ? 'grid' : label === '移動票' ? 'receipt' : 'pallet'} className="h-7 w-7" /></span>}
      <span className="min-w-0 flex-1"><span className="flex flex-wrap items-baseline gap-x-2 text-2xl font-black text-[var(--stub)]">{label}<small className={`text-[15px] font-bold ${hp.muted}`}>{subtitle}</small></span>
        <span className={value ? 'mt-0.5 block break-all font-mono text-[28px] font-bold leading-[1.15] tabular-nums' : `mt-1 block text-[15px] font-bold ${hp.faint}`}>{value || prompt}</span>
      </span>
    </button>
    <div className="flex flex-col items-end gap-1.5">
      {value && <button type="button" className={hp.mini} aria-label={`${label}をクリア`} onClick={onClear}>×</button>}
      {aside}
    </div>
    {children && <div className="col-span-2">{children}</div>}
  </section>;
}
