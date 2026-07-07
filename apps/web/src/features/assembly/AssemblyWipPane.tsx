import { Link } from 'react-router-dom';

import { Button } from '../../components/ui/Button';

import { kioskAssemblyWorkSessionPath } from './assemblyRoutes';
import { formatAssemblyTimestamp } from './assemblyUiHelpers';

import type { AssemblyWorkSessionSummaryDto } from './types';

type Props = {
  sessions: AssemblyWorkSessionSummaryDto[];
  loading: boolean;
  onReload: () => void;
};

function progressText(session: AssemblyWorkSessionSummaryDto): string {
  if (session.totalBoltCount <= 0) return '0/0';
  return `${session.acceptedBoltCount}/${session.totalBoltCount}`;
}

function progressPercent(session: AssemblyWorkSessionSummaryDto): number {
  if (session.totalBoltCount <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((session.acceptedBoltCount / session.totalBoltCount) * 100)));
}

function areaStatusText(session: AssemblyWorkSessionSummaryDto): string {
  const areaName = session.currentAreaName ?? 'エリア完了';
  const position = session.currentBoltMarkerNo
    ? `締付位置 #${session.currentBoltMarkerNo}`
    : '次工程待ち';
  return `${areaName} ・ ${position}`;
}

export function AssemblyWipPane({ sessions, loading, onReload }: Props) {
  return (
    <section
      aria-labelledby="assembly-wip-pane-heading"
      className="flex min-h-[12rem] min-w-0 flex-1 flex-col overflow-hidden rounded border border-white/15 bg-slate-950/45 xl:min-h-0"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 p-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-2">
            <h2 id="assembly-wip-pane-heading" className="text-[1.22rem] font-bold leading-tight text-white">
              仕掛中
            </h2>
            <span className="text-base font-bold text-emerald-200">{sessions.length}件</span>
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
          <p className="w-full rounded border border-white/10 bg-slate-900/65 px-3 py-8 text-center text-sm font-semibold text-white/55">
            {loading ? '仕掛中を読込中…' : '仕掛中なし'}
          </p>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 content-start grid-cols-1 gap-2 overflow-y-auto p-2 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {sessions.map((session) => (
            <Link
              key={session.id}
              to={kioskAssemblyWorkSessionPath(session.id)}
              className="flex min-h-11 min-w-0 flex-col gap-1 rounded border border-white/10 bg-slate-900/55 px-2.5 py-2 text-white hover:border-emerald-300/40 hover:bg-slate-800"
            >
              <div className="flex min-w-0 items-start justify-between gap-2">
                <span className="min-w-0">
                  <span className="block truncate text-[1.22rem] font-bold leading-tight">{session.productNo}</span>
                  <span className="mt-0.5 block truncate text-xs font-semibold text-white/55">
                    {formatAssemblyTimestamp(session.updatedAt)}
                  </span>
                </span>
                <span className="flex min-h-11 shrink-0 items-center justify-center rounded border border-emerald-300/35 bg-emerald-500/25 px-3 text-sm font-bold text-emerald-50">
                  再開
                </span>
              </div>
              <span className="min-w-0">
                <span className="block truncate text-sm font-bold text-white/90">{session.targetUnit}</span>
                <span className="mt-0.5 block truncate text-xs font-semibold text-white/60">
                  {session.serialNo} / {session.operatorNameSnapshot}
                </span>
              </span>
              <span className="block truncate text-xs font-bold text-white/85">{areaStatusText(session)}</span>
              <span className="grid gap-1">
                <span className="text-right text-sm font-bold text-cyan-200">{progressText(session)}</span>
                <span className="h-2 overflow-hidden rounded-full bg-white/10">
                  <span
                    className="block h-full rounded-full bg-gradient-to-r from-emerald-300 to-cyan-300"
                    style={{ width: `${progressPercent(session)}%` }}
                  />
                </span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
