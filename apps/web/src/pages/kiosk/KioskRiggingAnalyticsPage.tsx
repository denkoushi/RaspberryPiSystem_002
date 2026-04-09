import { useState, type CSSProperties } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';

import { useItemLoanAnalytics } from '../../features/item-analytics/useItemLoanAnalytics';
import { useRiggingLoanAnalytics } from '../../features/rigging-analytics/useRiggingLoanAnalytics';

import type {
  ItemLoanAnalyticsByEmployeeRow,
  ItemLoanAnalyticsByItemRow,
  ItemLoanAnalyticsResponse,
  RiggingLoanAnalyticsByEmployeeRow,
  RiggingLoanAnalyticsByGearRow,
  RiggingLoanAnalyticsResponse
} from '../../api/types';

/**
 * デジタル庁デザインシステム（DADS）の設計トークンを利用。
 * @see https://design.digital.go.jp/
 * @see @digital-go-jp/design-tokens（tokens.css を main で import）
 */
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

const tooltipStyle: CSSProperties = {
  backgroundColor: 'var(--color-neutral-white)',
  border: '1px solid var(--color-neutral-solid-gray-200)',
  borderRadius: DADS.radius8,
  fontSize: DADS.font14,
  color: 'var(--color-neutral-solid-gray-900)',
  boxShadow: 'var(--elevation-2)'
};

const axisTick = { fill: 'var(--color-neutral-solid-gray-300)', fontSize: 11 };

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

/** 吊具・タグアイテム共通（ItemStatus / RiggingStatus のラベル） */
const RIGGING_STATUS_LABEL: Record<string, string> = {
  AVAILABLE: '利用可',
  IN_USE: '貸出中',
  MAINTENANCE: '整備',
  RETIRED: '廃棄'
};

/** 期間内の持出/返却の比。帯の幅と色だけで表現（数値は左・右列と hover で確認） */
function BorrowReturnMixCell({ borrow, ret, ariaLabel }: { borrow: number; ret: number; ariaLabel: string }) {
  const sum = borrow + ret;
  if (sum <= 0) {
    return (
      <span
        className="text-[11px] tabular-nums"
        style={{ color: DADS.textSub }}
        aria-label={ariaLabel}
      >
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
        <div
          className="h-full shrink-0"
          style={{ width: `${(borrow / sum) * 100}%`, backgroundColor: DADS.chartBorrow }}
        />
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

const tableDense: CSSProperties = {
  fontSize: DADS.font14,
  lineHeight: DADS.lh130,
  fontFamily: 'var(--font-family-sans)'
};

const monoCell: CSSProperties = { fontFamily: 'var(--font-family-mono)' };

function GearTable({ rows }: { rows: RiggingLoanAnalyticsByGearRow[] }) {
  return (
    <div
      className="overflow-x-auto"
      style={{ borderRadius: DADS.radius8, border: `1px solid ${DADS.border}` }}
    >
      <table className="w-full min-w-[920px] text-left" style={tableDense}>
        <thead
          className="sticky top-0 z-10 backdrop-blur"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--color-neutral-solid-gray-800) 94%, transparent)'
          }}
        >
          <tr style={{ borderBottom: `1px solid ${DADS.border}` }}>
            <th className="px-2 py-2" style={{ color: DADS.textMuted, fontWeight: 700 }}>
              管理番号
            </th>
            <th className="px-2 py-2" style={{ color: DADS.textMuted, fontWeight: 700 }}>
              名称
            </th>
            <th className="px-2 py-2" style={{ color: DADS.textMuted, fontWeight: 700 }}>
              状態
            </th>
            <th className="px-2 py-2" style={{ color: DADS.textMuted, fontWeight: 700 }}>
              貸出
            </th>
            <th className="px-2 py-2" style={{ color: DADS.textMuted, fontWeight: 700 }}>
              借用者
            </th>
            <th className="px-2 py-2" style={{ color: DADS.textMuted, fontWeight: 700 }}>
              期限
            </th>
            <th className="px-2 py-2" style={{ color: DADS.textMuted, fontWeight: 700 }}>
              期間内 持出
            </th>
            <th className="px-2 py-2" style={{ color: DADS.textMuted, fontWeight: 700 }}>
              期間内 返却
            </th>
            <th
              className="px-2 py-2"
              style={{ color: DADS.textMuted, fontWeight: 700 }}
              title="持出=青・返却=シアンの比。詳細はセルにカーソルを合わせてください。"
            >
              内訳
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.gearId}
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
              <td className="px-2 py-1.5 tabular-nums" style={{ ...monoCell, color: DADS.text }}>
                {row.managementNumber}
              </td>
              <td className="px-2 py-1.5 font-medium" style={{ color: DADS.text }}>
                {row.name}
              </td>
              <td className="px-2 py-1.5" style={{ color: DADS.textMuted }}>
                {RIGGING_STATUS_LABEL[row.status] ?? row.status}
              </td>
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
              <td className="px-2 py-1.5" style={{ color: DADS.text }}>
                {row.currentBorrowerDisplayName ?? '—'}
              </td>
              <td className="px-2 py-1.5 tabular-nums" style={{ color: DADS.textMuted }}>
                {formatDt(row.dueAt)}
              </td>
              <td className="px-2 py-1.5 tabular-nums font-bold" style={{ color: DADS.chartBorrow }}>
                {row.periodBorrowCount}
              </td>
              <td className="px-2 py-1.5 tabular-nums font-bold" style={{ color: DADS.chartReturn }}>
                {row.periodReturnCount}
              </td>
              <td className="px-2.5 py-1.5">
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

