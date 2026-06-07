import clsx from 'clsx';

import type {
  DgxResourceDashboardViewModel,
  DgxResourceStatusTone,
} from './dgxResourceDashboardViewModel';

type Props = {
  viewModel: DgxResourceDashboardViewModel;
};

function toneClass(tone: DgxResourceStatusTone): string {
  switch (tone) {
    case 'good':
      return 'border-emerald-400/35 bg-emerald-500/10 text-emerald-100';
    case 'loading':
      return 'border-sky-400/35 bg-sky-500/10 text-sky-100';
    case 'warn':
      return 'border-amber-400/35 bg-amber-500/10 text-amber-100';
    case 'danger':
      return 'border-red-400/35 bg-red-500/10 text-red-100';
    case 'info':
      return 'border-cyan-400/30 bg-cyan-500/10 text-cyan-100';
    case 'muted':
    default:
      return 'border-white/12 bg-white/[0.04] text-white/80';
  }
}

export function DgxResourceStatusHeader({ viewModel }: Props) {
  return (
    <header className="space-y-3 border-b border-white/10 pb-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-white">DGX リソース</h1>
        <div className="flex flex-wrap gap-1.5">
          {viewModel.services.map((service) => (
            <span
              key={service.key}
              className={clsx(
                'rounded-md border px-2.5 py-1 text-xs font-semibold',
                toneClass(service.tone)
              )}
              title={service.hint}
            >
              {service.label} {service.value}
            </span>
          ))}
        </div>
      </div>

      <section className="grid grid-cols-2 gap-2 lg:grid-cols-4" aria-label="DGX 現在状態">
        {viewModel.headerItems.map((item) => (
          <div
            key={item.key}
            className={clsx('min-h-[4.75rem] rounded-md border px-3 py-2.5', toneClass(item.tone))}
            title={item.hint}
          >
            <div className="text-xs font-medium text-white/55">{item.label}</div>
            <div className="mt-1 break-words text-base font-semibold leading-snug text-white sm:text-lg">
              {item.value}
            </div>
          </div>
        ))}
      </section>
    </header>
  );
}
