import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { KioskRiggingAnalyticsPage } from './KioskRiggingAnalyticsPage';

const mockUseRiggingLoanAnalytics = vi.fn();
const mockUseItemLoanAnalytics = vi.fn();
const mockUseMeasuringInstrumentLoanAnalytics = vi.fn();

vi.mock('../../features/rigging-analytics/useRiggingLoanAnalytics', () => ({
  useRiggingLoanAnalytics: (...args: unknown[]) => mockUseRiggingLoanAnalytics(...args),
}));

vi.mock('../../features/item-analytics/useItemLoanAnalytics', () => ({
  useItemLoanAnalytics: (...args: unknown[]) => mockUseItemLoanAnalytics(...args),
}));

vi.mock('../../features/measuring-instrument-analytics/useMeasuringInstrumentLoanAnalytics', () => ({
  useMeasuringInstrumentLoanAnalytics: (...args: unknown[]) => mockUseMeasuringInstrumentLoanAnalytics(...args),
}));

const riggingData = {
  meta: {
    timeZone: 'Asia/Tokyo',
    periodFrom: '2026-04-01T00:00:00.000Z',
    periodTo: '2026-04-30T23:59:59.999Z',
    monthlyMonths: 6,
    generatedAt: '2026-04-14T00:00:00.000Z',
  },
  summary: {
    openLoanCount: 1,
    overdueOpenCount: 0,
    totalRiggingGearsActive: 3,
    periodBorrowCount: 4,
    periodReturnCount: 2,
  },
  monthlyTrend: [{ yearMonth: '2026-04', borrowCount: 4, returnCount: 2 }],
  byGear: [
    {
      gearId: 'gear-1',
      managementNumber: 'RG-001',
      name: '定規',
      status: 'AVAILABLE',
      isOutNow: false,
      currentBorrowerDisplayName: null,
      dueAt: null,
      periodBorrowCount: 4,
      periodReturnCount: 3,
      openIsOverdue: false,
    },
  ],
  periodEvents: [
    {
      kind: 'BORROW',
      eventAt: '2026-04-14T00:30:00.000Z',
      assetId: 'gear-1',
      assetLabel: '定規',
      actorDisplayName: '田中 太郎',
      actorEmployeeId: 'emp-1',
    },
  ],
  byEmployee: [
    {
      employeeId: 'emp-1',
      displayName: '田中 太郎',
      employeeCode: 'E001',
      openRiggingCount: 1,
      periodBorrowCount: 4,
      periodReturnCount: 2,
    },
  ],
};

function buildQueryResult(data: unknown) {
  return {
    data,
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  };
}

describe('KioskRiggingAnalyticsPage', () => {
  it('計測機器タブと対象期間フィルタを表示する', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-14T12:00:00+09:00'));
    mockUseRiggingLoanAnalytics.mockReturnValue(buildQueryResult(riggingData));
    mockUseItemLoanAnalytics.mockReturnValue(buildQueryResult({
      ...riggingData,
      summary: {
        ...riggingData.summary,
        totalItemsActive: 0,
      },
      byItem: [],
      periodEvents: [],
    }));
    mockUseMeasuringInstrumentLoanAnalytics.mockReturnValue(buildQueryResult({
      ...riggingData,
      summary: {
        openLoanCount: 0,
        overdueOpenCount: 0,
        totalInstrumentsActive: 0,
        periodBorrowCount: 0,
        periodReturnCount: 0,
      },
      byInstrument: [],
      periodEvents: [],
      byEmployee: [],
    }));

    render(<KioskRiggingAnalyticsPage />);

    expect(screen.getByRole('button', { name: '吊具' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '持出返却アイテム' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '計測機器' })).toBeInTheDocument();
    expect(screen.getByLabelText('対象期間')).toBeInTheDocument();
    expect(mockUseRiggingLoanAnalytics).toHaveBeenNthCalledWith(1, {
      periodFrom: '2026-03-31T15:00:00.000Z',
      periodTo: '2026-04-30T14:59:59.999Z',
      monthlyMonths: 6,
      timeZone: 'Asia/Tokyo',
    });
    expect(mockUseRiggingLoanAnalytics).toHaveBeenNthCalledWith(2, {
      periodFrom: '2026-04-13T15:00:00.000Z',
      periodTo: '2026-04-14T14:59:59.999Z',
      monthlyMonths: 1,
      timeZone: 'Asia/Tokyo',
    });
    vi.useRealTimers();
  });

  it('Top N ダッシュボードを表示し、旧詳細テーブルを出さない', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-14T12:00:00+09:00'));
    mockUseRiggingLoanAnalytics.mockReturnValue(buildQueryResult(riggingData));
    mockUseItemLoanAnalytics.mockReturnValue(buildQueryResult({
      ...riggingData,
      summary: {
        ...riggingData.summary,
        totalItemsActive: 1,
      },
      byItem: [],
    }));
    mockUseMeasuringInstrumentLoanAnalytics.mockReturnValue(buildQueryResult({
      ...riggingData,
      summary: {
        openLoanCount: 0,
        overdueOpenCount: 0,
        totalInstrumentsActive: 1,
        periodBorrowCount: 0,
        periodReturnCount: 0,
      },
      byInstrument: [],
    }));

    render(<KioskRiggingAnalyticsPage />);

    expect(screen.getByRole('region', { name: '期間サマリー指標' })).toBeInTheDocument();
    expect(screen.getByText('社員別 持出・返却')).toBeInTheDocument();
    expect(screen.getByText('持出回数（吊具）')).toBeInTheDocument();
    expect(screen.getByText('直近 5 件')).toBeInTheDocument();
    expect(screen.queryByText('使用頻度（持出回数）')).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: '管理番号' })).not.toBeInTheDocument();
    vi.useRealTimers();
  });
});
