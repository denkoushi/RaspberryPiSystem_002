import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LoadBalancingWorkspaceView, computeWorkspaceSummary } from '../LoadBalancingWorkspace';

import type { ProductionScheduleLoadBalancingWorkspaceResponse } from '../../../../api/client';
import type { LoadBalancingCellDetail } from '../LoadBalancingCellDetail';
import type { ComponentProps } from 'react';

vi.mock('../../../../api/hooks', () => ({
  usePutKioskProductionScheduleLoadBalancingCapacityBase: () => ({ isPending: false, error: null })
}));
vi.mock('../LoadBalancingCellDetail', () => ({
  LoadBalancingCellDetail: ({ onAction }: ComponentProps<typeof LoadBalancingCellDetail>) =>
    <button onClick={() => onAction({ type: 'outsource', rowId: 'a', vendorId: 'blocked' })}>stale vendor action</button>
}));

describe('workspace action commit', () => {
  it('does not commit unchanged actions or add history when a stale vendor action is rejected', () => {
    const commitResult = vi.fn();
    const data: ProductionScheduleLoadBalancingWorkspaceResponse = {
      siteKey: 'site', today: '2026-11-07', fromMonth: '2026-11', toMonth: '2026-11', months: ['2026-11'],
      rows: [{ rowId: 'a', fseiban: 'S', productNo: '1', fhincd: 'P', fhinmei: 'part', machineName: 'NVD', resourceCd: 'A', totalMinutes: 60, plannedStartDate: '2026-11-01', effectiveDueDate: '2026-11-30', late: false, allocations: [{ bucket: '2026-11', minutes: 60 }] }],
      resources: [{ resourceCd: 'A', classCode: null, workCalendarMode: 'weekdays', baseCapacityMinutes: 0, capacityByMonth: { '2026-11': 0 } }],
      transferRules: [], unallocatedRows: [],
      outsourceSettings: { mode: 'process', order: ['due', 'minutes', 'vendor'], vendors: [{ id: 'blocked', name: 'blocked', priority: 1, monthlyCapacityMinutes: 0, conditions: [{ resourceCds: [], partPrefix: '', partName: '', maxMinutes: null }] }] }
    };
    render(<LoadBalancingWorkspaceView data={data} workspaceSummary={computeWorkspaceSummary(data, [])}
      formattedMachineNames={new Map([['NVD', 'NVD']])} thisMonth="2026-11" resourceNameMap={{}} actions={[]}
      commitResult={commitResult} noTaker={[]} machine="" highlightUnset={false} panel="cell" onClosePanel={() => {}} scopeParams={{}} />);
    fireEvent.click(screen.getByRole('button', { name: 'stale vendor action' }));
    expect(commitResult).not.toHaveBeenCalled();
  });
});
