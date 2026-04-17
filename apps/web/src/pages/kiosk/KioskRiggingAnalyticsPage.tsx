import { useEffect, useMemo, useState } from 'react';

import { KioskAnalyticsKpiStrip } from '../../components/kiosk/analytics/KioskAnalyticsKpiStrip';
import {
  AssetBorrowFrequencyPanel,
  EmployeeBarsPanel,
  ReturnRatePanel,
  TodayEventsPane
} from '../../components/kiosk/analytics/KioskAnalyticsPanels';
import { KioskMonthPickerModal } from '../../components/kiosk/KioskMonthPickerModal';
import { useItemLoanAnalytics } from '../../features/item-analytics/useItemLoanAnalytics';
import {
  ANALYTICS_KIOSK_DISPLAY_LIMITS,
  countPeriodEventKinds,
  periodReturnCompletionRatePercent,
  summarizeAssetInventory,
  takeTodayEventsForDisplay,
  topRankedAssetsByBorrow,
  topRankedEmployees
} from '../../features/kiosk-loan-analytics/analyticsDisplayPolicy';
import { formatPeriodLabelJa, periodRangeToIso, toDayInputValue, toMonthInputValue } from '../../features/kiosk-loan-analytics/period';
import { type DatasetTab, mapResponseToViewModel } from '../../features/kiosk-loan-analytics/view-model';
import { useMeasuringInstrumentLoanAnalytics } from '../../features/measuring-instrument-analytics/useMeasuringInstrumentLoanAnalytics';
import { useRiggingLoanAnalytics } from '../../features/rigging-analytics/useRiggingLoanAnalytics';

const DADS = {
  chartBorrow: 'var(--color-primitive-blue-500)',
  chartReturn: 'var(--color-primitive-cyan-600)',
  strokeBar: 'var(--color-neutral-solid-gray-900)',
  surface: 'var(--color-neutral-solid-gray-800)',
  border: 'var(--color-neutral-solid-gray-600)',
  borderSubtle: 'var(--color-neutral-solid-gray-700)',
  text: 'var(--color-neutral-white)',
  textMuted: 'var(--color-neutral-solid-gray-300)',
  textSub: 'var(--color-neutral-solid-gray-400)',
  primaryUi: 'var(--color-primitive-blue-900)',
  tabInactive: 'var(--color-neutral-solid-gray-700)',
  error: 'var(--color-semantic-error-1)',
  radius8: 'var(--border-radius-8)',
  radius6: 'var(--border-radius-6)'
} as const;

type AssetOption = { value: string; label: string };

function isNotFoundQueryError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const response = (error as { response?: { status?: number } }).response;
  return response?.status === 404;
}

