import { buildDgxResourceRuntimeSummaryItems } from './dgxResourceRuntimeSummaryModel';

import type { DgxResourceRuntimeSummaryApi } from '../../../api/dgx-resource.types';

type Props = {
  runtimeSummary: DgxResourceRuntimeSummaryApi;
};

/** 実行時状態（モデル・backend・Ready・Policy）の補足ストリップ */
export function DgxResourceRuntimeSummaryStrip({ runtimeSummary }: Props) {
  const items = buildDgxResourceRuntimeSummaryItems(runtimeSummary);

  return (
    <section
      className="flex flex-nowrap gap-3 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch]"
      aria-label="DGX 実行時状態"
    >
      {items.map((it) => (
        <div
          key={it.key}
          className="min-w-[12rem] shrink-0 rounded-md border border-white/10 bg-slate-900/40 px-4 py-3 lg:min-w-0 lg:flex-1 lg:basis-0"
        >
          <div className="text-xs font-medium uppercase text-white/50">{it.label}</div>
          <div className={`mt-1 break-words text-lg font-semibold leading-snug ${it.toneClass}`}>{it.value}</div>
          {it.hint ? <p className="mt-1 line-clamp-2 text-xs text-white/45">{it.hint}</p> : null}
        </div>
      ))}
    </section>
  );
}
