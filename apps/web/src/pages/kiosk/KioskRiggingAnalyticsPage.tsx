import { KioskAnalyticsKpiStrip } from '../../components/kiosk/analytics/KioskAnalyticsKpiStrip';
import {
  AssetBorrowFrequencyPanel,
  EmployeeBarsPanel,
  OpenLoansPanel,
  TodayEventsPane
} from '../../components/kiosk/analytics/KioskAnalyticsPanels';
import { KioskAnalyticsPanelsGrid } from '../../components/kiosk/analytics/KioskAnalyticsPanelsGrid';
import { KioskAnalyticsPeriodFilterControls } from '../../components/kiosk/analytics/KioskAnalyticsPeriodFilterControls';
import { KioskAnalyticsShell } from '../../components/kiosk/analytics/KioskAnalyticsShell';
import { kioskAnalyticsThemeStyle } from '../../components/kiosk/analytics/kioskAnalyticsTheme';
import '../../components/kiosk/analytics/kioskAnalytics.css';

import { useKioskRiggingAnalyticsPageModel } from './useKioskRiggingAnalyticsPageModel';

export function KioskRiggingAnalyticsPage() {
  const m = useKioskRiggingAnalyticsPageModel();
  const t = m.theme;

  if (m.activeState.isPending) {
    return (
      <div className="flex flex-1 items-center justify-center text-lg" style={{ color: t.muted }} role="status">
        読み込み中…
      </div>
    );
  }

  if (m.activeState.isError || !m.view || !m.todayView) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <p className="text-lg" style={{ color: t.alert }}>データを取得できませんでした。</p>
        <p className="max-w-md text-base" style={{ color: t.muted }}>
          {m.activeState.error instanceof Error ? m.activeState.error.message : '不明なエラー'}
        </p>
        <button type="button" className="px-4 py-2 text-base font-bold" style={{ borderRadius: t.pillRadius, backgroundColor: t.surface, color: t.text, border: `1px solid ${t.line}` }} onClick={() => void m.refetchAll()}>
          再試行
        </button>
      </div>
    );
  }

  const { view } = m;
  return (
    <div className="kanalytics flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden" style={kioskAnalyticsThemeStyle}>
      <KioskAnalyticsShell
        periodFilterControls={
          <KioskAnalyticsPeriodFilterControls
            targetPeriod={m.targetPeriod}
            isLatest={m.isLatest}
            onShiftPeriod={m.onShiftPeriod}
            monthPickerOpen={m.monthPickerOpen}
            onMonthPickerOpen={() => m.setMonthPickerOpen(true)}
            onMonthPickerCancel={() => m.setMonthPickerOpen(false)}
            onMonthPickerCommit={(next) => { m.setTargetPeriod(next); m.setMonthPickerOpen(false); }}
            datasetTab={m.datasetTab}
            rigging={{ value: m.selectedRiggingGearId, onChange: m.setSelectedRiggingGearId, options: m.riggingOptions }}
            items={{ value: m.selectedItemId, onChange: m.setSelectedItemId, options: m.itemOptions }}
            instruments={{ value: m.selectedInstrumentId, onChange: m.setSelectedInstrumentId, options: m.instrumentOptions }}
          />
        }
        datasetTab={m.datasetTab}
        onDatasetTabChange={m.setDatasetTab}
        listMode={m.listMode}
        onListModeChange={m.setListMode}
      />
      <KioskAnalyticsKpiStrip
        view={view}
        periodLabel={m.periodLabel}
        availableCount={m.availableCount}
        longestOverdue={m.longestOverdue}
        borrowChangePercent={m.borrowChangePercent}
        returnCompletionPercent={m.returnCompletionPct}
      />
      <KioskAnalyticsPanelsGrid>
        <OpenLoansPanel rows={m.openLoans} openCount={view.openLoanCount} overdueCount={view.overdueOpenCount} remainingCount={m.openLoansRemaining} mode={m.listMode} />
        <EmployeeBarsPanel rows={m.rankedEmployees} mode={m.listMode} totalCount={view.employees.length} />
        <AssetBorrowFrequencyPanel rows={m.rankedAssets} title={`${view.datasetLabel}別`} mode={m.listMode} totalCount={view.assets.length} />
        <TodayEventsPane rows={m.todayEventRows} mode={m.listMode} borrowCount={m.todayKinds.borrowCount} returnCount={m.todayKinds.returnCount} totalCount={m.todayView.periodEvents.length} />
      </KioskAnalyticsPanelsGrid>
    </div>
  );
}
