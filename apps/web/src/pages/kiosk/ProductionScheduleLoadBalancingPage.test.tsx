import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProductionScheduleLoadBalancingPage } from './ProductionScheduleLoadBalancingPage';

const mockUseOverview = vi.fn();
const mockUseSiteDevices = vi.fn();
const mockUseSuggestions = vi.fn();
const mockIsMacEnvironment = vi.fn();

vi.mock('../../api/hooks', () => ({
  useKioskProductionScheduleLoadBalancingOverview: (...args: unknown[]) => mockUseOverview(...args),
  useKioskProductionScheduleManualOrderSiteDevices: (...args: unknown[]) => mockUseSiteDevices(...args),
  usePostKioskProductionScheduleLoadBalancingSuggestions: (...args: unknown[]) => mockUseSuggestions(...args)
}));

vi.mock('../../lib/client-key/resolver', () => ({
  isMacEnvironment: (...args: unknown[]) => mockIsMacEnvironment(...args)
}));

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children?: unknown }) => <div>{children as never}</div>,
  BarChart: ({ children }: { children?: unknown }) => <div>{children as never}</div>,
  CartesianGrid: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  Legend: () => null,
  Bar: () => null
}));

describe('ProductionScheduleLoadBalancingPage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-30T12:00:00+09:00'));
    mockIsMacEnvironment.mockReturnValue(false);
    mockUseSiteDevices.mockReturnValue({ data: { deviceScopeKeys: [] } });
  });

  it('概要を表示してサジェスト計算を実行できる', async () => {
    const mutateAsync = vi.fn().mockResolvedValue(undefined);
    const reset = vi.fn();

    mockUseOverview.mockReturnValue({
      data: {
        siteKey: '第2工場',
        yearMonth: '2026-04',
        resources: [
          {
            resourceCd: 'A01',
            requiredMinutes: 240,
            availableMinutes: 180,
            overMinutes: 60,
            classCode: 'LINE-A'
          }
        ]
      },
      isFetching: false,
      error: null
    });
    mockUseSuggestions.mockReturnValue({
      mutateAsync,
      reset,
      isPending: false,
      isError: false,
      error: null,
      data: {
        suggestions: [
          {
            rowId: 'row-1',
            fseiban: 'ABC12345',
            productNo: '123456',
            fhincd: 'P-001',
            fkojun: '10',
            resourceCdFrom: 'A01',
            resourceCdTo: 'B02',
            rowMinutes: 60,
            estimatedReductionMinutesOnSource: 60,
            estimatedBurdenMinutesOnDestination: 60,
            simulatedSourceOverAfter: 0,
            simulatedDestinationOverAfter: 0,
            rulePriority: 1,
            fromClassCode: 'LINE-A',
            toClassCode: 'LINE-B',
            efficiencyRatio: 1
          }
        ]
      }
    });

    render(<ProductionScheduleLoadBalancingPage />);

    expect(screen.getByText('負荷調整（山崩し支援）')).toBeInTheDocument();
    expect(screen.getByText('A01')).toBeInTheDocument();
    expect(screen.getByText('ABC12345')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'サジェストを計算' }));

    expect(mutateAsync).toHaveBeenCalledWith({
      month: '2026-04',
      maxSuggestions: 40
    });
    expect(reset).toHaveBeenCalled();
  });

  it('対象月変更時に既存サジェストをリセットする', () => {
    const reset = vi.fn();

    mockUseOverview.mockReturnValue({
      data: { siteKey: '第2工場', yearMonth: '2026-04', resources: [] },
      isFetching: false,
      error: null
    });
    mockUseSuggestions.mockReturnValue({
      mutateAsync: vi.fn(),
      reset,
      isPending: false,
      isError: false,
      error: null,
      data: null
    });

    render(<ProductionScheduleLoadBalancingPage />);
    expect(reset).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText('対象月'), { target: { value: '2026-05' } });

    expect(reset).toHaveBeenCalledTimes(2);
  });
});
