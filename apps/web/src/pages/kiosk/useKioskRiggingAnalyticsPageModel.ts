import { useCallback, useEffect, useMemo, useState } from 'react';

import { KIOSK_ANALYTICS_DADS_THEME } from '../../components/kiosk/analytics/kioskAnalyticsTheme';
import { useItemLoanAnalytics } from '../../features/item-analytics/useItemLoanAnalytics';
import {
  ANALYTICS_KIOSK_DISPLAY_LIMITS,
  ANALYTICS_KIOSK_FULL_LIST_MAX_ROWS,
  type AnalyticsListMode,
  countPeriodEventKinds,
  isFullListTruncated,
  periodReturnCompletionRatePercent,
  selectAssetsForDisplay,
  selectEmployeesForDisplay,
  summarizeAssetInventory,
  takeTodayEventsForDisplay
} from '../../features/kiosk-loan-analytics/analyticsDisplayPolicy';
import { periodRangeToIso, toDayInputValue, toMonthInputValue } from '../../features/kiosk-loan-analytics/period';
import { type DatasetTab, type ViewModel, mapResponseToViewModel } from '../../features/kiosk-loan-analytics/view-model';
import { useMeasuringInstrumentLoanAnalytics } from '../../features/measuring-instrument-analytics/useMeasuringInstrumentLoanAnalytics';
import { useRiggingLoanAnalytics } from '../../features/rigging-analytics/useRiggingLoanAnalytics';

import { isNotFoundQueryError } from './isNotFoundQueryError';

import type { AssetFilterOption } from '../../components/kiosk/analytics/kioskAnalyticsTypes';

const theme = KIOSK_ANALYTICS_DADS_THEME;

/**
 * 集計ページの取得・派生 view・ローカルUI状態。JSX を持たない（単一責任）。
 * 3 系統＋「今日」用の 6 クエリは従来どおり常時有効（第 1 弾スコープ）。
 */
export function useKioskRiggingAnalyticsPageModel() {
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
  const assetInventory = useMemo(() => (view?.assets.length ? summarizeAssetInventory(view.assets) : null), [view]);
  const returnCompletionPct = useMemo(
    () => (view ? periodReturnCompletionRatePercent(view.periodBorrowCount, view.periodReturnCount) : null),
    [view]
  );

  const todayEventRows = useMemo(
    () => takeTodayEventsForDisplay(todayView?.periodEvents ?? [], ANALYTICS_KIOSK_DISPLAY_LIMITS.todayEventsMax, listMode),
    [todayView, listMode]
  );
  const todayKinds = useMemo(() => countPeriodEventKinds(todayView?.periodEvents ?? []), [todayView]);
  const todayReturnCompletion = useMemo(
    () => periodReturnCompletionRatePercent(todayKinds.borrowCount, todayKinds.returnCount),
    [todayKinds]
  );

  const refetchAll = useCallback(() => {
    void riggingQ.refetch();
    void itemQ.refetch();
    void instrumentQ.refetch();
    void riggingTodayQ.refetch();
    void itemTodayQ.refetch();
    void instrumentTodayQ.refetch();
  }, [riggingQ, itemQ, instrumentQ, riggingTodayQ, itemTodayQ, instrumentTodayQ]);

  const employeeRankBadge = useMemo(
    () =>
      listMode === 'top'
        ? `Top ${ANALYTICS_KIOSK_DISPLAY_LIMITS.topRankedEmployees}`
        : isFullListTruncated(view?.employees.length ?? 0, listMode)
          ? `全件（最大${ANALYTICS_KIOSK_FULL_LIST_MAX_ROWS}件）`
          : '全件',
    [listMode, view?.employees.length]
  );

  const assetRankBadge = useMemo(
    () =>
      listMode === 'top'
        ? `Top ${ANALYTICS_KIOSK_DISPLAY_LIMITS.topRankedAssets}`
        : isFullListTruncated(view?.assets.length ?? 0, listMode)
          ? `全件（最大${ANALYTICS_KIOSK_FULL_LIST_MAX_ROWS}件）`
          : '全件',
    [listMode, view?.assets.length]
  );

  const todayCaptionBadge = useMemo(
    () =>
      listMode === 'top'
        ? `直近 ${ANALYTICS_KIOSK_DISPLAY_LIMITS.todayEventsMax} 件`
        : isFullListTruncated(todayView?.periodEvents.length ?? 0, listMode)
          ? `全件（最大${ANALYTICS_KIOSK_FULL_LIST_MAX_ROWS}件）`
          : '全件',
    [listMode, todayView?.periodEvents.length]
  );

  const listModeToggleButtonClass = useCallback(
    (active: boolean) =>
      `rounded px-2 py-0.5 text-[11px] font-bold transition-opacity hover:opacity-90 ${
        active ? 'ring-1 ring-white/25' : 'opacity-80'
      }`,
    []
  );

  return {
    theme,
    targetPeriod,
    setTargetPeriod,
    monthPickerOpen,
    setMonthPickerOpen,
    selectedRiggingGearId,
    setSelectedRiggingGearId,
    selectedItemId,
    setSelectedItemId,
    selectedInstrumentId,
    setSelectedInstrumentId,
    riggingOptions,
    itemOptions,
    instrumentOptions,
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
    assetInventory,
    returnCompletionPct,
    todayEventRows,
    todayKinds,
    todayReturnCompletion,
    employeeRankBadge,
    assetRankBadge,
    todayCaptionBadge,
    listModeToggleButtonClass
  };
}
