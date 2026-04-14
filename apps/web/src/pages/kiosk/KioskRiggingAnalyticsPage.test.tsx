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
  byGear: [],
  byEmployee: [],
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
  it('計測機器タブと対象月フィルタを表示する', () => {
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
      byEmployee: [],
    }));

    render(<KioskRiggingAnalyticsPage />);

    expect(screen.getByRole('button', { name: '吊具' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '持出返却アイテム' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '計測機器' })).toBeInTheDocument();
    expect(screen.getByLabelText('対象月')).toBeInTheDocument();
    expect(mockUseRiggingLoanAnalytics).toHaveBeenCalledWith({
      periodFrom: '2026-03-31T15:00:00.000Z',
      periodTo: '2026-04-30T14:59:59.999Z',
      monthlyMonths: 6,
      timeZone: 'Asia/Tokyo',
    });
    vi.useRealTimers();
  });
});
