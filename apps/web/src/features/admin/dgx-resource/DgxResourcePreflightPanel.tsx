import clsx from 'clsx';

import { buildDgxResourcePreflightItems, type DgxResourcePreflightStatus } from './dgxResourcePreflightModel';

import type { DgxResourceOverview } from '../../../api/dgx-resource.types';

type Props = {
  overview: DgxResourceOverview;
};

function statusTokens(status: DgxResourcePreflightStatus): string {
  switch (status) {
    case 'ok':
      return 'border-emerald-400/30 bg-emerald-500/15 text-emerald-300';
    case 'warn':
      return 'border-amber-400/30 bg-amber-500/15 text-amber-300';
    case 'bad':
      return 'border-red-400/30 bg-red-500/15 text-red-300';
    default:
      return 'border-white/20 bg-white/5 text-white/70';
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
    <section className="rounded-md border border-white/15 bg-slate-900/60 p-3" aria-label="DGX 運用前チェック">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-white">運用前チェック</h2>
        <span className="text-xs text-white/60">温度・電力・クロック・メモリ・モデル・vLLM</span>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-6">
        {items.map((item) => (
          <div key={item.key} className={clsx('min-h-[5.25rem] rounded-md border px-3 py-2', statusTokens(item.status))}>
            <div className="flex items-start justify-between gap-2">
              <div className="text-xs font-medium text-current opacity-70">{item.label}</div>
              <div className="shrink-0 rounded border border-current/20 bg-white/10 px-1.5 py-0.5 text-xs font-semibold">
                {statusLabel(item.status)}
              </div>
            </div>
            <div className="mt-1 break-words text-base font-semibold leading-snug text-current">{item.value}</div>
            <div className="mt-1 line-clamp-2 text-xs text-current opacity-70">{item.detail}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
