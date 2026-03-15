import { useMemo } from 'react';

import { useKioskProductionScheduleProgressOverview } from '../../api/hooks';
import { formatDueDate } from '../../features/kiosk/productionSchedule/formatDueDate';
import { normalizeMachineName } from '../../features/kiosk/productionSchedule/machineName';

const formatUpdatedAt = (value: string | null): string => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('ja-JP');
};

const isOverdueDueDate = (value: string | null): boolean => {
  if (!value) return false;
  const dueDate = new Date(value);
  if (Number.isNaN(dueDate.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return dueDate.getTime() < today.getTime();
};

const getResourceTooltip = (resourceNames?: string[]): string | undefined =>
  resourceNames && resourceNames.length > 0 ? resourceNames.join('\n') : undefined;

const getResourceAriaLabel = (resourceCd: string, resourceNames?: string[]): string =>
  resourceNames && resourceNames.length > 0 ? `${resourceCd}: ${resourceNames.join(' / ')}` : resourceCd;

export function ProductionScheduleProgressOverviewPage() {
  const overviewQuery = useKioskProductionScheduleProgressOverview();
  const overview = overviewQuery.data;
  const hasScheduledItems = (overview?.scheduled.length ?? 0) > 0;
  const updatedAtLabel = useMemo(() => formatUpdatedAt(overview?.updatedAt ?? null), [overview?.updatedAt]);

  return (
    <div className="flex h-full flex-col gap-2">
      <section className="rounded-lg border border-white/20 bg-slate-900/60 p-2">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/15 pb-1">
          <div className="flex min-w-0 items-center gap-3">
            <h2 className="whitespace-nowrap text-sm font-semibold text-white">進捗一覧</h2>
            <p className="truncate text-[11px] text-white/70">最終更新: {updatedAtLabel}</p>
          </div>
          <button
            type="button"
            className="rounded bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-60"
            onClick={() => void overviewQuery.refetch()}
            disabled={overviewQuery.isFetching}
          >
            {overviewQuery.isFetching ? '更新中...' : '手動更新'}
          </button>
        </div>
      </section>

      <section className="flex-1 overflow-auto rounded-lg border border-white/20 bg-slate-900/60 p-2">
        {overviewQuery.isLoading ? <p className="text-sm text-white/80">読み込み中...</p> : null}
        {overviewQuery.isError ? <p className="text-sm text-rose-300">進捗一覧の取得に失敗しました。</p> : null}
        {!overviewQuery.isLoading && !overviewQuery.isError && !hasScheduledItems ? (
          <p className="text-sm text-white/80">
            登録製番がありません。生産スケジュール画面で製番を登録してください。
          </p>
        ) : null}

        {!overviewQuery.isLoading && !overviewQuery.isError && hasScheduledItems ? (
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-2 xl:grid-cols-4">
            {(overview?.scheduled ?? []).map((item) => (
              <article key={item.fseiban} className="rounded border border-white/20 bg-slate-800/60 p-2">
                <header className="mb-1 flex flex-wrap items-center gap-2 border-b border-white/15 pb-1">
                  <span className="font-mono text-sm text-white">{item.fseiban}</span>
                  <span className="text-[11px] text-white/70">{normalizeMachineName(item.machineName) || '-'}</span>
                </header>
                <table className="w-full border-collapse text-left text-xs text-white">
                  <tbody>
                    {item.parts.map((part) => (
                      <tr key={`${item.fseiban}-${part.fhincd}-${part.productNo}`} className="border-b border-white/10">
                        <td className="px-1 py-1">{part.fhinmei || '-'}</td>
                        <td className="w-[84px] whitespace-nowrap px-1 py-1 pr-0.5">
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] font-semibold text-amber-300">納期</span>
                            <span className={isOverdueDueDate(part.dueDate) ? 'font-semibold text-rose-300' : 'text-white'}>
                              {formatDueDate(part.dueDate)}
                            </span>
                          </div>
                        </td>
                        <td className="px-0.5 py-1">
                          <div className="flex items-start gap-1">
                            <span className="pt-0.5 text-[10px] font-semibold text-amber-300">実</span>
                            <div className="flex flex-wrap gap-1">
                              {part.processes.map((process) => (
                                <span
                                  key={process.rowId}
                                  className={`rounded border px-1.5 py-0.5 text-[10px] ${
                                    process.isCompleted
                                      ? 'border-slate-400 bg-white/10 text-white/70 opacity-50 grayscale'
                                      : 'border-blue-300 bg-blue-500/30 text-blue-100'
                                  }`}
                                  title={getResourceTooltip(process.resourceNames)}
                                  aria-label={getResourceAriaLabel(process.resourceCd, process.resourceNames)}
                                >
                                  {process.resourceCd}
                                </span>
                              ))}
                            </div>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </article>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}