function EmployeeTable({ rows }: { rows: RiggingLoanAnalyticsByEmployeeRow[] }) {
  return (
    <div
      className="overflow-x-auto"
      style={{ borderRadius: DADS.radius8, border: `1px solid ${DADS.border}` }}
    >
      <table className="w-full min-w-[780px] text-left" style={tableDense}>
        <thead
          className="sticky top-0 z-10 backdrop-blur"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--color-neutral-solid-gray-800) 94%, transparent)'
          }}
        >
          <tr style={{ borderBottom: `1px solid ${DADS.border}` }}>
            <th className="px-2 py-2" style={{ color: DADS.textMuted, fontWeight: 700 }}>
              氏名
            </th>
            <th className="px-2 py-2" style={{ color: DADS.textMuted, fontWeight: 700 }}>
              コード
            </th>
            <th className="px-2 py-2" style={{ color: DADS.textMuted, fontWeight: 700 }}>
              現在 未返却
            </th>
            <th className="px-2 py-2" style={{ color: DADS.textMuted, fontWeight: 700 }}>
              期間内 持出
            </th>
            <th className="px-2 py-2" style={{ color: DADS.textMuted, fontWeight: 700 }}>
              期間内 返却
            </th>
            <th
              className="px-2 py-2"
              style={{ color: DADS.textMuted, fontWeight: 700 }}
              title="持出=青・返却=シアンの比。詳細はセルにカーソルを合わせてください。"
            >
              内訳
            </th>
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
                  row.openRiggingCount > 0
                    ? 'color-mix(in srgb, var(--color-primitive-light-blue-900) 18%, transparent)'
                    : undefined
              }}
            >
              <td className="px-2 py-1.5 font-medium" style={{ color: DADS.text }}>
                {row.displayName}
              </td>
              <td className="px-2 py-1.5 tabular-nums" style={{ ...monoCell, color: DADS.textMuted }}>
                {row.employeeCode}
              </td>
              <td className="px-2 py-1.5 tabular-nums">
                {row.openRiggingCount > 0 ? (
                  <span
                    className="px-1.5 py-0.5 font-bold"
                    style={{
                      borderRadius: 'var(--border-radius-4)',
                      color: 'var(--color-primitive-light-blue-200)',
                      backgroundColor: 'color-mix(in srgb, var(--color-primitive-light-blue-900) 32%, transparent)'
                    }}
                  >
                    {row.openRiggingCount}
                  </span>
                ) : (
                  <span style={{ color: DADS.textSub }}>0</span>
                )}
              </td>
              <td className="px-2 py-1.5 tabular-nums font-bold" style={{ color: DADS.chartBorrow }}>
                {row.periodBorrowCount}
              </td>
              <td className="px-2 py-1.5 tabular-nums font-bold" style={{ color: DADS.chartReturn }}>
                {row.periodReturnCount}
              </td>
              <td className="px-2.5 py-1.5">
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

