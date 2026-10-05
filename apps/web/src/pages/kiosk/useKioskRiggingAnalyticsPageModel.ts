import { useCallback, useEffect, useMemo, useState } from 'react';

import { KIOSK_ANALYTICS_THEME } from '../../components/kiosk/analytics/kioskAnalyticsTheme';
import { useItemLoanAnalytics } from '../../features/item-analytics/useItemLoanAnalytics';
import {
  ANALYTICS_KIOSK_DISPLAY_LIMITS,
  type AnalyticsListMode,
  countPeriodEventKinds,
  longestOverdueDays,
  overdueDays,
  previousMonthBorrowChangePercent,
  selectOpenLoansForDisplay,
  periodReturnCompletionRatePercent,
  selectAssetsForDisplay,
  selectEmployeesForDisplay,
  summarizeAssetInventory,
  takeTodayEventsForDisplay
} from '../../features/kiosk-loan-analytics/analyticsDisplayPolicy';
import {
  formatDueDateJa,
  formatShortPeriodLabel,
  formatTimeJa,
  isLatestPeriod,
  periodRangeToIso,
  shiftPeriod,
  toDayInputValue,
  toMonthInputValue
} from '../../features/kiosk-loan-analytics/period';
import { type DatasetTab, type ViewModel, mapResponseToViewModel } from '../../features/kiosk-loan-analytics/view-model';
import { useMeasuringInstrumentLoanAnalytics } from '../../features/measuring-instrument-analytics/useMeasuringInstrumentLoanAnalytics';
import { useRiggingLoanAnalytics } from '../../features/rigging-analytics/useRiggingLoanAnalytics';

import { isNotFoundQueryError } from './isNotFoundQueryError';

import type { AssetFilterOption } from '../../components/kiosk/analytics/kioskAnalyticsTypes';

const theme = KIOSK_ANALYTICS_THEME;

/**
 * 集計ページの取得・派生 view・ローカルUI状態。JSX を持たない（単一責任）。
 * 3 系統＋「今日」用の 6 クエリは従来どおり常時有効（第 1 弾スコープ）。
 */
