import { Button } from '../../components/ui/Button';

import { formatAssemblyTimestamp } from './assemblyUiHelpers';

import type { AssemblyWorkSessionSummaryDto } from './types';

type Props = {
  sessions: AssemblyWorkSessionSummaryDto[];
  loading: boolean;
  onReload: () => void;
  lotQtyByProductNo: Record<string, number>;
};

function formatLotQty(productNo: string, lotQtyByProductNo: Record<string, number>): string {
  const lotQty = lotQtyByProductNo[productNo];
  if (lotQty == null || !Number.isFinite(lotQty)) return '-';
  return Number.isInteger(lotQty) ? String(lotQty) : lotQty.toLocaleString('ja-JP');
}

export function AssemblyCompletedPane({ sessions, loading, onReload, lotQtyByProductNo }: Props) {
  return (
    <section
      aria-labelledby="assembly-completed-pane-heading"
      className="flex min-h-[12rem] min-w-0 flex-1 flex-col overflow-hidden rounded border border-white/15 bg-slate-950/45"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 p-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-2">
            <h2 id="assembly-completed-pane-heading" className="text-[1.22rem] font-bold leading-tight text-white">
              完了した製品
            </h2>
            <span className="text-base font-bold text-cyan-200">{sessions.length}件</span>
          </div>
        </div>
        <Button
          type="button"
          variant="ghostOnDark"
          className="min-h-10 shrink-0 !px-3 !py-0 text-sm"
          disabled={loading}
          onClick={onReload}
        >
          {loading ? '更新中…' : '再読込'}
        </Button>
      </div>

      {sessions.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-3">
          <p className="w-full rounded border border-white/10 bg-slate-900/65 px-3 py-6 text-center text-sm font-semibold text-white/55">
            {loading ? '完了した製品を読込中…' : '完了した製品なし'}
          </p>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 content-start gap-2 overflow-y-auto p-2">
          {sessions.map((session) => (
            <div
              key={session.id}
              className="grid min-h-[4.2rem] gap-2 rounded border border-white/10 bg-slate-900/55 px-3 py-2 text-white md:grid-cols-[9rem_minmax(0,1fr)_minmax(8rem,0.75fr)_5rem_5rem] md:items-center"
            >
              <span className="min-w-0">
                <span className="block truncate text-[1.08rem] font-bold leading-tight">{session.productNo}</span>
                <span className="mt-1 block truncate text-xs font-semibold text-white/55">
                  {formatAssemblyTimestamp(session.completedAt ?? session.updatedAt)}
                </span>
              </span>
              <span className="min-w-0">
                <span className="block truncate text-base font-bold text-white/90">{session.targetUnit}</span>
                <span className="mt-1 block truncate text-xs font-semibold text-white/60">{session.serialNo}</span>
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-bold text-white/85">{session.operatorNameSnapshot}</span>
                <span className="mt-1 block truncate text-xs font-semibold text-white/55">作業者</span>
              </span>
              <span className="text-right">
                <span className="block text-xs font-semibold text-white/55">ロット数</span>
                <span className="block text-base font-bold tabular-nums text-cyan-200">
                  {formatLotQty(session.productNo, lotQtyByProductNo)}
                </span>
              </span>
              <span className="flex min-h-9 items-center justify-center rounded border border-cyan-300/30 bg-cyan-500/15 px-2 text-xs font-bold text-cyan-100">
                完了
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