function ItemAssetTable({ rows }: { rows: ItemLoanAnalyticsByItemRow[] }) {
  return (
    <div
      className="overflow-x-auto"
      style={{ borderRadius: DADS.radius8, border: `1px solid ${DADS.border}` }}
    >
      <table className="w-full min-w-[920px] text-left" style={tableDense}>
        <thead
          className="sticky top-0 z-10 backdrop-blur"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--color-neutral-solid-gray-800) 94%, transparent)'
          }}
        >
          <tr style={{ borderBottom: `1px solid ${DADS.border}` }}>
            <th className="px-2 py-2" style={{ color: DADS.textMuted, fontWeight: 700 }}>
              管理番号
            </th>
            <th className="px-2 py-2" style={{ color: DADS.textMuted, fontWeight: 700 }}>
              名称
            </th>
            <th className="px-2 py-2" style={{ color: DADS.textMuted, fontWeight: 700 }}>
              状態
            </th>
            <th className="px-2 py-2" style={{ color: DADS.textMuted, fontWeight: 700 }}>
              貸出
            </th>
            <th className="px-2 py-2" style={{ color: DADS.textMuted, fontWeight: 700 }}>
              借用者
            </th>
            <th className="px-2 py-2" style={{ color: DADS.textMuted, fontWeight: 700 }}>
              期限
            </th>
            <th className="px-2 py-2" style={{ color: DADS.textMuted, fontWeight: 700 }}>
              期間内 持出
            </th>
            <th className="px-2 py-2" style={{ color: DADS.textMuted, fontWeight: 700 }}>
              期間内 返却
            </th>
            <th
              className="px-2 py-2"
              style={{ color: DADS.textMuted, fontWeight: 700 }}
              title="持出=青・返却=シアンの比。詳細はセルにカーソルを合わせてください。"
            >
              内訳
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.itemId}
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
              <td className="px-2 py-1.5 tabular-nums" style={{ ...monoCell, color: DADS.text }}>
                {row.itemCode}
              </td>
              <td className="px-2 py-1.5 font-medium" style={{ color: DADS.text }}>
                {row.name}
              </td>
              <td className="px-2 py-1.5" style={{ color: DADS.textMuted }}>
                {RIGGING_STATUS_LABEL[row.status] ?? row.status}
              </td>
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
              <td className="px-2 py-1.5" style={{ color: DADS.text }}>
                {row.currentBorrowerDisplayName ?? '—'}
              </td>
              <td className="px-2 py-1.5 tabular-nums" style={{ color: DADS.textMuted }}>
                {formatDt(row.dueAt)}
              </td>
              <td className="px-2 py-1.5 tabular-nums font-bold" style={{ color: DADS.chartBorrow }}>
                {row.periodBorrowCount}
              </td>
              <td className="px-2 py-1.5 tabular-nums font-bold" style={{ color: DADS.chartReturn }}>
                {row.periodReturnCount}
              </td>
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

