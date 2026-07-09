import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { AssemblyLotPane } from './AssemblyLotPane';

import type { AssemblyLotSummaryDto } from './types';

const lot: AssemblyLotSummaryDto = {
  id: 'lot-1',
  templateId: 'template-1',
  productNo: 'ASMTEST-A1',
  expectedQuantity: 3,
  registeredSerialCount: 3,
  notStartedCount: 1,
  inProgressCount: 1,
  completedCount: 1,
  cancelledCount: 0,
  approvedCount: 0,
  isWorkComplete: false,
  isFullyApproved: false,
  operatorEmployeeId: null,
  operatorNameSnapshot: '田中',
  targetUnit: 'MH-2200',
  torqueWrenchId: 'CEM20N3X10D-BTLA',
  clientDeviceId: null,
  clientDeviceNameSnapshot: null,
  createdAt: '2026-07-06T00:00:00.000Z',
  updatedAt: '2026-07-06T00:01:00.000Z',
  template: {
    id: 'template-1',
    modelCode: 'MH-2200',
    procedurePattern: '標準',
    name: 'MH-2200 標準',
    version: 1
  },
  serials: [
    {
      id: 'serial-done',
      lotId: 'lot-1',
      sortOrder: 0,
      serialNo: 'S-001',
      status: 'completed',
      workSessionId: 'session-done',
      startedAt: '2026-07-06T00:00:00.000Z',
      completedAt: '2026-07-06T01:00:00.000Z',
      cancelledAt: null,
      updatedAt: '2026-07-06T01:00:00.000Z',
      approval: null
    },
    {
      id: 'serial-wip',
      lotId: 'lot-1',
      sortOrder: 1,
      serialNo: 'S-002',
      status: 'in_progress',
      workSessionId: 'session-wip',
      startedAt: '2026-07-06T00:30:00.000Z',
      completedAt: null,
      cancelledAt: null,
      updatedAt: '2026-07-06T00:30:00.000Z',
      approval: null
    },
    {
      id: 'serial-new',
      lotId: 'lot-1',
      sortOrder: 2,
      serialNo: 'S-003',
      status: 'not_started',
      workSessionId: null,
      startedAt: null,
      completedAt: null,
      cancelledAt: null,
      updatedAt: '2026-07-06T00:01:00.000Z',
      approval: null
    }
  ]
};

describe('AssemblyLotPane', () => {
  it('renders group and serial rows with start/resume/record actions', () => {
    const onStartSerial = vi.fn();
    render(
      <MemoryRouter>
        <AssemblyLotPane
          lots={[lot]}
          loading={false}
          busySerialId={null}
          onReload={() => undefined}
          onStartSerial={onStartSerial}
        />
      </MemoryRouter>
    );

    expect(screen.getByRole('table', { name: '登録済みロット' })).toBeInTheDocument();
    expect(screen.getByText(/ASMTEST-A1 ・ MH-2200 ・ 田中 ・ 作業 1\/3 ・ 承認 0\/3/)).toBeInTheDocument();
    expect(screen.getByText('S-001')).toBeInTheDocument();
    expect(screen.getByText('S-002')).toBeInTheDocument();
    expect(screen.getByText('S-003')).toBeInTheDocument();

    const startButton = screen.getByRole('button', { name: '開始' });
    expect(startButton).toHaveClass('min-h-11');
    fireEvent.click(startButton);
    expect(onStartSerial).toHaveBeenCalledWith('lot-1', 'serial-new');

    expect(screen.getByRole('link', { name: '再開' })).toHaveAttribute(
      'href',
      '/kiosk/assembly/work-sessions/session-wip'
    );
    expect(screen.getByRole('link', { name: '記録確認' })).toHaveAttribute(
      'href',
      '/kiosk/assembly/record-approvals?sessionId=session-done'
    );
  });
});
