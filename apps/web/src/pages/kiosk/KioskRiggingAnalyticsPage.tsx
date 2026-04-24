import { KioskAnalyticsKpiStrip } from '../../components/kiosk/analytics/KioskAnalyticsKpiStrip';
import {
  AssetBorrowFrequencyPanel,
  EmployeeBarsPanel,
  ReturnRatePanel,
  TodayEventsPane
} from '../../components/kiosk/analytics/KioskAnalyticsPanels';
import { KioskAnalyticsPanelsGrid } from '../../components/kiosk/analytics/KioskAnalyticsPanelsGrid';
import { KioskAnalyticsPeriodFilterControls } from '../../components/kiosk/analytics/KioskAnalyticsPeriodFilterControls';
import { KioskAnalyticsShell } from '../../components/kiosk/analytics/KioskAnalyticsShell';

import { useKioskRiggingAnalyticsPageModel } from './useKioskRiggingAnalyticsPageModel';

export function KioskRiggingAnalyticsPage() {
  const m = useKioskRiggingAnalyticsPageModel();
  const t = m.theme;

  if (m.activeState.isPending) {
    return (
      <div className="flex flex-1 items-center justify-center text-lg" style={{ color: t.textMuted }} role="status">
        読み込み中…
      </div>
    );
  }

  if (m.activeState.isError || !m.view || !m.todayView) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <p className="text-lg" style={{ color: 'var(--color-primitive-red-200)' }}>
          データを取得できませんでした。
        </p>
        <p className="max-w-md text-sm" style={{ color: t.textSub }}>
          {m.activeState.error instanceof Error ? m.activeState.error.message : '不明なエラー'}
        </p>
        <button
          type="button"
          className="px-4 py-2 font-bold transition-opacity hover:opacity-90"
          style={{ borderRadius: t.radius6, backgroundColor: t.primaryUi, color: t.text, border: `1px solid ${t.borderSubtle}` }}
          onClick={() => void m.refetchAll()}
        >
          再試行
        </button>
      </div>
    );
  }

  const { view } = m;
  const periodRangeLabel = `${new Date(view.periodFrom).toLocaleDateString('ja-JP')} — ${new Date(view.periodTo).toLocaleDateString('ja-JP')}`;

  return (
    <div
      className="flex h-full min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-hidden"
      style={{ color: t.text, fontFamily: 'var(--font-family-sans)' }}
    >
      <KioskAnalyticsShell
        theme={t}
        periodRangeLabel={periodRangeLabel}
        periodFilterControls={
          <KioskAnalyticsPeriodFilterControls
            theme={t}
            targetPeriod={m.targetPeriod}
            monthPickerOpen={m.monthPickerOpen}
            onMonthPickerOpen={() => m.setMonthPickerOpen(true)}
            onMonthPickerCancel={() => m.setMonthPickerOpen(false)}
            onMonthPickerCommit={(next) => {
              m.setTargetPeriod(next);
              m.setMonthPickerOpen(false);
            }}
            datasetTab={m.datasetTab}
            rigging={{ value: m.selectedRiggingGearId, onChange: m.setSelectedRiggingGearId, options: m.riggingOptions }}
            items={{ value: m.selectedItemId, onChange: m.setSelectedItemId, options: m.itemOptions }}
            instruments={{
              value: m.selectedInstrumentId,
              onChange: m.setSelectedInstrumentId,
              options: m.instrumentOptions
            }}
          />
        }
        datasetTab={m.datasetTab}
        onDatasetTabChange={m.setDatasetTab}
        listModeToggle={{
          classNameForButton: m.listModeToggleButtonClass,
          onTop: () => m.setListMode('top'),
          onAll: () => m.setListMode('all'),
          isTop: m.listMode === 'top',
          isAll: m.listMode === 'all'
        }}
      />

      <KioskAnalyticsKpiStrip
        theme={t}
        openLoanCount={view.openLoanCount}
        overdueOpenCount={view.overdueOpenCount}
        totalMasterCount={view.totalMasterCount}
        periodBorrowCount={view.periodBorrowCount}
        periodReturnCount={view.periodReturnCount}
        returnCompletionPercent={m.returnCompletionPct}
      />

      <KioskAnalyticsPanelsGrid>
        <div className="min-h-0 min-w-0 overflow-hidden">
          <EmployeeBarsPanel rows={m.rankedEmployees} theme={t} rankBadge={m.employeeRankBadge} />
        </div>
        <div className="min-h-0 min-w-0 overflow-hidden">
          <AssetBorrowFrequencyPanel
            rows={m.rankedAssets}
            theme={t}
            title={`持出回数（${view.assetFilterLabel}）`}
            rankBadge={m.assetRankBadge}
            inventory={m.assetInventory}
          />
        </div>
        <div className="min-h-0 min-w-0 overflow-hidden">
          <ReturnRatePanel
            borrow={view.periodBorrowCount}
            ret={view.periodReturnCount}
            theme={t}
            title={`${view.assetFilterLabel}の事象比（持出/返却）`}
            footerNote={`未返却 ${view.openLoanCount} 件（うち期限超過 ${view.overdueOpenCount} 件）`}
          />
        </div>
        <div className="min-h-0 min-w-0 overflow-hidden">
          <TodayEventsPane
            rows={m.todayEventRows}
            theme={t}
            title="当日の持出返却状況"
            captionBadge={m.todayCaptionBadge}
            todaySummary={{
              borrowCount: m.todayKinds.borrowCount,
              returnCount: m.todayKinds.returnCount,
              returnCompletionPercent: m.todayReturnCompletion
            }}
          />
        </div>
      </KioskAnalyticsPanelsGrid>
    </div>
  );
}
