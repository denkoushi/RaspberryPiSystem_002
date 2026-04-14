import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { KioskMonthPickerModal } from '../../components/kiosk/KioskMonthPickerModal';
import { useItemLoanAnalytics } from '../../features/item-analytics/useItemLoanAnalytics';
import { useMeasuringInstrumentLoanAnalytics } from '../../features/measuring-instrument-analytics/useMeasuringInstrumentLoanAnalytics';
import { useRiggingLoanAnalytics } from '../../features/rigging-analytics/useRiggingLoanAnalytics';

import type {
  ItemLoanAnalyticsResponse,
  MeasuringInstrumentLoanAnalyticsResponse,
  RiggingLoanAnalyticsResponse,
} from '../../api/types';

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
  radius6: 'var(--border-radius-6)',
  font14: 'var(--font-size-14)',
  lh130: 'var(--line-height-130)'
} as const;

const STATUS_LABEL: Record<string, string> = {
  AVAILABLE: '利用可',
  IN_USE: '貸出中',
  MAINTENANCE: '整備',
  RETIRED: '廃棄'
};

const tooltipStyle: CSSProperties = {
  backgroundColor: 'var(--color-neutral-white)',
  border: '1px solid var(--color-neutral-solid-gray-200)',
  borderRadius: DADS.radius8,
  fontSize: DADS.font14,
  color: 'var(--color-neutral-solid-gray-900)',
  boxShadow: 'var(--elevation-2)'
};
const axisTick = { fill: 'var(--color-neutral-solid-gray-300)', fontSize: 11 };
const tableDense: CSSProperties = {
  fontSize: DADS.font14,
  lineHeight: DADS.lh130,
  fontFamily: 'var(--font-family-sans)'
};
const monoCell: CSSProperties = { fontFamily: 'var(--font-family-mono)' };

type DatasetTab = 'rigging' | 'items' | 'instruments';
type DetailTab = 'asset' | 'employee';

type AssetRow = {
  id: string;
  code: string;
  name: string;
  status: string;
  isOutNow: boolean;
  currentBorrowerDisplayName: string | null;
  dueAt: string | null;
  periodBorrowCount: number;
  periodReturnCount: number;
  openIsOverdue: boolean;
};

type EmployeeRow = {
  employeeId: string;
  displayName: string;
  employeeCode: string;
  openCount: number;
  periodBorrowCount: number;
  periodReturnCount: number;
};

type ViewModel = {
  periodFrom: string;
  periodTo: string;
  monthlyMonths: number;
  openLoanCount: number;
  overdueOpenCount: number;
  totalMasterCount: number;
  periodBorrowCount: number;
  periodReturnCount: number;
  assetTabLabel: string;
  emptyAssetMessage: string;
  monthlyTrend: Array<{ yearMonth: string; borrowCount: number; returnCount: number }>;
  assets: AssetRow[];
  employees: EmployeeRow[];
};

function isNotFoundQueryError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const response = (error as { response?: { status?: number } }).response;
  return response?.status === 404;
}

function formatYearMonthJa(ym: string): string {
  const [y, m] = ym.split('-').map((s) => Number(s));
  if (!y || !m) return ym;
  return `${y}年${m}月`;
}

function formatDt(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('ja-JP', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return iso;
  }
}

function toMonthInputValue(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function monthRangeToIso(monthValue: string): { periodFrom: string; periodTo: string } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(monthValue);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  if (!Number.isFinite(year) || !Number.isFinite(monthIndex) || monthIndex < 0 || monthIndex > 11) {
    return null;
  }
  const start = new Date(`${match[1]}-${match[2]}-01T00:00:00+09:00`);
  const nextMonth = monthIndex === 11 ? `${year + 1}-01` : `${match[1]}-${String(monthIndex + 2).padStart(2, '0')}`;
  const end = new Date(`${nextMonth}-01T00:00:00+09:00`);
  end.setMilliseconds(end.getMilliseconds() - 1);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return null;
  }
  return { periodFrom: start.toISOString(), periodTo: end.toISOString() };
}