function ItemEmployeeTable({ rows }: { rows: ItemLoanAnalyticsByEmployeeRow[] }) {
  return (
    <div
      className="overflow-x-auto"
      style={{ borderRadius: DADS.radius8, border: `1px solid ${DADS.border}` }}
    >
      <table className="w-full min-w-[780px] text-left" style={tableDense}>
        <thead
          className="sticky top-0 z-10 backdrop-blur"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--color-neutral-solid-gray-800) 94%, transparent)'
          }}
        >
          <tr style={{ borderBottom: `1px solid ${DADS.border}` }}>
            <th className="px-2 py-2" style={{ color: DADS.textMuted, fontWeight: 700 }}>
              氏名
            </th>
            <th className="px-2 py-2" style={{ color: DADS.textMuted, fontWeight: 700 }}>
              コード
            </th>
            <th className="px-2 py-2" style={{ color: DADS.textMuted, fontWeight: 700 }}>
              現在 未返却
            </th>
            <th className="px-2 py-2" style={{ color: DADS.textMuted, fontWeight: 700 }}>
              期間内 持出
            </th>
            <th className="px-2 py-2" style={{ color: DADS.textMuted, fontWeight: 700 }}>
              期間内 返却
            </th>
            <th
              className="px-2 py-2"
              style={{ color: DADS.textMuted, fontWeight: 700 }}
              title="持出=青・返却=シアンの比。詳細はセルにカーソルを合わせてください。"
            >
              内訳
            </th>
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
                  row.openItemCount > 0
                    ? 'color-mix(in srgb, var(--color-primitive-light-blue-900) 18%, transparent)'
                    : undefined
              }}
            >
              <td className="px-2 py-1.5 font-medium" style={{ color: DADS.text }}>
                {row.displayName}
              </td>
              <td className="px-2 py-1.5 tabular-nums" style={{ ...monoCell, color: DADS.textMuted }}>
                {row.employeeCode}
              </td>
              <td className="px-2 py-1.5 tabular-nums">
                {row.openItemCount > 0 ? (
                  <span
                    className="px-1.5 py-0.5 font-bold"
                    style={{
                      borderRadius: 'var(--border-radius-4)',
                      color: 'var(--color-primitive-light-blue-200)',
                      backgroundColor: 'color-mix(in srgb, var(--color-primitive-light-blue-900) 32%, transparent)'
                    }}
                  >
                    {row.openItemCount}
                  </span>
                ) : (
                  <span style={{ color: DADS.textSub }}>0</span>
                )}
              </td>
              <td className="px-2 py-1.5 tabular-nums font-bold" style={{ color: DADS.chartBorrow }}>
                {row.periodBorrowCount}
              </td>
              <td className="px-2 py-1.5 tabular-nums font-bold" style={{ color: DADS.chartReturn }}>
                {row.periodReturnCount}
              </td>
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

type DatasetTab = 'rigging' | 'items';
type DetailTab = 'asset' | 'employee';

