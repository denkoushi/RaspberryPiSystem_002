import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProductionScheduleLoadBalancingPage } from './ProductionScheduleLoadBalancingPage';

const mockUseOverview = vi.fn();
const mockUseMachineMonthly = vi.fn();
const mockUseStartDateLeveling = vi.fn();
const mockUseStartDateLevelingSimulate = vi.fn();
const mockUseSiteDevices = vi.fn();
const mockUseSuggestions = vi.fn();
const mockUseOutsourcingCandidates = vi.fn();
const mockUseOutsourcingSimulate = vi.fn();
const mockUseOutsourcingPlan = vi.fn();
const mockUseOutsourcingReplacements = vi.fn();
const mockIsMacEnvironment = vi.fn();

vi.mock('../../api/hooks', () => ({
  useKioskProductionScheduleLoadBalancingOverview: (...args: unknown[]) => mockUseOverview(...args),
  useKioskProductionScheduleLoadBalancingMachineMonthlyLoad: (...args: unknown[]) =>
    mockUseMachineMonthly(...args),
  useKioskProductionScheduleLoadBalancingStartDateLeveling: (...args: unknown[]) =>
    mockUseStartDateLeveling(...args),
  usePostKioskProductionScheduleLoadBalancingStartDateLevelingSimulate: (...args: unknown[]) =>
    mockUseStartDateLevelingSimulate(...args),
  useKioskProductionScheduleManualOrderSiteDevices: (...args: unknown[]) => mockUseSiteDevices(...args),
  usePostKioskProductionScheduleLoadBalancingSuggestions: (...args: unknown[]) => mockUseSuggestions(...args),
  usePostKioskProductionScheduleLoadBalancingOutsourcingCandidates: (...args: unknown[]) =>
    mockUseOutsourcingCandidates(...args),
  usePostKioskProductionScheduleLoadBalancingOutsourcingSimulate: (...args: unknown[]) =>
    mockUseOutsourcingSimulate(...args),
  usePostKioskProductionScheduleLoadBalancingOutsourcingPlan: (...args: unknown[]) =>
    mockUseOutsourcingPlan(...args),
  usePostKioskProductionScheduleLoadBalancingOutsourcingReplacements: (...args: unknown[]) =>
    mockUseOutsourcingReplacements(...args)
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
  Bar: () => null,
  Cell: () => null,
  LabelList: () => null
}));

