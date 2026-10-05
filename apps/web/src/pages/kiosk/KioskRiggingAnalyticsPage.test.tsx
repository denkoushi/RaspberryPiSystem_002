import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KioskRiggingAnalyticsPage } from './KioskRiggingAnalyticsPage';

const mockUseRiggingLoanAnalytics = vi.fn();
const mockUseItemLoanAnalytics = vi.fn();
const mockUseMeasuringInstrumentLoanAnalytics = vi.fn();

vi.mock('../../features/rigging-analytics/useRiggingLoanAnalytics', () => ({
  useRiggingLoanAnalytics: (...args: unknown[]) => mockUseRiggingLoanAnalytics(...args)
}));
vi.mock('../../features/item-analytics/useItemLoanAnalytics', () => ({
  useItemLoanAnalytics: (...args: unknown[]) => mockUseItemLoanAnalytics(...args)
}));
vi.mock('../../features/measuring-instrument-analytics/useMeasuringInstrumentLoanAnalytics', () => ({
  useMeasuringInstrumentLoanAnalytics: (...args: unknown[]) => mockUseMeasuringInstrumentLoanAnalytics(...args)
}));

const riggingData = {
  meta: {
    timeZone: 'Asia/Tokyo',
    periodFrom: '2026-09-30T15:00:00.000Z',
    periodTo: '2026-10-31T14:59:59.999Z',
    monthlyMonths: 6,
    generatedAt: '2026-10-05T03:00:00.000Z'
  },
  summary: {
    openLoanCount: 13, overdueOpenCount: 3, totalRiggingGearsActive: 14,
    periodBorrowCount: 50, periodReturnCount: 40
  },
  monthlyTrend: Array.from({ length: 7 }, (_, i) => ({
    yearMonth: `2026-${String(i + 4).padStart(2, '0')}`, borrowCount: i === 5 ? 40 : 50, returnCount: 40
  })),
  byGear: Array.from({ length: 14 }, (_, i) => ({
    gearId: `gear-${i}`, managementNumber: `RG-${String(i).padStart(3, '0')}`, name: `吊具${i}`,
    status: i === 4 ? 'AVAILABLE' : 'IN_USE', isOutNow: i !== 4,
    currentBorrowerDisplayName: i === 3 ? null : `社員${i}`,
    dueAt: i === 1 ? '2026-10-04T12:00:00+09:00' : i === 2 ? '2026-10-01T12:00:00+09:00' : i === 3 ? null : '2026-10-06T12:00:00+09:00',
    periodBorrowCount: i + 1, periodReturnCount: i, openIsOverdue: [1, 2, 3].includes(i)
  })),
  periodEvents: Array.from({ length: 13 }, (_, i) => ({
    kind: i % 2 === 0 ? 'BORROW' : 'RETURN',
    eventAt: `2026-10-05T${String(i).padStart(2, '0')}:30:00+09:00`,
    assetId: `gear-${i}`, assetLabel: `今日の吊具${i}`, actorDisplayName: `社員${i}`, actorEmployeeId: `emp-${i}`
  })),
  byEmployee: Array.from({ length: 12 }, (_, i) => ({
    employeeId: `emp-${i}`, displayName: `社員${i}`, employeeCode: `E${i}`,
    openRiggingCount: 1, periodBorrowCount: i + 1, periodReturnCount: i
  }))
};

const itemData = {
  ...riggingData,
  summary: { ...riggingData.summary, totalItemsActive: 14 },
  byItem: riggingData.byGear.map((row) => ({ ...row, itemId: row.gearId, itemCode: row.managementNumber })),
  byEmployee: riggingData.byEmployee.map((row) => ({ ...row, openItemCount: row.openRiggingCount }))
};
const instrumentData = {
  ...riggingData,
  summary: { ...riggingData.summary, totalInstrumentsActive: 14 },
  byInstrument: riggingData.byGear.map((row) => ({ ...row, instrumentId: row.gearId })),
  byEmployee: riggingData.byEmployee.map((row) => ({ ...row, openInstrumentCount: row.openRiggingCount }))
};

function buildQueryResult(data: unknown) {
  return { data, isPending: false, isError: false, error: null, refetch: vi.fn() };
}

function panel(name: string) {
  return within(screen.getByRole('region', { name }));
}

function changePeriodToDay(day: number) {
  fireEvent.click(screen.getByRole('button', { name: '対象期間' }));
  const dialog = within(screen.getByRole('dialog', { name: '対象期間' }));
  fireEvent.click(dialog.getByRole('tab', { name: '1日' }));
  fireEvent.click(dialog.getByRole('button', { name: `2026年10月${day}日` }));
}

describe('KioskRiggingAnalyticsPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-05T12:00:00+09:00'));
    mockUseRiggingLoanAnalytics.mockReturnValue(buildQueryResult(riggingData));
    mockUseItemLoanAnalytics.mockReturnValue(buildQueryResult(itemData));
    mockUseMeasuringInstrumentLoanAnalytics.mockReturnValue(buildQueryResult(instrumentData));
  });
  afterEach(() => vi.useRealTimers());

  it('対象3ボタン・対象期間・一覧モードを表示し、既存の取得条件を維持する', () => {
    render(<KioskRiggingAnalyticsPage />);
    const target = within(screen.getByRole('group', { name: '対象' }));
    expect(target.getAllByRole('button')).toHaveLength(3);
    expect(target.getByRole('button', { name: '吊具' })).toHaveAttribute('aria-pressed', 'true');
    expect(target.getByRole('button', { name: 'アイテム' })).toHaveAttribute('aria-pressed', 'false');
    expect(target.getByRole('button', { name: '計測機器' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: '対象期間' })).toHaveTextContent('2026年10月');
    expect(screen.getByRole('combobox', { name: '吊具で絞り込み' })).toHaveValue('');
    expect(screen.getByRole('option', { name: 'すべて' })).toHaveValue('');
    expect(mockUseRiggingLoanAnalytics).toHaveBeenNthCalledWith(1, {
      periodFrom: '2026-09-30T15:00:00.000Z', periodTo: '2026-10-31T14:59:59.999Z', monthlyMonths: 6, timeZone: 'Asia/Tokyo'
    });
    expect(mockUseRiggingLoanAnalytics).toHaveBeenNthCalledWith(2, {
      periodFrom: '2026-10-04T15:00:00.000Z', periodTo: '2026-10-05T14:59:59.999Z', monthlyMonths: 1, timeZone: 'Asia/Tokyo'
    });
  });

  it('5つの指標と6か月の棒グラフを表示し、円グラフと旧バッジを出さない', () => {
    render(<KioskRiggingAnalyticsPage />);
    const metrics = panel('期間サマリー指標');
    expect(metrics.getAllByRole('heading').map((node) => node.textContent)).toEqual(['貸出中', '期限超過', '10月 持出', '10月 返却', '6か月の推移']);
    expect(metrics.getByText('/ 14台')).toBeInTheDocument();
    expect(metrics.getByText('空き 1')).toBeInTheDocument();
    expect(metrics.getByRole('meter', { name: '利用率' })).toHaveAttribute('aria-valuenow', '93');
    expect(metrics.getByText('最長 4日')).toBeInTheDocument();
    expect(metrics.getByText('▲ 25%')).toBeInTheDocument();
    expect(metrics.getByText('返却率 80%')).toBeInTheDocument();
    expect(metrics.getByRole('img')).toHaveAccessibleName(riggingData.monthlyTrend.slice(-6).map((row) => `${row.yearMonth} 持出 ${row.borrowCount}件、返却 ${row.returnCount}件`).join('；'));
    expect(screen.queryByLabelText('持出と返却の件数比の円グラフ')).not.toBeInTheDocument();
    expect(screen.queryByText(/事象比|Top \d|今日の持出|当日返却率/)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '集計' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('img')).toHaveLength(1);
    expect(screen.getByRole('heading', { name: '社員別' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '吊具別' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '今日' })).toBeInTheDocument();
  });

  it('未返却は超過行が先頭、期限昇順、不明期限は超過の末尾に出る', () => {
    render(<KioskRiggingAnalyticsPage />);
    const openPanel = panel('未返却');
    expect(openPanel.getByText('超過 3')).toBeInTheDocument();
    const rows = openPanel.getAllByRole('listitem');
    expect(rows).toHaveLength(12); // 11資産＋残件数
    expect(rows[0]).toHaveTextContent('社員2');
    expect(rows[0]).toHaveTextContent('RG-002 吊具2');
    expect(rows[0]).toHaveTextContent('4日超過');
    expect(rows[1]).toHaveTextContent('1日超過');
    expect(rows[2]).toHaveTextContent('RG-003 吊具3');
    expect(within(rows[2]).getAllByText('—')).toHaveLength(2);
    expect(rows[3]).toHaveTextContent('10/06 まで');
    expect(rows[11]).toHaveTextContent('ほか 2 件');
    expect(openPanel.queryByText('吊具4')).not.toBeInTheDocument();
  });

  it('上位10/全件は行数とパネル内スクロールを切り替え、上位モードへ戻せる', () => {
    render(<KioskRiggingAnalyticsPage />);
    const mode = within(screen.getByRole('group', { name: '一覧表示モード' }));
    const top = mode.getByRole('button', { name: '上位10' });
    const all = mode.getByRole('button', { name: '全件' });
    expect(top).toHaveAttribute('aria-pressed', 'true');
    expect(all).toHaveAttribute('aria-pressed', 'false');
    expect(panel('社員別').getAllByRole('listitem')).toHaveLength(10);
    expect(panel('吊具別').getAllByRole('listitem')).toHaveLength(10);
    expect(panel('今日').getAllByRole('listitem')).toHaveLength(11);
    expect(panel('社員別').getByRole('list')).not.toHaveClass('kanalytics__list--all');
    fireEvent.click(all);
    expect(all).toHaveAttribute('aria-pressed', 'true');
    expect(top).toHaveAttribute('aria-pressed', 'false');
    expect(panel('社員別').getAllByRole('listitem')).toHaveLength(12);
    expect(panel('吊具別').getAllByRole('listitem')).toHaveLength(14);
    expect(panel('未返却').getAllByRole('listitem')).toHaveLength(13);
    expect(panel('今日').getAllByRole('listitem')).toHaveLength(13);
    for (const name of ['社員別', '吊具別', '未返却', '今日']) expect(panel(name).getByRole('list')).toHaveClass('kanalytics__list--all');
    fireEvent.click(top);
    expect(top).toHaveAttribute('aria-pressed', 'true');
    expect(panel('社員別').getAllByRole('listitem')).toHaveLength(10);
    expect(panel('社員別').getByRole('list')).not.toHaveClass('kanalytics__list--all');
  });

  it('今日の件数チップと新しい順の時刻を日本時間のHH:mmだけで表示する', () => {
    render(<KioskRiggingAnalyticsPage />);
    const today = panel('今日');
    expect(today.getByText('持出 7')).toBeInTheDocument();
    expect(today.getByText('返却 6')).toBeInTheDocument();
    const rows = today.getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('12:30持出今日の吊具12社員12');
    expect(rows[1]).toHaveTextContent('11:30返却今日の吊具11社員11');
    expect(rows[10]).toHaveTextContent('02:30');
    expect(today.queryByText('10/05')).not.toBeInTheDocument();
  });

  it('各対象に切り替え、資産別見出しと既存の絞り込みラベルを維持する', () => {
    render(<KioskRiggingAnalyticsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'アイテム' }));
    expect(screen.getByRole('button', { name: 'アイテム' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('heading', { name: 'アイテム別' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: '持出返却アイテムで絞り込み' }), { target: { value: 'gear-2' } });
    expect(mockUseItemLoanAnalytics).toHaveBeenCalledWith(expect.objectContaining({ itemId: 'gear-2', monthlyMonths: 6 }));
    fireEvent.click(screen.getByRole('button', { name: '計測機器' }));
    expect(screen.getByRole('button', { name: '計測機器' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('heading', { name: '計測機器別' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: '計測機器で絞り込み' }), { target: { value: 'gear-1' } });
    expect(mockUseMeasuringInstrumentLoanAnalytics).toHaveBeenCalledWith(expect.objectContaining({ measuringInstrumentId: 'gear-1', monthlyMonths: 6 }));
  });

  it('絞り込み後も全候補を保ち、期間移動で選択を解除する', () => {
    const { rerender } = render(<KioskRiggingAnalyticsPage />);
    fireEvent.change(screen.getByRole('combobox', { name: '吊具で絞り込み' }), { target: { value: 'gear-2' } });
    expect(mockUseRiggingLoanAnalytics).toHaveBeenCalledWith(expect.objectContaining({ riggingGearId: 'gear-2' }));
    mockUseRiggingLoanAnalytics.mockReturnValue(buildQueryResult({ ...riggingData, byGear: [riggingData.byGear[2]] }));
    rerender(<KioskRiggingAnalyticsPage />);
    expect(within(screen.getByRole('combobox', { name: '吊具で絞り込み' })).getAllByRole('option')).toHaveLength(15);
    mockUseRiggingLoanAnalytics.mockReturnValue(buildQueryResult(riggingData));
    fireEvent.click(screen.getByRole('button', { name: '前の期間' }));
    expect(screen.getByRole('combobox', { name: '吊具で絞り込み' })).toHaveValue('');
    const septemberCalls = mockUseRiggingLoanAnalytics.mock.calls
      .map(([params]) => params as Record<string, unknown> | undefined)
      .filter((params) => params?.periodFrom === '2026-08-31T15:00:00.000Z');
    expect(septemberCalls.length).toBeGreaterThan(0);
    for (const params of septemberCalls) expect(params).not.toHaveProperty('riggingGearId');
  });

  it('期間を1か月ずつ移動し、今月では次の期間を無効にする', () => {
    render(<KioskRiggingAnalyticsPage />);
    const next = screen.getByRole('button', { name: '次の期間' });
    expect(next).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '前の期間' }));
    expect(screen.getByRole('button', { name: '対象期間' })).toHaveTextContent('2026年9月');
    expect(next).toBeEnabled();
    expect(mockUseRiggingLoanAnalytics).toHaveBeenCalledWith(expect.objectContaining({ periodFrom: '2026-08-31T15:00:00.000Z', periodTo: '2026-09-30T14:59:59.999Z', monthlyMonths: 6 }));
    fireEvent.click(next);
    expect(screen.getByRole('button', { name: '対象期間' })).toHaveTextContent('2026年10月');
    expect(next).toBeDisabled();
    fireEvent.click(next);
    expect(screen.getByRole('button', { name: '対象期間' })).toHaveTextContent('2026年10月');
  });

  it('既存モーダルで日を選び、1日ずつ動かして今日で停止する', () => {
    render(<KioskRiggingAnalyticsPage />);
    changePeriodToDay(4);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '対象期間' })).toHaveTextContent('2026年10月4日');
    expect(panel('期間サマリー指標').getByRole('heading', { name: '10/4 持出' })).toBeInTheDocument();
    expect(panel('期間サマリー指標').queryByText('前月比')).not.toBeInTheDocument();
    expect(mockUseRiggingLoanAnalytics).toHaveBeenCalledWith(expect.objectContaining({ periodFrom: '2026-10-03T15:00:00.000Z', periodTo: '2026-10-04T14:59:59.999Z', monthlyMonths: 6 }));
    fireEvent.click(screen.getByRole('button', { name: '次の期間' }));
    expect(screen.getByRole('button', { name: '対象期間' })).toHaveTextContent('2026年10月5日');
    expect(screen.getByRole('button', { name: '次の期間' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '前の期間' }));
    expect(screen.getByRole('button', { name: '対象期間' })).toHaveTextContent('2026年10月4日');
  });

  it('空の資産・推移・イベントで適切な空表示を出し、空きや前月比を出さない', () => {
    mockUseRiggingLoanAnalytics.mockReturnValue(buildQueryResult({
      ...riggingData, byGear: [], byEmployee: [], monthlyTrend: [], periodEvents: [],
      summary: { ...riggingData.summary, openLoanCount: 0, overdueOpenCount: 0, periodBorrowCount: 0, periodReturnCount: 0 }
    }));
    render(<KioskRiggingAnalyticsPage />);
    expect(panel('未返却').getByText('未返却なし')).toBeInTheDocument();
    expect(panel('今日').getByText('今日はまだありません')).toBeInTheDocument();
    const metrics = panel('期間サマリー指標');
    expect(metrics.getByText('データなし')).toBeInTheDocument();
    expect(metrics.getByText('すべて期限内')).toBeInTheDocument();
    expect(metrics.getByText('返却率 —')).toBeInTheDocument();
    expect(metrics.queryByText(/空き|前月比|最長/)).not.toBeInTheDocument();
    expect(panel('未返却').queryByText(/超過 \d/)).not.toBeInTheDocument();
  });

  it('超過の期限が不明なら最長超過の補足は表示しない', () => {
    mockUseRiggingLoanAnalytics.mockReturnValue(buildQueryResult({ ...riggingData, byGear: [{ ...riggingData.byGear[3], dueAt: null }] }));
    render(<KioskRiggingAnalyticsPage />);
    expect(panel('期間サマリー指標').queryByText(/最長/)).not.toBeInTheDocument();
  });

  it('読み込み状態を維持する', () => {
    mockUseRiggingLoanAnalytics.mockReturnValue({ ...buildQueryResult(undefined), isPending: true });
    render(<KioskRiggingAnalyticsPage />);
    expect(screen.getByRole('status')).toHaveTextContent('読み込み中…');
    expect(screen.queryByRole('region', { name: '期間サマリー指標' })).not.toBeInTheDocument();
  });

  it('エラーの表示と6クエリの再試行を維持する', () => {
    const refetchRigging = vi.fn();
    const refetchItems = vi.fn();
    const refetchInstruments = vi.fn();
    mockUseRiggingLoanAnalytics.mockReturnValue({ ...buildQueryResult(undefined), isError: true, error: new Error('取得失敗'), refetch: refetchRigging });
    mockUseItemLoanAnalytics.mockReturnValue({ ...buildQueryResult(itemData), refetch: refetchItems });
    mockUseMeasuringInstrumentLoanAnalytics.mockReturnValue({ ...buildQueryResult(instrumentData), refetch: refetchInstruments });
    render(<KioskRiggingAnalyticsPage />);
    expect(screen.getByText('データを取得できませんでした。')).toBeInTheDocument();
    expect(screen.getByText('取得失敗')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '再試行' }));
    expect(refetchRigging).toHaveBeenCalledTimes(2);
    expect(refetchItems).toHaveBeenCalledTimes(2);
    expect(refetchInstruments).toHaveBeenCalledTimes(2);
  });
});
