import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProductionScheduleLoadBalancingPage } from './ProductionScheduleLoadBalancingPage';

import type { ProductionScheduleLoadBalancingWorkspaceResponse } from '../../api/client';

const mockUseWorkspace = vi.fn();
const mockUseWorkspaceDay = vi.fn();
const mockUseResources = vi.fn();
const mockUseSiteDevices = vi.fn();
const mockCapacityMutate = vi.fn();
const mockSettingsMutate = vi.fn();
const mockIsMacEnvironment = vi.fn();

vi.mock('../../api/hooks', () => ({
  useKioskSites: () => ({ data: undefined }),
  useKioskProductionScheduleLoadBalancingWorkspace: (...args: unknown[]) => mockUseWorkspace(...args),
  useKioskProductionScheduleLoadBalancingWorkspaceDay: (...args: unknown[]) => mockUseWorkspaceDay(...args),
  useKioskProductionScheduleResources: (...args: unknown[]) => mockUseResources(...args),
  useKioskProductionScheduleManualOrderSiteDevices: (...args: unknown[]) => mockUseSiteDevices(...args),
  usePutKioskProductionScheduleLoadBalancingOutsourceSettings: () => ({ mutate: mockSettingsMutate, reset: vi.fn(), isPending: false, error: null }),
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
    outsourceSettings: { mode: 'process', order: ['due', 'minutes', 'vendor'], vendors: [{ id: 'v1', name: '加工A', priority: 1, monthlyCapacityMinutes: null, conditions: [{ resourceCds: [], partPrefix: '', partName: '', maxMinutes: null }] }] },
    transferRules: [{ fromClassCode: 'H', toClassCode: 'H', priority: 1, efficiencyRatio: 1 }]
  };
}

describe('ProductionScheduleLoadBalancingPage', () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockUseWorkspace.mockClear();
    mockUseWorkspaceDay.mockClear();
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
    mockSettingsMutate.mockReset();
  });

  it('requests six months from the current month and shows the KPIs without counting unset capacity as over', () => {
    render(<ProductionScheduleLoadBalancingPage />);

    expect(mockUseWorkspace).toHaveBeenCalledWith({ fromMonth: '2026-09', toMonth: '2027-02', dueSource: 'excel' }, { enabled: true });
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

    fireEvent.click(screen.getByRole('button', { name: '自動選定' }));

    // 超過 10H に一番近い 30H の行 b を 034（余力 60H）へ移管
    expect(within(detail).getByText('→ 034')).toBeInTheDocument();
    const bar = screen.getByTestId('load-balancing-scenario-bar');
    expect(bar).toHaveTextContent('移管 1 · 30H');
    expect(bar).toHaveTextContent('10 → 0H');
  });

  it('removes an outsourced row from the cell and can undo it', () => {
    render(<ProductionScheduleLoadBalancingPage />);
    const detail = screen.getByTestId('load-balancing-cell-detail');

    fireEvent.click(within(detail).getAllByRole('button', { name: '外注 ▾' })[0]!);
    fireEvent.click(within(detail).getByRole('button', { name: '加工A' }));
    expect(screen.getByTestId('load-balancing-scenario-bar')).toHaveTextContent('外注 1 · 80H');
    expect(screen.getByTestId('load-balancing-outsource')).toHaveTextContent('加工A');

    fireEvent.click(screen.getByRole('button', { name: /1つ戻す/ }));
    expect(screen.getByTestId('load-balancing-scenario-bar')).not.toHaveTextContent('外注');
  });

  it('outsources and cancels an entire part and undoes an automatic batch together', () => {
    const data = workspace();
    data.rows[1]!.fseiban = data.rows[0]!.fseiban;
    data.rows[1]!.fhincd = data.rows[0]!.fhincd;
    data.outsourceSettings!.mode = 'part';
    data.transferRules = [];
    mockUseWorkspace.mockReturnValue({ data, isFetching: false, error: null });
    render(<ProductionScheduleLoadBalancingPage />);
    fireEvent.click(screen.getByRole('button', { name: '自動選定' }));
    expect(screen.getByTestId('load-balancing-scenario-bar')).toHaveTextContent('外注 2 · 110H');
    expect(screen.getByTestId('load-balancing-outsource')).toHaveTextContent('加工A');
    fireEvent.click(screen.getByRole('button', { name: 'a の外注を取り消す' }));
    expect(screen.getByTestId('load-balancing-scenario-bar')).not.toHaveTextContent('外注');
    fireEvent.click(screen.getByRole('button', { name: '1つ戻す' }));
    expect(screen.getByTestId('load-balancing-scenario-bar')).toHaveTextContent('外注 2 · 110H');
    fireEvent.click(screen.getByRole('button', { name: '1つ戻す' }));
    expect(screen.getByTestId('load-balancing-scenario-bar')).not.toHaveTextContent('外注');
  });

  it('shows no-destination reasons and leaves blocked work inside the heatmap', () => {
    const data = workspace(); data.transferRules = [];
    data.outsourceSettings!.vendors[0]!.monthlyCapacityMinutes = 0;
    mockUseWorkspace.mockReturnValue({ data, isFetching: false, error: null });
    render(<ProductionScheduleLoadBalancingPage />);
    fireEvent.click(screen.getByRole('button', { name: '自動選定' }));
    expect(screen.getByTestId('load-balancing-outsource')).toHaveTextContent('出し先なし');
    expect(screen.getByTestId('load-balancing-outsource')).toHaveTextContent('上限');
    expect(screen.getByText('超過資源').nextSibling).toHaveTextContent('1');
  });

  it('invalidates the trial and history when refreshed vendor settings change', () => {
    const data = workspace();
    mockUseWorkspace.mockReturnValue({ data, isFetching: false, error: null });
    const { rerender } = render(<ProductionScheduleLoadBalancingPage />);
    fireEvent.click(screen.getByRole('button', { name: '自動選定' }));
    expect(screen.getByRole('button', { name: '1つ戻す' })).toBeEnabled();
    mockUseWorkspace.mockReturnValue({ data: { ...data, outsourceSettings: { ...data.outsourceSettings!, vendors: [] } }, isFetching: false, error: null });
    rerender(<ProductionScheduleLoadBalancingPage />);
    expect(screen.getByRole('button', { name: '1つ戻す' })).toBeDisabled();
    expect(screen.getByTestId('load-balancing-scenario-bar')).not.toHaveTextContent('移管');
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

  it('uses the header automatic button and undo restores the complete selection', () => {
    render(<ProductionScheduleLoadBalancingPage />);
    expect(within(screen.getByTestId('load-balancing-cell-detail')).queryByRole('button', { name: /自動/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '自動選定' }));
    fireEvent.click(screen.getByRole('button', { name: '1つ戻す' }));
    expect(screen.getByText('超過資源').nextSibling).toHaveTextContent('1');
    expect(screen.getByTestId('load-balancing-scenario-bar')).not.toHaveTextContent('移管');
  });

  it('undo and clear restore the complete named selection even without overload', () => {
    const data = workspace();
    for (const resource of data.resources) for (const month of data.months) resource.capacityByMonth[month] = 10000 * H;
    data.outsourceSettings!.namedTargets = [{ kind: 'machine', key: 'NVD-5000', vendorId: 'v1' }];
    mockUseWorkspace.mockReturnValue({ data, isFetching: false, error: null });
    render(<ProductionScheduleLoadBalancingPage />);
    expect(screen.getByRole('button', { name: '自動選定' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '自動選定' }));
    const output = screen.getByTestId('load-balancing-outsource');
    expect(within(output).getAllByRole('button', { name: /外注を取り消す/ })).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: '1つ戻す' }));
    expect(within(output).queryByRole('button', { name: /外注を取り消す/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '自動選定' }));
    fireEvent.click(screen.getByRole('button', { name: 'クリア' }));
    expect(within(output).queryByRole('button', { name: /外注を取り消す/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '1つ戻す' }));
    expect(within(output).getAllByRole('button', { name: /外注を取り消す/ })).toHaveLength(4);
  });

  it('saves vendor hours as minutes and persists mode and candidate order from the gear dialog', () => {
    render(<ProductionScheduleLoadBalancingPage />);
    fireEvent.click(screen.getByRole('button', { name: '業者の設定' }));
    const dialog = screen.getByRole('dialog', { name: '業者の設定' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: '名前' }), { target: { value: '加工B' } });
    fireEvent.change(within(dialog).getByRole('spinbutton', { name: '月の上限' }), { target: { value: '12.5' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '部品ごと' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '業者の順位 を前へ' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '閉じる' }));
    expect(mockSettingsMutate).toHaveBeenCalledWith(expect.objectContaining({ mode: 'part', order: ['due', 'vendor', 'minutes'], vendors: [expect.objectContaining({ id: 'v1', name: '加工B', monthlyCapacityMinutes: 750 })] }), expect.objectContaining({ onSuccess: expect.any(Function) }));
  });

  it.each(['button', 'Escape'])('closes unchanged settings via %s without saving or losing actions/history', (method) => {
    const data = workspace();
    data.outsourceSettings!.vendors[0]!.priority = 7;
    mockUseWorkspace.mockReturnValue({ data, isFetching: false, error: null });
    render(<ProductionScheduleLoadBalancingPage />);
    fireEvent.click(screen.getAllByRole('button', { name: '後ろへ' })[0]!);
    const before = screen.getByTestId('load-balancing-scenario-bar').textContent;
    fireEvent.click(screen.getByRole('button', { name: '業者の設定' }));
    const dialog = screen.getByRole('dialog', { name: '業者の設定' });
    // Changing a value and restoring it must also count as unchanged.
    fireEvent.change(within(dialog).getByRole('textbox', { name: '名前' }), { target: { value: 'temporary' } });
    fireEvent.change(within(dialog).getByRole('textbox', { name: '名前' }), { target: { value: '加工A' } });
    if (method === 'Escape') fireEvent.keyDown(dialog, { key: 'Escape' });
    else fireEvent.click(within(dialog).getByRole('button', { name: '閉じる' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mockSettingsMutate).not.toHaveBeenCalled();
    expect(screen.getByTestId('load-balancing-scenario-bar').textContent).toBe(before);
    expect(screen.getByRole('button', { name: '1つ戻す' })).toBeEnabled();
  });

  it('clears actions and history only after changed settings save successfully', () => {
    render(<ProductionScheduleLoadBalancingPage />);
    fireEvent.click(screen.getAllByRole('button', { name: '後ろへ' })[0]!);
    fireEvent.click(screen.getByRole('button', { name: '業者の設定' }));
    fireEvent.change(screen.getByRole('textbox', { name: '名前' }), { target: { value: '加工B' } });
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    expect(screen.getByRole('button', { name: '1つ戻す' })).toBeEnabled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    act(() => mockSettingsMutate.mock.calls[0]![1].onSuccess());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1つ戻す' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: '取り消す' })).not.toBeInTheDocument();
  });

  it('adds vendors when randomUUID is unavailable', () => {
    const randomUUID = vi.spyOn(crypto, 'randomUUID');
    // Simulate the property being absent on an insecure origin.
    Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: undefined });
    try {
      render(<ProductionScheduleLoadBalancingPage />);
      fireEvent.click(screen.getByRole('button', { name: '業者の設定' }));
      fireEvent.click(screen.getByRole('button', { name: '＋ 業者' }));
      fireEvent.change(screen.getByRole('textbox', { name: '名前' }), { target: { value: '新業者' } });
      fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
      const vendors = mockSettingsMutate.mock.calls[0]![0].vendors;
      expect(vendors[1].id).toMatch(/^vendor-[a-z0-9]+-[a-z0-9]+$/);
      expect(vendors[1].id).not.toBe(vendors[0].id);
    } finally { randomUUID.mockRestore(); }
  });

  it('does not create no-taker rows on manual actions, cancellation or undo when internal transfer is feasible', () => {
    const data = workspace();
    data.outsourceSettings!.vendors = [];
    mockUseWorkspace.mockReturnValue({ data, isFetching: false, error: null });
    render(<ProductionScheduleLoadBalancingPage />);
    const output = screen.getByTestId('load-balancing-outsource');
    // Defer b; a still fits the internal destination even after b is cancelled.
    fireEvent.click(screen.getAllByRole('button', { name: '後ろへ' })[1]!);
    expect(output).not.toHaveTextContent('出し先なし');
    fireEvent.click(screen.getByRole('button', { name: '取り消す' }));
    expect(output).not.toHaveTextContent('出し先なし');
    fireEvent.click(screen.getByRole('button', { name: '1つ戻す' }));
    expect(output).not.toHaveTextContent('出し先なし');
  });

  it('filters no-taker rows by normalized machine without clearing operations, does not restore them on cancel, and undo restores the earlier result', () => {
    const data = workspace();
    data.transferRules = [];
    data.outsourceSettings!.vendors = [];
    data.resources[0]!.capacityByMonth['2026-10'] = 0;
    data.rows[0]!.machineName = ' ｎｖｄ－５０００ ';
    mockUseWorkspace.mockReturnValue({ data, isFetching: false, error: null });
    render(<ProductionScheduleLoadBalancingPage />);
    fireEvent.click(screen.getByRole('button', { name: '自動選定' }));
    const output = screen.getByTestId('load-balancing-outsource');
    expect(within(output).getByText('部品a')).toBeInTheDocument();
    expect(within(output).getByText('部品b')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: '機種' }), { target: { value: 'NVD-5000' } });
    expect(within(output).getByText('部品a')).toBeInTheDocument();
    expect(within(output).queryByText('部品b')).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: '後ろへ' })[0]!);
    expect(output).not.toHaveTextContent('出し先なし');
    fireEvent.change(screen.getByRole('combobox', { name: '機種' }), { target: { value: 'HX-630' } });
    expect(within(output).getByText('部品b')).toBeInTheDocument();
    expect(screen.getByTestId('load-balancing-scenario-bar')).toHaveTextContent('後ろへ');
    fireEvent.change(screen.getByRole('combobox', { name: '機種' }), { target: { value: 'NVD-5000' } });
    fireEvent.click(screen.getByRole('button', { name: '取り消す' }));
    expect(within(output).queryByText('部品a')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '1つ戻す' }));
    expect(within(output).queryByText('部品a')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '1つ戻す' }));
    expect(within(output).getByText('部品a')).toBeInTheDocument();
  });

  it('disables vendors failing conditions or any monthly limit and transfers that exceed another month', () => {
    const data = workspace();
    data.rows[0]!.allocations.push({ bucket: '2026-11', minutes: 200 * H });
    data.outsourceSettings!.vendors.push({ id: 'v2', name: '条件外', priority: 2, monthlyCapacityMinutes: null, conditions: [] }, { ...data.outsourceSettings!.vendors[0]!, id: 'v3', name: '上限不足', priority: 3, monthlyCapacityMinutes: 100 * H });
    mockUseWorkspace.mockReturnValue({ data, isFetching: false, error: null });
    render(<ProductionScheduleLoadBalancingPage />);
    // Select October explicitly: the larger November overload is now the initial selection.
    fireEvent.click(within(screen.getByTestId('load-balancing-heatmap')).getAllByRole('row')[1]!.querySelectorAll('td')[3]!);
    const detail = screen.getByTestId('load-balancing-cell-detail');
    fireEvent.click(within(detail).getAllByRole('button', { name: '外注 ▾' })[0]!);
    expect(within(detail).getByRole('button', { name: /条件外/ })).toBeDisabled();
    expect(within(detail).getByRole('button', { name: /上限不足/ })).toBeDisabled();
    fireEvent.click(within(detail).getAllByRole('button', { name: '移管 ▾' })[0]!);
    expect(within(detail).getByRole('menuitem', { name: /034/ })).toBeDisabled();
  });

  it('lists rows that could not be placed on any month', () => {
    render(<ProductionScheduleLoadBalancingPage />);

    fireEvent.click(screen.getByRole('button', { name: /未配分/ }));
    expect(screen.getByTestId('load-balancing-unallocated')).toHaveTextContent('着手日なし');
  });

  it('switches the workspace read to SCAW, exposes pressed state and persists across mounts', () => {
    const { unmount } = render(<ProductionScheduleLoadBalancingPage />);
    const button = screen.getByRole('button', { name: 'SCAW' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(mockUseWorkspace).toHaveBeenLastCalledWith(expect.objectContaining({ dueSource: 'scaw' }), { enabled: true });
    unmount();
    render(<ProductionScheduleLoadBalancingPage />);
    expect(screen.getByRole('button', { name: 'SCAW' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'SCAW' }));
    expect(mockUseWorkspace).toHaveBeenLastCalledWith(expect.objectContaining({ dueSource: 'excel' }), { enabled: true });
  });
});