describe('ProductionScheduleLoadBalancingPage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-30T12:00:00+09:00'));
    mockIsMacEnvironment.mockReturnValue(false);
    mockUseSiteDevices.mockReturnValue({ data: { deviceScopeKeys: [] } });
    mockUseMachineMonthly.mockReturnValue({
      data: {
        siteKey: '第2工場',
        fromMonth: '2026-04',
        toMonth: '2026-09',
        months: ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'],
        machines: [{ machineName: 'DFD6362', fseibanCount: 2, requiredMinutes: 300 }],
        selectedMachineName: null,
        selectedFhincd: null,
        parts: [],
        resourceMonths: [],
        partRows: []
      },
      isFetching: false,
      error: null
    });
    mockUseStartDateLeveling.mockReturnValue({
      data: {
        siteKey: '第2工場',
        fromMonth: '2026-04',
        toMonth: '2026-09',
        bucket: 'month',
        focusMonth: null,
        months: ['2026-04', '2026-05'],
        days: [],
        resources: [{ resourceCd: '021', workCalendarMode: 'weekdays', requiredMinutes: 100, availableMinutes: 80, overMinutes: 20 }],
        cells: [],
        allocatedRows: [],
        unallocatedRows: [],
        calendarSettings: [],
        simulatedMoves: []
      },
      isFetching: false,
      error: null
    });
    mockUseStartDateLevelingSimulate.mockReturnValue({
      mutateAsync: vi.fn(),
      reset: vi.fn(),
      isPending: false,
      isError: false,
      error: null,
      data: null
    });
    mockUseOutsourcingCandidates.mockReturnValue({
      mutateAsync: vi.fn(),
      reset: vi.fn(),
      isPending: false,
      isError: false,
      error: null,
      data: null
    });
    mockUseOutsourcingSimulate.mockReturnValue({
      mutateAsync: vi.fn(),
      reset: vi.fn(),
      isPending: false,
      isError: false,
      error: null,
      data: null
    });
    mockUseOutsourcingPlan.mockReturnValue({
      mutateAsync: vi.fn(),
      reset: vi.fn(),
      isPending: false,
      isError: false,
      error: null,
      data: null
    });
    mockUseOutsourcingReplacements.mockReturnValue({
      mutateAsync: vi.fn(),
      reset: vi.fn(),
      isPending: false,
      isError: false,
      error: null,
      data: null
    });
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
    expect(screen.getByRole('tablist', { name: '負荷調整ビュー' })).toBeInTheDocument();
    expect(screen.getByText('A01')).toBeInTheDocument();
    expect(screen.getByText('ABC12345')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '社内移管サジェスト' }));

    expect(mutateAsync).toHaveBeenCalledWith({
      month: '2026-04',
      maxSuggestions: 40,
      overResourceCds: ['A01']
    });
    expect(reset).toHaveBeenCalled();
  });

  it('外注候補取得と累積シミュを実行できる', async () => {
    const loadCandidates = vi.fn().mockResolvedValue({
      siteKey: '第2工場',
      yearMonth: '2026-04',
      mode: 'outsourcing',
      resources: [],
      candidates: [
        {
          rowId: 'row-1',
          fseiban: 'ABC12345',
          productNo: '123456',
          fhincd: 'P-001',
          fkojun: '10',
          resourceCd: 'A01',
          rowMinutes: 60,
          overReductionMinutes: 60
        }
      ],
      externalizationCandidates: []
    });
    const simulate = vi.fn().mockResolvedValue({
      siteKey: '第2工場',
      yearMonth: '2026-04',
      mode: 'outsourcing',
      beforeResources: [],
      afterResources: [],
      appliedRows: [],
      skippedRows: [],
      summary: {
        selectedCount: 1,
        appliedCount: 1,
        skippedCount: 0,
        totalReducedMinutes: 60,
        remainingOverMinutes: 0
      }
    });

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
      mutateAsync: vi.fn(),
      reset: vi.fn(),
      isPending: false,
      isError: false,
      error: null,
      data: null
    });
    mockUseOutsourcingCandidates.mockReturnValue({
      mutateAsync: loadCandidates,
      reset: vi.fn(),
      isPending: false,
      isError: false,
      error: null,
      data: null
    });
    mockUseOutsourcingSimulate.mockReturnValue({
      mutateAsync: simulate,
      reset: vi.fn(),
      isPending: false,
      isError: false,
      error: null,
      data: null
    });

    render(<ProductionScheduleLoadBalancingPage />);

    fireEvent.click(screen.getByText('工程行単位の外注候補（従来・折りたたみ）'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '外注候補を取得' }));
    });
    expect(loadCandidates).toHaveBeenCalledWith({
      month: '2026-04',
      maxCandidates: 100,
      overResourceCds: ['A01']
    });

    expect(screen.getByRole('checkbox', { name: 'ABC12345 P-001 を外注候補に選択' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'ABC12345 P-001 を外注候補に選択' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '選択行で累積シミュ' }));
    });

    expect(simulate).toHaveBeenCalledWith({
      month: '2026-04',
      overResourceCds: ['A01'],
      selectedRowIds: ['row-1']
    });
  });

  it('推奨セット自動選定で plan と candidates を呼び simulate は省略する', async () => {
    const plan = vi.fn().mockResolvedValue({
      siteKey: '第2工場',
      yearMonth: '2026-04',
      mode: 'outsourcing',
      strategy: 'max_over_reduction',
      selectedCandidateIds: ['S001\u001fP001\u001fH001'],
      beforeResources: [],
      afterResources: [],
      resolved: true,
      remainingOverMinutes: 0,
      totalReducedMinutes: 120,
      totalOverReductionMinutes: 60
    });
    const loadCandidates = vi.fn().mockResolvedValue({
      siteKey: '第2工場',
      yearMonth: '2026-04',
      mode: 'outsourcing',
      resources: [],
      candidates: [],
      externalizationCandidates: [
        {
          candidateId: 'S001\u001fP001\u001fH001',
          fseiban: 'S001',
          productNo: 'P001',
          fhincd: 'H001',
          fhinmei: '部品A',
          operations: [],
          impactByResource: [],
          totalReducedMinutes: 120,
          totalOverReductionMinutes: 60,
          resolvesOverResourceCds: ['A01']
        }
      ]
    });
    const simulate = vi.fn().mockResolvedValue({
      siteKey: '第2工場',
      yearMonth: '2026-04',
      mode: 'outsourcing',
      beforeResources: [],
      afterResources: [],
      appliedRows: [],
      skippedRows: [],
      summary: {
        selectedCount: 1,
        appliedCount: 1,
        skippedCount: 0,
        totalReducedMinutes: 120,
        remainingOverMinutes: 0
      }
    });

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
      mutateAsync: vi.fn(),
      reset: vi.fn(),
      isPending: false,
      isError: false,
      error: null,
      data: null
    });
    mockUseOutsourcingPlan.mockReturnValue({
      mutateAsync: plan,
      reset: vi.fn(),
      isPending: false,
      isError: false,
      error: null,
      data: null
    });
    mockUseOutsourcingCandidates.mockReturnValue({
      mutateAsync: loadCandidates,
      reset: vi.fn(),
      isPending: false,
      isError: false,
      error: null,
      data: null
    });
    mockUseOutsourcingSimulate.mockReturnValue({
      mutateAsync: simulate,
      reset: vi.fn(),
      isPending: false,
      isError: false,
      error: null,
      data: null
    });

    render(<ProductionScheduleLoadBalancingPage />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '推奨セットを自動選定' }));
    });

    expect(plan).toHaveBeenCalledWith({
      month: '2026-04',
      overResourceCds: ['A01'],
      strategy: 'max_over_reduction'
    });
    expect(loadCandidates).toHaveBeenCalledWith({
      month: '2026-04',
      maxCandidates: 200,
      overResourceCds: ['A01']
    });
    expect(simulate).not.toHaveBeenCalled();
    expect(screen.getByText(/超過解消見込み/)).toBeInTheDocument();
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

  it('機種別月次負荷タブで machine-monthly-load を呼ぶ', () => {
    mockUseOverview.mockReturnValue({
      data: { siteKey: '第2工場', yearMonth: '2026-04', resources: [] },
      isFetching: false,
      error: null
    });
    mockUseSuggestions.mockReturnValue({
      mutateAsync: vi.fn(),
      reset: vi.fn(),
      isPending: false,
      isError: false,
      error: null,
      data: null
    });

    render(<ProductionScheduleLoadBalancingPage />);
    fireEvent.click(screen.getByRole('tab', { name: '機種別月次負荷' }));

    expect(screen.getByText('機種を選択するとグラフを表示します。')).toBeInTheDocument();
    expect(mockUseMachineMonthly).toHaveBeenCalled();
    const lastCall = mockUseMachineMonthly.mock.calls.at(-1);
    expect(lastCall?.[0]).toMatchObject({
      fromMonth: '2026-04',
      toMonth: '2026-09'
    });
  });

  it('着手日・平準化タブで start-date-leveling を呼ぶ', () => {
    mockUseOverview.mockReturnValue({
      data: { siteKey: '第2工場', yearMonth: '2026-04', resources: [] },
      isFetching: false,
      error: null
    });
    mockUseSuggestions.mockReturnValue({
      mutateAsync: vi.fn(),
      reset: vi.fn(),
      isPending: false,
      isError: false,
      error: null,
      data: null
    });

    render(<ProductionScheduleLoadBalancingPage />);
    fireEvent.click(screen.getByRole('tab', { name: '着手日・平準化' }));

    expect(screen.getByText(/FSIGENSHOYORYO × 指示数/)).toBeInTheDocument();
    expect(mockUseStartDateLeveling).toHaveBeenCalled();
    const lastCall = mockUseStartDateLeveling.mock.calls.at(-1);
    expect(lastCall?.[0]).toMatchObject({
      fromMonth: '2026-04',
      toMonth: '2026-09',
      bucket: 'month'
    });
  });

  it('Mac代理時は targetDeviceScopeKey を overview と machine-monthly に渡す', () => {
    mockIsMacEnvironment.mockReturnValue(true);
    mockUseSiteDevices.mockReturnValue({
      data: { deviceScopeKeys: ['pi4-kiosk-1'] }
    });
    mockUseOverview.mockReturnValue({
      data: { siteKey: '第2工場', yearMonth: '2026-04', resources: [] },
      isFetching: false,
      error: null
    });
    mockUseSuggestions.mockReturnValue({
      mutateAsync: vi.fn(),
      reset: vi.fn(),
      isPending: false,
      isError: false,
      error: null,
      data: null
    });

    render(<ProductionScheduleLoadBalancingPage />);

    expect(mockUseOverview).toHaveBeenCalledWith(
      expect.objectContaining({ targetDeviceScopeKey: 'pi4-kiosk-1' }),
      expect.objectContaining({ enabled: true })
    );

    fireEvent.click(screen.getByRole('tab', { name: '機種別月次負荷' }));

    expect(mockUseMachineMonthly).toHaveBeenCalledWith(
      expect.objectContaining({ targetDeviceScopeKey: 'pi4-kiosk-1' }),
      expect.objectContaining({ enabled: true })
    );
  });
});
