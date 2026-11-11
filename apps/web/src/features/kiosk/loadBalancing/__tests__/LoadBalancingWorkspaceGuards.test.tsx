import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { computeWorkspaceSummary, LoadBalancingWorkspaceView, useLoadBalancingWorkspaceState } from '../LoadBalancingWorkspace';

import type { ProductionScheduleLoadBalancingWorkspaceResponse } from '../../../../api/client';
import type { LoadBalancingCellDetail } from '../LoadBalancingCellDetail';
import type { ScenarioResult } from '../loadBalancingScenario';
import type { ComponentProps } from 'react';

const query = vi.hoisted(() => vi.fn());
vi.mock('../../../../api/hooks', () => ({
  useKioskProductionScheduleLoadBalancingWorkspace: query,
  useKioskProductionScheduleResources: () => ({ data: undefined }),
  usePutKioskProductionScheduleLoadBalancingCapacityBase: () => ({ isPending: false, error: null })
}));
vi.mock('../LoadBalancingCellDetail', () => ({
  LoadBalancingCellDetail: ({ onAction, onUndo }: ComponentProps<typeof LoadBalancingCellDetail>) => <>
    <button onClick={() => onAction({ type: 'outsource', rowId: 'a', vendorId: 'v' })}>forced outsource</button>
    <button onClick={() => onAction({ type: 'transfer', rowId: 'a', toResourceCd: 'B', efficiencyRatio: 1 })}>forced transfer</button>
    <button onClick={() => onUndo('a')}>forced undo</button>
  </>
}));

const data = (): ProductionScheduleLoadBalancingWorkspaceResponse => ({
  siteKey: 'site', today: '2026-11-10', fromMonth: '2026-11', toMonth: '2026-11', months: ['2026-11'],
  rows: [{ rowId: 'a', fseiban: 'S', productNo: '1', fhincd: 'P', fhinmei: 'part', machineName: 'NVD', resourceCd: 'A', totalMinutes: 60, plannedStartDate: '2026-11-01', effectiveDueDate: '2026-11-30', late: false, allocations: [{ bucket: '2026-11', minutes: 60 }] }],
  resources: [{ resourceCd: 'A', classCode: null, workCalendarMode: 'weekdays', baseCapacityMinutes: 0, capacityByMonth: { '2026-11': 0 } }],
  transferRules: [], unallocatedRows: [],
  outsourceSettings: { mode: 'process', order: ['due', 'minutes', 'vendor'], vendors: [{ id: 'v', name: 'vendor', priority: 1, monthlyCapacityMinutes: null, conditions: [{ resourceCds: [], partPrefix: '', partName: '', maxMinutes: null }] }] }
});

describe('workspace placeholder guards', () => {
  it('rejects direct cell callbacks even if a child bypasses disabled buttons', () => {
    const workspace = data();
    const commitResult = vi.fn();
    render(<LoadBalancingWorkspaceView data={workspace} workspaceSummary={computeWorkspaceSummary(workspace, [])}
      formattedMachineNames={new Map([['NVD', 'NVD']])} thisMonth="2026-11" resourceNameMap={{}}
      actions={[{ rowId: 'a', type: 'outsource', vendorId: 'v' }]} operationsDisabled
      commitResult={commitResult} noTaker={[]} machine="" highlightUnset={false} panel="cell" onClosePanel={() => {}} scopeParams={{}} />);
    for (const name of ['forced outsource', 'forced transfer', 'forced undo']) fireEvent.click(screen.getByRole('button', { name }));
    expect(commitResult).not.toHaveBeenCalled();
  });

  it('rejects commit, undo and reset callbacks during placeholder data and clears noTaker with new inputs', () => {
    const workspace = data();
    query.mockReturnValue({ data: workspace, isPlaceholderData: false });
    const { result, rerender } = renderHook(() => useLoadBalancingWorkspaceState({ scopeParams: {}, scopeEnabled: true, dueSource: 'excel' }));
    const trial: ScenarioResult = { actions: [{ rowId: 'a', type: 'outsource', vendorId: 'v' }], noTaker: [{ rowId: 'other', reason: '条件' }] };
    act(() => result.current.commitResult(trial));
    query.mockReturnValue({ data: workspace, isPlaceholderData: true });
    rerender();
    act(() => {
      result.current.commitResult({ actions: [], noTaker: [] });
      result.current.undo();
      result.current.reset();
    });
    expect(result.current.result).toEqual(trial);
    const updated = data(); updated.rows[0]!.totalMinutes += 1;
    query.mockReturnValue({ data: updated, isPlaceholderData: false });
    rerender();
    expect(result.current.result).toEqual({ actions: [], noTaker: [] });
    expect(result.current.canUndo).toBe(false);
  });
});