function mapRigging(data: RiggingLoanAnalyticsResponse): ViewModel {
  return {
    periodFrom: data.meta.periodFrom,
    periodTo: data.meta.periodTo,
    monthlyMonths: data.meta.monthlyMonths,
    openLoanCount: data.summary.openLoanCount,
    overdueOpenCount: data.summary.overdueOpenCount,
    totalMasterCount: data.summary.totalRiggingGearsActive,
    periodBorrowCount: data.summary.periodBorrowCount,
    periodReturnCount: data.summary.periodReturnCount,
    assetTabLabel: '吊具ごと',
    emptyAssetMessage: '吊具データがありません。',
    monthlyTrend: data.monthlyTrend,
    assets: data.byGear.map((row) => ({
      id: row.gearId,
      code: row.managementNumber,
      name: row.name,
      status: row.status,
      isOutNow: row.isOutNow,
      currentBorrowerDisplayName: row.currentBorrowerDisplayName,
      dueAt: row.dueAt,
      periodBorrowCount: row.periodBorrowCount,
      periodReturnCount: row.periodReturnCount,
      openIsOverdue: row.openIsOverdue
    })),
    employees: data.byEmployee.map((row) => ({
      employeeId: row.employeeId,
      displayName: row.displayName,
      employeeCode: row.employeeCode,
      openCount: row.openRiggingCount,
      periodBorrowCount: row.periodBorrowCount,
      periodReturnCount: row.periodReturnCount
    }))
  };
}

function mapItems(data: ItemLoanAnalyticsResponse): ViewModel {
  return {
    periodFrom: data.meta.periodFrom,
    periodTo: data.meta.periodTo,
    monthlyMonths: data.meta.monthlyMonths,
    openLoanCount: data.summary.openLoanCount,
    overdueOpenCount: data.summary.overdueOpenCount,
    totalMasterCount: data.summary.totalItemsActive,
    periodBorrowCount: data.summary.periodBorrowCount,
    periodReturnCount: data.summary.periodReturnCount,
    assetTabLabel: '表示名ごと（写真持出）',
    emptyAssetMessage: '写真持出の集計データがありません。',
    monthlyTrend: data.monthlyTrend,
    assets: data.byItem.map((row) => ({
      id: row.itemId,
      code: row.itemCode,
      name: row.name,
      status: row.status,
      isOutNow: row.isOutNow,
      currentBorrowerDisplayName: row.currentBorrowerDisplayName,
      dueAt: row.dueAt,
      periodBorrowCount: row.periodBorrowCount,
      periodReturnCount: row.periodReturnCount,
      openIsOverdue: row.openIsOverdue
    })),
    employees: data.byEmployee.map((row) => ({
      employeeId: row.employeeId,
      displayName: row.displayName,
      employeeCode: row.employeeCode,
      openCount: row.openItemCount,
      periodBorrowCount: row.periodBorrowCount,
      periodReturnCount: row.periodReturnCount
    }))
  };
}

function mapInstruments(data: MeasuringInstrumentLoanAnalyticsResponse): ViewModel {
  return {
    periodFrom: data.meta.periodFrom,
    periodTo: data.meta.periodTo,
    monthlyMonths: data.meta.monthlyMonths,
    openLoanCount: data.summary.openLoanCount,
    overdueOpenCount: data.summary.overdueOpenCount,
    totalMasterCount: data.summary.totalInstrumentsActive,
    periodBorrowCount: data.summary.periodBorrowCount,
    periodReturnCount: data.summary.periodReturnCount,
    assetTabLabel: '計測機器ごと',
    emptyAssetMessage: '計測機器の集計データがありません。',
    monthlyTrend: data.monthlyTrend,
    assets: data.byInstrument.map((row) => ({
      id: row.instrumentId,
      code: row.managementNumber,
      name: row.name,
      status: row.status,
      isOutNow: row.isOutNow,
      currentBorrowerDisplayName: row.currentBorrowerDisplayName,
      dueAt: row.dueAt,
      periodBorrowCount: row.periodBorrowCount,
      periodReturnCount: row.periodReturnCount,
      openIsOverdue: row.openIsOverdue,
    })),
    employees: data.byEmployee.map((row) => ({
      employeeId: row.employeeId,
      displayName: row.displayName,
      employeeCode: row.employeeCode,
      openCount: row.openInstrumentCount,
      periodBorrowCount: row.periodBorrowCount,
      periodReturnCount: row.periodReturnCount,
    })),
  };
}

