import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProductionScheduleLoadBalancingPage } from './ProductionScheduleLoadBalancingPage';

import type { ProductionScheduleLoadBalancingWorkspaceResponse } from '../../api/client';

const mockUseWorkspace = vi.fn();
const mockUseWorkspaceDay = vi.fn();
const mockUseResources = vi.fn();
const mockUseSiteDevices = vi.fn();
const mockCapacityMutate = vi.fn();
const mockIsMacEnvironment = vi.fn();

vi.mock('../../api/hooks', () => ({
  useKioskSites: () => ({ data: undefined }),
  useKioskProductionScheduleLoadBalancingWorkspace: (...args: unknown[]) => mockUseWorkspace(...args),
  useKioskProductionScheduleLoadBalancingWorkspaceDay: (...args: unknown[]) => mockUseWorkspaceDay(...args),
  useKioskProductionScheduleResources: (...args: unknown[]) => mockUseResources(...args),
  useKioskProductionScheduleManualOrderSiteDevices: (...args: unknown[]) => mockUseSiteDevices(...args),
  usePutKioskProductionScheduleLoadBalancingCapacityBase: () => ({
    mutate: mockCapacityMutate,
    reset: vi.fn(),
    isPending: false,
    error: null
  })
}));

vi.mock('../../lib/client-key/resolver', () => ({
  isMacEnvironment: (...args: unknown[]) => mockIsMacEnvironment(...args)
}));

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children?: unknown }) => <div>{children as never}</div>,
  BarChart: ({ children }: { children?: unknown }) => <div>{children as never}</div>,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  ReferenceLine: () => null,
  Bar: () => null,
  Cell: () => null
}));

const H = 60;

function workspace(): ProductionScheduleLoadBalancingWorkspaceResponse {
  const months = ['2026-09', '2026-10', '2026-11', '2026-12', '2027-01', '2027-02'];
  const capacity = (minutes: number | null) => Object.fromEntries(months.map((month) => [month, minutes]));
  const row = (rowId: string, resourceCd: string, bucket: string, hours: number, machineName = 'NVD-5000') => ({
    rowId,
    fseiban: `S-${rowId}`,
    productNo: '1',
    fhincd: `P-${rowId}`,
    fhinmei: `部品${rowId}`,
    machineName,
    resourceCd,
    totalMinutes: hours * H,
    plannedStartDate: '2026-10-05',
    effectiveDueDate: bucket === 'late' ? '2026-09-10' : '2026-10-20',
    late: bucket === 'late',
    allocations: [{ bucket, minutes: hours * H }]
  });
  return {
    siteKey: '第2工場',
    today: '2026-09-30',
    fromMonth: '2026-09',
    toMonth: '2027-02',
    months,
    resources: [
      { resourceCd: '033', classCode: 'H', workCalendarMode: 'weekdays', baseCapacityMinutes: 100 * H, capacityByMonth: capacity(100 * H) },
      { resourceCd: '034', classCode: 'H', workCalendarMode: 'weekdays', baseCapacityMinutes: 100 * H, capacityByMonth: capacity(100 * H) },
      { resourceCd: '091', classCode: null, workCalendarMode: 'weekdays', baseCapacityMinutes: null, capacityByMonth: capacity(null) }
    ],
    rows: [
      row('a', '033', '2026-10', 80),
      row('b', '033', '2026-10', 30, 'HX-630'),
      row('c', '034', '2026-10', 40),
      row('d', '091', '2026-10', 50),
      row('e', '033', 'late', 12)
    ],
    unallocatedRows: [
      {
        rowId: 'u1',
        fseiban: 'S-u1',
        productNo: '1',
        fhincd: 'P-u1',
        fkojun: '10',
        resourceCd: '033',
        reason: 'missing_planned_start_date',
        requiredMinutes: 120
      }
    ],
    transferRules: [{ fromClassCode: 'H', toClassCode: 'H', priority: 1, efficiencyRatio: 1 }]
  };
}

