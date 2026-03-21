import { useMemo } from 'react';

import { useKioskProductionScheduleProgressOverview } from '../../api/hooks';
import { ProgressOverviewSeibanCard } from '../../components/kiosk/progressOverview/ProgressOverviewSeibanCard';
import { ProgressOverviewSeibanFilterDropdown } from '../../components/kiosk/ProgressOverviewSeibanFilterDropdown';
import {
  formatProgressOverviewUpdatedAt,
  PROGRESS_OVERVIEW_CARD_GRID_CLASS
} from '../../features/kiosk/productionSchedule/progressOverviewPresentation';
import { useProgressOverviewSeibanFilter } from '../../features/kiosk/productionSchedule/useProgressOverviewSeibanFilter';

export function ProductionScheduleProgressOverviewPage() {
  const overviewQuery = useKioskProductionScheduleProgressOverview();
  const overview = overviewQuery.data;
  const scheduledItems = useMemo(() => overview?.scheduled ?? [], [overview?.scheduled]);
  const hasScheduledItems = scheduledItems.length > 0;
  const updatedAtLabel = useMemo(
    () => formatProgressOverviewUpdatedAt(overview?.updatedAt ?? null),
    [overview?.updatedAt]
  );
  const filterCandidates = useMemo(
    () =>
      scheduledItems.map((item) => ({
        fseiban: item.fseiban,
        machineName: item.machineName
      })),
    [scheduledItems]
  );
  const { items, selectedSet, selectedCount, totalCount, isAllOff, toggle, setAll } =
    useProgressOverviewSeibanFilter(filterCandidates);
  const visibleScheduledItems = useMemo(
    () => scheduledItems.filter((item) => selectedSet.has(item.fseiban)),
    [scheduledItems, selectedSet]
  );
  const hasVisibleScheduledItems = visibleScheduledItems.length > 0;

  return (
    <div className="flex h-full flex-col gap-2">
      <section className="rounded-lg border border-white/20 bg-slate-900/60 p-2">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/15 pb-1">
          <div className="flex min-w-0 items-center gap-3">
            <h2 className="whitespace-nowrap text-sm font-semibold text-white">進捗一覧</h2>
            <p className="truncate text-[11px] text-white/70">最終更新: {updatedAtLabel}</p>
          </div>
          <div className="flex items-center gap-2">
            <ProgressOverviewSeibanFilterDropdown
              items={items}
              selectedCount={selectedCount}
              totalCount={totalCount}
              onToggle={toggle}
              onSetAll={setAll}
            />
            <button
              type="button"
              className="rounded bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-60"
              onClick={() => void overviewQuery.refetch()}
              disabled={overviewQuery.isFetching}
            >
              {overviewQuery.isFetching ? '更新中...' : '手動更新'}
            </button>
          </div>
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
        {!overviewQuery.isLoading && !overviewQuery.isError && hasScheduledItems && isAllOff ? (
          <p className="text-sm text-white/80">フィルタで非表示にしています。製番フィルタで表示対象をONにしてください。</p>
        ) : null}

        {!overviewQuery.isLoading && !overviewQuery.isError && hasVisibleScheduledItems ? (
          <div className={PROGRESS_OVERVIEW_CARD_GRID_CLASS}>
            {visibleScheduledItems.map((item) => (
              <ProgressOverviewSeibanCard key={item.fseiban} item={item} />
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}
