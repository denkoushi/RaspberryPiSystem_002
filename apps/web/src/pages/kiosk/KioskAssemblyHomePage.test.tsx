import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { KioskAssemblyHomePage } from './KioskAssemblyHomePage';

import type { AssemblySeibanCandidateDto, AssemblyWorkSessionSummaryDto } from '../../features/assembly/types';

const mockListAssemblySeibanCandidates = vi.fn();
const mockListAssemblyWorkSessionSummaries = vi.fn();
const mockStartAssemblyWorkSession = vi.fn();

vi.mock('../../api/client', () => ({
  listAssemblySeibanCandidates: (...args: unknown[]) => mockListAssemblySeibanCandidates(...args),
  listAssemblyWorkSessionSummaries: (...args: unknown[]) => mockListAssemblyWorkSessionSummaries(...args),
  startAssemblyWorkSession: (...args: unknown[]) => mockStartAssemblyWorkSession(...args)
}));

const candidate: AssemblySeibanCandidateDto = {
  fseiban: 'ASMTEST-A1',
  machineName: 'MH-AX',
  machineNameSource: 'production_schedule',
  activeTemplate: {
    id: 'template-1',
    modelCode: 'MH-AX',
    procedurePattern: '標準',
    name: 'MH-AX 標準',
    version: 1
  }
};

const inProgressSession: AssemblyWorkSessionSummaryDto = {
  id: 'session-2',
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
  totalBoltCount: 1
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/kiosk/assembly']}>
      <Routes>
        <Route path="/kiosk/assembly" element={<KioskAssemblyHomePage />} />
        <Route path="/kiosk/assembly/work-sessions/:sessionId" element={<div>session opened</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('KioskAssemblyHomePage', () => {
  beforeEach(() => {
    mockListAssemblySeibanCandidates.mockReset();
    mockListAssemblyWorkSessionSummaries.mockReset();
    mockStartAssemblyWorkSession.mockReset();
    mockListAssemblySeibanCandidates.mockResolvedValue([candidate]);
    mockListAssemblyWorkSessionSummaries.mockResolvedValue([inProgressSession]);
    mockStartAssemblyWorkSession.mockResolvedValue({ id: 'session-1' });
  });

  it('selects a seiban candidate and starts work with normalized serial input', async () => {
    renderPage();

    expect(screen.getByRole('link', { name: '手順書ライブラリ' })).toHaveAttribute('href', '/kiosk/assembly/library');
    expect(screen.getByRole('link', { name: '閲覧順設定' })).toHaveAttribute('href', '/kiosk/assembly/procedure-order-settings');
    fireEvent.change(screen.getByLabelText('製番'), { target: { value: 'asmtest-a' } });

    await waitFor(() =>
      expect(mockListAssemblySeibanCandidates).toHaveBeenCalledWith({ prefix: 'ASMTEST-A', limit: 20 })
    );
    fireEvent.click(await screen.findByText('ASMTEST-A1'));
    expect(screen.getByRole('link', { name: '閲覧順設定' })).toHaveAttribute(
      'href',
      '/kiosk/assembly/procedure-order-settings?machineName=MH-AX'
    );
    fireEvent.change(screen.getByLabelText('シリアルNo.'), { target: { value: 's001' } });
    fireEvent.change(screen.getByLabelText('作業者'), { target: { value: '佐藤' } });

    await waitFor(() => expect(screen.getByLabelText('シリアルNo.')).toHaveValue('S001'));
    fireEvent.click(screen.getByRole('button', { name: '組立開始' }));

    await waitFor(() =>
      expect(mockStartAssemblyWorkSession).toHaveBeenCalledWith({
        templateId: 'template-1',
        productNo: 'ASMTEST-A1',
        serialNo: 'S001',
        operatorNameSnapshot: '佐藤',
        targetUnit: 'MH-AX',
        torqueWrenchId: 'CEM20N3X10D-BTLA'
      })
    );
    expect(await screen.findByText('session opened')).toBeInTheDocument();
  });

  it('renders in-progress sessions with links back to the work session', async () => {
    renderPage();

    expect(await screen.findByText('ASM-START-001')).toBeInTheDocument();
    expect(screen.getByText('S002 / MACHINE-X')).toBeInTheDocument();
    expect(screen.getByText('0/1')).toBeInTheDocument();
    expect(screen.getByText(/#1/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /ASM-START-001/ })).toHaveAttribute(
      'href',
      '/kiosk/assembly/work-sessions/session-2'
    );
  });
});
