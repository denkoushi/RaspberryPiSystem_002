import type { DgxResourceServiceCard } from '../../../api/dgx-resource.types';

function badge(status: DgxResourceServiceCard['status'], badges: string[]): { text: string; className: string } {
  if (badges.includes('policy')) {
    return { text: 'POLICY', className: 'border-amber-400/50 bg-amber-500/15 text-amber-200' };
  }
  if (status === 'running') return { text: 'RUN', className: 'border-emerald-400/40 bg-emerald-500/15 text-emerald-200' };
  if (status === 'degraded')
    return { text: 'WARN', className: 'border-amber-400/40 bg-amber-500/15 text-amber-200' };
  if (status === 'stopped') return { text: 'OFF', className: 'border-red-400/35 bg-red-500/15 text-red-200' };
  return { text: 'N/A', className: 'border-white/15 bg-white/5 text-white/60' };
}

type Props = {
  services: DgxResourceServiceCard[];
};

export function DgxResourceServiceGrid({ services }: Props) {
  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-2">
      {services.map((svc) => {
        const b = badge(svc.status, svc.badges);
        return (
          <section
            key={svc.id}
            className="flex min-h-[6.5rem] flex-col rounded-lg border border-white/10 bg-slate-900/50 p-3"
          >
            <div className="flex items-start justify-between gap-2">
              <h3 className="truncate text-base font-bold text-white">{svc.name}</h3>
              <span className={`shrink-0 rounded-full border px-2 py-0.5 text-sm font-bold ${b.className}`}>
                {b.text}
              </span>
            </div>
            <ul className="mt-1.5 space-y-1 text-sm leading-snug text-white/55">
              {svc.metaLines.slice(0, 2).map((line, i) => (
                <li key={i} className="truncate" title={line}>
                  {line}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
