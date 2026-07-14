import { fireEvent, render, screen } from '@testing-library/react';
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
  it('keeps detail and resume action collapsed until its individual card is opened', () => {
    render(
      <MemoryRouter>
        <AssemblyWipPane sessions={[session]} loading={false} onReload={() => undefined} />
      </MemoryRouter>
    );

    expect(screen.getByRole('list', { name: '仕掛中' })).toBeInTheDocument();
    expect(screen.getByText('S/N S002')).toBeInTheDocument();
    expect(screen.getByText('進捗 0/1 (0%)')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '再開' })).not.toBeInTheDocument();

    const toggle = screen.getByRole('button', { name: 'ASM-START-001・S002 の詳細を開く' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('現在')).toBeInTheDocument();
    expect(screen.getByText('ストッパー取付 ・ 締付位置 #1')).toBeInTheDocument();
    const resume = screen.getByRole('link', { name: '再開' });
    expect(resume).toHaveAttribute('href', '/kiosk/assembly/work-sessions/session-2');
    expect(resume).toHaveClass('min-h-11');
  });
});
