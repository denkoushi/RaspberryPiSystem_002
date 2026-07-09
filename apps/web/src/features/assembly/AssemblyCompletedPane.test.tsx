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
  it('keeps secondary detail collapsed while record links stay available', () => {
    render(
      <MemoryRouter>
        <AssemblyCompletedPane
          sessions={[completedSession, approvedSession]}
          loading={false}
          onReload={() => undefined}
          lotQtyByProductNo={{ 'ASM-DONE-001': 3 }}
        />
      </MemoryRouter>
    );

    expect(screen.getByRole('table', { name: '完了した製品' })).toBeInTheDocument();

    const toggle = screen.getByRole('button', { name: 'ASM-DONE-001' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(/作業者 佐藤/)).not.toBeInTheDocument();

    const recordLinks = screen.getAllByRole('link', { name: '記録確認' });
    expect(recordLinks[0]).toHaveAttribute(
      'href',
      '/kiosk/assembly/record-approvals?sessionId=session-completed-1'
    );
    expect(recordLinks[1]).toHaveAttribute(
      'href',
      '/kiosk/assembly/record-approvals?sessionId=session-completed-2'
    );
    expect(recordLinks[0]).toHaveClass('min-h-11');
    expect(screen.getAllByText('未承認')).toHaveLength(1);
    expect(screen.getAllByText('承認済み')).toHaveLength(1);
    expect(screen.getByText('3')).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/S001 ・ MACHINE-X ・ 作業者 佐藤/)).toBeInTheDocument();
  });

  it('looks up lot quantity with normalized product number keys', () => {
    render(
      <MemoryRouter>
        <AssemblyCompletedPane
          sessions={[{ ...completedSession, productNo: ' asm-done-001 ' }]}
          loading={false}
          onReload={() => undefined}
          lotQtyByProductNo={{ 'ASM-DONE-001': 3 }}
        />
      </MemoryRouter>
    );

    expect(screen.getByText('3')).toBeInTheDocument();
  });
});
