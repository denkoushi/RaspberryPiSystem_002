import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { AssemblyCompletedPane } from './AssemblyCompletedPane';

import type { AssemblyWorkSessionSummaryDto } from './types';

const completedSession: AssemblyWorkSessionSummaryDto = {
  id: 'session-completed-1',
  lotSerialId: null,
  templateId: 'template-1',
  status: 'completed',
  productNo: 'ASM-DONE-001',
  serialNo: 'S001',
  nameplateNo: 'S001',
  operatorNameSnapshot: '佐藤',
  targetUnit: 'MACHINE-X',
  torqueWrenchId: 'CEM20N3X10D-BTLA',
  startedAt: '2026-07-06T00:00:00.000Z',
  completedAt: '2026-07-06T01:00:00.000Z',
  cancelledAt: null,
  updatedAt: '2026-07-06T01:00:00.000Z',
  templateModelCode: 'MACHINE-X',
  templateProcedurePattern: '標準',
  templateName: 'MACHINE-X 標準',
  templateVersion: 1,
  currentAreaId: null,
  currentAreaName: null,
  currentBoltId: null,
  currentBoltMarkerNo: null,
  acceptedBoltCount: 1,
  totalBoltCount: 1,
  approval: null
};

const approvedSession: AssemblyWorkSessionSummaryDto = {
  ...completedSession,
  id: 'session-completed-2',
  productNo: 'ASM-DONE-002',
  approval: {
    approvedAt: '2026-07-06T02:00:00.000Z',
    approverEmployeeId: 'emp-1',
    approverEmployeeCodeSnapshot: 'E001',
    approverEmployeeNameSnapshot: '承認者',
    approverNfcTagUidSnapshot: 'TAG-001',
    comment: null,
    clientDeviceId: null,
    clientDeviceNameSnapshot: null
  }
};

describe('AssemblyCompletedPane', () => {
  it('does not expose approval status labels on cards and opens record confirmation per item', () => {
    render(
      <MemoryRouter>
        <AssemblyCompletedPane sessions={[completedSession, approvedSession]} loading={false} onReload={() => undefined} />
      </MemoryRouter>
    );

    expect(screen.getByRole('heading', { name: '完了・承認' })).toBeInTheDocument();
    expect(screen.getAllByText('進捗 1/1 (100%)')).toHaveLength(2);
    expect(screen.queryByText('未承認')).not.toBeInTheDocument();
    expect(screen.queryByText('承認済み')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '記録確認' })).not.toBeInTheDocument();

    const toggle = screen.getByRole('button', { name: 'ASM-DONE-001・S001 の詳細を開く' });
    fireEvent.click(toggle);

    expect(screen.getByText('締結進捗')).toBeInTheDocument();
    const record = screen.getByRole('link', { name: '記録確認' });
    expect(record).toHaveAttribute('href', '/kiosk/assembly/record-approvals?sessionId=session-completed-1');
    expect(record).toHaveClass('min-h-11');
  });
});