export function KioskRiggingAnalyticsPage() {
  const riggingQ = useRiggingLoanAnalytics();
  const itemQ = useItemLoanAnalytics();
  const [datasetTab, setDatasetTab] = useState<DatasetTab>('rigging');
  const [detailTab, setDetailTab] = useState<DetailTab>('asset');

  const activeQuery = datasetTab === 'rigging' ? riggingQ : itemQ;
  const { data, isPending, isError, error } = activeQuery;

  const refetchAll = () => {
    void riggingQ.refetch();
    void itemQ.refetch();
  };

  if (isPending) {
    return (
      <div
        className="flex flex-1 items-center justify-center text-lg"
        style={{ color: DADS.textMuted, fontFamily: 'var(--font-family-sans)' }}
        role="status"
      >
        読み込み中…
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div
        className="flex flex-1 flex-col items-center justify-center gap-4 text-center"
        style={{ fontFamily: 'var(--font-family-sans)' }}
      >
        <p className="text-lg" style={{ color: 'var(--color-primitive-red-200)' }}>
          データを取得できませんでした。
        </p>
        <p className="max-w-md text-sm" style={{ color: DADS.textSub }}>
          {error instanceof Error ? error.message : '不明なエラー'}
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

  const chartRows = data.monthlyTrend.map((t) => ({
    month: formatYearMonthJa(t.yearMonth),
    borrow: t.borrowCount,
    returned: t.returnCount
  }));
  const riggingPayload = data as RiggingLoanAnalyticsResponse;
  const itemPayload = data as ItemLoanAnalyticsResponse;
  const totalMasterCount =
    datasetTab === 'rigging' ? riggingPayload.summary.totalRiggingGearsActive : itemPayload.summary.totalItemsActive;

  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-1.5"
      style={{ color: DADS.text, fontFamily: 'var(--font-family-sans)' }}
    >
      <div
        className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-1.5"
        style={{
          borderRadius: DADS.radius8,
          border: `1px solid ${DADS.border}`,
          backgroundColor: DADS.surface
        }}
      >
        <h2 className="shrink-0 text-sm font-bold" style={{ color: DADS.text }}>
          集計
        </h2>
        <span className="text-[11px]" style={{ color: DADS.textSub }}>
          {new Date(data.meta.periodFrom).toLocaleDateString('ja-JP')} — {new Date(data.meta.periodTo).toLocaleDateString('ja-JP')}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-x-5 gap-y-0.5">
          <span className="flex items-center gap-1.5 text-xs">
            <span style={{ color: DADS.textSub }}>貸出中</span>
            <span className="text-base font-bold tabular-nums" style={{ color: 'var(--color-primitive-yellow-300)' }}>
              {data.summary.openLoanCount}
            </span>
          </span>
          <span className="flex items-center gap-1.5 text-xs">
            <span style={{ color: DADS.textSub }}>超過</span>
            <span className="text-base font-bold tabular-nums" style={{ color: DADS.error }}>
              {data.summary.overdueOpenCount}
            </span>
          </span>
          <span className="flex items-center gap-1.5 text-xs">
            <span style={{ color: DADS.textSub }}>台数</span>
            <span className="text-base font-bold tabular-nums" style={{ color: DADS.text }}>
              {totalMasterCount}
            </span>
          </span>
          <span className="flex items-center gap-1.5 text-xs">
            <span style={{ color: DADS.textSub }}>持出</span>
            <span className="text-base font-bold tabular-nums" style={{ color: DADS.chartBorrow }}>
              {data.summary.periodBorrowCount}
            </span>
          </span>
          <span className="flex items-center gap-1.5 text-xs">
            <span style={{ color: DADS.textSub }}>返却</span>
            <span className="text-base font-bold tabular-nums" style={{ color: DADS.chartReturn }}>
              {data.summary.periodReturnCount}
            </span>
          </span>
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
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[340px_1fr] gap-1.5">
        <div className="flex min-h-0 flex-col gap-1.5 self-start">
          <LoanAnalyticsMonthlyChart monthlyMonths={data.meta.monthlyMonths} chartRows={chartRows} />
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
              {datasetTab === 'rigging' ? '吊具ごと' : 'アイテムごと'}
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
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {datasetTab === 'rigging' ? (
              detailTab === 'asset' ? (
                riggingPayload.byGear.length === 0 ? (
                  <p className="py-8 text-center" style={{ color: DADS.textSub }}>
                    吊具データがありません。
                  </p>
                ) : (
                  <GearTable rows={riggingPayload.byGear} />
                )
              ) : riggingPayload.byEmployee.length === 0 ? (
                <p className="py-8 text-center" style={{ color: DADS.textSub }}>
                  該当する従業員の記録がありません。
                </p>
              ) : (
                <EmployeeTable rows={riggingPayload.byEmployee} />
              )
            ) : detailTab === 'asset' ? (
              itemPayload.byItem.length === 0 ? (
                <p className="py-8 text-center" style={{ color: DADS.textSub }}>
                  アイテムデータがありません。
                </p>
              ) : (
                <ItemAssetTable rows={itemPayload.byItem} />
              )
            ) : itemPayload.byEmployee.length === 0 ? (
              <p className="py-8 text-center" style={{ color: DADS.textSub }}>
                該当する従業員の記録がありません。
              </p>
            ) : (
              <ItemEmployeeTable rows={itemPayload.byEmployee} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
