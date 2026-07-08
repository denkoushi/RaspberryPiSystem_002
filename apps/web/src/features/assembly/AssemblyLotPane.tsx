import { Link } from 'react-router-dom';

import { Button } from '../../components/ui/Button';

import { kioskAssemblyRecordApprovalPath, kioskAssemblyWorkSessionPath } from './assemblyRoutes';
import { formatAssemblyTimestamp } from './assemblyUiHelpers';

import type { AssemblyLotSerialDto, AssemblyLotSummaryDto } from './types';

type Props = {
  lots: AssemblyLotSummaryDto[];
  loading: boolean;
  busySerialId: string | null;
  onReload: () => void;
  onStartSerial: (lotId: string, lotSerialId: string) => void;
};

function serialStatusLabel(serial: AssemblyLotSerialDto): string {
  if (serial.status === 'not_started') return '未着手';
  if (serial.status === 'in_progress') return '仕掛';
  if (serial.status === 'completed') return serial.approval ? '承認済み' : '完了';
  return '取消';
}

function serialStatusClassName(serial: AssemblyLotSerialDto): string {
  if (serial.status === 'not_started') return 'border-white/15 bg-slate-950/55 text-white';
  if (serial.status === 'in_progress') return 'border-emerald-300/35 bg-emerald-500/15 text-emerald-50';
  if (serial.status === 'completed' && serial.approval) return 'border-cyan-300/35 bg-cyan-500/15 text-cyan-50';
  if (serial.status === 'completed') return 'border-amber-300/35 bg-amber-500/15 text-amber-50';
  return 'border-rose-300/30 bg-rose-500/15 text-rose-50';
}

function lotProgressText(lot: AssemblyLotSummaryDto): string {
  return `作業 ${lot.completedCount}/${lot.expectedQuantity} ・ 承認 ${lot.approvedCount}/${lot.expectedQuantity}`;
}

export function AssemblyLotPane({ lots, loading, busySerialId, onReload, onStartSerial }: Props) {
  return (
    <section
      aria-labelledby="assembly-lot-pane-heading"
      className="flex min-h-[15rem] min-w-0 flex-1 flex-col overflow-hidden rounded border border-white/15 bg-slate-950/45 xl:min-h-0"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 p-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-2">
            <h2 id="assembly-lot-pane-heading" className="text-[1.22rem] font-bold leading-tight text-white">
              登録済みロット
            </h2>
            <span className="text-base font-bold text-cyan-200">{lots.length}件</span>
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

      {lots.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-3">
          <p className="w-full rounded border border-white/10 bg-slate-900/65 px-3 py-8 text-center text-sm font-semibold text-white/55">
            {loading ? 'ロットを読込中…' : '登録済みロットなし'}
          </p>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 content-start grid-cols-1 gap-2 overflow-y-auto p-2 2xl:grid-cols-2">
          {lots.map((lot) => (
            <article key={lot.id} className="grid min-w-0 gap-2 rounded border border-white/10 bg-slate-900/55 p-2 text-white">
              <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-[1.14rem] font-bold leading-tight">{lot.productNo}</p>
                  <p className="mt-0.5 truncate text-xs font-semibold text-white/60">
                    {lot.targetUnit} / {lot.operatorNameSnapshot}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-bold tabular-nums text-cyan-200">{lotProgressText(lot)}</p>
                  <p className="text-[11px] font-semibold text-white/45">{formatAssemblyTimestamp(lot.updatedAt)}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-2">
                {lot.serials.map((serial) => {
                  const label = serialStatusLabel(serial);
                  const statusClassName = serialStatusClassName(serial);
                  return (
                    <div key={serial.id} className={`grid min-h-16 min-w-0 gap-1 rounded border px-2 py-1.5 ${statusClassName}`}>
                      <div className="flex min-w-0 items-center justify-between gap-2">
                        <span className="truncate text-sm font-bold tabular-nums">{serial.serialNo}</span>
                        <span className="shrink-0 text-[11px] font-bold">{label}</span>
                      </div>
                      {serial.status === 'not_started' ? (
                        <Button
                          type="button"
                          variant="primary"
                          className="min-h-8 !px-2 !py-0 text-xs"
                          disabled={busySerialId === serial.id}
                          onClick={() => onStartSerial(lot.id, serial.id)}
                        >
                          {busySerialId === serial.id ? '開始中…' : '開始'}
                        </Button>
                      ) : serial.workSessionId && serial.status === 'in_progress' ? (
                        <Link
                          to={kioskAssemblyWorkSessionPath(serial.workSessionId)}
                          className="inline-flex min-h-8 items-center justify-center rounded border border-emerald-200/40 bg-emerald-900/25 px-2 text-xs font-bold text-emerald-50 hover:bg-emerald-800/45"
                        >
                          再開
                        </Link>
                      ) : serial.workSessionId && serial.status === 'completed' ? (
                        <Link
                          to={kioskAssemblyRecordApprovalPath({ sessionId: serial.workSessionId })}
                          className="inline-flex min-h-8 items-center justify-center rounded border border-cyan-200/40 bg-cyan-900/25 px-2 text-xs font-bold text-cyan-50 hover:bg-cyan-800/45"
                        >
                          記録確認
                        </Link>
                      ) : (
                        <span className="inline-flex min-h-8 items-center justify-center rounded border border-white/10 px-2 text-xs font-bold text-white/55">
                          開始不可
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