function BorrowReturnMixCell({ borrow, ret, ariaLabel }: { borrow: number; ret: number; ariaLabel: string }) {
  const sum = borrow + ret;
  if (sum <= 0) {
    return (
      <span className="text-[11px] tabular-nums" style={{ color: DADS.textSub }} aria-label={ariaLabel}>
        —
      </span>
    );
  }
  const borrowPct = Math.round((borrow / sum) * 100);
  const returnPct = Math.max(0, Math.min(100, 100 - borrowPct));
  const title = `持出 ${borrow} 件（${borrowPct}%） / 返却 ${ret} 件（${returnPct}%）`;

  return (
    <div
      className="h-2.5 w-full min-w-[72px] max-w-[120px] overflow-hidden"
      style={{
        borderRadius: 'var(--border-radius-4)',
        border: `1px solid ${DADS.border}`,
        backgroundColor: 'var(--color-neutral-solid-gray-900)'
      }}
      title={title}
      aria-label={`${ariaLabel}。${title}`}
    >
      <div className="flex h-full w-full">
        <div className="h-full shrink-0" style={{ width: `${(borrow / sum) * 100}%`, backgroundColor: DADS.chartBorrow }} />
        <div
          className="h-full shrink-0"
          style={{
            width: `${(ret / sum) * 100}%`,
            backgroundColor: DADS.chartReturn,
            borderLeft: `1px solid ${DADS.strokeBar}`
          }}
        />
      </div>
    </div>
  );
}

