import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProductionScheduleLoadBalancingSettingsSection } from './ProductionScheduleLoadBalancingSettingsSection';

const mockUseCapacityBase = vi.fn();
const mockUseMonthlyCapacity = vi.fn();
const mockUseClasses = vi.fn();
const mockUseTransferRules = vi.fn();
const mockUseWorkCalendars = vi.fn();
const mockMutBase = vi.fn();
const mockMutMonthly = vi.fn();
const mockMutClasses = vi.fn();
const mockMutRules = vi.fn();
const mockMutWorkCalendars = vi.fn();

vi.mock('../../api/hooks', () => ({
  useProductionScheduleLoadBalancingCapacityBase: (...args: unknown[]) => mockUseCapacityBase(...args),
  useProductionScheduleLoadBalancingMonthlyCapacity: (...args: unknown[]) => mockUseMonthlyCapacity(...args),
  useProductionScheduleLoadBalancingClasses: (...args: unknown[]) => mockUseClasses(...args),
  useProductionScheduleLoadBalancingTransferRules: (...args: unknown[]) => mockUseTransferRules(...args),
  useProductionScheduleLoadBalancingWorkCalendars: (...args: unknown[]) => mockUseWorkCalendars(...args),
  useUpdateProductionScheduleLoadBalancingCapacityBase: () => mockMutBase(),
  useUpdateProductionScheduleLoadBalancingMonthlyCapacity: () => mockMutMonthly(),
  useUpdateProductionScheduleLoadBalancingClasses: () => mockMutClasses(),
  useUpdateProductionScheduleLoadBalancingTransferRules: () => mockMutRules(),
  useUpdateProductionScheduleLoadBalancingWorkCalendars: () => mockMutWorkCalendars()
}));

describe('ProductionScheduleLoadBalancingSettingsSection', () => {
  beforeEach(() => {
    mockUseCapacityBase.mockReturnValue({ data: { siteKey: '第2工場', items: [] }, isLoading: false });
    mockUseMonthlyCapacity.mockReturnValue({ data: { siteKey: '第2工場', items: [] }, isLoading: false });
    mockUseClasses.mockReturnValue({ data: { siteKey: '第2工場', items: [] }, isLoading: false });
    mockUseTransferRules.mockReturnValue({ data: { siteKey: '第2工場', items: [] }, isLoading: false });
    mockUseWorkCalendars.mockReturnValue({ data: { siteKey: '第2工場', items: [] }, isLoading: false });
    mockMutBase.mockReturnValue({ mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false });
    mockMutMonthly.mockReturnValue({ mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false });
    mockMutClasses.mockReturnValue({ mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false });
    mockMutRules.mockReturnValue({ mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false });
    mockMutWorkCalendars.mockReturnValue({ mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false });
  });

  it('基準能力の保存失敗時に操作近くへエラーを表示する', async () => {
    mockMutBase.mockReturnValue({
      mutateAsync: vi.fn().mockRejectedValue(new Error('network error')),
      isPending: false
    });

    render(<ProductionScheduleLoadBalancingSettingsSection location="factory-a" />);

    fireEvent.click(screen.getByRole('button', { name: '基準能力を保存' }));

    await waitFor(() => {
      expect(screen.getByTestId('load-balancing-save-feedback-base')).toHaveTextContent(
        '基準能力の保存に失敗しました'
      );
    });
  });

  it('基準能力の保存成功時に成功メッセージを表示する', async () => {
    render(<ProductionScheduleLoadBalancingSettingsSection location="factory-a" />);

    fireEvent.click(screen.getByRole('button', { name: '基準能力を保存' }));

    await waitFor(() => {
      expect(screen.getByTestId('load-balancing-save-feedback-base')).toHaveTextContent(
        '基準能力を保存しました'
      );
    });
  });
});