export function KioskRiggingAnalyticsPage() {
  const [targetPeriod, setTargetPeriod] = useState(() => toMonthInputValue());
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);
  const period = useMemo(() => periodRangeToIso(targetPeriod), [targetPeriod]);
  const todayPeriod = useMemo(() => periodRangeToIso(toDayInputValue()), []);
  const baseQueryParams = useMemo(
    () =>
      period
        ? {
            periodFrom: period.periodFrom,
            periodTo: period.periodTo,
            monthlyMonths: 6,
            timeZone: 'Asia/Tokyo' as const
          }
        : undefined,
    [period]
  );
  const todayBaseQueryParams = useMemo(
    () =>
      todayPeriod
        ? {
            periodFrom: todayPeriod.periodFrom,
            periodTo: todayPeriod.periodTo,
            monthlyMonths: 1,
            timeZone: 'Asia/Tokyo' as const
          }
        : undefined,
    [todayPeriod]
  );

  const [selectedRiggingGearId, setSelectedRiggingGearId] = useState('');
  const [selectedItemId, setSelectedItemId] = useState('');
  const [selectedInstrumentId, setSelectedInstrumentId] = useState('');
  const [riggingOptions, setRiggingOptions] = useState<AssetOption[]>([]);
  const [itemOptions, setItemOptions] = useState<AssetOption[]>([]);
  const [instrumentOptions, setInstrumentOptions] = useState<AssetOption[]>([]);
  const [datasetTab, setDatasetTab] = useState<DatasetTab>('rigging');

  const riggingParams = useMemo(
    () => (baseQueryParams ? { ...baseQueryParams, ...(selectedRiggingGearId ? { riggingGearId: selectedRiggingGearId } : {}) } : undefined),
    [baseQueryParams, selectedRiggingGearId]
  );
  const itemParams = useMemo(
    () => (baseQueryParams ? { ...baseQueryParams, ...(selectedItemId ? { itemId: selectedItemId } : {}) } : undefined),
    [baseQueryParams, selectedItemId]
  );
  const instrumentParams = useMemo(
    () =>
      baseQueryParams
        ? { ...baseQueryParams, ...(selectedInstrumentId ? { measuringInstrumentId: selectedInstrumentId } : {}) }
        : undefined,
    [baseQueryParams, selectedInstrumentId]
  );

  const riggingQ = useRiggingLoanAnalytics(riggingParams);
  const itemQ = useItemLoanAnalytics(itemParams);
  const instrumentQ = useMeasuringInstrumentLoanAnalytics(instrumentParams);
  const riggingTodayQ = useRiggingLoanAnalytics(
    todayBaseQueryParams
      ? { ...todayBaseQueryParams, ...(selectedRiggingGearId ? { riggingGearId: selectedRiggingGearId } : {}) }
      : undefined
  );
  const itemTodayQ = useItemLoanAnalytics(
    todayBaseQueryParams
      ? { ...todayBaseQueryParams, ...(selectedItemId ? { itemId: selectedItemId } : {}) }
      : undefined
  );
  const instrumentTodayQ = useMeasuringInstrumentLoanAnalytics(
    todayBaseQueryParams
      ? { ...todayBaseQueryParams, ...(selectedInstrumentId ? { measuringInstrumentId: selectedInstrumentId } : {}) }
      : undefined
  );

  useEffect(() => {
    if (!selectedRiggingGearId) {
      setRiggingOptions((riggingQ.data?.byGear ?? []).map((g) => ({ value: g.gearId, label: `${g.managementNumber} ${g.name}` })));
    }
  }, [riggingQ.data, selectedRiggingGearId]);
  useEffect(() => {
    if (!selectedItemId) {
      setItemOptions((itemQ.data?.byItem ?? []).map((it) => ({ value: it.itemId, label: it.name || it.itemCode || it.itemId })));
    }
  }, [itemQ.data, selectedItemId]);
  useEffect(() => {
    if (!selectedInstrumentId) {
      setInstrumentOptions(
        (instrumentQ.data?.byInstrument ?? []).map((row) => ({ value: row.instrumentId, label: `${row.managementNumber} ${row.name}` }))
      );
    }
  }, [instrumentQ.data, selectedInstrumentId]);

  useEffect(() => {
    setSelectedRiggingGearId('');
    setSelectedItemId('');
    setSelectedInstrumentId('');
    setRiggingOptions([]);
    setItemOptions([]);
    setInstrumentOptions([]);
  }, [targetPeriod]);

  useEffect(() => {
    if (selectedRiggingGearId && riggingQ.isError && isNotFoundQueryError(riggingQ.error)) setSelectedRiggingGearId('');
  }, [selectedRiggingGearId, riggingQ.isError, riggingQ.error]);
  useEffect(() => {
    if (selectedItemId && itemQ.isError && isNotFoundQueryError(itemQ.error)) setSelectedItemId('');
  }, [selectedItemId, itemQ.isError, itemQ.error]);
  useEffect(() => {
    if (selectedInstrumentId && instrumentQ.isError && isNotFoundQueryError(instrumentQ.error)) setSelectedInstrumentId('');
  }, [selectedInstrumentId, instrumentQ.isError, instrumentQ.error]);

  const activeState = datasetTab === 'rigging' ? riggingQ : datasetTab === 'items' ? itemQ : instrumentQ;
  const raw = datasetTab === 'rigging' ? riggingQ.data : datasetTab === 'items' ? itemQ.data : instrumentQ.data;
  const todayRaw = datasetTab === 'rigging' ? riggingTodayQ.data : datasetTab === 'items' ? itemTodayQ.data : instrumentTodayQ.data;
  const view = useMemo(() => (raw ? mapResponseToViewModel(datasetTab, raw) : null), [datasetTab, raw]);
  const todayView = useMemo(() => (todayRaw ? mapResponseToViewModel(datasetTab, todayRaw) : null), [datasetTab, todayRaw]);

  const rankedEmployees = useMemo(
    () => topRankedEmployees(view?.employees ?? [], ANALYTICS_KIOSK_DISPLAY_LIMITS.topRankedEmployees),
    [view]
  );
  const rankedAssets = useMemo(
    () => topRankedAssetsByBorrow(view?.assets ?? [], ANALYTICS_KIOSK_DISPLAY_LIMITS.topRankedAssets),
    [view]
  );
  const assetInventory = useMemo(() => (view?.assets.length ? summarizeAssetInventory(view.assets) : null), [view]);
  const returnCompletionPct = useMemo(
    () => (view ? periodReturnCompletionRatePercent(view.periodBorrowCount, view.periodReturnCount) : null),
    [view]
  );

  const todayEventRows = useMemo(
    () => takeTodayEventsForDisplay(todayView?.periodEvents ?? [], ANALYTICS_KIOSK_DISPLAY_LIMITS.todayEventsMax),
    [todayView]
  );
  const todayKinds = useMemo(() => countPeriodEventKinds(todayView?.periodEvents ?? []), [todayView]);
  const todayReturnCompletion = useMemo(
    () => periodReturnCompletionRatePercent(todayKinds.borrowCount, todayKinds.returnCount),
    [todayKinds]
  );

  const refetchAll = () => {
    void riggingQ.refetch();
    void itemQ.refetch();
    void instrumentQ.refetch();
    void riggingTodayQ.refetch();
    void itemTodayQ.refetch();
    void instrumentTodayQ.refetch();
  };

  if (activeState.isPending) {
    return (
      <div className="flex flex-1 items-center justify-center text-lg" style={{ color: DADS.textMuted }} role="status">
        読み込み中…
      </div>
    );
  }

  if (activeState.isError || !view || !todayView) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <p className="text-lg" style={{ color: 'var(--color-primitive-red-200)' }}>
          データを取得できませんでした。
        </p>
        <p className="max-w-md text-sm" style={{ color: DADS.textSub }}>
          {activeState.error instanceof Error ? activeState.error.message : '不明なエラー'}
        </p>
        <button
          type="button"
          className="px-4 py-2 font-bold transition-opacity hover:opacity-90"
          style={{ borderRadius: DADS.radius6, backgroundColor: DADS.primaryUi, color: DADS.text, border: `1px solid ${DADS.borderSubtle}` }}
          onClick={() => void refetchAll()}
        >
          再試行
        </button>
      </div>
    );
  }

  const rankBadge = (n: number) => `Top ${n}`;

  return (
    <div
      className="flex h-full min-h-0 flex-1 flex-col gap-1.5 overflow-hidden"
      style={{ color: DADS.text, fontFamily: 'var(--font-family-sans)' }}
    >
      <div
        className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-1.5"
        style={{ borderRadius: DADS.radius8, border: `1px solid ${DADS.border}`, backgroundColor: DADS.surface }}
      >
        <h2 className="shrink-0 text-sm font-bold">集計</h2>
        <span className="text-[11px]" style={{ color: DADS.textSub }}>
          {new Date(view.periodFrom).toLocaleDateString('ja-JP')} — {new Date(view.periodTo).toLocaleDateString('ja-JP')}
        </span>
        <div className="ml-2 flex flex-wrap items-center gap-2">
          <span className="text-xs" style={{ color: DADS.textMuted }}>
            対象期間
          </span>
          <button
            type="button"
            className="rounded px-2 py-0.5 text-xs font-semibold transition-opacity hover:opacity-90"
            style={{
              border: `1px solid ${DADS.borderSubtle}`,
              backgroundColor: 'var(--color-neutral-solid-gray-900)',
              color: DADS.text,
              borderRadius: DADS.radius6
            }}
            aria-label="対象期間"
            onClick={() => setMonthPickerOpen(true)}
          >
            {formatPeriodLabelJa(targetPeriod)}
          </button>
          <KioskMonthPickerModal
            isOpen={monthPickerOpen}
            value={targetPeriod}
            variant="analytics"
            onCancel={() => setMonthPickerOpen(false)}
            onCommit={(next) => {
              setTargetPeriod(next);
              setMonthPickerOpen(false);
            }}
          />

          {datasetTab === 'rigging' && (
            <label className="flex items-center gap-1 text-xs" style={{ color: DADS.textMuted }}>
              吊具
              <select
                value={selectedRiggingGearId}
                onChange={(e) => setSelectedRiggingGearId(e.target.value)}
                className="max-w-[min(220px,40vw)] min-w-0 rounded px-1.5 py-0.5 text-xs"
                style={{ border: `1px solid ${DADS.borderSubtle}`, backgroundColor: 'var(--color-neutral-solid-gray-900)', color: DADS.text }}
                aria-label="吊具で絞り込み"
              >
                <option value="">全件</option>
                {riggingOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {datasetTab === 'items' && (
            <label className="flex items-center gap-1 text-xs" style={{ color: DADS.textMuted }}>
              表示名
              <select
                value={selectedItemId}
                onChange={(e) => setSelectedItemId(e.target.value)}
                className="max-w-[min(220px,40vw)] min-w-0 rounded px-1.5 py-0.5 text-xs"
                style={{ border: `1px solid ${DADS.borderSubtle}`, backgroundColor: 'var(--color-neutral-solid-gray-900)', color: DADS.text }}
                aria-label="持出返却アイテムで絞り込み"
              >
                <option value="">全件</option>
                {itemOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {datasetTab === 'instruments' && (
            <label className="flex items-center gap-1 text-xs" style={{ color: DADS.textMuted }}>
              計測機器
              <select
                value={selectedInstrumentId}
                onChange={(e) => setSelectedInstrumentId(e.target.value)}
                className="max-w-[min(220px,40vw)] min-w-0 rounded px-1.5 py-0.5 text-xs"
                style={{ border: `1px solid ${DADS.borderSubtle}`, backgroundColor: 'var(--color-neutral-solid-gray-900)', color: DADS.text }}
                aria-label="計測機器で絞り込み"
              >
                <option value="">全件</option>
                {instrumentOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          className="px-2.5 py-0.5 text-xs font-bold transition-opacity hover:opacity-90"
          style={{
            borderRadius: DADS.radius6,
            backgroundColor: datasetTab === 'rigging' ? DADS.primaryUi : DADS.tabInactive,
            color: datasetTab === 'rigging' ? DADS.text : DADS.textMuted
          }}
          onClick={() => setDatasetTab('rigging')}
        >
          吊具
        </button>
        <button
          type="button"
          className="px-2.5 py-0.5 text-xs font-bold transition-opacity hover:opacity-90"
          style={{
            borderRadius: DADS.radius6,
            backgroundColor: datasetTab === 'items' ? DADS.primaryUi : DADS.tabInactive,
            color: datasetTab === 'items' ? DADS.text : DADS.textMuted
          }}
          onClick={() => setDatasetTab('items')}
        >
          持出返却アイテム
        </button>
        <button
          type="button"
          className="px-2.5 py-0.5 text-xs font-bold transition-opacity hover:opacity-90"
          style={{
            borderRadius: DADS.radius6,
            backgroundColor: datasetTab === 'instruments' ? DADS.primaryUi : DADS.tabInactive,
            color: datasetTab === 'instruments' ? DADS.text : DADS.textMuted
          }}
          onClick={() => setDatasetTab('instruments')}
        >
          計測機器
        </button>
      </div>

      <KioskAnalyticsKpiStrip
        theme={DADS}
        openLoanCount={view.openLoanCount}
        overdueOpenCount={view.overdueOpenCount}
        totalMasterCount={view.totalMasterCount}
        periodBorrowCount={view.periodBorrowCount}
        periodReturnCount={view.periodReturnCount}
        returnCompletionPercent={returnCompletionPct}
      />

      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-4 gap-1.5 overflow-hidden md:grid-cols-2 md:grid-rows-2">
        <div className="min-h-0 overflow-hidden">
          <EmployeeBarsPanel
            rows={rankedEmployees}
            theme={DADS}
            rankBadge={rankBadge(ANALYTICS_KIOSK_DISPLAY_LIMITS.topRankedEmployees)}
          />
        </div>
        <div className="min-h-0 overflow-hidden">
          <AssetBorrowFrequencyPanel
            rows={rankedAssets}
            theme={DADS}
            title={`持出回数（${view.assetFilterLabel}）`}
            rankBadge={rankBadge(ANALYTICS_KIOSK_DISPLAY_LIMITS.topRankedAssets)}
            inventory={assetInventory}
          />
        </div>
        <div className="min-h-0 overflow-hidden">
          <ReturnRatePanel
            borrow={view.periodBorrowCount}
            ret={view.periodReturnCount}
            theme={DADS}
            title={`${view.assetFilterLabel}の事象比（持出/返却）`}
            footerNote={`未返却 ${view.openLoanCount} 件（うち期限超過 ${view.overdueOpenCount} 件）`}
          />
        </div>
        <div className="min-h-0 overflow-hidden">
          <TodayEventsPane
            rows={todayEventRows}
            theme={DADS}
            title="当日の持出返却状況"
            captionBadge={`直近 ${ANALYTICS_KIOSK_DISPLAY_LIMITS.todayEventsMax} 件`}
            todaySummary={{
              borrowCount: todayKinds.borrowCount,
              returnCount: todayKinds.returnCount,
              returnCompletionPercent: todayReturnCompletion
            }}
          />
        </div>
      </div>
    </div>
  );
}
