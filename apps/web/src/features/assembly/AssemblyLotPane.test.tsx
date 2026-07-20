import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { AssemblyLotPane } from './AssemblyLotPane';

import type { AssemblyLotSummaryDto } from './types';

const lot: AssemblyLotSummaryDto = {
  id: 'lot-1',
  templateId: 'template-1',
  productNo: 'ASMTEST-A1',
  expectedQuantity: 4,
  registeredSerialCount: 4,
  notStartedCount: 2,
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
      id: 'serial-new-1',
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
    },
    {
      id: 'serial-new-2',
      lotId: 'lot-1',
      sortOrder: 3,
      serialNo: 'S-004',
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
  it('renders one collapsed card per not-started serial and starts only the expanded card', () => {
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

    expect(screen.getByRole('heading', { name: '着手前' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: '着手前' })).toBeInTheDocument();
    expect(screen.getByText('作業ID S-003')).toBeInTheDocument();
    expect(screen.getByText('作業ID S-004')).toBeInTheDocument();
    expect(screen.queryByText('作業ID S-001')).not.toBeInTheDocument();
    expect(screen.queryByText('作業ID S-002')).not.toBeInTheDocument();
    expect(screen.queryByText('未着手')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '開始' })).not.toBeInTheDocument();

    const toggle = screen.getByRole('button', { name: 'ASMTEST-A1・S-003 の詳細を開く' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('ロット数量')).toBeInTheDocument();
    expect(screen.getByText('4個')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '開始' })).toHaveClass('min-h-11');
    expect(screen.getAllByText('機種 MH-2200')[0]).toHaveClass('break-words');

    fireEvent.click(screen.getByRole('button', { name: '開始' }));
    expect(onStartSerial).toHaveBeenCalledWith('lot-1', 'serial-new-1');
  });
});
