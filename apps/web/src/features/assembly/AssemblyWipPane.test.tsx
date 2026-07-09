import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { AssemblyWipPane } from './AssemblyWipPane';

import type { AssemblyWorkSessionSummaryDto } from './types';

const session: AssemblyWorkSessionSummaryDto = {
  id: 'session-2',
  lotSerialId: null,
  templateId: 'template-1',
  status: 'in_progress',
  productNo: 'ASM-START-001',
  serialNo: 'S002',
  nameplateNo: 'S002',
  operatorNameSnapshot: '佐藤',
  targetUnit: 'MACHINE-X',
  torqueWrenchId: 'CEM20N3X10D-BTLA',
  startedAt: '2026-07-06T00:00:00.000Z',
  completedAt: null,
  cancelledAt: null,
  updatedAt: '2026-07-06T00:01:00.000Z',
  templateModelCode: 'MACHINE-X',
  templateProcedurePattern: '標準',
  templateName: 'MACHINE-X 標準',
  templateVersion: 1,
  currentAreaId: 'area-1',
  currentAreaName: 'ストッパー取付',
  currentBoltId: 'bolt-1',
  currentBoltMarkerNo: 1,
  acceptedBoltCount: 0,
  totalBoltCount: 1,
  approval: null
};

describe('AssemblyWipPane', () => {
  it('renders compact table rows with progress bar and work-session links', () => {
    render(
      <MemoryRouter>
        <AssemblyWipPane sessions={[session]} loading={false} onReload={() => undefined} />
      </MemoryRouter>
    );

    expect(screen.getByRole('table', { name: '仕掛中' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '製番' })).toBeInTheDocument();
    expect(screen.getByText('0/1')).toBeInTheDocument();
    expect(screen.getByText(/ストッパー取付 ・ #1/)).toBeInTheDocument();
    expect(screen.getByText(/S002 \/ 佐藤/)).toBeInTheDocument();

    expect(screen.getByRole('link', { name: 'ASM-START-001' })).toHaveAttribute(
      'href',
      '/kiosk/assembly/work-sessions/session-2'
    );
    const resume = screen.getByRole('link', { name: '再開' });
    expect(resume).toHaveAttribute('href', '/kiosk/assembly/work-sessions/session-2');
    expect(resume).toHaveClass('min-h-11');
  });
});