export function useKioskRiggingAnalyticsPageModel() {
  const [targetPeriod, updateTargetPeriod] = useState(() => toMonthInputValue());
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
  const [riggingOptions, setRiggingOptions] = useState<AssetFilterOption[]>([]);
  const [itemOptions, setItemOptions] = useState<AssetFilterOption[]>([]);
  const [instrumentOptions, setInstrumentOptions] = useState<AssetFilterOption[]>([]);
  const [datasetTab, setDatasetTab] = useState<DatasetTab>('rigging');
  const [listMode, setListMode] = useState<AnalyticsListMode>('top');

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

  // 未選択時はレスポンスから導出し、選択操作で候補を保持する（絞り込み後も全候補を残す）。
  const currentRiggingOptions = selectedRiggingGearId ? riggingOptions : (riggingQ.data?.byGear ?? []).map((g) => ({ value: g.gearId, label: `${g.managementNumber} ${g.name}` }));
  const currentItemOptions = selectedItemId ? itemOptions : (itemQ.data?.byItem ?? []).map((it) => ({ value: it.itemId, label: it.name || it.itemCode || it.itemId }));
  const currentInstrumentOptions = selectedInstrumentId ? instrumentOptions : (instrumentQ.data?.byInstrument ?? []).map((row) => ({ value: row.instrumentId, label: `${row.managementNumber} ${row.name}` }));

  const changeRiggingGearId = (value: string) => {
    if (!selectedRiggingGearId) setRiggingOptions(currentRiggingOptions);
    setSelectedRiggingGearId(value);
  };
  const changeItemId = (value: string) => {
    if (!selectedItemId) setItemOptions(currentItemOptions);
    setSelectedItemId(value);
  };
  const changeInstrumentId = (value: string) => {
    if (!selectedInstrumentId) setInstrumentOptions(currentInstrumentOptions);
    setSelectedInstrumentId(value);
  };
  const setTargetPeriod = (next: string) => {
    if (next === targetPeriod) return;
    setSelectedRiggingGearId('');
    setSelectedItemId('');
    setSelectedInstrumentId('');
    setRiggingOptions([]);
    setItemOptions([]);
    setInstrumentOptions([]);
    updateTargetPeriod(next);
  };

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
  const view: ViewModel | null = useMemo(() => (raw ? mapResponseToViewModel(datasetTab, raw) : null), [datasetTab, raw]);
  const todayView: ViewModel | null = useMemo(
    () => (todayRaw ? mapResponseToViewModel(datasetTab, todayRaw) : null),
    [datasetTab, todayRaw]
  );

  const rankedEmployees = useMemo(
    () => selectEmployeesForDisplay(view?.employees ?? [], ANALYTICS_KIOSK_DISPLAY_LIMITS.topRankedEmployees, listMode),
    [view, listMode]
  );
  const rankedAssets = useMemo(
    () => selectAssetsForDisplay(view?.assets ?? [], ANALYTICS_KIOSK_DISPLAY_LIMITS.topRankedAssets, listMode),
    [view, listMode]
  );
  const availableCount = useMemo(() => (view?.assets.length ? summarizeAssetInventory(view.assets).availableCount : null), [view]);
  const returnCompletionPct = useMemo(
    () => (view ? periodReturnCompletionRatePercent(view.periodBorrowCount, view.periodReturnCount) : null),
    [view]
  );

  const todayEventRows = useMemo(
    () => takeTodayEventsForDisplay(todayView?.periodEvents ?? [], ANALYTICS_KIOSK_DISPLAY_LIMITS.todayEventsMax, listMode),
    [todayView, listMode]
  );
  const todayKinds = useMemo(() => countPeriodEventKinds(todayView?.periodEvents ?? []), [todayView]);
  const now = new Date();
  const openLoans = selectOpenLoansForDisplay(view?.assets ?? [], listMode).map((row) => {
    const days = overdueDays(row.dueAt, now);
    const dueLabel = days === null || !row.dueAt ? '—' : row.openIsOverdue
      ? days > 0 ? `${days}日超過` : '—'
      : `${formatDueDateJa(row.dueAt)} まで`;
    return { ...row, dueLabel };
  });
  const openLoansRemaining = Math.max(0, (view?.assets.filter((row) => row.isOutNow).length ?? 0) - openLoans.length);
  const longestOverdue = longestOverdueDays(view?.assets ?? [], now);
  const borrowChangePercent = previousMonthBorrowChangePercent(targetPeriod, view?.periodBorrowCount ?? 0, view?.monthlyTrend ?? []);
  const isLatest = isLatestPeriod(targetPeriod, now);
  const onShiftPeriod = (delta: number) => {
    if (delta > 0 && isLatest) return;
    setTargetPeriod(shiftPeriod(targetPeriod, delta));
  };

  const refetchAll = useCallback(() => {
    void riggingQ.refetch();
    void itemQ.refetch();
    void instrumentQ.refetch();
    void riggingTodayQ.refetch();
    void itemTodayQ.refetch();
    void instrumentTodayQ.refetch();
  }, [riggingQ, itemQ, instrumentQ, riggingTodayQ, itemTodayQ, instrumentTodayQ]);

  return {
    theme,
    targetPeriod,
    setTargetPeriod,
    monthPickerOpen,
    setMonthPickerOpen,
    selectedRiggingGearId,
    setSelectedRiggingGearId: changeRiggingGearId,
    selectedItemId,
    setSelectedItemId: changeItemId,
    selectedInstrumentId,
    setSelectedInstrumentId: changeInstrumentId,
    riggingOptions: currentRiggingOptions,
    itemOptions: currentItemOptions,
    instrumentOptions: currentInstrumentOptions,
    datasetTab,
    setDatasetTab,
    listMode,
    setListMode,
    activeState,
    view,
    todayView,
    refetchAll,
    rankedEmployees,
    rankedAssets,
    availableCount,
    returnCompletionPct,
    todayEventRows: todayEventRows.map((row) => ({ ...row, timeLabel: formatTimeJa(row.eventAt) })),
    todayKinds,
    openLoans,
    openLoansRemaining,
    longestOverdue,
    borrowChangePercent,
    periodLabel: formatShortPeriodLabel(targetPeriod),
    isLatest,
    onShiftPeriod
  };
}