function AssetTable({ rows }: { rows: AssetRow[] }) {
  return (
    <div className="overflow-x-auto" style={{ borderRadius: DADS.radius8, border: `1px solid ${DADS.border}` }}>
      <table className="w-full min-w-[920px] text-left" style={tableDense}>
        <thead
          className="sticky top-0 z-10 backdrop-blur"
          style={{ backgroundColor: 'color-mix(in srgb, var(--color-neutral-solid-gray-800) 94%, transparent)' }}
        >
          <tr style={{ borderBottom: `1px solid ${DADS.border}` }}>
            <th className="px-2 py-2" style={{ color: DADS.textMuted, fontWeight: 700 }}>管理番号</th>
            <th className="px-2 py-2" style={{ color: DADS.textMuted, fontWeight: 700 }}>名称</th>
            <th className="px-2 py-2" style={{ color: DADS.textMuted, fontWeight: 700 }}>状態</th>
            <th className="px-2 py-2" style={{ color: DADS.textMuted, fontWeight: 700 }}>貸出</th>
            <th className="px-2 py-2" style={{ color: DADS.textMuted, fontWeight: 700 }}>借用者</th>
            <th className="px-2 py-2" style={{ color: DADS.textMuted, fontWeight: 700 }}>期限</th>
            <th className="px-2 py-2" style={{ color: DADS.textMuted, fontWeight: 700 }}>期間内 持出</th>
            <th className="px-2 py-2" style={{ color: DADS.textMuted, fontWeight: 700 }}>期間内 返却</th>
            <th className="px-2 py-2" style={{ color: DADS.textMuted, fontWeight: 700 }}>内訳</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              className="border-b"
              style={{
                borderColor: 'var(--color-neutral-opacity-gray-100)',
                backgroundColor: row.openIsOverdue
                  ? 'color-mix(in srgb, var(--color-semantic-error-1) 20%, transparent)'
                  : row.isOutNow
                    ? 'color-mix(in srgb, var(--color-semantic-warning-yellow-1) 14%, transparent)'
                    : undefined
              }}
            >
              <td className="px-2 py-1.5 tabular-nums" style={{ ...monoCell, color: DADS.text }}>{row.code}</td>
              <td className="px-2 py-1.5 font-medium" style={{ color: DADS.text }}>{row.name}</td>
              <td className="px-2 py-1.5" style={{ color: DADS.textMuted }}>{STATUS_LABEL[row.status] ?? row.status}</td>
              <td className="px-2 py-1.5">
                {row.isOutNow ? (
                  <span
                    className="px-1.5 py-0.5 font-bold"
                    style={{
                      borderRadius: 'var(--border-radius-4)',
                      color: 'var(--color-primitive-yellow-200)',
                      backgroundColor: 'color-mix(in srgb, var(--color-semantic-warning-yellow-2) 38%, transparent)'
                    }}
                  >
                    貸出中
                  </span>
                ) : (
                  <span style={{ color: DADS.textSub }}>在庫</span>
                )}
                {row.openIsOverdue ? (
                  <span
                    className="ml-1.5 px-1.5 py-0.5 font-bold"
                    style={{
                      borderRadius: 'var(--border-radius-4)',
                      color: 'var(--color-primitive-red-200)',
                      backgroundColor: 'color-mix(in srgb, var(--color-semantic-error-1) 35%, transparent)'
                    }}
                  >
                    期限超過
                  </span>
                ) : null}
              </td>
              <td className="px-2 py-1.5" style={{ color: DADS.text }}>{row.currentBorrowerDisplayName ?? '—'}</td>
              <td className="px-2 py-1.5 tabular-nums" style={{ color: DADS.textMuted }}>{formatDt(row.dueAt)}</td>
              <td className="px-2 py-1.5 tabular-nums font-bold" style={{ color: DADS.chartBorrow }}>{row.periodBorrowCount}</td>
              <td className="px-2 py-1.5 tabular-nums font-bold" style={{ color: DADS.chartReturn }}>{row.periodReturnCount}</td>
              <td className="px-2 py-1.5">
                <BorrowReturnMixCell
                  borrow={row.periodBorrowCount}
                  ret={row.periodReturnCount}
                  ariaLabel={`${row.name} 期間内 持出${row.periodBorrowCount} 返却${row.periodReturnCount}`}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmployeeTable({ rows }: { rows: EmployeeRow[] }) {
  return (
    <div className="overflow-x-auto" style={{ borderRadius: DADS.radius8, border: `1px solid ${DADS.border}` }}>
      <table className="w-full min-w-[780px] text-left" style={tableDense}>
        <thead
          className="sticky top-0 z-10 backdrop-blur"
          style={{ backgroundColor: 'color-mix(in srgb, var(--color-neutral-solid-gray-800) 94%, transparent)' }}
        >
          <tr style={{ borderBottom: `1px solid ${DADS.border}` }}>
            <th className="px-2 py-2" style={{ color: DADS.textMuted, fontWeight: 700 }}>氏名</th>
            <th className="px-2 py-2" style={{ color: DADS.textMuted, fontWeight: 700 }}>コード</th>
            <th className="px-2 py-2" style={{ color: DADS.textMuted, fontWeight: 700 }}>現在 未返却</th>
            <th className="px-2 py-2" style={{ color: DADS.textMuted, fontWeight: 700 }}>期間内 持出</th>
            <th className="px-2 py-2" style={{ color: DADS.textMuted, fontWeight: 700 }}>期間内 返却</th>
            <th className="px-2 py-2" style={{ color: DADS.textMuted, fontWeight: 700 }}>内訳</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.employeeId}
              className="border-b"
              style={{
                borderColor: 'var(--color-neutral-opacity-gray-100)',
                backgroundColor:
                  row.openCount > 0
                    ? 'color-mix(in srgb, var(--color-primitive-light-blue-900) 18%, transparent)'
                    : undefined
              }}
            >
              <td className="px-2 py-1.5 font-medium" style={{ color: DADS.text }}>{row.displayName}</td>
              <td className="px-2 py-1.5 tabular-nums" style={{ ...monoCell, color: DADS.textMuted }}>{row.employeeCode}</td>
              <td className="px-2 py-1.5 tabular-nums">
                {row.openCount > 0 ? (
                  <span
                    className="px-1.5 py-0.5 font-bold"
                    style={{
                      borderRadius: 'var(--border-radius-4)',
                      color: 'var(--color-primitive-light-blue-200)',
                      backgroundColor: 'color-mix(in srgb, var(--color-primitive-light-blue-900) 32%, transparent)'
                    }}
                  >
                    {row.openCount}
                  </span>
                ) : (
                  <span style={{ color: DADS.textSub }}>0</span>
                )}
              </td>
              <td className="px-2 py-1.5 tabular-nums font-bold" style={{ color: DADS.chartBorrow }}>{row.periodBorrowCount}</td>
              <td className="px-2 py-1.5 tabular-nums font-bold" style={{ color: DADS.chartReturn }}>{row.periodReturnCount}</td>
              <td className="px-2 py-1.5">
                <BorrowReturnMixCell
                  borrow={row.periodBorrowCount}
                  ret={row.periodReturnCount}
                  ariaLabel={`${row.displayName} 期間内 持出${row.periodBorrowCount} 返却${row.periodReturnCount}`}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LoanAnalyticsMonthlyChart({
  monthlyMonths,
  chartRows
}: {
  monthlyMonths: number;
  chartRows: Array<{ month: string; borrow: number; returned: number }>;
}) {
  return (
    <section
      className="flex w-full flex-col p-2"
      style={{
        borderRadius: DADS.radius8,
        border: `1px solid ${DADS.border}`,
        backgroundColor: 'color-mix(in srgb, var(--color-neutral-solid-gray-900) 55%, transparent)'
      }}
    >
      <h3 className="mb-0.5 text-xs font-bold" style={{ color: DADS.textMuted }}>
        月別（{monthlyMonths}か月）
      </h3>
      <div className="h-40 w-full shrink-0 sm:h-44">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartRows} margin={{ top: 6, right: 4, left: 2, bottom: 18 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-neutral-solid-gray-700)" vertical={false} />
            <XAxis
              dataKey="month"
              tick={axisTick}
              tickLine={false}
              axisLine={false}
              interval={0}
              height={36}
              tickFormatter={(v: string) => (v.length > 5 ? v.replace('年', '/').replace('月', '') : v)}
            />
            <YAxis
              tick={axisTick}
              tickLine={false}
              axisLine={false}
              width={34}
              label={{
                value: '件数',
                angle: -90,
                position: 'insideLeft',
                fill: 'var(--color-neutral-solid-gray-400)',
                fontSize: 10,
                dx: -4,
                dy: 12
              }}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              labelStyle={{ color: 'var(--color-neutral-solid-gray-900)', fontWeight: 700 }}
              cursor={{ fill: 'var(--color-neutral-opacity-gray-100)' }}
              formatter={(value, name) => [String(value ?? ''), String(name)]}
            />
            <Legend
              iconSize={8}
              wrapperStyle={{ paddingTop: 2, fontSize: 11 }}
              formatter={(v) => (
                <span className="text-[11px]" style={{ color: DADS.textMuted }}>
                  {v}
                </span>
              )}
            />
            <Bar
              name="持出"
              dataKey="borrow"
              fill={DADS.chartBorrow}
              stroke={DADS.strokeBar}
              strokeWidth={1}
              radius={[4, 4, 0, 0]}
              maxBarSize={18}
              isAnimationActive={false}
            />
            <Bar
              name="返却"
              dataKey="returned"
              fill={DADS.chartReturn}
              stroke={DADS.strokeBar}
              strokeWidth={1}
              radius={[4, 4, 0, 0]}
              maxBarSize={18}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

type AssetOption = { value: string; label: string };

export function KioskRiggingAnalyticsPage() {
  const [targetMonth, setTargetMonth] = useState(() => toMonthInputValue());
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);
  const period = useMemo(() => monthRangeToIso(targetMonth), [targetMonth]);
  const baseQueryParams = useMemo(
    () =>
      period
        ? {
            periodFrom: period.periodFrom,
            periodTo: period.periodTo,
            monthlyMonths: 6,
            timeZone: 'Asia/Tokyo' as const,
          }
        : undefined,
    [period]
  );

  const [selectedRiggingGearId, setSelectedRiggingGearId] = useState<string>('');
  const [selectedItemId, setSelectedItemId] = useState<string>('');
  const [selectedInstrumentId, setSelectedInstrumentId] = useState<string>('');

  const [riggingOptions, setRiggingOptions] = useState<AssetOption[]>([]);
  const [itemOptions, setItemOptions] = useState<AssetOption[]>([]);
  const [instrumentOptions, setInstrumentOptions] = useState<AssetOption[]>([]);

  const riggingParams = useMemo(
    () =>
      baseQueryParams
        ? {
            ...baseQueryParams,
            ...(selectedRiggingGearId ? { riggingGearId: selectedRiggingGearId } : {}),
          }
        : undefined,
    [baseQueryParams, selectedRiggingGearId]
  );
  const itemParams = useMemo(
    () =>
      baseQueryParams
        ? {
            ...baseQueryParams,
            ...(selectedItemId ? { itemId: selectedItemId } : {}),
          }
        : undefined,
    [baseQueryParams, selectedItemId]
  );
  const instrumentParams = useMemo(
    () =>
      baseQueryParams
        ? {
            ...baseQueryParams,
            ...(selectedInstrumentId ? { measuringInstrumentId: selectedInstrumentId } : {}),
          }
        : undefined,
    [baseQueryParams, selectedInstrumentId]
  );

  const riggingQ = useRiggingLoanAnalytics(riggingParams);
  const itemQ = useItemLoanAnalytics(itemParams);
  const instrumentQ = useMeasuringInstrumentLoanAnalytics(instrumentParams);
  const [datasetTab, setDatasetTab] = useState<DatasetTab>('rigging');
  const [detailTab, setDetailTab] = useState<DetailTab>('asset');
  const [keyword, setKeyword] = useState('');

  useEffect(() => {
    if (!selectedRiggingGearId) {
      setRiggingOptions(
        (riggingQ.data?.byGear ?? []).map((g) => ({
          value: g.gearId,
          label: `${g.managementNumber} ${g.name}`,
        }))
      );
    }
  }, [riggingQ.data, selectedRiggingGearId]);

  useEffect(() => {
    if (!selectedItemId) {
      setItemOptions(
        (itemQ.data?.byItem ?? []).map((it) => ({
          value: it.itemId,
          label: it.name || it.itemCode || it.itemId,
        }))
      );
    }
  }, [itemQ.data, selectedItemId]);

  useEffect(() => {
    if (!selectedInstrumentId) {
      setInstrumentOptions(
        (instrumentQ.data?.byInstrument ?? []).map((row) => ({
          value: row.instrumentId,
          label: `${row.managementNumber} ${row.name}`,
        }))
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
  }, [targetMonth]);

  useEffect(() => {
    if (selectedRiggingGearId && riggingQ.isError && isNotFoundQueryError(riggingQ.error)) {
      setSelectedRiggingGearId('');
    }
  }, [selectedRiggingGearId, riggingQ.isError, riggingQ.error]);

  useEffect(() => {
    if (selectedItemId && itemQ.isError && isNotFoundQueryError(itemQ.error)) {
      setSelectedItemId('');
    }
  }, [selectedItemId, itemQ.isError, itemQ.error]);

  useEffect(() => {
    if (selectedInstrumentId && instrumentQ.isError && isNotFoundQueryError(instrumentQ.error)) {
      setSelectedInstrumentId('');
    }
  }, [selectedInstrumentId, instrumentQ.isError, instrumentQ.error]);

  const activeState = datasetTab === 'rigging' ? riggingQ : datasetTab === 'items' ? itemQ : instrumentQ;
  const view = useMemo(() => {
    if (datasetTab === 'rigging') {
      return riggingQ.data ? mapRigging(riggingQ.data) : null;
    }
    if (datasetTab === 'items') {
      return itemQ.data ? mapItems(itemQ.data) : null;
    }
    return instrumentQ.data ? mapInstruments(instrumentQ.data) : null;
  }, [datasetTab, riggingQ.data, itemQ.data, instrumentQ.data]);

  const refetchAll = () => {
    void riggingQ.refetch();
    void itemQ.refetch();
    void instrumentQ.refetch();
  };

  if (activeState.isPending) {
    return (
      <div className="flex flex-1 items-center justify-center text-lg" style={{ color: DADS.textMuted }} role="status">
        読み込み中…
      </div>
    );
  }

  if (activeState.isError || !view) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <p className="text-lg" style={{ color: 'var(--color-primitive-red-200)' }}>データを取得できませんでした。</p>
        <p className="max-w-md text-sm" style={{ color: DADS.textSub }}>
          {activeState.error instanceof Error ? activeState.error.message : '不明なエラー'}
        </p>
        <button
          type="button"
          className="px-4 py-2 font-bold transition-opacity hover:opacity-90"
          style={{
            borderRadius: DADS.radius6,
            backgroundColor: DADS.primaryUi,
            color: DADS.text,
            border: `1px solid ${DADS.borderSubtle}`
          }}
          onClick={() => void refetchAll()}
        >
          再試行
        </button>
      </div>
    );
  }

  const chartRows = view.monthlyTrend.map((t) => ({
    month: formatYearMonthJa(t.yearMonth),
    borrow: t.borrowCount,
    returned: t.returnCount
  }));
  const normalizedKeyword = keyword.trim().toLowerCase();
  const filteredAssets = normalizedKeyword
    ? view.assets.filter((row) =>
        `${row.code} ${row.name} ${row.currentBorrowerDisplayName ?? ''}`.toLowerCase().includes(normalizedKeyword)
      )
    : view.assets;
  const filteredEmployees = normalizedKeyword
    ? view.employees.filter((row) => `${row.displayName} ${row.employeeCode}`.toLowerCase().includes(normalizedKeyword))
    : view.employees;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5" style={{ color: DADS.text, fontFamily: 'var(--font-family-sans)' }}>
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
            対象月
          </span>
          <button
            type="button"
            className="rounded px-2 py-0.5 text-xs font-semibold transition-opacity hover:opacity-90"
            style={{
              border: `1px solid ${DADS.borderSubtle}`,
              backgroundColor: 'var(--color-neutral-solid-gray-900)',
              color: DADS.text,
              borderRadius: DADS.radius6,
            }}
            aria-label="対象月"
            onClick={() => setMonthPickerOpen(true)}
          >
            {formatYearMonthJa(targetMonth)}
          </button>
          <KioskMonthPickerModal
            isOpen={monthPickerOpen}
            value={targetMonth}
            variant="analytics"
            onCancel={() => setMonthPickerOpen(false)}
            onCommit={(ym) => {
              setTargetMonth(ym);
              setMonthPickerOpen(false);
            }}
          />
          {datasetTab === 'rigging' ? (
            <label className="flex items-center gap-1 text-xs" style={{ color: DADS.textMuted }}>
              吊具
              <select
                value={selectedRiggingGearId}
                onChange={(e) => setSelectedRiggingGearId(e.target.value)}
                className="max-w-[min(220px,40vw)] min-w-0 rounded px-1.5 py-0.5 text-xs"
                style={{
                  border: `1px solid ${DADS.borderSubtle}`,
                  backgroundColor: 'var(--color-neutral-solid-gray-900)',
                  color: DADS.text,
                  borderRadius: DADS.radius6,
                }}
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
          ) : null}
          {datasetTab === 'items' ? (
            <label className="flex items-center gap-1 text-xs" style={{ color: DADS.textMuted }}>
              表示名
              <select
                value={selectedItemId}
                onChange={(e) => setSelectedItemId(e.target.value)}
                className="max-w-[min(220px,40vw)] min-w-0 rounded px-1.5 py-0.5 text-xs"
                style={{
                  border: `1px solid ${DADS.borderSubtle}`,
                  backgroundColor: 'var(--color-neutral-solid-gray-900)',
                  color: DADS.text,
                  borderRadius: DADS.radius6,
                }}
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
          ) : null}
          {datasetTab === 'instruments' ? (
            <label className="flex items-center gap-1 text-xs" style={{ color: DADS.textMuted }}>
              計測機器
              <select
                value={selectedInstrumentId}
                onChange={(e) => setSelectedInstrumentId(e.target.value)}
                className="max-w-[min(220px,40vw)] min-w-0 rounded px-1.5 py-0.5 text-xs"
                style={{
                  border: `1px solid ${DADS.borderSubtle}`,
                  backgroundColor: 'var(--color-neutral-solid-gray-900)',
                  color: DADS.text,
                  borderRadius: DADS.radius6,
                }}
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
          ) : null}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-x-5 gap-y-0.5">
          <span className="flex items-center gap-1.5 text-xs"><span style={{ color: DADS.textSub }}>貸出中</span><span className="text-base font-bold tabular-nums" style={{ color: 'var(--color-primitive-yellow-300)' }}>{view.openLoanCount}</span></span>
          <span className="flex items-center gap-1.5 text-xs"><span style={{ color: DADS.textSub }}>超過</span><span className="text-base font-bold tabular-nums" style={{ color: DADS.error }}>{view.overdueOpenCount}</span></span>
          <span className="flex items-center gap-1.5 text-xs"><span style={{ color: DADS.textSub }}>台数</span><span className="text-base font-bold tabular-nums">{view.totalMasterCount}</span></span>
          <span className="flex items-center gap-1.5 text-xs"><span style={{ color: DADS.textSub }}>持出</span><span className="text-base font-bold tabular-nums" style={{ color: DADS.chartBorrow }}>{view.periodBorrowCount}</span></span>
          <span className="flex items-center gap-1.5 text-xs"><span style={{ color: DADS.textSub }}>返却</span><span className="text-base font-bold tabular-nums" style={{ color: DADS.chartReturn }}>{view.periodReturnCount}</span></span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          className="px-2.5 py-0.5 text-xs font-bold transition-opacity hover:opacity-90"
          style={{
            borderRadius: DADS.radius6,
            ...(datasetTab === 'rigging'
              ? { backgroundColor: DADS.primaryUi, color: DADS.text }
              : { backgroundColor: DADS.tabInactive, color: DADS.textMuted })
          }}
          onClick={() => {
            setDatasetTab('rigging');
            setDetailTab('asset');
          }}
        >
          吊具
        </button>
        <button
          type="button"
          className="px-2.5 py-0.5 text-xs font-bold transition-opacity hover:opacity-90"
          style={{
            borderRadius: DADS.radius6,
            ...(datasetTab === 'items'
              ? { backgroundColor: DADS.primaryUi, color: DADS.text }
              : { backgroundColor: DADS.tabInactive, color: DADS.textMuted })
          }}
          onClick={() => {
            setDatasetTab('items');
            setDetailTab('asset');
          }}
        >
          持出返却アイテム
        </button>
        <button
          type="button"
          className="px-2.5 py-0.5 text-xs font-bold transition-opacity hover:opacity-90"
          style={{
            borderRadius: DADS.radius6,
            ...(datasetTab === 'instruments'
              ? { backgroundColor: DADS.primaryUi, color: DADS.text }
              : { backgroundColor: DADS.tabInactive, color: DADS.textMuted })
          }}
          onClick={() => {
            setDatasetTab('instruments');
            setDetailTab('asset');
          }}
        >
          計測機器
        </button>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[340px_1fr] gap-1.5">
        <div className="flex min-h-0 flex-col gap-1.5 self-start">
          <LoanAnalyticsMonthlyChart monthlyMonths={view.monthlyMonths} chartRows={chartRows} />
        </div>

        <div className="flex min-h-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              className="px-2.5 py-0.5 text-xs font-bold transition-opacity hover:opacity-90"
              style={{
                borderRadius: DADS.radius6,
                ...(detailTab === 'asset'
                  ? { backgroundColor: DADS.primaryUi, color: DADS.text }
                  : { backgroundColor: DADS.tabInactive, color: DADS.textMuted })
              }}
              onClick={() => setDetailTab('asset')}
            >
              {view.assetTabLabel}
            </button>
            <button
              type="button"
              className="px-2.5 py-0.5 text-xs font-bold transition-opacity hover:opacity-90"
              style={{
                borderRadius: DADS.radius6,
                ...(detailTab === 'employee'
                  ? { backgroundColor: DADS.primaryUi, color: DADS.text }
                  : { backgroundColor: DADS.tabInactive, color: DADS.textMuted })
              }}
              onClick={() => setDetailTab('employee')}
            >
              人ごと
            </button>
            <input
              type="search"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder={detailTab === 'asset' ? '管理番号・名称・借用者で絞り込み' : '氏名・コードで絞り込み'}
              className="ml-auto min-w-[240px] rounded px-2 py-1 text-xs"
              style={{
                border: `1px solid ${DADS.borderSubtle}`,
                backgroundColor: 'var(--color-neutral-solid-gray-900)',
                color: DADS.text,
              }}
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {detailTab === 'asset' ? (
              filteredAssets.length === 0 ? (
                <p className="py-8 text-center" style={{ color: DADS.textSub }}>{view.emptyAssetMessage}</p>
              ) : (
                <AssetTable rows={filteredAssets} />
              )
            ) : filteredEmployees.length === 0 ? (
              <p className="py-8 text-center" style={{ color: DADS.textSub }}>該当する従業員の記録がありません。</p>
            ) : (
              <EmployeeTable rows={filteredEmployees} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