describe('ProductionScheduleLoadBalancingPage', () => {
  beforeEach(() => {
    vi.setSystemTime(new Date('2026-09-30T12:00:00+09:00'));
    mockIsMacEnvironment.mockReturnValue(false);
    mockUseSiteDevices.mockReturnValue({ data: { deviceScopeKeys: [] } });
    mockUseResources.mockReturnValue({ data: { resourceNameMap: { '033': ['横型N7'] } } });
    mockUseWorkspace.mockReturnValue({ data: workspace(), isFetching: false, error: null });
    mockUseWorkspaceDay.mockReturnValue({
      data: {
        siteKey: '第2工場',
        month: '2026-10',
        resourceCd: '033',
        capacityMinutesPerDay: (100 * H) / 22,
        days: [{ date: '2026-10-05', requiredMinutes: 110 * H }],
        rowDays: [
          { rowId: 'a', date: '2026-10-05', minutes: 80 * H },
          { rowId: 'b', date: '2026-10-05', minutes: 30 * H }
        ]
      },
      isFetching: false
    });
    mockCapacityMutate.mockReset();
  });

  it('requests six months from the current month and shows the KPIs without counting unset capacity as over', () => {
    render(<ProductionScheduleLoadBalancingPage />);

    expect(mockUseWorkspace).toHaveBeenCalledWith({ fromMonth: '2026-09', toMonth: '2027-02' }, { enabled: true });
    // 033 だけ超過（110H / 100H）。能力未設定の 091 は超過に数えない
    expect(screen.getByText('超過資源').nextSibling).toHaveTextContent('1');
    expect(screen.getByText('超過計').nextSibling).toHaveTextContent('10');
    expect(screen.getByText('遅れ残').nextSibling).toHaveTextContent('12');
    expect(screen.getByRole('button', { name: /能力未設定/ })).toHaveTextContent('1');
  });

  it('opens the worst cell and levels it automatically by transferring to a resource with room', () => {
    render(<ProductionScheduleLoadBalancingPage />);

    const detail = screen.getByTestId('load-balancing-cell-detail');
    expect(within(detail).getByRole('heading')).toHaveTextContent('033');
    expect(within(detail).getByRole('heading')).toHaveTextContent('2026/10');

    fireEvent.click(within(detail).getByRole('button', { name: /超過分を自動で崩す/ }));

    // 超過 10H に一番近い 30H の行 b を 034（余力 60H）へ移管
    expect(within(detail).getByText('→ 034')).toBeInTheDocument();
    const bar = screen.getByTestId('load-balancing-scenario-bar');
    expect(bar).toHaveTextContent('移管 1 · 30H');
    expect(bar).toHaveTextContent('10 → 0H');
  });

  it('removes an outsourced row from the cell and can undo it', () => {
    render(<ProductionScheduleLoadBalancingPage />);
    const detail = screen.getByTestId('load-balancing-cell-detail');

    fireEvent.click(within(detail).getAllByRole('button', { name: '外注' })[0]!);
    expect(screen.getByTestId('load-balancing-scenario-bar')).toHaveTextContent('外注 1 · 80H');

    fireEvent.click(screen.getByRole('button', { name: /1つ戻す/ }));
    expect(screen.getByTestId('load-balancing-scenario-bar')).not.toHaveTextContent('外注');
  });

  it('saves a capacity entered in hours as minutes for a resource without capacity', () => {
    render(<ProductionScheduleLoadBalancingPage />);

    fireEvent.click(screen.getAllByRole('button', { name: '091 の能力を編集' })[0]!);
    const input = screen.getByRole('textbox', { name: '091 の月あたり能力（時間）' });
    fireEvent.change(input, { target: { value: '120' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(mockCapacityMutate).toHaveBeenCalledWith(
      { resourceCd: '091', baseAvailableMinutes: 7200 },
      expect.objectContaining({ onSuccess: expect.any(Function) })
    );
  });

  it('shows machine names in half-width like other kiosk screens and filters by them', () => {
    const data = workspace();
    data.rows[0]!.machineName = 'ｎｖｄ－５０００';
    data.rows[1]!.machineName = 'ＨＸ－６３０';
    mockUseWorkspace.mockReturnValue({ data, isFetching: false, error: null });
    render(<ProductionScheduleLoadBalancingPage />);

    const select = screen.getByRole('combobox', { name: '機種' });
    expect(within(select).getByRole('option', { name: '機種：HX-630' })).toBeInTheDocument();
    const detail = screen.getByTestId('load-balancing-cell-detail');
    expect(within(detail).getAllByText('NVD-5000').length).toBeGreaterThan(0);

    fireEvent.change(select, { target: { value: 'HX-630' } });
    expect(within(detail).queryByText('NVD-5000')).not.toBeInTheDocument();
    expect(within(detail).getByText('HX-630')).toBeInTheDocument();
  });

  it('asks the day chart for the same range so the server reuses the loaded rows', () => {
    render(<ProductionScheduleLoadBalancingPage />);
    expect(mockUseWorkspaceDay).toHaveBeenCalledWith(
      expect.objectContaining({ month: '2026-10', resourceCd: '033', fromMonth: '2026-09', toMonth: '2027-02' }),
      { enabled: true }
    );
  });

  it('lists rows that could not be placed on any month', () => {
    render(<ProductionScheduleLoadBalancingPage />);

    fireEvent.click(screen.getByRole('button', { name: /未配分/ }));
    expect(screen.getByTestId('load-balancing-unallocated')).toHaveTextContent('着手日なし');
  });
});
