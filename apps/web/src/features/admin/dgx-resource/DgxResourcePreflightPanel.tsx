import clsx from 'clsx';

import { buildDgxResourcePreflightItems, type DgxResourcePreflightStatus } from './dgxResourcePreflightModel';

import type { DgxResourceOverview } from '../../../api/dgx-resource.types';

type Props = {
  overview: DgxResourceOverview;
};

function statusTokens(status: DgxResourcePreflightStatus): string {
  switch (status) {
    case 'ok':
      return 'border-emerald-400/35 bg-emerald-500/10 text-emerald-100';
    case 'warn':
      return 'border-amber-400/40 bg-amber-500/10 text-amber-100';
    case 'bad':
      return 'border-red-400/40 bg-red-500/10 text-red-100';
    default:
      return 'border-white/12 bg-white/[0.04] text-white/75';
  }
}

function statusLabel(status: DgxResourcePreflightStatus): string {
  switch (status) {
    case 'ok':
      return 'OK';
    case 'warn':
      return '注意';
    case 'bad':
      return '要確認';
    default:
      return '未取得';
  }
}

export function DgxResourcePreflightPanel({ overview }: Props) {
  const items = buildDgxResourcePreflightItems(overview);

  return (
    <section className="rounded-md border border-white/10 bg-slate-950/45 p-3" aria-label="DGX 運用前チェック">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-white">運用前チェック</h2>
        <span className="text-xs text-white/45">温度・電力・クロック・メモリ・モデル・vLLM</span>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-6">
        {items.map((item) => (
          <div key={item.key} className={clsx('min-h-[5.25rem] rounded-md border px-3 py-2', statusTokens(item.status))}>
            <div className="flex items-start justify-between gap-2">
              <div className="text-xs font-medium text-white/55">{item.label}</div>
              <div className="shrink-0 rounded border border-white/15 bg-black/20 px-1.5 py-0.5 text-[0.68rem] font-semibold">
                {statusLabel(item.status)}
              </div>
            </div>
            <div className="mt-1 break-words text-base font-semibold leading-snug text-white">{item.value}</div>
            <div className="mt-1 line-clamp-2 text-xs text-white/50">{item.detail}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
